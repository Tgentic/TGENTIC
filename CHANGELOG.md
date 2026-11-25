# Changelog


## 1.6.0 — Step 4: agent directory

- The dapp leaderboard becomes a real directory: every agent discovered from
  Tallied receipts on chain, ranked by counted score, with per-row receipt
  counts, paid totals, flag markers and a link out to the explorer.
- Address filter + discovery count ("N agents on chain · M flagged").
  Tab and footer link renamed to Directory; the #/board route still works.

## 1.5.0 — Step 4: Python SDK

- `sdk-python/` — `import tgentic` → `tg.verify(agent)`: counted score, receipts,
  manipulation signals. Zero dependencies (stdlib urllib + vendored Keccak-256
  pinned against published vectors).
- Same detector as TS: `compute_flags` is a line-for-line port of
  `sdk/src/flags.js` — flag strings identical across SDKs.
- Codec proven, not assumed: ABI calldata byte-identical to viem;
  live-verified on mainnet (score 1,000,000 · receipt 0x44d4be19… · block 118989002).
- New CI job runs the unittest suite.
## 1.4.0 — 2026-11-25

Roadmap Step 4, first slice: the TypeScript SDK.

- **sdk/** — `@tgentic/sdk`: `createClient()` defaults to mainnet (the
  deployed v1 tally + public RPC, zero config) and returns score,
  receipts, risk and a single `verify()` answer for hiring flows.
  Point it at any deployment via `address` + `rpcUrl` — the framework
  is MIT and anyone can run their own instance.
- **sdk/src/flags.js** is now the canonical manipulation detector —
  the gate's `/risk`, the dapp's Signals section and the SDK all run
  the same pure function (gate and web import it from the SDK, not a
  copy).
- Footer links wired (GitHub, docs, roadmap, contributing); the Docker
  webbuild stage copies the shared detector into the build context —
  fixes a build that passed CI but failed the image.
- CI web-build now replicates the Docker layout so that class of bug
  fails before merge.
- 8 new tests (49 total). Verified end-to-end on mainnet: `verify()`
  reads the live agent (score 1,000,000 / 1 receipt / no flags).

## 1.3.0 — 2026-11-25

Roadmap Step 3, completion: flags in the dapp + the decay design note.

- **web**: agent profiles now show a Signals section — top payer share
  and the heuristic flags, computed client-side with the same
  `computeFlags` the gate exposes at `/risk`. Flagged agents carry a
  marker on the leaderboard.
- **gate/src/heuristics.js**: cross-layer dedupe moved into
  `computeFlags` itself — a payment appearing in both the v1 and v2
  histories is counted once, keyed on the payment tx hash.
- **docs/time-weighted-scoring.md** — the reputation-decay design note:
  epoch-bucketed weighting at read time, receipts immutable, the raw
  sum untouched. Design only; nothing deployed.
- **deployments/4663-v3.json** — the Heuristics mainnet record
  (0xe9D4eaa0…, deploy tx + block).
- 1 new test (41 total): the same payment tx in two state layers is
  deduped to a single receipt and is not a pattern.

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
