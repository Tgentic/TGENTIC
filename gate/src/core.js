// Gate core: verify a USDG payment on chain, verify the payer's signature, then record it on the contract.
import {
  createPublicClient, createWalletClient, custom, defineChain, getAddress, http,
  isAddress, isHash, isHex, parseAbi, parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { manifestHash, verifyManifest } from "./manifest.js";

export const tgenticAbi = parseAbi([
  "function tally(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating)",
  "function used(bytes32) view returns (bool)",
]);

// The v2 line: writes go through the policy (m-of-n verifier signatures), not a single EOA.
export const policyAbi = parseAbi([
  "function tallyDigest(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating) view returns (bytes32)",
  "function submitTally(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating, bytes[] sigs)",
  "function isVerifier(address) view returns (bool)",
  "function receipts() view returns (address)",
]);
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export class GateError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

/** Chain clients. `provider` (EIP-1193) for tests; `rpcUrl` for production. The gate key is never logged. */
export function makeClients({ chainId, rpcUrl, provider, privateKey, account }) {
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl ?? "http://localhost"] } } });
  const transport = provider ? custom(provider) : http(rpcUrl);
  const signer = privateKey ? privateKeyToAccount(privateKey) : account;
  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: signer ? createWalletClient({ chain, transport, account: signer }) : null,
  };
}

/** The message signed by the payer. Includes the chain ID so it cannot be replayed on another chain. */
export const feedbackMessage = ({ chainId, agent, txHash, rating, manifestHash }) =>
  `TGENTIC feedback\nchain: ${chainId}\nagent: ${getAddress(agent)}\ntx: ${txHash.toLowerCase()}\nrating: ${rating}` +
  (manifestHash ? `\nmanifest: ${manifestHash.toLowerCase()}` : "");

/** Check one tx hash. Returns { payer, amount } or throws a GateError. */
export async function verifyPayment(client, { txHash, agent, usdg, facilitators, minConfirmations }) {
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: txHash }); }
  catch { throw new GateError("TX_NOT_FOUND", "Transaction not found or not mined yet.", 404); }
  if (receipt.status !== "success") throw new GateError("TX_FAILED", "The transaction reverted.", 422);

  const confirmations = (await client.getBlockNumber({ cacheTime: 0 })) - receipt.blockNumber + 1n; // viem caches the block number for 4s by default
  if (confirmations < BigInt(minConfirmations)) throw new GateError("NOT_CONFIRMED", `Wait for ${minConfirmations} confirmations, this one has ${confirmations}.`, 409);

  const tx = await client.getTransaction({ hash: txHash });
  if (!facilitators.has(tx.from.toLowerCase())) throw new GateError("NOT_FACILITATOR", "The payment was not settled by an approved facilitator.", 422);

  const matches = parseEventLogs({ abi: transferAbi, logs: receipt.logs, eventName: "Transfer" })
    .filter((l) => l.address.toLowerCase() === usdg.toLowerCase() && l.args.to.toLowerCase() === agent.toLowerCase());
  if (matches.length === 0) throw new GateError("NO_MATCHING_TRANSFER", "This transaction has no USDG transfer to that agent.", 422);
  if (matches.length > 1) throw new GateError("AMBIGUOUS_TRANSFER", "This transaction has more than one USDG transfer to that agent.", 422);

  const { from: payer, value: amount } = matches[0].args;
  if (amount === 0n) throw new GateError("ZERO_AMOUNT", "The transfer amount is zero.", 422);
  // shortcut: only catches a payer identical to the agent; self-dealing through other wallets needs pattern detection (manual slash).
  if (payer.toLowerCase() === agent.toLowerCase()) throw new GateError("SELF_PAYMENT", "An agent cannot pay itself.", 422);
  return { payer, amount };
}

/**
 * POST /tally. ctx: { publicClient, walletClient, chainId, tgentic, usdg, facilitators:Set<lowercase>, minConfirmations, inflight:Set }
 * body: { agent, txHash, rating (1-5), signature }
 */
