import * as Sentry from '@sentry/node'

// Error reporting, opt-in via SENTRY_DSN. Without it, every Sentry call
// elsewhere (captureException in the API error handler, the process-level
// handlers below) is a silent no-op. Note: ESM hoists imports, so init runs
// after module evaluation regardless of source position — that's fine here
// because we only use explicit captureException, not auto-instrumentation.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Error reporting only — no performance tracing. Keeps the free tier
    // quota for what matters and avoids instrumenting every DB query.
    tracesSampleRate: 0,
  })
  console.log('[sentry] Error reporting enabled')
}

import { initDb } from './db/index.js'
import { loadConfig, seedDbFromConfig } from './config/loader.js'
import { connectAccount } from './imap/connection.js'
import { createServer } from './api/server.js'
import { broadcast } from './api/ws.js'

process.on('uncaughtException', (err) => {
  console.error('[cereal] Uncaught exception:', err)
  Sentry.captureException(err)
  // Give the event a moment to leave the process before dying. flush()
  // resolves early if there's nothing queued (Sentry not configured).
  Sentry.flush(2000).catch(() => {}).finally(() => process.exit(1))
})

process.on('unhandledRejection', (reason) => {
  console.error('[cereal] Unhandled rejection:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
  Sentry.flush(2000).catch(() => {}).finally(() => process.exit(1))
})

async function main() {
  console.log('🥣 Cereal starting...')
  console.log(`   Node: ${process.version}`)
  console.log(`   PORT: ${process.env.PORT ?? 'not set'}`)
  console.log(`   DATA_DIR: ${process.env.DATA_DIR ?? 'not set'}`)
  console.log(`   CEREAL_API_KEY: ${process.env.CEREAL_API_KEY ? 'set' : 'NOT SET'}`)

  // Load config
  console.log('[config] Loading...')
  const configPath = process.env.CEREAL_CONFIG ?? 'cereal.config.js'
  const config = await loadConfig(configPath)
  console.log('[config] Loaded OK')

  // Init database
  console.log('[db] Connecting to database...')
  await initDb()

  // Seed bowls and accounts from config (if config file exists)
  const { accounts: configAccounts } = seedDbFromConfig(config)
  console.log(`[config] ${configAccounts.length} account(s) from config`)

  // Start API server
  const apiPort = config.apiPort ?? 3847
  console.log(`[api] Starting on port ${apiPort}...`)
  await createServer(config.apiKey, apiPort)
  console.log(`[api] Server running`)

  // MCP server removed pre-launch. The TCP-based JSON-RPC server in
  // src/mcp/server.ts (kept in-tree for reference) used a key-scoping model
  // that predated multi-tenancy. External agents now use the authenticated
  // REST endpoint POST /agent/inbound + the /agent/keys/* routes, which are
  // already scoped per-user. Revisit MCP as a v2 power feature if there's
  // demand.

  // Connect IMAP accounts — always load from DB
  const { accountQueries } = await import('./db/index.js')
  const allAccounts = await accountQueries.getAll()
  console.log(`[imap] Found ${allAccounts.length} account(s) in database`)

  if (allAccounts.length > 0) {
    console.log(`[imap] Connecting ${allAccounts.length} account(s)...`)
    for (const account of allAccounts) {
      try {
        // Log account id rather than label/username/host. Identifies the row
        // for support without putting the user's email address or mail
        // provider in process logs.
        console.log(`[imap] Connecting ${account.id}...`)
        await connectAccount(account, broadcast)
        console.log(`[imap] ${account.id} connected OK`)
      } catch (err: any) {
        console.error(`[imap] Failed to connect ${account.id}:`, err.message)
      }
    }
  } else {
    console.log('[imap] No accounts in database — add via onboarding UI')
  }

  console.log('🥣 Cereal is running')
  console.log(`   API:  http://localhost:${apiPort}`)
  console.log(`   WS:   ws://localhost:${apiPort}/ws`)

  process.on('SIGINT', async () => {
    console.log('\n[cereal] Shutting down...')
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n[cereal] Shutting down...')
    process.exit(0)
  })
}

main().catch(err => {
  console.error('[cereal] Fatal error:', err)
  process.exit(1)
})
