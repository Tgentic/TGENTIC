# Roadmap

The phases are sequential on purpose: each one closes a limit that is
already declared in the README's "Known limits". We ship in order, and
a phase is done when its definition of done is verifiable on chain or
in the repo — not when it is announced.

## Phase 1 — Foundation (shipped, v1.0.1)

- [x] Tally contract: receipts, unique payers, score = Σ(verified payment × rating)
- [x] Bond with slash-on-wash-trading and a 7-day unlock window
- [x] Verification gate: on-chain payment check, payer signature, anti-replay
- [x] x402 paid-agent example (USDG, Robinhood Chain)
- [x] Dapp: lookup, leaderboard, bond management
- [x] Open source (MIT), CI on every push, `tools/immune.py` supply-chain scanner

**Done means:** the framework runs end to end — a real paid job produces a
verifiable receipt. *Shipped.*

## Phase 2 — Decentralized trust

The single gate key is the biggest declared limit. It goes away here.

- [ ] Multisig gate: `tally()` and `slash()` behind an m-of-n signer set
- [ ] Multiple independent verifiers may submit receipts (same anti-replay rules)
- [ ] Slash requires published evidence (tx hashes, pattern description) before execution
- [ ] Gate rotation without redeploying the contract

**Done means:** no single key can decide what counts, and the contract's
trust assumptions are documented and testable.

## Phase 3 — Manipulation resistance

- [ ] Automated wash-trading detection: payer concentration, timing patterns, amount cycling
- [ ] Rate limiting and request budgets on the gate
- [ ] Heuristic flags surfaced in the dapp (unique-payer ratio is step zero; expand it)
- [ ] Research: time-weighted scoring / reputation decay — design note before code

**Done means:** obvious self-dealing gets flagged automatically, and the
gate survives hostile traffic patterns.

## Phase 4 — Integration

- [ ] TypeScript SDK: read and verify an agent's score before hiring it
- [ ] Python SDK for agent frameworks
- [ ] ERC-8004 trust registry integration
- [ ] Agent directory in the dapp (discovery by counted score)

**Done means:** a third-party developer can integrate TGENTIC in an
afternoon without reading the contract.

## Phase 5 — Assurance & scale

- [ ] External security review of the contract and gate
- [ ] USD-denominated `minBond` via an oracle — slash stakes should not silently deflate with token prices
- [ ] Multi-chain receipt verification: same anti-replay rules on any chain the facilitators settle on
- [ ] Gas and storage profiling for high-receipt agents

**Done means:** the system has been reviewed by someone we did not write
ourselves, and it stays honest at scale.

---

Progress is tracked in [GitHub milestones][milestones]; each phase closes
with the full suite green. Discussion belongs in [issues][issues] —
security findings should use a private report instead.

[milestones]: https://github.com/Tgentic/TGENTIC/milestones
[issues]: https://github.com/Tgentic/TGENTIC/issues
