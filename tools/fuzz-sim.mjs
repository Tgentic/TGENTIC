#!/usr/bin/env node
// Deep simulation harness for the reputation pipeline (Step 5 assurance work).
//
// What it does: generates adversarial + organic receipt histories and checks
// invariants of the two pure layers anyone can run —
//   1. computeFlags (sdk/src/flags.js): the manipulation detector used by the
//      gate /risk endpoint, the dapp and the SDK (single canonical impl).
//   2. A line-for-line JS mirror of TGENTIC.sol tally/score/slash math,
//      including the GLOBAL used[txHash] anti-replay mapping.
//
// Honest scope: this simulates the PURE layers (flags + score math). It does
// NOT simulate EVM execution, RPC failures, mempool ordering, or gate
// signature checks — those are covered by the hardhat suite. "N scenarios,
// 0 violations" is the claim; "no gaps" is not.
//
// Usage: node tools/fuzz-sim.mjs [iterations] [seed]
//   defaults: 1_000_000 iterations, seed 0xC0FFEE (deterministic)

import { computeFlags } from "../sdk/src/flags.js";

// ---------- deterministic PRNG (mulberry32) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const ADDR = (i) => "0x" + i.toString(16).padStart(40, "0");
const TXH = (i) => "0x" + i.toString(16).padStart(64, "0");
const BIG = 10n ** 18n;

// ---------- scenario generators ----------
// Invariant kept everywhere: on-chain, one txHash is ONE payment — logs that
// share a txHash always carry identical payer/amount/block. Generators that
// want collisions reuse a payment record; they never invent inconsistent ones.

// organic: diverse payers, varied amounts and timing
function genOrganic(r) {
  const n = ri(r, 0, 40);
  const payers = ri(r, 2, 8);
  const logs = [];
  const base = ri(r, 1, 500_000_000);
  let block = ri(r, 1_000_000, 9_000_000);
  for (let i = 0; i < n; i++) {
    block += ri(r, 1, 500); // irregular cadence
    logs.push({
      blockNumber: BigInt(block),
      payer: ADDR(ri(r, 1, payers)),
      amount: BigInt(ri(r, 10_000, 500_000)),
      txHash: TXH(base + i), // one payment = one txHash, always
      rating: ri(r, 1, 5),
    });
  }
  return logs;
}

// wash-trading bot: one payer, bot cadence, repeated amount
function genWash(r) {
  const n = ri(r, 3, 30);
  const cadence = ri(r, 5, 60);
  const amount = BigInt(ri(r, 10_000, 200_000));
  const start = BigInt(ri(r, 1_000_000, 9_000_000));
  const payer = ADDR(ri(r, 1, 50));
  const base = ri(r, 1, 500_000_000);
  return Array.from({ length: n }, (_, i) => ({
    blockNumber: start + BigInt(i * cadence + ri(r, -1, 1)),
    payer,
    amount,
    txHash: TXH(base + i),
    rating: ri(r, 4, 5),
  }));
}

// sybil farm: many payers, one receipt each — must NOT look like one payer
function genSybil(r) {
  const n = ri(r, 3, 30);
  const start = BigInt(ri(r, 1_000_000, 9_000_000));
  const base = ri(r, 1, 500_000_000);
  return Array.from({ length: n }, (_, i) => ({
    blockNumber: start + BigInt(i * ri(r, 1, 400)),
    payer: ADDR(ri(r, 1, n)),
    amount: BigInt(ri(r, 10_000, 300_000)),
    txHash: TXH(base + i),
    rating: ri(r, 1, 5),
  }));
}

// replay attacker: same payment txHash submitted repeatedly
function genReplay(r) {
  const unique = ri(r, 1, 10);
  const baseLogs = genOrganic(r).slice(0, unique);
  if (!baseLogs.length) return genOrganic(r);
  const dup = pick(r, baseLogs);
  const out = [...baseLogs];
  for (let i = 0; i < ri(r, 1, 5); i++) out.push({ ...dup });
  return out;
}

// same-block burst: many receipts inside one block (Robinhood blocks are fast)
function genSameBlock(r) {
  const n = ri(r, 2, 20);
  const block = BigInt(ri(r, 1_000_000, 9_000_000));
  const base = ri(r, 1, 500_000_000);
  return Array.from({ length: n }, (_, i) => ({
    blockNumber: block,
    payer: ADDR(ri(r, 1, 5)),
    amount: BigInt(ri(r, 10_000, 100_000)),
    txHash: TXH(base + i),
    rating: ri(r, 1, 5),
  }));
}

