import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { randomBytes } from 'crypto'
import type { Bowl, Account, Folder, Message, SyncState, AgentMessage } from '../types.js'
import { encrypt, decrypt, isEncrypted, hashToken, keyPreview, sha256Hex } from '../crypto.js'

let sql: NeonQueryFunction<false, false>

async function q(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
  const result = await sql(strings, ...values)
  return result as any[]
}

export async function initDb(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is required')
  sql = neon(url)
  await createSchema()
  await migrateAccountsAddOAuthColumns()
  await migrateAgentKeysSchema()
  await migratePlaintextPasswords()
  console.log('[db] Postgres connected')
}

export function getDb() { return sql }

// ─── Schema ───────────────────────────────────────────────────────────────────

async function createSchema(): Promise<void> {
  await q`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      source     TEXT,
      created_at BIGINT NOT NULL
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email)`

  // ── users + sessions ────────────────────────────────────────────────────
  // Multi-tenancy foundation. Created here as part of createSchema so fresh
  // installs get them; existing installs get them via the same CREATE TABLE
  // IF NOT EXISTS path (idempotent).
  await q`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`

  // ── Invite codes ────────────────────────────────────────────────────────
  // Replaces the env-var SIGNUP_INVITE_CODE with a real table so codes can be
  // labeled per channel (HACKERNEWS, TWITTER_LAUNCH, etc.), capped by max
  // uses, and tracked per redemption. The env var still works as a fallback
  // when set — useful for ops "open the gate" moments or temporary access
  // before seeding the table.
  await q`
    CREATE TABLE IF NOT EXISTS invite_codes (
      code        TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      max_uses    INTEGER,
      used_count  INTEGER NOT NULL DEFAULT 0,
      expires_at  BIGINT,
      created_at  BIGINT NOT NULL,
      notes       TEXT
    )
  `
  // Per-redemption log. Separate from invite_codes so analytics can answer
  // "which channel converted to paying users?" by joining redemptions →
  // users, for analytics. Cascades on user delete so we don't keep orphan
  // rows pointing at deleted accounts.
  await q`
    CREATE TABLE IF NOT EXISTS invite_code_redemptions (
      id           SERIAL PRIMARY KEY,
      code         TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redeemed_at  BIGINT NOT NULL
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_redemptions_code ON invite_code_redemptions(code)`
  await q`CREATE INDEX IF NOT EXISTS idx_redemptions_user ON invite_code_redemptions(user_id)`

  await q`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  BIGINT NOT NULL,
      expires_at  BIGINT NOT NULL,
      last_used   BIGINT NOT NULL
    )
  `
  // Migration: previously the column was named `token` and held the raw value.
  // If we find a `token` column, rename it AND treat existing values as
  // immediately expired (their plaintext form is no longer accepted as input
  // since lookups now hash first). Forces a re-login but no data loss.
  await q`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'token'
      ) THEN
        ALTER TABLE sessions RENAME COLUMN token TO token_hash;
        UPDATE sessions SET expires_at = 0;
      END IF;
    END $$;
  `
  await q`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`
  await q`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`

  // Single-use, short-lived tokens for the password reset flow. Only the
  // SHA-256 hash of the token is stored — the raw value lives exclusively in
  // the email we send. A DB dump cannot be used to reset anyone's password.
  await q`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  BIGINT NOT NULL,
      expires_at  BIGINT NOT NULL,
      used_at     BIGINT
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id)`
  await q`CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at)`

  await q`
    CREATE TABLE IF NOT EXISTS bowls (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      color        TEXT NOT NULL,
      is_spam      BOOLEAN NOT NULL DEFAULT false,
      is_inbox     BOOLEAN NOT NULL DEFAULT false,
      is_agent     BOOLEAN NOT NULL DEFAULT false,
      default_from TEXT,
      addresses    JSONB NOT NULL DEFAULT '[]',
      created_at   BIGINT NOT NULL
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_bowls_user_id ON bowls(user_id)`
  // Migrations: ensure boolean flags exist on older deployments.
  // Safe to run repeatedly; ADD COLUMN IF NOT EXISTS is idempotent.
  await q`ALTER TABLE bowls ADD COLUMN IF NOT EXISTS is_inbox BOOLEAN NOT NULL DEFAULT false`
  await q`ALTER TABLE bowls ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT false`
  // Partial unique indexes: a user has at most one spam bowl and at most one
  // agent bowl. The dashboard's "Set up" buttons rely on this to be idempotent.
  await q`CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_spam_bowl ON bowls(user_id) WHERE is_spam = true`
  await q`CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_agent_bowl ON bowls(user_id) WHERE is_agent = true`

  await q`
    CREATE TABLE IF NOT EXISTS accounts (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bowl_id             TEXT,
      label               TEXT NOT NULL,
      provider            TEXT NOT NULL,
      imap_host           TEXT NOT NULL,
      imap_port           INTEGER NOT NULL,
      imap_secure         BOOLEAN NOT NULL DEFAULT true,
      username            TEXT NOT NULL,
      password            TEXT NOT NULL,
      smtp_host           TEXT NOT NULL,
      smtp_port           INTEGER NOT NULL,
      smtp_secure         BOOLEAN NOT NULL DEFAULT false,
      default_from        TEXT NOT NULL,
      aliases             JSONB NOT NULL DEFAULT '[]',
      created_at          BIGINT NOT NULL,
      auth_type           TEXT NOT NULL DEFAULT 'password',
      oauth_provider      TEXT,
      refresh_token       TEXT,
      access_token        TEXT,
      token_expires_at    BIGINT
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)`

  // ── Account/bowl decoupling migration ──────────────────────────────────────
  // Originally accounts.bowl_id was NOT NULL — each mailbox belonged to exactly
  // one bowl. That was wrong: one mailbox (e.g. a Fastmail login hosting several
  // domains) can feed many bowls, and bowls are defined purely by the addresses
  // they claim. We drop the NOT NULL + FK constraint on bowl_id so it can be
  // null. The column is kept (nullable, unused by routing) only to avoid a
  // destructive drop; new code never reads it. Routing is entirely by address.
  await q`
    DO $$
    BEGIN
      -- Drop the NOT NULL constraint if present.
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'accounts' AND column_name = 'bowl_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE accounts ALTER COLUMN bowl_id DROP NOT NULL;
      END IF;
      -- Drop the FK to bowls if present (name is auto-generated; find + drop).
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'accounts'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'bowl_id'
      ) THEN
        EXECUTE (
          SELECT 'ALTER TABLE accounts DROP CONSTRAINT ' || tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = 'accounts'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'bowl_id'
          LIMIT 1
        );
      END IF;
    END $$;
  `
  // Prevent duplicate mailbox connections: one (user, imap_host, username) =
  // one account row. Re-onboarding the same mailbox now UPDATEs instead of
  // creating a new account (which was the source of the duplicate-message
  // pile-up — each extra account row re-synced the same mailbox).
  await q`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique_mailbox
    ON accounts(user_id, imap_host, username)
  `

  await q`
    CREATE TABLE IF NOT EXISTS folders (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      uidvalidity   BIGINT NOT NULL DEFAULT 0,
      uidnext       BIGINT NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, name)
    )
  `

  await q`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      bowl_id         TEXT NOT NULL REFERENCES bowls(id),
      folder_id       TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      uid             INTEGER NOT NULL,
      message_id      TEXT,
      thread_id       TEXT,
      from_name       TEXT,
      from_email      TEXT NOT NULL,
      to_addrs        JSONB NOT NULL DEFAULT '[]',
      cc_addrs        JSONB NOT NULL DEFAULT '[]',
      subject         TEXT,
      preview         TEXT,
      date            BIGINT NOT NULL,
      seen            BOOLEAN NOT NULL DEFAULT false,
      flagged         BOOLEAN NOT NULL DEFAULT false,
      answered        BOOLEAN NOT NULL DEFAULT false,
      has_attachments BOOLEAN NOT NULL DEFAULT false,
      is_sent         BOOLEAN NOT NULL DEFAULT false,
      created_at      BIGINT NOT NULL,
      UNIQUE(account_id, folder_id, uid)
    )
  `
  // Migration
  await q`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_sent BOOLEAN NOT NULL DEFAULT false`

  await q`CREATE INDEX IF NOT EXISTS idx_messages_bowl   ON messages(bowl_id, date DESC)`
  await q`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`
  await q`CREATE INDEX IF NOT EXISTS idx_messages_seen   ON messages(bowl_id, seen, date DESC)`

  // Dedup messages by RFC Message-ID per account. IMAP UIDs reset when a
  // mailbox's UIDVALIDITY changes (happens on some reconnects), which made
  // the (account_id, folder_id, uid) key insufficient — the same email got
  // re-inserted under a new uid. Message-ID is globally stable, so this
  // partial unique index (only where message_id is present) catches the
  // real duplicates. Mail with no Message-ID (rare/malformed) still falls
  // back to the uid constraint.
  await q`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup
    ON messages(account_id, message_id)
    WHERE message_id IS NOT NULL
  `

  await q`
    CREATE TABLE IF NOT EXISTS sync_state (
      account_id  TEXT NOT NULL,
      folder_id   TEXT NOT NULL,
      last_uid    INTEGER NOT NULL DEFAULT 0,
      last_sync   BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, folder_id)
    )
  `

  await q`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id                 TEXT PRIMARY KEY,
      bowl_id            TEXT REFERENCES bowls(id),
      agent_id           TEXT NOT NULL,
      direction          TEXT NOT NULL,
      type               TEXT NOT NULL DEFAULT 'text',
      content            TEXT NOT NULL,
      options            JSONB,
      resolved           BOOLEAN NOT NULL DEFAULT false,
      resolution         TEXT,
      related_message_id TEXT,
      created_at         BIGINT NOT NULL
    )
  `

  await q`CREATE INDEX IF NOT EXISTS idx_agent_bowl ON agent_messages(bowl_id, created_at DESC)`

  // Agent API keys — used by external agents to POST to /agent/inbound
  await q`
    CREATE TABLE IF NOT EXISTS agent_keys (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash    TEXT NOT NULL UNIQUE,
      key_prefix  TEXT NOT NULL,
      label       TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      created_at  BIGINT NOT NULL,
      last_used   BIGINT
    )
  `
  await q`CREATE INDEX IF NOT EXISTS idx_agent_keys_key_hash ON agent_keys(key_hash)`
  await q`CREATE INDEX IF NOT EXISTS idx_agent_keys_user_id ON agent_keys(user_id)`
}

