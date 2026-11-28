// Buy a signed audit report from the gate's x402 endpoint — the full agent
// flow in one command: read the 402 offer, sign the EIP-3009 authorization,
// pay, verify the report signature offline, save the artifact.
//
//   node tools/buy-report.mjs <agent-address> --key 0xPAYER_KEY
//   node tools/buy-report.mjs <agent-address> --key 0x… --gate http://localhost:4022 --out report.json
//
// The payment tallies as a receipt for the auditor — the buyer is on record.
// Requires enough USDG for the price (the offer tells you how much).
import { writeFileSync } from "node:fs";
import { createWalletClient, http, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createGateClient, chain } from "../sdk/src/index.js";
import { manifestMessage } from "../gate/src/manifest.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const agent = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const key = opt("key", process.env.PAYER_KEY);
const gate = opt("gate", "https://www.tgentic.xyz");
const out = opt("out", "");
const html = args.includes("--html");

if (!agent || !key) {
  console.error("usage: node tools/buy-report.mjs <agent-address> --key 0xPAYER_KEY [--gate url] [--out file] [--html]");
  process.exit(1);
}

const payer = privateKeyToAccount(key);
const walletClient = createWalletClient({ account: payer, chain, transport: http() });
const tg = createGateClient({ gateUrl: gate });

console.error(`offer ← ${gate}/audit/report?agent=${agent}`);
const req = await tg.auditOffer(agent, { buyer: payer.address });
console.error(`  ${req.amount} atomic ${req.asset} → ${req.payTo} (scheme ${req.scheme}, ${req.network})`);
console.error(`paying with ${payer.address}…`);

const { report, settle } = await tg.buyAudit(agent, walletClient, undefined, { format: html ? "html" : undefined });
if (!settle?.success) {
  console.error(`settle failed: ${JSON.stringify(settle)}`);
  process.exit(1);
}
console.error(`settled: ${settle.transaction}`);

if (html) {
  // The HTML file embeds the signed JSON — verify by recovering the signature.
  const target = out || `audit-report-${agent}.html`;
  writeFileSync(target, report);
  console.error(`saved → ${target} (open in a browser — verification instructions inside)`);
  process.exit(0);
}

// The report's value is the signature — verify it recovers the auditor
// before trusting a byte of the body.
const signer = await recoverMessageAddress({ message: manifestMessage(report), signature: report.signature });
const auditor = report.auditor?.agent;
if (signer.toLowerCase() !== auditor?.toLowerCase()) {
  console.error(`BAD SIGNATURE — recovered ${signer}, expected auditor ${auditor}. Do not trust this report.`);
  process.exit(1);
}
console.error(`signature ✓ — signed by auditor ${signer}`);
console.error(`verdict: ${report.summary}`);

if (out) {
  writeFileSync(out, JSON.stringify({ report, payment: settle }, null, 2));
  console.error(`saved → ${out}`);
} else {
  console.log(JSON.stringify({ report, payment: settle }, null, 2));
}
