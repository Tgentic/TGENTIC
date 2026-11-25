// Step 3: manipulation detection over the state layer's Tallied events.
// Event history gives what the state mappings alone cannot: which payer,
// which amounts, which blocks — the ingredients of wash-trading patterns.
// The flags themselves live in flags.js — pure, dependency-free, shared with
// the dapp bundle so the site, the API and the audits always agree.
import { parseAbi } from "viem";
import { computeFlags } from "./flags.js";

export { computeFlags };

const talliedAbi = parseAbi([
  "event Tallied(address indexed agent, address indexed payer, bytes32 indexed txHash, uint256 amount, uint8 rating)",
]);

export const DEFAULT_FROM_BLOCK = 118987578n; // the v1 state layer's deploy block

/**
 * Read an agent's receipts and compute the manipulation heuristics.
 * Flags are heuristics, not verdicts — they mark what deserves a closer look.
 * @param {object} o
 * @param {object} o.publicClient  viem client (tests: hardhat network; production: the chain RPC)
 * @param {string} o.address       the state layer (Receipts or TGENTIC v1 — same event)
 * @param {string} o.agent
 * @param {bigint} [o.fromBlock]   getLogs lower bound (the RPC rejects very wide ranges)
 */
export async function assessAgent(publicClient, { address, agent, fromBlock = DEFAULT_FROM_BLOCK }) {
  const logs = await publicClient.getContractEvents({ address, abi: talliedAbi, eventName: "Tallied", args: { agent }, fromBlock });
  return computeFlags(logs.map((l) => ({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash })), agent);
}
