import type { Bowl, Message, AgentMessage } from './types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

// Session token storage. Replaces the old API-key model entirely — the
// `VITE_API_KEY` env var is no longer read or fallen back to. If no token
// is in localStorage, requests will fail with 401 and the UI shows the
// login screen.
const TOKEN_KEY = 'cereal_token'

function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) headers['x-session-token'] = token
  return headers
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function hasToken(): boolean {
  return Boolean(getToken())
}

// ── Auth API ─────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  createdAt: number
}

export interface AuthResponse {
  token: string
  expiresAt: number
  user: AuthUser
}

export async function signup(email: string, password: string, inviteCode?: string): Promise<AuthResponse> {
  const res = await fetch(BASE + '/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, inviteCode }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Sign up failed')
  setToken(data.token)
  return data
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  setToken(data.token)
  return data
}

export async function logout(): Promise<void> {
  try {
    await fetch(BASE + '/auth/logout', {
      method: 'POST',
      headers: getHeaders(),
    })
  } catch {
    // Network errors on logout are fine — we still clear the local token.
  }
  clearToken()
}

export async function forgotPassword(email: string): Promise<void> {
  const res = await fetch(BASE + '/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  // The endpoint always returns ok for valid requests (no account
  // enumeration). Only rate limiting or a server error produces non-2xx.
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not send reset email. Try again in a few minutes.')
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(BASE + '/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Password reset failed')
  }
}

export async function me(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch(BASE + '/auth/me', { headers: getHeaders() })
  if (!res.ok) {
    // Token rejected — clear it so the next render shows login.
    clearToken()
    return null
  }
  const data = await res.json()
  return data.user
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { headers: getHeaders(), ...opts })
  if (!res.ok) {
    // 401 means the session is gone. Clear the token so the next render
    // shows the login screen. Dispatch an event so App.tsx can react
    // immediately without waiting for the next mount.
    if (res.status === 401) {
      clearToken()
      window.dispatchEvent(new Event('cereal:auth-expired'))
    }
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.error) msg = body.error
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

// ── Bowls ──────────────────────────────────────────────────────────────────────

export async function getBowls(): Promise<(Bowl & { unreadCount: number })[]> {
  return req('/bowls')
}

// ── Messages ───────────────────────────────────────────────────────────────────

export async function getMessages(
  bowlId: string,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {}
): Promise<{ messages: Message[] }> {
  const p = new URLSearchParams()
  if (opts.limit) p.set('limit', String(opts.limit))
  if (opts.offset) p.set('offset', String(opts.offset))
  if (opts.unreadOnly) p.set('unreadOnly', 'true')
  return req(`/bowls/${bowlId}/messages?${p}`)
}

// Trigger a server-side IMAP sync for a bowl, then resolve once it's done.
// The backend re-fetches from the mail server and pushes any new messages
// over the WebSocket as they land. We await the HTTP response so the caller
// can stop showing a spinner; the actual new-message rendering happens via
// the WS 'new_message' events that follow.
export async function resyncBowl(bowlId: string): Promise<{ ok: boolean; synced?: number }> {
  return req(`/bowls/${bowlId}/resync`, { method: 'POST' })
}

export async function searchMessages(bowlId: string, q: string) {
  return req<{ messages: Message[] }>(
    `/bowls/${bowlId}/messages/search?q=${encodeURIComponent(q)}`
  )
}

// Search across ALL bowls
export async function searchAll(q: string, limit = 30) {
  return req<{ messages: Message[]; query: string }>(
    `/search?q=${encodeURIComponent(q)}&limit=${limit}`
  )
}

export async function getMessageBody(accountId: string, uid: number, folder = 'INBOX') {
  return req<{ textHtml: string | null; textPlain: string | null }>(
    `/accounts/${accountId}/messages/${uid}/body?folder=${folder}`
  )
}

export async function markSeen(accountId: string, uids: number[], folder = 'INBOX') {
  return req('/messages/seen', {
    method: 'POST',
    body: JSON.stringify({ accountId, uids, folder }),
  })
}