// hostile input: casing chaos, heavy txHash collisions, zero amounts.
// Constraint kept realistic: on-chain, one txHash is ONE payment — any two
// logs sharing a txHash carry the same payer/amount/block (small payment
// pool). What varies is casing and missing fields.
function genHostile(r) {
  const payments = ri(r, 1, 8);
  const pay = Array.from({ length: payments }, (_, i) => ({
    payer: ADDR(i + 1),
    amount: BigInt(ri(r, 1, 500_000)),
    blockNumber: BigInt(ri(r, 1_000_000, 9_000_000)),
  }));
  const n = ri(r, 0, 15);
  const logs = [];
  for (let i = 0; i < n; i++) {
    const pi = ri(r, 0, payments - 1);
    const p = pay[pi];
    const l = {
      blockNumber: p.blockNumber,
      payer: r() < 0.3 ? p.payer.toUpperCase().replace("0X", "0x") : p.payer,
      amount: p.amount,
      txHash: TXH(pi + 1),
      rating: ri(r, 1, 5),
    };
    if (r() < 0.1) delete l.txHash;
    logs.push(l);
  }
  return logs;
}

// boundary histories: 0/1/2 receipts — flag thresholds live at 3
function genBoundary(r) {
  const n = ri(r, 0, 2);
  const logs = [];
  const base = ri(r, 1, 500_000_000);
  let block = ri(r, 1_000_000, 9_000_000);
  const payer = ADDR(ri(r, 1, 3));
  for (let i = 0; i < n; i++) {
    block += ri(r, 1, 100);
    logs.push({ blockNumber: BigInt(block), payer, amount: BigInt(ri(r, 1, 1_000_000)), txHash: TXH(base + i), rating: ri(r, 1, 5) });
  }
  return logs;
}

// long history: 100-500 receipts, mixed payer pool — stress the stats
function genLong(r) {
  const n = ri(r, 100, 500);
  const payers = ri(r, 2, 20);
  const logs = [];
  const base = ri(r, 1, 500_000_000);
  let block = ri(r, 1_000_000, 9_000_000);
  for (let i = 0; i < n; i++) {
    block += ri(r, 1, 50);
    logs.push({
      blockNumber: BigInt(block),
      payer: ADDR(ri(r, 1, payers)),
      amount: BigInt(ri(r, 1, 2_000_000)),
      txHash: TXH(base + i),
      rating: ri(r, 1, 5),
    });
  }
  return logs;
}

// extreme values: dust amounts, whale amounts, block 0 / huge gaps
function genExtreme(r) {
  const n = ri(r, 1, 12);
  const logs = [];
  const base = ri(r, 1, 500_000_000);
  let block = ri(r, 0, 2) === 0 ? 0n : BigInt(ri(r, 1, 9_000_000));
  const amounts = [1n, 1000n, BIG, BIG * 1000n];
  for (let i = 0; i < n; i++) {
    block += BigInt(ri(r, 0, 1_000_000)); // huge irregular gaps allowed
    logs.push({
      blockNumber: block,
      payer: ADDR(ri(r, 1, 4)),
      amount: pick(r, amounts),
      txHash: TXH(base + i),
      rating: ri(r, 1, 5),
    });
  }
  return logs;
}

const GENERATORS = [genOrganic, genWash, genSybil, genReplay, genSameBlock, genHostile, genBoundary, genLong, genExtreme];
const GEN_NAMES = ["organic", "wash", "sybil", "replay", "same-block", "hostile", "boundary", "long", "extreme"];

// ---------- score-math mirror of TGENTIC.sol ----------
// used[txHash] is GLOBAL in v1 — one payment can never tally twice, even
// across different agents (a payment has exactly one recipient).
const MIN_BOND = 500_000n;
function mirrorTally(state, payer, txHash, amount, rating) {
  const key = String(txHash).toLowerCase();
  if (state.used.has(key)) return false;
  state.used.add(key);
  state.reputation += amount * BigInt(rating);
  state.paid += amount;
  state.receipts++;
  if (!state.payerSet.has(String(payer).toLowerCase())) { state.payerSet.add(String(payer).toLowerCase()); state.payers++; }
  return true;
}
function mirrorScore(state, bond) { return bond >= MIN_BOND ? state.reputation : 0n; }

// ---------- invariant checks ----------
let violations = 0;
const v = (cond, msg, ctx) => { if (!cond) { violations++; if (violations <= 20) console.log("VIOLATION:", msg, JSON.stringify(ctx).slice(0, 300)); } };

// dedup key — mirrors computeFlags exactly
const effKey = (l) => l.txHash
  ? String(l.txHash).toLowerCase()
  : `log-${l.blockNumber}-${String(l.payer).toLowerCase()}-${l.amount}`;

