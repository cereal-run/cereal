/**
 * Encryption + hashing for secrets stored in the DB.
 *
 * Two kinds of secrets:
 *   - "Retrievable" secrets (IMAP/SMTP passwords) — we need the cleartext at runtime
 *     to authenticate against the user's mail server. These use AES-256-GCM.
 *   - "Lookup-only" tokens (agent API keys) — we only need to check incoming tokens
 *     against stored ones, never display the original. These use HMAC-SHA256.
 *
 * Threat model: this protects against database leaks (a SQL dump,
 * DATABASE_URL exposure). It does NOT protect against backend compromise. If
 * the process running this code is owned, the attacker can decrypt.
 *
 * The master key is `ENCRYPTION_KEY`, a 32-byte (64 hex char) value held only
 * in your process environment, not in the DB. Generate one with:
 *   openssl rand -hex 32
 *
 * Two purpose-specific subkeys are derived from it via HKDF, so we never use the
 * same key bytes for both AES and HMAC.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, hkdfSync } from 'crypto'

const VERSION = 'v1'

function loadMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY env var is required. Generate with: openssl rand -hex 32',
    )
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes`,
    )
  }
  return key
}

const MASTER = loadMasterKey()
const AES_KEY = Buffer.from(
  hkdfSync('sha256', MASTER, Buffer.alloc(0), Buffer.from('cereal-aes-v1'), 32),
)
const HMAC_KEY = Buffer.from(
  hkdfSync('sha256', MASTER, Buffer.alloc(0), Buffer.from('cereal-hmac-v1'), 32),
)

/**
 * Encrypt a string. Returns "v1.<base64(iv || tag || ciphertext)>".
 * The v1 prefix lets us migrate to a new algorithm later without breaking old data.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', AES_KEY, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString('base64')}`
}

/**
 * Decrypt a value produced by encrypt(). Throws if the auth tag fails or the
 * payload isn't in the expected format.
 *
 * Unlike earlier versions, there is NO plaintext passthrough: a value that
 * doesn't carry the version prefix is an error, not legacy data. Fresh
 * installs never write plaintext credentials, so the passthrough's only
 * remaining effect would be to silently return corrupted ciphertext as if
 * it were a valid password. Fail loudly instead.
 */
export function decrypt(payload: string): string {
  if (!payload.startsWith(`${VERSION}.`)) {
    throw new Error('Cannot decrypt: payload is not in the expected v1 format')
  }
  const blob = Buffer.from(payload.slice(VERSION.length + 1), 'base64')
  if (blob.length < 28) {
    throw new Error('Encrypted payload is too short')
  }
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const ct = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', AES_KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/**
 * Returns true if the value is already encrypted under our scheme.
 * Used by the startup migration to skip already-encrypted rows.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`)
}

/**
 * Hash a bearer token for storage. Same input always produces same output,
 * so we can look up by hash. Different from AES — never reversible.
 *
 * Used for agent API keys: the user sees the full key exactly once at creation;
 * we store only the hash + a display prefix.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', HMAC_KEY).update(token).digest('hex')
}

/**
 * Hash a high-entropy token (e.g. a 32-byte session token) for storage.
 *
 * Unlike hashToken (which uses HMAC for agent keys), this is just plain
 * SHA-256. That's safe IFF the input has enough entropy that a rainbow-table
 * attack is impossible — true for our 256-bit random session tokens. Do NOT
 * use this for user-chosen passwords: those need argon2.
 *
 * Same input always produces same output, so we can look up sessions by
 * hashing the incoming bearer token and comparing.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Display preview of an agent key — first 8 chars + last 4 chars.
 * Stored in plaintext alongside the hash so the UI can show users which key is which.
 */
export function keyPreview(token: string): string {
  if (token.length <= 12) return token
  return `${token.slice(0, 8)}…${token.slice(-4)}`
}
