// The real data layer: reads the TGENTIC contract on chain. demo.js exposes the same `api` shape.
import { createPublicClient, createWalletClient, custom, defineChain, http, isAddress } from "viem";
import abi from "./abi.json";
import { HAS_PRIVY } from "./privy.js";
import { flagsFor } from "./flags.js";

const env = import.meta.env;
const ADDRESS = env.VITE_TGENTIC_ADDRESS || "";
const DEPLOY_BLOCK = BigInt(env.VITE_DEPLOY_BLOCK || 0);
// The Robinhood Chain RPC rejects getLogs spanning more than 10 million blocks, so the deploy block is required (tested: fromBlock 0 fails).
const deployed = isAddress(ADDRESS) && DEPLOY_BLOCK > 0n;

export const chain = defineChain({
  id: Number(env.VITE_CHAIN_ID || 4663),
  name: env.VITE_CHAIN_NAME || "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
const pub = createPublicClient({ chain, transport: http() });

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

const read = (functionName, args) => pub.readContract({ address: ADDRESS, abi, functionName, args });
// The RPC caps a single getLogs at ~10M blocks; blockRange makes viem page the scan automatically (self-halving on range errors).
const talliedEvent = abi.find((x) => x.type === "event" && x.name === "Tallied");
const tallied = (args) => pub.getLogs({ address: ADDRESS, events: [talliedEvent], args, fromBlock: DEPLOY_BLOCK, blockRange: 8_000_000n });

async function readToken() {
  const [token, minBond] = await Promise.all([read("token"), read("minBond")]);
  const t = (functionName, args) => pub.readContract({ address: token, abi: erc20Abi, functionName, args });
  const [decimals, symbol] = await Promise.all([t("decimals"), t("symbol")]);
  return { token, minBond, decimals, symbol };
}

async function readAgent(a) {
  const [score, reputation, paid, receipts, payers, bond, unlockAt] = await Promise.all(
    ["score", "reputation", "paid", "receipts", "payers", "bond", "unlockAt"].map((f) => read(f, [a])),
  );
  return { score, reputation, paid, receipts, payers, bond, unlockAt };
}

let walletClient = null;
/** Privy mode: an EIP-1193 provider from the Privy embedded wallet. */
function connectPrivy(provider, address) {
  walletClient = createWalletClient({ chain, transport: custom(provider) });
  return address;
}

export const api = {
  live: true,
  deployed,
  chainName: chain.name,
  explorer: env.VITE_EXPLORER || "https://robinhoodchain.blockscout.com",
  readToken,
  readAgent,
  receipts: async (agent) => (await tallied({ agent })).slice(-50).reverse(),
  recent: async (n = 8) => (await tallied()).slice(-n).reverse(),
  async board() {
    const logs = await tallied();
    const agents = [...new Set(logs.map((l) => l.args.agent))].slice(0, 100);
    const tk = await readToken();
    const rows = await Promise.all(agents.map(async (a) => ({
      a,
      ...(await readAgent(a)),
      flags: flagsFor(a, logs.filter((l) => l.args.agent === a)).flags,
    })));
    return { tk, rows };
  },
  hasWallet: () => typeof window !== "undefined" && (!!window.ethereum || HAS_PRIVY),
  connectPrivy,
  disconnect() { walletClient = null; },
  async connect() {
    walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
    const [a] = await walletClient.requestAddresses();
    try { await walletClient.switchChain({ id: chain.id }); } catch { await walletClient.addChain({ chain }); }
    return a;
  },
  async bondState(account) {
    const [tk, d] = await Promise.all([readToken(), readAgent(account)]);
    const t = (functionName, args) => pub.readContract({ address: tk.token, abi: erc20Abi, functionName, args });
    const [bal, allow] = await Promise.all([t("balanceOf", [account]), t("allowance", [account, ADDRESS])]);
    return { tk, d, bal, allow };
  },
  /** kind: approve | deposit | startUnlock | withdraw */
  async send(account, kind, value, token) {
    const call = kind === "approve"
      ? { address: token, abi: erc20Abi, functionName: "approve", args: [ADDRESS, value] }
      : { address: ADDRESS, abi, functionName: kind, args: kind === "startUnlock" ? [] : [value] };
    const hash = await walletClient.writeContract({ account, ...call });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  },
  /** Buy the signed audit report over x402: read the 402 offer, sign an EIP-3009
   *  authorization for exactly what it asks, retry with the payment attached. */
  async buyAudit(account, agent) {
    if (!walletClient) throw new Error("Connect a wallet first.");
    const url = `/audit/report?agent=${agent}&buyer=${account}`; // the offer prices the buyer's own reputation
    const offer = await (await fetch(url, { headers: { accept: "application/json" } })).json();
    const req = offer?.accepts?.[0];
    if (offer?.x402Version !== 2 || req?.scheme !== "exact")
      throw new Error(offer?.error === "Payment required" ? "The endpoint did not return a payment offer." : `Endpoint error: ${offer?.error ?? "unknown"}`);
    const now = Math.floor(Date.now() / 1000);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = `0x${[...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const message = {
      from: account, to: req.payTo, value: BigInt(req.amount),
      validAfter: BigInt(now - 60), validBefore: BigInt(now + Math.min(req.maxTimeoutSeconds ?? 300, 300)), nonce,
    };
    const signature = await walletClient.signTypedData({
      account,
      domain: { name: req.extra?.name ?? "Global Dollar", version: req.extra?.version ?? "1", chainId: chain.id, verifyingContract: req.asset },
      types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "TransferWithAuthorization",
      message,
    });
    const paymentPayload = {
      x402Version: 2,
      accepted: req,
      payload: {
        signature,
        authorization: {
          from: account, to: req.payTo, value: req.amount,
          validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString(), nonce,
        },
      },
    };
    const res = await fetch(url, { headers: { accept: "application/json", "payment-signature": btoa(JSON.stringify(paymentPayload)) } });
    const body = await res.json().catch(() => ({}));
    const payRes = res.headers.get("payment-response");
    const settle = payRes ? JSON.parse(atob(payRes)) : null;
    if (res.status === 402) throw new Error(`Payment rejected: ${body?.error ?? "unknown"}`);
    if (!res.ok) throw new Error(`Endpoint error ${res.status}: ${body?.error ?? res.statusText}`);
    return { report: body, settle };
  },
};
