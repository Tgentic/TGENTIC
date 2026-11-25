// Step 3: the pure manipulation heuristics — no dependencies, so the gate,
// the dapp bundle and any offline tool all run the same detector.
// Flags are heuristics, not verdicts — they mark what deserves a closer look.

/**
 * @param {Array<{blockNumber: bigint, payer: string, amount: bigint, txHash?: string}>} logs
 * @param {string} agent
 */
export function computeFlags(logs, agent) {
  // The same payment can appear in two state layers (v1 + v2). Dedupe by the
  // payment tx hash so a merged history never counts one payment twice.
  const seen = new Map();
  for (const l of logs) {
    const key = l.txHash ? String(l.txHash).toLowerCase() : `log-${seen.size}`;
    if (!seen.has(key)) seen.set(key, l);
  }
  logs = [...seen.values()];
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
