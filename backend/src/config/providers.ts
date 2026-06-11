import type { Provider } from '../types.js'

interface ProviderPreset {
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  gmail: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  google_workspace: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  outlook: {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
  },
  imap_fastmail: {
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 587,
    smtpSecure: false, // STARTTLS on 587
  },
  imap: {
    // Generic fallback
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
  },
}

// Common generic IMAP providers founders actually use
export const COMMON_IMAP_HOSTS: Record<string, Partial<ProviderPreset>> = {
  'godaddy': {
    imapHost: 'imap.secureserver.net',
    imapPort: 993,
    smtpHost: 'smtpout.secureserver.net',
    smtpPort: 465,
  },
  'namecheap': {
    imapHost: 'mail.privateemail.com',
    imapPort: 993,
    smtpHost: 'mail.privateemail.com',
    smtpPort: 587,
  },
  'squarespace': {
    // Squarespace uses Google Workspace under the hood
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
  },
  'hostinger': {
    imapHost: 'imap.hostinger.com',
    imapPort: 993,
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
  },
  'ionos': {
    imapHost: 'imap.ionos.com',
    imapPort: 993,
    smtpHost: 'smtp.ionos.com',
    smtpPort: 587,
  },
}

export function resolveAccountSettings(
  provider: string,
  username: string,
  overrides: { imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }
): ProviderPreset {
  // Fall back to 'imap' preset if provider not recognized
  const base = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS['imap']
  const preset = { ...base }

  // Apply overrides
  if (overrides.imapHost) preset.imapHost = overrides.imapHost
  if (overrides.imapPort) preset.imapPort = overrides.imapPort
  if (overrides.smtpHost) preset.smtpHost = overrides.smtpHost
  if (overrides.smtpPort) preset.smtpPort = overrides.smtpPort

  // For generic IMAP or unknown providers, try to auto-detect from domain
  if ((provider === 'imap' || !(provider in PROVIDER_PRESETS)) && !overrides.imapHost) {
    const domain = username.split('@')[1]
    if (domain) {
      // Try to infer from known domains
      for (const [key, settings] of Object.entries(COMMON_IMAP_HOSTS)) {
        if (domain.includes(key) || key.includes(domain.split('.')[0])) {
          if (settings.imapHost) preset.imapHost = settings.imapHost
          if (settings.imapPort) preset.imapPort = settings.imapPort
          if (settings.smtpHost) preset.smtpHost = settings.smtpHost
          if (settings.smtpPort) preset.smtpPort = settings.smtpPort
          break
        }
      }
    }
  }

  return preset
}
