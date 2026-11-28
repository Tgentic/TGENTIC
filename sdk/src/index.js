// @tgentic/sdk — read and verify TGENTIC agent reputation.
// One dependency (viem), one call to createClient(), defaults to mainnet 4663.
import { createPublicClient, custom, defineChain, http, isAddress } from "viem";
import { computeFlags } from "./flags.js";

export { computeFlags };

export const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

/** Deployed contract addresses on mainnet (chain 4663). */
export const addresses = {
  // v2 state layer (policy-gated): score, receipts, bond — the live read surface
  tally: "0x23537F09062134e6cfD8FF8D0a49b263D93bdB27",
  deployBlock: 122282476n,
  // v1 archive: the original single-gate line, kept for historical reads
  v1: "0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8",
  v1DeployBlock: 118987578n,
  policy: "0x4651c76C501C54b6b649F4024BE34F7C58f7f4D3",
  heuristics: "0xe9D4eaa060Eb0E7EEE599c026C217e3b06082d47",
  // the bond/payment token (USDG)
  bondToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
};

const tallyAbi = [
  { type: "function", name: "score", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reputation", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paid", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "receipts", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "payers", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bond", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "unlockAt", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minBond", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event", name: "Tallied",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "txHash", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "rating", type: "uint8", indexed: false },
    ],
  },
];

/**
 * Create a TGENTIC client. Defaults to mainnet.
 * @param {object} [o]
 * @param {string} [o.rpcUrl]      JSON-RPC endpoint (default: the public Robinhood Chain RPC)
 * @param {object} [o.provider]    an EIP-1193 provider to ride instead of http (used by tests)
 * @param {string} [o.address]     tally contract address (default: mainnet v1)
 * @param {bigint} [o.deployBlock] getLogs lower bound — required by the RPC for wide ranges
 * @param {bigint} [o.blockRange]   max blocks per getLogs page (default 8M, under the RPC's ~10M cap)
 */
export function createClient({ rpcUrl, provider, address = addresses.tally, deployBlock = addresses.deployBlock, blockRange = 8_000_000n } = {}) {
  const pub = provider
    ? createPublicClient({ transport: custom(provider) })
    : createPublicClient({ chain, transport: http(rpcUrl) });
  const read = (functionName, args = []) => pub.readContract({ address, abi: tallyAbi, functionName, args });
  // The public RPC caps a single getLogs at ~10M blocks; blockRange makes viem page the scan automatically.
  const talliedEvent = tallyAbi.find((x) => x.type === "event" && x.name === "Tallied");
  const tallied = (args = {}) => pub.getLogs({ address, events: [talliedEvent], args, fromBlock: deployBlock, blockRange });
  const need = (a) => { if (!isAddress(a)) throw new Error(`Not an address: ${a}`); return a; };

  const api = {
    /** Counted score + raw reputation + bond state. counted = bond meets the minimum. */
    async score(agent) {
      need(agent);
      const [score, reputation, paid, receipts, payers, bond, unlockAt, minBond] = await Promise.all(
        ["score", "reputation", "paid", "receipts", "payers", "bond", "unlockAt"].map((f) => read(f, [agent])).concat(read("minBond")),
      );
      return { agent, score, reputation, paid, receipts, payers, bond, unlockAt, minBond, counted: bond >= minBond };
    },

    /** An agent's receipts — each one a real payment the gate verified on chain. */
    async receipts(agent) {
      need(agent);
      const logs = await tallied({ agent });
      return logs.map((l) => ({
        payer: l.args.payer, amount: l.args.amount, rating: Number(l.args.rating),
        txHash: l.args.txHash, blockNumber: l.blockNumber, logTransactionHash: l.transactionHash,
      }));
    },

    /**
     * Manipulation signals over the receipt history (payer concentration, timing
     * regularity, amount cycling). Heuristics, not verdicts.
     */
    async risk(agent) {
      need(agent);
      const logs = await tallied({ agent });
      return computeFlags(logs.map((l) => ({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash })), agent);
    },

    /** The latest n receipts across all agents. */
    async recent(n = 10) {
      if (!Number.isInteger(n) || n <= 0) return [];
      const logs = await tallied();
      return logs.slice(-n).reverse().map((l) => ({
        agent: l.args.agent, payer: l.args.payer, amount: l.args.amount, rating: Number(l.args.rating),
        txHash: l.args.txHash, blockNumber: l.blockNumber, logTransactionHash: l.transactionHash,
      }));
    },

    /** Leaderboard rows: one entry per agent, ranked by counted score, with flag markers. */
    async top(limit = 100) {
      if (!Number.isInteger(limit) || limit <= 0) return [];
      const logs = await tallied();
      const byAgent = new Map();
      for (const l of logs) {
        const key = l.args.agent.toLowerCase();
        if (!byAgent.has(key)) byAgent.set(key, { agent: l.args.agent, logs: [] });
        byAgent.get(key).logs.push({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash });
      }
      // Rank via score() alone (1 eth_call/agent, bounded concurrency) so full 8-call
      // profile reads only run for the top `limit` agents.
      const entries = [...byAgent.values()];
      const ranked = [];
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20);
        const scores = await Promise.all(chunk.map((e) => read("score", [e.agent])));
        for (let j = 0; j < chunk.length; j++) ranked.push({ ...chunk[j], score: scores[j] });
      }
      ranked.sort((x, y) => (y.score > x.score ? 1 : y.score < x.score ? -1 : 0));
      return Promise.all(ranked.slice(0, limit).map(async ({ agent, logs: alogs }) => ({
        agent,
        ...(await api.score(agent)),
        flags: computeFlags(alogs, agent).flags,
      })));
    },

    /**
     * The one call a hiring flow needs: is this agent worth trusting?
     * verify() = score + manipulation signals in a single object.
     */
    async verify(agent) {
      const s = await api.score(agent);
      const r = await api.risk(agent);
      return { ...s, flags: r.flags, flagged: r.flagged, topPayerShareBps: r.topPayerShareBps };
    },
  };
  return api;
}
