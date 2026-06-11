/**
 * Authentication routes.
 *
 *   POST /auth/signup    — create user (gated by SIGNUP_INVITE_CODE pre-launch)
 *   POST /auth/login     — credentials → session token
 *   POST /auth/logout    — revoke current session
 *   GET  /auth/me        — return current user info (used to verify session liveness)
 *
 * All four are public — they don't require an existing session. Auth on
 * authenticated routes is done by the middleware in server.ts, which looks up
 * the session token in the `x-session-token` header (or Authorization: Bearer).
 *
 * Session tokens are long-lived (30 days) but revocable. The client stores
 * the token in localStorage and sends it on every request.
 */

import type { FastifyInstance } from 'fastify'
import * as argon2 from 'argon2'
import { randomBytes } from 'crypto'
import { userQueries, sessionQueries, inviteCodeQueries, passwordResetQueries } from '../db/index.js'
import { sha256Hex } from '../crypto.js'
import { sendSystemEmail, isSystemMailConfigured } from '../mail/system.js'

// Minimum acceptable password length. 12 is the OWASP guideline floor for
// argon2-hashed passwords. We don't enforce zxcvbn here to keep the
// dependency surface small; if you want it later, add `zxcvbn` and check
// score >= 3 server-side.
const MIN_PASSWORD_LENGTH = 12
// Maximum to protect argon2 from DoS via huge inputs. argon2 doesn't have a
// hard limit but hashing a 10MB string would block the event loop.
const MAX_PASSWORD_LENGTH = 256

const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64MB strikes balance between security and typical small-VPS RAM
  timeCost: 3,
  parallelism: 4,
} as const

