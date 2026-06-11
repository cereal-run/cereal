import { useState } from 'react'
import { login, signup, forgotPassword, resetPassword } from '../api'
import styles from './Login.module.css'

interface Props {
  onSuccess: () => void
}

type Mode = 'login' | 'signup' | 'forgot' | 'reset'

/**
 * Read the reset token from the URL once at module evaluation. The reset
 * email links to `/?reset_token=...` — if it's present, the Login screen
 * opens directly in reset mode. The token is stripped from the address bar
 * immediately so it doesn't linger in the visible URL or get copied along
 * when the user shares their screen or the page.
 */
function consumeResetTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('reset_token')
  if (token) {
    params.delete('reset_token')
    const rest = params.toString()
    const clean = window.location.pathname + (rest ? `?${rest}` : '')
    window.history.replaceState({}, '', clean)
  }
  return token
}

const initialResetToken = consumeResetTokenFromUrl()

export function Login({ onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>(initialResetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
        onSuccess()
      } else if (mode === 'signup') {
        await signup(email, password, inviteCode || undefined)
        onSuccess()
      } else if (mode === 'forgot') {
        await forgotPassword(email)
        setNotice('If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.')
        setLoading(false)
      } else if (mode === 'reset') {
        if (!initialResetToken) {
          throw new Error('This reset link is invalid. Request a new one.')
        }
        await resetPassword(initialResetToken, password)
        setPassword('')
        setMode('login')
        setNotice('Password updated. Sign in with your new password.')
        setLoading(false)
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setLoading(false)
    }
  }

  const title =
    mode === 'login' ? 'Welcome back'
    : mode === 'signup' ? 'Create your account'
    : mode === 'forgot' ? 'Reset your password'
    : 'Choose a new password'

  const subtitle =
    mode === 'login' ? 'Sign in to your bowls'
    : mode === 'signup' ? 'Every business in its own bowl'
    : mode === 'forgot' ? "Enter your email and we'll send a reset link"
    : 'At least 12 characters'

  const submitLabel = loading
    ? (mode === 'login' ? 'Signing in…'
      : mode === 'signup' ? 'Creating account…'
      : mode === 'forgot' ? 'Sending…'
      : 'Updating…')
    : (mode === 'login' ? 'Sign in'
      : mode === 'signup' ? 'Create account'
      : mode === 'forgot' ? 'Send reset link'
      : 'Set new password')

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>
          {/* Same SVG as favicon.svg, landing page nav, and the dashboard
              Logo component. If you tweak the mark, update all four. */}
          <svg
            className={styles.logoMark}
            viewBox="0 0 32 32"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g fill="none" strokeWidth="3.5">
              <circle cx="9"  cy="9"  r="4.5" stroke="#ff6b35" />
              <circle cx="23" cy="9"  r="4.5" stroke="#f72585" />
              <circle cx="9"  cy="23" r="4.5" stroke="#7b2fff" />
              <circle cx="23" cy="23" r="4.5" stroke="#3a86ff" />
            </g>
          </svg>
          Cereal
        </div>

        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.error}>{error}</div>}
          {notice && (
            <div
              style={{
                padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.8rem',
                background: 'rgba(6,214,160,0.1)', color: '#06d6a0',
                border: '1px solid rgba(6,214,160,0.25)', lineHeight: 1.45,
              }}
            >
              {notice}
            </div>
          )}

          {mode !== 'reset' && (
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={styles.input}
                autoFocus
              />
            </label>
          )}

          {mode !== 'forgot' && (
            <label className={styles.field}>
              <span className={styles.label}>
                {mode === 'reset' ? 'New password' : 'Password'}
              </span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'signup' || mode === 'reset' ? 12 : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={styles.input}
                autoFocus={mode === 'reset'}
              />
              {(mode === 'signup' || mode === 'reset') && (
                <span className={styles.hint}>At least 12 characters</span>
              )}
            </label>
          )}

          {mode === 'signup' && (
            <label className={styles.field}>
              <span className={styles.label}>Invite code <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span></span>
              <input
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                className={styles.input}
                placeholder="If you have one"
              />
              <span className={styles.hint}>
                Required only during early access lockdown.
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className={styles.submit}
          >
            {submitLabel}
          </button>
        </form>

        <div className={styles.switcher}>
          {mode === 'login' && (
            <>
              No account yet?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={styles.linkButton}
              >
                Create one
              </button>
              <span style={{ margin: '0 0.4rem', color: 'var(--text-3)' }}>·</span>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className={styles.linkButton}
              >
                Forgot password?
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={styles.linkButton}
              >
                Sign in
              </button>
            </>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={styles.linkButton}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
