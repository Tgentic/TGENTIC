# TGENTIC gate

A small server that connects real USDG payments to the TGENTIC contracts. In v2 mode (production), the gate collects m-of-n verifier signatures and submits through `Policy.submitTally` — the gate key is only a gas relayer. In legacy v1 mode, the gate calls `tally()` directly.

## Flow

1. A payer pays an agent through x402 (EIP-3009, settled by a facilitator) and receives a tx hash.
2. The payer signs a message containing the chain, the agent, the tx hash, and a 1–5 rating, then sends it to `POST /tally`.
3. The gate checks: the tx succeeded with enough confirmations, was sent by an approved facilitator, contains exactly one USDG transfer to that agent, has never been counted, the payer is not the agent itself, and the signature belongs to the payer.
4. v2 mode: the gate signs the on-chain `tallyDigest` with its configured verifier keys, sorts signatures ascending by signer, and calls `Policy.submitTally(...)`. v1 mode: the gate calls `tally(agent, payer, txHash, amount, rating)` directly.

## API

`GET /health` → `{ ok, chainId }`

`POST /tally` with JSON:

```json
{ "agent": "0x…", "txHash": "0x…", "rating": 4, "signature": "0x…" }
```

The message signed by the payer (personal_sign), exactly:

```
TGENTIC feedback
chain: 4663
agent: <agent address, checksummed>
tx: <tx hash, lowercase>
rating: <1-5>
```

Success `200`: `{ tallyTx, agent, payer, amount, rating }`. Failure: `{ error, message }` with codes:

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_INPUT` / `BAD_JSON` | 400 | malformed input |
| `BAD_SIGNATURE` | 401 | signature does not belong to the payer, or the rating was changed |
| `TX_NOT_FOUND` | 404 | tx does not exist or is not mined yet |
| `ALREADY_TALLIED` / `IN_PROGRESS` / `NOT_CONFIRMED` | 409 | already counted, in progress, or waiting for confirmations |
| `TX_FAILED` / `NOT_FACILITATOR` / `NO_MATCHING_TRANSFER` / `AMBIGUOUS_TRANSFER` / `ZERO_AMOUNT` / `SELF_PAYMENT` | 422 | payment breaks the rules |
| `TALLY_FAILED` | 502 | the tally transaction to the contract failed |

## Running

```bash
cd gate
npm install
cp .env.example .env   # then fill in GATE_PRIVATE_KEY, TGENTIC_ADDRESS, FACILITATORS
npm start              # port 8788
```

For v2 mode also set `POLICY_ADDRESS` and `VERIFIER_KEYS` (see `.env.example`). The gate refuses to start if a required setting is empty, the RPC is on the wrong chain, or — in v2 mode — the policy/receipts wiring or verifier membership check fails.

## Tests

From the repo root: `npx hardhat test` (59 tests: 16 gate incl. the v2 policy path and a hostile-request battery, plus contract/SDK/heuristics suites, local Hardhat network, mock USDG).

## Known limits

- **Verifier set is team-controlled.** Writes go through the policy (2-of-3 verifier signatures); the gate holds two of the three verifier keys during the transition to independent verifiers. Its own key only pays gas — it cannot record or slash alone.
- **Self-dealing is only caught when payer = agent exactly.** Payments from another wallet owned by the same person are not detected; the dapp shows the unique payer count and `slash` stays policy-gated.
- **Facilitator addresses** are the approved set from official facilitator documentation, re-checked before use; every tally verifies the payment tx was actually sent by one of them.
- **Rate limiting exists** (30 req/min/IP on `/tally` and `/risk`, proxy-aware buckets) but a single gate instance is still a central point of availability, not of authority.
- Live on Robinhood Chain mainnet (chain 4663); the local suite uses Hardhat + mock USDG.
