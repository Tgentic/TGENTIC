import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { GateError, handleTally } from "./core.js";
import { assessAgent, computeFlags, DEFAULT_FROM_BLOCK, LOG_BLOCK_RANGE } from "./heuristics.js";
import { handleMcp } from "./mcp.js";
import { manifestHash } from "./manifest.js";
import { handleAudit } from "./audit.js";

const MAX_BODY = 4096;

const talliedEvents = [
  { type: "event", name: "Tallied", inputs: [
    { type: "address", name: "agent", indexed: true },
    { type: "address", name: "payer", indexed: true },
    { type: "bytes32", name: "txHash", indexed: true },
    { type: "uint256", name: "amount" },
    { type: "uint8", name: "rating" },
  ] },
];
const receiptsAbi = [
  { type: "function", name: "score", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reputation", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "receipts", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "payers", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bond", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];

/** One marketplace row: contract reads + manipulation flags + manifest identity.
 *  Shared by GET /agents (the index) and GET /agents/<addr> (the lookup). */
async function agentRow(ctx, agent, mine) {
  const read = (fn) => ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: fn, args: [agent] });
  const [score, reputation, receipts, payers, bond] = await Promise.all(["score", "reputation", "receipts", "payers", "bond"].map(read));
  const risk = computeFlags(mine, agent);
  const manifest = ctx.manifests?.byAgent?.get(agent.toLowerCase());
  return {
    agent: getAddress(agent),
    score: score.toString(), reputation: reputation.toString(),
    receipts: receipts.toString(), payers: payers.toString(), bond: bond.toString(),
    counted: score > 0n, flagged: risk.flagged, flags: risk.flags,
    ...(manifest ? { name: manifest.name, manifestVerified: true } : {}),
  };
}

/** Live Tallied tailer — one chain poller per process, many SSE subscribers.
 *  Subscribers get the recent buffer as replay, then live events as they land. */
function makeTailer(ctx) {
  const recent = [];
  const subs = new Set();
  let cursor = null, timer = null, warming = null;
  const toEvent = (l) => ({
    type: "tally",
    agent: getAddress(l.args.agent), payer: getAddress(l.args.payer),
    amount: l.args.amount.toString(), rating: Number(l.args.rating),
    txHash: l.args.txHash, blockNumber: l.blockNumber.toString(), tallyTx: l.transactionHash,
  });
  const scan = (fromBlock, toBlock) =>
    ctx.publicClient.getLogs({ address: ctx.tgentic, events: talliedEvents, fromBlock, toBlock, blockRange: LOG_BLOCK_RANGE });
  const emit = (l) => {
    const ev = toEvent(l);
    recent.push(ev);
    if (recent.length > 20) recent.shift();
    for (const s of subs) s(ev);
  };
  async function warm() {
    const latest = await ctx.publicClient.getBlockNumber();
    const logs = await scan(ctx.detectFromBlock ?? DEFAULT_FROM_BLOCK, latest);
    for (const l of logs.slice(-20)) { recent.push(toEvent(l)); if (recent.length > 20) recent.shift(); }
    cursor = latest;
  }
  async function tick() {
    try {
      const latest = await ctx.publicClient.getBlockNumber();
      if (cursor === null || latest <= cursor) return;
      for (const l of await scan(cursor + 1n, latest)) emit(l);
      cursor = latest;
    } catch (e) {
      console.error("events tailer:", e?.shortMessage ?? e?.message ?? e);
    }
  }
  return {
    full: () => subs.size >= 64,
    async subscribe(fn) {
      subs.add(fn);
      if (cursor === null && !warming) warming = warm().catch((e) => { console.error("events warm:", e?.shortMessage ?? e?.message ?? e); cursor ??= 0n; });
      await warming;
      if (!timer) timer = setInterval(tick, ctx.eventPollMs ?? 4000);
      return recent.slice();
    },
    unsubscribe(fn) {
      subs.delete(fn);
      if (!subs.size && timer) { clearInterval(timer); timer = null; }
    },
  };
}

const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "frame-ancestors 'none'",
};

/** Static file server for web/dist (the dapp) — /health and POST /tally stay APIs.
 *  Clean URLs: /app serves app.html; /app.html is 301-redirected to /app. */
