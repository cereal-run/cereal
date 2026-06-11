/**
 * OAuth provider configuration.
 *
 * Two providers supported:
 *   - google     → Gmail + Google Workspace (single Google OAuth app handles both)
 *   - microsoft  → Outlook.com + Microsoft 365 (single Microsoft OAuth app, /common tenant)
 *
 * Each provider has its own OAuth client (CLIENT_ID + CLIENT_SECRET) that
 * the operator must create:
 *
 *   Google:    Google Cloud Console → Credentials → OAuth 2.0 Client ID (Web)
 *              Authorized redirect URI: {OAUTH_REDIRECT_BASE}/oauth/google/callback
 *              Enable Gmail API on the project
 *
 *   Microsoft: Azure Portal → App registrations → New registration
 *              Redirect URI: {OAUTH_REDIRECT_BASE}/oauth/microsoft/callback
 *              API permissions (Delegated):
 *                IMAP.AccessAsUser.All, SMTP.Send, offline_access, openid, email
 *              Create client secret under "Certificates & secrets"
 *
 * If a provider's env vars aren't set, getProviderConfig() returns null and
 * the OAuth start endpoint returns 503. Other providers still work.
 */

export type OAuthProvider = 'google' | 'microsoft'

export interface OAuthProviderConfig {
  name: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  // What we set on Account.provider for accounts created via this OAuth provider
  accountProvider: 'gmail' | 'outlook'
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  clientId: string
  clientSecret: string
}

export function getOAuthRedirectUri(provider: OAuthProvider): string {
  const base = (process.env.OAUTH_REDIRECT_BASE || '').replace(/\/$/, '')
  if (!base) throw new Error('OAUTH_REDIRECT_BASE environment variable is required')
  return `${base}/oauth/${provider}/callback`
}

export function getDashboardBase(): string {
  const base = (process.env.DASHBOARD_BASE || '').replace(/\/$/, '')
  if (!base) throw new Error('DASHBOARD_BASE environment variable is required')
  return base
}

export function getProviderConfig(provider: OAuthProvider): OAuthProviderConfig | null {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return null
    return {
      name: 'Google',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      // mail.google.com is the legacy "full IMAP/SMTP via OAuth" scope.
      // Required for XOAUTH2 over IMAP/SMTP — the narrower gmail.modify scope
      // does not grant IMAP access.
      scopes: ['https://mail.google.com/', 'openid', 'email'],
      accountProvider: 'gmail',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
      clientId,
      clientSecret,
    }
  }
  if (provider === 'microsoft') {
    const clientId = process.env.MS_OAUTH_CLIENT_ID
    const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return null
    return {
      name: 'Microsoft',
      // /common allows both personal Microsoft accounts and Microsoft 365 work accounts
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://outlook.office.com/SMTP.Send',
        'offline_access',
        'openid',
        'email',
      ],
      accountProvider: 'outlook',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: false, // STARTTLS upgrade on 587
      clientId,
      clientSecret,
    }
  }
  return null
}
