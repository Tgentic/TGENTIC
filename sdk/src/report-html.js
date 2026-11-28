// Render the signed audit report (tgentic/audit-report/1) as a self-contained
// HTML document — the deliverable a buyer actually wants to open. Shared by
// the gate (format=html on the paid endpoint) and the dapp (download button);
// pure string templating, no dependencies.
//
// Everything the verifier needs travels inside the file: the signed JSON is
// embedded verbatim and the signature block explains the check — body minus
// `signature`, canonical JSON, recover → the auditor address.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (typeof a === "string" && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : esc(a));

const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><span>${v}</span></div>`;

export function renderReportHtml(report, { settleTx, explorer = "https://robinhoodchain.blockscout.com" } = {}) {
  const r = report ?? {};
  const fin = r.financials ?? {}, risk = r.risk ?? {}, subject = r.subject ?? {}, auditor = r.auditor ?? {}, man = subject.manifest ?? {};
  const flags = Array.isArray(risk.flags) ? risk.flags : [];
  const signedJson = JSON.stringify(report, null, 2);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TGENTIC audit — ${esc(subject.agent ?? "report")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap">
<style>
:root { --void:#05070d; --text:#e8ebf2; --mute:#9aa3b5; --blue:#1f5bff; --blue-text:#72a2ff; --edge:#5a6478; --hair:#2a3346; --ok:#4ade80; --warn:#fbbf24; }
* { box-sizing: border-box; }
body { margin:0; background:var(--void); color:var(--text); font:400 1rem/1.6 Newsreader,Georgia,serif; }
.mono, code, pre, .kv span:first-child, .tag { font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace; }
.wrap { max-width: 860px; margin: 0 auto; padding: 56px 28px 80px; }
.head { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--hair); padding-bottom:20px; }
.brand { font:500 .85rem "IBM Plex Mono",monospace; letter-spacing:.08em; color:var(--mute); }
.brand b { color:var(--text); }
.type { font:400 .75rem "IBM Plex Mono",monospace; color:var(--blue-text); border:1px solid var(--hair); padding:6px 10px; }
h1 { font-size:clamp(2rem,5vw,3.2rem); line-height:1.08; font-variation-settings:"opsz" 72; margin:44px 0 18px; font-weight:600; }
.verdict { font-size:1.15rem; color:var(--text); max-width:60ch; }
section { margin-top:44px; }
h2 { font:500 .8rem "IBM Plex Mono",monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); border-bottom:1px solid var(--hair); padding-bottom:10px; margin:0 0 18px; }
.kv { display:flex; justify-content:space-between; gap:18px; padding:9px 0; border-bottom:1px solid var(--hair); font-size:.95rem; }
.kv span:first-child { color:var(--mute); font-size:.8rem; padding-top:3px; }
.kv span:last-child { text-align:right; word-break:break-all; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px; background:var(--hair); border:1px solid var(--hair); }
.grid div { background:var(--void); padding:16px 14px; }
.grid b { display:block; font:600 1.5rem Newsreader,serif; }
.grid span { font:400 .72rem "IBM Plex Mono",monospace; color:var(--mute); text-transform:uppercase; letter-spacing:.1em; }
.tag { display:inline-block; font-size:.78rem; padding:5px 10px; border:1px solid var(--warn); color:var(--warn); margin:0 8px 8px 0; }
.tag.ok { border-color:var(--ok); color:var(--ok); }
.sig { font:400 .78rem/1.7 "IBM Plex Mono",monospace; word-break:break-all; background:rgba(31,91,255,.08); border:1px solid var(--hair); padding:16px; }
pre { font:400 .75rem/1.6 "IBM Plex Mono",monospace; color:var(--mute); background:rgba(255,255,255,.03); border:1px solid var(--hair); padding:16px; overflow-x:auto; white-space:pre-wrap; word-break:break-all; }
a { color:var(--blue-text); text-decoration:none; }
a:hover { text-decoration:underline; }
.foot { margin-top:56px; padding-top:18px; border-top:1px solid var(--hair); font:400 .78rem "IBM Plex Mono",monospace; color:var(--mute); display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <span class="brand"><b>TGENTIC</b> — signed audit report</span>
    <span class="type">${esc(r.type ?? "tgentic/audit-report/1")}</span>
  </div>

  <h1>${esc(man.name ?? "Unnamed agent")} <span style="color:var(--mute)">audit</span></h1>
  <p class="verdict">${esc(r.summary ?? "")}</p>

  <section>
    <h2>Financials — counted on-chain</h2>
    <div class="grid">
      <div><b>${esc(fin.score ?? "0")}</b><span>score</span></div>
      <div><b>${esc(fin.receipts ?? "0")}</b><span>receipts</span></div>
      <div><b>${esc(fin.payers ?? "0")}</b><span>unique payers</span></div>
      <div><b>${esc(fin.bond ?? "0")}</b><span>bond (atomic)</span></div>
    </div>
    ${row("raw reputation", esc(fin.reputation ?? "0"))}
    ${row("score counted", fin.counted ? "yes — bond meets the minimum" : "no — bond below the minimum")}
  </section>

  <section>
    <h2>Manipulation risk</h2>
    ${flags.length ? flags.map((f) => `<span class="tag">⚑ ${esc(f)}</span>`).join("") : `<span class="tag ok">no flags detected</span>`}
    ${row("top payer share", `${risk.topPayerShareBps ?? 0} bps`)}
    ${row("top repeated amount", esc(risk.topAmount ?? "0"))}
    ${row("receipt intervals analyzed", esc(risk.intervalCount ?? 0))}
  </section>

  <section>
    <h2>Subject identity</h2>
    ${row("agent", `<span class="mono">${esc(subject.agent ?? "")}</span>`)}
    ${man.name ? row("manifest name", esc(man.name)) : ""}
    ${man.version != null ? row("manifest version", esc(man.version) + (man.agentId != null ? ` · agentId #${esc(man.agentId)}` : "")) : ""}
    ${man.manifestHash ? row("manifestHash", `<span class="mono">${esc(man.manifestHash)}</span>`) : ""}
    ${man.verified ? row("manifest verified", "yes — signed, rotation chain intact") : row("manifest", "none on record")}
  </section>

  <section>
    <h2>Auditor attestation</h2>
    ${row("auditor", `${esc(auditor.name ?? "")} · <span class="mono">${esc(auditor.agent ?? "")}</span>${auditor.agentId != null ? ` · agentId #${esc(auditor.agentId)}` : ""}`)}
    ${row("issued", `<span class="mono">${esc(r.issuedAt ?? "")}</span>`)}
    ${settleTx ? row("payment", `<a class="mono" href="${esc(explorer)}/tx/${esc(settleTx)}">${short(settleTx)}</a>`) : ""}
    <div class="sig" style="margin-top:14px">signature<br>${esc(r.signature ?? "")}</div>
    <p style="font:400 .82rem 'IBM Plex Mono',monospace;color:var(--mute)">Verify offline: take the JSON below minus <code>signature</code>, canonicalize (sorted keys), EIP-191 recover — the signer must equal <span class="mono">${esc(auditor.agent ?? "")}</span>.</p>
  </section>

  <section>
    <h2>Signed document</h2>
    <pre>${esc(signedJson)}</pre>
  </section>

  <div class="foot">
    <span>audited by ${esc(auditor.name ?? "TGENTIC auditor")} · paid over x402 · settled on Robinhood Chain</span>
    <a href="https://www.tgentic.xyz">tgentic.xyz</a>
  </div>
</div>
</body>
</html>`;
}
