// Step 3: manipulation detection over the state layer's Tallied events.
// Event history gives what the state mappings alone cannot: which payer,
// which amounts, which blocks — the ingredients of wash-trading patterns.
import { parseAbi } from "viem";

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
  return computeFlags(logs.map((l) => ({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount })), agent);
}

/** Pure: the same heuristics over any receipt list — usable off a live client, a log dump, or raw RPC. */
export function computeFlags(logs, agent) {
  logs.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));

  // payer concentration
  const perPayer = new Map();
  for (const l of logs) {
    const p = l.payer.toLowerCase();
    perPayer.set(p, (perPayer.get(p) ?? 0) + 1);
  }
  const [topPayer, topCount] = [...perPayer.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);
  const topPayerShareBps = logs.length ? Math.round((topCount * 10000) / logs.length) : 0;

  // timing regularity: intervals between receipt blocks
  const intervals = [];
  for (let i = 1; i < logs.length; i++) intervals.push(logs[i].blockNumber - logs[i - 1].blockNumber);
  let regularTiming = false;
  if (intervals.length >= 3) {
    const nums = intervals.map(Number); // stats in plain numbers
    const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
    regularTiming = Math.sqrt(variance) <= Math.max(1, mean * 0.2); // near-constant cadence
  }

  // amount cycling: the same amount again and again
  const perAmount = new Map();
  for (const l of logs) {
    const a = l.amount.toString();
    perAmount.set(a, (perAmount.get(a) ?? 0) + 1);
  }
  const [topAmount, topAmountCount] = [...perAmount.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);
  const amountCycling = topAmountCount >= 3 && perAmount.size <= 2;

  const flags = [];
  if (logs.length >= 3 && perPayer.size === 1) flags.push("single-payer");
  if (perPayer.size > 1 && logs.length / perPayer.size >= 3) flags.push("repeat-heavy");
  if (regularTiming) flags.push("regular-timing");
  if (amountCycling) flags.push("amount-cycling");

  return {
    agent,
    receipts: logs.length,
    payers: perPayer.size,
    topPayerShareBps,
    topPayer,
    topAmount,
    topAmountCount,
    intervalCount: intervals.length,
    flags,
    flagged: flags.length > 0,
  };
}
