import Fastify from 'fastify'
import * as Sentry from '@sentry/node'
import type { FastifyRequest } from 'fastify'
import { randomBytes } from 'crypto'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { registerRoutes } from './routes.js'
import { registerClient, unregisterClient } from './ws.js'
import { registerAuthRoutes, extractToken } from './auth-routes.js'
import { registerOAuthRoutes } from '../oauth/routes.js'
import { sessionQueries } from '../db/index.js'

/**
 * Routes that don't require authentication. Each entry is an exact
 * (method, pathname) match — no prefix matching, no substring checks, no
 * query-string trickery. The previous version used startsWith() and
 * includes() which let URLs like `/oauth/x/callback/anything` slip in;
 * exact-match closes that.
 */
const PUBLIC_ROUTES = new Set<string>([
  'GET /status',
  'POST /waitlist',
  'POST /auth/signup',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'GET /auth/me',
  'POST /agent/inbound',
])

function isPublicRoute(req: FastifyRequest): boolean {
  // Strip query string before matching.
  const pathname = req.url.split('?')[0]
  // WebSocket handshake — only the exact /ws path.
  if (req.method === 'GET' && pathname === '/ws') return true
  // OAuth callbacks — only /oauth/<provider>/callback with nothing after.
  if (req.method === 'GET' && /^\/oauth\/[a-z]+\/callback$/.test(pathname)) return true
  return PUBLIC_ROUTES.has(`${req.method} ${pathname}`)
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
  }
}

// ── WebSocket ticket store ─────────────────────────────────────────────────
// In-memory single-use tickets that the dashboard exchanges its session token
// for, then sends in the /ws URL. Short TTL means even a leaked access log
// is useless; in-memory means there's no DB hit on every WS connect.
const WS_TICKET_TTL_MS = 10_000
interface WsTicketEntry { userId: string; expiresAt: number }
const wsTickets = new Map<string, WsTicketEntry>()

function issueWsTicket(userId: string): string {
  const ticket = randomBytes(16).toString('base64url')
  wsTickets.set(ticket, { userId, expiresAt: Date.now() + WS_TICKET_TTL_MS })
  return ticket
}

function consumeWsTicket(ticket: string): string | null {
  const entry = wsTickets.get(ticket)
  if (!entry) return null
  wsTickets.delete(ticket) // single use
  if (Date.now() > entry.expiresAt) return null
  return entry.userId
}

// Periodic cleanup so expired tickets don't accumulate if never claimed.
setInterval(() => {
  const now = Date.now()
  for (const [ticket, entry] of wsTickets) {
    if (now > entry.expiresAt) wsTickets.delete(ticket)
  }
}, 60_000).unref?.()

// Allowed origins for CORS. Pinned to the dashboard's production host, the
// marketing site (for waitlist signup), and local dev. The previous
// `origin: true` echoed any origin which was overly permissive.
//
// Configure via env vars in your deploy environment:
//   DASHBOARD_BASE = https://app.cereal.run
//   SITE_BASE      = https://cereal.run
// Both are optional but if you're running in production you want them both
// set, or the dashboard / marketing site will 'Failed to fetch'.
function buildAllowedOrigins(): string[] {
  const origins = new Set<string>([
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
  ])
  const dashboardBase = process.env.DASHBOARD_BASE
  const siteBase = process.env.SITE_BASE
  if (dashboardBase) origins.add(dashboardBase.replace(/\/$/, ''))
  if (siteBase) origins.add(siteBase.replace(/\/$/, ''))
  return [...origins]
}