// ─── Migrations ───────────────────────────────────────────────────────────────

/**
 * Adds OAuth columns to the accounts table if they don't already exist.
 * Safe to run repeatedly. New deployments get them from CREATE TABLE; existing
 * deployments get them via these ALTER TABLEs.
 */
async function migrateAccountsAddOAuthColumns(): Promise<void> {
  await q`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'password'`
  await q`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_provider TEXT`
  await q`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT`
  await q`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS access_token TEXT`
  await q`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_expires_at BIGINT`
}

/**
 * Old agent_keys schema stored the full key in a `key` column. We've moved to
 * `key_hash` + `key_prefix`. The full key is no longer recoverable from the DB.
 *
 * Detection: if the old `key` column exists on agent_keys, the table is on the
 * old schema. We drop and recreate. This loses existing keys — acceptable
 * pre-launch. Users would re-generate their keys.
 *
 * Safe to run repeatedly: if `key_hash` is present, this is a no-op.
 */
async function migrateAgentKeysSchema(): Promise<void> {
  const cols = await q`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agent_keys'
  ` as Array<{ column_name: string }>
  const names = new Set(cols.map(c => c.column_name))
  const hasOld = names.has('key')
  const hasNew = names.has('key_hash')

  if (hasOld && !hasNew) {
    console.warn('[db] Migrating agent_keys to hash-only schema (existing keys will be invalidated)')
    await q`DROP TABLE agent_keys`
    await q`
      CREATE TABLE agent_keys (
        id          TEXT PRIMARY KEY,
        key_hash    TEXT NOT NULL UNIQUE,
        key_prefix  TEXT NOT NULL,
        label       TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        created_at  BIGINT NOT NULL,
        last_used   BIGINT
      )
    `
    await q`CREATE INDEX IF NOT EXISTS idx_agent_keys_key_hash ON agent_keys(key_hash)`
  }
}

/**
 * Encrypts any plaintext passwords found in the accounts table. Idempotent —
 * rows already carrying the encryption version prefix are skipped.
 *
 * This handles the rollout: deploy with ENCRYPTION_KEY set, restart picks up
 * existing plaintext rows and upgrades them on first boot. Subsequent boots
 * are no-ops.
 */
