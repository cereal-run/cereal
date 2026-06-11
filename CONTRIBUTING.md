# Contributing to Cereal

Thanks for your interest. A few things worth knowing before you sink time in.

## Scope

Cereal is intentionally small. The product is an email dashboard for people running multiple businesses. Features that don't serve that use case are likely to be rejected even if they're well-built.

Good fits:
- Bug fixes
- Performance improvements
- Additional IMAP/SMTP provider compatibility
- Accessibility improvements
- Documentation
- Self-host workflow improvements (Dockerfile, deploy scripts)

Probably not a fit:
- Generic "make it a Slack" features
- Calendar / CRM / project management
- AI features that aren't tightly scoped to the email-routing problem
- Major UI overhauls without prior discussion

When in doubt, open an issue first and we'll discuss.

## Before you start

For non-trivial changes, please open an issue first. It saves both sides time. A 10-line PR that fixes a bug is welcome without preamble; a 500-line refactor isn't.

## Development setup

See the main `README.md` for environment setup. Briefly:

```bash
cd cereal-backend && npm install && cp .env.example .env && npm run dev
cd cereal-dashboard && npm install && cp .env.example .env && npm run dev
```

You'll need a Postgres database. 

## Code style

- **No formatter enforced.** The code uses 2-space indent, single quotes, no semicolons in places I forgot them. Match what's around you.
- **No tests required** for PRs. We don't have a comprehensive suite, and demanding tests where none exist is performative. Bug fixes for things that broke without tests should add a test if it's reasonable.
- **Comments matter.** This codebase explains itself through commentary that says *why*, not *what*. A PR that adds 100 lines of code without a single explanatory comment will get review notes asking why.


## Commits

Plain English commit messages. No conventional-commits gates. "Fix UID overflow in IMAP backfill" is better than "fix(imap): handle uid overflow on backfill (#123)".

## Security issues

Please email support@cereal.run instead of filing a public issue. We'll respond within 72 hours.


## License

By contributing, you agree your contribution is licensed under AGPL-3.0, same as the project. You retain copyright; the AGPL governs distribution.
