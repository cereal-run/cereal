import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import { randomBytes } from 'crypto'
import { isIP } from 'net'
import {
  bowlQueries, accountQueries, messageQueries,
  folderQueries, agentQueries, agentKeyQueries, waitlistQueries
} from '../db/index.js'
import { sendEmail, buildReplyHtml } from '../smtp/send.js'
import { fetchBody, markSeenOnServer, getConnection, syncInbox } from '../imap/connection.js'
import { broadcast } from './ws.js'
import type { SendPayload, AgentMessage, Account, Bowl } from '../types.js'

/**
 * Reject user-supplied IMAP/SMTP hosts that point at internal infrastructure.
 * Without this, a user could submit imapHost="169.254.169.254" (cloud
 * metadata endpoint) or "10.0.0.1" (internal network) and the backend would
 * dutifully try to connect, potentially exposing internal services.
 *
 * Returns null if the host is acceptable, or an error string if blocked.
 * Doesn't resolve DNS — that would race with the connection itself. We only
 * block hosts that are syntactically problematic. A determined attacker
 * could still point a public DNS name at an internal IP, but most cloud
 * providers handle that at the network layer.
 */
function validateExternalHost(host: string | undefined | null): string | null {
  if (!host) return null // upstream will handle empty
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return 'Host is required'
  if (trimmed.length > 253) return 'Host name too long'

  // Reject hostnames that contain obvious-internal markers regardless of IP
  // form. localhost, *.local, *.internal, *.lan all unambiguously target
  // internal infra.
  if (trimmed === 'localhost') return 'Internal hosts are not allowed'
  if (/\.(local|internal|lan|home|corp|intranet)$/.test(trimmed)) {
    return 'Internal hosts are not allowed'
  }

  // If it's a literal IP, block private/reserved ranges.
  const ipVersion = isIP(trimmed)
  if (ipVersion === 4) {
    const parts = trimmed.split('.').map(Number)
    if (parts[0] === 10) return 'Private network hosts are not allowed'
    if (parts[0] === 127) return 'Loopback hosts are not allowed'
    if (parts[0] === 169 && parts[1] === 254) return 'Link-local hosts are not allowed' // includes 169.254.169.254 cloud metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'Private network hosts are not allowed'
    if (parts[0] === 192 && parts[1] === 168) return 'Private network hosts are not allowed'
    if (parts[0] === 0) return 'Reserved hosts are not allowed'
    if (parts[0] >= 224) return 'Reserved hosts are not allowed' // multicast + reserved
  } else if (ipVersion === 6) {
    // Block loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
    // and the IPv4-mapped equivalents of the above.
    if (trimmed === '::1' || trimmed === '::') return 'Loopback hosts are not allowed'
    if (trimmed.startsWith('fe8') || trimmed.startsWith('fe9') || trimmed.startsWith('fea') || trimmed.startsWith('feb')) {
      return 'Link-local hosts are not allowed'
    }
    if (trimmed.startsWith('fc') || trimmed.startsWith('fd')) {
      return 'Private network hosts are not allowed'
    }
    if (trimmed.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — validate the IPv4 part recursively
      const v4 = trimmed.slice(7)
      return validateExternalHost(v4)
    }
  }
  return null
}

// Bowl input limits. These cap obvious abuse vectors (megabyte-long bowl
// names, address lists with thousands of entries) without restricting real
// usage. A user has at most a few dozen send-as identities per business.
const MAX_BOWL_NAME = 100
const MAX_ADDRESS_LEN = 254 // RFC 5321 max email length
const MAX_ADDRESSES_PER_BOWL = 50
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

