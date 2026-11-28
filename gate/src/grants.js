// Step 7: viewing keys — payer-signed delegation of read access.
//
// Honest scope: receipt data is public on-chain, so a grant is not access
// control — it is a consent artifact. A payer signs "address V may view my
// receipt history until T"; a marketplace presents that grant when it queries
// the payer's ledger, and the gate marks the response with the verified grant
// so the delegation itself is checkable. The grant is a signature only — it
// can never move funds or sign tallies; that is the "never spending power" part.
import { getAddress, isHex, recoverMessageAddress } from "viem";

export const GRANT_TYPE = "tgentic/view-grant/1";
export const GRANT_SCOPE = "receipts";

const sortValue = (v) => {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])]));
  return v;
};

/** The exact string the grant signature commits to — canonical JSON sans signature. */
export const grantMessage = (g) => {
  const { signature: _sig, ...rest } = g ?? {};
  return JSON.stringify(sortValue(rest));
};

export const newGrant = ({ payer, viewer, expiresAt, scope = GRANT_SCOPE }) => ({
  type: GRANT_TYPE, payer, viewer, scope, expiresAt,
});

/** Sign a viewing grant with the payer's account — any signer that has
 *  signMessage works (viem LocalAccount, a walletClient, Privy, …). */
export async function signViewGrant(signer, { payer, viewer, expiresAt }) {
  const grant = newGrant({ payer: getAddress(payer.toLowerCase()), viewer: getAddress(viewer.toLowerCase()), expiresAt });
  const signature = await signer.signMessage({ message: grantMessage(grant) });
  return { ...grant, signature };
}

/**
 * Verify a grant presented for (payer, viewer): shape, scope, expiry, and —
 * the part that makes it a delegation — the signature must recover the payer.
 * @returns {Promise<{valid:boolean, reason?:string, grant?:object}>}
 */
export async function verifyViewGrant(grant, { payer, viewer } = {}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!grant || typeof grant !== "object") return invalid("malformed_grant");
  if (grant.type !== GRANT_TYPE) return invalid("wrong_type");
  if (grant.scope !== GRANT_SCOPE) return invalid("wrong_scope");
  if (!/^0x[0-9a-fA-F]{40}$/.test(grant.payer ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(grant.viewer ?? ""))
    return invalid("malformed_grant");
  if (!isHex(grant.signature)) return invalid("malformed_signature");
  if (payer && grant.payer.toLowerCase() !== payer.toLowerCase()) return invalid("payer_mismatch");
  if (viewer && grant.viewer.toLowerCase() !== viewer.toLowerCase()) return invalid("viewer_mismatch");
  if (!Number.isFinite(grant.expiresAt)) return invalid("malformed_expiry");
  if (Math.floor(Date.now() / 1000) >= grant.expiresAt) return invalid("grant_expired");
  try {
    const signer = await recoverMessageAddress({ message: grantMessage(grant), signature: grant.signature });
    if (signer.toLowerCase() !== grant.payer.toLowerCase()) return invalid("bad_signature");
  } catch { return invalid("bad_signature"); }
  return { valid: true, grant };
}

/** Encode a grant for transport in a query/header — base64 JSON, like the x402 headers. */
export const encodeGrant = (g) => Buffer.from(JSON.stringify(g), "utf8").toString("base64");
export const decodeGrant = (s) => { try { return JSON.parse(Buffer.from(String(s), "base64").toString("utf8")); } catch { return null; } };
