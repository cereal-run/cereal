import path from 'path'
import { pathToFileURL } from 'url'
import type { CerealConfig, Bowl, Account } from '../types.js'

// ─── Build config from environment variables ──────────────────────────────────
// Used when no cereal.config.js is present (hosted deployments).
//
// Pre-multi-tenancy this function also seeded accounts from FASTMAIL_USER /
// FASTMAIL_PASS env vars. Those env vars are now ignored: with per-user data
// scoping, there is no concept of "the operator's accounts" — every account
// belongs to a specific signed-up user. Self-hosters connect their accounts
// through the onboarding UI like anyone else.

function configFromEnv(): CerealConfig {
  const apiKey = process.env.CEREAL_API_KEY
  if (!apiKey) throw new Error('CEREAL_API_KEY environment variable is required')

  return {
    apiPort: Number(process.env.PORT) || 3847,
    mcpPort: 3848,
    dataDir: process.env.DATA_DIR || './data',
    apiKey,
    bowls: [],
    accounts: [],
    mcp: { enabled: false, apiKeys: [] },
  }
}

// ─── Load config — file first, env vars as fallback ───────────────────────────

export async function loadConfig(configPath?: string): Promise<CerealConfig> {
  const resolved = path.resolve(configPath ?? 'cereal.config.js')
  try {
    const mod = await import(pathToFileURL(resolved).href)
    const config: CerealConfig = mod.default ?? mod
    if (!config.apiKey) throw new Error('cereal.config: apiKey is required')
    console.log('[config] Loaded from cereal.config.js')
    // Note: bowls/accounts in the config file are now ignored. See
    // seedDbFromConfig below for the rationale.
    if ((config.bowls?.length ?? 0) > 0 || (config.accounts?.length ?? 0) > 0) {
      console.warn('[config] bowls/accounts in cereal.config.js are ignored — connect accounts through the onboarding UI')
    }
    return config
  } catch (err: any) {
    if (err.message?.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('[config] No config file found, loading from environment variables')
      return configFromEnv()
    }
    throw new Error(`Failed to load config: ${err.message}`)
  }
}

// ─── seedDbFromConfig — DEPRECATED, no-op ────────────────────────────────────
// Kept for callsite compatibility while we phase the call out of index.ts.
// Logs once if anything in the config would have been seeded, otherwise silent.

export function seedDbFromConfig(config: CerealConfig): { bowls: Bowl[]; accounts: Account[] } {
  if ((config.bowls?.length ?? 0) > 0 || (config.accounts?.length ?? 0) > 0) {
    console.warn('[config] seedDbFromConfig is deprecated and does nothing — accounts are created per-user via the UI')
  }
  return { bowls: [], accounts: [] }
}
