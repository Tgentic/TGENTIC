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

**Authenticity proven cross-chain, not assumed**: the ERC-1967 proxies on
4663 resolve to implementation `0x7274e874ca62410a93bd8bf61c69d8045e399c02`
(identity) and `0x16e0fa7f7c56b9a767e34b192b51f921be31da34` (reputation) —
byte-identical addresses and bytecode sizes to the same proxies on Ethereum
mainnet, under the same owner `0x547289319c3e6aedb179c0b8e8af0b5acd062603`.
That is the official replayed (triple-presigned) deployment.

**The registry is already a live ecosystem on 4663** (full census,
limit-safe counting — naive scans silently drop ranges over the RPC's
10k-log cap): **26,517 agents registered** (agentIds 0–26,516, sequential;
Registered count == ERC-721 mint count everywhere), **19,563 NewFeedback
events** — 13,220 `data:` URIs + 6,027 `https:` URIs.

**Existing payment-proven feedback — the honest correction.** 2,035 of the
`data:` feedback files already carry `proofOfPayment` — all from
**priors.trade**, a credit/lending protocol whose entries we spot-verified:
tx `0x815125e1…` contains a real 5.0 USDG transfer matching the file's
from/to exactly. So "first payment-proven feedback" would be a false claim.
Active projects observed: priors.trade, insulaworld.com (3,393 entries),
loomdesk.trade (1,097), factoragents.fun (1,008), brainchain, agentware.sh,
execution.market — with tags like `priors-score`, `credit.statement`,
`trading`, `theft`, `factorReport`.

**What remains genuinely ours** (verified by reading their files):
- priors' proofs serve **one protocol's lending book** — credit scores for
  its borrowers. TGENTIC is the general-purpose layer: any agent, any job,
  any payer.
- Their score has **no bond** behind it. Ours is gated by a locked USDG
  bond — stake-backed, slashable, visible on-chain.
- They publish a number; we publish a number **plus manipulation
  heuristics** (payer concentration, timing, amount cycling) and an m-of-n
  verifier policy.
- Our receipts are **contract-verified before tally** — the gate requires
  the settled payment tx to exist and pay the agent before it writes. A
  JSON file claiming a txHash is evidence; a contract that refuses to
  attest without the payment is a guarantee.

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
in `getSummary` for this reason). On 4663 today that means ~19,600 feedback
entries — 2,035 already payment-proven (priors.trade), the rest unverified.

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


## Integration status: SHIPPED on mainnet (4663)

Executed against the official singletons — every tx verifiable in the
explorer (robinhoodchain.blockscout.com):

| Agent | agentId | register tx |
|---|---|---|
| `0x85DB45…dD2be` (reference) | 26520 | `0x1da119bc39af341037678cd5e05da2706313e0db8c06643cfab3d3f273cc3fe5` |
| `0x962Fb7…5Ad81` | 26521 | `0x5e8e076c6f6a808a6697f5cfd9b4e1e3cc48084ed335069642103c4f2ed9f59f` |
| `0x22b453…de375` | 26522 | `0xe691f656b6491e2b32740bca3b1af04133f1b010308ca192eb408d005c32463b` |
| `0x71F662…C9c745` | 26523 | `0x5c4607cd279904694e23d47468384813d95b147f1687fa438330885a7bd9e9d` |
| `0x498a54…4D2393` | 26524 | `0x1803304ced3e2ef6bfa8e8e5149d5920674e79c61a45da862b185198dbd93e54` |
| `0xcfd9A3…BC661` | 26525 | `0x78fcf8642f621e7ed7c4c26d40fbcf48be5aeb0df25f5d2287c2807ee8939823` |
| `0xfe9732…8CDd9d` | 26526 | `0xb25772b5aae72bc8ad59eae6ba0824cb56bec9459d23ff080db2d47a3a8ebe15` |

All 7 registration files verified via `tokenURI` decode: spec-conformant
(`type: …registration-v1`, correct `registrations[]`, `supportedTrust`
incl. crypto-economic), `agentWallet` auto-set to each agent's own address
(self-registration).

Feedback entries (one per Tallied receipt, signed by the paying wallet as
required by the spec — `value` = rating × 20, `tag1` = "starred", `tag2` =
"x402-verified", `feedbackURI` = data: JSON with `proofOfPayment.txHash`
pointing to the settled payment, `feedbackHash` = keccak256 of the file):

| agentId | payer | value | feedback tx |
|---|---|---|---|
| 26520 | `0x0416…f5b1` | 100 | `0xa8d45250ab4a474b2ca7e4c997ed93e797c1319fb712dbbf67425b01b60cb367` |
| 26521 | `0x0416…f5b1` | 100 | `0x125b555b83b85ff2a75c355ff212536fdf30e091b5e4441eaca89668426c733d` |
| 26522 | `0x6CB9…cf16D` | 100 | `0xc70282177c6dc98c95417ba4ee29e76337582a0be88f9a71785c13ad91e3490f` |
| 26523 | `0x0416…f5b1` | 80 | `0x1c46f97e4b641dd074f5606c57985d0e76408bbd382a11e6f144ec7b07365bc4` |
| 26524 | `0x6CB9…cf16D` | 100 | `0x205d9454e90580be398addb6e340fdc31ccc4ca3f39b5a9fa9649e0883a8ffc6` |
| 26525 | `0x0416…f5b1` | 80 | `0xdaa7023b69f3b9c46d40388b1e3dfdfe05df9d86d0eeaa4a073f448d9655ef74` |
| 26526 | `0x6CB9…cf16D` | 100 | `0xa6591317d533b8a9a550b7a4a8a5fdf8593d1ed4ed6e2612b1db46ae81b3a097` |
| 26520 | `0x6CB9…cf16D` | 100 | `0x5ed8d0773d3caf3936e437214509642f1648e67615cce567be781a688907f9b7` |

Tx receipts confirmed (status 0x1, `NewFeedback` emitted from the official
ReputationRegistry `0x8004BAa1…`). Bootstrap honesty unchanged: the payers
are the same team wallets disclosed on the board — visible on-chain, and
now also readable through any ERC-8004 client.

Remaining polish (tracked separately): SDK helpers (`registerAgent`,
`feedbackCalldata`) and dapp links to agentIds. The on-chain integration
itself is complete and public.
