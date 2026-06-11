import { ImapFlow } from 'imapflow'
import { nanoid } from 'nanoid'
import type { Account, Folder, Message, WSEvent } from '../types.js'
import { folderQueries, messageQueries, syncQueries, bowlQueries } from '../db/index.js'

// Matches broadcast()'s signature in ws.ts. The userId argument scopes the
// event to a single user's connected WebSockets, so cross-user leaks are
// impossible even when many users are connected to the same backend.
type EventEmitter = (event: WSEvent, userId?: string) => void

const connections = new Map<string, ImapFlow>()
const idleTimers = new Map<string, NodeJS.Timeout>()
const pollTimers = new Map<string, NodeJS.Timeout>()
const reconnectTimers = new Map<string, NodeJS.Timeout>()
const reconnectAttempts = new Map<string, number>()
// Tracks accounts that have a sync in flight, so the poll-timer and the
// IDLE-break sync don't run simultaneously on the same connection.
const syncsInProgress = new Set<string>()

// How often the poll fires as a fallback for missed IDLE notifications.
// 2 min keeps worst-case latency tight without hammering the server.
const POLL_INTERVAL_MS = 2 * 60 * 1000

/**
 * Wraps syncInbox in a mutex so we don't run two concurrent syncs on the
 * same account. Both the IDLE-break code path and the polling timer call
 * through this — whichever gets here first wins, the other skips silently.
 */
async function safelySyncInbox(
  account: Account,
  client: ImapFlow,
  emit: EventEmitter,
  source: string,
): Promise<void> {
  if (syncsInProgress.has(account.id)) {
    return
  }
  syncsInProgress.add(account.id)
  try {
    await syncInbox(account, client, emit)
  } catch (err: any) {
    console.error(`[imap] ${account.id} sync (${source}) failed:`, err.message)
  } finally {
    syncsInProgress.delete(account.id)
  }
}

/**
 * Polling fallback. IDLE is the primary mechanism for real-time delivery,
 * but it can stall (NAT timeouts, server bugs, dropped EXISTS notifications).
 * This poll runs every 2 min and does a normal incremental sync — fetches
 * from lastUid+1:* so it's a cheap no-op when IDLE is healthy, and a recovery
 * mechanism when it isn't.
 */
function startPolling(account: Account, client: ImapFlow, emit: EventEmitter): void {
  stopPolling(account.id) // ensure no duplicate timer
  const timer = setInterval(async () => {
    if (!connections.has(account.id)) {
      stopPolling(account.id)
      return
    }
    await safelySyncInbox(account, client, emit, 'poll')
  }, POLL_INTERVAL_MS)
  pollTimers.set(account.id, timer)
}

function stopPolling(accountId: string): void {
  const timer = pollTimers.get(accountId)
  if (timer) {
    clearInterval(timer)
    pollTimers.delete(accountId)
  }
}

/**
 * Build the auth object for ImapFlow. OAuth accounts get an XOAUTH2 access
 * token (refreshed if needed); password accounts get the stored password.
 */
async function buildImapAuth(account: Account): Promise<{ user: string; pass?: string; accessToken?: string }> {
  if (account.authType === 'oauth') {
    const { getValidAccessToken } = await import('../oauth/tokens.js')
    const accessToken = await getValidAccessToken(account)
    return { user: account.username, accessToken }
  }
  return { user: account.username, pass: account.password }
}

// ── Connect an account and start syncing ────────────────────────────────────

