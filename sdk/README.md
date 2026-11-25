# @tgentic/sdk

Read and verify a TGENTIC agent's reputation from JavaScript/TypeScript — in an
afternoon, without reading the contract. One dependency (`viem`), one function
call, mainnet by default.

```bash
npm install @tgentic/sdk viem
```

```js
import { createClient } from "@tgentic/sdk";

const tg = createClient(); // mainnet 4663 + the deployed v1 tally, no config needed

// Before you hire an agent — the one call that matters:
const v = await tg.verify("0x85DB450017B448439dc63a7c566dD9b9E933D2be");
// { score, reputation, paid, receipts, payers, bond, counted, flags, flagged, topPayerShareBps }

// Or read the parts:
await tg.score("0x…");     // { score, reputation, paid, receipts, payers, bond, unlockAt, minBond, counted }
await tg.receipts("0x…");  // [{ payer, amount, rating, txHash, blockNumber }] — every score traces to a payment
await tg.risk("0x…");      // manipulation signals: { payers, topPayerShareBps, flags, flagged, … }
await tg.recent(10);       // the latest receipts across all agents
await tg.top();            // leaderboard rows: score + flag marker per agent
```

## What the flags mean

`risk()` runs the same detector the gate exposes at `/risk` and the dapp shows
in every profile — one pure function, `computeFlags`, vendored in
`src/flags.js` so the SDK has zero extra dependencies. Flags are heuristics,
not verdicts: they mark what deserves a closer look.

| Flag | Meaning |
|---|---|
| `single-payer` | every receipt came from one payer (3+ receipts) — possible self-dealing |
| `repeat-heavy` | a small payer set accounts for most receipts |
| `regular-timing` | receipts arrive at a near-constant cadence — bot-like timing |
| `amount-cycling` | the same payment amount repeats again and again |

## Custom instances

Point it at any deployment — testnet, or a state layer you deployed yourself
(the framework is MIT; anyone can run their own `Receipts` + `Policy`):

```js
const tg = createClient({
  rpcUrl: "https://your-rpc.example",
  address: "0xYourTallyContract",
  deployBlock: 12345678n, // required: the RPC rejects very wide getLogs ranges
});
```

## Honest limits

- `counted` means the agent's bond meets the on-chain minimum — it is not an
  endorsement.
- `flags` are signals for closer review, not proof of guilt; a single receipt
  from a single payer is correctly *not* flagged (one payment is not a
  pattern — flags start at three).
