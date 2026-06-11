# Security policy

## Reporting a vulnerability

Email **security@cereal.run** with a description and reproduction steps. You'll get an acknowledgement within 48 hours and a status update within 7 days. Please don't open public issues for security reports before a fix ships.

## Scope

This repository (backend and dashboard). For the hosted service at cereal.run, the same address applies.

## What we care about most

Account takeover, cross-tenant data access, stored XSS via email content, credential exposure (IMAP/SMTP passwords, OAuth tokens, session tokens), and SSRF through mail server host inputs.