function serveStatic(root, url, res) {
  let clean;
  try { clean = path.normalize(decodeURIComponent(url.split("?")[0])).replace(/^([.][.][/\\])+/, ""); }
  catch { return res.writeHead(400, { ...SECURITY_HEADERS, "content-length": 0 }).end(); } // malformed percent-encoding must not kill the process
  // control bytes would throw inside header values (redirect) or fs calls — reject up front
  if (/[\x00-\x1f\x7f]/.test(clean)) return res.writeHead(400, { ...SECURITY_HEADERS, "content-length": 0 }).end();
  const rootDir = path.resolve(root);
  const file = path.resolve(path.join(root, clean === "/" || clean === "" ? "index.html" : clean));
  if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return res.writeHead(403, SECURITY_HEADERS).end();
  // encodeURI: non-latin1 chars in the path are invalid in a Location header and would throw
  if (/\.html$/i.test(clean) && clean !== "/index.html") return res.writeHead(301, { location: encodeURI(clean).replace(/\.html$/i, ""), ...SECURITY_HEADERS }).end();
  let serve = file;
  if (!path.extname(serve) && fs.existsSync(`${serve}.html`)) serve += ".html";
  try { if (fs.statSync(serve).isDirectory()) serve = path.join(rootDir, "index.html"); }
  catch { serve = path.join(rootDir, "index.html"); } // ENOENT, EPERM, or a stat race — fall back, never crash
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" }[path.extname(serve)] || "application/octet-stream";
  // HTML must revalidate every load (deploys swap bundle hashes); hashed
  // assets under /assets/ are immutable forever.
  const cache = type === "text/html" ? "no-cache"
    : clean.includes("/assets/") ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff", ...SECURITY_HEADERS });
  const stream = fs.createReadStream(serve);
  stream.on("error", () => res.end()); // fd exhaustion or a delete race must not crash the process
  stream.pipe(res);
}

/** Thin HTTP layer over handleTally: GET /health, GET /risk, POST /tally, + static dapp.
 *  ratePerMinute: application-layer request budget per IP (the chain sequences FCFS — no fee market to lean on). */
