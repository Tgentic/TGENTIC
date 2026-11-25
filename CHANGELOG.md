# Changelog

## 1.2.0 — 2026-11-24

Roadmap Step 3, contract + gate layer: manipulation resistance.

- **Heuristics.sol** — on-chain manipulation flags computed from the state
  layer: single-payer and repeat-heavy concentration. Stateless view;
  deployed on mainnet at 0xe9D4eaa0… over the v2 state layer.
- **gate/src/heuristics.js** — event-based detection over the Tallied
  history: payer concentration, timing regularity, amount cycling.
  Exposed as GET /risk?agent=0x… (computeFlags is pure — usable from a
  client, a log dump, or raw RPC).
- Application-layer rate limiting on the costly endpoints (per-IP,
  per-minute budget) — the chain sequences first-come-first-served, so
  there is no fee market to lean on.
- 9 new tests (40 total). Mainnet run: both detectors correctly report
  the live state as not-a-pattern-yet (one receipt from one payer).

## 1.1.0 — 2026-11-24

Roadmap Step 2, contract layer: decentralized trust.

- **Receipts.sol** — the state layer: receipts, tallies and bonds, with
  recording and slashing restricted to the policy contract. Same tally,
  bond and slash semantics as v1.
- **Policy.sol** — the policy layer: an m-of-n verifier set approves
  tally, slash and rotation actions with ECDSA signatures over
  domain-separated digests (chain id + contract address bound). Anyone
  may submit an approved action — the signatures carry the authority.
- Slash evidence is part of the signed digest (verifiers sign the hash
  of what they reviewed).
- Verifier-set rotation without redeploying the state layer.
- 9 new tests (31 total). The live v1 deployment is unaffected.

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
