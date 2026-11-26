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
| Receipts v2 (live read/write state) | `0x23537F09062134e6cfD8FF8D0a49b263D93bdB27` | score, receipts, bond, slash — all live reads/writes use this |
| Policy v2 | `0x4651c76C501C54b6b649F4024BE34F7C58f7f4D3` | m-of-n tally/slash; threshold 2 of 3 verifiers (all team-controlled today — disclosed) |
| TGENTIC v1 (archived) | `0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8` | prior monolith; `gate()` = `0xDac0E38a0Da3F8Acae12402D35CA203C7342FB2C` (immutable). No live surface reads it; state was replayed into v2 with verified parity |
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

- 60 Hardhat tests simulating replay, forged ratings, wrong/duplicate
  signers, wrong-chain signatures, self-payment, non-facilitated
  payments, bond escape, slash, verifier rotation, plus a hostile-request
  battery against the gate's HTTP layer — all passing, CI on every push.
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

1. **v1 gate key remains a single immutable EOA** — it can still write
   v1 state (tally and slash) on the archived contract. No live surface
   reads v1, and v1↔v2 state parity was verified receipt-by-receipt.
   Question for the reviewer: does the archived v1 surface need a
   documented sunset, and can residual v1 writes ever matter to anyone?
2. **m-of-n verifier set is team-controlled** (3 keys, threshold 2; two
   keys colocated in the gate process during transition). Independence of
   verifiers is future work.
3. **Heuristics are signals, not verdicts** — `computeFlags` can
   false-positive on small legitimate payer sets and false-negative on
   sophisticated splitting. Review the thresholds and the dedup/ordering
   logic for exploitable corners.
4. **Gate `/tally` trusts facilitator settlement detection** — the
   payment-verification logic in `gate/src/core.js` (recipient, fee-on-
   transfer handling, confirmation depth) deserves adversarial review.
5. **Bond economics are symbolic** — `minBond` = 0.5 USDG by decision
   (see `docs/experiments-step5.md` EXP-C: deterrent is reputation wipe +
   real payment cost, not the bond). Reviewer should assess whether any
   fund-loss or griefing vector exists at this bond size.
6. **Cross-chain replay** — EXP-B showed the same payment `txHash` is
   accepted on independent deployments. In the current single-chain gate
   deployment, chain-binding is enforced three ways: boot fails if the
   RPC is on the wrong `chainId`, the payer signature message carries
   `chain: <chainId>` (a signature from another chain is rejected —
   covered by a regression test), and payment verification and the tally
   share one client on one chain. The multi-chain design
   (`docs/multi-chain-design.md`) extends this for future deployments;
   reviewer should validate it before a second chain ships.

## What we are NOT asking for

- The ERC-8004 registry itself (external standard, not our code).
- The dapp UI/Privy auth beyond the read path's correctness.
- A formal verification of the whole system — scoped review of the
  files above is the ask.

## Process asks

- Findings ranked by severity with reproduction (tx/test case).
- Explicit statement of what was NOT reviewed.
- We will publish the report (or a summary) regardless of outcome.

## Candidate paths (researched; pick one with the team)

The scope is small — four Solidity files plus one Node service — which
makes contest formats and solo auditors realistic alongside firms.

| Path | Fit | Typical cost | Timeline |
|---|---|---|---|
| **Code4rena audit contest** | Largest warden pool; Zellic-owned, currently zero platform fee — cost is the prize pool only | ~$10–30k pool for this scope | Book ~2–6 wks out, contest 3–7 days + judging |
| **Codehawks (Cyfrin)** | Community contests; cheapest entry for small scopes | lower pools than C4 | similar |
| **Sherlock** | Contest + optional coverage backstop if a critical slips through | ~$20k+ pool | 5–14 day contest |
| **Solo auditor / small team (Cantina, Spearbit)** | Curated, deeper engagement for the size we are | ~$5–15k for this scope | 1–3 weeks |
| **Traditional firm (Trail of Bits, Zellic, ConsenSys Diligence…)** | Heaviest weight name; likely overkill at current TVL ($3.50 bonded) | $40k+ | 4–8+ weeks |
| **Public review + Immunefi-style bounty** | Cheapest; we already have `SECURITY.md` + advisory channel; weaker assurance than a paid review | bounty budget only | continuous |

**Honest note:** at ~$3.50 total value at risk, a $40k firm audit buys
credibility, not risk reduction. The pragmatic path is a small contest
or solo audit first (real findings at sane cost), then a firm audit when
third-party value at risk justifies it. Decision belongs to the team.