export function createServer(ctx, { allowedOrigin = "*", webDist = "", ratePerMinute = 30, mcpRatePerMinute = 120 } = {}) {
  const buckets = new Map(); // ip -> { count, windowStart } — fixed windows, swept on write
  let tailer = null; // lazily built on the first /events subscriber
  // MCP sessions are multi-call by design (initialize → tools/list → several
  // tools/call), and one indexer may probe the endpoint on behalf of many
  // agents — so /mcp gets its own budget, keyed per ip+path.
  const allow = (key, limit) => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now - b.windowStart >= 60_000) {
      buckets.set(key, { count: 1, windowStart: now });
      if (buckets.size > 10_000) { // keep the map bounded under address-spoof floods
        for (const [k, v] of buckets) if (now - v.windowStart >= 60_000) buckets.delete(k);
      }
      return true;
    }
    return ++b.count <= limit;
  };
  // The socket peer is the edge proxy in production (Railway), so the real client
  // IP comes from X-Forwarded-For. The service is only reachable through that proxy,
  // which overwrites the header — direct header spoofing is not possible publicly.
  const clientIp = (req) => {
    const xff = req.headers["x-forwarded-for"];
    return (typeof xff === "string" && xff.split(",")[0].trim()) || req.socket.remoteAddress;
  };

  return http.createServer(async (req, res) => {
    // Route on the pathname only — a query string must not change matching.
    const pathname = req.url.split("?")[0];
    // The MCP endpoint serves public read-only data to any client (indexers,
    // agent browsers) — it gets an open origin regardless of ALLOWED_ORIGIN.
    const origin = pathname === "/mcp" ? "*" : allowedOrigin;

    const send = (status, obj, extraHeaders) => {
      res.writeHead(status, {
        ...SECURITY_HEADERS,
        "content-type": "application/json",
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-protocol-version, payment-signature, x-payment",
        "access-control-expose-headers": "payment-required, payment-response",
        ...extraHeaders,
      });
      res.end(obj === undefined ? "" : JSON.stringify(obj));
    };

    if (req.method === "OPTIONS") return send(204);
    if (req.method === "GET" && pathname === "/health")
      return send(200, { ok: true, chainId: ctx.chainId, manifests: ctx.manifests?.byAgent?.size ?? 0 });
    // Step 6: manifest index — every trusted tip in the store, so clients
    // (the dapp's directory) can resolve identities in one call.
    if (req.method === "GET" && pathname === "/manifests") {
      const list = [...(ctx.manifests?.byAgent?.values() ?? [])]
        .map((m) => ({ agent: m.agent, agentId: m.agentId ?? null, name: m.name, version: m.version, demo: m.demo === true, manifestHash: manifestHash(m) }))
        .sort((a, b) => (a.agentId ?? 1e9) - (b.agentId ?? 1e9) || a.name.localeCompare(b.name));
      return send(200, { manifests: list });
    }
    // Step 6: serve the current verified manifest for an agent — plain HTTP
    // identity lookup, same store the MCP get_agent_identity tool reads.
    if (req.method === "GET" && pathname.startsWith("/manifest/")) {
      const addr = pathname.slice("/manifest/".length).replace(/\.json$/i, "").toLowerCase();
      // Return the raw signed artifact — annotating it (e.g. a manifestHash
      // field) would change the canonical bytes and break verifyManifest for
      // anyone round-tripping it into /tally. Clients derive the hash from
      // the canonical form themselves.
      const m = /^0x[0-9a-f]{40}$/.test(addr) ? ctx.manifests?.byAgent?.get(addr) : null;
      return m ? send(200, m) : send(404, { error: "NO_MANIFEST", message: "No verified manifest for this agent." });
    }

    // Step 7: marketplace index — rank/filter every agent with receipts.
    // One Tallied scan shared across all rows; flags come from the same
    // computeFlags the dapp and SDK use, no extra RPC per agent.
    // Query: ?minScore= ?minReceipts= ?flagged=true|false ?sort=score|receipts|payers ?limit=n
    // Costly paths get an application-layer request budget — the chain sequences
    // first-come-first-served, so there is no fee market to lean on. Placed before
    // the handlers it covers: anything that returns earlier is intentionally free.
    if ((req.method === "POST" && pathname === "/tally") || (req.method === "GET" && (pathname === "/risk" || pathname === "/agents" || pathname.startsWith("/agents/") || pathname === "/audit/report"))) {
      if (!allow(clientIp(req), ratePerMinute)) return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
    }

    if (req.method === "GET" && pathname === "/agents") {
      try {
        const q = new URL(req.url, "https://x").searchParams;
        const logs = await ctx.publicClient.getLogs({ address: ctx.tgentic, events: talliedEvents, fromBlock: ctx.detectFromBlock ?? DEFAULT_FROM_BLOCK, blockRange: LOG_BLOCK_RANGE });
        const byAgent = new Map();
        for (const l of logs) {
          const a = l.args.agent.toLowerCase();
          if (!byAgent.has(a)) byAgent.set(a, []);
          byAgent.get(a).push({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash });
        }
        const rows = await Promise.all([...byAgent.entries()].slice(0, 100).map(([agent, mine]) => agentRow(ctx, agent, mine)));
        const num = (k) => q.get(k);
        if ((num("minScore") && !/^\d+$/.test(num("minScore"))) || (num("minReceipts") && !/^\d+$/.test(num("minReceipts"))))
          return send(400, { error: "BAD_INPUT", message: "minScore and minReceipts must be non-negative integers." });
        const minScore = num("minScore") ? BigInt(num("minScore")) : 0n;
        const minReceipts = num("minReceipts") ? BigInt(num("minReceipts")) : 0n;
        // only an explicit true/false applies the flag filter — typos get all rows, not a surprising subset
        const flagged = { true: true, false: false }[q.get("flagged")] ?? null;
        const sort = { receipts: "receipts", payers: "payers" }[q.get("sort")] ?? "score";
        const limit = Math.min(Math.max(parseInt(q.get("limit") ?? "50", 10) || 50, 1), 100);
        const agents = rows
          .filter((r) => BigInt(r.score) >= minScore && BigInt(r.receipts) >= minReceipts && (flagged === null || r.flagged === flagged))
          .sort((a, b) => (BigInt(b[sort]) > BigInt(a[sort]) ? 1 : -1))
          .slice(0, limit);
        return send(200, { agents, total: rows.length, source: ctx.tgentic });
      } catch (e) {
        console.error("agents failed:", e?.shortMessage ?? e?.message ?? e);
        return send(500, { error: "INTERNAL", message: "The agents read failed." });
      }
    }

    // The single-agent lookup — the 90% public API call: one curl, one row.
    // Same shape as a GET /agents entry; an unlisted agent reads as zeros.
    if (req.method === "GET" && pathname.startsWith("/agents/")) {
      const raw = decodeURIComponent(pathname.slice("/agents/".length)).trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return send(400, { error: "BAD_AGENT", message: "Send a 20-byte hex address: /agents/0x…" });
      const agent = getAddress(raw.toLowerCase());
      try {
        const logs = await ctx.publicClient.getLogs({ address: ctx.tgentic, events: talliedEvents, args: { agent }, fromBlock: ctx.detectFromBlock ?? DEFAULT_FROM_BLOCK, blockRange: LOG_BLOCK_RANGE });
        const mine = logs.map((l) => ({ blockNumber: l.blockNumber, payer: l.args.payer, amount: l.args.amount, txHash: l.args.txHash }));
        return send(200, await agentRow(ctx, agent, mine));
      } catch (e) {
        console.error("agent lookup failed:", e?.shortMessage ?? e?.message ?? e);
        return send(500, { error: "INTERNAL", message: "The agent lookup failed." });
      }
    }

    // Step 7: live reputation stream — Tallied events as they land on chain,
    // replaying the recent few on connect. One shared poller per process.
    if (req.method === "GET" && pathname === "/events") {
      if (!req.headers.accept?.includes("text/event-stream"))
        return send(200, { name: "tgentic-events", hint: "GET with Accept: text/event-stream — live Tallied events, recent few replayed on connect." });
      tailer ??= makeTailer(ctx);
      if (tailer.full()) return send(503, { error: "BUSY", message: "Too many open streams — retry shortly." });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      res.write(": tgentic-events\n\n");
      const write = (ev) => { try { res.write(`event: tally\ndata: ${JSON.stringify(ev)}\n\n`); } catch { /* socket already gone */ } };
      const replay = await tailer.subscribe(write);
      for (const ev of replay) write(ev);
      const ka = setInterval(() => { try { res.write(": ka\n\n"); } catch { /* gone */ } }, 15_000);
      const done = () => { clearInterval(ka); tailer.unsubscribe(write); };
      req.on("close", done);
      res.on("close", done);
      return;
    }

    // Streamable HTTP transport's optional SSE channel for server-initiated
    // messages. We never push, and we close promptly — health probes fetch GET
    // like a normal request and treat a stream that never ends as a hang,
    // while real MCP clients simply reconnect per the SSE spec.
    if (req.method === "GET" && pathname === "/mcp") {
      // Browsers never send Accept: text/event-stream — serve the docs page
      // from web/dist instead of a stream that renders as a near-blank screen.
      if (!req.headers.accept?.includes("text/event-stream")) {
        if (webDist) return serveStatic(webDist, "/mcp", res);
        return send(200, { name: "tgentic-mcp", hint: "POST JSON-RPC 2.0 to this URL" });
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      res.write(": tgentic-mcp\n\n");
      const close = setTimeout(() => res.end(), 1500);
      req.on("close", () => clearTimeout(close));
      return;
    }

    // MCP sessions are multi-call by design (initialize → tools/list → several
    // tools/call), so /mcp POSTs get their own budget, keyed per ip+path.
    if (req.method === "POST" && pathname === "/mcp") {
      if (!allow(`${clientIp(req)}:mcp`, mcpRatePerMinute)) return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
    }

    if (req.method === "GET" && pathname === "/risk") {
      const agent = new URL(req.url, "https://x").searchParams.get("agent") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) return send(400, { error: "BAD_AGENT", message: "Send ?agent=0x… (an address)." });
      try {
        // Normalize casing the way explorers do — viem rejects a mixed-case address
        // whose EIP-55 checksum doesn't match, which made those queries a 500.
        return send(200, await assessAgent(ctx.publicClient, { address: ctx.tgentic, agent: getAddress(agent.toLowerCase()), fromBlock: ctx.detectFromBlock }));
      } catch (e) {
        console.error("risk failed:", e?.shortMessage ?? e?.message ?? e);
        return send(500, { error: "INTERNAL", message: "The risk read failed." });
      }
    }

    // Paid audit endpoint — x402 exact settlement in USDG, report signed by the
    // auditor key. Only mounted when AUDITOR_KEY is configured; without it the
    // route is absent (no half-working paid surface).
    if (req.method === "GET" && pathname === "/audit/report") {
      // Browsers get the endpoint's docs page — the JSON error meant for
      // clients reads as a broken page to humans. A payment header overrides:
      // whoever carries one is a client, not a reader.
      const browser = req.headers.accept?.includes("text/html") && !req.headers["payment-signature"] && !req.headers["x-payment"];
      if (browser && webDist) return serveStatic(webDist, "/audit", res);
      if (!ctx.audit) return send(404, { error: "NOT_FOUND" });
      try {
        const out = await handleAudit(ctx, req);
        return send(out.status, out.body, out.headers);
      } catch (e) {
        console.error("audit failed:", e?.shortMessage ?? e?.message ?? e);
        return send(500, { error: "INTERNAL", message: "The audit request failed." });
      }
    }

    if (req.method !== "POST" || (pathname !== "/tally" && pathname !== "/mcp")) {
      if (webDist && req.method === "GET") return serveStatic(webDist, req.url, res);
      return send(404, { error: "NOT_FOUND" });
    }

    let raw = "";
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(413, { error: "BODY_TOO_LARGE" });
      }
    } catch {
      return; // client aborted mid-body — the socket is already gone, nothing to answer
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: "BAD_JSON", message: "Body must be JSON." }); }

    if (pathname === "/mcp") {
      const out = await handleMcp(ctx, body);
      return send(out.status, out.body);
    }

    try {
      return send(200, await handleTally(ctx, body));
    } catch (e) {
      if (e instanceof GateError) return send(e.status, { error: e.code, message: e.message });
      console.error("tally failed:", e?.shortMessage ?? e?.message ?? e);
      return send(500, { error: "INTERNAL", message: "The gate could not finish this request." });
    }
  });
}
