// Agent identity lookup — same-origin reads of the gate's manifest store
// (Step 6). The gate serves this site, so /manifest/<addr> and /manifests
// are same-origin GETs. Missing store or 404 → null, never a crash.

import { keccak256, toBytes } from "viem";

// Canonical form mirror of gate/src/manifest.js (which imports node:fs and
// can't be bundled). The hash is derived client-side — the gate serves the
// raw signed artifact, so anyone can recompute it; same "verify don't trust"
// rule as the gate itself.
const sortValue = (v) => {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])]));
  return v;
};
const manifestHash = (m) => {
  if (!m || typeof m !== "object") return null;
  const { signature: _sig, ...rest } = m;
  return keccak256(toBytes(JSON.stringify(sortValue(rest))));
};

export async function fetchManifest(addr) {
  try {
    const r = await fetch(`/manifest/${addr}`);
    if (!r.ok) return null;
    const m = await r.json();
    return { ...m, manifestHash: manifestHash(m) };
  } catch {
    return null;
  }
}

/** Map<agentLower, manifest> for the whole store — one call for the directory. */
export async function fetchManifestMap() {
  try {
    const r = await fetch("/manifests");
    if (!r.ok) return new Map();
    const { manifests } = await r.json();
    return new Map((manifests ?? []).filter((m) => typeof m?.agent === "string" && m.agent.startsWith("0x")).map((m) => [m.agent.toLowerCase(), m]));
  } catch {
    return new Map();
  }
}
