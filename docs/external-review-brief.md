# External security review — brief for audit firms

This document is the intake package for an external review of TGENTIC.
It states scope, deployed addresses, what we already found ourselves,
and exactly what we are asking the reviewer to cover. It is a request
for review, not a claim that one has happened.

## System in one paragraph

TGENTIC is an on-chain reputation layer for AI agents on Robinhood Chain
(chain ID 4663). The rule is "no receipt, no reputation": an agent's
score derives only from `Tallied` events, each of which requires a
verified USDG payment settled through a facilitator plus a payer
signature over (agent, payment tx hash, rating, chain). A bond gates
whether a score counts, and a gate-controlled `slash()` can burn the
bond and wipe reputation. A v2 line splits state (`Receipts`) from
policy (`Policy`, m-of-n verifier signatures over tallies and slashes).
Manipulation detection (`computeFlags`) is a pure JS/TS/Python layer
shared by the gate, the dapp and both SDKs.

## Deployed contracts (mainnet, chain 4663)

| Contract | Address | Role |
|---|---|---|
| TGENTIC v1 (live read/write path) | `0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8` | score, receipts, bond, slash; `gate()` = `0xDac0E38a0Da3F8Acae12402D35CA203C7342FB2C` (immutable, no setter) |
| Receipts v2 | `0x23537F09062134e6cfD8FF8D0a49b263D93bdB27` | state layer for the policy split |
| Policy v2 | `0x4651c76C501C54b6b649F4024BE34F7C58f7f4D3` | m-of-n tally/slash; threshold 2 of 3 verifiers (all team-controlled today — disclosed) |
| Heuristics v2 | `0xe9D4eaa060Eb0E7EEE599c026C217e3b06082d47` | on-chain flag contract |
| Bond/payment token | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | USDG |
| ERC-8004 Identity Registry (external, not ours) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | official singleton we integrate with |

Deployment metadata: `deployments/4663.json`, `4663-v2.json`,
`4663-v3.json`. Explorer: <https://robinhoodchain.blockscout.com>.
Public RPC: `https://rpc.mainnet.chain.robinhood.com`.

## Code under review

Public repo: <https://github.com/Tgentic/TGENTIC> (`main`).

| Area | Files |
|---|---|
| Contracts | `contracts/TGENTIC.sol`, `contracts/Receipts.sol`, `contracts/Policy.sol`, `contracts/Heuristics.sol` |
| Gate (verification + HTTP) | `gate/src/core.js`, `gate/src/server.js`, `gate/src/heuristics.js`, `gate/src/flags.js` |
| Canonical detector | `sdk/src/flags.js` (shared verbatim by gate, dapp, TS SDK, Python SDK) |
| SDKs | `sdk/src/index.js`, `sdk-python/tgentic/` |
| Dapp read path | `web/src/app/chain.js` |

## What we already did ourselves (baseline, not a substitute)

- 54 Hardhat tests simulating replay, forged ratings, wrong/duplicate
  signers, self-payment, non-facilitated payments, bond escape, slash,
  verifier rotation — all passing, CI on every push.
- Property fuzzing `tools/fuzz-sim.mjs`: 6.5M simulated receipt
  histories, 5 seeds — 0 invariant violations after fixing 2 real
  detector edge cases (order-dependent dedup key, inconsistent sort
  comparator). Pure flag/score layer only.
- Bond lifecycle model fuzz `tools/exp-bond-fuzz.mjs`: 3.1M operations,
  0 violations (JS model, not EVM).
- Self-audit findings I1–I5 in `docs/security-review.md` — including
  the known single-immutable-gate-EOA property of v1 (I5), which is why
  the v2 policy line exists.
- Experiment log `docs/experiments-step5.md`: gas profiling, cross-chain
  replay simulation, bond depeg analysis, log-range scale fix.

## Known limitations we are asking the reviewer to probe

1. **v1 gate is one immutable EOA** controlling tally AND slash on the
   live board. Accepted risk today; v2 cutover pending. Question for the
   reviewer: does the v1 surface need a migration path or a documented
   sunset?
2. **m-of-n verifier set is team-controlled** (3 keys, threshold 2).
   The mechanism is live and has processed a tally; independence of
   verifiers is future work.
3. **Heuristics are signals, not verdicts** — `computeFlags` can
   false-positive on small legitimate payer sets and false-negative on
   sophisticated splitting. Review the thresholds and the dedup/ordering
   logic for exploitable corners.
4. **Gate `/tally` trusts facilitator settlement detection** — the
   payment-verification logic in `gate/src/core.js` (recipient, fee-on-
   transfer handling, confirmation depth) deserves adversarial review.
5. **Bond economics are symbolic** — `minBond` = 0.5 USDG. Slash
   deterrence is weak by design-for-now; reviewer should assess whether
   any fund-loss or griefing vector exists at this bond size.
6. **Cross-chain replay** — EXP-B showed the same payment `txHash` is
   accepted on independent deployments. Chain-binding is designed but
   not implemented; reviewer should validate the proposed binding
   (`docs/multi-chain-design.md`) before it ships.

## What we are NOT asking for

- The ERC-8004 registry itself (external standard, not our code).
- The dapp UI/Privy auth beyond the read path's correctness.
- A formal verification of the whole system — scoped review of the
  files above is the ask.

## Process asks

- Findings ranked by severity with reproduction (tx/test case).
- Explicit statement of what was NOT reviewed.
- We will publish the report (or a summary) regardless of outcome.
