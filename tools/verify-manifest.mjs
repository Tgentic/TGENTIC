// Verify signed agent manifests offline — no RPC, no secrets. Usage:
//   node tools/verify-manifest.mjs manifests/0x….json            one file
//   node tools/verify-manifest.mjs manifests/                    whole dir (chain-resolved)
//   node tools/verify-manifest.mjs a.json b.json …               explicit chain
//
// With multiple files for one agent, resolveManifests() applies the rotation
// rule: each version must be signed by a key the previous accepted version
// authorized. The reported manifest is the trusted tip.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyManifest, resolveManifests, manifestHash } from "../gate/src/manifest.js";

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error("usage: node tools/verify-manifest.mjs <file|dir> [more files…]");
  process.exit(1);
}
const files = inputs.flatMap((p) =>
  statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).map((f) => join(p, f)) : [p]);

const manifests = files.map((f) => ({ file: f, m: JSON.parse(readFileSync(f, "utf8")) }));
const byAgent = new Map();
for (const { file, m } of manifests) {
  const k = (m.agent ?? "unknown").toLowerCase();
  if (!byAgent.has(k)) byAgent.set(k, []);
  byAgent.get(k).push({ file, m });
}

let bad = 0;
for (const [agent, list] of byAgent) {
  if (list.length === 1) {
    const { file, m } = list[0];
    const res = await verifyManifest(m);
    console.log(JSON.stringify({ file, agent: m.agent, version: m.version, manifestHash: manifestHash(m), ...res }, null, 2));
    if (!res.ok) bad++;
    continue;
  }
  const { current, chain, errors } = await resolveManifests(list.map((x) => x.m));
  console.log(JSON.stringify({ agent, files: list.map((x) => x.file), current: current ? { version: current.version, manifestHash: manifestHash(current) } : null, chain, errors }, null, 2));
  if (!current) bad++;
}
process.exit(bad ? 1 : 0);
