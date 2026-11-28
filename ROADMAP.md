# Roadmap

Ten steps, one at a time. Each one closes a limit that is already
declared in the README's "Known limits", or opens the framework to
someone who could not use it before. We ship in order, and a step is
done when its definition of done is verifiable on chain or in the
repo — not when it is announced. Like everything else here, each one
has to be earned.

## Step 1 — Foundation (shipped, v1.0.1)

- [x] Tally contract: receipts, unique payers, score = Σ(verified payment × rating)
- [x] Bond with slash-on-wash-trading and a 7-day unlock window
- [x] Verification gate: on-chain payment check, payer signature, anti-replay
- [x] x402 paid-agent example (USDG, Robinhood Chain)
- [x] Dapp: lookup, leaderboard, bond management
- [x] Open source (MIT), CI on every push, `tools/immune.py` supply-chain scanner

**Done means:** the framework runs end to end — a real paid job produces a
verifiable receipt. *Shipped.*

## Step 2 — Decentralized trust (shipped on mainnet)

The single gate key is the biggest declared limit. It went away —
and the contract split, so changing who is trusted never touches
what is counted.

- [x] State/policy split: a state layer (receipts, tallies, trees — permanent rules) separated from a policy layer (who may record and slash)
- [x] Multisig gate: `tally()` and `slash()` behind an m-of-n signer set
- [x] Multiple independent verifiers may submit receipts (same anti-replay rules)
- [x] Slash requires published evidence (tx hashes, pattern description) before execution
- [x] Verifier-set rotation without redeploying the state layer

**Done means:** no single key can decide what counts, and policy can
change without touching state. *Shipped: deployed on mainnet
(deployments/4663-v2.json, 2-of-3 verifier set) and the first tally was
recorded through the policy.*

## Step 3 — Manipulation resistance (shipped on mainnet)

