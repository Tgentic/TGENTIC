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

## Step 3 — Manipulation resistance

- [x] Automated wash-trading detection: payer concentration, timing patterns, amount cycling — live on mainnet (Heuristics 0xe9D4eaa0… over the v2 state layer, plus the gate's event-based detector)
- [x] Application-layer rate limiting and request budgets — the chain sequences first-come-first-served, so there is no fee market to lean on
- [x] Heuristic flags surfaced in the dapp — the profile view runs the same computeFlags the gate exposes at /risk, and flagged agents carry a marker on the leaderboard
- [x] Research: time-weighted scoring / reputation decay — design note before code (docs/time-weighted-scoring.md)

**Done means:** obvious self-dealing gets flagged automatically, and the
gate survives hostile traffic patterns.

## Step 4 — Integration

- [ ] TypeScript SDK: read and verify an agent's score before hiring it
- [ ] Python SDK for agent frameworks
- [ ] ERC-8004 trust registry integration
- [ ] Agent directory in the dapp (discovery by counted score)

**Done means:** a third-party developer can integrate TGENTIC in an
afternoon without reading the contract.

## Step 5 — Assurance & scale

- [ ] External security review of the contract and gate — shortlist the firms that have already reviewed comparable privacy and reputation systems
- [ ] USD-denominated `minBond` via an oracle — slash stakes should not silently deflate with token prices
- [ ] Multi-chain receipt verification: same anti-replay rules on any chain the facilitators settle on
- [ ] Gas and storage profiling, including the on-chain cost of proof verification

**Done means:** the system has been reviewed by someone we did not write
ourselves, and it stays honest at scale.

## Step 6 — Agent identity

A score is only useful if it binds to the agent you are actually talking to.

- [ ] Signed agent manifests: name, endpoints, signing keys, versioned
- [ ] Resolve agent identity → on-chain score in one lookup
- [ ] Key rotation without losing the tally history
- [ ] Identity-verified payments: the receipt binds to the manifest, not just an address

**Done means:** "which agent earned this score" has a verifiable answer.

## Step 7 — Reputation consumption

- [ ] Marketplace APIs: filter and rank agents by counted score
- [ ] Hiring flow reference: agree → pay (x402) → rate → tally, as one client integration
- [ ] View-only receipt access: payers delegate read access to marketplaces and auditors with viewing keys — never spending power
- [ ] Reputation-weighted pricing signals for x402 endpoints
- [ ] Webhooks / event streams for score changes

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
