// Mint a viewing grant: the payer delegates read access to their receipt
// history to a viewer (a marketplace, an auditor) — signed, scoped, expiring,
// and never spending power.
//
//   node tools/grant-view.mjs --key 0xPAYER_KEY --viewer 0xVIEWER [--days 30] [--gate https://www.tgentic.xyz]
//
// Prints the grant (JSON + base64 for the ?grant= param) and the exact query
// a marketplace runs against it.
import { privateKeyToAccount } from "viem/accounts";
import { signViewGrant, encodeViewGrant } from "../sdk/src/index.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const key = opt("key", process.env.PAYER_KEY);
const viewer = opt("viewer", "");
const days = Number(opt("days", "30"));
const gate = opt("gate", "https://www.tgentic.xyz").replace(/\/+$/, "");

if (!key || !/^0x[0-9a-fA-F]{40}$/.test(viewer)) {
  console.error("usage: node tools/grant-view.mjs --key 0xPAYER_KEY --viewer 0xVIEWER [--days 30] [--gate url]");
  process.exit(1);
}

const payer = privateKeyToAccount(key);
const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(days * 86400);
const grant = await signViewGrant(payer, { payer: payer.address, viewer, expiresAt });
const encoded = encodeViewGrant(grant);

console.log(JSON.stringify({ grant }, null, 2));
console.error(`
signed by payer ${payer.address}
delegates receipts read → ${grant.viewer}
expires ${new Date(expiresAt * 1000).toISOString()} (${days}d)

the marketplace's query:
  curl '${gate}/payers/${payer.address}?viewer=${grant.viewer}&grant=${encoded}'

response carries viewGrant: { valid: true } — the consent artifact itself
verifies offline: recoverMessageAddress(grantMessage(grant), signature) = payer
`);
