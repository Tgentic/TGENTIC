// Sign an agent manifest (Step 6). Keys come from the environment only —
// this script never writes them anywhere. Usage:
//   AGENT_KEY=0x… node tools/sign-manifest.mjs --agent 0x… --name "…" \
//     [--agent-id 26520] [--endpoint web=https://…] [--key 0x…] [--out manifests/0x….json]
//     [--version <n>] [--signer 0x<delegated-key>]
//
// Rotation: bump --version and sign with a key the previous manifest
// authorized. The self-sign check is skipped when --signer delegates to a
// different key — AGENT_KEY then belongs to that delegated key, not `agent`.
import { writeFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { newManifest, signManifest, manifestMessage } from "../gate/src/manifest.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const opts = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const key = process.env.AGENT_KEY;
const agent = opt("agent");
const name = opt("name");
if (!key || !agent || !name) {
  console.error("need AGENT_KEY env + --agent + --name");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const signer = opt("signer") ?? account.address;
const delegated = signer.toLowerCase() !== agent.toLowerCase();
// Self-signed manifests must be signed by the agent key itself. Delegated
// manifests (rotation: --signer names a new authorized key) are signed by
// whatever AGENT_KEY resolves to — the chain check in resolveManifests()
// decides whether that key was actually authorized.
if (!delegated && account.address.toLowerCase() !== agent.toLowerCase()) {
  console.error(`AGENT_KEY resolves to ${account.address}, not ${agent} — refusing to sign a mismatched manifest`);
  process.exit(1);
}
if (delegated && account.address.toLowerCase() !== signer.toLowerCase()) {
  console.error(`--signer ${signer} does not match AGENT_KEY address ${account.address}`);
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
  version: opt("version") !== undefined ? Number(opt("version")) : undefined,
});
const client = createWalletClient({ account, transport: http("https://rpc.mainnet.chain.robinhood.com") });
const signed = await signManifest(client, manifest);
const out = opt("out") ?? `manifests/${agent.toLowerCase()}.json`;
writeFileSync(out, JSON.stringify(signed, null, 2) + "\n");
console.log(`wrote ${out} (${manifestMessage(signed).length} canonical bytes, signed by ${account.address})`);