async function migratePlaintextPasswords(): Promise<void> {
  const rows = await q`SELECT id, password FROM accounts` as Array<{ id: string; password: string }>
  let upgraded = 0
  for (const row of rows) {
    if (!isEncrypted(row.password)) {
      const encrypted = encrypt(row.password)
      await q`UPDATE accounts SET password = ${encrypted} WHERE id = ${row.id}`
      upgraded++
    }
  }
  if (upgraded > 0) {
    console.log(`[db] Encrypted ${upgraded} plaintext password${upgraded === 1 ? '' : 's'} in accounts`)
  }
}

// ─── Waitlist queries ─────────────────────────────────────────────────────────

export const waitlistQueries = {
  async add(id: string, email: string, source?: string): Promise<'added' | 'exists'> {
    try {
      await q`
        INSERT INTO waitlist (id, email, source, created_at)
        VALUES (${id}, ${email.toLowerCase().trim()}, ${source ?? null}, ${Date.now()})
        ON CONFLICT (email) DO NOTHING
      `
      // Check if it was actually inserted
      const row = await q`SELECT id FROM waitlist WHERE email = ${email.toLowerCase().trim()}`
      return row[0]?.id === id ? 'added' : 'exists'
    } catch {
      return 'exists'
    }
  },
  async getAll(): Promise<Array<{ id: string; email: string; source: string | null; createdAt: number }>> {
    const rows = await q`SELECT * FROM waitlist ORDER BY created_at ASC`
    return rows.map((r: any) => ({ id: r.id, email: r.email, source: r.source, createdAt: Number(r.created_at) }))
  },
  async count(): Promise<number> {
    const rows = await q`SELECT COUNT(*) as count FROM waitlist`
    return Number(rows[0]?.count ?? 0)
  },
}

// ─── Bowl queries ─────────────────────────────────────────────────────────────

export const bowlQueries = {
  async upsert(bowl: Bowl, userId: string): Promise<void> {
    await q`
      INSERT INTO bowls (id, user_id, name, color, is_spam, is_inbox, is_agent, default_from, addresses, created_at)
      VALUES (${bowl.id}, ${userId}, ${bowl.name}, ${bowl.color}, ${bowl.isSpam}, ${bowl.isInbox ?? false},
              ${bowl.isAgent ?? false}, ${bowl.defaultFrom ?? null}, ${JSON.stringify(bowl.addresses)}, ${bowl.createdAt})
      ON CONFLICT (id) DO UPDATE SET
        name         = excluded.name,
        color        = excluded.color,
        is_spam      = excluded.is_spam,
        is_agent     = excluded.is_agent,
        default_from = excluded.default_from,
        addresses    = excluded.addresses
    `
  },
  // Find this user's spam bowl, if any. Returns null if not set up.
  async findSpam(userId: string): Promise<Bowl | null> {
    const rows = await q`
      SELECT * FROM bowls WHERE user_id = ${userId} AND is_spam = true LIMIT 1
    `
    return rows[0] ? rowToBowl(rows[0]) : null
  },
  // Find this user's agent bowl, if any. Returns null if not set up.
  async findAgent(userId: string): Promise<Bowl | null> {
    const rows = await q`
      SELECT * FROM bowls WHERE user_id = ${userId} AND is_agent = true LIMIT 1
    `
    return rows[0] ? rowToBowl(rows[0]) : null
  },
  // Returns all VISIBLE bowls for a user (hides system inbox, though that
  // concept is gone now — kept the filter for any stale rows from prior
  // versions). MUST be called with the authenticated user's id.
  async getAll(userId: string): Promise<Bowl[]> {
    const rows = await q`
      SELECT * FROM bowls
      WHERE user_id = ${userId} AND is_inbox = false
      ORDER BY is_spam ASC, created_at ASC
    `
    return rows.map(rowToBowl)
  },
  // Returns ALL bowls for a user including any hidden/legacy inbox rows.
  // Used by cleanup endpoints and full-sync flows.
  async getAllIncludingHidden(userId: string): Promise<Bowl[]> {
    const rows = await q`
      SELECT * FROM bowls
      WHERE user_id = ${userId}
      ORDER BY is_inbox ASC, is_spam ASC, created_at ASC
    `
    return rows.map(rowToBowl)
  },
  async getById(id: string, userId: string): Promise<Bowl | null> {
    const rows = await q`SELECT * FROM bowls WHERE id = ${id} AND user_id = ${userId}`
    return rows[0] ? rowToBowl(rows[0]) : null
  },
  // Finds a bowl belonging to userId whose addresses list includes the given
  // email. Used by IMAP routing — scope by user so a second user's bowl
  // with the same configured address can't claim mail from this user's
  // account.
  async findByAddress(email: string, userId: string): Promise<Bowl | null> {
    const lower = email.toLowerCase()
    const rows = await q`
      SELECT * FROM bowls
      WHERE user_id = ${userId}
        AND is_inbox = false
        AND addresses @> ${JSON.stringify([lower])}::jsonb
      LIMIT 1
    `
    return rows[0] ? rowToBowl(rows[0]) : null
  },
  async delete(id: string): Promise<void> {
    await q`DELETE FROM bowls WHERE id = ${id}`
  },
}

// ─── Account queries ──────────────────────────────────────────────────────────

