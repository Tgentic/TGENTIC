// Manipulation signals in the dapp. The detector is the gate's computeFlags —
// the same pure function the /risk endpoint and the mainnet proof scripts run,
// so the site, the API and the audits always agree on what was flagged.
// flags.js is dependency-free on purpose: this import must resolve in CI too,
// where sdk/node_modules is not installed.
import { computeFlags } from "../../../sdk/src/flags.js";

/** Run the detector over an agent's Tallied logs (viem event objects). */
export function flagsFor(agent, logs) {
  return computeFlags(
    logs.map((l) => ({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash })),
    agent,
  );
}

/** Plain-English flag names. Heuristics, not verdicts — they mark what deserves a closer look. */
export const FLAG_TEXT = {
  "single-payer": "Every receipt came from one payer — that could be self-dealing.",
  "repeat-heavy": "A small payer set accounts for most of this agent's receipts.",
  "regular-timing": "Receipts arrive at a near-constant cadence — bot-like timing.",
  "amount-cycling": "The same payment amount repeats again and again.",
};
