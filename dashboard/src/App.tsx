import { useState, useEffect, useCallback, useMemo } from 'react'
import { getBowls, hasToken, logout, me } from './api'
import { useWebSocket } from './hooks/useWebSocket'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useTheme } from './hooks/useTheme'
import { Logo } from './components/Logo'
import { BowlCard } from './components/Bowl'
import { AddBowl } from './components/AddBowl'
import { NotesBowl } from './components/NotesBowl'
import { SettingsPanel } from './components/Settings/Settings'
import { Onboarding } from './components/Onboarding'
import { Login } from './components/Login'
import { GearIcon } from './components/Icons'
import { GlobalSearch } from './components/GlobalSearch'
import { ShortcutsLegend } from './components/ShortcutsLegend'
import type { Bowl, WSEvent } from './types'
import styles from './App.module.css'


export function App() {
  const [theme, setTheme] = useTheme()
  // Auth state is just "do we have a token in localStorage?" — the actual
  // validity is checked on the first API call via /auth/me. If the token's
  // bad, /auth/me clears it and triggers an auth-expired event that flips
  // us back to the login screen.
  const [authenticated, setAuthenticated] = useState(hasToken)
  const [authVerified, setAuthVerified] = useState(false)
  const [bowls, setBowls] = useState<Bowl[]>([])
  const [realBowlsLoaded, setRealBowlsLoaded] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [cols, setCols] = useState(3)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Verify token freshness on mount. If invalid, kick to login.
  useEffect(() => {
    if (!authenticated) return
    me().then(user => {
      if (user) {
        setAuthVerified(true)
      } else {
        setAuthenticated(false)
        setAuthVerified(false)
      }
    })
  }, [authenticated])

  // Any 401 from any API call triggers this. The api.ts req() function
  // dispatches `cereal:auth-expired` to signal that the token was rejected.
  useEffect(() => {
    const onAuthExpired = () => {
      setAuthenticated(false)
      setAuthVerified(false)
    }
    window.addEventListener('cereal:auth-expired', onAuthExpired)
    return () => window.removeEventListener('cereal:auth-expired', onAuthExpired)
  }, [])

  const loadBowls = useCallback(async () => {
    try {
      const real = await getBowls()
      setRealBowlsLoaded(true)
      // If there are no bowls, show onboarding. (Previously this also
      // checked /status for accounts — bowls existing implies accounts since
      // every account belongs to a bowl, so the simpler check is enough.)
      if (real.length === 0) {
        setShowOnboarding(true)
        setBowls([])
      } else {
        setBowls(real)
        setShowOnboarding(false)
      }
    } catch {
      setRealBowlsLoaded(false)
    }
  }, [])

  useEffect(() => {
    if (authVerified) loadBowls()
  }, [authVerified, loadBowls])

  // WebSocket — react to real-time events
  const handleWSEvent = useCallback((event: WSEvent) => {
    if (event.type === 'new_message') {
      setBowls(prev => prev.map(b =>
        b.id === event.payload.bowlId
          ? { ...b, unreadCount: b.unreadCount + 1 }
          : b
      ))
      setRefreshKey(k => k + 1)
    }
    if (event.type === 'agent_message') {
      setRefreshKey(k => k + 1)
    }
  }, [])

  useWebSocket(handleWSEvent)

  function handleAddBowl(name: string, color: string) {
    const newBowl: Bowl = {
      id: `bowl-${Date.now()}`,
      name, color,
      isSpam: false,
      defaultFrom: null,
      addresses: [],
      createdAt: Date.now(),
      unreadCount: 0,
    }
    setBowls(prev => [...prev, newBowl])
  }

  function handleUpdateBowl(id: string, updates: Partial<Pick<Bowl, 'name' | 'color'>>) {
    setBowls(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b))
  }

  function handleDeleteBowl(id: string) {
    setBowls(prev => prev.filter(b => b.id !== id))
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    loadBowls()
  }

  async function handleLogout() {
    // logout() POSTs to /auth/logout to revoke the session server-side, then
    // clears the local token. Even if the network call fails (offline, server
    // down), the local token is wiped, so the next render shows login.
    await logout()
    setAuthenticated(false)
    setAuthVerified(false)
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  const shortcuts = useMemo(() => [
    { keys: ['?'], description: 'Show keyboard shortcuts', handler: () => setShortcutsOpen(o => !o), guarded: true },
    { keys: ['/'], description: 'Focus search', handler: () => {
      // Click the search trigger; GlobalSearch handles its own ⌘K shortcut so we sim a click
      const trigger = document.querySelector<HTMLButtonElement>('[title="Search (⌘K)"]')
      trigger?.click()
    }, guarded: true },
    { keys: ['Escape'], description: 'Close modal', handler: () => {
      setSettingsOpen(false)
      setShortcutsOpen(false)
    }},
    { keys: ['s'], description: 'Open settings', handler: () => setSettingsOpen(true), guarded: true },
    { keys: ['r'], description: 'Refresh all bowls', handler: () => setRefreshKey(k => k + 1), guarded: true },
    ...bowls.slice(0, 9).map((bowl, i) => ({
      keys: [String(i + 1)],
      description: `Focus ${bowl.name}`,
      handler: () => {
        const card = document.querySelector<HTMLElement>(`[data-bowl-id="${bowl.id}"]`)
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        card?.focus()
      },
      guarded: true,
    })),
  ], [bowls])

  useKeyboardShortcuts(shortcuts)

  return (
    <div className={styles.app}>
      {/* Login gate */}
      {!authenticated && (
        <Login onSuccess={() => { setAuthenticated(true); setAuthVerified(true); }} />
      )}

      {/* Keyboard shortcuts modal */}
      {shortcutsOpen && (
        <ShortcutsLegend shortcuts={shortcuts} onClose={() => setShortcutsOpen(false)} />
      )}

      {/* Onboarding — shown when no accounts connected */}
      {authenticated && showOnboarding && realBowlsLoaded && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}

      {/* Top bar */}
      <div className={styles.topbar}>
        <Logo />
        <GlobalSearch bowls={bowls} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className={styles.iconBtn}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <GearIcon size={15} color="currentColor" />
          </button>
          <button
            className={styles.iconBtn}
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bowl grid */}
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          // grid-auto-rows: 1fr makes every row the same height — bowls
          // in the same row stretch to match the tallest, instead of each
          // sizing to its own content.
          gridAutoRows: '1fr',
          alignItems: 'stretch',
        }}
      >
        {[...bowls]
          .filter((b) => !b.isNotes)
          .sort((a, b) => {
            const aIsAgent = a.id === 'agent' || a.name.toLowerCase() === 'agent'
            const bIsAgent = b.id === 'agent' || b.name.toLowerCase() === 'agent'
            if (aIsAgent && !bIsAgent) return 1
            if (!aIsAgent && bIsAgent) return -1
            return 0
          })
          .map((bowl) => (
          <BowlCard
            key={bowl.id}
            bowl={bowl}
            refreshTrigger={refreshKey}
            onUpdate={handleUpdateBowl}
            onDelete={handleDeleteBowl}
          />
        ))}
        {/* Notes bowl: a special bowl holding a freeform notepad rather than
            email. Rendered with its own component, filtered out of the map
            above so it never renders as an email bowl. */}
        {bowls.some((b) => b.isNotes) && (
          <NotesBowl
            color={bowls.find((b) => b.isNotes)?.color ?? '#f59e0b'}
          />
        )}
        {realBowlsLoaded && <AddBowl onAdd={handleAddBowl} onComplete={loadBowls} />}
      </div>

      {/* Settings */}
      {settingsOpen && (
        <SettingsPanel
          bowls={bowls}
          onClose={() => { setSettingsOpen(false); void loadBowls() }}
          onUpdateBowl={handleUpdateBowl}
          onDeleteBowl={handleDeleteBowl}
          onGridChange={(newCols) => setCols(newCols)}
          currentCols={cols}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}
    </div>
  )
}
