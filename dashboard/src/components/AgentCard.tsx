import type { AgentMessage } from '../types'
import styles from './AgentCard.module.css'

interface Props {
  message: AgentMessage
  accentColor: string
  onResolve?: (id: string, resolution: string) => void
}

export function AgentCard({ message, accentColor, onResolve }: Props) {
  const isAI = message.direction === 'agent_to_human'
  const time = formatAgentTime(message.createdAt)

  return (
    <div
      className={`${styles.card} ${isAI ? styles.ai : styles.you}`}
      style={isAI ? { borderLeftColor: accentColor } : undefined}
    >
      <div className={styles.who} style={isAI ? { color: accentColor } : undefined}>
        {isAI ? message.agentId : 'You'}
      </div>
      <div className={styles.content}>{message.content}</div>

      {message.type === 'decision' && !message.resolved && message.options && (
        <div className={styles.options}>
          {message.options.map(opt => (
            <button
              key={opt}
              className={styles.optBtn}
              style={{ borderColor: accentColor, color: accentColor }}
              onClick={() => onResolve?.(message.id, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {message.type === 'decision' && message.resolved && (
        <div className={styles.resolved}>
          ✓ {message.resolution}
        </div>
      )}

      <div className={styles.time}>{time}</div>
    </div>
  )
}

function formatAgentTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