export async function createServer(apiKey: string, port: number): Promise<void> {
  const app = Fastify({
    logger: { level: 'warn' },
    // Cap incoming JSON bodies at 256KB. The largest legitimate payload is a
    // reply body with quoted history — comfortably under that. Anything
    // bigger is either abuse or a bug.
    bodyLimit: 256 * 1024,
    // Proxy trust is OPT-IN for self-hosted deployments. If you run Cereal
    // behind a reverse proxy or CDN (nginx, Caddy, Cloudflare, a PaaS like
    // Render or Fly), set TRUST_PROXY=true so Fastify reads the real client
    // IP from X-Forwarded-For — otherwise rate limiting buckets everyone
    // into the proxy's IP and never trips.
    //
    // If your Node process is exposed directly to the internet, leave it
    // unset: with trustProxy on and no proxy in front, any client can spoof
    // X-Forwarded-For and walk past every per-IP rate limit, including the
    // login brute-force protection.
    trustProxy: process.env.TRUST_PROXY === 'true',
  })

  // Single error handler: log the real error server-side, return generic
  // text to the client. Without this, Fastify's default exposes raw error
  // messages (DB constraint names, stack snippets) on 5xx.
  app.setErrorHandler((err, req, reply) => {
    const statusCode = err.statusCode ?? 500
    if (statusCode >= 500) {
      console.error(`[error] ${req.method} ${req.url}:`, err.message, err.stack)
      // Report to Sentry when configured. captureException is a no-op if
      // Sentry.init was never called (no SENTRY_DSN), so this is safe in
      // deployments without it. Route + method give enough context to
      // reproduce; no request body or headers are attached (they can
      // contain passwords and session tokens).
      Sentry.captureException(err, { tags: { route: `${req.method} ${req.url.split('?')[0]}` } })
      return reply.status(statusCode).send({ error: 'Internal server error' })
    }
    // 4xx errors (validation, etc.) pass through with their own message.
    return reply.status(statusCode).send({ error: err.message })
  })

  const allowedOrigins = buildAllowedOrigins()
  console.log(`[cors] Allowed origins: ${allowedOrigins.join(', ')}`)
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser requests (curl, server-to-server agent inbound) have no
      // Origin header — allow them. Browser requests must match the list.
      if (!origin) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      // Log the rejection so the cause is obvious in your deploy logs.
      // (Otherwise you get "Failed to fetch" in the browser with no
      // server-side trail.)
      console.warn(`[cors] Rejected origin: ${origin}`)
      return cb(new Error('Origin not allowed'), false)
    },
    allowedHeaders: ['Content-Type', 'x-session-token', 'Authorization', 'x-api-key', 'x-agent-key'],
  })

  // Global rate limiter — applied only to specific routes via the `config`
  // on each handler. The global default here is generous; individual routes
  // tighten it. See auth-routes and waitlist for the strict limits.
  await app.register(rateLimit, {
    global: false, // opt-in per route
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(websocket)

  // ── Auth middleware ──────────────────────────────────────────────────────
  // Every authenticated route requires a valid session token. The token is
  // sent in either:
  //   x-session-token: <token>
  //   Authorization: Bearer <token>
  // On success, req.userId is attached for downstream route handlers.
  app.addHook('preHandler', async (req, reply) => {
    if (isPublicRoute(req)) return

    const token = extractToken(req.headers)
    if (!token) {
      return reply.status(401).send({ error: 'Authentication required' })
    }
    const session = await sessionQueries.findByToken(token)
    if (!session) {
      return reply.status(401).send({ error: 'Session expired' })
    }
    req.userId = session.userId
  })

  // ── WebSocket ticket endpoint ────────────────────────────────────────────
  // The browser WebSocket API doesn't support custom headers on the
  // handshake, so the auth credential has to go in the URL. URLs end up in
  // access logs (proxy and CDN layers). To avoid the long-lived session token
  // appearing there, the dashboard exchanges its session token for a
  // single-use, 10-second-TTL "ticket" — that ticket is what goes in the
  // /ws URL. Worst case if the access log leaks: an attacker gets a string
  // that expired 10 seconds after it was issued and is already consumed.
  app.post('/ws-ticket', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const ticket = issueWsTicket(req.userId)
    return { ticket, expiresIn: WS_TICKET_TTL_MS / 1000 }
  })

  // ── WebSocket endpoint ───────────────────────────────────────────────────
  // Auth: ticket only, exchanged via POST /ws-ticket above. The dashboard
  // calls /ws-ticket with its session token, gets a single-use 10-second
  // ticket back, then uses ?ticket=... on the WS URL. Worst case if the
  // access log leaks: a string that expired 10 seconds after it was issued
  // and is already consumed.
  app.get('/ws', { websocket: true }, async (socket, req: any) => {
    const ticket = (req.query?.ticket || '') as string
    const userId = ticket ? consumeWsTicket(ticket) : null
    if (!userId) {
      socket.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }))
      socket.close()
      return
    }
    registerClient(socket, userId)
    socket.on('close', () => unregisterClient(socket))
    socket.on('error', () => unregisterClient(socket))
    socket.send(JSON.stringify({ type: 'connected' }))
  })

  // ── REST routes ──────────────────────────────────────────────────────────
  await registerAuthRoutes(app)
  await registerRoutes(app)
  await registerOAuthRoutes(app)

  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[api] Server running on http://localhost:${port}`)
}
