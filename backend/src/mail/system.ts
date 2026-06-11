/**
 * System (transactional) email — messages Cereal itself sends to users,
 * as opposed to mail users send through their own connected accounts.
 * Currently used only for password reset links.
 *
 * Configured via env:
 *   SYSTEM_SMTP_HOST     e.g. smtp.fastmail.com
 *   SYSTEM_SMTP_PORT     default 587 (465 implies implicit TLS)
 *   SYSTEM_SMTP_USER
 *   SYSTEM_SMTP_PASS
 *   MAIL_FROM            e.g. "Cereal <no-reply@cereal.run>"
 *
 * If unconfigured, isSystemMailConfigured() returns false and callers should
 * degrade gracefully (the forgot-password route logs loudly and still
 * returns ok to the client, so the endpoint can't be used to probe config).
 *
 * TLS certificates are always verified — same posture as user SMTP in
 * smtp/send.ts. There is deliberately no insecure escape hatch here: the
 * operator picks the system SMTP host, so "my own server has a self-signed
 * cert" is solvable on the server side.
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let cached: Transporter | null = null

export function isSystemMailConfigured(): boolean {
  return Boolean(
    process.env.SYSTEM_SMTP_HOST &&
    process.env.SYSTEM_SMTP_USER &&
    process.env.SYSTEM_SMTP_PASS &&
    process.env.MAIL_FROM,
  )
}

function getTransport(): Transporter {
  if (cached) return cached
  const port = Number(process.env.SYSTEM_SMTP_PORT) || 587
  cached = nodemailer.createTransport({
    host: process.env.SYSTEM_SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SYSTEM_SMTP_USER,
      pass: process.env.SYSTEM_SMTP_PASS,
    },
    tls: { rejectUnauthorized: true },
  })
  return cached
}

export async function sendSystemEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<void> {
  if (!isSystemMailConfigured()) {
    throw new Error('System mail is not configured (SYSTEM_SMTP_* + MAIL_FROM env vars)')
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
}
