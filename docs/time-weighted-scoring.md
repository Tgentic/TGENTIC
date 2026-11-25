# Time-weighted scoring — design note (Step 3 research)

Status: design only. Nothing here is deployed. This note records the thinking
before any code, so the trade-offs are reviewable on their own.

## The problem

Today the score is a raw sum: `Σ amount × rating`, gated by a minimum bond.

That has two known weaknesses:

1. **Reputation never ages.** An agent that did good work two years ago and
   nothing since keeps a pristine score. A payer hiring today sees a number
   that says nothing about whether the agent is still alive, still good, or
   abandoned.
2. **Old sins wash out cheaply.** An agent that was flagged or slashed early
   can out-earn the damage by simply waiting — the sum only goes up.

Both are recency problems. The fix is not to rewrite receipts — receipts are
immutable evidence — but to change how they are *weighted* at read time.

## Requirements

- **Deterministic and verifiable.** Anyone must be able to recompute the
  weighted score from the public receipt events alone. No off-chain oracle, no
  trusted "adjusted score" number.
- **Receipts stay immutable.** Decay is a lens on the data, not an edit to it.
  `reputation` as stored remains the raw sum; the weighted score is a second,
  derived number.
- **Cheap to read.** The Robinhood Chain RPC supports `eth_call` views and
  bounded `getLogs`; the weighting must work inside those limits.
- **No new trust assumption.** The weighting function is part of the policy
  surface — same place the verifier set and slashing rules live — and changes
  to it must be as visible as a contract upgrade.

## Options considered

| Approach | How it works | For | Against |
|---|---|---|---|
| **Exponential decay per receipt** | `w = amount × rating × 2^(-Δt / halfLife)` | Simple formula, single parameter | Needs a fractional exponent per receipt — on-chain fixed-point math is doable but error-prone; every read recomputes history |
| **Epoch bucketing** | Receipts summed into fixed windows (e.g. 30-day epochs); each epoch's subtotal is weighted by `1/2^age_in_epochs` | Integer math only, auditable per epoch, cheap view | Slightly coarse — a receipt's weight jumps at epoch boundaries |
| **Sliding window** | Only receipts newer than N blocks count | Trivially explainable | Cliff edge: an agent goes from "trusted" to "zero" at the boundary; loses all history |
| **EMA / rolling average** | Score updated per receipt: `s = α·new + (1-α)·s_old` | O(1) storage, standard technique | Update must happen inside `record()` — extra state and gas on the hot path; the stored number is opaque without replaying the sequence anyway |

## Recommendation: epoch bucketing, computed at read time

Weight receipts by the epoch they landed in. With a 30-day epoch (~4.3M blocks
at Robinhood Chain's cadence) and a half-life of 3 epochs (~90 days), a receipt
from last month counts full, from last quarter counts half, from a year ago
counts a sixteenth.

- The state layer already emits everything needed: `Tallied(agent, payer,
  txHash, amount, rating)` at a known `blockNumber`.
- The weighting is then a **view** — like `Heuristics.assess` — not a state
  transition. No migration, no new write path, no gas for anyone.
- The formula is small enough to publish next to the contract address:
  `score_w = Σ_epochs ( Σ amount×rating in epoch ) / 2^(current_epoch - epoch)`.
  Integer division per epoch is deterministic and easy to verify.

### Parameter choice (starting point, to be tuned with real data)

| Parameter | Proposed | Reasoning |
|---|---|---|
| Epoch length | ~30 days in blocks | Long enough that legitimate bursts don't straddle boundaries awkwardly; short enough to be meaningful |
| Half-life | 3 epochs (~90 days) | An agent must stay active to keep a high score, but one quiet quarter doesn't erase a track record |
| Floor | raw sum still exposed | `reputation` remains readable untouched — consumers choose which lens they want |

## What this explicitly does not do

- **It does not delete receipts.** A slashed or ancient receipt remains in the
  event log forever; only its weight fades. Evidence is permanent; salience is
  not.
- **It does not replace the raw score.** `score` stays the canonical number for
  now. The weighted score is an additional read — `scoreWeighted` — so
  consumers opt in rather than have the definition changed under them.
- **It does not solve sybil payers.** Decay helps with staleness, not with one
  wallet pretending to be many customers. That is what the payer-concentration
  heuristics and future identity work are for.

## Open questions before implementation

1. Should the epoch boundary be a wall-clock mapping (blocks per epoch fixed at
   deploy) or governance-settable? Fixed is simpler and harder to game; settable
   lets the policy layer tune without redeploying.
2. Do slashes decay too? (Probably not — a slash is a verdict, not a datapoint.
   Current leaning: slash history never decays.)
3. Where does the weighted read live — extend `Heuristics.sol`, or a sibling
   view contract? Sibling keeps each contract small and separately auditable.
4. Does the dapp show both numbers, or weighted-as-primary with raw behind a
   toggle? Showing both is more honest; showing weighted as primary is more
   useful. Probably: weighted primary, raw on the detail view, both labeled.

## Next

- Prototype the epoch-bucketed view against the real event history (small data
  today — the point is the code path, not the sample size).
- Backtest on the demo dataset in `web/src/app/demo.js`, which has enough
  synthetic spread to show the shape.
- Decide the epoch/half-life parameters above, then implement as a sibling
  view contract + a `scoreWeighted` column in the dapp.
