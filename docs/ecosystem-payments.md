# Ecosystem payments on 4663 — who could become a receipt (survey)

A full census of `NewFeedback` on the official ERC-8004 ReputationRegistry
(`0x8004BAa1…`) plus transaction-level inspection of every project that links
a payment to its feedback. Purpose: find which on-chain payment flows could
become TGENTIC receipts, and what has to exist for that to happen.

Method notes: ~20,458 `NewFeedback` events decoded over the registry's full
history (paginated under the 10k-log cap, max window 1,298 — nothing silently
dropped). `data:` URIs decoded inline including base64; `https:` URIs sampled
per project and their referenced files fetched.

## Census

Only two projects embed `proofOfPayment` in `data:` feedback files:

- `priors-score` — 2,069 entries (one backend wallet `0x6138…0a73`)
- `starred` — 10 entries (TGENTIC's own, `value = rating × 20`, `x402-verified`)

All other projects' `data:` feedback carries no payment link. `https:`
feedback files were sampled per project:

| Project | What the entries actually are | Receipt-compatible? |
|---|---|---|
| priors.trade | Pool (`0x2812…`) disbursing USDG loans to borrowers; tags `rung-N`, backend attests scores for its own lending book | No — lender→borrower disbursement, not client paying for work |
| execution.market | `proof_of_payment.payment_tx` → requester pays an executor for a task (10 unique settlement txs, rated both directions) | Yes, semantically — client pays agent for work |
| loomdesk.trade | Trading records (pair, pool, entry/payout, pnl) | No — trading positions, not paid work |
| factoragents.fun | Credit-style scores (`repayment` weighted) | No — lending-adjacent |
| insulaworld.com | In-game social events ("theft", "trade") | No — not payments |
| brainchain, agentware.sh, others | Task/audit records, no settlement link | No |

## execution.market — tx-level anatomy

All 10 settlement txs follow one pattern, zero variance:

- `tx.from` = settler `0x103040545ac5031a11e8c03dd11324c7333a13c7` (same every time)
- `tx.to` = settlement contract `0x0258472a1410ac3ad720f1bc83f22b3c0af1fd9d`
- Two USDG transfers from treasury `0x9442581b3dc5a46bcb27419b68846c0cb1a3a86b`: **87% to the executor agent + 13% fee to the contract**
- ~4 actors total: 2 requesters (`0x5975…`, `0xfa1c…`), 2 executors (`0x7052…`, `0xe66c…`)
- Both sides of each task rate each other with the *same* payment_tx — only the requester→executor direction maps to a payment to the rated agent

## Checked against the gate's actual rules (`gate/src/core.js`)

- `tx.from` must be in `FACILITATORS` (env set) → their settler is consistent, approving `0x1030…` passes this check
- Exactly one USDG `Transfer` *to the agent* (line 55 filters `to === agent`) → the 13% fee goes to the contract, so their txs pass
- `payer` = the transfer's `from` = the treasury `0x9442…` for **every** payment → all their agents would show a single unique payer and trip the one-payer flag
- The rating signature must come from `payer` = `0x9442…` → their backend can sign; it cannot attribute the *requester* as payer

## Design gaps this surfaces (what to build)

1. **Multi-settler approval.** `FACILITATORS` is already a set — the missing piece is published criteria for what qualifies a settler (settles a real payment, exactly one transfer to the agent, documented key custody) and a process to approve partner settlers.
2. **Payer attribution for escrow flows.** When a treasury pays on behalf of a requester, the on-chain `from` is not the economic payer. Options: marketplace-signed attestation binding `requester → txHash` (receipt records `payer = requester (attested)`), or requester-signed EIP-3009 settlement direct to the agent. This is the Step 6 identity-verified-payments problem arriving early via partnerships; it needs a conscious design choice, not a workaround — and it must not become a Sybil side door.
3. **Remote verifier protocol (the real m-of-n).** `VERIFIER_KEYS` currently lives in one gate process — explicitly marked "transition phase" in `main.js`, so the 2-of-3 quorum is mechanism-level with same-operator keys today. For a partner to join the quorum meaningfully, verifiers need their own signing endpoints: the gate sends the `tallyDigest`, the verifier checks against its own settlement data and returns a signature, the gate aggregates `threshold` sigs and submits. Keys never leave the verifier's infrastructure. Note the honest consequence: a verifier can never tally alone (threshold ≥ 2) — partners *co-attest*, they don't self-issue receipts.
4. **"Get a first receipt" path.** External onboarding already works end to end — `deposit()` is permissionless, an approved facilitator can settle the payment, the payer signs the rating message, the gate tallies. What's missing is packaging: docs + the agent-example flow as a copy-paste afternoon.

## What this survey rules out

- **Retro-tallying priors' history**: rejected on two layers — `tx.from` is user/bundler (NOT_FACILITATOR) and the semantics are loans, not paid work. Mixing them would corrupt what a receipt means.
- **"Convert existing payments" growth**: the whole proof-of-payment pool on this chain is ~2,100 entries and mostly loans. There is no existing work-payment stream to tap; growth is onboarding, not conversion.