export const accountQueries = {
  async upsert(account: Account, userId: string): Promise<void> {
    const encryptedPassword = encrypt(account.password)
    const encryptedRefresh = account.refreshToken ? encrypt(account.refreshToken) : null
    const encryptedAccess = account.accessToken ? encrypt(account.accessToken) : null
    // Conflict on the mailbox identity (user_id, imap_host, username), NOT on
    // id. Re-connecting the same mailbox updates the existing row — including
    // refreshed OAuth tokens or a changed password — instead of spawning a
    // duplicate account that would re-sync the same mail. bowl_id is legacy
    // and always written null now (routing is by address, not by account).
    await q`
      INSERT INTO accounts (
        id, user_id, bowl_id, label, provider, imap_host, imap_port, imap_secure,
        username, password, smtp_host, smtp_port, smtp_secure,
        default_from, aliases, created_at,
        auth_type, oauth_provider, refresh_token, access_token, token_expires_at
      ) VALUES (
        ${account.id}, ${userId}, ${null}, ${account.label}, ${account.provider},
        ${account.imapHost}, ${account.imapPort}, ${account.imapSecure},
        ${account.username}, ${encryptedPassword},
        ${account.smtpHost}, ${account.smtpPort}, ${account.smtpSecure},
        ${account.defaultFrom}, ${JSON.stringify(account.aliases)}, ${account.createdAt},
        ${account.authType ?? 'password'}, ${account.oauthProvider ?? null},
        ${encryptedRefresh}, ${encryptedAccess}, ${account.tokenExpiresAt ?? null}
      )
      ON CONFLICT (user_id, imap_host, username) DO UPDATE SET
        label            = excluded.label,
        password         = excluded.password,
        default_from     = excluded.default_from,
        aliases          = excluded.aliases,
        auth_type        = excluded.auth_type,
        oauth_provider   = excluded.oauth_provider,
        refresh_token    = excluded.refresh_token,
        access_token     = excluded.access_token,
        token_expires_at = excluded.token_expires_at
    `
  },
  /**
   * Persist refreshed OAuth tokens without touching anything else on the account.
   * Called every ~1 hour from getValidAccessToken() when the cached access token
   * is near expiry.
   */
  async updateOAuthTokens(id: string, tokens: { accessToken: string; refreshToken: string; tokenExpiresAt: number }): Promise<void> {
    const encryptedAccess = encrypt(tokens.accessToken)
    const encryptedRefresh = encrypt(tokens.refreshToken)
    await q`
      UPDATE accounts SET
        access_token     = ${encryptedAccess},
        refresh_token    = ${encryptedRefresh},
        token_expires_at = ${tokens.tokenExpiresAt}
      WHERE id = ${id}
    `
  },
  // ALL accounts across ALL users. Used ONLY at server boot to restart
  // IMAP connections for everyone. Do not call from any API route — use
  // getAllForUser instead.
  async getAll(): Promise<Account[]> {
    const rows = await q`SELECT * FROM accounts ORDER BY created_at ASC`
    return rows.map(rowToAccount)
  },
  async getAllForUser(userId: string): Promise<Account[]> {
    const rows = await q`SELECT * FROM accounts WHERE user_id = ${userId} ORDER BY created_at ASC`
    return rows.map(rowToAccount)
  },
  async getById(id: string, userId: string): Promise<Account | null> {
    // userId is REQUIRED. Multi-tenancy defence: an attacker who guessed an
    // account id should not be able to look it up without owning it.
    const rows = await q`SELECT * FROM accounts WHERE id = ${id} AND user_id = ${userId}`
    return rows[0] ? rowToAccount(rows[0]) : null
  },
  // Look up a mailbox by its identity (the unique key). Used after upsert to
  // get the canonical row when re-connecting an existing mailbox.
  async getByMailbox(userId: string, imapHost: string, username: string): Promise<Account | null> {
    const rows = await q`
      SELECT * FROM accounts
      WHERE user_id = ${userId} AND imap_host = ${imapHost} AND username = ${username}
      LIMIT 1
    `
    return rows[0] ? rowToAccount(rows[0]) : null
  },
  async delete(id: string): Promise<void> {
    await q`DELETE FROM accounts WHERE id = ${id}`
  },
}

// ─── Folder queries ───────────────────────────────────────────────────────────

export const folderQueries = {
  async upsert(folder: Folder): Promise<void> {
    await q`
      INSERT INTO folders (id, account_id, name, display_name, uidvalidity, uidnext, message_count)
      VALUES (${folder.id}, ${folder.accountId}, ${folder.name}, ${folder.displayName},
              ${folder.uidvalidity}, ${folder.uidnext}, ${folder.messageCount})
      ON CONFLICT (account_id, name) DO UPDATE SET
        display_name  = excluded.display_name,
        uidvalidity   = excluded.uidvalidity,
        uidnext       = excluded.uidnext,
        message_count = excluded.message_count
    `
  },
}

// ─── Message queries ──────────────────────────────────────────────────────────

