# Security review — self-audit (pre-external)

Status: **internal audit, step 5 groundwork**. This document records what we
checked ourselves before any external firm reviews the code. It is not a
substitute for that review — it is the honest baseline we hand them.

Scope: `contracts/TGENTIC.sol` (v1 live), `contracts/Policy.sol` +
`contracts/Receipts.sol` (v2), `sdk/src/flags.js` (canonical detector shared by
gate, dapp and SDK), `gate/src/core.js` (payment + signature verification).

## Method

1. **Manual line review** of the contracts and the gate core.
2. **Adversarial test suite** — 50 hardhat tests simulating replay, forged
   ratings, wrong signers, self-payment, non-facilitated payments, bond
   escape, slash, verifier rotation (`npx hardhat test`).
3. **Property fuzzing** — `tools/fuzz-sim.mjs` generates randomized receipt
   histories (organic, wash-trading, sybil, replay, same-block bursts, hostile
   inputs, boundary sizes, long histories, extreme values) and checks
   invariants of the pure layers: determinism, permutation-independence,
   dedup correctness, brute-force stat agreement, score-math mirror,
   global anti-replay, bond gating. Millions of scenarios per seed.

## Findings

### Fixed during this audit

- **F1 — order-dependent dedup in `computeFlags`** (`sdk/src/flags.js`).
  Logs without a `txHash` fell back to a positional key (`log-N`), so the same
  history in a different order could deduplicate differently and report
  different counts/flags. Found by fuzzing (112 violations / 200k scenarios).
  Fixed: fallback key is now content-derived
  (`blockNumber-payer-amount`), order-independent.
- **F2 — inconsistent sort comparator in `computeFlags`.** The comparator
  returned `1` for equal `blockNumber`s instead of `0` — an invalid strict
  weak ordering that let TimSort order equal-block receipts differently per
  input permutation, which could flip the `regular-timing` flag. Found by
  fuzzing at ~1 per million scenarios. Fixed: three-way comparison.

Both fixes are in the canonical detector — gate `/risk`, dapp and SDK share
this one file, so all surfaces stay consistent.

### Fixed during the pre-cutover deep pass (gate HTTP layer)

- **F3 — aborted request body crashed the gate process** (`gate/src/server.js`).
  `for await (const chunk of req)` rejects when a client disconnects mid-body;
  inside the async request handler that rejection was unhandled, and Node's
  default is to exit on unhandled rejections — a remote, unauthenticated
  single-packet DoS. Reproduced locally, then fixed: the body read is wrapped
  and an abort just returns. Regression test: `test/gate.js` "an aborted
  request body must not crash the process".
- **F4 — rate limit bucketed on the proxy IP, not the client** (`server.js`).
  Behind Railway's edge, `req.socket.remoteAddress` is the proxy — every user
  shared one 30/min budget (one client could starve everyone, or the limit was
  meaningless). Fixed: bucket key is the first `X-Forwarded-For` entry, which
  the edge overwrites; direct header spoofing is not reachable publicly.
  Regression test: per-IP buckets.
- **F5 — route matching ignored the query string / over-matched prefixes**
  (`server.js`). `req.url === "/tally"` sent `POST /tally?x=1` to the static
  handler (404), while `/riskfoo` matched the `/risk` prefix check. Fixed:
  routing now uses the parsed pathname with exact matches. Regression test
  covers both.

### Informational (documented, not fixed — for the external reviewer)

- **I1 — CEI ordering in `deposit()`.** The external `transferFrom` call
  happens before `bond`/`unlockAt` state updates. With a non-standard ERC-20
  (ERC-777-style hooks) a reentrant `withdraw()` is conceivable; with the
  bonded asset (USDG, plain ERC-20) there is no callback path. Revisit if the
  bond token ever changes.
- **I2 — partial `withdraw()` clears `unlockAt`.** Withdrawing part of the
  bond requires a fresh `startUnlock()` for the remainder. Likely intended;
  noted so it is a decision, not an accident.
- **I3 — `slash()` preserves history.** It zeroes `reputation` and burns bond
  but leaves `paid`/`receipts`/`payers` intact — evidence is not erased.
  Confirm this matches the intended semantics.
- **I4 — no sweep/rescue function.** Tokens sent to the contract outside
  `deposit()` are unrecoverable. Standard for this design; noted.
- **I5 — v1 gate is a single immutable EOA** (`gate()` on
  `0xCb2A4c9C…` = `0xdac0e38a…`, no setter). **Resolved by the cutover:**
  all live reads (dapp, SDKs, `/risk`, watcher) and all writes (the gate
  submits through `Policy.submitTally`, 2-of-3 verifier signatures) now use
  the v2 line. The v1 contract remains on chain — its old EOA can still
  write v1 state, but no live surface reads it. Residual: the v2 verifier
  set is still team-controlled (2-of-3 team keys, two colocated in the gate
  process); independent verifiers are a declared next step.
- **I6 — `used[txHash]` is global per transaction hash.** A facilitator
  transaction that pays two different agents can only produce one tally; the
  second agent's receipt is rejected `AlreadyTallied`. Current facilitators
  settle one payment per tx, so this is latent — but a batching facilitator
  would silently drop receipts. Revisit at cutover: keying `used` by
  `(agent, txHash)` would require a new Receipts deployment.
- **I7 — restored session address without a live wallet client.** After a
  reload, `sessionStorage` restores the address but the injected-wallet
  `walletClient` is gone until reconnect; a bond action then fails with a
  generic wallet error rather than prompting reconnect. UX-only, no funds at
  risk (transactions are signed by the user's wallet regardless).
- **I8 — leaderboard/board reads are O(agents) event scans.** `top()` /
  `board()` re-scan `Tallied` history per agent for flags. Correct but heavy;
  the long-term answer is an indexer, already on the step-5 list.

## Fuzz campaign results

Command: `node tools/fuzz-sim.mjs <iterations> <seed>`

| Run | Iterations | Seeds | Violations |
|---|---|---|---|
| smoke (pre-fix) | 200,000 | 0xC0FFEE | 112 → root-caused to F1/F2 + unrealistic generator states |
| post-fix validation | 500,000 | 0xC0FFEE | 0 |
| campaign | 1,500,000 × 4 | 0xBEEF, 0xF00D, 0x1234, 0xDEAD | 0 |

Scenario mix per run: organic / wash-trading / sybil / replay / same-block /
hostile / boundary (0–2 receipts) / long (100–500 receipts) / extreme values.

Flag-rate sanity (post-fix, all seeds consistent): wash-trading ≈100%,
same-block ≈90%, long histories ≈100% (repeat-heavy by construction),
organic ≈67% (small payer sets legitimately flag), sybil ≈0.8%,
hostile ≈0.5%, boundary = 0% (below the 3-receipt threshold — correct).

## What this does NOT cover

- EVM execution semantics, gas, RPC behavior — hardhat suite + mainnet txs.
- Gate signature/payment verification edge cases beyond the 12 gate tests.
- The v2 `Policy._check` signature sorting under adversarial ordering —
  covered by `test/policy.js` (duplicate signer, non-verifier, <threshold).
- Economic attacks (bribing verifiers, bond sizing) — Step 5 oracle work.

## Next

- External review shortlist (contracts + gate) — the deliverable this doc
  prepares.
- Cutover decision: v1 single-gate → v2 policy-gated reads.
- `minBond` USD denomination via oracle.