export async function handleTally(ctx, body) {
  const { agent, txHash, rating, signature, manifest } = body ?? {};
  if (!isAddress(agent) || !isHash(txHash) || !Number.isInteger(rating) || rating < 1 || rating > 5 || !isHex(signature)) {
    throw new GateError("BAD_INPUT", "Send agent (address), txHash (32-byte hex), rating (whole number 1 to 5) and signature (hex).", 400);
  }
  const key = txHash.toLowerCase();
  if (ctx.inflight.has(key)) throw new GateError("IN_PROGRESS", "This transaction is already being processed.", 409);
  ctx.inflight.add(key);
  try {
    const used = await ctx.publicClient.readContract({ address: ctx.tgentic, abi: tgenticAbi, functionName: "used", args: [txHash] });
    if (used) throw new GateError("ALREADY_TALLIED", "This transaction has already been counted.", 409);

    // Identity-verified payment (Step 6): when the client sends the agent's
    // manifest, the payer's signature must bind that manifest's hash — the
    // rating is then committed to an identity, not just an address. When the
    // store knows a newer version, binding to a superseded one is rejected.
    let boundHash = null;
    if (manifest !== undefined) {
      const v = await verifyManifest(manifest);
      if (!v.ok) throw new GateError("MANIFEST_INVALID", `The manifest does not verify: ${v.errors[0] ?? "invalid"}.`, 400);
      if (manifest.agent.toLowerCase() !== agent.toLowerCase())
        throw new GateError("MANIFEST_MISMATCH", "The manifest's agent is not the agent being tallied.", 400);
      const current = ctx.manifests?.byAgent?.get(agent.toLowerCase());
      boundHash = manifestHash(manifest);
      if (current && manifestHash(current) !== boundHash)
        throw new GateError("MANIFEST_STALE", "The manifest was superseded — bind the current version instead.", 409);
    }

    const { payer, amount } = await verifyPayment(ctx.publicClient, { txHash, agent, usdg: ctx.usdg, facilitators: ctx.facilitators, minConfirmations: ctx.minConfirmations });

    const signed = await ctx.publicClient.verifyMessage({ address: payer, message: feedbackMessage({ chainId: ctx.chainId, agent, txHash, rating, manifestHash: boundHash }), signature });
    if (!signed) throw new GateError("BAD_SIGNATURE", "The signature does not belong to the payer of this transaction.", 401);

    // v1: the gate EOA writes the tally directly. v2 (ctx.policy set): the state
    // layer only accepts the policy — the gate collects m-of-n verifier signatures
    // over the chain-computed digest and submits; the gate key carries no authority
    // of its own here, it just pays gas as the relayer.
    let hash;
    if (ctx.policy) {
      const digest = await ctx.publicClient.readContract({ address: ctx.policy, abi: policyAbi, functionName: "tallyDigest", args: [getAddress(agent), payer, txHash, amount, rating] });
      // Policy._check requires the signatures sorted ascending by recovered signer.
      const pairs = await Promise.all(ctx.signers.map(async (acc) => ({ sig: await acc.signMessage({ message: { raw: digest } }), addr: acc.address })));
      pairs.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
      hash = await ctx.walletClient.writeContract({
        address: ctx.policy, abi: policyAbi, functionName: "submitTally",
        args: [getAddress(agent), payer, txHash, amount, rating, pairs.map((p) => p.sig)],
      });
    } else {
      hash = await ctx.walletClient.writeContract({ address: ctx.tgentic, abi: tgenticAbi, functionName: "tally", args: [getAddress(agent), payer, txHash, amount, rating] });
    }
    const done = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (done.status !== "success") throw new GateError("TALLY_FAILED", "The tally transaction reverted.", 502);
    return { tallyTx: hash, agent: getAddress(agent), payer, amount: amount.toString(), rating, ...(boundHash ? { manifestHash: boundHash } : {}) };
  } finally {
    ctx.inflight.delete(key);
  }
}
