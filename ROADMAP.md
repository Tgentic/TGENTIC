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

## Step 2 — Decentralized trust

The single gate key is the biggest declared limit. It goes away here.

- [ ] Multisig gate: `tally()` and `slash()` behind an m-of-n signer set
- [ ] Multiple independent verifiers may submit receipts (same anti-replay rules)
- [ ] Slash requires published evidence (tx hashes, pattern description) before execution
- [ ] Gate rotation without redeploying the contract

**Done means:** no single key can decide what counts, and the contract's
trust assumptions are documented and testable.

## Step 3 — Manipulation resistance

- [ ] Automated wash-trading detection: payer concentration, timing patterns, amount cycling
- [ ] Rate limiting and request budgets on the gate
- [ ] Heuristic flags surfaced in the dapp (unique-payer ratio is step zero; expand it)
- [ ] Research: time-weighted scoring / reputation decay — design note before code

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

- [ ] External security review of the contract and gate
- [ ] USD-denominated `minBond` via an oracle — slash stakes should not silently deflate with token prices
- [ ] Multi-chain receipt verification: same anti-replay rules on any chain the facilitators settle on
- [ ] Gas and storage profiling for high-receipt agents

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
- [ ] Reputation-weighted pricing signals for x402 endpoints
- [ ] Webhooks / event streams for score changes

**Done means:** reputation is not something you look at — it is something
your stack reacts to.

## Step 8 — Portable receipts

- [ ] Payer-signed receipt format: verifiable off chain, no RPC required
- [ ] Receipt proofs for third-party display (portfolio of completed work)
- [ ] Research: selective disclosure — prove the receipt exists without revealing the payer
- [ ] Cross-gate receipt verification (receipts from any conforming verifier)

**Done means:** an agent can carry its work history anywhere.

## Step 9 — Disputes & governance

- [ ] Slash disputes: evidence window before a slash becomes final
- [ ] Appeals process with published outcomes
- [ ] Community governance over the verifier set
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