export async function connectAccount(
  account: Account,
  rawEmit: EventEmitter
): Promise<void> {
  // Curry the userId in at the top: every event emitted from this account's
  // IMAP lifecycle (sync, connection status, new messages) gets scoped to
  // its owning user automatically. Anything that takes `emit` as a parameter
  // below uses this scoped version.
  const emit: EventEmitter = (event) => rawEmit(event, account.userId)

  await disconnectAccount(account.id)

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure ?? true,
    auth: await buildImapAuth(account),
    logger: false,
    emitLogs: false,
  })

  client.on('error', (err: Error) => {
    console.error(`[imap] ${account.id} error:`, err.message)
    emit({ type: 'connection_status', payload: { accountId: account.id, status: 'error', error: err.message } })
  })

  client.on('close', () => {
    console.log(`[imap] ${account.id} connection closed`)
    connections.delete(account.id)
    clearIdleTimer(account.id)
    emit({ type: 'connection_status', payload: { accountId: account.id, status: 'disconnected' } })
    scheduleReconnect(account, emit)
  })

  try {
    await client.connect()
    connections.set(account.id, client)
    reconnectAttempts.delete(account.id)

    // Enable TCP keepalive so silently-dead connections are detected within
    // minutes instead of hours. Without this, a connection that's been dropped
    // by NAT/firewall (common between cloud hosts and consumer ISPs) keeps the
    // client awaiting IDLE forever — the OS never tells us the socket is gone.
    // 60s initial delay matches imapflow's recommendation; subsequent probes
    // are at OS-default intervals (usually 75s × 9 probes = ~12 min to detect).
    const socket = (client as any).socket
    if (socket?.setKeepAlive) {
      socket.setKeepAlive(true, 60_000)
    }

    emit({ type: 'connection_status', payload: { accountId: account.id, status: 'connected' } })
    console.log(`[imap] ${account.id} connected`)

    await safelySyncInbox(account, client, emit, 'initial')
    startIdleLoop(account, client, emit)
    startPolling(account, client, emit)
  } catch (err: any) {
    console.error(`[imap] ${account.id} connect failed:`, err.message)
    emit({ type: 'connection_status', payload: { accountId: account.id, status: 'error', error: err.message } })
    scheduleReconnect(account, emit)
  }
}

export async function disconnectAccount(accountId: string): Promise<void> {
  clearIdleTimer(accountId)
  stopPolling(accountId)
  const timer = reconnectTimers.get(accountId)
  if (timer) { clearTimeout(timer); reconnectTimers.delete(accountId) }
  const client = connections.get(accountId)
  if (client) {
    connections.delete(accountId)
    try { await client.logout() } catch {}
  }
}

export function getConnection(accountId: string): ImapFlow | null {
  return connections.get(accountId) ?? null
}

function clearIdleTimer(accountId: string) {
  const timer = idleTimers.get(accountId)
  if (timer) { clearTimeout(timer); idleTimers.delete(accountId) }
}

// ── IDLE loop ───────────────────────────────────────────────────────────────
// Do NOT hold a mailbox lock during IDLE — other operations (fetchBody)
// need to acquire locks freely. Use mailboxOpen instead of getMailboxLock.
//
// Important behavioral detail: imapflow's `await client.idle()` does NOT
// automatically return when a new message arrives. The server sends an
// untagged EXISTS notification, imapflow fires the 'exists' event, but IDLE
// continues. To pick up new mail in real time we have to explicitly break
// IDLE from the 'exists' handler by issuing a command (a NOOP works). That
// causes imapflow to send DONE → NOOP → return, which makes the awaited
// idle() resolve, and the outer loop runs syncInbox.

