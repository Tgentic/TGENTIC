// HTTP client for the TGENTIC gate — the public API the chain reads feed.
// Complements createClient (direct contract reads) with the served surface:
// the marketplace index, manipulation flags, identity manifests, the paid
// audit endpoint (full x402 buy flow), and the live Tallied event stream.
import { getAddress } from "viem";

const DEFAULT_GATE = "https://www.tgentic.xyz";
const b64 = (s) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64"));
const unb64 = (s) => (typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("utf8"));

const GRANT_TYPE = "tgentic/view-grant/1";
const sortValue = (v) => {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])]));
  return v;
};
/** The exact string a viewing-grant signature commits to — canonical JSON sans signature. */
const grantMessage = (g) => { const { signature: _s, ...rest } = g; return JSON.stringify(sortValue(rest)); };

/**
 * Mint a viewing grant: payer delegates read access to their receipt history
 * to a viewer, until expiresAt (unix seconds). A signature only — it can never
 * move funds or sign tallies. Signer: anything with signMessage ({ message }).
 */
export async function signViewGrant(signer, { payer, viewer, expiresAt }) {
  const grant = { type: GRANT_TYPE, payer: getAddress(payer.toLowerCase()), viewer: getAddress(viewer.toLowerCase()), scope: "receipts", expiresAt };
  const signature = await signer.signMessage({ message: grantMessage(grant) });
  return { ...grant, signature };
}
/** A grant travels as base64 JSON in the ?grant= param. */
export const encodeViewGrant = (g) => b64(JSON.stringify(g));

const authTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
};

export function createGateClient({ gateUrl = DEFAULT_GATE, fetchImpl = fetch } = {}) {
  const base = gateUrl.replace(/\/+$/, "");
  const addr = (a) => {
    // accept any casing — normalize down then checksum, like the gate does
    if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`Not an address: ${a}`);
    return getAddress(a.toLowerCase());
  };
  const call = async (path, init) => {
    const res = await fetchImpl(base + path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body?.message ?? body?.error ?? `gate ${res.status}`), { status: res.status, body });
    return body;
  };

  const api = {
    /** Marketplace index — every agent row, filterable.
     *  q: { minScore, minReceipts, flagged: true|false, sort: "score"|"receipts"|"payers", limit } */
    agents: (q = {}) => call(`/agents?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== ""))}`),

    /** One agent: score, flags, identity — the 90% lookup in one call. */
    agent: (a) => call(`/agents/${addr(a)}`),

    /** Manipulation heuristics — the same detector the dapp renders. */
    risk: (a) => call(`/risk?agent=${addr(a)}`),

    /** The payer side of the ledger — what this address bought and how it
     *  rated. Pass a signed viewing grant (see signViewGrant) to mark the read
     *  as delegated to a specific viewer. */
    payer: (a, { viewer, grant } = {}) => {
      const qs = new URLSearchParams();
      if (viewer) qs.set("viewer", addr(viewer));
      if (grant) qs.set("grant", typeof grant === "string" ? grant : encodeViewGrant(grant));
      const q = qs.toString();
      return call(`/payers/${addr(a)}${q ? `?${q}` : ""}`);
    },

    /** What this buyer would pay for an audit — the public reputation discount. */
    quote: (buyer) => call(`/audit/quote?buyer=${addr(buyer)}`),

    /** The agent's verified identity manifest (Step 6 artifact). */
    manifest: (a) => call(`/manifest/${addr(a)}`),

    /** Every trusted manifest tip. */
    manifests: () => call("/manifests"),

    health: () => call("/health"),

    /** The x402 offer for a paid audit — spec-shaped requirements, no charge
     *  yet. Pass buyer to get their reputation-discounted price in the offer. */
    async auditOffer(a, { buyer } = {}) {
      const res = await fetchImpl(`${base}/audit/report?agent=${addr(a)}${buyer ? `&buyer=${addr(buyer)}` : ""}`, { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (res.status !== 402 || body?.x402Version !== 2)
        throw Object.assign(new Error(body?.message ?? body?.error ?? `gate ${res.status}`), { status: res.status, body });
      return body.accepts[0];
    },

    /**
     * Buy the signed audit over x402: read the offer, sign the EIP-3009
     * TransferWithAuthorization it asks for, retry with the payment attached.
     * walletClient: a viem WalletClient bound to the paying account (or pass
     * account explicitly). Returns { report, settle } — settle.transaction is
     * the on-chain payment; report.signature verifies offline against the auditor.
     */
    async buyAudit(a, walletClient, account = walletClient.account?.address, { format } = {}) {
      if (!account) throw new Error("Pass an account, or a walletClient bound to one.");
      const req = await api.auditOffer(a, { buyer: account }); // the offer prices the buyer's own reputation
      const chainId = Number(req.network.split(":")[1]);
      const now = Math.floor(Date.now() / 1000);
      const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      const message = {
        from: getAddress(account), to: getAddress(req.payTo), value: BigInt(req.amount),
        validAfter: BigInt(now - 60), validBefore: BigInt(now + Math.min(req.maxTimeoutSeconds ?? 300, 300)), nonce,
      };
      const typedData = {
        domain: { name: req.extra?.name ?? "Global Dollar", version: req.extra?.version ?? "1", chainId, verifyingContract: getAddress(req.asset) },
        types: authTypes, primaryType: "TransferWithAuthorization", message,
      };
      // LocalAccount signs in-process; JSON-RPC accounts need the wallet RPC.
      const signature = walletClient.account?.signTypedData
        ? await walletClient.account.signTypedData(typedData)
        : await walletClient.signTypedData({ account: message.from, ...typedData });
      const paymentPayload = {
        x402Version: 2, accepted: req,
        payload: { signature, authorization: {
          from: message.from, to: message.to, value: message.value.toString(),
          validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString(), nonce,
        } },
      };
      const res = await fetchImpl(`${base}/audit/report?agent=${addr(a)}${format === "html" ? "&format=html" : ""}`, {
        headers: { accept: format === "html" ? "text/html" : "application/json", "payment-signature": b64(JSON.stringify(paymentPayload)) },
      });
      const body = res.headers.get("content-type")?.includes("text/html") ? await res.text() : await res.json().catch(() => null);
      const payRes = res.headers.get("payment-response");
      const settle = payRes ? JSON.parse(unb64(payRes)) : null;
      if (!res.ok) throw Object.assign(new Error(`audit purchase failed (${res.status}): ${typeof body === "string" ? res.statusText : (body?.error ?? body?.reason ?? res.statusText)}`), { status: res.status, body });
      return { report: body, settle }; // report is the JSON doc, or the HTML certificate when format=html
    },

    /**
     * Subscribe to the live Tallied stream — replay of the recent few, then
     * events as they land. Returns { close }; onTally receives
     * { type:"tally", agent, payer, amount, rating, txHash, blockNumber, tallyTx }.
     */
    async events(onTally, { signal } = {}) {
      const res = await fetchImpl(`${base}/events`, { headers: { accept: "text/event-stream" }, signal });
      if (!res.ok || !res.body) throw Object.assign(new Error(`gate events ${res.status}`), { status: res.status });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (data) { try { onTally(JSON.parse(data)); } catch { /* listener errors must not kill the pump */ } }
          }
        }
      })().catch(() => {});
      return { close: () => reader.cancel().catch(() => {}) };
    },
  };
  return api;
}
