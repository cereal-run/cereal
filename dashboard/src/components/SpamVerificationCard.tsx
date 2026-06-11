import { useState, useEffect } from 'react'
import { getMessageBody } from '../api'
import type { Message } from '../types'
import styles from './SpamVerificationCard.module.css'

interface Props {
  message: Message
  onClick: () => void
}

// Extract a verification code from text. Prioritizes codes that look intentional:
// - Surrounded by words like "code", "verify", "OTP", "PIN", "verification"
// - 4-8 digit numeric or alphanumeric codes
// - Not obvious dates (4-digit years 19xx/20xx) or phone numbers
function extractCode(text: string | null): string | null {
  if (!text) return null

  // Patterns ordered by priority (most specific first)
  const patterns = [
    // "code is 123456" / "code: 123456" / "verification code 123456"
    /\b(?:code|verification(?:\s+code)?|otp|pin|passcode|one[\s-]?time(?:\s+(?:code|password))?)\s*(?:is|:|=)?\s*([A-Z0-9]{4,8})\b/i,
    // "Your code is..." with the code on the next line
    /(?:code|verify)\b[\s\S]{0,30}?\b([A-Z0-9]{4,8})\b/i,
    // Standalone 6-digit numeric code (most common)
    /(?:^|\s|\n)(\d{6})(?:\s|$|\n|[^\d])/,
    // 4 or 5-digit code
    /(?:^|\s|\n)(\d{4,5})(?:\s|$|\n|[^\d])/,
    // Alphanumeric 6-8 chars (uppercase)
    /(?:^|\s|\n)([A-Z0-9]{6,8})(?:\s|$|\n|[^A-Z0-9])/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const code = match[1].toUpperCase()
      // Filter out obvious false positives
      if (/^(19|20)\d{2}$/.test(code)) continue // years
      if (code === '0000' || code === '00000' || code === '000000') continue
      return code
    }
  }
  return null
}

export function SpamVerificationCard({ message, onClick }: Props) {
  const [copied, setCopied] = useState(false)

  // Try subject first (instant), then fetch body if no match
  const subjectCode = extractCode(message.subject)
  const [bodyCode, setBodyCode] = useState<string | null>(null)

  useEffect(() => {
    if (subjectCode) return // already got it from subject
    let cancelled = false
    getMessageBody(message.accountId, message.uid).then(b => {
      if (cancelled) return
      // Strip HTML tags before scanning
      const text = b.textPlain || (b.textHtml ? b.textHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : '')
      setBodyCode(extractCode(text))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [message.id, message.accountId, message.uid, subjectCode])

  const code = subjectCode ?? bodyCode
  const fromLabel = message.fromName || message.fromEmail.split('@')[0]

  if (!code) return null

  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(code!).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0}>
      <div className={styles.from}>{fromLabel}</div>
      <div className={styles.label}>Verification code</div>
      <div className={styles.digits}>
        {code.split('').map((d, i) => (
          <span key={i} className={styles.digit}>{d}</span>
        ))}
      </div>
      <button onClick={copy} style={{
        width: '100%', marginTop: 8, padding: '0.45rem',
        border: 'none', borderRadius: 6, cursor: 'pointer',
        background: copied ? '#06d6a0' : 'rgba(255,255,255,0.08)',
        color: copied ? '#000' : 'var(--text-1)',
        fontSize: '0.72rem', fontWeight: 600,
        fontFamily: 'inherit', transition: 'all 0.15s',
      }}>
        {copied ? '✓ Copied' : 'Copy code'}
      </button>
      <div className={styles.subject}>{message.subject}</div>
    </div>
  )
}
