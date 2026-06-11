import nodemailer from 'nodemailer'
import type { Account, SendPayload } from '../types.js'

/**
 * Build the nodemailer auth object. OAuth accounts get XOAUTH2 with a fresh
 * access token; password accounts get plain auth.
 */
async function buildSmtpAuth(account: Account): Promise<any> {
  if (account.authType === 'oauth') {
    const { getValidAccessToken } = await import('../oauth/tokens.js')
    const accessToken = await getValidAccessToken(account)
    return { type: 'OAuth2', user: account.username, accessToken }
  }
  return { user: account.username, pass: account.password }
}

// ─── Header-safe display names ────────────────────────────────────────────────

/**
 * Quote a display name for use in an address header per RFC 5322:
 * strip CR/LF (header injection), escape backslashes and double quotes,
 * wrap in double quotes. Used for From, To, and Cc names — all three can
 * contain attacker-influenced content (To/Cc names round-trip from received
 * messages on reply-all).
 */
function quoteDisplayName(name: string): string {
  const safe = name
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  return `"${safe}"`
}

// ─── Send an email ────────────────────────────────────────────────────────────

export async function sendEmail(
  account: Account,
  payload: SendPayload
): Promise<{ messageId: string }> {
  const transport = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure ?? (account.smtpPort === 465),
    auth: await buildSmtpAuth(account),
    // Always verify the server's TLS certificate. The previous behavior tied
    // verification to NODE_ENV === 'production', which silently disabled it
    // on any deployment that forgot to set NODE_ENV — leaving SMTP
    // credentials open to interception. Self-hosters talking to a mail
    // server with a self-signed cert can opt out explicitly:
    //   SMTP_ALLOW_INSECURE_TLS=true
    tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INSECURE_TLS !== 'true' },
  })

  // Use selected from address, fall back to account default
  const fromAddress = payload.from || account.defaultFrom

  // Add a display name to the From header. Without this, recipients see the
  // bare email both as the name and the address — looks like spam, no human
  // context. We use the bowl name as the display name (e.g., "Acme Inc.")
  // since that's the user's chosen identity for this bowl.
  //
  // If the caller already provided a formatted From with `<...>`, respect it.
  // If we can't find a bowl, fall back to titlecased local-part of the email.
  let formattedFrom = fromAddress
  if (!fromAddress.includes('<')) {
    let displayName: string | null = null
    try {
      const { bowlQueries } = await import('../db/index.js')
      const bowl = await bowlQueries.findByAddress(fromAddress, account.userId)
      if (bowl) displayName = bowl.name
    } catch {
      // Bowl lookup failed — fall through to local-part derivation
    }
    if (!displayName) {
      // Local part: turn "xavier" → "Xavier", "support-team" → "Support Team"
      const local = fromAddress.split('@')[0] || ''
      displayName = local
        .split(/[._-]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') || 'Cereal'
    }
    // RFC 5322: double-quote the display name and escape internal quotes/backslashes
    formattedFrom = `${quoteDisplayName(displayName ?? 'Cereal')} <${fromAddress}>`
  }

  // To/Cc names get the same escaping as From. Previously they were wrapped
  // in quotes raw — a name containing a double quote (which round-trips from
  // any received message on reply-all) corrupted the header.
  const toStr = payload.to.map(a => a.name ? `${quoteDisplayName(a.name)} <${a.email}>` : a.email).join(', ')
  const ccStr = payload.cc?.map(a => a.name ? `${quoteDisplayName(a.name)} <${a.email}>` : a.email).join(', ')

  // Build the full RFC 822 message OURSELVES with MailComposer (the same
  // engine nodemailer uses internally) instead of letting sendMail compose
  // it invisibly. This is what makes the Sent-folder append real: sendMail's
  // SentMessageInfo never exposes the raw message, so the previous append
  // was a silent no-op and sent mail vanished from every other client.
  // Composing first gives us one canonical byte sequence that is BOTH
  // transmitted over SMTP and appended to the IMAP Sent folder — what the
  // user sees in Gmail/Fastmail is byte-identical to what the recipient got.
  const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default as any
  const composer = new MailComposer({
    from: formattedFrom,
    to: toStr,
    cc: ccStr,
    subject: payload.subject,
    text: payload.textPlain,
    html: payload.textHtml,
    // Threading headers
    ...(payload.inReplyTo && { inReplyTo: payload.inReplyTo }),
    ...(payload.references && { references: payload.references.join(' ') }),
  })
  const mime = composer.compile()
  // Generate (and embed) the Message-ID now so we can return it — build()
  // would otherwise create one internally where we can't see it.
  const messageId: string = mime.messageId()
  const raw: Buffer = await new Promise((resolve, reject) => {
    mime.build((err: Error | null, message: Buffer) => err ? reject(err) : resolve(message))
  })

  // Send the prebuilt message. The envelope must be supplied explicitly when
  // using `raw` — nodemailer won't parse recipients out of the headers.
  await transport.sendMail({
    envelope: {
      from: fromAddress.includes('<')
        ? fromAddress.slice(fromAddress.indexOf('<') + 1, fromAddress.indexOf('>'))
        : fromAddress,
      to: [
        ...payload.to.map(a => a.email),
        ...(payload.cc?.map(a => a.email) ?? []),
      ],
    },
    raw,
  })

  transport.close()

  // Append the same bytes to the IMAP Sent folder so the email shows up in
  // the Sent bowl and in every other client connected to this mailbox.
  // Fire-and-forget: a failed append must not fail the send (the mail is
  // already gone), but it IS logged because silent loss here is exactly the
  // bug this replaced.
  //
  // Exception: Gmail copies SMTP-sent mail into [Gmail]/Sent Mail by itself;
  // appending again would double every sent message there.
  const providerAutoAppends = account.provider === 'gmail' || account.provider === 'google_workspace'
  if (!providerAutoAppends) {
    appendToSentFolder(account, raw).catch(err => {
      console.error('[send] Failed to append to Sent folder:', err.message)
    })
  }

  return { messageId }
}

