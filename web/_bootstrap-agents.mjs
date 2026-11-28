// Bootstrap demo agents on mainnet — REAL bonds + REAL x402 payments + real gate tallies.
// Not committed: reads keys from the private repo .env; agent keys persist incrementally
// to ../_bootstrap-keys.json so a mid-run crash never strands funded wallets.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, custom, parseAbi, getAddress } from "viem";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN = { id: 4663, name: "Robinhood", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TALLY = "0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8";
const GATE = "https://www.tgentic.xyz";
const FACILITATOR = "https://facilitator.naven.network";
const BOND = 500_000n; // minBond
const KEYS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "_bootstrap-keys.json");

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function transferFrom(address,address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const tallyAbi = parseAbi(["function deposit(uint256)"]);

// native fetch is edge-blocked from this machine — every HTTP call rides curl
const post = (url, body) =>
  JSON.parse(execFileSync("curl", ["-s", "--max-time", "60", "-X", "POST", url,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v))], { encoding: "utf8" }));
const rpc = (method, params) => {
  const out = post(RPC, { jsonrpc: "2.0", id: 1, method, params });
  if (out.error) throw new Error(`RPC ${method}: ${JSON.stringify(out.error)}`);
  return out.result;
};
const provider = { request: async ({ method, params }) => rpc(method, params) };

const pub = createPublicClient({ chain: CHAIN, transport: custom(provider) });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const payer1 = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);
const facil = privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY);
const wc = (a) => createWalletClient({ account: a, chain: CHAIN, transport: custom(provider) });

const store = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : { payer2: null, agents: [] };
const persist = () => writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2));

const newAcct = () => {
  const pk = generatePrivateKey();
  return { pk, a: privateKeyToAccount(pk) };
};

async function waitTx(hash) {
  for (let i = 0; i < 40; i++) {
    try { const r = await pub.getTransactionReceipt({ hash }); if (r) return r; } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("receipt timeout " + hash);
}
const waitConf = async (hash, n = 3) => {
  const rec = await waitTx(hash);
  for (let i = 0; i < 20; i++) {
    if ((await pub.getBlockNumber()) - rec.blockNumber >= BigInt(n)) return rec;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return rec;
};

async function send(account, call) {
  const hash = await wc(account).writeContract(call);
  const r = await waitTx(hash);
  if (r.status !== "success") throw new Error("tx failed " + hash);
  return hash;
}
const eth = (account, to, value) => wc(account).sendTransaction({ to, value }).then(waitTx);

// The approved-facilitator path, proven by receipt #1 (tx 0x44d4be19…): payer approves
// our facilitator wallet once, it pulls transferFrom(payer -> agent). tx.from is then an
// approved facilitator — exactly what the gate's verifyPayment requires.
async function facilPay(payer, agent, amount) {
  const hash = await wc(facil).writeContract({ address: USDG, abi: erc20, functionName: "transferFrom", args: [payer.address, getAddress(agent), amount] });
  await waitTx(hash);
  return hash;
}

async function tally(payer, agent, txHash, rating) {
  const message = `TGENTIC feedback\nchain: 4663\nagent: ${getAddress(agent)}\ntx: ${txHash.toLowerCase()}\nrating: ${rating}`;
  const signature = await payer.signMessage({ message });
  for (let i = 0; i < 4; i++) {
    const res = post(`${GATE}/tally`, { agent: getAddress(agent), txHash, rating, signature });
    if (!res.error) return res.tallyTx;
    if (i === 3) throw new Error("tally failed: " + JSON.stringify(res));
    await new Promise((r) => setTimeout(r, 15_000)); // e.g. still under minConfirmations
  }
}

const usdgBalance = async (a) => pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [a] });

// ---- plan: 6 agents, alternating payers, varied amounts/ratings ----
const PLAN = [
  { amount: 120_000n, rating: 5 }, { amount: 60_000n, rating: 5 },
  { amount: 45_000n, rating: 4 }, { amount: 90_000n, rating: 5 },
  { amount: 30_000n, rating: 4 }, { amount: 75_000n, rating: 5 },
];

// preflight
const depBal = await usdgBalance(deployer.address);
console.log(`deployer ${deployer.address} USDG ${Number(depBal) / 1e6}`);
if (depBal < 3_700_000n) throw new Error("deployer needs >= 3.7 USDG");

// payer2: reuse a persisted key if a previous run already made one
let payer2;
if (store.payer2) payer2 = privateKeyToAccount(store.payer2.key);
else { const n = newAcct(); payer2 = n.a; store.payer2 = { address: n.a.address, key: n.pk }; persist(); }
console.log("payer2:", payer2.address);

// fund payers (facilitator pays THEIR gas at settle time)
if (await usdgBalance(payer1.address) < 250_000n) await send(deployer, { address: USDG, abi: erc20, functionName: "transfer", args: [payer1.address, 250_000n] });
if (await usdgBalance(payer2.address) < 300_000n) await send(deployer, { address: USDG, abi: erc20, functionName: "transfer", args: [payer2.address, 300_000n] });
if ((await pub.getBalance({ address: payer2.address })) < 10_000_000_000_000n) await eth(deployer, payer2.address, 30_000_000_000_000n);
// one-time approvals so the facilitator can pull each payment
await send(payer1, { address: USDG, abi: erc20, functionName: "approve", args: [facil.address, 250_000n] });
await send(payer2, { address: USDG, abi: erc20, functionName: "approve", args: [facil.address, 300_000n] });
console.log("payers funded + facilitator approved", facil.address);

for (let i = 0; i < PLAN.length; i++) {
  let rec = store.agents[i];
  let agent;
  if (rec) agent = privateKeyToAccount(rec.key);
  else {
    const { pk, a } = newAcct();
    agent = a;
    rec = store.agents[i] = { address: a.address, key: pk, bonded: false, tallied: false };
    persist();
  }
  console.log(`\n== agent ${i}: ${agent.address}`);
  if (!rec.bonded) {
    await send(deployer, { address: USDG, abi: erc20, functionName: "transfer", args: [agent.address, BOND + 5_000n] });
    await eth(deployer, agent.address, 20_000_000_000_000n); // gas dust
    await send(agent, { address: USDG, abi: erc20, functionName: "approve", args: [TALLY, BOND] });
    await send(agent, { address: TALLY, abi: tallyAbi, functionName: "deposit", args: [BOND] });
    rec.bonded = true;
    persist();
    console.log("bonded 0.5 USDG");
  }
  if (!rec.tallied) {
    const payer = i % 2 === 0 ? payer1 : payer2;
    const txHash = await facilPay(payer, agent.address, PLAN[i].amount);
    await waitConf(txHash, 3);
    console.log("paid", Number(PLAN[i].amount) / 1e6, "USDG →", txHash);
    const t = await tally(payer, agent.address, txHash, PLAN[i].rating);
    rec.tallied = true;
    rec.tallyTx = t;
    persist();
    console.log("tallied →", t);
  }
}

// second receipt for the existing agent from payer2 -> payers: 2
// (lowercase first: the common paste of this address has a broken checksum — same
// bug class we just fixed in /risk)
if (!store.existingDone) {
  const existing = getAddress("0x85db450017b448439dc63a7c566dd9b9e933d2be");
  const h = await facilPay(payer2, existing, 50_000n);
  await waitConf(h, 3);
  const t2 = await tally(payer2, existing, h, 5);
  store.existingDone = true;
  persist();
  console.log("\nexisting agent second receipt →", t2);
}

console.log("\nDONE — keys persisted to", KEYS_FILE);
