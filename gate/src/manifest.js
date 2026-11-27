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
  if (!Number.isSafeInteger(m.version) || m.version < 1) errors.push("version must be a positive safe integer");
  if (!Number.isSafeInteger(m.chainId) || m.chainId < 1) errors.push("chainId must be a positive safe integer");
  if (!/^0x[0-9a-fA-F]{40}$/.test(m.agent ?? "")) errors.push("agent must be an address");
  if (m.agentId !== undefined && (!Number.isSafeInteger(m.agentId) || m.agentId < 0))
    errors.push("agentId must be a non-negative safe integer when present");
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
 * Verify shape + signature.
 * Without a trusted predecessor manifest, only `m.agent` itself may anchor
 * the manifest — self-declared `signingKeys` inside an unverified document
 * cannot authorize themselves. To verify a rotated manifest signed by a
 * delegated key, pass `{ previous }` (the latest verified predecessor manifest
 * for the same agent & chain); `m.version` must equal `previous.version + 1`
 * and the signer must be `m.agent` or listed in `previous.signingKeys`.
 * For multi-hop rotations (v1 -> v2 -> v3), use `verifyManifestChain`.
 * Pure ecrecover — works offline, no client needed.
 * @param {object} m
 * @param {object} [opts]
 * @param {object} [opts.previous] predecessor manifest authorizing delegated keys
 * @returns {Promise<{ok:boolean, signer?:string, errors:string[]}>}
 */
export async function verifyManifest(m, opts) {
  const errors = validateManifest(m);
  if (errors.length) return { ok: false, errors };
  let signer;
  try {
    signer = (await recoverMessageAddress({ message: manifestMessage(m), signature: m.signature })).toLowerCase();
  } catch {
    return { ok: false, errors: ["signature does not recover"] };
  }
  const previous = opts && typeof opts === "object" ? opts.previous : undefined;
  const authorized = [m.agent.toLowerCase()];
  if (previous !== undefined) {
    const prevCheck = await verifyManifest(previous);
    if (!prevCheck.ok) return { ok: false, errors: ["previous manifest is invalid"] };
    if (previous.agent.toLowerCase() !== m.agent.toLowerCase() || previous.chainId !== m.chainId) {
      return { ok: false, errors: ["previous manifest does not match agent or chainId"] };
    }
    if (m.version !== previous.version + 1) {
      return { ok: false, errors: ["version must equal previous manifest version + 1"] };
    }
    for (const k of previous.signingKeys ?? []) authorized.push(k.toLowerCase());
  }
  return authorized.includes(signer)
    ? { ok: true, signer, errors: [] }
    : { ok: false, errors: ["signature not from agent or a previously authorized signingKey"] };
}

/**
 * Verify an ordered rotation chain `[v1, v2, ...]` from an agent-signed root.
 * Each link must match `agent` and `chainId`, increment `version` by exactly 1,
 * and be signed by `agent` or a key present in the immediately preceding link's
 * `signingKeys` (so keys revoked in an earlier version cannot sign later links).
 * @param {object[]} chain
 * @returns {Promise<{ok:boolean, signer?:string, errors:string[]}>}
 */
export async function verifyManifestChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return { ok: false, errors: ["chain must be a non-empty array"] };
  let res = await verifyManifest(chain[0]);
  if (!res.ok) return res;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const curr = chain[i];
    const errors = validateManifest(curr);
    if (errors.length) return { ok: false, errors };
    if (curr.agent.toLowerCase() !== prev.agent.toLowerCase() || curr.chainId !== prev.chainId) {
      return { ok: false, errors: ["manifest chain does not match agent or chainId"] };
    }
    if (curr.version !== prev.version + 1) {
      return { ok: false, errors: ["manifest chain versions must increment by 1"] };
    }
    let signer;
    try {
      signer = (await recoverMessageAddress({ message: manifestMessage(curr), signature: curr.signature })).toLowerCase();
    } catch {
      return { ok: false, errors: ["signature does not recover"] };
    }
    const authorized = [curr.agent.toLowerCase(), ...(prev.signingKeys ?? []).map((k) => k.toLowerCase())];
    if (!authorized.includes(signer)) {
      return { ok: false, errors: ["signature not from agent or a previously authorized signingKey"] };
    }
    res = { ok: true, signer, errors: [] };
  }
  return res;
}
