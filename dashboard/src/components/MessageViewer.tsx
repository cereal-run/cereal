import { useState, useEffect, useMemo } from 'react'
import { getMessageBody, markSeen, markUnseen } from '../api'
import { CloseIcon, ArrowRightIcon } from './Icons'
import type { Message } from '../types'
import styles from './MessageViewer.module.css'

interface Props {
  message: Message
  accentColor: string
  onClose: () => void
  onReply: () => void
  onForward?: (body: { textHtml: string | null; textPlain: string | null }) => void
  onStatusChange?: () => void
}

/**
 * Wrap untrusted email HTML in a document with a strict Content-Security-Policy.
 *
 * Defense layers (both must fail for script execution):
 *   1. The iframe sandbox attribute blocks scripts and same-origin access.
 *      We deliberately do NOT set allow-same-origin — with srcDoc that would
 *      make the frame same-origin with the dashboard, and any future
 *      addition of allow-scripts would hand email content full access to
 *      localStorage (session token) and the API.
 *   2. The CSP meta tag inside the document blocks script-src entirely
 *      (default-src 'none'), so even if the sandbox were misconfigured,
 *      inline handlers, <script> tags, and javascript: URLs are dead.
 *
 * Remote images and inline styles are allowed — emails are unusable without
 * them. <base target="_blank"> makes links open in a new tab, which the
 * sandbox permits via allow-popups; allow-popups-to-escape-sandbox ensures
 * the opened tab behaves like a normal page instead of inheriting the
 * sandbox restrictions.
 */
function wrapEmailHtml(html: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="',
    "default-src 'none'; ",
    "img-src https: http: data: cid:; ",
    "style-src 'unsafe-inline' https:; ",
    "font-src https: data:",
    '">',
    '<base target="_blank">',
    '<style>',
    'body{margin:0;padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'font-size:14px;line-height:1.5;color:#1a1a1a;background:#ffffff;word-wrap:break-word;overflow-wrap:break-word}',
    'img{max-width:100%;height:auto}',
    'table{max-width:100%}',
    '</style>',
    '</head><body>',
    html,
    '</body></html>',
  ].join('')
}

export function MessageViewer({ message, accentColor, onClose, onReply, onForward, onStatusChange }: Props) {
  const [body, setBody] = useState<{ textHtml: string | null; textPlain: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [seen, setSeenLocal] = useState(message.seen)

  const wrappedHtml = useMemo(
    () => (body?.textHtml ? wrapEmailHtml(body.textHtml) : null),
    [body],
  )

  const fromLabel = message.fromName && message.fromEmail
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail || 'Unknown sender'

  useEffect(() => {
    setLoading(true)
    setSeenLocal(message.seen)
    // IMAP UIDs are unique only WITHIN a folder, so the body and seen calls
    // must target the folder this message actually lives in. Without this,
    // a Sent message (e.g. UID 5 in Sent) fetches INBOX UID 5 — a different
    // email entirely — which is why a sent reply rendered as an unrelated
    // inbox message, and why opening it marked the wrong inbox mail as read.
    const folder = message.isSent ? 'Sent' : 'INBOX'
    getMessageBody(message.accountId, message.uid, folder)
      .then(b => { setBody(b); setLoading(false) })
      .catch(() => setLoading(false))

    // Auto-mark as seen on open
    if (!message.seen) {
      markSeen(message.accountId, [message.uid], folder).catch(() => {})
      setSeenLocal(true)
    }
  }, [message.id, message.accountId, message.uid, message.seen, message.isSent])

  async function toggleSeen() {
    const folder = message.isSent ? 'Sent' : 'INBOX'
    if (seen) {
      await markUnseen(message.accountId, [message.uid], folder).catch(() => {})
      setSeenLocal(false)
    } else {
      await markSeen(message.accountId, [message.uid], folder).catch(() => {})
      setSeenLocal(true)
    }
    onStatusChange?.()
  }

  const date = new Date(message.date).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.panel} style={{ borderTopColor: accentColor }}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.closeBtn} onClick={onClose}>
              <CloseIcon size={11} />
            </button>
            {message.isSent && (
              <span style={{
                fontSize: '0.62rem', padding: '2px 7px', borderRadius: 4,
                background: 'rgba(6,214,160,0.12)', color: '#06d6a0',
                fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                ↗ Sent
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={toggleSeen}
              title={seen ? 'Mark as unread' : 'Mark as read'}
              style={{
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-3)', fontSize: '0.68rem', padding: '0.3rem 0.7rem',
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {seen ? '○ Unread' : '● Read'}
            </button>
            {!message.isSent && (
              <>
                {onForward && body && (body.textHtml || body.textPlain) && (
                  <button
                    onClick={() => onForward(body)}
                    style={{
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--text-2)', fontSize: '0.7rem', padding: '0.35rem 0.7rem',
                      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Forward →
                  </button>
                )}
                <button
                  className={styles.replyBtn}
                  style={{ borderColor: accentColor, color: accentColor }}
                  onClick={() => onReply()}
                >
                  Reply <ArrowRightIcon size={10} color={accentColor} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.meta}>
          <div className={styles.subject}>
            {message.subject || '(no subject)'}
          </div>
          <div className={styles.fromLine}>
            {message.isSent ? 'From you' : fromLabel}
          </div>
          <div className={styles.dateLine}>{date}</div>
          {message.toAddrs.filter(a => a.email && !a.email.includes('undefined')).length > 0 && (
            <div className={styles.toLine}>
              To: {message.toAddrs.filter(a => a.email && !a.email.includes('undefined')).map(a => a.name || a.email).join(', ')}
            </div>
          )}
        </div>

        <div className={styles.body}>
          {loading && <div className={styles.loading}>Loading…</div>}
          {!loading && wrappedHtml && (
            <iframe
              className={styles.iframe}
              srcDoc={wrappedHtml}
              // No allow-scripts, no allow-same-origin. allow-popups lets
              // links (forced to target="_blank" by the <base> tag in the
              // wrapper) open in a new tab; allow-popups-to-escape-sandbox
              // makes that tab a normal page rather than a sandboxed one.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              title="Email body"
            />
          )}
          {!loading && !body?.textHtml && body?.textPlain && (
            <pre className={styles.plain}>{body.textPlain}</pre>
          )}
          {!loading && !body?.textHtml && !body?.textPlain && (
            <div className={styles.empty}>No content to display.</div>
          )}
        </div>
      </div>
    </>
  )
}
