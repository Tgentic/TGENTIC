// DEMO data to preview the dapp as if it were live. Every number and address here is made up,
// generated from seeded random values. The demo view always shows the "Demo data" label.
import { getAddress } from "viem";
import { flagsFor } from "./flags.js";

let seed = 4663;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[(rnd() * 16) | 0]).join("");
const addr = () => getAddress(`0x${hex(40)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const U = 10n ** 6n, T = 10n ** 18n;
const TOKEN = { token: addr(), minBond: 100n * T, decimals: 18, symbol: "TGENTIC" };
const payersPool = Array.from({ length: 40 }, addr);

// Nine agents with different stories: some have a bond below the minimum, some were paid by a single payer.
const PLAN = [
  { n: 38, payers: 14, bond: 420n }, { n: 27, payers: 11, bond: 260n }, { n: 21, payers: 9, bond: 150n },
  { n: 16, payers: 7, bond: 1200n }, { n: 12, payers: 6, bond: 90n }, { n: 9, payers: 1, bond: 300n },
  { n: 7, payers: 5, bond: 0n }, { n: 5, payers: 4, bond: 180n }, { n: 3, payers: 3, bond: 110n },
];
const HEAD = 118_469_320;
const logs = [];
const agents = PLAN.map((p, i) => {
  const a = addr();
  const pool = payersPool.slice(i * 3, i * 3 + p.payers);
  for (let j = 0; j < p.n; j++) {
    const payer = pool[j % pool.length];
    const cents = BigInt(Math.round((0.5 + rnd() * rnd() * 240) * 100));
    const r = rnd();
    logs.push({
      args: { agent: a, payer, txHash: `0x${hex(64)}`, amount: (cents * U) / 100n, rating: r < 0.62 ? 5 : r < 0.88 ? 4 : r < 0.97 ? 3 : 2 },
      blockNumber: BigInt(HEAD - Math.floor(rnd() * rnd() * 380_000)),
      transactionHash: `0x${hex(64)}`, logIndex: j,
    });
  }
  return { a, bond: p.bond * T, unlockAt: 0n };
});
logs.sort((x, y) => (x.blockNumber < y.blockNumber ? -1 : 1));

const agentOf = (a) => agents.find((g) => g.a.toLowerCase() === a.toLowerCase());
function readAgentNow(a) {
  const mine = logs.filter((l) => l.args.agent.toLowerCase() === a.toLowerCase());
  const reputation = mine.reduce((s, l) => s + l.args.amount * BigInt(l.args.rating), 0n);
  const paid = mine.reduce((s, l) => s + l.args.amount, 0n);
  const g = agentOf(a) ?? { bond: 0n, unlockAt: 0n };
  return { score: g.bond >= TOKEN.minBond ? reputation : 0n, reputation, paid, receipts: BigInt(mine.length), payers: BigInt(new Set(mine.map((l) => l.args.payer)).size), bond: g.bond, unlockAt: g.unlockAt };
}

// Demo wallet: plays the 3rd agent (bond 150, balance 640 TGENTIC).
const me = agents[2];
const wallet = { bal: 640n * T, allow: 0n };

export const api = {
  live: false,
  deployed: true,
  chainName: "Robinhood Chain",
  explorer: null, // demo hashes are not on chain, so nothing to link
  demoAgents: agents.map((g) => g.a),
  readToken: async () => { await sleep(350); return TOKEN; },
  readAgent: async (a) => { await sleep(700); return readAgentNow(a); },
  receipts: async (a) => { await sleep(500); return logs.filter((l) => l.args.agent.toLowerCase() === a.toLowerCase()).slice(-50).reverse(); },
  recent: async (n = 8) => { await sleep(600); return logs.slice(-n).reverse(); },
  board: async () => {
    await sleep(900);
    return { tk: TOKEN, rows: agents.map((g) => ({ a: g.a, ...readAgentNow(g.a), flags: flagsFor(g.a, logs.filter((l) => l.args.agent === g.a)).flags })) };
  },
  hasWallet: () => true,
  connect: async () => { await sleep(700); return me.a; },
  bondState: async () => { await sleep(500); return { tk: TOKEN, d: readAgentNow(me.a), bal: wallet.bal, allow: wallet.allow }; },
  async send(_account, kind, value) {
    await sleep(1100);
    if (kind === "approve") wallet.allow = value;
    if (kind === "deposit") { me.bond += value; wallet.bal -= value; wallet.allow -= value; me.unlockAt = 0n; }
    if (kind === "startUnlock") me.unlockAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
    if (kind === "withdraw") { me.bond -= value; wallet.bal += value; me.unlockAt = 0n; }
    return `0x${hex(64)}`;
  },
};
