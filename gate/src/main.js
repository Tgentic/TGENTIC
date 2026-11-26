// Production entry point: read configuration from .env, start the server.
import { getAddress, isAddress } from "viem";
import { makeClients } from "./core.js";
import { createServer } from "./server.js";

try { process.loadEnvFile(".env"); } catch {} // optional .env in the gate dir; missing values get a clear error below

// Last-resort safety net (F3 lesson): every request handler is async, so any
// rejection we failed to anticipate would otherwise be an unhandled rejection,
// which exits Node by default — a remote crash. Keep serving and log loudly
// instead; a broken request must never take the whole gate down. This does not
// replace handling errors at the source — a message here is a bug to fix.
const survived = (kind) => (err) => console.error(`[BUG:${kind}] the process survived — fix this path:`, err?.shortMessage ?? err?.message ?? err);
process.on("unhandledRejection", survived("unhandledRejection"));
process.on("uncaughtException", survived("uncaughtException"));

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`Missing ${k} in .env (see .env.example).`); process.exit(1); } return env[k]; };

const chainId = Number(env.CHAIN_ID ?? 4663);
const rpcUrl = env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const tgentic = need("TGENTIC_ADDRESS");
const usdg = env.USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const facilitators = need("FACILITATORS").split(",").map((s) => s.trim()).filter(Boolean);
for (const a of [tgentic, usdg, ...facilitators]) if (!isAddress(a)) { console.error(`Not an address: ${a}`); process.exit(1); }

const { publicClient, walletClient } = makeClients({ chainId, rpcUrl, privateKey: need("GATE_PRIVATE_KEY") });

const remote = await publicClient.getChainId();
if (remote !== chainId) { console.error(`RPC is on chain ${remote}, expected ${chainId}.`); process.exit(1); }

const ctx = {
  publicClient, walletClient, chainId,
  tgentic: getAddress(tgentic), usdg: getAddress(usdg),
  facilitators: new Set(facilitators.map((a) => a.toLowerCase())),
  minConfirmations: Number(env.MIN_CONFIRMATIONS ?? 3),
  inflight: new Set(),
};

const port = Number(env.PORT ?? 8788); // 8787 left reserved
createServer(ctx, { allowedOrigin: env.ALLOWED_ORIGIN ?? "*", webDist: env.WEB_DIST || "" }).listen(port, () => {
  console.log(`TGENTIC gate on :${port}, chain ${chainId}, gate ${walletClient.account.address}, ${facilitators.length} facilitator(s).`);
});