async function appendToSentFolder(account: Account, rawMessage: any): Promise<void> {
  if (!rawMessage) return
  const { ImapFlow } = await import('imapflow')
  const { getConnection } = await import('../imap/connection.js')

  // Reuse existing IMAP connection if possible
  let client = getConnection(account.id)
  let temporary = false
  if (!client) {
    const auth = account.authType === 'oauth'
      ? await (async () => {
          const { getValidAccessToken } = await import('../oauth/tokens.js')
          return { user: account.username, accessToken: await getValidAccessToken(account) }
        })()
      : { user: account.username, pass: account.password }
    client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure ?? true,
      auth,
      logger: false, emitLogs: false,
    })
    await client.connect()
    temporary = true
  }

  try {
    // Find the Sent folder by special-use flag, fall back to common names
    const mailboxes = await client.list()
    let sentPath: string | null = null
    for (const mb of mailboxes) {
      if ((mb as any).specialUse?.toLowerCase() === '\\sent') { sentPath = mb.path; break }
    }
    if (!sentPath) {
      for (const name of ['Sent', 'INBOX.Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail']) {
        if (mailboxes.some(mb => mb.path === name)) { sentPath = name; break }
      }
    }
    if (!sentPath) return

    const raw = Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(rawMessage.toString())
    await client.append(sentPath, raw, ['\\Seen'])
  } finally {
    if (temporary) { try { await client.logout() } catch {} }
  }
}

// ─── Build a reply HTML block ─────────────────────────────────────────────────
// Constructs the quoted-message block so replies look native even when
// the original message wasn't received in this inbox (forwarding setup case)

export function buildReplyHtml(params: {
  replyBody: string
  originalFrom: string
  originalDate: Date
  originalSubject: string
  originalBody: string
}): string {
  const { replyBody, originalFrom, originalDate, originalSubject, originalBody } = params

  // HTML-escape the strings that aren't supposed to be HTML. replyBody is
  // the user's plain-text compose input; originalFrom is the sender's
  // display name from the message being replied to — attacker-controlled,
  // since anyone can set their From name to an HTML payload. originalBody
  // is intentionally raw: it IS the original email's HTML and gets quoted
  // as-is (and is only rendered inside the sandboxed viewer iframe).
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const dateStr = originalDate.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return `
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #000;">
  <div>${esc(replyBody).replace(/\n/g, '<br>')}</div>
  <div style="margin: 20px 0; border-top: 1px solid #ccc; padding-top: 10px; color: #666; font-size: 13px;">
    <p>On ${dateStr}, ${esc(originalFrom)} wrote:</p>
    <blockquote style="margin: 0 0 0 10px; padding-left: 10px; border-left: 2px solid #ccc; color: #444;">
      ${originalBody}
    </blockquote>
  </div>
</div>
  `.trim()
}
