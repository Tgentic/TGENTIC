# Changelog

## 1.0.1 — 2026-11-23

Security hardening for the gate's static file server. All findings were
remotely triggerable request-crash vectors; each one now returns a clean
`400` and the process stays up.

- **gate**: reject control bytes in request paths. A decoded `\r\n`
  (or any control byte) reached the `.html` redirect and threw inside
  the `Location` header — an unhandled error that killed the process.
- **gate**: percent-encode the redirect target. Non-latin1 characters
  (e.g. `%e2%82%ac`) are invalid in a `Location` header and also threw.
- **gate**: wrap the static file stat and handle stream errors. A stat
  race, `EPERM`, or fd exhaustion during a large burst now falls back
  or closes the response instead of crashing.
- **test**: regression coverage — malformed percent-encoding, control
  bytes, traversal attempts and non-latin1 redirects all return 4xx/301
  while the server keeps answering `/health`.

## 1.0.0 — 2026-11-21

Initial public release.

- `TGENTIC` tally contract: reputation from verified payments, bond
  with slash-on-wash-trading, 7-day unlock.
- Gate: receipt verifier (on-chain USDG transfer, payer signature,
  confirmations, anti-replay) behind a small HTTP API.
- Agent example: x402-paid agent on Robinhood Chain.
- Web: landing page + dapp (React, viem, Privy email/wallet login).
- Single-container deploy: the gate serves the built dapp.
