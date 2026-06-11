/**
 * In-memory store for OAuth flow state.
 *
 * When the user initiates an OAuth flow, we generate:
 *   - A random `state` token (CSRF protection — proves the callback comes
 *     from a flow we started, not from an attacker who tricked the user)
 *   - A PKCE code verifier (proves the callback comes from the same client
 *     that started the flow, even if state is intercepted)
 *
 * Both are tied to the bowlId so the callback knows which bowl to add the
 * resulting account to. Entries expire after 5 minutes.
 *
 * In-memory is fine for single-instance deployments. For a multi-instance
 * Cereal-hosted setup you'd back this with Redis or DB rows. The state token
 * is one-time-use so a brief window of staleness across replicas is OK.
 */

import { randomBytes, createHash } from 'crypto'
import type { OAuthProvider } from './config.js'

interface StateEntry {
  userId: string
  bowlId?: string        // legacy/optional — mailbox connection no longer needs a bowl
  codeVerifier: string
  provider: OAuthProvider
  createdAt: number
}

const STATE_TTL_MS = 5 * 60 * 1000
const store = new Map<string, StateEntry>()

// Periodic cleanup of expired entries.
setInterval(() => {
  const cutoff = Date.now() - STATE_TTL_MS
  for (const [k, v] of store) {
    if (v.createdAt < cutoff) store.delete(k)
  }
}, 60_000).unref()

export function createState(entry: Omit<StateEntry, 'createdAt'>): string {
  const state = randomBytes(32).toString('base64url')
  store.set(state, { ...entry, createdAt: Date.now() })
  return state
}

/**
 * Returns the state entry if it exists and is fresh, and deletes it from the
 * store (one-time use — replay attacks would fail).
 */
export function consumeState(state: string): StateEntry | null {
  const entry = store.get(state)
  if (!entry) return null
  store.delete(state)
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null
  return entry
}

export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