function isValidEmail(email: string): boolean {
  // Permissive RFC-5321 friendly check — the IMAP layer will reject anything
  // actually invalid when the user tries to connect their first account.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /auth/signup ────────────────────────────────────────────────────
  app.post<{
    Body: { email?: string; password?: string; inviteCode?: string }
  }>('/auth/signup', {
    config: {
      // Cap signups at 5 per IP per 10 minutes. Real users sign up once.
      // 5 absorbs a typo + retry without false-positive blocking.
      rateLimit: { max: 5, timeWindow: '10 minutes' },
    },
  }, async (req, reply) => {
    const email = (req.body.email || '').trim().toLowerCase()
    const password = req.body.password || ''
    const inviteCode = (req.body.inviteCode || '').trim()

    // Signup gate behavior:
    //
    // - DEFAULT (env var unset, no codes seeded): open signup. Anyone with
    //   a valid email and a strong password can create an account. This is
    //   the correct default for self-hosters — a fresh install must be
    //   usable without seeding the database first.
    //
    // - GATED MODE: if SIGNUP_INVITE_CODE is set OR any active rows exist
    //   in the invite_codes table, signups REQUIRE a valid code. Use this
    //   to keep a publicly reachable instance private, or as an ops kill
    //   switch if signup abuse spikes: set the env var, restart, gate is
    //   up without a code change.
    const envCode = process.env.SIGNUP_INVITE_CODE
    const tableCodesActive = await inviteCodeQueries.hasAnyActive()
    const gatedSignup = Boolean(envCode) || tableCodesActive

    if (gatedSignup) {
      let codeValid = false
      if (inviteCode) {
        if (envCode && inviteCode === envCode) {
          codeValid = true
        } else {
          codeValid = await inviteCodeQueries.isValid(inviteCode)
        }
      }
      if (!codeValid) {
        return reply.status(403).send({ error: 'Invalid invite code' })
      }
    }

    if (!isValidEmail(email)) {
      return reply.status(400).send({ error: 'Please enter a valid email address' })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      })
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: 'Password is too long' })
    }

    // Hash the password BEFORE checking if the email exists. Otherwise the
    // "email already used" path returns in ~5ms while the "email is new"
    // path takes ~100ms (argon2), letting an attacker enumerate registered
    // emails via response timing. Doing the hash unconditionally costs us
    // one wasted argon2 on collisions (rare), but kills the side channel.
    const hash = await argon2.hash(password, ARGON2_CONFIG)

    const existing = await userQueries.findByEmail(email)
    if (existing) {
      return reply.status(409).send({ error: 'Unable to create account' })
    }

    const user = await userQueries.create(email, hash)

    // Atomically claim the invite code slot. We do this AFTER user creation
    // because a failure here shouldn't roll back the account (the code might
    // have been the env-var fallback, in which case there's nothing to claim).
    // The conditional UPDATE in tryRedeem prevents two simultaneous signups
    // from over-claiming the last slot of a capped code.
    //
    // If isValid passed but tryRedeem returns false, it means another signup
    // raced us and took the last slot. We've already created the user; rather
    // than orphan them, we let them through. This is intentional: the code
    // gate is signup-friction-prevention, not strict inventory control. For
    // strict caps, the cap should live wherever the cap is enforced (not signup).
    if (inviteCode && inviteCode !== envCode) {
      await inviteCodeQueries.tryRedeem(inviteCode, user.id).catch((err) => {
        // Log but don't fail the signup. Worst case: a missed redemption row.
        req.log.warn({ err: err.message, userId: user.id }, 'invite code redeem failed')
      })
    }

    const session = await sessionQueries.create(user.id)

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    }
  })

  // ── POST /auth/login ─────────────────────────────────────────────────────
  app.post<{ Body: { email?: string; password?: string } }>(
    '/auth/login',
    {
      config: {
        // Brute-force defence: 10 attempts per IP per 5 min. Real failed
        // logins (typos) recover within seconds; an attacker iterating
        // password lists hits the wall fast.
        rateLimit: { max: 10, timeWindow: '5 minutes' },
      },
    },
    async (req, reply) => {
      const email = (req.body.email || '').trim().toLowerCase()
      const password = req.body.password || ''

      // Always do an argon2 hash even if user doesn't exist — prevents timing
      // attacks that distinguish "user not found" from "wrong password".
      // The dummy hash is a precomputed argon2 of "dummy" so verification
      // takes ~the same time as a real check.
      const user = await userQueries.findByEmail(email)
      const hashToVerify = user?.passwordHash ?? (await getDummyHash())
      let valid = false
      try {
        valid = await argon2.verify(hashToVerify, password)
      } catch {
        valid = false
      }

      if (!user || !valid) {
        return reply.status(401).send({ error: 'Invalid email or password' })
      }

      const session = await sessionQueries.create(user.id)
      // Best-effort: clean expired sessions on every successful login so the
      // sessions table doesn't grow unbounded. Fire-and-forget.
      sessionQueries.cleanupExpired().catch(() => {})

      return {
        token: session.token,
        expiresAt: session.expiresAt,
        user: { id: user.id, email: user.email, createdAt: user.createdAt },
      }
    },
  )

  // ── POST /auth/logout ────────────────────────────────────────────────────
  // Revokes the session token in the header. No-op if no token — logout
  // should never fail loudly.
  app.post('/auth/logout', async (req) => {
    const token = extractToken(req.headers)
    if (token) await sessionQueries.revoke(token)
    return { ok: true }
  })

  // ── GET /auth/me ─────────────────────────────────────────────────────────
  // Returns the current user if the token is valid. Used by the dashboard to
  // verify the cached token on page load before showing the app shell.
  app.get('/auth/me', async (req, reply) => {
    const token = extractToken(req.headers)
    if (!token) return reply.status(401).send({ error: 'Not authenticated' })
    const session = await sessionQueries.findByToken(token)
    if (!session) return reply.status(401).send({ error: 'Session expired' })
    const user = await userQueries.findById(session.userId)
    if (!user) return reply.status(401).send({ error: 'User not found' })
    return {
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      expiresAt: session.expiresAt,
    }
  })

  // ── POST /auth/change-password ───────────────────────────────────────────
  // Authenticated route. Verifies the current password before accepting the
  // new one (so a stolen session can't just rewrite the user's password and
  // lock the real owner out). On success, ALL existing sessions for this
  // user are revoked except the current one — forces a re-login on other
  // devices and prevents an attacker who already stole a session from
  // keeping access if the real user changes their password.
  app.post<{
    Body: { currentPassword?: string; newPassword?: string }
  }>('/auth/change-password', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const token = extractToken(req.headers)
    if (!token) return reply.status(401).send({ error: 'Not authenticated' })
    const session = await sessionQueries.findByToken(token)
    if (!session) return reply.status(401).send({ error: 'Session expired' })
    const user = await userQueries.findById(session.userId)
    if (!user) return reply.status(401).send({ error: 'User not found' })

    const currentPassword = req.body.currentPassword || ''
    const newPassword = req.body.newPassword || ''

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({
        error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      })
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: 'New password is too long' })
    }

    let valid = false
    try {
      valid = await argon2.verify(user.passwordHash, currentPassword)
    } catch {
      valid = false
    }
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' })
    }

    const newHash = await argon2.hash(newPassword, ARGON2_CONFIG)
    await userQueries.updatePassword(user.id, newHash)

    // Revoke ALL sessions for this user (including the one being used now),
    // then create a fresh one. Other devices will need to log in again.
    await sessionQueries.revokeAllForUser(user.id)
    const fresh = await sessionQueries.create(user.id)

    return { ok: true, token: fresh.token, expiresAt: fresh.expiresAt }
  })

  // ── DELETE /auth/account ─────────────────────────────────────────────────
  // Fully delete the user's account and all associated data. The user must
  // re-enter their password as confirmation (so a stolen session can't be
  // used to nuke the real user's data). CASCADE on user_id FKs handles the
  // dependent rows — bowls, accounts, messages, sessions, agent_keys all
  // go with it. IMAP connections are torn down explicitly so we don't
  // leak open sockets after delete.
  app.delete<{
    Body: { password?: string }
  }>('/auth/account', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const token = extractToken(req.headers)
    if (!token) return reply.status(401).send({ error: 'Not authenticated' })
    const session = await sessionQueries.findByToken(token)
    if (!session) return reply.status(401).send({ error: 'Session expired' })
    const user = await userQueries.findById(session.userId)
    if (!user) return reply.status(401).send({ error: 'User not found' })

    const password = req.body.password || ''
    let valid = false
    try {
      valid = await argon2.verify(user.passwordHash, password)
    } catch {
      valid = false
    }
    if (!valid) {
      return reply.status(401).send({ error: 'Password is incorrect' })
    }

    // Tear down any IMAP connections for this user's accounts before deleting
    // the rows; otherwise the connections leak (in-memory map keeps them open).
    const { accountQueries } = await import('../db/index.js')
    const accounts = await accountQueries.getAllForUser(user.id)
    if (accounts.length > 0) {
      const { disconnectAccount } = await import('../imap/connection.js')
      for (const account of accounts) {
        await disconnectAccount(account.id).catch(() => {})
      }
    }

    // CASCADE handles all dependent rows.
    await userQueries.delete(user.id)

    return { ok: true }
  })

  // ── POST /auth/forgot-password ───────────────────────────────────────────
  // Public. Always returns { ok: true } regardless of whether the email is
  // registered — anything else is an account-enumeration oracle. If the
  // account exists and system mail is configured, a single-use reset link
  // (60 minute TTL) is emailed. Only the SHA-256 hash of the token is
  // stored; the raw token exists solely in the email.
  app.post<{ Body: { email?: string } }>('/auth/forgot-password', {
    config: {
      // 3 per 15 minutes per IP. A real user clicks this once, maybe twice.
      // The per-user token replacement in passwordResetQueries.create means
      // hammering it can't stack up live links anyway.
      rateLimit: { max: 3, timeWindow: '15 minutes' },
    },
  }, async (req) => {
    const email = (req.body.email || '').trim().toLowerCase()
    if (!isValidEmail(email)) return { ok: true }

    const user = await userQueries.findByEmail(email)
    if (!user) return { ok: true }

    if (!isSystemMailConfigured()) {
      // Operator misconfiguration, not a user error. Log loudly, still
      // return ok — the response must not reveal server config.
      req.log.error('forgot-password requested but SYSTEM_SMTP_* / MAIL_FROM env vars are not set — no email sent')
      return { ok: true }
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + 60 * 60 * 1000
    await passwordResetQueries.create(user.id, sha256Hex(token), expiresAt)

    const dashboardBase = (process.env.DASHBOARD_BASE || 'http://localhost:5173').replace(/\/$/, '')
    const link = `${dashboardBase}/?reset_token=${token}`

    try {
      await sendSystemEmail({
        to: user.email,
        subject: 'Reset your Cereal password',
        text: [
          'Someone requested a password reset for this Cereal account.',
          '',
          `Reset your password: ${link}`,
          '',
          'The link works once and expires in 60 minutes.',
          "If you didn't request this, you can ignore this email — your password is unchanged.",
        ].join('\n'),
        html: [
          '<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.6;">',
          '<p>Someone requested a password reset for this Cereal account.</p>',
          `<p><a href="${link}" style="display: inline-block; padding: 10px 18px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px;">Reset your password</a></p>`,
          `<p style="color: #666; font-size: 13px;">Or paste this link into your browser:<br>${link}</p>`,
          '<p style="color: #666; font-size: 13px;">The link works once and expires in 60 minutes. If you didn\'t request this, ignore this email — your password is unchanged.</p>',
          '</div>',
        ].join('\n'),
      })
    } catch (err: any) {
      req.log.error({ err: err.message }, 'forgot-password email send failed')
    }

    return { ok: true }
  })

  // ── POST /auth/reset-password ────────────────────────────────────────────
  // Public. Consumes a reset token and sets a new password. On success, ALL
  // sessions for the user are revoked — same posture as change-password: if
  // the reset was triggered because of a suspected compromise, any session
  // an attacker holds dies with it. The user logs in fresh.
  app.post<{ Body: { token?: string; newPassword?: string } }>('/auth/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const token = (req.body.token || '').trim()
    const newPassword = req.body.newPassword || ''

    if (!token) {
      return reply.status(400).send({ error: 'Reset token is missing' })
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      })
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: 'Password is too long' })
    }

    const tokenHash = sha256Hex(token)
    const entry = await passwordResetQueries.findValid(tokenHash)
    if (!entry) {
      return reply.status(400).send({
        error: 'This reset link is invalid or has expired. Request a new one.',
      })
    }

    const newHash = await argon2.hash(newPassword, ARGON2_CONFIG)
    await userQueries.updatePassword(entry.userId, newHash)
    await passwordResetQueries.markUsed(tokenHash)
    await sessionQueries.revokeAllForUser(entry.userId)

    return { ok: true }
  })
}

/**
 * Pre-computed argon2 hash used in the login flow to perform a constant-time
 * check even when the user doesn't exist — prevents timing-based user
 * enumeration. The actual password these bytes hash is irrelevant; what
 * matters is that argon2.verify takes the same time whether it succeeds or
 * fails. We compute it lazily on first use so the cost isn't paid at boot.
 */
let dummyHashCache: string | null = null
async function getDummyHash(): Promise<string> {
  if (!dummyHashCache) {
    dummyHashCache = await argon2.hash('timing-attack-mitigation-dummy', ARGON2_CONFIG)
  }
  return dummyHashCache
}

export function extractToken(headers: any): string | null {
  const direct = headers['x-session-token']
  if (typeof direct === 'string' && direct.length > 0) return direct
  const auth = headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7)
  }
  return null
}
