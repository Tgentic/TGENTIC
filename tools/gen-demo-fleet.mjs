// Generate the labeled demo fleet — populates the manifest store so the
// directory shows breadth while organic agents onboard. Every manifest is
// marked "demo": true — these are sample identities, NOT real operators.
// They never get registered on the ERC-8004 registry (shared public infra)
// and they have no receipts, so the leaderboard stays honest.
//
// Keys are generated, used to sign, then written to a gitignored local file
// so the fleet can be rotated later — they are never committed.
//
//   node tools/gen-demo-fleet.mjs [--count 100] [--prefix "demo agent"]
import { writeFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { newManifest, signManifest } from "../gate/src/manifest.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const count = Number(opt("count") ?? 100);
const prefix = opt("prefix") ?? "demo agent";
const keys = {};
for (let i = 1; i <= count; i++) {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const agent = account.address;
  const manifest = newManifest({
    chainId: 4663,
    agent,
    name: `${prefix} ${String(i).padStart(3, "0")}`,
    endpoints: [],
    signingKeys: [agent],
  });
  manifest.demo = true; // explicit label — sample identity, not a real operator
  const client = createWalletClient({ account, transport: http("https://rpc.mainnet.chain.robinhood.com") });
  const signed = await signManifest(client, manifest);
  for (const dir of ["manifests", "gate/manifests"]) {
    writeFileSync(`${dir}/${agent.toLowerCase()}.json`, JSON.stringify(signed, null, 2) + "\n");
  }
  keys[agent.toLowerCase()] = key;
}
// Local-only key file — needed to rotate/re-sign the fleet later. Gitignored.
writeFileSync(".demo-fleet-keys.json", JSON.stringify(keys, null, 2) + "\n");
console.log(`wrote ${count} demo manifests to manifests/ + gate/manifests/, keys → .demo-fleet-keys.json (gitignored)`);
