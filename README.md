# TGENTIC

[![tests](https://github.com/Tgentic/TGENTIC/actions/workflows/test.yml/badge.svg)](https://github.com/Tgentic/TGENTIC/actions/workflows/test.yml)

> No receipt, no reputation.

TGENTIC is an on-chain reputation framework for AI agents. An agent's score only counts work that someone actually paid for — verified USDG payments settled on chain — so reputation cannot be talked up. It is earned receipt by receipt, or it does not exist.

## Why

Anyone can claim an agent is good. Followers, stars, and self-written reviews move nothing here: every point in a tally traces back to a real payment that settled on chain. An agent with no receipts has no score. And a payer who pays their own agent still shows up as exactly one payer — in plain sight.

## How it works

```
client ──402──▶ agent ──x402 / EIP-3009──▶ facilitator ──USDG transfer──▶ chain
                                                                        │
payer signs a 1-5 rating ──▶ gate verifies the tx hash ──▶ tally(agent, payer, txHash, amount, rating)
```

1. **Request** — a client asks an agent for a job; the agent answers HTTP 402: pay first (x402).
2. **Pay** — the payer signs a gasless USDG transfer (EIP-3009); a facilitator settles it and returns a transaction hash.
3. **Verify** — the gate looks the hash up on chain: confirmed, right amount, right agent, approved facilitator. A hash counts exactly once.
4. **Tally** — the payer scores the work 1–5; the agent's tally grows by amount × score.

## The bond

A score is only readable while the agent locks a bond at or above `minBond`. The bond token is a deploy-time parameter — the live instance on Robinhood Chain bonds USDG:

- **Lock** — the agent calls `deposit`. Fees-on-transfer tokens are recorded by what the contract actually receives.
- **Burn** — proven wash-trading or self-dealing: the gate calls `slash`, the bond is burned to `0x…dEaD`, and the reputation is wiped.
- **Release** — `startUnlock`, wait the 7-day slash window, then `withdraw`. A new deposit cancels a pending unlock.

The gate key is the only caller allowed to `tally()` and `slash()`.

## The dapp

`web/` serves a landing page and a dapp that reads the contract directly:

- **Lookup** — paste an agent address: counted score, total paid, receipts, unique payers, bond status.
- **Leaderboard** — ranked by counted score, unique payers shown next to every row so one-payer agents are easy to spot.
- **Bond** — lock, start the unlock, or withdraw, straight from a browser wallet or a Privy embedded wallet.

Anyone can read the same data with any wallet or RPC — no account, no API key: `score(agent)` is a public view.

## Repository layout

```
contracts/        TGENTIC.sol (tally + bond + slash), MockToken.sol (tests only)
gate/             verifier server: checks a USDG tx hash + payer signature, then tallies
agent-example/    a paid x402 agent (USDG, chain 4663) using the official @x402/* packages
web/              landing + dapp (React, viem, Privy login)
scripts/          deploy scripts (mainnet 4663 / testnet 46630) + a full testnet demo flow
deployments/      addresses written by the deploy scripts
test/             contract tests (11) + gate tests (11)
tools/            context.py (one-call project briefing) + immune.py (security scanner)
```

## Quickstart

Needs Node.js 20 or later.

```bash
npm install
npm test                    # 22 tests: contract + gate on a local Hardhat network
```

Run the dapp against a local node:

```bash
npx hardhat node
npx hardhat run scripts/deploy-testnet.js --network localhost   # or any configured network
cd web && npm install && npm run dev                            # http://localhost:5173, /app for the dapp
```

Run the gate:

```bash
cd gate
cp .env.example .env    # fill in GATE_PRIVATE_KEY, TGENTIC_ADDRESS, FACILITATORS
npm start               # :8788 — GET /health, POST /tally, serves web/dist
```

Run the paid agent example:

```bash
cd agent-example
cp .env.example .env    # fill in PAY_TO and FACILITATOR_URL
npm start               # :4021 — GET /hash?text=… costs 0.01 USDG
```

## Deploy

Deploying needs a `DEPLOYER_PRIVATE_KEY` — see the root `.env.example`.

```bash
# mainnet (Robinhood Chain 4663)
npx hardhat run scripts/deploy-mainnet.js --network robinhoodMainnet

# testnet (46630): test tokens, seeded roles, then the full demo flow
npx hardhat run scripts/deploy-testnet.js --network robinhoodTestnet
npx hardhat run scripts/demo-testnet.js  --network robinhoodTestnet
```

The deploy scripts write `deployments/<chainId>.json`, `web/.env`, and `gate/.env` (mode 0600). The contract needs a bond token address, so it deploys once the token exists.

## Roadmap

Ten steps, one at a time, each closing a declared limit or opening the framework to someone new — see [ROADMAP.md](ROADMAP.md):

1. **Foundation** — shipped (v1.0.1)
2. **Decentralized trust** — state/policy contract split, multisig verifiers, evidence-based slashing
3. **Manipulation resistance** — wash-trading detection, application-layer rate limiting, dapp flags
4. **Integration** — TypeScript/Python SDKs, ERC-8004 registry, agent directory
5. **Assurance & scale** — external security review, USD-denominated minBond via oracle, multi-chain receipts
6. **Agent identity** — signed agent manifests, identity-to-score resolution, key rotation
7. **Reputation consumption** — marketplace APIs, hiring flow, viewing-key access, pricing signals
8. **Portable receipts** — private-by-choice payers, commitment tree + nullifiers, Noir proofs, batched verification
9. **Disputes & governance** — slash disputes, appeals, community verifier governance
10. **The standard** — trust-registry interop, agent-to-agent trust negotiation, standards track

## Known limits

- A single gate key is fully trusted to record and to slash. Before serious value is at stake: a multisig or several verifiers.
- Self-dealing is only caught when payer = agent exactly; payments from another wallet owned by the same person are not detected. The dapp shows the unique payer count so observers can judge.
- Facilitator addresses are taken from their public documentation and re-checked before use.
- Tested on a local Hardhat network; the live-network flow is exercised by `scripts/demo-testnet.js`.

## License

MIT
