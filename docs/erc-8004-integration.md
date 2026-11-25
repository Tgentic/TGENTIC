# ERC-8004 ↔ TGENTIC — integration mapping

Research + design for the last Step 4 roadmap item. Every claim below was
verified against the spec text (eips.ethereum.org/EIPS/eip-8004), the
reference implementation (github.com/erc-8004/erc-8004-contracts), and live
calls on Robinhood Chain mainnet — nothing here is assumed.

## What ERC-8004 is (verified)

- Standards-track **draft** ERC (Aug 2025), authors from MetaMask, the EF,
  Google, Coinbase. Extends A2A agent discovery with an on-chain trust layer.
- Three per-chain **singleton registries**, intentionally minimal:
  - **Identity** — ERC-721 + URIStorage. Each agent = an NFT; `tokenURI` =
    `agentURI` → an off-chain registration file (name, services, x402Support,
    supportedTrust, registrations). Global ID: `eip155:{chainId}:{registry}`
    + `agentId`.
  - **Reputation** — `giveFeedback(agentId, int128 value, uint8 decimals,
    tag1, tag2, endpoint, feedbackURI, feedbackHash)`, `revokeFeedback`,
    `appendResponse`, plus reads (`getSummary`, `readAllFeedback`,
    `getClients`, `getLastIndex`). Aggregation/scoring deliberately left to
    off-chain systems and complementary on-chain contracts.
  - **Validation** — generic `validationRequest`/`validationResponse`
    (0–100) hooks for external validators (stake re-execution, zkML, TEE).
- Payments are **explicitly out of scope** — but the spec's off-chain
  feedback file reserves a `proofOfPayment{from,to,chainId,txHash}` field
  "for x402 proof of payment".

## Official singletons exist on Robinhood Chain (verified on-chain)

| Contract | Address | Proof |
|---|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `getVersion()` → "2.0.0"; `name()` → "AgentIdentity" |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `getIdentityRegistry()` → the address above |

Same vanity addresses as Ethereum/Base/Arbitrum/… — deployed via the
reference UUPS proxy pattern. Testnet (46630) singletons:
`0x8004A818BFB912233c491871b3d84c89A494BD9e` /
`0x8004B663056A597Dffe9eCcC1965A193B7388713`.

**Consequence: we do not deploy registries. We integrate against the
official ones.** Any ERC-8004 indexer/scanner that supports Robinhood Chain
will see our agents the moment they register.

## Architecture mapping

| ERC-8004 concept | TGENTIC equivalent | Mapping |
|---|---|---|
| `agentId` (ERC-721 tokenId) | agent address | Register each agent once; NFT owner = agent's controlling wallet. Store `tgentic` ↔ `agentId` link in on-chain metadata + our SDK. |
| Registration file (`agentURI`) | — | Gate serves `https://tgentic.xyz/erc8004/agents/{id}.json`; `services` lists the agent endpoint, `x402Support: true`, `supportedTrust: ["reputation","crypto-economic"]` (the USDG bond IS crypto-economic trust). |
| `giveFeedback` | `Tallied` receipt | One Tallied receipt = one feedback: `value = rating × 20` (0–100 scale per spec's "starred" convention), `valueDecimals = 0`, `tag1 = "starred"`, `tag2 = "x402-verified"`, `feedbackURI` → gate-served JSON containing `proofOfPayment.txHash` = the payment tx. |
| `proofOfPayment` in feedback file | payment tx | Exact 1:1 — `fromAddress` = payer, `toAddress` = agent, `chainId = "4663"`, `txHash` = settled transfer tx. This is what ERC-8004 designed the field for. |
| `clientAddresses` filter in `getSummary` | unique payer set | Spec marks unfiltered reads as Sybil-prone and **requires** a clientAddresses allowlist. TGENTIC's `payers(agent)` IS that allowlist — computed from real payments, not declared. |
| Validation Registry | Policy.sol m-of-n | `validationResponse(requestHash, response 0–100, tag)` — our verifier quorum maps to a validator that answers with the manipulation score. Phase 2; spec's validation section is still under revision. |
| `appendResponse` | flags | Anyone can append responses to feedback — our flag computation can append a flag report URI as a public response signal. Optional. |

## The positioning (why this is worth doing)

ERC-8004 accepts **any** feedback from **any** address — honest by design,
spam-prone by consequence (the spec itself forces clientAddresses filtering
in `getSummary` for this reason).

TGENTIC feedback entries are different: every one carries a
`proofOfPayment.txHash` that anyone can verify on the explorer — the payment
really settled, the payer really paid. **ERC-8004 tells the world feedback
exists; TGENTIC proves the feedback was paid.** Same principle as
everything else here: no receipt, no reputation — now readable by the whole
ERC-8004 ecosystem (MetaMask/EF/Google-authored standard).

## Constraints (honest)

- **Spec is a draft** — interfaces could still change; the reference
  implementation is upgradeable for this reason. Our integration is
  read/write through stable function signatures only.
- `giveFeedback` must be called by **clientAddress itself** — there is no
  meta-transaction path in the spec. The payer (or its SDK) posts feedback;
  the gate can only prepare the calldata + feedbackURI, not submit for them.
- Owner/operator addresses cannot give feedback to their own agent —
  enforced on-chain. Our payer wallets qualify (they are not agent owners).
- Cross-chain: agentIds are per-registry, i.e. per-chain. Our reputation
  lives on `eip155:4663` — the same chain as the payments that back it.
  `registrations[]` in the file can link additional registrations later.
- Registering = an on-chain tx per agent (gas-only, ~free at 0.02 gwei).

## Implementation plan

1. **Gate: ERC-8004 file server** — `GET /erc8004/agents/{address}.json`
   (registration file per agent, generated from chain state) and
   `GET /erc8004/feedback/{agent}/{payer}/{index}.json` (per-receipt file
   with `proofOfPayment`). Pure read endpoints, no secrets.
2. **SDK: register + feedback helpers** — `registerAgent(uri)`,
   `feedbackCalldata(agentId, receipt)` → calldata the **payer** signs and
   submits. Mirrors in sdk-python.
3. **Bridge script** — `tools/erc8004-bridge.mjs`: reads Tallied events →
   builds feedback tx per receipt → payer submits `giveFeedback` to the
   official registry. Used once to backfill our 8 receipts (our payers sign
   their own feedback — spec-compliant), then reusable by anyone.
4. **Dapp: link layer** — directory rows gain the ERC-8004 agentId +
   registry explorer links once agents are registered.
5. **Docs** — this file + README section on reading TGENTIC scores inside
   the ERC-8004 ecosystem (getSummary with our payer set as the
   clientAddresses filter).

Phase 2 (later, after Step 4 closes): Validation Registry ↔ Policy.sol
quorum responses; `appendResponse` flag reports.

## What does NOT change

- TGENTIC's tally contract remains the canonical score. ERC-8004 is the
  interop/discovery layer — our receipts stay the proof.
- No new token, no new contract to trust — we write to the same singletons
  every other ERC-8004 chain uses.
- Bootstrap honesty: our feedback entries carry the same payer wallets —
  visible on-chain, labeled team-run here just like everywhere else.
