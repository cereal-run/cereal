import { useState, useEffect, useMemo } from 'react'

interface Props {
  name: string
  email: string
  accentColor: string
  size?: number
}

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'fastmail.com', 'fastmail.fm',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'zoho.com', 'tutanota.com', 'mail.com',
  'gmx.com', 'gmx.net', 'web.de',
])

// service.tiktok.com → tiktok.com — strips arbitrary subdomain depth
function rootDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean)
  if (parts.length <= 2) return domain
  // Handle common multi-part TLDs (co.uk, com.au, etc.)
  const last2 = parts.slice(-2).join('.')
  const last3 = parts.slice(-3).join('.')
  if (/^(co\.uk|com\.au|co\.jp|co\.kr|com\.br|co\.in|co\.nz|com\.mx)$/i.test(last2)) {
    return last3
  }
  return last2
}

export function Avatar({ name, email, accentColor, size = 30 }: Props) {
  const domain = (email?.split('@')[1] || '').toLowerCase()
  const isPersonal = !domain || PERSONAL_DOMAINS.has(domain)

  // Build a list of URLs to try.
  // Google's s2/favicons is more reliable for major brands (TikTok, Stripe, etc.)
  // DuckDuckGo's ip3 endpoint is the fallback for sites Google doesn't have.
  // For each service, we try root domain first (more likely to exist), then full subdomain.
  const urls = useMemo(() => {
    if (isPersonal || !domain) return [] as string[]
    const root = rootDomain(domain)
    const out: string[] = [
      `https://www.google.com/s2/favicons?domain=${root}&sz=64`,
    ]
    if (root !== domain) {
      out.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`)
    }
    out.push(`https://icons.duckduckgo.com/ip3/${root}.ico`)
    if (root !== domain) {
      out.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`)
    }
    return out
  }, [domain, isPersonal])

  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [domain])

  const monogram = getMonogram(name || email)
  const useImage = attempt < urls.length

  if (useImage) {
    return (
      <img
        src={urls[attempt]}
        width={size}
        height={size}
        alt=""
        onError={() => setAttempt(a => a + 1)}
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          objectFit: 'contain',
          background: 'transparent',
          display: 'block',
        }}
      />
    )
  }

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `${accentColor}1a`,
      color: accentColor,
      fontSize: Math.round(size * 0.36),
      fontWeight: 600,
      letterSpacing: '-0.01em',
    }}>
      {monogram}
    </div>
  )
}

function getMonogram(name: string): string {
  if (!name) return '?'
  const cleaned = name.replace(/[<>"']/g, '').trim()
  const parts = cleaned.split(/[\s,.-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
}
