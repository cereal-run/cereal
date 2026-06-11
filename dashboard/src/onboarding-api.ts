// Onboarding-specific API calls
import type { Bowl } from './types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

// Same token mechanism as api.ts — onboarding happens after login.
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = localStorage.getItem('cereal_token') || ''
  if (token) headers['x-session-token'] = token
  return headers
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { headers: getHeaders(), ...opts })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

export interface TestConnectionPayload {
  provider: string
  username: string
  password: string
  imapHost?: string
  imapPort?: number
}

export async function testConnection(
  payload: TestConnectionPayload
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await req('/onboarding/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function createBowl(
  name: string,
  color: string,
  defaultFrom: string,
  addresses: string[],
  isSpam = false,
  isInbox = false,
): Promise<{ ok: boolean; bowl: Bowl }> {
  return req('/bowls', {
    method: 'POST',
    body: JSON.stringify({ name, color, defaultFrom, addresses, isSpam, isInbox }),
  })
}

export async function createAccount(payload: {
  label: string
  provider: string
  username: string
  password: string
  defaultFrom: string
  imapHost?: string
  imapPort?: number
  smtpHost?: string
  smtpPort?: number
}): Promise<{ ok: boolean; account: { id: string; label: string } }> {
  return req('/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getOAuthAuthUrl(
  provider: 'google' | 'microsoft',
): Promise<{ authUrl: string }> {
  return req(`/oauth/${provider}/start`)
}

export async function getOAuthProviders(): Promise<{ google: boolean; microsoft: boolean }> {
  return req('/oauth/providers')
}
