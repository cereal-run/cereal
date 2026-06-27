import { useState, useEffect, useRef, useCallback } from 'react'
import { getNotesBowl, setupNotesBowl, saveNotes } from '../api'

/**
 * Notes bowl. A single freeform notepad, autosaved to the server.
 *
 * Self-contained — inline styles using theme CSS variables so it drops in
 * without a matching .module.css. Render it as a bowl card in the grid, as a
 * dedicated route, or wherever you want a persistent scratchpad.
 *
 * Behavior:
 *   - On mount, fetches the notes bowl. If none exists, it's created lazily
 *     the first time the user types (setupNotesBowl), so there's no separate
 *     "set up notes" step — it just works.
 *   - Autosaves 800ms after the user stops typing (debounced), plus a final
 *     save on blur and on unmount so nothing is lost.
 *   - Shows a subtle saved/saving indicator so the user trusts it persisted.
 */
export function NotesBowl({ color = '#f59e0b' }: { color?: string }) {
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const ensuredRef = useRef(false)        // have we created the bowl yet?
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValue = useRef('')

  // Load existing note on mount.
  useEffect(() => {
    let cancelled = false
    getNotesBowl()
      .then(({ bowl }) => {
        if (cancelled) return
        if (bowl) {
          ensuredRef.current = true
          setValue(bowl.notes ?? '')
          latestValue.current = bowl.notes ?? ''
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [])

  const persist = useCallback(async (text: string) => {
    setStatus('saving')
    try {
      // Lazily create the notes bowl on first write so there's no setup step.
      if (!ensuredRef.current) {
        await setupNotesBowl({})
        ensuredRef.current = true
      }
      await saveNotes(text)
      setStatus('saved')
      // Drop the "saved" pill after a moment.
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
    } catch {
      setStatus('idle')
    }
  }, [])

  // Debounced autosave on every change.
  function onChange(text: string) {
    setValue(text)
    latestValue.current = text
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(text), 800)
  }

  // Flush a pending save on blur and on unmount.
  function flush() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    persist(latestValue.current)
  }
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        // Best-effort final save on unmount.
        void saveNotes(latestValue.current).catch(() => {})
      }
    }
  }, [])

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius, 14px)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 320,
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Header — mirrors the bowl header pattern */}
      <div style={{
        padding: '13px 15px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        color,
        boxShadow: '0 8px 16px -6px rgba(0,0,0,0.10), 0 1px 0 rgba(0,0,0,0.04)',
        position: 'relative',
        zIndex: 2,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          border: '2px solid currentColor', background: 'transparent', flexShrink: 0,
        }} />
        <span style={{
          fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.015em',
          flex: 1, color,
        }}>
          Notes
        </span>
        <span style={{
          fontSize: 11,
          color: 'var(--text-3)',
          opacity: status === 'idle' ? 0 : 1,
          transition: 'opacity 0.2s',
        }}>
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>

      {/* The notepad */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        disabled={!loaded}
        placeholder={loaded ? 'Jot anything. Follow-ups, invoice numbers, reminders. Autosaves.' : 'Loading…'}
        spellCheck
        style={{
          flex: 1,
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-1)',
          fontFamily: 'var(--font-body, inherit)',
          fontSize: 13.5,
          lineHeight: 1.65,
          padding: '14px 16px',
          minHeight: 0,
        }}
      />
    </div>
  )
}