export async function markUnseen(accountId: string, uids: number[], folder = 'INBOX') {
  return req('/messages/unseen', {
    method: 'POST',
    body: JSON.stringify({ accountId, uids, folder }),
  })
}

// ── Send ───────────────────────────────────────────────────────────────────────

export interface SendPayload {
  accountId: string
  from?: string
  to: Array<{ name: string | null; email: string }>
  subject: string
  textPlain?: string
  textHtml?: string
  inReplyTo?: string
  references?: string[]
}

export async function sendEmail(payload: SendPayload) {
  return req<{ ok: boolean; messageId: string }>('/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ── Agent channel ──────────────────────────────────────────────────────────────

export async function getAgentMessages(
  bowlId?: string | null,
  limit = 50
): Promise<{ messages: AgentMessage[] }> {
  const p = new URLSearchParams({ limit: String(limit) })
  if (bowlId) p.set('bowlId', bowlId)
  return req(`/agent/messages?${p}`)
}

export async function sendToAgent(agentId: string, content: string, bowlId?: string) {
  return req<{ ok: boolean; id: string }>('/human/messages', {
    method: 'POST',
    body: JSON.stringify({ agentId, content, bowlId }),
  })
}

export async function resolveDecision(id: string, resolution: string) {
  return req(`/agent/messages/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution }),
  })
}

// ── Compose context ────────────────────────────────────────────────────────────

export async function getComposeContext(bowlId: string) {
  return req<{
    bowlId: string
    suggestedFrom: string
    availableFrom: string[]
    accounts: Array<{ id: string; label: string; defaultFrom: string; aliases: string[] }>
  }>(`/compose/context/${bowlId}`)
}

// ── Status ─────────────────────────────────────────────────────────────────────

export async function updateBowl(
  bowlId: string,
  updates: { name?: string; color?: string; defaultFrom?: string; addresses?: string[] }
) {
  return req<{ ok: boolean }>(`/bowls/${bowlId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteBowl(bowlId: string) {
  return req<{ ok: boolean }>(`/bowls/${bowlId}`, {
    method: 'DELETE',
  })
}

// ── Special bowls: spam + agent ───────────────────────────────────────────────
// Both are optional. The dashboard's Settings page reads getSpecialBowls()
// to decide whether to show "Set up" buttons or "Configured" panels.

export async function getSpecialBowls(): Promise<{
  spam: Bowl | null
  agent: Bowl | null
}> {
  return req('/bowls/special')
}

export async function setupSpamBowl(opts: {
  name?: string
  color?: string
  accountId?: string
}): Promise<{ ok: boolean; bowl: Bowl; created: boolean }> {
  return req('/bowls/spam/setup', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function setupAgentBowl(opts: {
  name?: string
  color?: string
}): Promise<{ ok: boolean; bowl: Bowl; created: boolean }> {
  return req('/bowls/agent/setup', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

// ── Agent API keys ────────────────────────────────────────────────────────────

export interface AgentKey {
  id: string
  label: string
  agentId: string
  createdAt: number
  lastUsed: number | null
  keyPreview: string
}

export async function getAgentKeys() {
  return req<{ keys: AgentKey[] }>('/agent/keys')
}

export async function createAgentKey(label: string, agentId?: string) {
  return req<{ ok: boolean; id: string; key: string; label: string; agentId: string }>('/agent/keys', {
    method: 'POST',
    body: JSON.stringify({ label, agentId }),
  })
}

export async function deleteAgentKey(id: string) {
  return req<{ ok: boolean }>(`/agent/keys/${id}`, { method: 'DELETE' })
}

export interface AccountListItem {
  id: string
  label: string
  username: string
  defaultFrom: string | null
  provider: string
  authType: 'password' | 'oauth'
  connected: boolean
}

export async function getAccounts(): Promise<AccountListItem[]> {
  // Previously called /status (which used to expose every account globally).
  // /status is now a minimal liveness check; account listing moved to the
  // authenticated /accounts endpoint scoped to the current user.
  const resp = await req<{ accounts: AccountListItem[] }>('/accounts')
  return resp.accounts
}