export const messageQueries = {
  async upsert(msg: Message): Promise<void> {
    // Two dedup paths:
    //  1. If the message has an RFC Message-ID, dedup on (account_id,
    //     message_id) — stable across UIDVALIDITY changes / reconnects.
    //  2. If it doesn't (rare), fall back to (account_id, folder_id, uid).
    // We can't express "conflict on either" in one statement, so when a
    // message_id is present we check-then-write against that key; otherwise
    // we use the uid constraint.
    if (msg.messageId) {
      const existing = await q`
        SELECT id FROM messages
        WHERE account_id = ${msg.accountId} AND message_id = ${msg.messageId}
        LIMIT 1
      ` as Array<{ id: string }>
      if (existing[0]) {
        // Already have this email for this account. Update mutable flags +
        // keep its bowl routing current, but don't create a copy.
        await q`
          UPDATE messages SET
            seen     = ${msg.seen},
            flagged  = ${msg.flagged},
            answered = ${msg.answered},
            bowl_id  = ${msg.bowlId}
          WHERE id = ${existing[0].id}
        `
        return
      }
    }
    await q`
      INSERT INTO messages (
        id, account_id, bowl_id, folder_id, uid, message_id, thread_id,
        from_name, from_email, to_addrs, cc_addrs, subject, preview,
        date, seen, flagged, answered, has_attachments, is_sent, created_at
      ) VALUES (
        ${msg.id}, ${msg.accountId}, ${msg.bowlId}, ${msg.folderId},
        ${msg.uid}, ${msg.messageId ?? null}, ${msg.threadId ?? null},
        ${msg.fromName ?? null}, ${msg.fromEmail},
        ${JSON.stringify(msg.toAddrs)}, ${JSON.stringify(msg.ccAddrs)},
        ${msg.subject ?? null}, ${msg.preview ?? null}, ${msg.date},
        ${msg.seen}, ${msg.flagged}, ${msg.answered}, ${msg.hasAttachments},
        ${msg.isSent ?? false}, ${msg.createdAt}
      )
      ON CONFLICT (account_id, folder_id, uid) DO UPDATE SET
        seen    = excluded.seen,
        flagged = excluded.flagged,
        answered = excluded.answered
    `
  },
  async getByBowl(bowlId: string, userId: string, limit = 50, offset = 0): Promise<Message[]> {
    // Belt-and-suspenders: even though the route should have already
    // verified bowl ownership, we JOIN to bowls and check user_id here too.
    // If a route forgets to verify, this still won't leak.
    const rows = await q`
      SELECT m.* FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE m.bowl_id = ${bowlId} AND b.user_id = ${userId}
      ORDER BY m.date DESC LIMIT ${limit} OFFSET ${offset}
    `
    return rows.map(rowToMessage)
  },
  async getByThread(threadId: string, userId: string): Promise<Message[]> {
    const rows = await q`
      SELECT m.* FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE m.thread_id = ${threadId} AND b.user_id = ${userId}
      ORDER BY m.date ASC
    `
    return rows.map(rowToMessage)
  },
  async getUnreadCount(bowlId: string, userId: string): Promise<number> {
    const rows = await q`
      SELECT COUNT(*) as count FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE m.bowl_id = ${bowlId} AND b.user_id = ${userId} AND m.seen = false
    `
    return Number(rows[0]?.count ?? 0)
  },
  async getByBowlUnread(bowlId: string, userId: string): Promise<Message[]> {
    const rows = await q`
      SELECT m.* FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE m.bowl_id = ${bowlId} AND b.user_id = ${userId} AND m.seen = false
      ORDER BY m.date DESC
    `
    return rows.map(rowToMessage)
  },
  // Move messages from one bowl to another (e.g., when deleting a bowl)
  async reassignBowl(fromBowlId: string, toBowlId: string): Promise<void> {
    await q`UPDATE messages SET bowl_id = ${toBowlId} WHERE bowl_id = ${fromBowlId}`
    // Also handle agent_messages if the table exists
    try {
      await q`UPDATE agent_messages SET bowl_id = ${toBowlId} WHERE bowl_id = ${fromBowlId}`
    } catch {}
  },
  // Delete every message in a bowl. Used when deleting the bowl itself —
  // the underlying mail stays on the IMAP server, only Cereal's local
  // metadata copy is dropped.
  async deleteByBowl(bowlId: string): Promise<void> {
    await q`DELETE FROM messages WHERE bowl_id = ${bowlId}`
    try {
      await q`DELETE FROM agent_messages WHERE bowl_id = ${bowlId}`
    } catch {}
  },
  async markSeen(accountId: string, uids: number[]): Promise<void> {
    await q`UPDATE messages SET seen = true WHERE account_id = ${accountId} AND uid = ANY(${uids})`
  },
  async markUnseen(accountId: string, uids: number[]): Promise<void> {
    await q`UPDATE messages SET seen = false WHERE account_id = ${accountId} AND uid = ANY(${uids})`
  },
  // Move messages from inbox bowls into a business bowl if any to/cc address matches
  async rerouteToBowl(bowlId: string, addresses: string[]): Promise<number> {
    if (addresses.length === 0) return 0
    const lowercased = addresses.map(a => a.toLowerCase())

    // Find messages currently in any INBOX bowl whose to_addrs or cc_addrs contain a matching address
    const rows = await q`
      SELECT m.id, m.to_addrs, m.cc_addrs
      FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE b.is_inbox = true
    `

    const idsToMove: string[] = []
    for (const row of rows) {
      const toAddrs = Array.isArray(row.to_addrs) ? row.to_addrs : JSON.parse(row.to_addrs || '[]')
      const ccAddrs = Array.isArray(row.cc_addrs) ? row.cc_addrs : JSON.parse(row.cc_addrs || '[]')
      const allEmails = [...toAddrs, ...ccAddrs]
        .map((a: any) => (a.email || '').toLowerCase())
      if (allEmails.some((e: string) => lowercased.includes(e))) {
        idsToMove.push(row.id)
      }
    }

    if (idsToMove.length === 0) return 0
    await q`UPDATE messages SET bowl_id = ${bowlId} WHERE id = ANY(${idsToMove})`
    return idsToMove.length
  },
  // Walks every message currently in `bowlId` and deletes any whose To/CC
  // doesn't include any of `addresses`. Used to clean up bowls that received
  // misrouted mail before bowl addresses were correctly configured. Sent
  // messages (routed by From, not To/CC) are left alone.
  //
  // Destructive — these messages exist only in Cereal's local DB; the
  // originals remain on the IMAP server. Future IMAP syncs won't re-add them
  // (with the new "skip unmatched mail" routing) unless their addresses get
  // added to a bowl later.
  async deleteUnmatched(bowlId: string, addresses: string[]): Promise<number> {
    const lowercased = addresses.map(a => a.toLowerCase())

    const rows = await q`
      SELECT id, to_addrs, cc_addrs, is_sent FROM messages WHERE bowl_id = ${bowlId}
    ` as Array<{ id: string; to_addrs: any; cc_addrs: any; is_sent: boolean }>

    const idsToDelete: string[] = []
    for (const row of rows) {
      if (row.is_sent) continue
      const toAddrs = Array.isArray(row.to_addrs) ? row.to_addrs : JSON.parse(row.to_addrs || '[]')
      const ccAddrs = Array.isArray(row.cc_addrs) ? row.cc_addrs : JSON.parse(row.cc_addrs || '[]')
      const allEmails = [...toAddrs, ...ccAddrs]
        .map((a: any) => (a.email || '').toLowerCase())
      const matches = lowercased.length > 0 && allEmails.some((e: string) => lowercased.includes(e))
      if (!matches) idsToDelete.push(row.id)
    }

    if (idsToDelete.length === 0) return 0
    await q`DELETE FROM messages WHERE id = ANY(${idsToDelete})`
    return idsToDelete.length
  },
  async getByUid(accountId: string, folderId: string, uid: number): Promise<Message | null> {
    const rows = await q`
      SELECT * FROM messages WHERE account_id = ${accountId} AND folder_id = ${folderId} AND uid = ${uid}
    `
    return rows[0] ? rowToMessage(rows[0]) : null
  },
  async getMaxUid(accountId: string, folderId: string): Promise<number> {
    const rows = await q`SELECT MAX(uid) as max_uid FROM messages WHERE account_id = ${accountId} AND folder_id = ${folderId}`
    return Number(rows[0]?.max_uid ?? 0)
  },
  async delete(accountId: string, folderId: string, uid: number): Promise<void> {
    await q`DELETE FROM messages WHERE account_id = ${accountId} AND folder_id = ${folderId} AND uid = ${uid}`
  },
  async search(bowlId: string, userId: string, query: string, limit = 20): Promise<Message[]> {
    const like = `%${escapeLike(query)}%`
    const rows = await q`
      SELECT m.* FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE m.bowl_id = ${bowlId} AND b.user_id = ${userId}
        AND (m.subject ILIKE ${like} OR m.from_email ILIKE ${like}
             OR m.from_name ILIKE ${like} OR m.preview ILIKE ${like})
      ORDER BY m.date DESC LIMIT ${limit}
    `
    return rows.map(rowToMessage)
  },
  // Global search across all bowls (including inbox)
  async searchAll(userId: string, query: string, limit = 30): Promise<Message[]> {
    const like = `%${escapeLike(query)}%`
    const rows = await q`
      SELECT m.* FROM messages m
      JOIN bowls b ON b.id = m.bowl_id
      WHERE b.user_id = ${userId}
        AND (m.subject ILIKE ${like}
             OR m.from_email ILIKE ${like}
             OR m.from_name ILIKE ${like}
             OR m.preview ILIKE ${like})
      ORDER BY m.date DESC LIMIT ${limit}
    `
    return rows.map(rowToMessage)
  },
}