async function startIdleLoop(
  account: Account,
  client: ImapFlow,
  emit: EventEmitter
): Promise<void> {
  if (!connections.has(account.id)) return

  // Break IDLE whenever new mail arrives. The handler is registered once for
  // the lifetime of this watch — it survives across loop iterations.
  const onExists = (event: any) => {
    console.log(`[imap] ${account.id} EXISTS — count=${event?.count}, prev=${event?.prevCount}`)
    // Fire and forget. The NOOP breaks IDLE; the loop body handles the sync.
    client.noop().catch((err: Error) => {
      console.error(`[imap] ${account.id} NOOP to break IDLE failed:`, err.message)
    })
  }
  client.on('exists', onExists)

  try {
    while (connections.has(account.id)) {
      // Re-select INBOX every iteration. syncInbox switches to Sent partway
      // through, so without this we'd be listening for EXISTS on Sent, not
      // INBOX. mailboxOpen is a no-op if already selected.
      await client.mailboxOpen('INBOX')

      console.log(`[imap] ${account.id} IDLE start`)
      const idlePromise = client.idle()

      // Force IDLE to break after 9 minutes. This is the heartbeat that
      // detects silently-dead connections — if NOOP fails, the loop catches,
      // we force a reconnect. Lower than the 29-min server limit, and tight
      // enough that we recover from NAT timeouts in under 10 min instead of
      // hours.
      let timer: NodeJS.Timeout | null = null
      const timeout = new Promise<void>(resolve => {
        timer = setTimeout(async () => {
          try { await client.noop() } catch {}
          resolve()
        }, 9 * 60 * 1000)
        idleTimers.set(account.id, timer)
      })

      await Promise.race([idlePromise, timeout])
      if (timer) clearTimeout(timer)
      idleTimers.delete(account.id)

      if (!connections.has(account.id)) break

      console.log(`[imap] ${account.id} IDLE broken — syncing`)
      await safelySyncInbox(account, client, emit, 'idle-break')
    }
  } catch (err: any) {
    console.error(`[imap] ${account.id} IDLE loop crashed:`, err.message)
    // 'close' event might not fire if the socket died silently. Force a
    // reconnect so we don't get stuck without an active IDLE.
    if (connections.has(account.id)) {
      connections.delete(account.id)
      stopPolling(account.id)
      try { await client.logout() } catch {}
      scheduleReconnect(account, emit)
    }
  } finally {
    client.removeListener('exists', onExists)
  }
}

// ── Reconnect ───────────────────────────────────────────────────────────────

function scheduleReconnect(account: Account, emit: EventEmitter): void {
  if (reconnectTimers.has(account.id)) return
  const attempts = reconnectAttempts.get(account.id) ?? 0
  const delay = Math.min(1000 * Math.pow(2, attempts), 120_000)
  console.log(`[imap] ${account.id} reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempts + 1})`)
  emit({ type: 'connection_status', payload: { accountId: account.id, status: 'disconnected' } })
  const timer = setTimeout(async () => {
    reconnectTimers.delete(account.id)
    reconnectAttempts.set(account.id, attempts + 1)
    await connectAccount(account, emit)
  }, delay)
  reconnectTimers.set(account.id, timer)
}

// ── Find the Sent folder (varies by provider) ────────────────────────────────

async function findSentFolder(client: ImapFlow): Promise<string | null> {
  try {
    const mailboxes = await client.list()
    // Look for \Sent special-use flag first (RFC 6154)
    for (const mb of mailboxes) {
      const specialUse = (mb as any).specialUse?.toLowerCase()
      if (specialUse === '\\sent') return mb.path
    }
    // Fall back to common names
    const candidates = ['Sent', 'INBOX.Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail']
    for (const name of candidates) {
      if (mailboxes.some(mb => mb.path === name)) return name
    }
  } catch {}
  return null
}

// ── Full inbox sync ──────────────────────────────────────────────────────────

export async function syncInbox(
  account: Account,
  client: ImapFlow,
  emit: EventEmitter
): Promise<number> {
  emit({ type: 'sync_started', payload: { accountId: account.id } })
  let synced = 0
  try {
    synced = await syncFolder(account, client, 'INBOX', 'Inbox', emit)
    // Also sync Sent folder so sent mail appears in bowls
    const sentPath = await findSentFolder(client)
    if (sentPath) {
      const sentSynced = await syncFolder(account, client, sentPath, 'Sent', emit)
      synced += sentSynced
    }
  } catch (err: any) {
    console.error(`[imap] ${account.id} sync error:`, err.message)
  }
  emit({ type: 'sync_complete', payload: { accountId: account.id, count: synced } })
  return synced
}

