import { useEffect } from 'react'
import styles from './Logo.module.css'

// Identical to the favicon at /favicon.svg and the landing-page nav logo.
// The three are now byte-identical — change once, change everywhere.
// If you tweak this, update public/favicon.svg and cereal-site/index.html's
// .nav-logo-svg too.
export function Logo() {
  // Calistoga for the wordmark — injected once to avoid layout shift.
  useEffect(() => {
    if (document.getElementById('cereal-logo-fonts')) return
    const link = document.createElement('link')
    link.id = 'cereal-logo-fonts'
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Calistoga&display=swap'
    document.head.appendChild(link)
  }, [])

  return (
    <div className={styles.logo}>
      <svg
        className={styles.mark}
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
      <span
        className={styles.wordmark}
        style={{
          fontFamily: "'Calistoga', Georgia, serif",
          fontWeight: 400,
        }}
      >
        Cereal
      </span>
    </div>
  )
}
