# Step 5 experiment log

Backtests run before implementation, per the Step 5 rule: measure first,
build second. Every number below is reproducible — the tools are in
`tools/` and the commands are listed with each section. Nothing here is a
proof of security; these are measurements of specific failure modes.

## EXP-A — Gas profiling (mainnet, real transactions)

`eth_getTransactionReceipt` on the live mainnet transactions (chain 4663,
RPC `https://rpc.mainnet.chain.robinhood.com`):

| Operation | gasUsed | Note |
|---|---|---|
| ERC-8004 `register` | 106,883 | agent registration |
| ERC-8004 `giveFeedback` | ~223k–240k | payment-proven feedback |
| v1 `tally` | 161,610 (warm: 93,198) | first vs. repeated payer slot |
| v2 `Policy.submitTally` | 193,123 | m-of-n path incl. signature checks |

Observed gas price at measurement time: 20,572,000 wei (~0.0206 gwei).
Dollar figures in posts are estimates at an assumed ETH price — labelled
as such wherever quoted.

**Side finding (fixed):** cross-checking registration links found agentId
26523's `registerTx` was 63 hex chars — a dead explorer link on the live
site. Fixed in `web/src/app/erc8004.js`, regression guard added in
`test/erc8004-links.js`. All 14 ERC-8004 transactions verified
`status 0x1` on Blockscout.

## EXP-B — Cross-chain replay

`tools/exp-multichain.js` (Hardhat, two independent chain instances
simulating two facilitator-settled chains):

One payment `txHash` submitted to deployments on both chains was accepted
by both — `used[txHash]` is per-chain state, so an aggregated cross-chain
view counted the same payment twice (reputation doubled in the combined
view).

**Conclusion:** not a contract bug — chain-local state is correct by
design. It becomes a vulnerability only if a gate accepts a payment
verified on a different chain than the tally target. **Safeguard:** the
gate must verify the payment transaction on the same chain as the tally,
or receipt records must carry `chainId` (Step 8 territory). This reframes
the "multi-chain receipt verification" roadmap item: the work is
chain-binding at the gate, not just porting the rules.

## EXP-C — `minBond` depeg

`tools/exp-bond-fuzz.mjs` + economic analysis:

- Current `minBond` = 500,000 raw units = **0.5 USDG ≈ $0.50** — symbolic,
  not meaningful collateral.
- Bond and payments are denominated in the same token, so the
  bond:payment ratio is **invariant under depeg** — a USD oracle alone
  changes nothing while the bond stays $0.50.
- **Open design question:** is the bond meant to be real collateral or a
  Sybil-cost signal? If collateral → raise `minBond` *and* peg USD
together. If signal → document the intent and the oracle item can be
re-scoped. Decision pending; not implemented.

## EXP-D — Scale / log-range failure (the deadline finding)

Measured, not assumed:

- Chain speed: ~8.9–9.5 blocks/sec (~780k–820k blocks/day), from block
  timestamp samples.
- v1 deploy block: 118,987,578. Span at measurement: ~4.4M blocks.
- The public RPC rejects `eth_getLogs` spanning more than ~10,000,000
  blocks (boundary tested: span 10,000,001 accepted, 10,000,002 rejected;
  the limit is universal across contracts, not per-address).
- Read surfaces using the un-chunked pattern: the dapp
  (`web/src/app/chain.js`), the gate `/risk` (`gate/src/heuristics.js`),
  the TS SDK (`sdk/src/index.js`), **the Python SDK
  (`sdk-python/tgentic/client.py`) and the receipt watcher
  (`tools/watch-receipts.py`)** — the last two speak raw `eth_getLogs`
  and were caught in re-audit, not in the first pass.
  `viem` does not auto-chunk `getContractEvents`.

**Projection:** the span crosses 10M blocks roughly 7 days after
measurement (early December 2026 at the observed rate). After that, new
visitors would see "Could not read the chain" and existing sessions
would silently freeze on stale data (poll errors are swallowed); `/risk`
would return HTTP 500; SDK default reads would reject.

**Fix shipped with this log:** all five surfaces now page the scan —
`getLogs` + `blockRange` (8M blocks) in the viem clients, and an
equivalent chunked `eth_getLogs` loop (blockNumber snapshot, 8M windows,
halving on range errors) in the Python SDK and watcher. `viem`'s
`iterateLogs` self-halves page size on range errors, so the mechanism
also adapts if the RPC tightens limits or receipts densify. Verified:
54/54 Hardhat tests (incl. forced 1-block pagination), 16/16 Python SDK
tests (incl. forced multi-window pagination), web build, live mainnet
reads on both SDKs, a forced multi-page scan (500k blockRange → ~9
pages) against the production RPC, and `watch-receipts.py --once`.

**Second finding from the same re-audit:** the Python SDK's default
urllib transport had no `User-Agent` header — the RPC edge answered 403
to every request, so `create_client()` defaults never worked against
production (only custom transports did). One-line fix; verified live.

**Residual (documented, not solved):** per-poll cost still grows with
history; heavy concurrent polling can hit RPC rate limits. The durable
answer is a gate-side aggregated endpoint or an indexer — Step 5/7
scope, tracked separately.

## EXP-E — Bond lifecycle fuzz

`tools/exp-bond-fuzz.mjs`: 200,000 agent histories, ~15 random ops each
(deposit / startUnlock / withdraw / slash / tally / time-travel) =
**3,101,315 operations**, 439,043 legitimate reverts, **0 invariant
violations** (bond conservation, unlock timing, slash semantics,
non-negative accumulators).

Scope: a JS model of the state machine — complements, does not replace,
the 54-test Hardhat suite that executes the real contracts.

## Earlier campaign (recap)

`tools/fuzz-sim.mjs`: 6,500,000 simulated receipt histories across 5
seeds, 9 generator classes — **0 invariant violations** after fixing 2
real detector edge cases (order-dependent dedup key, inconsistent sort
comparator in `sdk/src/flags.js`). Pure flag/score layer only; EVM
execution is covered by the Hardhat suite. Details in
`docs/security-review.md`.

## What this log does NOT claim

- No external audit has occurred. "Self-audit" ≠ "audited".
- Simulation results are scoped to the layers stated; they are not
  evidence of absence of vulnerabilities elsewhere.
- EXP-D's deadline was a projection at measurement time; the fix removes
  the dependency on that projection entirely.

## Follow-ups produced by this log

- `docs/external-review-brief.md` — intake package for an external audit.
- `docs/multi-chain-design.md` — chain-binding design (EXP-B follow-up).
- `docs/cutover-v1-v2.md` — the v1→v2 migration plan, including the
  on-chain state inventory (v2 holds 1 tally / 0 bonds; v1 holds all 8
  tallies / 3.50 USDG bonded) and the replay-based Option B.
