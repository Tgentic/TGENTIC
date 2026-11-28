// Production entry: the auditor is its own agent — it receives USDG for
// audits AND signs each report with the same key, so payTo and the
// attesting identity are enforced to be one address.
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildReport } from "./report.js";
import { createApp } from "./app.js";

try { process.loadEnvFile(".env"); } catch {} // optional .env here; missing values get a clear error below

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`Missing ${k} in .env (see .env.example).`); process.exit(1); } return env[k]; };

const account = privateKeyToAccount(need("AGENT_KEY"));
const payTo = need("PAY_TO");
if (!isAddress(payTo)) { console.error(`PAY_TO is not an address: ${payTo}`); process.exit(1); }
if (account.address.toLowerCase() !== payTo.toLowerCase()) {
  console.error(`PAY_TO (${payTo}) must equal the AGENT_KEY address (${account.address}) — the auditor receives payments and signs reports with one identity.`);
  process.exit(1);
}

const rpcUrl = env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const tgentic = env.TGENTIC_ADDRESS;
if (!tgentic || !isAddress(tgentic)) { console.error("Missing/invalid TGENTIC_ADDRESS (the Receipts contract)."); process.exit(1); }
const gateUrl = need("GATE_URL");
const amount = env.PRICE_ATOMIC ?? "10000";
if (!/^[1-9][0-9]*$/.test(amount)) { console.error("PRICE_ATOMIC must be whole USDG atomic units (6 decimals)."); process.exit(1); }

const transport = http(rpcUrl);
const publicClient = createPublicClient({ transport });
const signer = createWalletClient({ account, transport });
const auditor = { name: env.AUDITOR_NAME ?? "TGENTIC auditor", address: account.address, ...(env.AGENT_ID !== undefined ? { agentId: Number(env.AGENT_ID) } : {}) };

const port = Number(env.PORT ?? 4022);
createApp({
  payTo, facilitatorUrl: need("FACILITATOR_URL"), amount, gateUrl,
  buildReport: (agent) => buildReport({ publicClient, signer, tgentic, gateUrl, agent, auditor }),
}).listen(port, () => {
  console.log(`TGENTIC auditor on :${port} — GET /report?agent=0x… costs ${Number(amount) / 1e6} USDG, paid to ${payTo}.`);
});
