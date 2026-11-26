# v1 → v2 cutover design (pre-implementation)

Status: **design only**. Nothing here is deployed or scheduled. This is
the plan for moving the public board from the single-gate v1 contract to
the m-of-n v2 line, and the honest list of what it costs.

## Current on-chain state (verified, chain 4663)

| | v1 `TGENTIC` | v2 `Receipts`+`Policy` |
|---|---|---|
| Address | `0xCb2A4c9C…734c8` | `0x23537F09…3bdB27` / `0x4651c76C…f7f4D3` |
| Deploy block | 118,987,578 | 122,282,476 / 122,282,551 |
| Write authority | 1 immutable EOA (`0xdac0e38a…`) | Policy, threshold 2 of 3 verifiers (all team keys today) |
| Tallied events | 8 (all team-bootstrap, disclosed) | 1 (the cutover test tally) |
| Bonds held | **3.50 USDG total** (7 agents × 0.5) | 0 |
| Live readers | dapp, gate `/risk`, TS SDK, Python SDK, watcher | Heuristics contract only |

The v2 line is deployed and proven (one tally went through `Policy` with
two signatures — tx `0xecc4cdff…`), but it holds almost no state. The
cutover is therefore small: **8 tallies, 7 bonds, one reader config**.

## What does NOT migrate automatically

- `used[txHash]` is per-contract — v2 will happily accept a payment hash
  already counted on v1. Mitigation: replay uses the *same* txHashes, so
  v2's `used[]` gets populated correctly; there is no double-count risk
  because v1 becomes read-only archive, not a second live board.
- Bonds are contract-local — agents must re-deposit on v2 (0.5 USDG
  each; total $3.50 — trivial, but it is a user action, not free).
- Reputation/paid/receipts/payers rebuild only if every historical
  tally is replayed through `Policy.submitTally` (verifier-signed).

## Options

### Option A — Fresh start on v2 (simplest, lossy)

Point all readers at v2 Receipts. v1 stays deployed and queryable as
archive. Agents re-deposit bonds; reputation starts at zero.

- Cost: 7 agents re-deposit ($3.50 total), history visually resets.
- Risk: "they wiped the board" optics — mitigated by keeping v1
  explorer links and labeling the archive.

### Option B — Replay + redeploy bonds (recommended)

1. Verifiers sign `tallyDigest` for each of the 8 historical tallies
   (same agent/payer/txHash/amount/rating as v1 events).
2. Anyone submits them via `Policy.submitTally` — v2 state becomes a
   faithful copy (same `used[]`, reputation, receipts, payers).
3. Each of the 7 agents calls `deposit(0.5 USDG)` on v2 (or the deployer
   batch-assisted with prior approval — still their tokens, their call).
4. Readers switch: dapp `VITE_TGENTIC_ADDRESS` → Receipts,
   `VITE_DEPLOY_BLOCK` → 122,282,476; gate `/risk` + write path → Policy
   flow; SDK `addresses.tally` → Receipts (field already exists as
   `addresses.receipts`); watcher `CONTRACT`/`DEPLOY_BLOCK` updated.
5. v1 marked "legacy — read-only archive" in the dapp footer/docs.

- Cost: one replay script (~8 submitTally txs, gas ~$0.01 each at
  observed prices), 7 deposit txs, config changes.
- Benefit: **zero history loss, zero double-count, full m-of-n on every
  subsequent write including slash.**

### Option C — Hybrid read (v1 scores + v2 flags)

Rejected: two sources of truth is exactly the kind of ambiguity this
project exists to eliminate.

## Gate changes required for Option B

Today `handleTally` writes `tally` directly as the gate EOA. On v2 the
gate must instead:

1. Verify payment + payer signature exactly as now (unchanged — that
   logic is chain-agnostic).
2. Collect `threshold` verifier signatures over `tallyDigest`.
   - Phase 1 (still team keys): the gate holds 2 of the 3 verifier keys
     and self-signs both — operationally identical to today, but every
     write now *proves* the m-of-n path.
   - Phase 2 (independent verifiers): verifiers sign off-band; the gate
     (or anyone) submits. Gate becomes a relayer, not an authority.
3. Submit via `Policy.submitTally` — permissionless, so the gate key
   loses write power entirely afterward.

`submitSlash` follows the same pattern with `slashDigest` +
`evidenceHash` — slash becomes evidence-bound, which is a strict
improvement over v1's reason-string-only slash.

## Reader changes (all verified compatible)

`Receipts` exposes the same view surface the readers already call:
`score/reputation/paid/receipts/payers/bond/unlockAt/token/minBond` +
the identical `Tallied` event signature. So:

- **Dapp**: address + deploy-block env vars; `flags.js` import path
  unchanged (canonical detector).
- **Gate `/risk`**: `assessAgent` works as-is (same event, same fields);
  only the contract address arg changes.
- **TS SDK**: `addresses.receipts` already exists — flip the default or
  add a `line: "v2"` option; `deployBlock` default → 122,282,476.
- **Python SDK**: same two constants.
- **Watcher**: `CONTRACT` + `DEPLOY_BLOCK` constants.
- **Heuristics contract**: already pointed at v2 Receipts ✓.

## Rollback plan

- Readers can point back to v1 at any time (it is immutable and still
  holds state). Keep v1 addresses in docs as "archive".
- If replay produces a mismatch (it shouldn't — events are deterministic
  inputs to the same accounting math), do NOT improvise: halt, diff
  v1 vs v2 state per agent, fix the replay script, re-run on a fresh
  v2 deployment is NOT needed (tallies are idempotent per txHash —
  a partial replay just resumes).

## Risks & honest caveats

- **Verifier independence is not solved by cutover.** Threshold 2-of-3
  with three team keys is better than one immutable EOA (rotation
  exists, evidence-bound slash exists) but still team-controlled.
  Public communications must keep saying this until external
  verifiers join.
- **Bond re-deposit is a user action.** Agents that don't redeposit
  show score 0 on v2 — acceptable at $3.50 total, documented.
- **v1 gate EOA retains slash power forever** on v1 state. After
  cutover, v1 is archive — its slash can still burn v1 bonds, but v1
  scores are no longer displayed. Document that v1 is frozen history,
  not a live attack surface (its `used[]`/reputation are only as
  trustworthy as the gate was — which is the finding we already
  published).
- **ERC-8004 feedback** entries point at payment proofs, not TGENTIC
  contract state — unaffected by cutover.
