// Paid audit endpoint, merged into the gate — the same x402 "exact" flow the
// standalone agents/auditor service runs, but settled directly on chain by our
// own whitelisted facilitator wallet instead of an external facilitator. That
// removes the facilitator-availability dependency (a facilitator that has no
// gas cannot settle) while keeping the wire format identical: PAYMENT-SIGNATURE
// in, PAYMENT-RESPONSE out, EIP-3009 transferWithAuthorization on USDG.
import { getAddress, isHex, hexToSignature, parseEventLogs } from "viem";
import { assessAgent } from "./heuristics.js";
import { manifestHash, manifestMessage } from "./manifest.js";

export const REPORT_TYPE = "tgentic/audit-report/1";
export const USDG_DOMAIN = { name: "Global Dollar", version: "1" };

const receiptsAbi = [
  { type: "function", name: "score", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reputation", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "receipts", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "payers", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bond", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];

const usdgAbi = [
  {
    type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable", outputs: [],
    inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
    ],
  },
  {
    type: "function", name: "authorizationState", stateMutability: "view", outputs: [{ type: "bool" }],
    inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view", outputs: [{ type: "uint256" }],
    inputs: [{ name: "a", type: "address" }],
  },
];

const transferEvent = [{ type: "event", name: "Transfer", inputs: [
  { type: "address", name: "from", indexed: true }, { type: "address", name: "to", indexed: true }, { type: "uint256", name: "value" },
] }];

const authTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
};

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** The payment terms every buyer must satisfy — one asset, one network, one price. */
export function auditRequirements(ctx) {
  const a = ctx.audit;
  return {
    scheme: "exact",
    network: `eip155:${ctx.chainId}`,
    asset: ctx.usdg,
    amount: a.amount,
    payTo: a.payTo,
    maxTimeoutSeconds: 300,
    extra: USDG_DOMAIN,
  };
}

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

/** Independent read of the subject's record, signed by the auditor key. */
export async function buildAuditReport(ctx, agent) {
  const subject = getAddress(agent.toLowerCase());
  const read = (fn) => ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: fn, args: [subject] });
  const [score, bond, receipts, payers, reputation, risk] = await Promise.all(
    ["score", "bond", "receipts", "payers", "reputation"].map(read)
      .concat([assessAgent(ctx.publicClient, { address: ctx.tgentic, agent: subject, fromBlock: ctx.detectFromBlock })]),
  );
  const m = ctx.manifests?.byAgent?.get(subject.toLowerCase());
  const manifest = m ? {
    name: m.name, version: m.version, agentId: m.agentId ?? null,
    demo: m.demo === true, manifestHash: manifestHash(m), verified: true,
  } : null;
  const counted = score > 0n;
  const a = ctx.audit;
  const report = {
    type: REPORT_TYPE,
    auditor: { name: a.name, agent: a.account.address, ...(a.agentId !== undefined ? { agentId: a.agentId } : {}) },
    subject: { agent: subject, manifest },
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
  const signature = await a.account.signMessage({ message: manifestMessage(report) });
  return { ...report, signature };
}

/** Decode and check the buyer's EIP-3009 authorization — cheap rejects before any gas. */
async function verifyPayment(ctx, payload) {
  const a = ctx.audit;
  const req = auditRequirements(ctx);
  const auth = payload?.payload?.authorization;
  const signature = payload?.payload?.signature;
  const invalid = (reason) => ({ isValid: false, invalidReason: reason });
  if (!auth || !isHex(signature)) return invalid("malformed_payload");
  const accepted = payload?.accepted;
  if (accepted?.scheme !== "exact" || accepted?.network !== req.network) return invalid("unsupported_scheme_or_network");
  let to, value, validAfter, validBefore, from;
  try {
    from = getAddress(auth.from); to = getAddress(auth.to);
    value = BigInt(auth.value); validAfter = BigInt(auth.validAfter); validBefore = BigInt(auth.validBefore);
  } catch { return invalid("malformed_authorization"); }
  if (!isHex(auth.nonce) || auth.nonce.length !== 66) return invalid("malformed_authorization");
  if (to.toLowerCase() !== req.payTo.toLowerCase()) return invalid("recipient_mismatch");
  if (value !== BigInt(req.amount)) return invalid("amount_mismatch");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < validAfter) return invalid("authorization_not_yet_valid");
  if (now >= validBefore) return invalid("authorization_expired");
  if (accepted?.asset && accepted.asset.toLowerCase() !== ctx.usdg.toLowerCase()) return invalid("asset_mismatch");
  // The signature must recover the authorizer under USDG's EIP-712 domain —
  // the same message the token contract itself checks inside the settle call.
  try {
    const ok = await ctx.publicClient.verifyTypedData({
      address: from,
      domain: { ...USDG_DOMAIN, chainId: ctx.chainId, verifyingContract: ctx.usdg },
      types: authTypes, primaryType: "TransferWithAuthorization",
      message: { from, to, value, validAfter, validBefore, nonce: auth.nonce },
      signature,
    });
    if (!ok) return invalid("invalid_signature");
  } catch { return invalid("invalid_signature"); }
  // A spent nonce settles nothing — check before spending gas.
  const used = await ctx.publicClient.readContract({
    address: ctx.usdg, abi: usdgAbi, functionName: "authorizationState", args: [from, auth.nonce],
  });
  if (used) return invalid("nonce_already_used");
  // An underfunded payer only buys us a reverted settle — reject it up front.
  const balance = await ctx.publicClient.readContract({
    address: ctx.usdg, abi: usdgAbi, functionName: "balanceOf", args: [from],
  });
  if (balance < value) return invalid("insufficient_balance");
  return { isValid: true, payer: from };
}

