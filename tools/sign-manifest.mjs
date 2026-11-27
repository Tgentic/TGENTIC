// Sign an agent manifest (Step 6). Keys come from the environment only —
// this script never writes them anywhere. Usage:
//   AGENT_KEY=0x… node tools/sign-manifest.mjs --agent 0x… --name "…" \
//     [--agent-id 26520] [--endpoint web=https://…] [--key 0x…] [--out manifests/0x….json]
import { writeFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { newManifest, signManifest, manifestMessage } from "../gate/src/manifest.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const opts = (name) => args.filter((a, i) => a === `--${name}`).map((_, j) => args[args.indexOf(`--${name}`, j) + 1]);

const key = process.env.AGENT_KEY;
const agent = opt("agent");
const name = opt("name");
if (!key || !agent || !name) {
  console.error("need AGENT_KEY env + --agent + --name");
  process.exit(1);
}
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== agent.toLowerCase()) {
  console.error(`AGENT_KEY resolves to ${account.address}, not ${agent} — refusing to sign a mismatched manifest`);
  process.exit(1);
}
const endpoints = opts("endpoint").map((e) => {
  const [n, url] = e.split("=", 2);
  if (!n || !url) throw new Error(`bad --endpoint ${e} (want name=url)`);
  return { name: n, url };
});
const signingKeys = opts("key").length ? opts("key") : [agent];

const manifest = newManifest({
  chainId: Number(opt("chain") ?? 4663),
  agent,
  agentId: opt("agent-id") !== undefined ? Number(opt("agent-id")) : undefined,
  name,
  endpoints,
  signingKeys,
});
const client = createWalletClient({ account, transport: http("https://rpc.mainnet.chain.robinhood.com") });
const signed = await signManifest(client, manifest);
const out = opt("out") ?? `manifests/${agent.toLowerCase()}.json`;
writeFileSync(out, JSON.stringify(signed, null, 2) + "\n");
console.log(`wrote ${out} (${manifestMessage(signed).length} canonical bytes, signed by ${account.address})`);