- [x] Automated wash-trading detection: payer concentration, timing patterns, amount cycling — live on mainnet (Heuristics 0xe9D4eaa0… over the v2 state layer, plus the gate's event-based detector)
- [x] Application-layer rate limiting and request budgets — the chain sequences first-come-first-served, so there is no fee market to lean on
- [x] Heuristic flags surfaced in the dapp — the profile view runs the same computeFlags the gate exposes at /risk, and flagged agents carry a marker on the leaderboard
- [x] Research: time-weighted scoring / reputation decay — design note before code (docs/time-weighted-scoring.md)

**Done means:** obvious self-dealing gets flagged automatically, and the
gate survives hostile traffic patterns. *Shipped: deployed on mainnet
(deployments/4663-v3.json) and callable by anyone — plus the same pure
detector in the gate at /risk, the dapp and the SDK.*

## Step 4 — Integration (shipped on mainnet)

- [x] TypeScript SDK: read and verify an agent's score before hiring it — sdk/ (@tgentic/sdk), tg.verify() returns score + manipulation signals; also the canonical home of the shared detector
- [x] Python SDK for agent frameworks — sdk-python/ (`import tgentic; tg.verify(agent)`), zero dependencies, same flags as the TS SDK
- [x] ERC-8004 trust registry integration — live on the official singletons on 4663: 7 agents registered (agentIds 26520–26526, spec-complete data: URI registration files) + 8 payment-proven feedback entries carrying proofOfPayment (docs/erc-8004-integration.md)
- [x] Agent directory in the dapp (discovery by counted score) — every agent from Tallied receipts, with receipts/paid/flags per row, address filter and explorer links

**Done means:** a third-party developer can integrate TGENTIC in an
afternoon without reading the contract.

## Step 5 — Assurance & scale (in progress)

Experiment log: docs/experiments-step5.md — gas profiling on real mainnet
transactions, cross-chain replay simulation, bond depeg analysis, a
200k-history bond lifecycle fuzz, and the log-range scale fix now shipped
across dapp, gate and SDK.

- [ ] External security review of the contract and gate — intake package + candidate-path shortlist ready (docs/external-review-brief.md); the engagement itself is the open item
- [x] Bond economics decision: `minBond` stays a symbolic Sybil-cost signal (0.5 USDG), not collateral — deterrent is reputation wipe + real payment cost; oracle scoped out (ratio is depeg-invariant); revisit triggers documented (EXP-C)
- [x] Multi-chain receipt verification — chain-binding is enforced at the gate: boot fails on wrong chainId, payer signatures carry the chainId (wrong-chain sigs rejected, regression-tested), payment and tally share one client. Second-chain deployment stays Step 10 scope (docs/multi-chain-design.md)
- [x] Gas and storage profiling, including the on-chain cost of proof verification — measured on mainnet (EXP-A)
- [x] Log-range scale fix — event scans now page automatically across the dapp, gate `/risk`, TS SDK, Python SDK and receipt watcher (EXP-D)
- [x] v1→v2 cutover — all reads and policy-gated writes on the v2 line; 8 receipts replayed, 7 bonds re-posted, parity verified on mainnet (docs/cutover-v1-v2.md)
- [x] Gate HTTP hardening — abort-safe body read, proxy-aware rate limiting, exact routing, process-level safety net, 8-class hostile request battery (docs/security-review.md, F3–F5)

**Done means:** the system has been reviewed by someone we did not write
ourself, and it stays honest at scale. Everything above except the
external review is done — that last item cannot be completed from the
inside.

## Step 6 — Agent identity (shipped on mainnet)

A score is only useful if it binds to the agent you are actually talking to.

- [x] Signed agent manifests: name, endpoints, signing keys, versioned — `tgentic/agent-manifest/1` spec (docs/agent-manifest.md), sign/verify in `gate/src/manifest.js`, signed manifests for all 7 mainnet agents committed under `manifests/` and verifiable offline via `tools/verify-manifest.mjs`
- [x] Resolve agent identity → on-chain score in one lookup — MCP tool `get_agent_identity` accepts an ERC-8004 `agentId` (resolved through the IdentityRegistry) or an address and returns the verified manifest plus live score; `GET /manifest/<addr>` serves the same store over plain HTTP
- [x] Key rotation without losing the tally history — `resolveManifests()` walks each agent's versions as a trust chain: every new version must be signed by a key the previous accepted version authorized; an unauthorized signer cannot rewrite the tip, and the agent key stays the recovery path
- [x] Identity-verified payments: the receipt binds to the manifest, not just an address — `/tally` accepts an optional `manifest`; the payer's signature must then also bind `manifestHash`, and binding to a superseded version is rejected

**Done means:** "which agent earned this score" has a verifiable answer.

## Step 7 — Reputation consumption

- [x] Marketplace APIs: filter and rank agents by counted score — `GET /agents` ranks every agent by score/receipts/payers with live manipulation flags, filterable via `?minScore=&minReceipts=&flagged=&sort=&limit=`; `GET /agents/<addr>` answers the one-agent lookup in a single call (shared `computeFlags`, one log scan, rate-limited)
- [x] Hiring flow reference: agree → pay (x402) → rate → tally, as one client integration — proven live by `agents/auditor`: real x402 payments settle on-chain via a whitelisted facilitator, payer feedback is signed manifest-bound, tallies land on the v2 contract (21 receipts, 3 payers, rank #1 by receipts)
- [x] View-only receipt access: payers delegate read access to marketplaces and auditors with viewing keys — `GET /payers/<addr>` serves the payer-side ledger; `?viewer=&grant=` accepts a signed, scoped, expiring `tgentic/view-grant/1` and echoes the verified delegation (grant = signature only, never spending power)
- [x] Reputation-weighted pricing signals for x402 endpoints — `/audit/report?buyer=` prices the offer by the buyer's counted score (50% off ≥1M, 25% ≥100k); `/audit/quote` exposes the curve; verification recomputes the buyer's price so underpayment fails and overpayment is the buyer's choice
- [x] Webhooks / event streams for score changes — `GET /events` streams live `Tallied` events over SSE (recent few replayed on connect), one shared chain poller

**Done means:** reputation is not something you look at — it is something
your stack reacts to.

## Step 8 — Portable receipts

Public by default, private by choice. The receipt stays provable; the
payer can stay hidden — without breaking what the tally counts.

- [ ] Receipt commitments in an incremental Merkle tree, with nullifiers designed so unique-payer counting survives (same payer, same agent → same nullifier)
- [ ] Hybrid flow: public receipts stay as they are; a payer may opt a receipt into the private set
- [ ] Proof stack: Noir + Barretenberg — MIT/Apache-licensed, universal SRS, no per-circuit trusted setup
- [ ] Batched proofs: one on-chain verification for many receipts (a single verification is 6–8× a Groth16 check, so receipts amortize)
- [ ] Relayer for private receipts, so the fee payer is not revealed
- [ ] Off-chain verification for portable receipt display — no RPC required
- [ ] Research: selective disclosure beyond the payer (prove a receipt exists without revealing the amount)

**Done means:** an agent can carry its work history anywhere, and a payer
can stay private without weakening the tally.

## Step 9 — Disputes & governance

- [ ] Slash disputes: evidence window before a slash becomes final
- [ ] Appeals process with published outcomes
- [ ] Community governance over the verifier set
- [ ] Viewing-key access for dispute auditors — read the evidence, control nothing
- [ ] Slash insurance research (bond-backed)

**Done means:** being slashed is a process with due diligence, not a
switch.

## Step 10 — The standard

- [ ] Trust-registry interoperability: read TGENTIC scores from other trust systems, and vice versa
- [ ] Agent-to-agent trust negotiation: agents check each other before collaborating or paying
- [ ] Contribute the receipt format to a standards track (EIP / ERC)
- [ ] Reference deployments on a second chain

**Done means:** TGENTIC is not a product you adopt — it is plumbing
anyone can build on.

---

Progress is tracked in [GitHub milestones][milestones]; each step closes
with the full suite green. Discussion belongs in [issues][issues] —
security findings should use a private report instead.

[milestones]: https://github.com/Tgentic/TGENTIC/milestones
[issues]: https://github.com/Tgentic/TGENTIC/issues
