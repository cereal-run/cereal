import { useEffect, useState } from 'react'
import {
  getSpecialBowls,
  setupSpamBowl,
  setupAgentBowl,
  deleteBowl,
  getAccounts,
  type AccountListItem,
} from '../api'
import type { Bowl } from '../types'
import styles from './SpecialBowlsSetup.module.css'

// Self-contained component covering optional spam + agent bowl setup.
//
// Drop it into your Settings page wherever it fits. Both features are
// strictly opt-in. Users who don't care about either never touch them.
//
// Usage:
//   <SpecialBowlsSetup />
//
// Backend dependencies:
//   GET  /bowls/special              → { spam, agent }
//   POST /bowls/spam/setup           → { ok, bowl, created }
//   POST /bowls/agent/setup          → { ok, bowl, created }
//   DELETE /bowls/:id                → { ok }

const COLOR_OPTIONS = [
  '#9ca3af', // gray (spam default)
  '#ffbe0b', // yellow (agent default)
  '#ff6b35', // orange
  '#3a86ff', // blue
  '#7b2fff', // purple
  '#06d6a0', // green
  '#f72585', // pink
  '#ff4757', // red
]

export function SpecialBowlsSetup() {
  const [loading, setLoading] = useState(true)
  const [spam, setSpam] = useState<Bowl | null>(null)
  const [agent, setAgent] = useState<Bowl | null>(null)
  const [accounts, setAccounts] = useState<AccountListItem[]>([])

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const [special, accts] = await Promise.all([
        getSpecialBowls(),
        getAccounts(),
      ])
      setSpam(special.spam)
      setAgent(special.agent)
      setAccounts(accts)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading…</div>
  }

  return (
    <div className={styles.container}>
      <SpamSection bowl={spam} accounts={accounts} onChange={refresh} />
      <AgentSection bowl={agent} onChange={refresh} />
    </div>
  )
}

// ── Spam bowl section ───────────────────────────────────────────────────────

function SpamSection(props: {
  bowl: Bowl | null
  accounts: AccountListItem[]
  onChange: () => void
}) {
  const { bowl, accounts, onChange } = props
  const [open, setOpen] = useState(false)

  if (bowl) {
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.dot} style={{ background: bowl.color }} />
            <h3 className={styles.title}>Spam bowl</h3>
            <span className={styles.badgeOk}>Configured</span>
          </div>
          <p className={styles.subtitle}>
            All catch-all mail lands in <strong>{bowl.name}</strong>.
            {bowl.defaultFrom && (
              <> Routing from <code>{bowl.defaultFrom}</code>.</>
            )}
          </p>
        </header>
        <DisconnectButton
          bowl={bowl}
          label="Spam bowl"
          onConfirm={onChange}
        />
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.dotMuted} />
          <h3 className={styles.title}>Spam bowl</h3>
          <span className={styles.badgeOpt}>Optional</span>
        </div>
        <p className={styles.subtitle}>
          A dedicated bowl for sketchy signups. Connect a catch-all domain
          and every alias you've ever given out lands here. Verification
          codes surface front and center, your real inboxes stay clean.
        </p>
      </header>
      {!open ? (
        <button className={styles.cta} onClick={() => setOpen(true)}>
          Set up spam bowl
        </button>
      ) : (
        <SpamForm
          accounts={accounts}
          onCancel={() => setOpen(false)}
          onCreated={() => { setOpen(false); onChange() }}
        />
      )}
    </section>
  )
}

function SpamForm(props: {
  accounts: AccountListItem[]
  onCancel: () => void
  onCreated: () => void
}) {
  const { accounts, onCancel, onCreated } = props
  const [name, setName] = useState('Spam')
  const [color, setColor] = useState(COLOR_OPTIONS[0])
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await setupSpamBowl({
        name,
        color,
        accountId: accountId || undefined,
      })
      onCreated()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.form}>
      {accounts.length === 0 ? (
        <p className={styles.notice}>
          You haven't connected any mail accounts yet. Connect your
          throwaway domain as an account first, then come back to set up
          the spam bowl. You can also create the bowl without an account
          and link one later.
        </p>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Catch-all account</span>
          <select
            className={styles.select}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">— None for now —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.username})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Bowl name</span>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
        />
      </label>
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.cancel} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={styles.submit} onClick={submit} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create spam bowl'}
        </button>
      </div>
    </div>
  )
}

// ── Agent bowl section ──────────────────────────────────────────────────────

function AgentSection(props: { bowl: Bowl | null; onChange: () => void }) {
  const { bowl, onChange } = props
  const [open, setOpen] = useState(false)

  if (bowl) {
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.dot} style={{ background: bowl.color }} />
            <h3 className={styles.title}>Agent bowl</h3>
            <span className={styles.badgeOk}>Configured</span>
          </div>
          <p className={styles.subtitle}>
            Agent messages route to <strong>{bowl.name}</strong>. Generate
            an agent key in <em>Agent keys</em> below, then have your agent
            POST to <code>/agent/inbound</code>.
          </p>
        </header>
        <DisconnectButton
          bowl={bowl}
          label="Agent bowl"
          onConfirm={onChange}
        />
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.dotMuted} />
          <h3 className={styles.title}>Agent bowl</h3>
          <span className={styles.badgeOpt}>Optional</span>
        </div>
        <p className={styles.subtitle}>
          A bowl where your AI agents communicate with you. Task
          completions, status updates, decision requests. Not Slack, not
          Telegram, just inside your cockpit. Skip if you don't use agents.
        </p>
      </header>
      {!open ? (
        <button className={styles.cta} onClick={() => setOpen(true)}>
          Set up agent bowl
        </button>
      ) : (
        <AgentForm
          onCancel={() => setOpen(false)}
          onCreated={() => { setOpen(false); onChange() }}
        />
      )}
    </section>
  )
}

function AgentForm(props: {
  onCancel: () => void
  onCreated: () => void
}) {
  const { onCancel, onCreated } = props
  const [name, setName] = useState('Agent')
  const [color, setColor] = useState('#ffbe0b')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await setupAgentBowl({ name, color })
      onCreated()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Bowl name</span>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
        />
      </label>
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.cancel} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={styles.submit} onClick={submit} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create agent bowl'}
        </button>
      </div>
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function ColorPicker(props: { value: string; onChange: (c: string) => void }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Color</span>
      <div className={styles.colorRow}>
        {COLOR_OPTIONS.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.colorSwatch} ${props.value === c ? styles.colorActive : ''}`}
            style={{ background: c }}
            onClick={() => props.onChange(c)}
            aria-label={`Pick ${c}`}
          />
        ))}
      </div>
    </div>
  )
}

function DisconnectButton(props: {
  bowl: Bowl
  label: string
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    try {
      await deleteBowl(props.bowl.id)
      props.onConfirm()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <button className={styles.disconnect} onClick={() => setConfirming(true)}>
        Disconnect {props.label.toLowerCase()}
      </button>
    )
  }

  return (
    <div className={styles.confirm}>
      <span>Disconnect and delete this bowl? Messages inside will be lost.</span>
      <div className={styles.confirmActions}>
        <button className={styles.cancel} onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </button>
        <button className={styles.confirmDelete} onClick={go} disabled={busy}>
          {busy ? 'Removing…' : 'Yes, disconnect'}
        </button>
      </div>
    </div>
  )
}
