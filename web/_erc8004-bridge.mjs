// ERC-8004 mainnet bridge: register TGENTIC agents in the official
// IdentityRegistry and post Tallied receipts as giveFeedback entries
// carrying proofOfPayment — all against the canonical 0x8004… singletons.
// Idempotent: state persisted to _erc8004-bridge-state.json, safe to re-run.
// Local ops tool — reads keys from ../.env and ../_bootstrap-keys.json.
import { createPublicClient, createWalletClient, custom, defineChain, getAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(HERE, "..", ".env"));
const env = process.env;
const KEYS = JSON.parse(readFileSync(join(HERE, "../_bootstrap-keys.json"), "utf8"));
const STATE_PATH = join(HERE, "_erc8004-bridge-state.json");
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { agentIds: {}, uriDone: {}, feedbackDone: [] };
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const chain = defineChain({ id: 4663, name: "robinhood", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const provider = { request: async ({ method, params }) => {
  const out = execFileSync("curl", ["-s", "-X", "POST", "https://rpc.mainnet.chain.robinhood.com",
    "-H", "Content-Type: application/json", "-d",
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] })], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const j = JSON.parse(out); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
} };
const pub = createPublicClient({ chain, transport: custom(provider) });
const acct = (pk) => privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const wc = (pk) => createWalletClient({ account: acct(pk), chain, transport: custom(provider) });
const send = async (pk, req) => { const h = await wc(pk).writeContract(req); await pub.waitForTransactionReceipt({ hash: h }); return h; };
const norm = (a) => getAddress(a.toLowerCase());

