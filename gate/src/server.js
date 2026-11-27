import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { GateError, handleTally } from "./core.js";
import { assessAgent } from "./heuristics.js";
import { handleMcp, MAX_BATCH } from "./mcp.js";

const MAX_BODY = 4096;
const MAX_BUCKETS = 10_000;

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
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".png": "image/png" }[path.extname(serve)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff", ...SECURITY_HEADERS });
  const stream = fs.createReadStream(serve);
  stream.on("error", () => res.end()); // fd exhaustion or a delete race must not crash the process
  stream.pipe(res);
}

/** Thin HTTP layer over handleTally: GET /health, GET /risk, POST /tally, + static dapp.
 *  ratePerMinute: application-layer request budget per IP (the chain sequences FCFS — no fee market to lean on). */
export function createServer(ctx, { allowedOrigin = "*", webDist = "", ratePerMinute = 30, mcpRatePerMinute = 120, maxSseConnections = 64, maxSsePerIp = 2, sseDurationMs = 1500 } = {}) {
  const buckets = new Map(); // key -> { count, windowStart } — fixed windows, bounded on write
  let activeSse = 0;
  const sseByIp = new Map();
  // MCP sessions are multi-call by design (initialize → tools/list → several
  // tools/call), and one indexer may probe the endpoint on behalf of many
  // agents — so /mcp gets its own budget, keyed per ip+path.
  const allow = (key, limit, cost = 1) => {
    if (cost <= 0) return true;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now - b.windowStart >= 60_000) {
      if (cost > limit) return false;
      buckets.delete(key); // refresh insertion order so eviction targets oldest windows
      buckets.set(key, { count: cost, windowStart: now });
      if (buckets.size > MAX_BUCKETS) {
        for (const [k, v] of buckets) if (now - v.windowStart >= 60_000) buckets.delete(k);
        // Hard cap even under a same-minute distinct-IP flood so memory stays bounded.
        while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
      }
      return true;
    }
    if (b.count + cost > limit) return false;
    b.count += cost;
    return true;
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

    const send = (status, obj) => {
      res.writeHead(status, {
        ...SECURITY_HEADERS,
        "content-type": "application/json",
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-protocol-version",
      });
      res.end(obj === undefined ? "" : JSON.stringify(obj));
    };

    if (req.method === "OPTIONS") return send(204);
    if (req.method === "GET" && pathname === "/health") return send(200, { ok: true, chainId: ctx.chainId });

    // Costly paths get an application-layer request budget — the chain sequences
    // first-come-first-served, so there is no fee market to lean on.
    if ((req.method === "POST" || req.method === "GET") && pathname === "/mcp") {
      if (!allow(`${clientIp(req)}:mcp`, mcpRatePerMinute)) return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
    }
    if ((req.method === "POST" && pathname === "/tally") || (req.method === "GET" && pathname === "/risk")) {
      if (!allow(clientIp(req), ratePerMinute)) return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
    }

    // Streamable HTTP transport's optional SSE channel for server-initiated
    // messages. We never push, and we close promptly — health probes fetch GET
    // like a normal request and treat a stream that never ends as a hang,
    // while real MCP clients simply reconnect per the SSE spec.
    if (req.method === "GET" && pathname === "/mcp") {
      const ip = clientIp(req);
      const ipCount = sseByIp.get(ip) ?? 0;
      if (activeSse >= maxSseConnections || ipCount >= maxSsePerIp) {
        return send(503, { error: "TOO_MANY_STREAMS", message: "Too many open SSE streams." });
      }
      activeSse++;
      sseByIp.set(ip, ipCount + 1);
      let closed = false;
      let close = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (close) clearTimeout(close);
        activeSse = Math.max(0, activeSse - 1);
        const cur = (sseByIp.get(ip) ?? 1) - 1;
        if (cur <= 0) sseByIp.delete(ip);
        else sseByIp.set(ip, cur);
      };
      req.on("close", cleanup);
      res.on("close", cleanup);
      res.on("error", cleanup);
      try {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "access-control-allow-origin": "*",
        });
        res.write(": tgentic-mcp\n\n");
      } catch {
        cleanup();
        return;
      }
      close = setTimeout(() => {
        cleanup();
        if (!res.writableEnded && !res.destroyed) res.end();
      }, sseDurationMs);
      return;
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
      if (Array.isArray(body) && body.length > MAX_BATCH) {
        return send(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `batch exceeds limit of ${MAX_BATCH}` } });
      }
      if (Array.isArray(body) && body.length > 1 && !allow(`${clientIp(req)}:mcp`, mcpRatePerMinute, body.length - 1)) {
        return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
      }
      try {
        const out = await handleMcp(ctx, body);
        return send(out.status, out.body);
      } catch (e) {
        console.error("mcp failed:", e?.shortMessage ?? e?.message ?? e);
        return send(500, { error: "INTERNAL", message: "The MCP request failed." });
      }
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
