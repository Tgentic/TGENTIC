// The audit itself — reads the Receipts contract and receipt trail directly
// (independent verification, not a proxy of the gate's opinions), resolves the
// subject's manifest via the gate, then signs the whole report with the
// auditor's own key. Whoever buys this report can re-verify every claim
// on-chain and the signature offline.
import { getAddress, parseAbi } from "viem";
import { assessAgent } from "../../../gate/src/heuristics.js";
import { manifestMessage } from "../../../gate/src/manifest.js";

const receiptsAbi = parseAbi([
  "function score(address) view returns (uint256)",
  "function bond(address) view returns (uint256)",
  "function receipts(address) view returns (uint256)",
  "function payers(address) view returns (uint256)",
  "function reputation(address) view returns (uint256)",
]);

export const REPORT_TYPE = "tgentic/audit-report/1";

const fetchManifest = async (gateUrl, agent) => {
  try {
    const r = await fetch(`${gateUrl}/manifest/${agent.toLowerCase()}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

/** Plain-language verdict derived only from the measured facts. */
const summarize = ({ receipts, payers, counted, flagged, flags, manifest }) => {
  if (receipts === 0n)
    return "No paid work is recorded for this agent — there is nothing to verify, not even a baseline.";
  const parts = [`${receipts.toString()} receipt${receipts === 1n ? "" : "s"} from ${payers.toString()} unique payer${payers === 1n ? "" : "s"}`];
  if (!counted) parts.push("bond below the counting threshold, so the score is hidden");
  if (flagged) parts.push(`manipulation heuristics flagged: ${flags.join(", ")}`);
  else parts.push("no manipulation flags");
  if (!manifest) parts.push("no signed identity manifest");
  return `Paid-work record: ${parts.join("; ")}.`;
};

/**
 * @param {object} o
 * @param {import("viem").PublicClient} o.publicClient
 * @param {import("viem").WalletClient} o.signer      the auditor's wallet — pays nothing, signs the report
 * @param {string} o.tgentic    Receipts contract address
 * @param {string} o.gateUrl    gate base URL — manifest lookup + tally hint in the response
 * @param {string} o.agent      subject agent address
 * @param {object} o.auditor    { name, agentId? } identity claims about this auditor
 */
export async function buildReport({ publicClient, signer, tgentic, gateUrl, agent, auditor }) {
  const subject = getAddress(agent.toLowerCase());
  const read = (fn) => publicClient.readContract({ address: tgentic, abi: receiptsAbi, functionName: fn, args: [subject] });
  const [score, bond, receipts, payers, reputation, risk, manifest] = await Promise.all([
    "score", "bond", "receipts", "payers", "reputation",
  ].map(read).concat([assessAgent(publicClient, { address: tgentic, agent: subject }), fetchManifest(gateUrl, subject)]));

  const counted = score > 0n;
  const report = {
    type: REPORT_TYPE,
    auditor: { name: auditor.name, agent: auditor.address, ...(auditor.agentId !== undefined ? { agentId: auditor.agentId } : {}) },
    subject: {
      agent: subject,
      manifest: manifest
        ? { name: manifest.name, version: manifest.version, agentId: manifest.agentId ?? null, demo: manifest.demo === true, manifestHash: manifest.manifestHash ?? null, verified: true }
        : null,
    },
    financials: {
      score: score.toString(), reputation: reputation.toString(), receipts: receipts.toString(),
      payers: payers.toString(), bond: bond.toString(), counted,
    },
    risk: {
      flagged: risk.flagged, flags: risk.flags,
      topPayerShareBps: risk.topPayerShareBps, topAmount: String(risk.topAmount), intervalCount: risk.intervalCount,
    },
    summary: summarize({ receipts, payers, counted, flagged: risk.flagged, flags: risk.flags, manifest }),
    issuedAt: new Date().toISOString(),
  };
  const signature = await signer.signMessage({ message: manifestMessage(report) });
  return { ...report, signature };
}
