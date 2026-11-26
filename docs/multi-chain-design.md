# Multi-chain receipt verification — design note (pre-implementation)

EXP-B (`tools/exp-multichain.js`) showed one payment `txHash` accepted by
two independent deployments: `used[txHash]` is per-contract state, so an
aggregated cross-chain view counts the same payment twice. This note
defines what "multi-chain" has to mean before any code ships.

## What is already bound today (verified in `gate/src/core.js`)

- **Payer signature binds chain**: `feedbackMessage` includes
  `chain: ${chainId}` — a signature for chain 4663 cannot be replayed to
  a gate on another chain.
- **Payment verification binds chain**: `verifyPayment` reads the tx via
  `ctx.publicClient`, which is constructed for exactly one `chainId`
  (`makeClients`). A tx that does not exist on that chain returns
  `TX_NOT_FOUND`.
- **`used[]` is per-contract**: each chain's deployment has its own
  mapping, so replay *within* one chain is already impossible.

## The residual gap

A transaction hash is only unique *within* a chain. If a facilitator's
settlement transaction is broadcast without an EIP-155 chain ID (or the
same signed payload is valid on two chains), the **same txHash can exist
on two chains**. Each chain-local gate would then verify "a" payment and
record the same `txHash` — and any cross-chain aggregator double-counts
reputation. The contract cannot fix this alone: `used[]` keys are
chain-local by construction.

## Design layers (in order of cheapness)

### L1 — Gate-side chain check (recommended first step, ~5 lines)

In `verifyPayment`, after `getTransaction`, assert
`tx.chainId === BigInt(ctx.chainId)` (type-2/EIP-1559 txs always carry
it; legacy unprotected txs have `chainId: null` → reject). This makes
the *same raw transaction* unusable on a second chain: its hash may
collide, but the gate refuses it because the tx itself declares another
chain. Cost: one field comparison. Covers the realistic replay vector.

### L2 — Receipt records carry chainId

`Tallied` events and SDK receipt objects gain a `chainId` field (the
contract knows `block.chainid`; for v1 this means a new event field or a
v3 redeploy — decision point). SDKs already expose `chain.id` on their
client; aggregators should key dedup by `(chainId, txHash)`, not
`txHash` alone. Needed before ANY cross-chain leaderboard exists.

### L3 — Multi-chain gate topology

One gate instance per chain (each with its own RPC, `chainId`,
contract address, facilitator set). A single "global" gate must never
verify a payment on chain A and tally on chain B — `makeClients`
already prevents this structurally; keep it that way. Facilitator sets
may differ per chain; reputation portability across chains is a
*product* decision (Step 7+), not a gate decision.

## Explicit non-goals for now

- No contract redeploy for chainId-in-event until L1 proves
  insufficient or aggregation is actually requested.
- No cross-chain reputation merging — that is a policy question
  (should a score on chain A count on chain B?), deferred to Step 7.

## Verification plan when implemented

- Hardhat: two chains, facilitator tx without/with wrong chainId →
  gate rejects; same hash on both → only the matching chain accepts.
- `tools/exp-multichain.js` extended: assert the L1 check blocks the
  double-count scenario end-to-end.
