// Create a real agent identity — the self-serve path (Step 6 onboarding).
// Two modes:
//   node tools/create-agent.mjs --generate --name "my agent" [--endpoint web=https://…]
//     → generates a fresh key, prints it ONCE, signs the manifest with it
//   AGENT_KEY=0x… node tools/create-agent.mjs --name "my agent" …
//     → you already hold the agent key; the manifest is signed by it
//
// The manifest lands in manifests/ (and is served by the gate once the
// operator syncs gate/manifests). Registering the agentId on the ERC-8004
// IdentityRegistry is the owner's next step — it costs gas and should be
// done by the wallet that will actually operate the agent.
import { writeFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { newManifest, signManifest } from "../gate/src/manifest.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const opts = (name) =>
  args.map((a, i) => (a === `--${name}` ? args[i + 1] : null)).filter(Boolean);

const name = opt("name");
if (!name) {
  console.error("need --name (plus --generate or AGENT_KEY env)");
  process.exit(1);
}

let account;
let generatedKey;
if (has("generate")) {
  generatedKey = generatePrivateKey();
  account = privateKeyToAccount(generatedKey);
} else {
  const key = process.env.AGENT_KEY;
  if (!key) {
    console.error("need --generate or AGENT_KEY env");
    process.exit(1);
  }
  account = privateKeyToAccount(key);
}
const agent = account.address;

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
console.log(`wrote ${out}`);
if (generatedKey) {
  console.log(`agent address: ${agent}`);
  console.log(`private key (shown once, never stored): ${generatedKey}`);
  console.log("next: fund this address if it will register on the ERC-8004 IdentityRegistry, or keep it key-only — the manifest verifies without any on-chain footprint.");
}