/** Submit the authorization from the gate's facilitator wallet — any EOA can relay
 *  a valid EIP-3009 signature; ours is also in the gate's facilitator set, so the
 *  resulting Transfer tallies as a receipt like every other sale. */
async function settlePayment(ctx, payload) {
  const auth = payload.payload.authorization;
  const { v, r, s } = hexToSignature(payload.payload.signature);
  const hash = await ctx.audit.settler.writeContract({
    address: ctx.usdg, abi: usdgAbi, functionName: "transferWithAuthorization",
    args: [getAddress(auth.from), getAddress(auth.to), BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, v, r, s],
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  const ok = receipt.status === "success" && parseEventLogs({ abi: transferEvent, logs: receipt.logs })
    .some((l) => l.args.from.toLowerCase() === auth.from.toLowerCase() && l.args.to.toLowerCase() === auth.to.toLowerCase() && l.args.value === BigInt(auth.value));
  if (!ok) return { success: false, errorReason: "transaction_failed", transaction: hash, network: `eip155:${ctx.chainId}`, payer: getAddress(auth.from) };
  return { success: true, transaction: hash, network: `eip155:${ctx.chainId}`, payer: getAddress(auth.from) };
}

/**
 * GET /audit/report?agent= — the payment-gated audit.
 * Returns { status, headers, body } for the caller to send.
 */
export async function handleAudit(ctx, req) {
  const q = new URL(req.url, "https://x").searchParams;
  const agent = q.get("agent") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(agent))
    return { status: 400, headers: {}, body: { error: "BAD_AGENT", message: "Send ?agent=0x… — a 20-byte hex address." } };

  const requirements = auditRequirements(ctx);
  const resource = {
    url: `https://www.tgentic.xyz/audit/report?agent=${agent}`,
    description: "Signed agent-trust audit: on-chain score, receipt trail, manipulation heuristics and identity manifest — verified and attested by the auditor",
    mimeType: "application/json",
  };
  const paymentRequired = { x402Version: 2, error: "Payment required", resource, accepts: [requirements] };
  const need402 = (error) => ({
    status: 402,
    headers: { "payment-required": b64(JSON.stringify({ ...paymentRequired, error })), "cache-control": "no-store" },
    body: { ...paymentRequired, error },
  });

  const header = req.headers["payment-signature"] || req.headers["x-payment"];
  if (!header) return need402("Payment required");

  let payload;
  try { payload = JSON.parse(Buffer.from(String(header), "base64").toString("utf8")); }
  catch { return need402("Malformed PAYMENT-SIGNATURE header"); }

  let verdict;
  try { verdict = await verifyPayment(ctx, payload); }
  catch (e) {
    console.error("audit verify failed:", e?.shortMessage ?? e?.message ?? e);
    return need402("verification_failed");
  }
  if (!verdict.isValid) return need402(verdict.invalidReason);

  // Build before settle: if the report cannot be produced there is nothing to sell.
  let report;
  try { report = await buildAuditReport(ctx, agent); }
  catch (e) {
    console.error("audit report failed:", e?.shortMessage ?? e?.message ?? e);
    return { status: 500, headers: {}, body: { error: "INTERNAL", message: "The report could not be built." } };
  }

  let settle;
  try { settle = await settlePayment(ctx, payload); }
  catch (e) {
    console.error("audit settle failed:", e?.shortMessage ?? e?.message ?? e);
    return { status: 402, headers: {}, body: { error: "settlement_failed" } };
  }
  if (!settle.success) return { status: 402, headers: {}, body: { error: "settlement_failed", reason: settle.errorReason, transaction: settle.transaction } };

  return {
    status: 200,
    headers: { "payment-response": b64(JSON.stringify(settle)) },
    body: {
      ...report,
      tgentic: {
        gate: "https://www.tgentic.xyz/tally",
        next: "Take the transaction hash from the PAYMENT-RESPONSE header, sign the TGENTIC feedback message with the wallet that paid, and POST it to the gate — that is how this audit becomes a receipt.",
      },
    },
  };
}
