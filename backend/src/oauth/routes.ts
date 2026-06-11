/**
 * OAuth flow endpoints.
 *
 *   GET /oauth/:provider/start   — protected. Generates state + PKCE,
 *                                  returns the authorization URL for the
 *                                  dashboard to navigate the browser to.
 *
 *   GET /oauth/:provider/callback — public (called by browser after the user
 *                                   authorizes at the provider). Verifies
 *                                   state, exchanges code for tokens, creates
 *                                   the account, redirects to the dashboard.
 *
 * The callback is public — auth is provided by the state token, which is a
 * cryptographically random one-time-use value generated on /start.
 */

import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import {
  getProviderConfig,
  getOAuthRedirectUri,
  getDashboardBase,
  type OAuthProvider,
} from './config.js'
import { createState, consumeState, createCodeVerifier, pkceChallenge } from './state.js'
import { exchangeCode, decodeIdToken } from './tokens.js'
import { accountQueries, bowlQueries } from '../db/index.js'
import { broadcast } from '../api/ws.js'
import type { Account } from '../types.js'

const VALID_PROVIDERS = new Set<OAuthProvider>(['google', 'microsoft'])

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /oauth/providers — which OAuth providers are configured ────────────
  // Lets the dashboard know which buttons to show without hardcoding the list.
  // The booleans reflect whether the operator has set the relevant env vars.
  app.get('/oauth/providers', async () => {
    return {
      google: getProviderConfig('google') !== null,
      microsoft: getProviderConfig('microsoft') !== null,
    }
  })

  // ── GET /oauth/:provider/start ─────────────────────────────────────────────
  app.get<{
    Params: { provider: string }
    Querystring: { bowlId?: string }
  }>('/oauth/:provider/start', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const provider = req.params.provider as OAuthProvider
    if (!VALID_PROVIDERS.has(provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` })
    }
    const cfg = getProviderConfig(provider)
    if (!cfg) {
      return reply.status(503).send({
        error: `OAuth for ${provider} is not configured. The operator needs to set ${provider === 'google' ? 'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET' : 'MS_OAUTH_CLIENT_ID + MS_OAUTH_CLIENT_SECRET'}.`,
      })
    }

    const codeVerifier = createCodeVerifier()
    const challenge = pkceChallenge(codeVerifier)
    // Store userId in the state so the callback (which has no auth header)
    // can still create the mailbox connection under the right owner. No
    // bowl is involved — mail routes to bowls by address after sync.
    const state = createState({ userId: req.userId, codeVerifier, provider })

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: getOAuthRedirectUri(provider),
      scope: cfg.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    // Google needs access_type=offline + prompt=consent to reliably return a refresh_token
    // on every authorization. Microsoft returns refresh tokens by default when offline_access
    // is in the scope list.
    if (provider === 'google') {
      params.set('access_type', 'offline')
      params.set('prompt', 'consent')
    }

    return { authUrl: `${cfg.authUrl}?${params.toString()}` }
  })

  // ── GET /oauth/:provider/callback ──────────────────────────────────────────
  app.get<{
    Params: { provider: string }
    Querystring: {
      code?: string
      state?: string
      error?: string
      error_description?: string
    }
  }>('/oauth/:provider/callback', async (req, reply) => {
    const provider = req.params.provider as OAuthProvider
    let dashboardBase = ''
    try {
      dashboardBase = getDashboardBase()
    } catch {
      return reply.status(500).send({ error: 'DASHBOARD_BASE is not configured on the server' })
    }

    const redirectBack = (params: Record<string, string>) => {
      const url = new URL(dashboardBase)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      return reply.redirect(url.toString())
    }

    if (!VALID_PROVIDERS.has(provider)) {
      return redirectBack({ oauth_error: 'unknown_provider' })
    }
    if (req.query.error) {
      // User clicked Cancel, or the provider rejected the request
      return redirectBack({
        oauth_error: req.query.error,
        ...(req.query.error_description && { oauth_error_description: req.query.error_description }),
      })
    }

    const code = req.query.code
    const state = req.query.state
    if (!code || !state) return redirectBack({ oauth_error: 'missing_params' })

    const entry = consumeState(state)
    if (!entry || entry.provider !== provider) {
      return redirectBack({ oauth_error: 'invalid_state' })
    }

    const cfg = getProviderConfig(provider)
    if (!cfg) return redirectBack({ oauth_error: 'not_configured' })

    try {
      const tokens = await exchangeCode(provider, code, entry.codeVerifier)

      // We need a refresh_token to do anything ongoing. If the provider didn't
      // return one (Google sometimes does this if the user previously consented
      // and didn't re-consent), bail out and surface a clear error.
      if (!tokens.refresh_token) {
        return redirectBack({ oauth_error: 'no_refresh_token' })
      }

      // Pull the email from the id_token to use as IMAP username + display.
      const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : {}
      const email = claims.email || claims.preferred_username
      if (!email) return redirectBack({ oauth_error: 'no_email' })

      const tokenExpiresAt = Date.now() + Math.max(60, tokens.expires_in - 60) * 1000

      const account: Account = {
        id: nanoid(10),
        userId: entry.userId,
        label: email,
        provider: cfg.accountProvider,
        imapHost: cfg.imapHost,
        imapPort: cfg.imapPort,
        imapSecure: cfg.imapSecure,
        username: email,
        password: '', // unused for OAuth; encryption layer handles empty string fine
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        smtpSecure: cfg.smtpSecure,
        defaultFrom: email,
        aliases: [],
        createdAt: Date.now(),
        authType: 'oauth' as const,
        oauthProvider: provider,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        tokenExpiresAt,
      }

      await accountQueries.upsert(account, entry.userId)

      // Re-read for the canonical row (upsert may have matched an existing
      // mailbox connection). Connect using that.
      const stored = await accountQueries.getByMailbox(entry.userId, cfg.imapHost, email)
      const live = stored ?? account

      const { connectAccount } = await import('../imap/connection.js')
      connectAccount(live, broadcast).catch((err: Error) => {
        console.error(`[oauth] Failed to connect ${email}:`, err.message)
      })

      return redirectBack({ oauth_success: '1', account: email })
    } catch (err: any) {
      console.error(`[oauth] ${provider} callback error:`, err.message)
      return redirectBack({ oauth_error: 'exchange_failed', detail: err.message })
    }
  })
}
