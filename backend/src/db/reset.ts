/**
 * Destructive database reset. Drops every table, then re-runs initDb() to
 * recreate the schema clean.
 *
 *   npm run db:reset
 *
 * Guard rails:
 *  - Refuses to run unless CONFIRM_RESET=yes is set, so you can't wipe prod
 *    by reflex. Run as:  CONFIRM_RESET=yes npm run db:reset
 *  - Prints the database host it's about to wipe so you can sanity-check
 *    you're not pointed at production.
 *
 * After a reset, the next server boot (or this script's own initDb call)
 * recreates all tables with the current schema — including the decoupled
 * accounts model and all unique constraints.
 */
import pg from 'pg'
import { initDb } from './index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[reset] DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

if (process.env.CONFIRM_RESET !== 'yes') {
  console.error(
    '[reset] Refusing to run without confirmation.\n' +
    '         This DROPS ALL TABLES and DELETES ALL DATA.\n' +
    '         Re-run as:  CONFIRM_RESET=yes npm run db:reset'
  )
  process.exit(1)
}

// Show which database we're about to wipe (host only — never log credentials).
try {
  const host = new URL(DATABASE_URL).host
  console.log(`[reset] Target database host: ${host}`)
} catch {
  console.log('[reset] Target database: (could not parse host from DATABASE_URL)')
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /sslmode=(require|prefer|verify-ca|verify-full)/.test(DATABASE_URL)
    ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== 'true' }
    : undefined,
})

// Order doesn't matter with CASCADE, but listed child→parent for clarity.
const TABLES = [
  'agent_messages',
  'agent_keys',
  'sync_state',
  'messages',
  'folders',
  'accounts',
  'bowls',
  'sessions',
  'waitlist',
  'users',
]

async function reset() {
  console.log('[reset] Dropping tables...')
  for (const table of TABLES) {
    // The serverless driver: sql.query() runs a plain (non-tagged-template) string.
    // DDL like DROP TABLE has no parameters, so this is the right call.
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
    console.log(`[reset]   dropped ${table}`)
  }

  console.log('[reset] Recreating schema via initDb()...')
  await initDb()

  console.log('[reset] Done. Database is clean and schema is current.')
  process.exit(0)
}

reset().catch((err) => {
  console.error('[reset] Failed:', err)
  process.exit(1)
})