async function syncFolder(
  account: Account, client: ImapFlow, path: string,
  displayName: string, emit: EventEmitter
): Promise<number> {
  console.log(`[sync] ${account.id} syncing ${path}...`)
  const lock = await client.getMailboxLock(path)
  let synced = 0
  try {
    const status = await client.status(path, { messages: true, uidValidity: true, uidNext: true })
    console.log(`[sync] ${account.id} ${path}: ${status.messages} messages, uidNext=${status.uidNext}`)
    const folderId = `${account.id}:${path}`
    await folderQueries.upsert({
      id: folderId, accountId: account.id, name: path,
      displayName: cleanFolderName(displayName),
      uidvalidity: Number(status.uidValidity ?? 0),
      uidnext: Number(status.uidNext ?? 0),
      messageCount: status.messages ?? 0,
    })
    const lastUid = await messageQueries.getMaxUid(account.id, folderId)
    // First-connect backfill cap. Without this, a fresh mailbox with years of
    // history triggers a fetch of every envelope ever sent, which under strict
    // routing we mostly throw away anyway. We cap initial sync to the most
    // recent INITIAL_BACKFILL_UIDS UIDs. Once a baseline is in place
    // (lastUid > 0), normal incremental sync takes over and pulls everything
    // new from there forward, no cap.
    const INITIAL_BACKFILL_UIDS = 500
    let fetchRange: string
    if (lastUid > 0) {
      fetchRange = `${lastUid + 1}:*`
    } else {
      const uidNext = Number(status.uidNext ?? 0)
      const startUid = Math.max(1, uidNext - INITIAL_BACKFILL_UIDS)
      fetchRange = `${startUid}:*`
    }
    console.log(`[sync] ${account.id} fetching uid range ${fetchRange} (lastUid=${lastUid})`)

    const messages = client.fetch(fetchRange, {
      uid: true, flags: true, envelope: true,
      bodyStructure: true, internalDate: true,
    }, { uid: true })
    for await (const msg of messages) {
      try {
        // imapMsgToMessage returns null when the message doesn't match any
        // bowl's configured addresses. Mail outside the user's intentionally
        // configured bowls is silently skipped — Cereal's whole point is
        // separation, not a catch-all inbox.
        const message = await imapMsgToMessage(msg, account, folderId)
        if (!message) { continue }
        await messageQueries.upsert(message)
        emit({ type: 'new_message', payload: message })
        synced++
      } catch (msgErr: any) {
        console.error(`[sync] failed to store message uid=${msg.uid}:`, msgErr.message)
      }
    }
    console.log(`[sync] ${account.id} ${path}: synced ${synced} new messages`)
    await syncQueries.upsert({
      accountId: account.id, folderId,
      lastUid: await messageQueries.getMaxUid(account.id, folderId),
      lastSync: Date.now(),
    })
  } catch (err: any) {
    console.error(`[sync] ${account.id} ${path} FAILED:`, err.message, err.stack)
  } finally { lock.release() }
  return synced
}

// ── Fetch message body on demand ────────────────────────────────────────────

export async function fetchBody(
  account: Account, folderName: string, uid: number
): Promise<{ textPlain: string | null; textHtml: string | null } | null> {
  const client = connections.get(account.id)
  if (!client) return null

  const lock = await client.getMailboxLock(folderName)
  try {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true }) as any
    if (!msg?.source) return null

    const { simpleParser } = await import('mailparser')
    const parsed = await simpleParser(msg.source)

    return {
      textHtml: parsed.html ? String(parsed.html) : null,
      textPlain: parsed.text ?? null,
    }
  } catch (err: any) {
    console.error(`[imap] fetchBody error for uid ${uid}:`, err.message)
    return null
  } finally {
    lock.release()
  }
}

// ── Mark messages as seen ───────────────────────────────────────────────────

export async function markSeenOnServer(
  account: Account, folderName: string, uids: number[]
): Promise<void> {
  const client = connections.get(account.id)
  if (!client) return
  const lock = await client.getMailboxLock(folderName)
  try {
    await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true })
    messageQueries.markSeen(account.id, uids)
  } finally { lock.release() }
}

