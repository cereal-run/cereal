export interface Bowl {
  id: string
  name: string
  color: string
  isSpam: boolean
  isInbox?: boolean
  isAgent?: boolean
  defaultFrom: string | null
  addresses: string[]
  createdAt: number
  unreadCount: number
}
export interface Message {
  id: string
  accountId: string
  bowlId: string
  folderId: string
  uid: number
  messageId: string | null
  threadId: string | null
  fromName: string | null
  fromEmail: string
  toAddrs: EmailAddr[]
  ccAddrs: EmailAddr[]
  subject: string | null
  preview: string | null
  date: number
  seen: boolean
  flagged: boolean
  answered: boolean
  hasAttachments: boolean
  isSent?: boolean
  createdAt: number
}
export interface EmailAddr {
  name: string | null
  email: string
}
export interface AgentMessage {
  id: string
  bowlId: string | null
  agentId: string
  direction: 'agent_to_human' | 'human_to_agent'
  type: 'text' | 'notification' | 'decision' | 'action_result'
  content: string
  options?: string[]
  resolved?: boolean
  resolution?: string
  relatedMessageId?: string
  createdAt: number
}
export type WSEvent =
  | { type: 'new_message'; payload: Message }
  | { type: 'message_seen'; payload: { accountId: string; uid: number } }
  | { type: 'sync_complete'; payload: { accountId: string; count: number } }
  | { type: 'agent_message'; payload: AgentMessage }
  | { type: 'connection_status'; payload: { accountId: string; status: string } }
export type BowlType = 'email' | 'agent' | 'spam'
export interface BowlWithMeta extends Bowl {
  bowlType: BowlType
}
