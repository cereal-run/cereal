import { useState, useEffect } from 'react'
import { CloseIcon } from '../Icons'
import { updateBowl, deleteBowl, getAccounts, getAgentKeys, createAgentKey, deleteAgentKey } from '../../api'
import type { AgentKey, AccountListItem } from '../../api'
import type { Bowl } from '../../types'
import { SpecialBowlsSetup } from '../SpecialBowlsSetup'
import styles from './Settings.module.css'

interface Props {
  bowls: Bowl[]
  onClose: () => void
  onUpdateBowl: (id: string, updates: Partial<Bowl>) => void
  onDeleteBowl: (id: string) => void
  onGridChange: (cols: number, rows: number) => void
  currentCols: number
  onLogout: () => void
  theme: 'light' | 'dark'
  onThemeChange: (t: 'light' | 'dark') => void
}

const COLORS = ['#ff6b35', '#e040a0', '#7b2fff', '#3a86ff']

const GRID_PRESETS = [
  { label: '2×2', cols: 2 },
  { label: '3×2', cols: 3 },
  { label: '4×2', cols: 4 },
]

export function SettingsPanel({ bowls, onClose, onUpdateBowl, onDeleteBowl, onGridChange, currentCols, onLogout, theme, onThemeChange }: Props) {
  const [tab, setTab] = useState<'visual' | 'technical' | 'agents' | 'shortcuts'>('visual')

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <CloseIcon size={11} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'visual' ? styles.tabActive : ''}`}
            onClick={() => setTab('visual')}
          >Visual</button>
          <button
            className={`${styles.tab} ${tab === 'shortcuts' ? styles.tabActive : ''}`}
            onClick={() => setTab('shortcuts')}
          >Shortcuts</button>
          <button
            className={`${styles.tab} ${tab === 'agents' ? styles.tabActive : ''}`}
            onClick={() => setTab('agents')}
          >Agent keys</button>
          <button
            className={`${styles.tab} ${tab === 'technical' ? styles.tabActive : ''}`}
            onClick={() => setTab('technical')}
          >Technical</button>
        </div>

        <div className={styles.body}>
          {tab === 'visual' && (
            <VisualTab
              bowls={bowls}
              onUpdateBowl={onUpdateBowl}
              onDeleteBowl={onDeleteBowl}
              onGridChange={onGridChange}
              currentCols={currentCols}
              theme={theme}
              onThemeChange={onThemeChange}
            />
          )}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'technical' && (
            <TechnicalTab bowls={bowls} onUpdateBowl={onUpdateBowl} onLogout={onLogout} />
          )}
        </div>
      </div>
    </>
  )
}

function ShortcutsTab() {
  const items = [
    { keys: ['?'], desc: 'Show shortcuts overlay' },
    { keys: ['/'], desc: 'Focus search' },
    { keys: ['⌘', 'K'], desc: 'Open search' },
    { keys: ['S'], desc: 'Open settings' },
    { keys: ['R'], desc: 'Refresh all bowls' },
    { keys: ['Esc'], desc: 'Close any modal' },
    { keys: ['1', '–', '9'], desc: 'Jump to bowl 1 through 9' },
  ]
  return (
    <div className={styles.section}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 14 }}>
        Cereal works fast with the keyboard. These shortcuts work from anywhere in the app, except when you're typing in a field.
      </div>
      {items.map((s, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{s.desc}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {s.keys.map((k, ki) => (
              <kbd key={ki} style={{
                display: 'inline-block',
                padding: '2px 7px', fontSize: 11, fontWeight: 600,
                fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
                background: 'var(--bg)', border: '1px solid var(--border-med)',
                borderRadius: 4, color: 'var(--text-2)',
                minWidth: 20, textAlign: 'center', lineHeight: 1.4,
              }}>{k}</kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function VisualTab({ bowls, onUpdateBowl, onDeleteBowl, onGridChange, currentCols, theme, onThemeChange }: {
  bowls: Bowl[]
  onUpdateBowl: (id: string, updates: Partial<Bowl>) => void
  onDeleteBowl: (id: string) => void
  onGridChange: (cols: number, rows: number) => void
  currentCols: number
  theme: 'light' | 'dark'
  onThemeChange: (t: 'light' | 'dark') => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Theme</div>
      <div className={styles.gridPicker}>
        <button
          className={`${styles.gridOpt} ${theme === 'light' ? styles.gridOptActive : ''}`}
          onClick={() => onThemeChange('light')}
        >Light</button>
        <button
          className={`${styles.gridOpt} ${theme === 'dark' ? styles.gridOptActive : ''}`}
          onClick={() => onThemeChange('dark')}
        >Dark</button>
      </div>

      <div className={styles.sectionTitle} style={{ marginTop: 20 }}>Grid layout</div>
      <div className={styles.gridPicker}>
        {GRID_PRESETS.map(p => (
          <button key={p.cols}
            className={`${styles.gridOpt} ${p.cols === currentCols ? styles.gridOptActive : ''}`}
            onClick={() => onGridChange(p.cols, 2)}
          >{p.label}</button>
        ))}
      </div>
      <div className={styles.sectionTitle} style={{ marginTop: 20 }}>Bowls</div>
      {bowls.map(bowl => (
        <BowlRow key={bowl.id} bowl={bowl} onUpdate={onUpdateBowl} onDelete={onDeleteBowl} />
      ))}
    </div>
  )
}

function BowlRow({ bowl, onUpdate, onDelete }: {
  bowl: Bowl
  onUpdate: (id: string, updates: Partial<Bowl>) => void
  onDelete: (id: string) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(bowl.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function saveName() {
    if (name.trim() && name !== bowl.name) {
      updateBowl(bowl.id, { name: name.trim() }).catch(() => {})
      onUpdate(bowl.id, { name: name.trim() })
    }
    setEditingName(false)
  }

  function saveColor(color: string) {
    updateBowl(bowl.id, { color }).catch(() => {})
    onUpdate(bowl.id, { color })
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    deleteBowl(bowl.id).then(() => onDelete(bowl.id)).catch(() => {})
  }

  return (
    <div className={styles.bowlRow}>
      <div className={styles.bowlRowDot} style={{ background: bowl.color }} />
      {editingName ? (
        <input className={styles.bowlNameInput} value={name}
          onChange={e => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(bowl.name); setEditingName(false) } }}
          autoFocus />
      ) : (
        <span className={styles.bowlRowName} onClick={() => setEditingName(true)}>{bowl.name}</span>
      )}
      <div className={styles.swatchRow}>
        {COLORS.map(c => {
          const selected = c === bowl.color
          return (
            <button
              key={c}
              className={styles.swatchBtn}
              style={{
                background: c,
                outline: selected ? `2px solid ${c}` : 'none',
              }}
              onClick={() => saveColor(c)}
            />
          )
        })}
        <label style={{ position: 'relative', cursor: 'pointer', display: 'inline-block' }}>
          <input
            type="color"
            value={bowl.color}
            onChange={e => saveColor(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
          <div
            className={styles.swatchBtn}
            style={{
              background: 'conic-gradient(#ff6b35, #f59e0b, #06d6a0, #3a86ff, #7b2fff, #e040a0, #ff6b35)',
              outline: !COLORS.includes(bowl.color) ? `2px solid ${bowl.color}` : 'none',
            }}
          />
        </label>
      </div>
      <button
        onClick={handleDelete}
        onBlur={() => setConfirmDelete(false)}
        style={{
          marginLeft: '0.5rem', padding: '0.2rem 0.5rem', borderRadius: 6,
          border: '1px solid var(--border)', background: confirmDelete ? '#ef4444' : 'transparent',
          color: confirmDelete ? '#fff' : 'var(--text-3)', fontSize: '0.65rem', cursor: 'pointer',
          fontWeight: confirmDelete ? 600 : 400, transition: 'all 0.15s',
        }}
      >
        {confirmDelete ? 'Confirm?' : '×'}
      </button>
    </div>
  )
}

function TechnicalTab({ bowls, onUpdateBowl, onLogout }: {
  bowls: Bowl[]
  onUpdateBowl: (id: string, updates: Partial<Bowl>) => void
  onLogout: () => void
}) {
  const [accounts, setAccounts] = useState<AccountListItem[]>([])
  const [expandedBowl, setExpandedBowl] = useState<string | null>(null)

  useEffect(() => {
    getAccounts().then(setAccounts).catch(() => {})
  }, [])

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Bowls & addresses</div>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 12 }}>
          Mail is routed to bowls by To: address. Add every address that should land in each bowl.
        </div>
        {bowls.filter(b => !b.isInbox && !b.isSpam && !b.isAgent).map(bowl => (
          <BowlAddressRow key={bowl.id} bowl={bowl}
            expanded={expandedBowl === bowl.id}
            onToggle={() => setExpandedBowl(expandedBowl === bowl.id ? null : bowl.id)}
            onUpdate={onUpdateBowl} />
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Special bowls</div>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 12 }}>
          Optional bowls for spam catch-all and agent messages. Skip either if you don't need it.
        </div>
        <SpecialBowlsSetup />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Connected accounts</div>
        {accounts.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>No accounts connected</div>
        )}
        {accounts.map(a => (
          <div key={a.id} className={styles.accountRow}>
            <div className={styles.accountInfo}>
              <div className={styles.accountName}>{a.label}</div>
            </div>
            <span className={`${styles.accountStatus} ${a.connected ? styles.statusConnected : styles.statusOffline}`}>
              {a.connected ? 'Connected' : 'Offline'}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <button className={styles.logoutBtn} onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  )
}

function BowlAddressRow({ bowl, expanded, onToggle, onUpdate }: {
  bowl: Bowl
  expanded: boolean
  onToggle: () => void
  onUpdate: (id: string, updates: Partial<Bowl>) => void
}) {
  const [addresses, setAddresses] = useState<string[]>(bowl.addresses)
  const [defaultFrom, setDefaultFrom] = useState<string>(bowl.defaultFrom ?? '')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function addAddress() {
    const addr = input.trim().toLowerCase()
    if (!addr) return
    if (!addr.includes('@') || !addr.split('@')[1]?.includes('.')) {
      setError('Enter a valid email address.')
      return
    }
    if (addresses.includes(addr)) {
      setError('Already added.')
      return
    }
    setError('')
    const next = [...addresses, addr]
    setAddresses(next)
    if (!defaultFrom) setDefaultFrom(addr)
    setInput('')
  }

  function removeAddress(addr: string) {
    const next = addresses.filter(a => a !== addr)
    setAddresses(next)
    if (defaultFrom === addr) setDefaultFrom(next[0] ?? '')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      await updateBowl(bowl.id, { addresses, defaultFrom: defaultFrom || undefined })
      onUpdate(bowl.id, { addresses, defaultFrom: defaultFrom || null })
      onToggle()
    } catch (err: any) {
      setError(err.message || 'Failed to save.')
    }
    setSaving(false)
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      marginBottom: 8,
      overflow: 'hidden',
      background: 'var(--bg-card)',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: bowl.color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', flex: 1, letterSpacing: '-0.005em' }}>{bowl.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {bowl.addresses.length} address{bowl.addresses.length !== 1 ? 'es' : ''}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {expanded && (
        <div style={{
          padding: '4px 12px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          {addresses.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {addresses.map(addr => (
                <div key={addr} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}>
                  <button
                    onClick={() => setDefaultFrom(addr)}
                    title={defaultFrom === addr ? 'Default send-as' : 'Set as default'}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: defaultFrom === addr ? '#c2710c' : 'var(--text-faint)',
                      fontSize: 13, padding: 0, lineHeight: 1, width: 16,
                    }}
                  >
                    {defaultFrom === addr ? '★' : '☆'}
                  </button>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {addr}
                  </span>
                  <button
                    onClick={() => removeAddress(addr)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', fontSize: 14, padding: 0, lineHeight: 1, width: 16,
                    }}
                  >×</button>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
                ★ default send-as address
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input
              type="email"
              placeholder="contact@yourdomain.com"
              value={input}
              onChange={e => { setInput(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && addAddress()}
              style={{
                flex: 1,
                padding: '7px 10px',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-card)',
                color: 'var(--text-1)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={addAddress}
              style={{
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--text-1)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >Add</button>
          </div>

          <button
            onClick={save}
            disabled={saving}
            style={{
              width: '100%',
              marginTop: 10,
              padding: '8px',
              fontSize: 12,
              fontWeight: 500,
              background: 'transparent',
              border: '1px solid var(--border-med)',
              borderRadius: 6,
              cursor: saving ? 'default' : 'pointer',
              color: 'var(--text-1)',
              fontFamily: 'inherit',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}


// ── Agents tab: manage external agent API keys ──────────────────────────────

function AgentsTab() {
  const [keys, setKeys] = useState<AgentKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [justCreatedKey, setJustCreatedKey] = useState<{ key: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getAgentKeys().then(res => { setKeys(res.keys); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!newLabel.trim()) return
    setCreating(true)
    try {
      const res = await createAgentKey(newLabel.trim())
      setJustCreatedKey({ key: res.key, label: res.label })
      setNewLabel('')
      const fresh = await getAgentKeys()
      setKeys(fresh.keys)
    } catch {}
    setCreating(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Revoke this agent key? Any scripts using it will stop working.')) return
    await deleteAgentKey(id)
    const fresh = await getAgentKeys()
    setKeys(fresh.keys)
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const apiBase = import.meta.env.VITE_API_BASE || 'https://your-cereal-backend'

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Intro */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text-2)', lineHeight: 1.55 }}>
        Agent keys let external scripts and AI agents (Claude Code, Cursor, custom bots) post messages directly into your agent bowl.
        Each key has a label so you can revoke individual integrations.
      </div>

      {/* New key just generated */}
      {justCreatedKey && (
        <div style={{
          padding: '0.9rem', borderRadius: 10, background: 'rgba(6,214,160,0.08)',
          border: '1px solid rgba(6,214,160,0.25)',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#06d6a0', marginBottom: 6 }}>
            ✓ Key created for "{justCreatedKey.label}"
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.5 }}>
            Copy this key now. For security, you won't see it again.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <code style={{
              flex: 1, fontSize: '0.7rem', padding: '0.4rem 0.6rem',
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {justCreatedKey.key}
            </code>
            <button
              onClick={() => copyKey(justCreatedKey.key)}
              style={{
                padding: '0.4rem 0.7rem', fontSize: '0.7rem',
                background: copied ? '#06d6a0' : 'var(--bg)', color: copied ? '#000' : 'var(--text-1)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.15s',
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setJustCreatedKey(null)}
              style={{
                padding: '0.4rem 0.6rem', fontSize: '0.7rem',
                background: 'transparent', color: 'var(--text-3)',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create new */}
      <div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Create new key
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="e.g. Claude Code, GitHub Actions, Deploy bot"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            style={{
              flex: 1, padding: '0.45rem 0.7rem', fontSize: '0.78rem',
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--text-1)',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newLabel.trim()}
            style={{
              padding: '0.45rem 0.9rem', fontSize: '0.78rem',
              background: 'var(--text-1)', color: 'var(--bg)',
              border: 'none', borderRadius: 6, cursor: creating ? 'default' : 'pointer',
              fontFamily: 'inherit', fontWeight: 500, opacity: !newLabel.trim() ? 0.4 : 1,
            }}
          >
            {creating ? 'Creating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Existing keys */}
      <div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Active keys
        </div>
        {loading && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Loading…</div>}
        {!loading && keys.length === 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', padding: '0.6rem 0' }}>
            No keys yet. Create one above to let an agent post to your agent bowl.
          </div>
        )}
        {keys.map(k => (
          <div key={k.id} style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.55rem 0', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-1)', fontWeight: 500 }}>{k.label}</div>
              <div style={{
                fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 1,
                fontFamily: 'ui-monospace, monospace',
              }}>
                {k.keyPreview} · agentId: {k.agentId}
                {k.lastUsed && ` · last used ${formatRelative(k.lastUsed)}`}
                {!k.lastUsed && ' · never used'}
              </div>
            </div>
            <button
              onClick={() => handleDelete(k.id)}
              title="Revoke this key"
              style={{
                padding: '0.3rem 0.6rem', fontSize: '0.68rem',
                background: 'transparent', color: 'var(--text-3)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      {/* Usage example */}
      <div style={{
        padding: '0.85rem', borderRadius: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        fontSize: '0.7rem', color: 'var(--text-2)', lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>Usage example</div>
        <div style={{ marginBottom: 6 }}>POST to <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem' }}>{apiBase}/agent/inbound</code> with your key:</div>
        <pre style={{
          margin: '6px 0 0', padding: '0.6rem', background: 'var(--bg)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: '0.65rem', fontFamily: 'ui-monospace, monospace',
          overflow: 'auto', lineHeight: 1.5,
        }}>{`curl ${apiBase}/agent/inbound \\
  -H "X-Agent-Key: cereal_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Tests passing on main", "type": "notification"}'`}</pre>
      </div>
    </div>
  )
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
