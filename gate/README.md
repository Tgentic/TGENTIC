# TGENTIC gate

A small server that connects real USDG payments to the TGENTIC contract. Only the gate may call `tally()` on the contract.

## Flow

1. A payer pays an agent through x402 (EIP-3009, settled by a facilitator) and receives a tx hash.
2. The payer signs a message containing the chain, the agent, the tx hash, and a 1–5 rating, then sends it to `POST /tally`.
3. The gate checks: the tx succeeded with enough confirmations, was sent by an approved facilitator, contains exactly one USDG transfer to that agent, has never been counted, the payer is not the agent itself, and the signature belongs to the payer.
4. The gate calls `tally(agent, payer, txHash, amount, rating)` and returns the transaction hash.

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

The gate refuses to start if a required setting is empty or the RPC is on the wrong chain.

## Tests

From the repo root: `npx hardhat test` (10 gate tests + 11 contract tests, local Hardhat network, mock USDG).

## Known limits

- **A single gate key is fully trusted** (to record and to slash the bond). Before mainnet: a multisig or several verifiers.
- **Self-dealing is only caught when payer = agent exactly.** Payments from another wallet owned by the same person are not detected; the dapp shows the unique payer count and `slash` stays manual.
- **Facilitator addresses** (Naven, hood402, Vantis) are not verified yet; taken from their official documentation.
- **No rate limiting yet**, and no example x402 endpoint for agents.
- Only tested on a local Hardhat network, not against Robinhood Chain or a live facilitator.
