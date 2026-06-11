import { AttachmentIcon } from './Icons'
import { Avatar } from './Avatar'
import type { Message } from '../types'
import styles from './EmailCard.module.css'

interface Props {
  message: Message
  accentColor: string
  onClick: () => void
  isSpam?: boolean
}

export function EmailCard({ message, accentColor, onClick, isSpam }: Props) {
  const recipient = message.toAddrs?.[0]
  const displayName = message.isSent
    ? (recipient?.name || recipient?.email?.split('@')[0] || 'someone')
    : (message.fromName || message.fromEmail.split('@')[0])
  const displayEmail = message.isSent ? (recipient?.email ?? '') : message.fromEmail
  const time = formatTime(message.date)

  return (
    <div
      className={`${styles.card} ${message.seen ? styles.read : styles.unread} ${isSpam ? styles.spam : ''}`}
      style={{ ['--accent' as any]: accentColor }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <Avatar name={displayName} email={displayEmail} accentColor={accentColor} />
      <div className={styles.content}>
        <div className={styles.top}>
          <span className={styles.from}>
            {message.isSent && (
              <span style={{ color: 'var(--text-3)', fontWeight: 400, marginRight: 4 }}>↗ To</span>
            )}
            {displayName}
          </span>
          <div className={styles.meta}>
            {message.hasAttachments && <AttachmentIcon size={9} color="var(--text-3)" />}
            <span className={styles.time}>{time}</span>
          </div>
        </div>
        <div className={styles.subject}>
          {message.subject || '(no subject)'}
        </div>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`

  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'

  if (diff < 6 * 86_400_000) {
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