// ─── Sync state queries ───────────────────────────────────────────────────────

export const syncQueries = {
  async get(accountId: string, folderId: string): Promise<SyncState | null> {
    const rows = await q`
      SELECT * FROM sync_state WHERE account_id = ${accountId} AND folder_id = ${folderId}
    `
    return rows[0] ? { accountId: rows[0].account_id, folderId: rows[0].folder_id, lastUid: rows[0].last_uid, lastSync: Number(rows[0].last_sync) } : null
  },
  async upsert(state: SyncState): Promise<void> {
    await q`
      INSERT INTO sync_state (account_id, folder_id, last_uid, last_sync)
      VALUES (${state.accountId}, ${state.folderId}, ${state.lastUid}, ${state.lastSync})
      ON CONFLICT (account_id, folder_id) DO UPDATE SET
        last_uid  = excluded.last_uid,
        last_sync = excluded.last_sync
    `
  },
}

// ─── Agent message queries ────────────────────────────────────────────────────

export const agentQueries = {
  async insert(msg: AgentMessage): Promise<void> {
    await q`
      INSERT INTO agent_messages (
        id, bowl_id, agent_id, direction, type, content,
        options, resolved, resolution, related_message_id, created_at
      ) VALUES (
        ${msg.id}, ${msg.bowlId ?? null}, ${msg.agentId}, ${msg.direction},
        ${msg.type}, ${msg.content},
        ${msg.options ? JSON.stringify(msg.options) : null},
        ${msg.resolved ?? false}, ${msg.resolution ?? null},
        ${msg.relatedMessageId ?? null}, ${msg.createdAt}
      )
    `
  },
  async getByBowl(bowlId: string | null, userId: string, limit = 50): Promise<AgentMessage[]> {
    // Scope by user via the bowl's user_id when bowl is specified, or by
    // matching agent_messages whose related bowl belongs to the user when
    // not (e.g., "all decisions across my bowls").
    const rows = bowlId
      ? await q`
          SELECT am.* FROM agent_messages am
          JOIN bowls b ON b.id = am.bowl_id
          WHERE am.bowl_id = ${bowlId} AND b.user_id = ${userId}
          ORDER BY am.created_at DESC LIMIT ${limit}
        `
      : await q`
          SELECT am.* FROM agent_messages am
          JOIN bowls b ON b.id = am.bowl_id
          WHERE b.user_id = ${userId}
          ORDER BY am.created_at DESC LIMIT ${limit}
        `
    return rows.map(rowToAgentMessage)
  },
  async resolve(id: string, userId: string, resolution: string): Promise<void> {
    // Scope the resolve to only update messages belonging to this user's bowls.
    await q`
      UPDATE agent_messages
      SET resolved = true, resolution = ${resolution}
      WHERE id = ${id}
        AND bowl_id IN (SELECT id FROM bowls WHERE user_id = ${userId})
    `
  },
  async getPendingDecisions(userId: string): Promise<AgentMessage[]> {
    const rows = await q`
      SELECT am.* FROM agent_messages am
      JOIN bowls b ON b.id = am.bowl_id
      WHERE am.type = 'decision' AND am.resolved = false AND b.user_id = ${userId}
      ORDER BY am.created_at ASC
    `
    return rows.map(rowToAgentMessage)
  },
}

// ─── Agent API key queries ────────────────────────────────────────────────────