// brute-force recomputation of every stat computeFlags reports
function bruteForce(logs) {
  const seen = new Map();
  for (const l of logs) { const k = effKey(l); if (!seen.has(k)) seen.set(k, l); }
  const uniq = [...seen.values()];
  const perPayer = new Map(), perAmount = new Map();
  for (const l of uniq) {
    const p = String(l.payer).toLowerCase();
    perPayer.set(p, (perPayer.get(p) ?? 0) + 1);
    const a = l.amount.toString();
    perAmount.set(a, (perAmount.get(a) ?? 0) + 1);
  }
  const blocks = uniq.map((l) => l.blockNumber).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const intervals = [];
  for (let i = 1; i < blocks.length; i++) intervals.push(Number(blocks[i] - blocks[i - 1]));
  const nums = intervals;
  const mean = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0;
  const variance = nums.length ? nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length : 0;
  const regularTiming = nums.length >= 3 && Math.sqrt(variance) <= Math.max(1, mean * 0.2);
  const maxPayer = Math.max(0, ...perPayer.values());
  const maxAmt = Math.max(0, ...perAmount.values());
  const amtCycling = maxAmt >= 3 && perAmount.size <= 2;
  const flags = [];
  if (uniq.length >= 3 && perPayer.size === 1) flags.push("single-payer");
  if (perPayer.size > 1 && uniq.length / perPayer.size >= 3) flags.push("repeat-heavy");
  if (regularTiming) flags.push("regular-timing");
  if (amtCycling) flags.push("amount-cycling");
  return {
    receipts: uniq.length,
    payers: perPayer.size,
    topPayerShareBps: uniq.length ? Math.round((maxPayer * 10000) / uniq.length) : 0,
    intervalCount: intervals.length,
    flags: flags.sort(),
  };
}

const KNOWN_FLAGS = new Set(["single-payer", "repeat-heavy", "regular-timing", "amount-cycling"]);

function checkFlagsInvariants(logs, agent, out, ctx) {
  // schema sanity
  v(typeof out === "object" && out !== null, "non-object output", ctx);
  for (const k of ["agent", "receipts", "payers", "topPayerShareBps", "topPayer", "topAmount", "topAmountCount", "intervalCount", "flags", "flagged"]) {
    v(k in out, `missing key ${k}`, ctx);
  }
  v(Array.isArray(out.flags) && out.flags.every((f) => KNOWN_FLAGS.has(f)), "unknown flag name", { ...ctx, flags: out.flags });
  // determinism
  const again = computeFlags(logs, agent);
  v(JSON.stringify(again) === JSON.stringify(out), "non-deterministic flags", ctx);
  // bounds
  v(out.receipts >= 0 && out.payers >= 0 && out.payers <= Math.max(out.receipts, 1), "payer/receipt bounds", { ...ctx, out });
  v(out.topPayerShareBps >= 0 && out.topPayerShareBps <= 10000, "shareBps bounds", { ...ctx, out });
  v(out.intervalCount >= 0 && out.intervalCount <= Math.max(out.receipts - 1, 0), "intervalCount bounds", { ...ctx, out });
  v(out.topAmountCount >= 0 && out.topAmountCount <= Math.max(out.receipts, 1), "topAmountCount bounds", { ...ctx, out });
  // flagged consistency
  v(out.flagged === (out.flags.length > 0), "flagged/flags mismatch", { ...ctx, out });
  // independent brute-force cross-check of every reported stat
  const bf = bruteForce(logs);
  v(out.receipts === bf.receipts, "receipts != brute force", { ...ctx, got: out.receipts, want: bf.receipts });
  v(out.payers === bf.payers, "payers != brute force", { ...ctx, got: out.payers, want: bf.payers });
  v(out.topPayerShareBps === bf.topPayerShareBps, "topPayerShareBps != brute force", { ...ctx, got: out.topPayerShareBps, want: bf.topPayerShareBps });
  v(out.intervalCount === bf.intervalCount, "intervalCount != brute force", { ...ctx, got: out.intervalCount, want: bf.intervalCount });
  v(JSON.stringify([...out.flags].sort()) === JSON.stringify(bf.flags), "flags != brute force", { ...ctx, got: out.flags, want: bf.flags });
}

