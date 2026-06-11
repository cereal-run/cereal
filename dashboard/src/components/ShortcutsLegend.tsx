import type { Shortcut } from '../hooks/useKeyboardShortcuts'

interface Props {
  shortcuts: Shortcut[]
  onClose: () => void
}

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Meta: '⌘', Cmd: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃',
  Enter: '↵', ' ': 'Space',
}

function formatKey(key: string): string {
  return KEY_LABELS[key] ?? key.toUpperCase()
}

export function ShortcutsLegend({ shortcuts, onClose }: Props) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(22, 20, 16, 0.35)',
          backdropFilter: 'blur(3px)',
          animation: 'fade-overlay 0.15s ease both',
        }}
      />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 501, width: 'min(520px, 92vw)', maxHeight: '80vh',
          background: 'var(--bg-card)', borderRadius: 14,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'fade-in 0.2s ease both',
        }}
      >
        <div style={{
          padding: '20px 24px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              Keyboard shortcuts
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Press <kbd style={kbdStyle}>?</kbd> from anywhere to open this
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-3)', fontSize: 18, padding: '6px 10px',
              borderRadius: 6, fontFamily: 'inherit',
            }}
          >×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 24px 20px' }}>
          {shortcuts.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: i === shortcuts.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
                {s.description}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {s.keys.map((k, ki) => (
                  <kbd key={ki} style={kbdStyle}>{formatKey(k)}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'ui-monospace, SF Mono, Monaco, Consolas, monospace',
  background: 'var(--bg)',
  border: '1px solid var(--border-med)',
  borderRadius: 4,
  color: 'var(--text-2)',
  minWidth: 22,
  textAlign: 'center',
  lineHeight: 1.4,
}
