// Step 6: signed agent manifests — binds a name, endpoints and authorized
// signing keys to the agent address, so "which agent earned this score" has
// a verifiable answer. Versioned so key rotation (a later item) can ship a
// new manifest signed by the old key instead of breaking the tally history.
//
// The manifest is a plain JSON document; the signature is an EIP-191
// personal_sign over its canonical form (every field except `signature`,
// keys sorted). Anyone can verify it offline — no gate trust required.

import { recoverMessageAddress } from "viem";

export const MANIFEST_TYPE = "tgentic/agent-manifest/1";

const sortValue = (v) => {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])]));
  return v;
};

/** The exact string the signature commits to: canonical JSON sans signature. */
export const manifestMessage = (m) => {
  const { signature: _sig, ...rest } = m ?? {};
  return JSON.stringify(sortValue(rest));
};

/** Validate the manifest's shape (signature validity is checked separately). */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== "object") return ["manifest is not an object"];
  if (m.type !== MANIFEST_TYPE) errors.push(`type must be ${MANIFEST_TYPE}`);
  if (!Number.isInteger(m.version) || m.version < 1) errors.push("version must be a positive integer");
  if (!Number.isInteger(m.chainId) || m.chainId < 1) errors.push("chainId must be a positive integer");
  if (!/^0x[0-9a-fA-F]{40}$/.test(m.agent ?? "")) errors.push("agent must be an address");
  if (m.agentId !== undefined && (!Number.isInteger(m.agentId) || m.agentId < 0))
    errors.push("agentId must be a non-negative integer when present");
  if (typeof m.name !== "string" || m.name.length < 1 || m.name.length > 200)
    errors.push("name must be a 1-200 char string");
  if (!Array.isArray(m.endpoints))
    errors.push("endpoints must be an array");
  else
    for (const [i, e] of m.endpoints.entries()) {
      if (!e || typeof e.name !== "string" || typeof e.url !== "string")
        errors.push(`endpoints[${i}] needs name and url strings`);
      else if (!/^https?:\/\//.test(e.url)) errors.push(`endpoints[${i}].url must be http(s)`);
    }
  if (!Array.isArray(m.signingKeys) || m.signingKeys.length < 1)
    errors.push("signingKeys must list at least one address");
  else
    for (const k of m.signingKeys)
      if (!/^0x[0-9a-fA-F]{40}$/.test(k ?? "")) errors.push(`invalid signingKey ${k}`);
  if (!m.issuedAt || Number.isNaN(Date.parse(m.issuedAt))) errors.push("issuedAt must be a date string");
  if (!/^0x[0-9a-fA-F]{130}$/.test(m.signature ?? "")) errors.push("signature must be 65-byte hex");
  return errors;
}

/** Build an unsigned manifest. Caller adds the signature via signManifest. */
export const newManifest = ({ chainId, agent, agentId, name, endpoints = [], signingKeys, issuedAt }) => ({
  type: MANIFEST_TYPE,
  version: 1,
  chainId,
  agent,
  ...(agentId !== undefined ? { agentId } : {}),
  name,
  endpoints,
  signingKeys: signingKeys ?? [agent],
  issuedAt: issuedAt ?? new Date().toISOString(),
});

/** Sign a manifest — mutates nothing, returns a new object with signature. */
export async function signManifest(walletClient, manifest) {
  const unsigned = { ...manifest };
  delete unsigned.signature;
  const signature = await walletClient.signMessage({ message: manifestMessage(unsigned) });
  return { ...unsigned, signature };
}

/**
 * Verify shape + signature. The recovered signer must be the agent address
 * itself or one of the declared signingKeys — the agent field always anchors
 * the tally identity; delegated keys may act for it (that is what makes key
 * rotation possible later). Pure ecrecover — works offline, no client needed.
 * @returns {Promise<{ok:boolean, signer?:string, errors:string[]}>}
 */
export async function verifyManifest(m) {
  const errors = validateManifest(m);
  if (errors.length) return { ok: false, errors };
  let signer;
  try {
    signer = (await recoverMessageAddress({ message: manifestMessage(m), signature: m.signature })).toLowerCase();
  } catch {
    return { ok: false, errors: ["signature does not recover"] };
  }
  const candidates = [m.agent, ...(m.signingKeys ?? [])].map((a) => a.toLowerCase());
  return candidates.includes(signer)
    ? { ok: true, signer, errors: [] }
    : { ok: false, errors: ["signature not from agent or a declared signingKey"] };
}
