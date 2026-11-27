// Verify a signed agent manifest offline — no RPC, no secrets. Usage:
//   node tools/verify-manifest.mjs manifests/0x….json
import { readFileSync } from "node:fs";
import { verifyManifest, manifestMessage } from "../gate/src/manifest.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/verify-manifest.mjs <file>");
  process.exit(1);
}
const m = JSON.parse(readFileSync(file, "utf8"));
const res = await verifyManifest(m);
console.log(JSON.stringify({ file, agent: m.agent, version: m.version, ...res }, null, 2));
process.exit(res.ok ? 0 : 1);