export const agentKeyQueries = {
  async list(userId: string): Promise<Array<{ id: string; label: string; agentId: string; createdAt: number; lastUsed: number | null; keyPreview: string }>> {
    const rows = await q`
      SELECT id, key_prefix, label, agent_id, created_at, last_used
      FROM agent_keys
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return rows.map(r => ({
      id: r.id,
      label: r.label,
      agentId: r.agent_id,
      createdAt: Number(r.created_at),
      lastUsed: r.last_used ? Number(r.last_used) : null,
      keyPreview: r.key_prefix,
    }))
  },
  /**
   * Stores only the hash + a display prefix. The full key is returned to the
   * caller once and then discarded by the DB — there is no way to recover it.
   */
  async create(label: string, agentId: string, key: string, userId: string): Promise<{ id: string; key: string }> {
    // Crypto-secure id. 8 random bytes = 64 bits = ~2 billion-billion possible
    // values, no collision risk in practice. Was Math.random() previously
    // which only has ~38 bits of entropy.
    const id = `agk_${randomBytes(8).toString('hex')}`
    const hash = hashToken(key)
    const prefix = keyPreview(key)
    await q`
      INSERT INTO agent_keys (id, user_id, key_hash, key_prefix, label, agent_id, created_at)
      VALUES (${id}, ${userId}, ${hash}, ${prefix}, ${label}, ${agentId}, ${Date.now()})
    `
    return { id, key }
  },
  async findByKey(key: string): Promise<{ id: string; userId: string; agentId: string; label: string } | null> {
    const hash = hashToken(key)
    const rows = await q`
      SELECT id, user_id, agent_id, label FROM agent_keys
      WHERE key_hash = ${hash} LIMIT 1
    `
    if (!rows[0]) return null
    q`UPDATE agent_keys SET last_used = ${Date.now()} WHERE id = ${rows[0].id}`.catch(() => {})
    return {
      id: rows[0].id,
      userId: rows[0].user_id,
      agentId: rows[0].agent_id,
      label: rows[0].label,
    }
  },
  async delete(id: string, userId: string): Promise<void> {
    await q`DELETE FROM agent_keys WHERE id = ${id} AND user_id = ${userId}`
  },
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToBowl(row: any): Bowl {
  return {
    id: row.id, name: row.name, color: row.color,
    isSpam: Boolean(row.is_spam),
    isInbox: Boolean(row.is_inbox),
    isAgent: Boolean(row.is_agent),
    defaultFrom: row.default_from ?? null,
    addresses: Array.isArray(row.addresses) ? row.addresses : JSON.parse(row.addresses || '[]'),
    createdAt: Number(row.created_at),
  }
}

function rowToAccount(row: any): Account {
  const authType: 'password' | 'oauth' = row.auth_type === 'oauth' ? 'oauth' : 'password'
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label, provider: row.provider,
    imapHost: row.imap_host, imapPort: row.imap_port, imapSecure: Boolean(row.imap_secure),
    username: row.username, password: decrypt(row.password),
    smtpHost: row.smtp_host, smtpPort: row.smtp_port, smtpSecure: Boolean(row.smtp_secure),
    defaultFrom: row.default_from,
    aliases: Array.isArray(row.aliases) ? row.aliases : JSON.parse(row.aliases || '[]'),
    createdAt: Number(row.created_at),
    authType,
    oauthProvider: row.oauth_provider || undefined,
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    accessToken: row.access_token ? decrypt(row.access_token) : undefined,
    tokenExpiresAt: row.token_expires_at ? Number(row.token_expires_at) : undefined,
  }
}

function rowToFolder(row: any): Folder {
  return {
    id: row.id, accountId: row.account_id, name: row.name,
    displayName: row.display_name, uidvalidity: Number(row.uidvalidity),
    uidnext: Number(row.uidnext), messageCount: row.message_count,
  }
}

function rowToMessage(row: any): Message {
  return {
    id: row.id, accountId: row.account_id, bowlId: row.bowl_id, folderId: row.folder_id,
    uid: row.uid, messageId: row.message_id, threadId: row.thread_id,
    fromName: row.from_name, fromEmail: row.from_email,
    toAddrs: Array.isArray(row.to_addrs) ? row.to_addrs : JSON.parse(row.to_addrs || '[]'),
    ccAddrs: Array.isArray(row.cc_addrs) ? row.cc_addrs : JSON.parse(row.cc_addrs || '[]'),
    subject: row.subject, preview: row.preview, date: Number(row.date),
    seen: Boolean(row.seen), flagged: Boolean(row.flagged),
    answered: Boolean(row.answered), hasAttachments: Boolean(row.has_attachments),
    isSent: Boolean(row.is_sent),
    createdAt: Number(row.created_at),
  }
}

function rowToAgentMessage(row: any): AgentMessage {
  return {
    id: row.id, bowlId: row.bowl_id, agentId: row.agent_id,
    direction: row.direction, type: row.type, content: row.content,
    options: row.options ? (Array.isArray(row.options) ? row.options : JSON.parse(row.options)) : undefined,
    resolved: Boolean(row.resolved), resolution: row.resolution ?? undefined,
    relatedMessageId: row.related_message_id ?? undefined, createdAt: Number(row.created_at),
  }
}

// ─── User queries ─────────────────────────────────────────────────────────────
// Defined here for use by step 2 (auth endpoints). Not wired into any route
// in step 1 — schema-only deploy means we ship these alongside the migration
// so the next step is a pure additive change.

export interface UserRow {
  id: string
  email: string
  passwordHash: string
  createdAt: number
}

function rowToUser(row: any): UserRow {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: Number(row.created_at),
  }
}

export const userQueries = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const normalized = email.trim().toLowerCase()
    const rows = await q`SELECT * FROM users WHERE email = ${normalized} LIMIT 1`
    return rows[0] ? rowToUser(rows[0]) : null
  },
  async findById(id: string): Promise<UserRow | null> {
    const rows = await q`SELECT * FROM users WHERE id = ${id} LIMIT 1`
    return rows[0] ? rowToUser(rows[0]) : null
  },
  async create(email: string, passwordHash: string): Promise<UserRow> {
    // Crypto-secure id. User ids appear in URLs, logs, and routing decisions
    // throughout the app; 8 random bytes (64 bits) is plenty for non-guessable
    // uniqueness. Was Math.random() previously (~38 bits).
    const id = `usr_${randomBytes(8).toString('hex')}`
    const normalized = email.trim().toLowerCase()
    const createdAt = Date.now()
    await q`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES (${id}, ${normalized}, ${passwordHash}, ${createdAt})
    `
    return { id, email: normalized, passwordHash, createdAt }
  },
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await q`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`
  },
  async delete(id: string): Promise<void> {
    // CASCADE on user_id FKs in bowls/accounts/sessions/agent_keys handles
    // every dependent row. Messages cascade through bowls; folders cascade
    // through accounts.
    await q`DELETE FROM users WHERE id = ${id}`
  },
  async count(): Promise<number> {
    const rows = await q`SELECT COUNT(*)::int as c FROM users` as Array<{ c: number }>
    return rows[0]?.c ?? 0
  },
}

// ─── Invite code queries ──────────────────────────────────────────────────────
// Codes are stored as-is (case sensitive); callers should normalize input
// before lookup. The redeem path is intentionally atomic via a conditional
// UPDATE+RETURNING so two users hitting the last slot simultaneously can't
// both pass: at most one UPDATE will affect a row.
export const inviteCodeQueries = {
  /**
   * Atomically check + claim a code. Returns true on successful claim, false
   * if the code is unknown, expired, or exhausted. The corresponding
   * redemption row is written after the successful claim so the two writes
   * are tightly coupled, but in separate statements (the serverless driver
   * doesn't support transactions across statements; the worst case here is
   * a phantom redemption row that points at a now-deleted user, which the
   * CASCADE on the FK cleans up).
   */
  async tryRedeem(code: string, userId: string): Promise<boolean> {
    const now = Date.now()
    const trimmed = code.trim()
    if (!trimmed) return false
    const rows = await q`
      UPDATE invite_codes
      SET used_count = used_count + 1
      WHERE code = ${trimmed}
        AND (max_uses IS NULL OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > ${now})
      RETURNING used_count
    ` as Array<{ used_count: number }>
    if (!rows[0]) return false
    await q`
      INSERT INTO invite_code_redemptions (code, user_id, redeemed_at)
      VALUES (${trimmed}, ${userId}, ${now})
    `
    return true
  },
  /**
   * Lightweight existence check used by signup BEFORE redeeming (we want to
   * validate the code looks valid without consuming a slot, since signup
   * can still fail downstream on email-already-exists). The actual claim
   * happens via tryRedeem after the user row is created.
   */
  async isValid(code: string): Promise<boolean> {
    const now = Date.now()
    const trimmed = code.trim()
    if (!trimmed) return false
    const rows = await q`
      SELECT 1 FROM invite_codes
      WHERE code = ${trimmed}
        AND (max_uses IS NULL OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > ${now})
      LIMIT 1
    `
    return rows.length > 0
  },
  /**
   * Check whether ANY usable invite code exists. Used by the signup route
   * to decide: gated mode (require code) vs open mode (anyone can sign up).
   *
   * Returns true if there's at least one code that's not exhausted and not
   * expired. The signup endpoint flips into gated mode the moment a single
   * code is seeded — this is how an operator locks down a public instance
   * without a code change. Cleared by deleting/expiring all rows.
   */
  async hasAnyActive(): Promise<boolean> {
    const now = Date.now()
    const rows = await q`
      SELECT 1 FROM invite_codes
      WHERE (max_uses IS NULL OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > ${now})
      LIMIT 1
    `
    return rows.length > 0
  },
  /** Admin helper: create a code. Used from SQL/CLI, not user-facing. */
  async create(opts: {
    code: string
    label: string
    maxUses?: number | null
    expiresAt?: number | null
    notes?: string | null
  }): Promise<void> {
    await q`
      INSERT INTO invite_codes (code, label, max_uses, used_count, expires_at, created_at, notes)
      VALUES (
        ${opts.code.trim()},
        ${opts.label},
        ${opts.maxUses ?? null},
        0,
        ${opts.expiresAt ?? null},
        ${Date.now()},
        ${opts.notes ?? null}
      )
    `
  },
  /** Admin helper: stats for one code. */
  async getStats(code: string): Promise<{
    code: string; label: string; usedCount: number; maxUses: number | null; expiresAt: number | null
  } | null> {
    const rows = await q`
      SELECT code, label, used_count, max_uses, expires_at
      FROM invite_codes WHERE code = ${code.trim()}
    ` as Array<{ code: string; label: string; used_count: number; max_uses: number | null; expires_at: number | null }>
    if (!rows[0]) return null
    return {
      code: rows[0].code,
      label: rows[0].label,
      usedCount: rows[0].used_count,
      maxUses: rows[0].max_uses,
      expiresAt: rows[0].expires_at,
    }
  },
}

// ─── Session queries ──────────────────────────────────────────────────────────
// Tokens are random 256-bit values (43 base64url chars). Stored as plaintext
// since they're already high-entropy bearer credentials — hashing them in DB
// adds complexity without meaningful security gain (unlike passwords, they
// aren't reused across services and don't need to survive a DB leak: revoke
// all sessions if the DB leaks).
//
// Sessions auto-expire via expires_at. Cleanup runs on every login + on a
// periodic timer; expired sessions are also rejected at lookup time.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export const sessionQueries = {
  async create(userId: string): Promise<{ token: string; expiresAt: number }> {
    const { randomBytes } = await import('crypto')
    // 32 bytes = 256 bits of entropy. Base64url-encoded for transport.
    const token = randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(token)
    const now = Date.now()
    const expiresAt = now + SESSION_TTL_MS
    // Store the HASH, not the raw token. A DB dump now no longer grants
    // session takeover — the raw token is only ever in the user's browser.
    await q`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used)
      VALUES (${tokenHash}, ${userId}, ${now}, ${expiresAt}, ${now})
    `
    return { token, expiresAt }
  },
  /**
   * Look up by token. The incoming bearer token is hashed before comparison,
   * so the DB never holds the raw value. Returns null if not found, expired,
   * or invalid. Updates last_used on hit (fire and forget).
   */
  async findByToken(token: string): Promise<{ userId: string; expiresAt: number } | null> {
    if (!token) return null
    const tokenHash = sha256Hex(token)
    const rows = await q`
      SELECT user_id, expires_at FROM sessions
      WHERE token_hash = ${tokenHash} AND expires_at > ${Date.now()}
      LIMIT 1
    ` as Array<{ user_id: string; expires_at: number }>
    if (!rows[0]) return null
    q`UPDATE sessions SET last_used = ${Date.now()} WHERE token_hash = ${tokenHash}`.catch(() => {})
    return { userId: rows[0].user_id, expiresAt: Number(rows[0].expires_at) }
  },
  async revoke(token: string): Promise<void> {
    const tokenHash = sha256Hex(token)
    await q`DELETE FROM sessions WHERE token_hash = ${tokenHash}`
  },
  async revokeAllForUser(userId: string): Promise<void> {
    await q`DELETE FROM sessions WHERE user_id = ${userId}`
  },
  async cleanupExpired(): Promise<number> {
    const result = await q`DELETE FROM sessions WHERE expires_at <= ${Date.now()}` as any
    return result?.count || 0
  },
}

// ─── Password reset token queries ─────────────────────────────────────────────

export const passwordResetQueries = {
  /**
   * Store a new reset token hash for a user. Any previous unused tokens for
   * the same user are invalidated first — exactly one reset link is live at
   * a time, and requesting a new one kills the old email's link.
   */
  async create(userId: string, tokenHash: string, expiresAt: number): Promise<void> {
    await q`DELETE FROM password_reset_tokens WHERE user_id = ${userId} AND used_at IS NULL`
    await q`
      INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, used_at)
      VALUES (${tokenHash}, ${userId}, ${Date.now()}, ${expiresAt}, ${null})
    `
    // Opportunistic cleanup so the table doesn't accumulate dead rows.
    q`DELETE FROM password_reset_tokens WHERE expires_at <= ${Date.now()}`.catch(() => {})
  },
  /**
   * Look up a token by its hash. Returns the owning user id only if the
   * token exists, hasn't been used, and hasn't expired.
   */
  async findValid(tokenHash: string): Promise<{ userId: string } | null> {
    const rows = await q`
      SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > ${Date.now()}
      LIMIT 1
    ` as Array<{ user_id: string }>
    return rows[0] ? { userId: rows[0].user_id } : null
  },
  /** Burn a token after a successful reset. */
  async markUsed(tokenHash: string): Promise<void> {
    await q`UPDATE password_reset_tokens SET used_at = ${Date.now()} WHERE token_hash = ${tokenHash}`
  },
}
