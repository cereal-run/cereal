import { useState, useEffect, useCallback } from 'react'
import { getMessages, getAgentMessages, sendToAgent, resolveDecision, updateBowl, deleteBowl, resyncBowl } from '../api'
import { EmailCard } from './EmailCard'
import { AgentCard } from './AgentCard'
import { SpamVerificationCard } from './SpamVerificationCard'
import { MessageViewer } from './MessageViewer'
import { ComposeModal } from './ComposeModal'
import { ComposeIcon, ArrowRightIcon } from './Icons'
import type { Bowl, Message, AgentMessage } from '../types'
import styles from './Bowl.module.css'

const COLORS = ['#ff6b35', '#f72585', '#7b2fff', '#3a86ff']

interface Props {
  bowl: Bowl
  refreshTrigger?: number
  onNewMessage?: (bowlId: string) => void
  onUpdate?: (id: string, updates: Partial<Bowl>) => void
  onDelete?: (id: string) => void
}

export function BowlCard({ bowl, refreshTrigger, onNewMessage, onUpdate, onDelete }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null)
  const [forwardData, setForwardData] = useState<{
    fromEmail: string; fromName: string | null; subject: string | null; date: number; body: string
  } | null>(null)
  const [composing, setComposing] = useState(false)
  const [agentInput, setAgentInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const PAGE_SIZE = 12
  const isAgent = bowl.id === 'agent' || bowl.name.toLowerCase() === 'agent'

  const loadMessages = useCallback(async () => {
    try {
      if (isAgent) {
        const { messages: msgs } = await getAgentMessages(bowl.id, 20)
        setAgentMessages(msgs.reverse())
      } else {
        const { messages: msgs } = await getMessages(bowl.id, { limit: PAGE_SIZE })
        setMessages(msgs)
        setHasMore(msgs.length === PAGE_SIZE)
      }
    } catch {}
    setLoading(false)
  }, [bowl.id, isAgent])

  // Refresh button: trigger a server-side IMAP sync (pulls new mail from the
  // mail server), then reload from the DB. New messages also arrive via WS,
  // but reloading guarantees the list reflects the sync even if a WS event
  // was missed. The spinner runs for the whole round-trip so the button
  // never feels dead.
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (!isAgent) {
        await resyncBowl(bowl.id).catch(() => {}) // best-effort; reload regardless
      }
      await loadMessages()
    } finally {
      setRefreshing(false)
    }
  }

  async function loadMore() {
    if (loadingMore || isAgent) return
    setLoadingMore(true)
    try {
      const { messages: msgs } = await getMessages(bowl.id, {
        limit: PAGE_SIZE,
        offset: messages.length,
      })
      if (msgs.length > 0) {
        // Dedupe by id in case of overlap
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const newOnes = msgs.filter(m => !existingIds.has(m.id))
          return [...prev, ...newOnes]
        })
      }
      setHasMore(msgs.length === PAGE_SIZE)
    } catch {}
    setLoadingMore(false)
  }

  useEffect(() => { loadMessages() }, [loadMessages])
  useEffect(() => { if (onNewMessage) loadMessages() }, [onNewMessage, loadMessages])

  // WebSocket triggers: reload messages without setting loading=true (no flash)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      const silentLoad = async () => {
        try {
          if (isAgent) {
            const { messages: msgs } = await getAgentMessages(bowl.id, 20)
            setAgentMessages(msgs.reverse())
          } else {
            // Reload current page count to keep what's already shown
            const currentCount = Math.max(messages.length, PAGE_SIZE)
            const { messages: msgs } = await getMessages(bowl.id, { limit: currentCount })
            setMessages(msgs)
            setHasMore(msgs.length === currentCount)
          }
        } catch {}
      }
      silentLoad()
    }
  }, [refreshTrigger, bowl.id, isAgent])

  const unreadCount = bowl.unreadCount ?? messages.filter(m => !m.seen).length

  async function handleAgentSend() {
    if (!agentInput.trim()) return
    try {
      await sendToAgent('agent', agentInput, bowl.id)
      setAgentInput('')
      loadMessages()
    } catch {}
  }

  async function handleResolve(id: string, resolution: string) {
    await resolveDecision(id, resolution)
    loadMessages()
  }

  function handleReply(message: Message) {
    setReplyToMessage(message)
    setForwardData(null)
    setSelectedMessage(null)
    setComposing(true)
  }

  function handleForward(message: Message, body: { textHtml: string | null; textPlain: string | null }) {
    // Strip HTML tags for the forwarded body (use plain if available, else strip html)
    const bodyText = body.textPlain ?? (body.textHtml ? stripHtml(body.textHtml) : '')
    setForwardData({
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      subject: message.subject,
      date: message.date,
      body: bodyText,
    })
    setReplyToMessage(null)
    setSelectedMessage(null)
    setComposing(true)
  }

  function handleCompose() {
    setReplyToMessage(null)
    setForwardData(null)
    setComposing(true)
  }

  function handleCloseCom() {
    setComposing(false)
    setReplyToMessage(null)
    setForwardData(null)
  }

  return (
    <>
      <div
        className={styles.bowl}
        data-bowl-id={bowl.id}
        tabIndex={-1}
        style={{
          ['--bowl-color' as any]: bowl.color,
          ...(isAgent ? {
            background: '#1c1a17',
            color: '#e8e3da',
            fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
            borderColor: 'rgba(255,255,255,0.06)',
          } : {}),
        }}
      >
        {/* Header */}
        <div
          className={styles.header}
          style={isAgent ? {
            background: '#0f0e0c',
            borderBottomColor: 'rgba(255,255,255,0.06)',
          } : undefined}
        >
          {!isAgent && (
            <span
              className={styles.headerDot}
              style={{ color: bowl.color }}
              aria-hidden="true"
            />
          )}
          <span className={styles.name} style={isAgent ? { color: '#06d6a0' } : undefined}>
            {isAgent ? '▸ agent' : bowl.name}
          </span>
          {unreadCount > 0 && (
            <span
              className={styles.badge}
              style={{
                background: `${bowl.color}26`,
                color: bowl.color,
              }}
            >
              {unreadCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            className={styles.composeBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
          >
            <svg
              className={refreshing ? styles.spinning : undefined}
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
          {!bowl.isSpam && !isAgent && (
            <button className={styles.composeBtn} onClick={handleCompose} title="Compose">
              <ComposeIcon size={13} color="currentColor" />
            </button>
          )}
          <button
            className={styles.composeBtn}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Bowl settings"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="12" cy="19" r="1.7" />
            </svg>
          </button>
        </div>

        {/* Inline bowl settings */}
        {settingsOpen && (
          <BowlSettings bowl={bowl}
            onClose={() => setSettingsOpen(false)}
            onUpdate={onUpdate}
            onDelete={onDelete} />
        )}

        {/* Messages */}
        <div className={styles.messages}>
          {loading && <div className={styles.loader} />}

          {!loading && isAgent && agentMessages.map(msg => (
            <AgentCard key={msg.id} message={msg} accentColor={bowl.color} onResolve={handleResolve} />
          ))}

          {!loading && !isAgent && bowl.isSpam && (() => {
            // The most recent message is most likely the one with the code you want
            // SpamVerificationCard renders nothing if no code is found
            const newest = messages[0]
            const rest = messages.slice(1)
            return (
              <>
                {newest && <SpamVerificationCard message={newest} onClick={() => setSelectedMessage(newest)} />}
                {newest && (
                  <EmailCard key={newest.id} message={newest} accentColor={bowl.color} onClick={() => setSelectedMessage(newest)} isSpam />
                )}
                {rest.map(msg => (
                  <EmailCard key={msg.id} message={msg} accentColor={bowl.color} onClick={() => setSelectedMessage(msg)} isSpam />
                ))}
              </>
            )
          })()}

          {!loading && !isAgent && !bowl.isSpam && messages.map(msg => (
            <EmailCard key={msg.id} message={msg} accentColor={bowl.color} onClick={() => setSelectedMessage(msg)} />
          ))}

          {!loading && messages.length === 0 && !isAgent && (
            <div className={styles.empty}>All clear</div>
          )}
        </div>

        {/* Agent input */}
        {isAgent && (
          <div className={styles.agentInput} style={{ borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <input
              className={styles.agentTextField}
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              placeholder="Message agent…"
              onKeyDown={e => e.key === 'Enter' && handleAgentSend()}
              style={{
                background: '#0f0e0c',
                color: '#e8e3da',
                borderColor: 'rgba(255,255,255,0.08)',
                fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
                fontSize: '12px',
              }}
            />
            <button
              className={styles.agentSendBtn}
              style={{
                background: 'transparent',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#06d6a0',
              }}
              onClick={handleAgentSend}
            >
              <ArrowRightIcon size={11} color="#06d6a0" />
            </button>
          </div>
        )}

        {/* Load more */}
        {!isAgent && messages.length > 0 && hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className={styles.viewAll}
            style={{
              color: bowl.color,
              border: 'none',
              background: 'transparent',
              cursor: loadingMore ? 'default' : 'pointer',
              fontFamily: 'inherit',
              opacity: loadingMore ? 0.5 : 1,
              width: '100%',
            }}
          >
            <span>{loadingMore ? 'Loading…' : 'Load more'}</span>
            <span className={styles.viewAllCount}>{loadingMore ? '' : `${messages.length} shown`}</span>
          </button>
        )}
        {!isAgent && messages.length > 0 && !hasMore && (
          <div className={styles.viewAll} style={{ color: 'var(--text-3)', opacity: 0.5 }}>
            <span>That's everything</span>
            <span className={styles.viewAllCount}>{messages.length} total</span>
          </div>
        )}
      </div>

      {/* Message viewer with reply */}
      {selectedMessage && (
        <MessageViewer
          message={selectedMessage}
          accentColor={bowl.color}
          onClose={() => setSelectedMessage(null)}
          onReply={() => handleReply(selectedMessage)}
          onForward={(body) => handleForward(selectedMessage, body)}
        />
      )}

      {/* Compose modal */}
      {composing && (
        <ComposeModal
          bowl={bowl}
          replyTo={replyToMessage ? {
            fromEmail: replyToMessage.fromEmail,
            fromName: replyToMessage.fromName,
            subject: replyToMessage.subject,
            messageId: replyToMessage.messageId ?? null,
          } : undefined}
          forward={forwardData ?? undefined}
          onClose={handleCloseCom}
          onSent={() => { handleCloseCom(); loadMessages() }}
        />
      )}
    </>
  )
}

// ── Inline bowl settings ────────────────────────────────────────────────────

function BowlSettings({ bowl, onClose, onUpdate, onDelete }: {
  bowl: Bowl
  onClose: () => void
  onUpdate?: (id: string, updates: Partial<Bowl>) => void
  onDelete?: (id: string) => void
}) {
  const [name, setName] = useState(bowl.name)
  const [color, setColor] = useState(bowl.color)
  const [defaultFrom, setDefaultFrom] = useState(bowl.defaultFrom ?? '')
  const [addresses, setAddresses] = useState<string[]>(bowl.addresses)
  const [newAddr, setNewAddr] = useState('')
  const [addrError, setAddrError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function saveName() {
    if (name.trim() && name !== bowl.name) {
      updateBowl(bowl.id, { name: name.trim() }).catch(() => {})
      onUpdate?.(bowl.id, { name: name.trim() })
    }
  }

  function saveColor(c: string) {
    setColor(c)
    updateBowl(bowl.id, { color: c }).catch(() => {})
    onUpdate?.(bowl.id, { color: c })
  }

  function saveDefaultFrom(addr: string) {
    setDefaultFrom(addr)
    updateBowl(bowl.id, { defaultFrom: addr || undefined }).catch(() => {})
    onUpdate?.(bowl.id, { defaultFrom: addr || null })
  }

  function addAddress() {
    // Split on commas, newlines, semicolons, or whitespace so users can paste
    // a batch (e.g. from a contacts export). Spaces alone aren't a delimiter
    // since they show up inside display names sometimes, but for a pure
    // email-address field whitespace is safe.
    const tokens = newAddr
      .split(/[,;\n\s]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
    if (tokens.length === 0) return

    const valid: string[] = []
    const invalid: string[] = []
    for (const addr of tokens) {
      if (!addr.includes('@') || !addr.split('@')[1]?.includes('.')) {
        invalid.push(addr); continue
      }
      if (addresses.includes(addr) || valid.includes(addr)) continue
      valid.push(addr)
    }

    if (invalid.length > 0 && valid.length === 0) {
      setAddrError(`Not valid: ${invalid.join(', ')}`)
      return
    }
    if (valid.length === 0) {
      setAddrError('Already added.')
      return
    }

    const next = [...addresses, ...valid]
    setAddresses(next)
    const newDefault = defaultFrom || valid[0]
    if (!defaultFrom) setDefaultFrom(newDefault)
    setNewAddr('')
    setAddrError(invalid.length > 0 ? `Added ${valid.length}, skipped invalid: ${invalid.join(', ')}` : '')
    updateBowl(bowl.id, { addresses: next, defaultFrom: newDefault }).catch(() => {})
    onUpdate?.(bowl.id, { addresses: next, defaultFrom: newDefault })
  }

  function removeAddress(addr: string) {
    const next = addresses.filter(a => a !== addr)
    setAddresses(next)
    const newDefault = defaultFrom === addr ? (next[0] ?? '') : defaultFrom
    setDefaultFrom(newDefault)
    updateBowl(bowl.id, { addresses: next, defaultFrom: newDefault || undefined }).catch(() => {})
    onUpdate?.(bowl.id, { addresses: next, defaultFrom: newDefault || null })
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    deleteBowl(bowl.id)
      .then(() => { onDelete?.(bowl.id) })
      .catch((err: Error) => {
        // Show the error inline so the user sees something happened.
        setAddrError(`Delete failed: ${err.message}`)
        setConfirmDelete(false)
      })
  }

  return (
    <div style={{
      // Cover the entire bowl card as an in-place overlay. This sidesteps
      // the bowl's overflow:hidden clipping — when the settings panel is
      // taller than the bowl height, it scrolls internally instead of
      // being cut off at the bottom.
      position: 'absolute',
      inset: 0,
      zIndex: 10,
      padding: '14px 16px',
      background: 'var(--bg-card)',
      fontSize: 12,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: 'var(--text-1)',
      overflowY: 'auto',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Bowl settings
        </span>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 13, padding: 0, lineHeight: 1,
            fontFamily: 'inherit',
          }}
        >✕</button>
      </div>

      {/* Name */}
      <div style={{ marginBottom: 9 }}>
        <label style={{ fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => e.key === 'Enter' && saveName()}
          style={inputStyle}
        />
      </div>

      {/* Reply from + add new address */}
      <div style={{ marginBottom: 9 }}>
        <label style={{ fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>
          Reply from
        </label>
        {addresses.length > 0 ? (
          <select
            value={defaultFrom}
            onChange={e => saveDefaultFrom(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {addresses.map(addr => (
              <option key={addr} value={addr}>{addr}</option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '4px 0' }}>
            No send-as addresses yet — add one below.
          </div>
        )}
        {/* Existing addresses with remove */}
        {addresses.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {addresses.map(addr => (
              <span key={addr} style={{
                fontSize: 10.5, padding: '2px 7px', borderRadius: 100,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {addr}
                <button
                  onClick={() => removeAddress(addr)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-3)', fontSize: 11, padding: 0, lineHeight: 1,
                    fontFamily: 'inherit',
                  }}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <input
            type="email"
            placeholder="add address(es) — comma separated…"
            value={newAddr}
            onChange={e => { setNewAddr(e.target.value); setAddrError('') }}
            onKeyDown={e => e.key === 'Enter' && addAddress()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={addAddress}
            style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 500,
              background: color, color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >Add</button>
        </div>
        {addrError && (
          <div style={{ fontSize: 10.5, color: '#dc2626', marginTop: 4 }}>{addrError}</div>
        )}
      </div>

      {/* Color */}
      <div style={{ marginBottom: 11 }}>
        <label style={{ fontSize: 10.5, color: 'var(--text-3)', display: 'block', marginBottom: 5 }}>Color</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {COLORS.map(c => {
            const selected = c === color
            return (
              <button
                key={c}
                onClick={() => saveColor(c)}
                style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: c, border: 'none', cursor: 'pointer',
                  outline: selected ? `2px solid ${c}` : 'none',
                  outlineOffset: 1,
                  transition: 'transform 0.12s',
                  padding: 0,
                }}
                onMouseOver={e => (e.currentTarget.style.transform = 'scale(1.1)')}
                onMouseOut={e => (e.currentTarget.style.transform = 'scale(1)')}
              />
            )
          })}
          <label style={{ position: 'relative', cursor: 'pointer', display: 'inline-block' }}>
            <input
              type="color"
              value={color}
              onChange={e => saveColor(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
            />
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'conic-gradient(#ff6b35, #f59e0b, #06d6a0, #3a86ff, #7b2fff, #e040a0, #ff6b35)',
              outline: !COLORS.includes(color) ? `2px solid ${color}` : 'none',
              outlineOffset: 1,
            }} />
          </label>
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        style={{
          width: '100%', padding: 6, borderRadius: 6, cursor: 'pointer',
          border: confirmDelete ? '1px solid #dc2626' : '1px solid var(--border)',
          background: confirmDelete ? '#dc2626' : 'transparent',
          color: confirmDelete ? '#fff' : 'var(--text-3)',
          fontSize: 11, fontWeight: confirmDelete ? 600 : 500,
          transition: 'all 0.15s', fontFamily: 'inherit',
        }}
      >
        {confirmDelete ? 'Click again to confirm deletion' : 'Delete this bowl'}
      </button>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 9px', fontSize: 12,
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--bg-card)', color: 'var(--text-1)', outline: 'none',
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
}

function stripHtml(html: string): string {
  // Quick-and-dirty: strip tags and decode common entities for forwarded body
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}
