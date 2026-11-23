# Example x402 paid agent for TGENTIC

A small agent that sells one job (`GET /hash?text=…`, the SHA-256 of the text) for 0.01 USDG on Robinhood Chain, paid through **x402 v2**. The payment protocol is handled by the official `@x402/express`, `@x402/core`, and `@x402/evm` packages (x402-foundation/x402 repo).

## Full flow with TGENTIC

1. A client calls `GET /hash` without paying and receives a `402` with the `PAYMENT-REQUIRED` header: the `exact` scheme, the `eip155:4663` network, the USDG asset, the amount, and the agent's address.
2. The client signs an EIP-3009 authorization (gasless) and repeats the request with the `PAYMENT-SIGNATURE` header.
3. The agent forwards it to the facilitator (`/verify`, then `/settle`). The facilitator submits the USDG transaction to the chain.
4. The agent answers `200` with the job result and a `PAYMENT-RESPONSE` header containing the transaction hash.
5. The payer signs the TGENTIC rating message and sends it to the gate (`POST /tally`, see `../gate/README.md`). The gate checks that transaction and records the tally.

## Running

```bash
cd agent-example
npm install
cp .env.example .env   # fill in PAY_TO and FACILITATOR_URL
npm start              # port 4021
```

## Tests

`npm test`: a mock facilitator following the v2 spec and the official `@x402/fetch` client with a random wallet. It checks the 402 response, rejection of bad input before payment is requested, the full payment flow, and that the EIP-3009 signature is valid for the real USDG domain (chain 4663).

## Verified facts

- `name()` of the USDG contract on chain 4663 = "Global Dollar", 6 decimals (read directly over RPC).
- The USDG contract has no `version()` function. The value `"1"` comes from the Naven x402 endpoint live on the same chain.
- Naven answers x402 v2 at `https://api.naven.network/x402-test/ping`.

## Facilitator (verified 2026-11-20)

- **URL:** `https://facilitator.naven.network` (Naven). `GET /supported` answers x402 v2 `exact` for `eip155:4663` (mainnet) and `eip155:46630` (testnet), plus several other chains.
- **Signer:** `0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f`. This is the value set in the gate's `FACILITATORS` .env. Over RPC: a plain address (EOA), has sent 7,052 transactions on chain 4663.
- This URL was found on a third-party page and then checked directly; no official Naven documentation mentions it yet. Re-check `/supported` before production, since the signer may rotate.

## Not done yet

- Not tested with real USDG and a live facilitator (needs a funded wallet).
- The USDG address on testnet 46630 is unknown; this example uses the mainnet address.
