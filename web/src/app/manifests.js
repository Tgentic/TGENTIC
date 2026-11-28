// Agent identity lookup — same-origin reads of the gate's manifest store
// (Step 6). The gate serves this site, so /manifest/<addr> and /manifests
// are same-origin GETs. Missing store or 404 → null, never a crash.

export async function fetchManifest(addr) {
  try {
    const r = await fetch(`/manifest/${addr}`);
    return r.ok ? await r.json() : null;
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
