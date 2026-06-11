// ─── Bowl (business context) ─────────────────────────────────────────────────

export interface Bowl {
  id: string
  name: string
  color: string
  isSpam: boolean
  isInbox?: boolean              // hidden system catch-all bowl
  isAgent?: boolean              // bowl for agent messages (no email routing)
  defaultFrom: string | null   // primary send address for this bowl
  addresses: string[]          // all addresses that route into this bowl
  createdAt: number
}

// ─── Account (IMAP + SMTP connection) ────────────────────────────────────────

export type Provider =
  | 'gmail'              // OAuth2 app password
  | 'google_workspace'   // same as gmail but different label
  | 'outlook'            // Microsoft OAuth2 / app password
  | 'imap'               // generic IMAP — GoDaddy, Namecheap, Squarespace, etc.

export type AuthType = 'password' | 'oauth'
export type OAuthProvider = 'google' | 'microsoft'

export interface Account {
  id: string
  userId: string         // owner; populated by rowToAccount, required on upsert
  label: string          // display name: "Agency Gmail"
  provider: Provider

  // IMAP
  imapHost: string
  imapPort: number
  imapSecure: boolean
  username: string
  password: string       // empty when authType === 'oauth'

  // SMTP (for sending)
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean

  // Sending identity
  defaultFrom: string    // "Agency Name <hello@agency.com>"
  aliases: string[]      // additional send-as addresses

  createdAt: number

  // Authentication mode. 'password' (default) uses username+password (IMAP/SMTP plain auth).
  // 'oauth' uses XOAUTH2 with a refreshable access token.
  // Optional in the interface for ergonomic construction; rowToAccount and
  // buildImapAuth treat the absence as 'password'.
  authType?: AuthType
  // Only set when authType === 'oauth'
  oauthProvider?: OAuthProvider
  refreshToken?: string       // long-lived, encrypted at rest
  accessToken?: string        // cached short-lived token, encrypted at rest
  tokenExpiresAt?: number     // unix ms; refresh when within 60s of this
}

// ─── Folder (IMAP mailbox) ────────────────────────────────────────────────────

export interface Folder {
  id: string
  accountId: string
  name: string           // IMAP path e.g. "INBOX", "[Gmail]/Sent Mail"
  displayName: string
  uidvalidity: number
  uidnext: number
  messageCount: number
}

// ─── Message (metadata only — bodies fetched on demand) ──────────────────────

export interface Message {
  id: string
  accountId: string
  bowlId: string
  folderId: string
  uid: number
  messageId: string | null
  threadId: string | null  // derived from References/In-Reply-To headers

  fromName: string | null
  fromEmail: string
  toAddrs: EmailAddr[]
  ccAddrs: EmailAddr[]

  subject: string | null
  preview: string | null   // first 200 chars of body text

  date: number             // unix timestamp
  seen: boolean
  flagged: boolean
  answered: boolean
  hasAttachments: boolean
  isSent: boolean          // true for messages from the Sent folder

  createdAt: number
}

export interface EmailAddr {
  name: string | null
  email: string
}

// ─── Message body (fetched on demand, never stored) ──────────────────────────

export interface MessageBody {
  messageId: string
  textPlain: string | null
  textHtml: string | null
  attachments: Attachment[]
}

export interface Attachment {
  filename: string
  contentType: string
  size: number
  contentId: string | null
}

// ─── Thread (virtual grouping by References header) ──────────────────────────

export interface Thread {
  threadId: string
  bowlId: string
  subject: string | null
  participants: EmailAddr[]
  messageCount: number
  unreadCount: number
  lastDate: number
  lastPreview: string | null
  messages?: Message[]
}

// ─── Sync state ───────────────────────────────────────────────────────────────

export interface SyncState {
  accountId: string
  folderId: string
  lastUid: number
  lastSync: number
}

// ─── Agent channel ────────────────────────────────────────────────────────────

export type AgentMessageType = 'text' | 'notification' | 'decision' | 'action_result'
export type AgentDirection = 'agent_to_human' | 'human_to_agent'

export interface AgentMessage {
  id: string
  bowlId: string | null    // null = global / not bowl-specific
  agentId: string
  direction: AgentDirection
  type: AgentMessageType
  content: string

  // For type === 'decision'
  options?: string[]
  resolved?: boolean
  resolution?: string

  // For type === 'notification' | 'action_result'
  relatedMessageId?: string  // links back to an email thread

  createdAt: number
}

// ─── API payloads ─────────────────────────────────────────────────────────────

export interface SendPayload {
  accountId: string
  from?: string             // selected send-as address
  to: EmailAddr[]
  cc?: EmailAddr[]
  bcc?: EmailAddr[]
  subject: string
  textPlain?: string
  textHtml?: string
  inReplyTo?: string    // Message-ID for threading
  references?: string[]
}

export interface ComposeContext {
  bowlId: string
  suggestedFrom: string    // pre-filled based on bowl default
  availableFrom: string[]  // all aliases for this bowl
}

// ─── WebSocket events ─────────────────────────────────────────────────────────

export type WSEvent =
  | { type: 'new_message';    payload: Message }
  | { type: 'message_seen';   payload: { accountId: string; uid: number } }
  | { type: 'message_deleted'; payload: { accountId: string; uid: number } }
  | { type: 'sync_started';   payload: { accountId: string } }
  | { type: 'sync_complete';  payload: { accountId: string; count: number } }
  | { type: 'agent_message';  payload: AgentMessage }
  | { type: 'connection_status'; payload: { accountId: string; status: 'connected' | 'disconnected' | 'error'; error?: string } }

// ─── Config (cereal.config.ts) ────────────────────────────────────────────────

export interface CerealConfig {
  apiPort: number
  mcpPort: number
  dataDir: string          // where SQLite lives
  apiKey: string           // simple auth for the local API

  bowls: BowlConfig[]
  accounts: AccountConfig[]

  mcp?: {
    enabled: boolean
    apiKeys: MCPKeyConfig[]
  }
}

export interface BowlConfig {
  id: string
  name: string
  color: string
  isSpam?: boolean
}

export interface AccountConfig {
  id: string
  bowlId: string
  label: string
  provider: Provider
  username: string
  password: string         // set via env var: process.env.GMAIL_PASS
  defaultFrom: string
  aliases?: string[]
  // Override auto-detected IMAP/SMTP settings if needed
  imapHost?: string
  imapPort?: number
  smtpHost?: string
  smtpPort?: number
}

export interface MCPKeyConfig {
  key: string
  bowlScopes: string[]     // which bowl IDs this key can access
  canSend: boolean
  canNotify: boolean
}
