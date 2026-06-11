# Cereal

Multi-business email dashboard. Every business in its own bowl.

If you run several businesses or side projects from one head, you've felt the email mess: half a dozen mailboxes, replies from the wrong identity, important mail buried under noise. Cereal collapses that into one dashboard where each business is a "bowl" with its own addresses, its own signature, and its own context. Mail routes to the right bowl by recipient address. Replies go out from the right one.

This is the open-source version, AGPL-3.0. The hosted version at [cereal.run](https://cereal.run) is the same code plus payment integration.


## What's in this repo

```
cereal-backend/    Fastify + Postgres backend. IMAP/SMTP/OAuth.
cereal-dashboard/  React + Vite dashboard.
```

The hosted version has additional payment code and a mobile app that isn't in this repo. Self-hosting means no payment layer to configure: you run the service for yourself or your team, and that's it.

## Requirements

- Node.js 20+
- A Postgres database (Neon, Supabase, RDS, Docker, your own VPS, anything)
- One or more email accounts to connect (IMAP + SMTP, or OAuth for Gmail/Microsoft)

## Quick start

```bash
# 1. Backend
cd cereal-backend
cp .env.example .env
# Edit .env: set DATABASE_URL, generate ENCRYPTION_KEY with `openssl rand -hex 32`
npm install
npm run dev   # http://localhost:3000

# 2. Dashboard (in a second terminal)
cd cereal-dashboard
cp .env.example .env
# Edit .env: point VITE_API_BASE at your backend
npm install
npm run dev   # http://localhost:5173
```

Open the dashboard, sign up, follow onboarding. Connect a mailbox via IMAP credentials or OAuth (if configured).

## Invite codes

By default signup is gated. Two ways to let people in:

**Env var (simple, single shared code):**

```
SIGNUP_INVITE_CODE=anystringyoulike
```

**Database table (preferred, supports multiple codes with labels and caps):**

```sql
INSERT INTO invite_codes (code, label, max_uses, used_count, expires_at, created_at, notes)
VALUES ('OPEN', 'public', NULL, 0, NULL, EXTRACT(EPOCH FROM NOW()) * 1000, 'open code');
```

To allow open signups entirely, unset `SIGNUP_INVITE_CODE` and create one open-ended row in `invite_codes` (above).

## OAuth setup (optional)

To connect Gmail or Microsoft mailboxes without users typing passwords, you'll need OAuth apps with each provider.

**Google:** [console.cloud.google.com](https://console.cloud.google.com/apis/credentials). Create a web application credential. Authorized redirect URI: `<your-backend-url>/oauth/google/callback`. Scopes needed: `https://mail.google.com/`. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your backend env.

**Microsoft:** [entra.microsoft.com](https://entra.microsoft.com) → App registrations. Redirect URI: `<your-backend-url>/oauth/microsoft/callback`. API permissions: `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`. Set `MS_OAUTH_CLIENT_ID` and `MS_OAUTH_CLIENT_SECRET`.

If you skip OAuth, users can still connect any mailbox with IMAP/SMTP credentials (Fastmail, Zoho, iCloud app password, Gmail app password, etc).

## Deployment

Cereal is a vanilla Node service. Anywhere that runs Node 20+ with HTTPS in front of it works:

- Backend: any Node host (Fly, Render, Railway, a VPS, Docker)
- Dashboard: any static host (Cloudflare Pages, Netlify, Vercel, nginx)
- Database: any Postgres (Neon, Supabase, RDS, self-hosted)

The backend expects to be behind a TLS-terminating proxy in production. It reads the real client IP from `X-Forwarded-For` when `trustProxy: true` is set in `server.ts` (default).

## Database

Schema is created automatically on first boot via `initDb()`. No separate migration tool needed. The schema is idempotent: existing tables aren't recreated, new ones are added.

To wipe the database and start over:

```bash
cd cereal-backend
npm run db:reset
```

This drops every table. Useful in dev, dangerous in prod.

## Architecture

```
┌──────────────────┐    HTTPS     ┌──────────────────┐
│ React dashboard  │ ───────────► │ Fastify backend  │
│ (Vite, static)   │    WS        │ (Node, src/api)  │
└──────────────────┘ ◄─────────── └─────────┬────────┘
                                            │
                                  ┌─────────┴────────┐
                                  │                  │
                            ┌─────▼─────┐    ┌──────▼──────┐
                            │ Postgres  │    │ IMAP/SMTP   │
                            │ (Neon...) │    │ (mailflow)  │
                            └───────────┘    └─────────────┘
```

- `src/db/`: schema + queries (one file, no ORM)
- `src/api/`: routes, server, WebSocket
- `src/imap/`: per-account IMAP connection manager
- `src/smtp/`: outbound mail
- `src/oauth/`: Google/Microsoft auth flows
- `src/crypto.ts`: AES-256-GCM for stored credentials

## Security

- IMAP passwords and OAuth tokens are encrypted with AES-256-GCM (key in `ENCRYPTION_KEY` env var, not in DB)
- User passwords hashed with argon2id
- Session tokens stored as SHA-256 hashes only
- Multi-tenancy enforced at the query layer: every read is scoped to `user_id`
- Rate limits on auth routes via `@fastify/rate-limit`
- SSRF denylist on IMAP/SMTP host inputs (RFC 1918, link-local, loopback, `.local`/`.internal`)
- Email bodies are NEVER persisted. Fetched on demand from your mail provider, rendered, discarded.

If you find a security issue in this code, please email support@cereal.run.

## What's NOT in this version

The hosted service includes a few things the OSS release doesn't:

- **Payment integration.** Subscription billing code, customer portal, lifetime cap logic, lapse banners. Self-hosters don't need this.
- **Mobile-optimized layout.** The hosted version ships a dedicated mobile UI (the `MobileApp` component) which is Pro-only. The OSS release runs the desktop layout on every viewport. It's responsive enough to use on a tablet but the phone experience isn't tuned. If you want a phone-class UI, that's part of the hosted Pro offering.
- **Production-ready CI / Docker images.** You'll bring your own.

If you want any of those for your self-hosted instance, PRs welcome — except payments and the mobile app, which exist to support the hosted version.

## License

AGPL-3.0. See `LICENSE`.

In plain language: you can run, modify, and redistribute Cereal under the terms of the AGPL. If you run a modified version as a network service, you must make your modifications available to your users. The hosted version at cereal.run runs the same core code; commercial features (payments) are layered on top per the standard "open core" pattern.

## Contributing

See `CONTRIBUTING.md`.

## Acknowledgements

Built on the shoulders of [Fastify](https://fastify.dev), [imapflow](https://imapflow.com), [nodemailer](https://nodemailer.com), [argon2](https://github.com/ranisalt/node-argon2), [React](https://react.dev), [Vite](https://vitejs.dev).