export async function markUnseenOnServer(
  account: Account, folderName: string, uids: number[]
): Promise<void> {
  const client = connections.get(account.id)
  if (!client) return
  const lock = await client.getMailboxLock(folderName)
  try {
    await client.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true })
    await messageQueries.markUnseen(account.id, uids)
  } finally { lock.release() }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function imapMsgToMessage(
  msg: any, account: Account, folderId: string
): Promise<Message | null> {
  if (!msg.envelope?.from?.[0]) return null
  const from = msg.envelope.from[0]
  const fromEmail = from.address || (from.mailbox && from.host ? `${from.mailbox}@${from.host}` : null)
  if (!fromEmail) return null
  const messageId = msg.envelope.messageId ?? null
  const references: string[] = (msg.envelope.inReplyTo ?? '').split(/\s+/).filter(Boolean)
  const threadId = references.length > 0 ? references[0] : (messageId ?? nanoid(10))
  const toAddrs = (msg.envelope.to ?? [])
    .map((a: any) => {
      const email = a.address || (a.mailbox && a.host ? `${a.mailbox}@${a.host}` : null)
      return email ? { name: a.name ?? null, email } : null
    })
    .filter(Boolean)
  const ccAddrs = (msg.envelope.cc ?? [])
    .map((a: any) => {
      const email = a.address || (a.mailbox && a.host ? `${a.mailbox}@${a.host}` : null)
      return email ? { name: a.name ?? null, email } : null
    })
    .filter(Boolean)
  const hasAttachments = detectAttachments(msg.bodyStructure)

  const isSent = /sent/i.test(folderId)

  // Routing — only mail explicitly matching a bowl's addresses is kept.
  // The lookup is scoped to the account's owning user, so even if two users
  // configure the same address on their bowls (rare but possible), mail
  // syncing through user A's account will only route to user A's bowls.
  let bowlId: string | null = null
  if (isSent) {
    const matched = await bowlQueries.findByAddress(fromEmail, account.userId)
    if (matched) bowlId = matched.id
  } else {
    for (const to of [...toAddrs, ...ccAddrs]) {
      const matched = await bowlQueries.findByAddress(to.email, account.userId)
      if (matched) { bowlId = matched.id; break }
    }
  }

  if (!bowlId) {
    // Privacy-respecting diagnostic. The previous version logged subject
    // lines and full email addresses, which ended up in production logs
    // aggregation. Now we log only the sender's domain and the recipient
    // count — enough to debug "why isn't mail from foo.com routing?"
    // without exposing user content or addresses.
    const fromDomain = fromEmail.split('@')[1] ?? 'unknown'
    console.log(`[route] SKIP — from_domain=${fromDomain} to_count=${toAddrs.length} subject_len=${(msg.envelope.subject ?? '').length}`)
    return null
  }
  const fromDomain = fromEmail.split('@')[1] ?? 'unknown'
  console.log(`[route] MATCH bowl=${bowlId} from_domain=${fromDomain}`)

  return {
    id: nanoid(), accountId: account.id, bowlId, folderId,
    uid: msg.uid, messageId, threadId,
    fromName: from.name ?? null,
    fromEmail,
    toAddrs, ccAddrs,
    subject: msg.envelope.subject ?? null, preview: null,
    date: msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now(),
    seen: msg.flags?.has('\\Seen') ?? false,
    flagged: msg.flags?.has('\\Flagged') ?? false,
    answered: msg.flags?.has('\\Answered') ?? false,
    hasAttachments,
    isSent,
    createdAt: Date.now(),
  }
}

function detectAttachments(bs: any): boolean {
  if (!bs) return false
  if (bs.disposition === 'attachment') return true
  return bs.childNodes?.some((c: any) => detectAttachments(c)) ?? false
}

function cleanFolderName(name: string): string {
  const map: Record<string, string> = {
    'INBOX': 'Inbox', '[Gmail]/Sent Mail': 'Sent', '[Gmail]/Drafts': 'Drafts',
    '[Gmail]/Trash': 'Trash', '[Gmail]/Spam': 'Spam', '[Gmail]/All Mail': 'All Mail',
    'Sent Items': 'Sent', 'Deleted Items': 'Trash', 'Junk Email': 'Spam',
  }
  return map[name] ?? name
}