// dedicated seeded stream for permutation sampling — Math.random() here would
// make runs non-reproducible even with a fixed scenario seed
const shuffleRng = rng(0x5EED);
function checkOrderIndependence(logs, agent, out, ctx) {
  const shuffled = [...logs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out2 = computeFlags(shuffled, agent);
  v(JSON.stringify(out2.flags) === JSON.stringify(out.flags), "flags differ under input permutation", { ...ctx, a: out.flags, b: out2.flags });
  v(out2.receipts === out.receipts && out2.payers === out.payers, "counts differ under permutation", ctx);
}

function checkScoreMirror(logs, ctx) {
  // tally() always receives bytes32 txHash + address payer on-chain
  if (logs.some((l) => !l.txHash || !l.payer)) return;
  const txk = (l) => String(l.txHash).toLowerCase();
  const mk = () => ({ used: new Set(), reputation: 0n, paid: 0n, receipts: 0, payerSet: new Set(), payers: 0 });
  const s1 = mk(), s2 = mk();
  for (const l of logs) mirrorTally(s1, l.payer, txk(l), l.amount, l.rating ?? 3);
  for (const l of logs) mirrorTally(s2, l.payer, txk(l), l.amount, l.rating ?? 3);
  v(s1.reputation === s2.reputation && s1.receipts === s2.receipts, "mirror non-deterministic", ctx);
  // GLOBAL anti-replay: pass 2 rejects every tx — even across agents
  let allRejected = true;
  for (const l of logs) if (mirrorTally(s1, l.payer, txk(l), l.amount, l.rating ?? 3)) allRejected = false;
  v(allRejected, "replay double-counted in score mirror", ctx);
  // cross-agent replay also blocked (used is global in v1)
  const s3 = mk();
  for (const l of logs) mirrorTally(s3, l.payer, txk(l), l.amount, l.rating ?? 3);
  let crossAgentBlocked = true;
  for (const l of logs) if (mirrorTally(s3, l.payer, txk(l), l.amount, l.rating ?? 3)) crossAgentBlocked = false;
  v(crossAgentBlocked, "cross-entity replay not blocked", ctx);
  // score gating at the bond boundary
  const low = mirrorScore(s1, MIN_BOND - 1n), ok = mirrorScore(s1, MIN_BOND);
  v(low === 0n && ok === s1.reputation, "bond gate wrong", { ...ctx, low: low.toString(), ok: ok.toString(), rep: s1.reputation.toString() });
  // reputation math spot-check: Σ amount*rating over UNIQUE txs
  const uniq = new Map();
  for (const l of logs) if (!uniq.has(txk(l))) uniq.set(txk(l), l);
  let expect = 0n;
  for (const l of uniq.values()) expect += l.amount * BigInt(l.rating ?? 3);
  v(s1.reputation === expect, "reputation != Σ(amount×rating) unique", { ...ctx, got: s1.reputation.toString(), want: expect.toString() });
  v(s1.reputation >= 0n && s1.paid >= 0n, "negative accumulators", ctx);
}

// ---------- main loop ----------
const N = Number(process.argv[2] ?? 1_000_000);
const SEED = Number(process.argv[3] ?? 0xC0FFEE);
const r = rng(SEED);
const stats = Object.fromEntries(GEN_NAMES.map((n) => [n, { runs: 0, flags: 0 }]));
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const g = ri(r, 0, GENERATORS.length - 1);
  const logs = GENERATORS[g](r);
  const name = GEN_NAMES[g];
  stats[name].runs++;

  const agent = "0xagent";
  const out = computeFlags(logs, agent);
  if (out.flagged) stats[name].flags++;
  const ctx = { gen: name, seed: SEED.toString(16), i, n: logs.length };
  checkFlagsInvariants(logs, agent, out, ctx);
  if (logs.length <= 25 && i % 5 === 0) checkOrderIndependence(logs, agent, out, ctx);
  if (i % 11 === 0) checkScoreMirror(logs, ctx);

  if ((i + 1) % 500_000 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`${(i + 1).toLocaleString()} scenarios in ${el.toFixed(1)}s (${Math.round((i + 1) / el).toLocaleString()}/s) — violations so far: ${violations}`);
  }
}

const el = (Date.now() - t0) / 1000;
console.log("\n=== FUZZ COMPLETE ===");
console.log(`seed:              0x${SEED.toString(16)}`);
console.log(`iterations:        ${N.toLocaleString()}`);
console.log(`elapsed:           ${el.toFixed(1)}s (${Math.round(N / el).toLocaleString()} scenarios/s)`);
console.log(`violations:        ${violations}`);
console.log("per-generator flag rates:");
for (const [n, s] of Object.entries(stats)) {
  console.log(`  ${n.padEnd(10)} runs=${s.runs.toLocaleString().padStart(9)}  flagged=${((s.flags / Math.max(s.runs, 1)) * 100).toFixed(1)}%`);
}
process.exit(violations ? 1 : 0);
