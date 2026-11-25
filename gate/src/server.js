import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { GateError, handleTally } from "./core.js";
import { assessAgent } from "./heuristics.js";

const MAX_BODY = 4096;

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
export function createServer(ctx, { allowedOrigin = "*", webDist = "", ratePerMinute = 30 } = {}) {
  const buckets = new Map(); // ip -> { count, windowStart } — fixed windows, swept on write
  const allow = (ip) => {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || now - b.windowStart >= 60_000) {
      buckets.set(ip, { count: 1, windowStart: now });
      if (buckets.size > 10_000) { // keep the map bounded under address-spoof floods
        for (const [k, v] of buckets) if (now - v.windowStart >= 60_000) buckets.delete(k);
      }
      return true;
    }
    return ++b.count <= ratePerMinute;
  };
  return http.createServer(async (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, {
        ...SECURITY_HEADERS,
        "content-type": "application/json",
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end(obj === undefined ? "" : JSON.stringify(obj));
    };

    if (req.method === "OPTIONS") return send(204);
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, chainId: ctx.chainId });

    // Costly paths get an application-layer request budget — the chain sequences
    // first-come-first-served, so there is no fee market to lean on.
    if (req.method === "POST" && req.url === "/tally" || req.method === "GET" && req.url.startsWith("/risk")) {
      if (!allow(req.socket.remoteAddress)) return send(429, { error: "RATE_LIMITED", message: "Too many requests this minute." });
    }

    if (req.method === "GET" && req.url.startsWith("/risk")) {
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

    if (req.method !== "POST" || req.url !== "/tally") {
      if (webDist && req.method === "GET") return serveStatic(webDist, req.url, res);
      return send(404, { error: "NOT_FOUND" });
    }

    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, { error: "BODY_TOO_LARGE" });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: "BAD_JSON", message: "Body must be JSON." }); }

    try {
      return send(200, await handleTally(ctx, body));
    } catch (e) {
      if (e instanceof GateError) return send(e.status, { error: e.code, message: e.message });
      console.error("tally failed:", e?.shortMessage ?? e?.message ?? e);
      return send(500, { error: "INTERNAL", message: "The gate could not finish this request." });
    }
  });
}
