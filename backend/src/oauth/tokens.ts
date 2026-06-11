/**
 * OAuth token exchange + refresh.
 *
 * Two operations:
 *   - exchangeCode: trade an authorization code for an initial token pair
 *     (refresh_token + access_token). Called once per account, in the callback.
 *   - refreshToken: trade a refresh_token for a new access_token. Called
 *     transparently before every IMAP/SMTP connection if the cached access
 *     token is expired or near-expiry.
 *
 * Access tokens for both Google and Microsoft are ~1 hour. Refresh tokens are
 * long-lived (Google: until revoked; Microsoft: 90 days of inactivity).
 *
 * Microsoft rotates refresh tokens on every refresh — we always write back the
 * returned refresh_token if present. Google may or may not rotate; we fall
 * back to the previous refresh_token if the response omits it.
 */

import type { OAuthProvider } from './config.js'
import { getProviderConfig, getOAuthRedirectUri } from './config.js'
import type { Account } from '../types.js'

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
  scope?: string
  token_type?: string
}

export interface IdTokenClaims {
  email?: string
  email_verified?: boolean
  sub?: string
  name?: string
  preferred_username?: string
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(provider)
  if (!cfg) throw new Error(`OAuth provider ${provider} is not configured`)

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: getOAuthRedirectUri(provider),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<TokenResponse>
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(provider)
  if (!cfg) throw new Error(`OAuth provider ${provider} is not configured`)

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  })

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<TokenResponse>
}

/**
 * Parse a JWT payload without verifying the signature. Safe because we
 * received this id_token over TLS directly from the issuer's token endpoint
 * — the connection authenticity gives us the same guarantee the signature
 * would. Used only to extract the email claim.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.')
  if (parts.length !== 3) return {}
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload) as IdTokenClaims
  } catch {
    return {}
  }
}

/**
 * Returns a valid access token for the account, refreshing if needed.
 * Persists the refreshed tokens back to the DB so subsequent calls hit the
 * cache. Imported lazily by IMAP/SMTP code right before they need to auth.
 */
export async function getValidAccessToken(account: Account): Promise<string> {
  if (account.authType !== 'oauth') {
    throw new Error(`Account ${account.id} is not OAuth-authenticated`)
  }
  if (!account.refreshToken || !account.oauthProvider) {
    throw new Error(`Account ${account.id} is missing OAuth tokens`)
  }

  // Use cached access token if it has >60s of remaining life.
  const now = Date.now()
  if (account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt > now + 60_000) {
    return account.accessToken
  }

  const tokens = await refreshAccessToken(account.oauthProvider, account.refreshToken)
  // Microsoft rotates refresh_token; Google may omit it on refresh.
  const newRefreshToken = tokens.refresh_token ?? account.refreshToken
  const newExpiresAt = now + Math.max(60, tokens.expires_in - 60) * 1000

  const { accountQueries } = await import('../db/index.js')
  await accountQueries.updateOAuthTokens(account.id, {
    accessToken: tokens.access_token,
    refreshToken: newRefreshToken,
    tokenExpiresAt: newExpiresAt,
  })

  // Mutate the in-memory account so callers see the updated tokens too.
  account.accessToken = tokens.access_token
  account.refreshToken = newRefreshToken
  account.tokenExpiresAt = newExpiresAt

  return tokens.access_token
}