function validateBowlInput(input: {
  name?: string; color?: string; defaultFrom?: string | null; addresses?: string[]
}): string | null {
  if (input.name !== undefined) {
    if (input.name.length > MAX_BOWL_NAME) return `Bowl name must be ${MAX_BOWL_NAME} characters or fewer`
  }
  if (input.color !== undefined && input.color) {
    if (!COLOR_RE.test(input.color)) return 'Bowl color must be a hex value like #4a90e2'
  }
  if (input.defaultFrom !== undefined && input.defaultFrom) {
    if (input.defaultFrom.length > MAX_ADDRESS_LEN) return 'Default From address is too long'
  }
  if (input.addresses !== undefined) {
    if (input.addresses.length > MAX_ADDRESSES_PER_BOWL) {
      return `A bowl can have at most ${MAX_ADDRESSES_PER_BOWL} addresses`
    }
    for (const addr of input.addresses) {
      if (typeof addr !== 'string' || addr.length === 0 || addr.length > MAX_ADDRESS_LEN) {
        return 'One of the addresses is invalid'
      }
    }
  }
  return null
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /waitlist — public, no auth ─────────────────────────────────────────
  app.post<{ Body: { email: string; source?: string } }>(
    '/waitlist',
    {
      config: {
        // Generous limit but enough to block someone scripting in tens of
        // thousands of fake emails. 10/min/IP is more than any real user
        // pattern.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const email = req.body?.email?.trim()
      if (!email || !email.includes('@') || !email.includes('.')) {
        return reply.code(400).send({ ok: false, error: 'Valid email required.' })
      }
      const result = await waitlistQueries.add(nanoid(), email, req.body.source)
      return reply.code(200).send({
        ok: true,
        status: result, // 'added' or 'exists'
      })
    }
  )

  // GET /waitlist removed — used to expose every signup email to any
  // authenticated user. To inspect the waitlist, query the DB directly.

  // ── GET /bowls — all bowls with unread counts ───────────────────────────────
  app.get('/bowls', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const bowls = await bowlQueries.getAll(req.userId)
    return bowls.map(bowl => ({
      ...bowl,
      unreadCount: messageQueries.getUnreadCount(bowl.id, req.userId!),
    }))
  })

  // ── GET /bowls/:bowlId/messages — paginated inbox ───────────────────────────
  app.get<{
    Params: { bowlId: string }
    Querystring: { limit?: string; offset?: string; unreadOnly?: string }
  }>('/bowls/:bowlId/messages', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { bowlId } = req.params
    const limit = parseInt(req.query.limit ?? '50')
    const offset = parseInt(req.query.offset ?? '0')
    const unreadOnly = req.query.unreadOnly === 'true'

    const bowl = await bowlQueries.getById(bowlId, req.userId)
    if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })

    const messages = unreadOnly
      ? await messageQueries.getByBowlUnread(bowlId, req.userId)
      : await messageQueries.getByBowl(bowlId, req.userId, limit, offset)

    return { messages, total: messages.length }
  })

  // ── GET /bowls/:bowlId/messages/search ─────────────────────────────────────
  app.get<{
    Params: { bowlId: string }
    Querystring: { q: string }
  }>('/bowls/:bowlId/messages/search', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { bowlId } = req.params
    const { q } = req.query
    if (!q || q.length < 2) return reply.status(400).send({ error: 'Query too short' })

    return { messages: await messageQueries.search(bowlId, req.userId, q) }
  })

  // ── GET /search — global search across all bowls ───────────────────────────
  app.get<{ Querystring: { q: string; limit?: string } }>('/search', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { q } = req.query
    const limit = Math.min(Number(req.query.limit ?? 30), 100)
    if (!q || q.length < 2) return reply.status(400).send({ error: 'Query too short' })

    const results = await messageQueries.searchAll(req.userId, q, limit)
    return { messages: results, query: q }
  })

  // ── GET /messages/:messageId/body — fetch body on demand ───────────────────
  app.get<{ Params: { messageId: string } }>(
    '/messages/:messageId/body', async (req, reply) => {
      // messageId here is our internal ID (not IMAP UID)
      // We need to find the message to get account + folder + uid
      // For now, the client must pass accountId + folderId + uid as query
      return reply.status(501).send({ error: 'Use /accounts/:id/messages/:uid/body' })
    }
  )

  app.get<{
    Params: { accountId: string; uid: string }
    Querystring: { folder?: string }
  }>('/accounts/:accountId/messages/:uid/body', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const account = await accountQueries.getById(req.params.accountId, req.userId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const uid = parseInt(req.params.uid)
    const folder = req.query.folder ?? 'INBOX'

    const body = await fetchBody(account, folder, uid)
    if (!body) return reply.status(404).send({ error: 'Message not found or not connected' })

    return body
  })

  // ── POST /messages/seen ─────────────────────────────────────────────────────
  app.post<{
    Body: { accountId: string; uids: number[]; folder?: string }
  }>('/messages/seen', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { accountId, uids, folder = 'INBOX' } = req.body
    const account = await accountQueries.getById(accountId, req.userId)
    if (!account) return { ok: false }

    // Mark on IMAP server + local DB
    await markSeenOnServer(account, folder, uids)
    return { ok: true }
  })

  // ── POST /messages/unseen ──────────────────────────────────────────────────
  app.post<{
    Body: { accountId: string; uids: number[]; folder?: string }
  }>('/messages/unseen', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { accountId, uids, folder = 'INBOX' } = req.body
    const account = await accountQueries.getById(accountId, req.userId)
    if (!account) return { ok: false }

    const { markUnseenOnServer } = await import('../imap/connection.js')
    await markUnseenOnServer(account, folder, uids)
    return { ok: true }
  })

  // ── POST /send — compose + send ─────────────────────────────────────────────
  app.post<{ Body: SendPayload }>('/send', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const payload = req.body
    const account = await accountQueries.getById(payload.accountId, req.userId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    try {
      const result = await sendEmail(account, payload)
      return { ok: true, messageId: result.messageId }
    } catch (err: any) {
      console.error('[send] Failed:', err.message, { accountId: payload.accountId, smtpHost: account.smtpHost, smtpPort: account.smtpPort, smtpSecure: account.smtpSecure })

      // Translate SMTP errors to human-readable messages
      const msg = err.message?.toLowerCase() ?? ''
      let human = err.message

      if (msg.includes('not permitted') || msg.includes('not allowed') || msg.includes('sender verify') || msg.includes('must be verified') || msg.includes('mail from') || msg.includes('sender rejected')) {
        const fromAddr = payload.from || account.defaultFrom
        human = `Your email provider won't let you send as "${fromAddr}". You need to verify this address in your provider's settings (Fastmail: Settings > Sending Identities, Gmail: Settings > Accounts, Outlook: account settings).`
      } else if (msg.includes('auth') || msg.includes('credentials') || msg.includes('login')) {
        human = 'Authentication failed. Check your app password.'
      } else if (msg.includes('connect') || msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
        human = `Could not connect to ${account.smtpHost}:${account.smtpPort}. Check your SMTP settings.`
      }

      return reply.status(500).send({ error: human })
    }
  })

  // ── POST /send/reply — reply with quoted block ──────────────────────────────
  app.post<{
    Body: {
      accountId: string
      to: Array<{ name: string | null; email: string }>
      subject: string
      replyBody: string
      originalFrom: string
      originalDate: string
      originalSubject: string
      originalBodyHtml: string
      inReplyTo: string
      references: string[]
    }
  }>('/send/reply', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const body = req.body
    const account = await accountQueries.getById(body.accountId, req.userId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const html = buildReplyHtml({
      replyBody: body.replyBody,
      originalFrom: body.originalFrom,
      originalDate: new Date(body.originalDate),
      originalSubject: body.originalSubject,
      originalBody: body.originalBodyHtml,
    })

    try {
      const result = await sendEmail(account, {
        accountId: body.accountId,
        to: body.to,
        subject: body.subject.startsWith('Re:') ? body.subject : `Re: ${body.subject}`,
        textHtml: html,
        inReplyTo: body.inReplyTo,
        references: body.references,
      })
      return { ok: true, messageId: result.messageId }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // ── GET /compose/context/:bowlId — pre-fill compose window ─────────────────
  app.get<{ Params: { bowlId: string } }>(
    '/compose/context/:bowlId', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const bowl = await bowlQueries.getById(req.params.bowlId, req.userId)
      if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })

      // ALL of the user's accounts are available for sending — a single
      // Fastmail account can serve multiple bowls via send-as identities.
      const accounts = await accountQueries.getAllForUser(req.userId)

      // Available From addresses for this bowl:
      // 1. The bowl's own registered addresses (preferred — these are the send-as identities)
      // 2. Plus any account-level aliases as fallback
      const bowlAddresses = bowl.addresses.length > 0
        ? bowl.addresses
        : accounts.flatMap(a => [a.defaultFrom, ...a.aliases])

      const suggestedFrom = bowl.defaultFrom ?? bowlAddresses[0] ?? (accounts[0]?.defaultFrom ?? '')

      return {
        bowlId: req.params.bowlId,
        suggestedFrom,
        availableFrom: bowlAddresses,
        accounts: accounts.map(a => ({
          id: a.id,
          label: a.label,
          defaultFrom: a.defaultFrom,
          aliases: a.aliases,
        })),
      }
    }
  )

  // ── POST /sync/:accountId — trigger manual sync ─────────────────────────────
  app.post<{ Params: { accountId: string } }>(
    '/sync/:accountId', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const account = await accountQueries.getById(req.params.accountId, req.userId)
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const client = getConnection(account.id)
      if (!client) return reply.status(503).send({ error: 'Account not connected' })

      // Scope the broadcast to this user so sync events don't leak.
      const count = await syncInbox(account, client, (ev) => broadcast(ev, req.userId))
      return { ok: true, synced: count }
    }
  )

  // ── POST /bowls/:bowlId/resync — sync all accounts feeding this bowl ────────
  // Powers the dashboard's per-bowl refresh button. Syncs every account
  // attached to the bowl, then returns once done. New messages stream in
  // via WebSocket 'new_message' events scoped to this user.
  app.post<{ Params: { bowlId: string } }>(
    '/bowls/:bowlId/resync', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const bowl = await bowlQueries.getById(req.params.bowlId, req.userId)
      if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })

      // Accounts aren't tied to bowls — any of the user's mailboxes could
      // carry mail addressed to this bowl. Sync all connected accounts;
      // address routing decides what actually lands in this bowl. New mail
      // streams back via WS 'new_message' events scoped to this user.
      const accounts = await accountQueries.getAllForUser(req.userId)
      let synced = 0
      let anyConnected = false
      for (const account of accounts) {
        const client = getConnection(account.id)
        if (!client) continue
        anyConnected = true
        try {
          synced += await syncInbox(account, client, (ev) => broadcast(ev, req.userId))
        } catch (err: any) {
          console.error(`[resync] bowl=${bowl.id} account=${account.id} failed:`, err.message)
        }
      }

      if (accounts.length > 0 && !anyConnected) {
        return reply.status(503).send({ error: 'No connected mailboxes — reconnect an account to sync' })
      }
      return { ok: true, synced }
    }
  )

  // ── GET /agent/messages — agent channel ─────────────────────────────────────
  app.get<{ Querystring: { bowlId?: string; limit?: string } }>(
    '/agent/messages', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const bowlId = req.query.bowlId ?? null
      const limit = parseInt(req.query.limit ?? '50')
      return { messages: await agentQueries.getByBowl(bowlId, req.userId, limit) }
    }
  )

  app.get('/agent/decisions/pending', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    return { decisions: await agentQueries.getPendingDecisions(req.userId) }
  })

  // ── POST /agent/inbound — external agents post messages here ───────────────
  // Uses X-Agent-Key header for auth (separate from dashboard session). The
  // agent key is tied to a specific user; everything below is scoped to that
  // user's bowls and accounts.
  app.post<{
    Headers: { 'x-agent-key'?: string }
    Body: {
      content: string
      type?: 'text' | 'notification' | 'decision'
      bowlId?: string
      options?: string[]
      agentId?: string
    }
  }>('/agent/inbound', {
    config: {
      // 60/min/IP — generous for legitimate agents but a hard cap on flood.
      // The auth check below catches bad keys; this catches DOS by a holder
      // of one valid key, or just by IPs hammering with bad keys.
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    const key = req.headers['x-agent-key']
    if (!key) return reply.status(401).send({ error: 'Missing X-Agent-Key header' })

    const auth = await agentKeyQueries.findByKey(key)
    if (!auth) return reply.status(401).send({ error: 'Invalid agent key' })

    if (!req.body.content?.trim()) {
      return reply.status(400).send({ error: 'content is required' })
    }

    // Resolve target bowl. Explicit bowlId always wins (must belong to the
    // agent key's user). Otherwise, route to the user's agent bowl. Don't
    // fall back to "any bowl" — that historically dumped agent chatter into
    // a user's real business inboxes. Agent setup is opt-in via Settings.
    let bowlId = req.body.bowlId ?? null
    if (bowlId) {
      const bowl = await bowlQueries.getById(bowlId, auth.userId)
      if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })
    } else {
      const agentBowl = await bowlQueries.findAgent(auth.userId)
      if (!agentBowl) {
        return reply.status(404).send({
          error: 'No agent bowl configured. Set one up in Settings, or pass an explicit bowlId.',
        })
      }
      bowlId = agentBowl.id
    }

    const msg: AgentMessage = {
      id: nanoid(),
      agentId: req.body.agentId ?? auth.agentId,
      bowlId,
      direction: 'agent_to_human',
      type: req.body.type ?? 'text',
      content: req.body.content,
      options: req.body.options,
      resolved: false,
      createdAt: Date.now(),
    }

    await agentQueries.insert(msg)
    // Broadcast only to the owning user's WS connections (scoped broadcast).
    broadcast({ type: 'agent_message', payload: msg }, auth.userId)

    return { ok: true, id: msg.id }
  })

  // ── GET /agent/keys — list this user's agent API keys ─────────────────────
  app.get('/agent/keys', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const keys = await agentKeyQueries.list(req.userId)
    return { keys }
  })

  // ── POST /agent/keys — create a new agent API key ──────────────────────────
  app.post<{
    Body: { label: string; agentId?: string }
  }>('/agent/keys', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    if (!req.body.label?.trim()) {
      return reply.status(400).send({ error: 'Label is required' })
    }
    const label = req.body.label.trim()
    const agentId = (req.body.agentId ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || 'agent'
    const key = `cereal_${randomBytes(32).toString('base64url')}`
    const result = await agentKeyQueries.create(label, agentId, key, req.userId)
    return { ok: true, id: result.id, key, label, agentId }
  })

  // ── DELETE /agent/keys/:id — revoke an agent API key ───────────────────────
  app.delete<{ Params: { id: string } }>('/agent/keys/:id', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    await agentKeyQueries.delete(req.params.id, req.userId)
    return { ok: true }
  })

  // ── POST /agent/messages — receive message from agent ───────────────────────
  app.post<{
    Body: {
      agentId: string
      bowlId?: string
      type: AgentMessage['type']
      content: string
      options?: string[]
      relatedMessageId?: string
    }
  }>('/agent/messages', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    // Verify bowl belongs to this user before inserting
    if (req.body.bowlId) {
      const bowl = await bowlQueries.getById(req.body.bowlId, req.userId)
      if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })
    }
    const msg: AgentMessage = {
      id: nanoid(),
      agentId: req.body.agentId,
      bowlId: req.body.bowlId ?? null,
      direction: 'agent_to_human',
      type: req.body.type,
      content: req.body.content,
      options: req.body.options,
      relatedMessageId: req.body.relatedMessageId,
      resolved: false,
      createdAt: Date.now(),
    }

    await agentQueries.insert(msg)
    broadcast({ type: 'agent_message', payload: msg }, req.userId)

    return { ok: true, id: msg.id }
  })

  // ── POST /agent/messages/:id/resolve — human responds to decision ───────────
  app.post<{
    Params: { id: string }
    Body: { resolution: string }
  }>('/agent/messages/:id/resolve', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    // resolve() is scoped to the user's bowls; if the message doesn't belong
    // to this user, the update affects zero rows (silent no-op, safe).
    await agentQueries.resolve(req.params.id, req.userId, req.body.resolution)
    return { ok: true }
  })

  // ── POST /human/messages — human sends to agent ─────────────────────────────
  app.post<{
    Body: { agentId: string; bowlId?: string; content: string }
  }>('/human/messages', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    if (req.body.bowlId) {
      const bowl = await bowlQueries.getById(req.body.bowlId, req.userId)
      if (!bowl) return reply.status(404).send({ error: 'Bowl not found' })
    }
    const msg: AgentMessage = {
      id: nanoid(),
      agentId: req.body.agentId,
      bowlId: req.body.bowlId ?? null,
      direction: 'human_to_agent',
      type: 'text',
      content: req.body.content,
      createdAt: Date.now(),
    }

    await agentQueries.insert(msg)
    broadcast({ type: 'agent_message', payload: msg }, req.userId)

    return { ok: true, id: msg.id }
  })

  // ── GET /status — health check (public, no per-user info) ──────────────────
  app.get('/status', async (_req, reply) => {
    // Public health endpoint. Returns only liveness — nothing that could
    // reveal who's signed up or what they've connected.
    return reply.code(200).send({ ok: true })
  })

  // ── GET /accounts — list this user's connected accounts ───────────────────
  app.get('/accounts', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const accounts = await accountQueries.getAllForUser(req.userId)
    return {
      accounts: accounts.map(a => ({
        id: a.id,
        label: a.label,
        username: a.username,
        defaultFrom: a.defaultFrom,
        provider: a.provider,
        authType: a.authType,
        connected: Boolean(getConnection(a.id)),
      })),
    }
  })

  // ── POST /onboarding/test — test IMAP connection without saving ───────────────
  app.post<{
    Body: {
      provider: string
      username: string
      password: string
      imapHost?: string
      imapPort?: number
    }
  }>('/onboarding/test', async (req, reply) => {
    const { provider, username, password, imapHost, imapPort } = req.body

    if (!username || !password) {
      return reply.status(400).send({ ok: false, error: 'Email and password are required.' })
    }

    // Resolve IMAP settings
    const { resolveAccountSettings } = await import('../config/providers.js')
    const settings = resolveAccountSettings(provider as any, username, {
      imapHost,
      imapPort,
    })

    if (!settings.imapHost) {
      return reply.status(400).send({
        ok: false,
        error: 'Could not determine IMAP server. Please enter your IMAP host manually.',
      })
    }

    const hostError = validateExternalHost(settings.imapHost)
    if (hostError) {
      return reply.status(400).send({ ok: false, error: hostError })
    }

    // Try connecting
    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: settings.imapHost,
      port: settings.imapPort,
      secure: settings.imapSecure,
      auth: { user: username, pass: password },
      logger: false,
    })

    try {
      await client.connect()
      await client.logout()
      return { ok: true }
    } catch (err: any) {
      // Translate IMAP errors into human language
      const msg = err.message ?? ''
      let human = 'Could not connect. Check your email and password and try again.'

      if (msg.includes('Invalid credentials') || msg.includes('AUTHENTICATIONFAILED') || msg.includes('auth')) {
        if (provider === 'gmail' || provider === 'google_workspace') {
          human = 'Wrong password. Gmail requires an App Password — not your regular password. Go to myaccount.google.com → Security → App Passwords to generate one.'
        } else if (provider === 'imap' && username.includes('fastmail')) {
          human = 'Wrong password. Fastmail requires an App Password. Go to Settings → Privacy & Security → App Passwords to generate one.'
        } else if (provider === 'outlook') {
          human = 'Wrong password. Outlook requires an App Password if you have two-factor authentication enabled. Go to account.microsoft.com → Security → App Passwords.'
        } else {
          human = 'Wrong email or password. Double-check your credentials and try again.'
        }
      } else if (msg.includes('IMAP access is disabled') || msg.includes('not enabled')) {
        human = 'IMAP is disabled on this account. Enable it in your email provider settings and try again.'
      } else if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('timeout')) {
        human = 'Could not reach the mail server. Check your internet connection and try again.'
      } else if (msg.includes('certificate') || msg.includes('SSL')) {
        human = 'Secure connection failed. Try again or contact support.'
      }

      return reply.status(400).send({ ok: false, error: human })
    }
  })

  // ── POST /bowls — create a new bowl ──────────────────────────────────────────
  app.post<{
    Body: { name: string; color: string; isSpam?: boolean; isInbox?: boolean; defaultFrom?: string; addresses?: string[] }
  }>('/bowls', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { name, color, isSpam = false, isInbox = false, defaultFrom = null, addresses = [] } = req.body

    if (!name?.trim()) return reply.status(400).send({ error: 'Bowl name is required.' })
    if (!color?.trim()) return reply.status(400).send({ error: 'Bowl color is required.' })

    const validationError = validateBowlInput({ name, color, defaultFrom, addresses })
    if (validationError) return reply.status(400).send({ error: validationError })

    const bowl = {
      id: nanoid(10),
      name: name.trim(),
      color,
      isSpam,
      isInbox,
      defaultFrom,
      addresses: addresses.map(a => a.toLowerCase()),
      createdAt: Date.now(),
    }

    await bowlQueries.upsert(bowl, req.userId)

    // Under strict routing there's no inbox bowl to pull from. Mail arriving
    // after this point that matches one of the bowl's addresses will route
    // correctly; mail prior is unaffected (it was either skipped at sync
    // time or already in another bowl).

    return { ok: true, bowl }
  })

  // ── GET /bowls/special — current setup status of spam + agent bowls ────────
  // The dashboard's Settings page reads this to decide whether to show
  // "Set up" buttons or "Already configured" panels. Both are optional —
  // users may never set up either one.
  app.get('/bowls/special', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const [spam, agent] = await Promise.all([
      bowlQueries.findSpam(req.userId),
      bowlQueries.findAgent(req.userId),
    ])
    return { spam, agent }
  })

  // ── POST /bowls/spam/setup — explicit spam bowl setup ──────────────────────
  // Spam bowl ties to a throwaway/catch-all domain the user has already
  // connected as an account. The user picks which account (must belong to
  // them) and we create/configure the bowl with is_spam=true.
  // Idempotent: if a spam bowl already exists, returns it without touching.
  app.post<{
    Body: { name?: string; color?: string; accountId?: string }
  }>('/bowls/spam/setup', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })

    // Idempotent: already configured? Return existing.
    const existing = await bowlQueries.findSpam(req.userId)
    if (existing) return { ok: true, bowl: existing, created: false }

    const name = (req.body.name ?? 'Spam').trim()
    const color = (req.body.color ?? '#9ca3af').trim()
    const accountId = req.body.accountId?.trim() ?? null

    // Verify the chosen account belongs to this user. We don't require an
    // account — a user can create the bowl first and connect later — but if
    // they do supply one, validate ownership.
    let address: string | null = null
    if (accountId) {
      const account = await accountQueries.getById(accountId, req.userId)
      if (!account) return reply.status(404).send({ error: 'Account not found' })
      address = account.username.toLowerCase()
    }

    const validationError = validateBowlInput({ name, color, defaultFrom: address, addresses: address ? [address] : [] })
    if (validationError) return reply.status(400).send({ error: validationError })

    const bowl: Bowl = {
      id: nanoid(10),
      name,
      color,
      isSpam: true,
      isInbox: false,
      isAgent: false,
      defaultFrom: address,
      addresses: address ? [address] : [],
      createdAt: Date.now(),
    }
    await bowlQueries.upsert(bowl, req.userId)
    return { ok: true, bowl, created: true }
  })

  // ── POST /bowls/agent/setup — explicit agent bowl setup ────────────────────
  // Agent bowl is a logical container; no email account attached. Agent
  // messages arriving via /agent/inbound route here when no explicit bowlId
  // is supplied. Without this bowl, anonymous agent messages are rejected.
  // Idempotent: if an agent bowl already exists, returns it without touching.
  app.post<{
    Body: { name?: string; color?: string }
  }>('/bowls/agent/setup', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })

    const existing = await bowlQueries.findAgent(req.userId)
    if (existing) return { ok: true, bowl: existing, created: false }

    const name = (req.body.name ?? 'Agent').trim()
    const color = (req.body.color ?? '#ffbe0b').trim()

    const validationError = validateBowlInput({ name, color, defaultFrom: null, addresses: [] })
    if (validationError) return reply.status(400).send({ error: validationError })

    const bowl: Bowl = {
      id: nanoid(10),
      name,
      color,
      isSpam: false,
      isInbox: false,
      isAgent: true,
      defaultFrom: null,
      addresses: [],
      createdAt: Date.now(),
    }
    await bowlQueries.upsert(bowl, req.userId)
    return { ok: true, bowl, created: true }
  })

  // ── PATCH /bowls/:bowlId — update bowl addresses/defaultFrom ─────────────────
  app.patch<{
    Params: { bowlId: string }
    Body: { name?: string; color?: string; defaultFrom?: string; addresses?: string[] }
  }>('/bowls/:bowlId', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const bowl = await bowlQueries.getById(req.params.bowlId, req.userId)
    if (!bowl) return reply.status(404).send({ error: 'Bowl not found.' })

    const validationError = validateBowlInput(req.body)
    if (validationError) return reply.status(400).send({ error: validationError })

    // Validate addresses are syntactically valid emails
    if (req.body.addresses) {
      for (const addr of req.body.addresses) {
        const domain = addr.split('@')[1]?.toLowerCase()
        if (!domain) {
          return reply.status(400).send({ error: `Invalid address: ${addr}` })
        }
      }
    }

    const updated = {
      ...bowl,
      ...(req.body.name && { name: req.body.name }),
      ...(req.body.color && { color: req.body.color }),
      ...(req.body.defaultFrom !== undefined && { defaultFrom: req.body.defaultFrom }),
      ...(req.body.addresses !== undefined && { addresses: req.body.addresses.map(a => a.toLowerCase()) }),
    }

    await bowlQueries.upsert(updated, req.userId)

    // No more rerouteToBowl call — strict routing doesn't have an inbox bowl
    // to reroute *from*. Future mail will route per the new addresses; old
    // mail stays where it is until the user runs cleanup-unmatched.

    return { ok: true, bowl: updated }
  })

  // ── DELETE /bowls/:bowlId — remove bowl + its message rows ─────────────────
  app.delete<{ Params: { bowlId: string } }>('/bowls/:bowlId', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const bowl = await bowlQueries.getById(req.params.bowlId, req.userId)
    if (!bowl) return reply.status(404).send({ error: 'Bowl not found.' })

    // Delete the bowl and the message rows routed into it (metadata copies —
    // the originals on the mail server are untouched). Accounts are NOT
    // deleted: a mailbox can feed multiple bowls, so removing one bowl must
    // never disconnect a shared account. If the user later recreates a bowl
    // claiming the same addresses and resyncs, the mail reappears.
    await messageQueries.deleteByBowl(bowl.id)
    await bowlQueries.delete(bowl.id)
    return { ok: true }
  })

  // ── POST /accounts — connect a mailbox and start syncing ───────────────────
  // A mailbox connection is standalone now: it is NOT tied to a bowl. Mail
  // that arrives is routed to whichever bowl claims the recipient address
  // (or skipped if none does). Users connect one mailbox to start and can
  // add more later; bowls are created separately.
  app.post<{
    Body: {
      label?: string
      provider: string
      username: string
      password: string
      defaultFrom?: string
      aliases?: string[]
      imapHost?: string
      imapPort?: number
      smtpHost?: string
      smtpPort?: number
    }
  }>('/accounts', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const body = req.body

    if (!body.username || !body.password) {
      return reply.status(400).send({ error: 'username and password are required.' })
    }

    const { resolveAccountSettings } = await import('../config/providers.js')
    const settings = resolveAccountSettings(body.provider as any, body.username, {
      imapHost: body.imapHost,
      imapPort: body.imapPort,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
    })

    if (!settings.imapHost) {
      return reply.status(400).send({ error: 'Could not determine IMAP server. Enter it manually.' })
    }
    const imapError = validateExternalHost(settings.imapHost)
    if (imapError) return reply.status(400).send({ error: `IMAP: ${imapError}` })
    const smtpError = validateExternalHost(settings.smtpHost)
    if (smtpError) return reply.status(400).send({ error: `SMTP: ${smtpError}` })

    const account: Account = {
      id: nanoid(10),
      userId: req.userId,
      label: body.label || body.username,
      provider: body.provider as any,
      imapHost: settings.imapHost,
      imapPort: settings.imapPort,
      imapSecure: settings.imapSecure,
      username: body.username,
      password: body.password,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      defaultFrom: body.defaultFrom || body.username,
      aliases: body.aliases ?? [],
      createdAt: Date.now(),
      authType: 'password' as const,
    }

    await accountQueries.upsert(account, req.userId)

    // Re-read the row: upsert may have matched an existing mailbox, in which
    // case the canonical id is the existing one, not the nanoid we generated.
    const stored = await accountQueries.getByMailbox(req.userId, settings.imapHost, body.username)
    const live = stored ?? account

    const { connectAccount } = await import('../imap/connection.js')
    connectAccount(live, broadcast).catch((err: Error) => {
      console.error(`[imap] Failed to connect mailbox ${live.label}:`, err.message)
    })

    return { ok: true, account: { id: live.id, label: live.label } }
  })

  // ── DELETE /accounts/:accountId — remove an account ──────────────────────────
  app.delete<{ Params: { accountId: string } }>(
    '/accounts/:accountId', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const account = await accountQueries.getById(req.params.accountId, req.userId)
      if (!account) return reply.status(404).send({ error: 'Account not found.' })

      const { disconnectAccount } = await import('../imap/connection.js')
      await disconnectAccount(account.id).catch(() => {})
      await accountQueries.delete(account.id)

      return { ok: true }
    }
  )

  // ── POST /accounts/:accountId/resync ─────────────────────────────────────
  app.post<{ Params: { accountId: string } }>(
    '/accounts/:accountId/resync', async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
      const account = await accountQueries.getById(req.params.accountId, req.userId)
      if (!account) return reply.status(404).send({ error: 'Account not found.' })

      const { disconnectAccount, connectAccount } = await import('../imap/connection.js')
      await disconnectAccount(account.id).catch(() => {})
      connectAccount(account, broadcast).catch((err: Error) => {
        console.error(`[imap] resync of ${account.label} failed:`, err.message)
      })
      return { ok: true }
    }
  )

  // ── POST /accounts/resync-all — only this user's accounts ───────────────
  app.post('/accounts/resync-all', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })
    const accounts = await accountQueries.getAllForUser(req.userId)
    const { disconnectAccount, connectAccount } = await import('../imap/connection.js')
    for (const account of accounts) {
      await disconnectAccount(account.id).catch(() => {})
      connectAccount(account, broadcast).catch((err: Error) => {
        console.error(`[imap] resync-all of ${account.label} failed:`, err.message)
      })
    }
    return { ok: true, count: accounts.length }
  })

  // ── POST /messages/cleanup-unmatched ─────────────────────────────────────
  // Deletes any message in a bowl whose To/CC doesn't match any of that
  // bowl's configured addresses. Use this after fixing bowl addresses to
  // purge mail that was misrouted before the routing logic was strict.
  //
  // Destructive: messages are deleted from Cereal's local DB. The originals
  // remain on the IMAP server, so re-syncing the account is harmless — under
  // the new strict routing, mail that doesn't match any bowl is skipped, so
  // those messages will not come back.
  //
  // Sent messages (routed by From, not To/CC) are left alone.
  app.post('/messages/cleanup-unmatched', async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: 'Not authenticated' })

    const allBowls = await bowlQueries.getAllIncludingHidden(req.userId)
    let deleted = 0
    for (const bowl of allBowls) {
      if (bowl.isSpam) continue // spam routing is by sender domain, not To/CC
      const addresses = bowl.addresses.map(a => a.toLowerCase())
      const count = await messageQueries.deleteUnmatched(bowl.id, addresses)
      deleted += count
    }

    return { ok: true, deleted }
  })
}
