import { useState, useEffect } from 'react'
import { getComposeContext, sendEmail } from '../api'
import { CloseIcon } from './Icons'
import type { Bowl } from '../types'
import styles from './ComposeModal.module.css'

interface Props {
  bowl: Bowl
  replyTo?: {
    fromEmail: string
    fromName: string | null
    subject: string | null
    messageId: string | null
  }
  forward?: {
    fromEmail: string
    fromName: string | null
    subject: string | null
    date: number
    body: string  // already-loaded body text
  }
  onClose: () => void
  onSent: () => void
}

export function ComposeModal({ bowl, replyTo, forward, onClose, onSent }: Props) {
  const [context, setContext] = useState<{
    suggestedFrom: string
    availableFrom: string[]
    accounts: Array<{ id: string; label: string; defaultFrom: string; aliases: string[] }>
  } | null>(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState(replyTo?.fromEmail ?? '')
  const [subject, setSubject] = useState(() => {
    if (replyTo?.subject) {
      return replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`
    }
    if (forward?.subject) {
      return forward.subject.startsWith('Fwd:') ? forward.subject : `Fwd: ${forward.subject}`
    }
    return ''
  })
  const [body, setBody] = useState(() => {
    if (forward) {
      const sender = forward.fromName ? `${forward.fromName} <${forward.fromEmail}>` : forward.fromEmail
      const dateStr = new Date(forward.date).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
      return `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${dateStr}\nSubject: ${forward.subject ?? '(no subject)'}\n\n${forward.body}`
    }
    return ''
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getComposeContext(bowl.id).then(ctx => {
      setContext(ctx)
      setFrom(ctx.suggestedFrom)
    }).catch(() => {})
  }, [bowl.id])

  async function handleSend() {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setError('To, subject, and body are required.')
      return
    }

    if (!context?.accounts.length) {
      setError('No account found for this bowl.')
      return
    }

    // Find the account whose default or aliases include the selected From address
    const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from
    const account = context.accounts.find(a => {
      const accountEmail = a.defaultFrom.match(/<([^>]+)>/)?.[1] ?? a.defaultFrom
      const aliasEmails = a.aliases.map(al => al.match(/<([^>]+)>/)?.[1] ?? al)
      return accountEmail === fromEmail || aliasEmails.includes(fromEmail)
    }) ?? context.accounts[0]

    setSending(true)
    setError('')

    try {
      await sendEmail({
        accountId: account.id,
        from: from,
        to: [{ name: null, email: to.trim() }],
        subject,
        textPlain: body,
        ...(replyTo?.messageId ? { inReplyTo: replyTo.messageId } : {}),
      })
      onSent()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to send.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.modal} style={{ borderTopColor: bowl.color }}>
        <div className={styles.header}>
          <div className={styles.title}>
            <span className={styles.bowlDot} style={{ background: bowl.color }} />
            {forward ? 'Forward' : replyTo ? 'Reply' : 'New message'} · {bowl.name}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <CloseIcon size={11} />
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>From</label>
          {context ? (
            <select
              className={styles.select}
              value={from}
              onChange={e => setFrom(e.target.value)}
            >
              {context.availableFrom.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          ) : (
            <span className={styles.loadingText}>Loading…</span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>To</label>
          <input
            className={styles.input}
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="recipient@example.com"
            autoFocus={!replyTo}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Subject</label>
          <input
            className={styles.input}
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject"
          />
        </div>

        <textarea
          className={styles.body}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message…"
          autoFocus={!!replyTo}
        />

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <button
            className={styles.sendBtn}
            style={{ background: bowl.color }}
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
