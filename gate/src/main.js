// Production entry point: read configuration from .env, start the server.
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeClients, policyAbi } from "./core.js";
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

// v2 mode: writes go through the policy (m-of-n verifier signatures). The gate
// itself is only the relayer — its key pays gas, the verifier signatures carry
// the authority. Transition phase: the verifier keys live in this process, the
// same hands as before, but every write now proves the m-of-n path on chain.
const policy = env.POLICY_ADDRESS ? getAddress(env.POLICY_ADDRESS) : null;
const signers = (env.VERIFIER_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean).map((k) => privateKeyToAccount(k));
if (policy) {
  const required = Number(await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "threshold" }));
  const uniqueSigners = new Set(signers.map((s) => s.address.toLowerCase()));
  if (uniqueSigners.size !== signers.length) { console.error("VERIFIER_KEYS contains duplicate verifier keys."); process.exit(1); }
  if (uniqueSigners.size < required) { console.error(`POLICY_ADDRESS requires ${required} distinct verifier key(s), but VERIFIER_KEYS holds ${uniqueSigners.size}.`); process.exit(1); }
  // Reads and writes must target the same state layer: the policy writes to its
  // wired Receipts, and TGENTIC_ADDRESS is what the used-check reads.
  const wired = await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "receipts" });
  if (wired.toLowerCase() !== tgentic.toLowerCase()) { console.error(`TGENTIC_ADDRESS (${tgentic}) is not the policy's Receipts (${wired}) — reads and writes would diverge.`); process.exit(1); }
  for (const s of signers) {
    const ok = await publicClient.readContract({ address: policy, abi: policyAbi, functionName: "isVerifier", args: [s.address] });
    if (!ok) { console.error(`VERIFIER_KEYS contains a non-verifier of the policy: ${s.address}`); process.exit(1); }
  }
  console.log(`v2 policy mode: ${signers.length}/${required} verifier key(s), submitter ${walletClient.account.address}`);
}
// Without a policy the gate writes tallies with its own key — the single-EOA
// authority the v2 line exists to remove. That mode must be opted into
// explicitly; a missing POLICY_ADDRESS must never silently re-enable it.
if (!policy && env.ALLOW_V1_MODE !== "1") {
  console.error("POLICY_ADDRESS is not set — refusing to boot. In v1 mode this key writes tallies directly, bypassing the verifier quorum. Set POLICY_ADDRESS + VERIFIER_KEYS, or set ALLOW_V1_MODE=1 to run legacy v1 mode intentionally (archive/testing only).");
  process.exit(1);
}
if (!policy) console.warn("ALLOW_V1_MODE=1 — legacy v1 mode: the gate key writes tallies directly, no policy quorum.");

const ctx = {
  publicClient, walletClient, chainId,
  tgentic: getAddress(tgentic), usdg: getAddress(usdg),
  policy, signers,
  facilitators: new Set(facilitators.map((a) => a.toLowerCase())),
  minConfirmations: Number(env.MIN_CONFIRMATIONS ?? 3),
  detectFromBlock: BigInt(env.DETECT_FROM_BLOCK ?? 122_282_476), // v2 Receipts deploy block
  inflight: new Set(),
};

const port = Number(env.PORT ?? 8788); // 8787 left reserved
createServer(ctx, { allowedOrigin: env.ALLOWED_ORIGIN ?? "*", webDist: env.WEB_DIST || "" }).listen(port, () => {
  console.log(`TGENTIC gate on :${port}, chain ${chainId}, gate ${walletClient.account.address}, ${facilitators.length} facilitator(s).`);
});