const IDENTITY = norm("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
const REPUTATION = norm("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
const REGISTRY_CAIP = `eip155:4663:${IDENTITY}`;
const TALLY = norm("0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8");
const LOOKUP = (a) => `https://www.tgentic.xyz/app#/lookup/${a}`;

const ID_ABI = [
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "agentId", type: "uint256" }] },
  { name: "setAgentURI", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "newURI", type: "string" }], outputs: [] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
];
const REP_ABI = [
  { name: "giveFeedback", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "agentId", type: "uint256" }, { name: "value", type: "int128" }, { name: "valueDecimals", type: "uint8" },
    { name: "tag1", type: "string" }, { name: "tag2", type: "string" }, { name: "endpoint", type: "string" },
    { name: "feedbackURI", type: "string" }, { name: "feedbackHash", type: "bytes32" }], outputs: [] },
  { name: "getLastIndex", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }, { name: "clientAddress", type: "address" }], outputs: [{ type: "uint64" }] },
  { name: "getClients", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address[]" }] },
];
const REGISTERED = { name: "Registered", type: "event", inputs: [
  { name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string", indexed: false }, { name: "owner", type: "address", indexed: true }] };

// agent list: existing + 6 bootstrap agents — each self-registers (owner=itself)
const agents = [
  { addr: norm("0x85db450017b448439dc63a7c566dd9b9e933d2be"), key: env.AGENT_PRIVATE_KEY, name: "TGENTIC reference agent" },
  ...KEYS.agents.map((a, i) => ({ addr: norm(a.address), key: a.key, name: `TGENTIC bootstrap agent ${i}` })),
];
// verify each key resolves to its address; fall back to deployer (still honest — they're ours)
for (const a of agents) if (norm(acct(a.key).address) !== a.addr) { console.log(`${a.addr}: key mismatch — deployer will own it`); a.key = env.DEPLOYER_PRIVATE_KEY; }

const regFile = (a, id) => ({
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: a.name,
  description: `Agent on the TGENTIC receipt-verified reputation board (Robinhood Chain). Its score is backed by a locked USDG bond and settled payments — verify live at ${LOOKUP(a.addr)}`,
  services: [{ name: "web", endpoint: LOOKUP(a.addr) }],
  x402Support: true,
  active: true,
  registrations: [{ agentId: id, agentRegistry: REGISTRY_CAIP }],
  supportedTrust: ["reputation", "crypto-economic"],
});
const dataURI = (obj) => "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");

// the 8 Tallied receipts (from on-chain audit): agent → {payer, paymentTx, tallyTx, rating, block}
const receipts = [
  { agent: agents[0].addr, payer: norm("0x0416478379d1bce57d1ef75d1e6a81ff3018f5b1"), pk: env.PAYER_PRIVATE_KEY,
    payTx: "0x44d4be1951fe871593f4e4dd25d9b34c2f048150fa707bb721b84284f0736096", rating: 5, block: 118989002 },
  { agent: agents[1].addr, payer: norm("0x0416478379d1bce57d1ef75d1e6a81ff3018f5b1"), pk: env.PAYER_PRIVATE_KEY,
    payTx: "0xbf29aad4a0229e4ba52d9e719425610dc51519d4af96c9f6c8e298b2923003e6", rating: 5, block: 123193439 },
  { agent: agents[2].addr, payer: norm("0x6CB9F47d7A2CdDBbdbd31eFaEA28E552030cf16D"), pk: KEYS.payer2.key,
    payTx: "0x72e1c9b762fbc2090f014c622d2c3bbeb2b51c18da6e8d58b6a412876e65362c", rating: 5, block: 123194021 },
  { agent: agents[3].addr, payer: norm("0x0416478379d1bce57d1ef75d1e6a81ff3018f5b1"), pk: env.PAYER_PRIVATE_KEY,
    payTx: "0x1e6c822f177eaedc23d40bfb68f5c5f0206da24a06e13009fb7fafb7a559dbd5", rating: 4, block: 123194647 },
  { agent: agents[4].addr, payer: norm("0x6CB9F47d7A2CdDBbdbd31eFaEA28E552030cf16D"), pk: KEYS.payer2.key,
    payTx: "0x718046d0cd78b133c833003a596cec1a276caf3085551041dfaca43fca491808", rating: 5, block: 123195199 },
  { agent: agents[5].addr, payer: norm("0x0416478379d1bce57d1ef75d1e6a81ff3018f5b1"), pk: env.PAYER_PRIVATE_KEY,
    payTx: "0x4475376d1e128edaae0c8f83d558ad74c20de481e8bdee76659f4dd7022dda2b", rating: 4, block: 123195856 },
  { agent: agents[6].addr, payer: norm("0x6CB9F47d7A2CdDBbdbd31eFaEA28E552030cf16D"), pk: KEYS.payer2.key,
    payTx: "0x870143cd6402a14e1661e7521f1a17ea06a2cb6275948d16a58a7096209cf1a2", rating: 5, block: 123196407 },
  { agent: agents[0].addr, payer: norm("0x6CB9F47d7A2CdDBbdbd31eFaEA28E552030cf16D"), pk: KEYS.payer2.key,
    payTx: "0x465ac3aaa14bba1ade50fd53af1419cd52525841e0c79957c4642a18ebde2283", rating: 5, block: 123196594 },
];
// sanity: keys resolve to expected payers
for (const r of receipts) {
  const who = norm(acct(r.pk).address);
  if (who !== r.payer) throw new Error(`payer key mismatch: ${who} != ${r.payer}`);
}

// ---- phase 0: gas dust for agents that need it (setAgentURI ~1.2M gas) ----
for (const a of agents) {
  const bal = await pub.getBalance({ address: a.addr });
  if (bal < 40000000000000n) {
    const h = await wc(env.DEPLOYER_PRIVATE_KEY).sendTransaction({ to: a.addr, value: 60000000000000n - bal });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`topped up ${a.addr} (${h})`);
  }
}

// ---- phase 1+2: register agents, then set spec-complete URIs ----
for (const a of agents) {
  if (!(a.addr in state.agentIds)) {
    const h = await send(a.key, { address: IDENTITY, abi: ID_ABI, functionName: "register", args: [] });
    const rcp = await pub.getTransactionReceipt({ hash: h });
    const log = rcp.logs.find((l) => l.address.toLowerCase() === IDENTITY.toLowerCase() && l.topics[0] === "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a");
    state.agentIds[a.addr] = Number(BigInt(log.topics[1]));
    save(); console.log(`registered ${a.addr} → agentId ${state.agentIds[a.addr]} (${h})`);
  }
  const id = state.agentIds[a.addr];
  if (!state.uriDone[a.addr]) {
    const h = await send(a.key, { address: IDENTITY, abi: ID_ABI, functionName: "setAgentURI", args: [BigInt(id), dataURI(regFile(a, id))] });
    state.uriDone[a.addr] = 1; save(); console.log(`  uri set for agentId ${id} (${h})`);
  }
}

// ---- phase 3: giveFeedback per receipt (payer signs — spec requires clientAddress) ----
for (const r of receipts) {
  const id = state.agentIds[r.agent];
  const key = `${id}:${r.payer}:${r.payTx.slice(2, 10)}`;
  if (state.feedbackDone.includes(key)) { console.log(`skip feedback ${key} — done`); continue; }
  const blk = await pub.getBlock({ blockNumber: BigInt(r.block) });
  const file = {
    agentRegistry: REGISTRY_CAIP, agentId: id,
    clientAddress: `eip155:4663:${r.payer}`,
    createdAt: new Date(Number(blk.timestamp) * 1000).toISOString(),
    value: r.rating * 20, valueDecimals: 0,
    tag1: "starred", tag2: "x402-verified",
    endpoint: LOOKUP(r.agent),
    proofOfPayment: { fromAddress: r.payer, toAddress: r.agent, chainId: "4663", txHash: r.payTx },
    tgentic: { tallyContract: TALLY, tallyBlock: r.block, bonded: true, counted: true,
      verify: `https://www.tgentic.xyz/risk?agent=${r.agent}` },
  };
  const json = JSON.stringify(file);
  const h = await send(r.pk, { address: REPUTATION, abi: REP_ABI, functionName: "giveFeedback",
    args: [BigInt(id), BigInt(r.rating * 20), 0, "starred", "x402-verified", LOOKUP(r.agent),
           dataURI(file), keccak256(toBytes(json))] });
  state.feedbackDone.push(key); save();
  console.log(`feedback agentId ${id} ← ${r.payer.slice(0, 10)}… value ${r.rating * 20} (${h})`);
}
console.log("\ndone — agentIds:", state.agentIds);
