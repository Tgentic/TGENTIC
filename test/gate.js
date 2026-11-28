// Gate tests against the Hardhat network: mock USDG payments through a "facilitator", then POST /tally.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("gate", function () {
  let core, srv, usdg, tm, gate, facil, payer, agent, other, ctx, payerW, otherW;
  const AMOUNT = 100_000_000n; // 100 USDG (6 decimals)

  before(async () => {
    core = await import("../gate/src/core.js");
    srv = await import("../gate/src/server.js");
  });

  beforeEach(async () => {
    [gate, facil, payer, agent, other] = await ethers.getSigners();
    usdg = await ethers.deployContract("MockToken", ["Test USDG", "tUSDG", 6, 0]);
    tm = await ethers.deployContract("TGENTIC", [gate.address, await usdg.getAddress(), 0]);
    await usdg.transfer(payer.address, 10n * AMOUNT);
    await usdg.connect(payer).approve(facil.address, 10n * AMOUNT);

    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const mk = (account) => core.makeClients({ chainId, provider: network.provider, account });
    const g = mk(gate.address);
    payerW = mk(payer.address).walletClient;
    otherW = mk(other.address).walletClient;
    ctx = {
      publicClient: g.publicClient, walletClient: g.walletClient, chainId,
      tgentic: await tm.getAddress(), usdg: await usdg.getAddress(),
      facilitators: new Set([facil.address.toLowerCase()]), minConfirmations: 1, inflight: new Set(),
    };
  });

  // Payment: the facilitator moves USDG from the payer to the recipient (like an EIP-3009 settlement).
  async function pay({ to = agent.address, from = payer.address, by = facil } = {}) {
    const tx = by === payer ? await usdg.connect(payer).transfer(to, AMOUNT) : await usdg.connect(by).transferFrom(from, to, AMOUNT);
    return (await tx.wait()).hash;
  }
  const sign = (w, txHash, rating, a = agent.address) => w.signMessage({ message: core.feedbackMessage({ chainId: ctx.chainId, agent: a, txHash, rating }) });
  const code = async (p) => { try { await p; return "OK"; } catch (e) { return e.code ?? e.message; } };

  it("records a valid payment with the payer's rating", async () => {
    const txHash = await pay();
    const res = await core.handleTally(ctx, { agent: agent.address, txHash, rating: 4, signature: await sign(payerW, txHash, 4) });
    expect(res.payer).to.equal(payer.address);
    expect(res.amount).to.equal(AMOUNT.toString());
    expect(await tm.reputation(agent.address)).to.equal(AMOUNT * 4n);
    expect(await tm.payers(agent.address)).to.equal(1n);
    expect(await tm.used(txHash)).to.equal(true);
  });

  it("rejects an already-counted tx", async () => {
    const txHash = await pay();
    const body = { agent: agent.address, txHash, rating: 5, signature: await sign(payerW, txHash, 5) };
    await core.handleTally(ctx, body);
    expect(await code(core.handleTally(ctx, body))).to.equal("ALREADY_TALLIED");
  });

  it("rejects an agent that did not receive the transfer", async () => {
    const txHash = await pay();
    expect(await code(core.handleTally(ctx, { agent: other.address, txHash, rating: 5, signature: await sign(payerW, txHash, 5, other.address) }))).to.equal("NO_MATCHING_TRANSFER");
  });

  it("rejects a payment that did not go through a facilitator", async () => {
    const txHash = await pay({ by: payer });
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature: await sign(payerW, txHash, 5) }))).to.equal("NOT_FACILITATOR");
  });

  it("rejects a signature not from the payer", async () => {
    const txHash = await pay();
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature: await sign(otherW, txHash, 5) }))).to.equal("BAD_SIGNATURE");
  });

  it("rejects a signature for a different rating (the rating cannot be changed after signing)", async () => {
    const txHash = await pay();
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature: await sign(payerW, txHash, 1) }))).to.equal("BAD_SIGNATURE");
  });

  it("rejects an agent paying itself", async () => {
    const txHash = await pay({ to: payer.address });
    expect(await code(core.handleTally(ctx, { agent: payer.address, txHash, rating: 5, signature: await sign(payerW, txHash, 5, payer.address) }))).to.equal("SELF_PAYMENT");
  });

  it("rejects a signature bound to a different chain (EXP-B safeguard)", async () => {
    const txHash = await pay();
    const sig = await payerW.signMessage({ message: core.feedbackMessage({ chainId: ctx.chainId + 1, agent: agent.address, txHash, rating: 5 }) });
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature: sig }))).to.equal("BAD_SIGNATURE");
  });

  it("identity-bound tally: payer signature commits to the manifest hash", async () => {
    const mf = await import("../gate/src/manifest.js");
    const mk = (account) => core.makeClients({ chainId: ctx.chainId, provider: network.provider, account });
    const manifest = await mf.signManifest(mk(agent.address).walletClient, mf.newManifest({
      chainId: ctx.chainId, agent: agent.address, name: "bound agent",
      endpoints: [{ name: "web", url: "https://example.com" }],
    }));
    ctx.manifests = { byAgent: new Map([[agent.address.toLowerCase(), manifest]]) };
    const hash = mf.manifestHash(manifest);
    const txHash = await pay();
    const signature = await payerW.signMessage({ message: core.feedbackMessage({ chainId: ctx.chainId, agent: agent.address, txHash, rating: 5, manifestHash: hash }) });
    const res = await core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature, manifest });
    expect(res.manifestHash).to.equal(hash);
    expect(await tm.reputation(agent.address)).to.equal(AMOUNT * 5n);
  });

  it("rejects a manifest-bound tally when the signature did not bind it", async () => {
    const mf = await import("../gate/src/manifest.js");
    const mk = (account) => core.makeClients({ chainId: ctx.chainId, provider: network.provider, account });
    const manifest = await mf.signManifest(mk(agent.address).walletClient, mf.newManifest({
      chainId: ctx.chainId, agent: agent.address, name: "bound agent", endpoints: [],
    }));
    const txHash = await pay();
    const signature = await sign(payerW, txHash, 5); // signed WITHOUT the manifest line
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature, manifest }))).to.equal("BAD_SIGNATURE");
  });

  it("rejects a manifest naming a different agent", async () => {
    const mf = await import("../gate/src/manifest.js");
    const mk = (account) => core.makeClients({ chainId: ctx.chainId, provider: network.provider, account });
    const manifest = await mf.signManifest(mk(other.address).walletClient, mf.newManifest({
      chainId: ctx.chainId, agent: other.address, name: "wrong agent", endpoints: [],
    }));
    const txHash = await pay();
    const signature = await sign(payerW, txHash, 5);
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature, manifest }))).to.equal("MANIFEST_MISMATCH");
  });

  it("rejects binding to a superseded manifest version", async () => {
    const mf = await import("../gate/src/manifest.js");
    const mk = (account) => core.makeClients({ chainId: ctx.chainId, provider: network.provider, account });
    const w = mk(agent.address).walletClient;
    const v1 = await mf.signManifest(w, mf.newManifest({ chainId: ctx.chainId, agent: agent.address, name: "a", endpoints: [], version: 1 }));
    const v2 = await mf.signManifest(w, mf.newManifest({ chainId: ctx.chainId, agent: agent.address, name: "a", endpoints: [], version: 2 }));
    ctx.manifests = { byAgent: new Map([[agent.address.toLowerCase(), v2]]) };
    const txHash = await pay();
    const signature = await payerW.signMessage({ message: core.feedbackMessage({ chainId: ctx.chainId, agent: agent.address, txHash, rating: 5, manifestHash: mf.manifestHash(v1) }) });
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature, manifest: v1 }))).to.equal("MANIFEST_STALE");
  });

  it("waits for enough confirmations", async () => {
    ctx.minConfirmations = 3;
    const txHash = await pay();
    const body = { agent: agent.address, txHash, rating: 3, signature: await sign(payerW, txHash, 3) };
    expect(await code(core.handleTally(ctx, body))).to.equal("NOT_CONFIRMED");
    await network.provider.send("hardhat_mine", ["0x2"]);
    expect(await code(core.handleTally(ctx, body))).to.equal("OK");
  });

  it("records a tally through the v2 policy path (m-of-n signatures, gate only relays)", async () => {
    const receipts = await ethers.deployContract("Receipts", [await usdg.getAddress(), 0n]);
    const policy = await ethers.deployContract("Policy", [await receipts.getAddress(), [gate.address, facil.address, payer.address], 2n]);
    await receipts.setPolicy(await policy.getAddress());
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    // same { address, signMessage } shape production gets from privateKeyToAccount,
    // backed here by hardhat's eth_sign through the custom transport
    const signerLike = (s) => {
      const wc = core.makeClients({ chainId, provider: network.provider, account: s.address }).walletClient;
      return { address: s.address, signMessage: (msg) => wc.signMessage({ account: s.address, ...msg }) };
    };
    const v2ctx = {
      ...ctx,
      tgentic: await receipts.getAddress(), policy: await policy.getAddress(),
      // the gate signs with its own key plus a second verifier; sorted by address in core
      signers: [gate, facil].map(signerLike),
    };
    const txHash = await pay();
    const res = await core.handleTally(v2ctx, { agent: agent.address, txHash, rating: 4, signature: await sign(payerW, txHash, 4) });
    expect(res.payer).to.equal(payer.address);
    expect(res.amount).to.equal(AMOUNT.toString());
    // state landed on the v2 layer, through the policy, keyed by the payment hash
    expect(await receipts.reputation(agent.address)).to.equal(AMOUNT * 4n);
    expect(await receipts.receipts(agent.address)).to.equal(1n);
    expect(await receipts.used(txHash)).to.equal(true);
    // the direct v1-style write is refused by the v2 state layer
    await expect(receipts.connect(gate).tally(agent.address, payer.address, txHash, AMOUNT, 4)).to.be.revertedWithCustomError(receipts, "NotPolicy");
    // replay through the gate is still blocked by the state layer's used map
    expect(await code(core.handleTally(v2ctx, { agent: agent.address, txHash, rating: 4, signature: await sign(payerW, txHash, 4) }))).to.equal("ALREADY_TALLIED");
  });

  it("rejects bad input and a missing tx", async () => {
    const txHash = await pay();
    const sig = await sign(payerW, txHash, 5);
    for (const bad of [{}, { agent: "0x1", txHash, rating: 5, signature: sig }, { agent: agent.address, txHash, rating: 6, signature: sig }, { agent: agent.address, txHash, rating: 2.5, signature: sig }]) {
      expect(await code(core.handleTally(ctx, bad))).to.equal("BAD_INPUT");
    }
    expect(await code(core.handleTally(ctx, { agent: agent.address, txHash: ethers.id("nope"), rating: 5, signature: sig }))).to.equal("TX_NOT_FOUND");
  });

  it("HTTP: health, broken JSON, bad input, and the success path", async () => {
    const server = srv.createServer(ctx).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      expect((await fetch(`${base}/health`)).status).to.equal(200);
      const post = (b) => fetch(`${base}/tally`, { method: "POST", headers: { "content-type": "application/json" }, body: b });
      expect((await post("{nope")).status).to.equal(400);
      const r1 = await post("{}");
      expect(r1.status).to.equal(400);
      expect((await r1.json()).error).to.equal("BAD_INPUT");
      const txHash = await pay();
      const r2 = await post(JSON.stringify({ agent: agent.address, txHash, rating: 2, signature: await sign(payerW, txHash, 2) }));
      expect(r2.status).to.equal(200);
      expect((await r2.json()).amount).to.equal(AMOUNT.toString());
    } finally {
      server.close();
    }
  });

  it("HTTP: GET /manifest/<addr> serves the verified manifest, 404 otherwise", async () => {
    const mf = await import("../gate/src/manifest.js");
    const mk = (account) => core.makeClients({ chainId: ctx.chainId, provider: network.provider, account });
    const manifest = await mf.signManifest(mk(agent.address).walletClient, mf.newManifest({
      chainId: ctx.chainId, agent: agent.address, name: "served agent", endpoints: [],
    }));
    ctx.manifests = { byAgent: new Map([[agent.address.toLowerCase(), manifest]]) };
    const server = srv.createServer(ctx).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const ok = await fetch(`${base}/manifest/${agent.address}`);
      expect(ok.status).to.equal(200);
      expect((await ok.json()).name).to.equal("served agent");
      expect((await fetch(`${base}/manifest/${other.address}`)).status).to.equal(404);
      expect((await fetch(`${base}/manifest/not-an-address`)).status).to.equal(404);
      const idx = await fetch(`${base}/manifests`);
      expect(idx.status).to.equal(200);
      const { manifests } = await idx.json();
      expect(manifests).to.have.length(1);
      expect(manifests[0].agent).to.equal(agent.address);
      expect(manifests[0].manifestHash).to.equal(mf.manifestHash(manifest));
      const served = await (await fetch(`${base}/manifest/${agent.address}`)).json();
      // /manifest serves the raw signed artifact — no injected fields, so it
      // can round-trip into /tally without breaking verifyManifest.
      expect(served.signature).to.equal(manifest.signature);
      expect(mf.manifestHash(served)).to.equal(mf.manifestHash(manifest));
    } finally {
      server.close();
    }
  });

  it("HTTP: GET /agents ranks and filters scored agents with live flags", async () => {
    // give the agent one tallied receipt so it appears on the index
    const txHash = await pay();
    await core.handleTally(ctx, { agent: agent.address, txHash, rating: 5, signature: await sign(payerW, txHash, 5) });
    ctx.detectFromBlock = 0n; // local chain blocks are tiny; prod sets this to the v2 deploy block
    const server = srv.createServer(ctx).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const all = await (await fetch(`${base}/agents`)).json();
      expect(all.total).to.equal(1);
      const row = all.agents[0];
      expect(row.agent.toLowerCase()).to.equal(agent.address.toLowerCase());
      expect(row.score).to.equal((AMOUNT * 5n).toString());
      expect(row.receipts).to.equal("1");
      expect(row.payers).to.equal("1");
      expect(row.counted).to.equal(true);
      expect(row).to.have.property("flagged");

      // filters actually filter
      expect((await (await fetch(`${base}/agents?minScore=1`)).json()).agents).to.have.length(1);
      expect((await (await fetch(`${base}/agents?minScore=999999999999`)).json()).agents).to.have.length(0);
      expect((await (await fetch(`${base}/agents?minReceipts=2`)).json()).agents).to.have.length(0);
      const clean = await (await fetch(`${base}/agents?flagged=false`)).json();
      expect(clean.agents.every((a) => !a.flagged)).to.equal(true);
      // bad input → 400, not a 500
      expect((await fetch(`${base}/agents?minScore=abc`)).status).to.equal(400);
      expect((await fetch(`${base}/agents?minReceipts=1e5`)).status).to.equal(400);
    } finally {
      server.close();
    }
  });

  it("HTTP: GET /mcp gives browsers the docs page and MCP clients the SSE channel", async () => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-"));
    fs.writeFileSync(path.join(dist, "mcp.html"), "<!doctype html><title>mcp</title>get_agent_score get_agent_risk");
    const server = srv.createServer(ctx, { webDist: dist }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await fetch(`${base}/mcp`, { headers: { accept: "text/html,application/xhtml+xml" } });
      expect(page.headers.get("content-type")).to.include("text/html");
      const html = await page.text();
      expect(html).to.include("get_agent_score").and.to.include("get_agent_risk");
      // no Accept header at all (health probes, curl default) also gets the page
      const probe = await fetch(`${base}/mcp`);
      expect(probe.headers.get("content-type")).to.include("text/html");
      const sse = await fetch(`${base}/mcp`, { headers: { accept: "text/event-stream" } });
      expect(sse.headers.get("content-type")).to.include("text/event-stream");
      expect(await sse.text()).to.include("tgentic-mcp");
    } finally {
      server.close();
    }
    // without webDist (gate-only deploy) browsers still get a useful answer
    const bare = srv.createServer(ctx).listen(0);
    await new Promise((r) => bare.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${bare.address().port}/mcp`, { headers: { accept: "text/html" } });
      expect(res.status).to.equal(200);
      expect((await res.json()).name).to.equal("tgentic-mcp");
    } finally {
      bare.close();
    }
  });

  it("HTTP: hostile URLs are rejected and never crash the process", async () => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-"));
    fs.writeFileSync(path.join(dist, "index.html"), "<html>ok</html>");
    const server = srv.createServer(ctx, { webDist: dist }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      // malformed percent-encoding
      for (const u of ["/foo%bar", "/%ZZ", "/%E0%A4%A"]) expect((await fetch(`${base}${u}`)).status).to.equal(400);
      // control chars and null bytes (would throw inside header values / fs calls)
      for (const u of ["/x%0d%0a.html", "/%0a.html", "/%00", "/x%09.html"]) expect((await fetch(`${base}${u}`)).status).to.equal(400);
      // traversal stays inside the root and falls back to index.html
      for (const u of ["/..%2f..%2fetc%2fpasswd", "/../secret.txt", "/nonexistent.js"]) expect((await fetch(`${base}${u}`)).status).to.equal(200);
      // clean URL: /app serves app.html when it exists; /index.html is never redirected
      expect((await fetch(`${base}/index.html`)).status).to.equal(200);
      // non-latin1 path in an .html redirect must not throw either
      expect((await fetch(`${base}/%e2%82%ac.html`, { redirect: "manual" })).status).to.equal(301);
      // the process survived everything
      expect((await fetch(`${base}/health`)).status).to.equal(200);
    } finally {
      server.close();
    }
  });

  it("HTTP: an aborted request body must not crash the process", async () => {
    const net = require("node:net");
    const server = srv.createServer(ctx).listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = server.address().port;
    try {
      // send a partial body then destroy the socket mid-stream — the async
      // body reader rejects; before the fix that was an unhandled rejection
      // and Node's default is to crash the process.
      await new Promise((resolve) => {
        const s = net.connect(port, "127.0.0.1", () => {
          s.write("POST /tally HTTP/1.1\r\nHost: x\r\nContent-Length: 100000\r\n\r\n{\"partial\":");
          setTimeout(() => { s.destroy(); resolve(); }, 50);
        });
      });
      await new Promise((r) => setTimeout(r, 200));
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).to.equal(200);
    } finally {
      server.close();
    }
  });

  it("HTTP: rate limit buckets by X-Forwarded-For client IP, not the proxy", async () => {
    const server = srv.createServer(ctx, { ratePerMinute: 2 }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (xff) => fetch(`${base}/tally`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": xff }, body: "{}",
    });
    try {
      expect((await post("1.1.1.1")).status).to.equal(400); // BAD_INPUT — budget consumed
      expect((await post("1.1.1.1")).status).to.equal(400);
      expect((await post("1.1.1.1")).status).to.equal(429); // third request from same IP: limited
      expect((await post("2.2.2.2")).status).to.equal(400); // a different client IP has its own budget
    } finally {
      server.close();
    }
  });

  it("HTTP: query strings do not change routing; /riskfoo is not /risk", async () => {
    const server = srv.createServer(ctx).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      // /tally?x=1 must still reach the tally handler (was a 404 before the pathname fix)
      const r = await fetch(`${base}/tally?x=1`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(r.status).to.equal(400);
      expect((await r.json()).error).to.equal("BAD_INPUT");
      // prefix paths that merely start with /risk must not hit the risk handler
      expect((await fetch(`${base}/riskfoo`)).status).to.equal(404);
      expect((await fetch(`${base}/risk?agent=notanaddress`)).status).to.equal(400);
    } finally {
      server.close();
    }
  });

  it("HTTP: hostile request battery — the process must survive everything", async () => {
    const net = require("node:net");
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    // Any rejection the server fails to handle lands here; the battery asserts zero.
    const violations = [];
    const onRejection = (e) => violations.push(`unhandledRejection: ${e?.message ?? e}`);
    const onUncaught = (e) => violations.push(`uncaughtException: ${e?.message ?? e}`);
    process.on("unhandledRejection", onRejection);
    process.on("uncaughtException", onUncaught);

    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-"));
    fs.writeFileSync(path.join(dist, "index.html"), `<html>${"x".repeat(300_000)}</html>`);
    const server = srv.createServer(ctx, { webDist: dist }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = server.address().port;

    // Raw socket helpers: write bytes then kill the connection mid-exchange.
    const raw = (bytes, { holdMs = 100, afterWrite } = {}) => new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.write(bytes);
        afterWrite?.(s);
        setTimeout(() => { s.destroy(); resolve(); }, holdMs);
      });
      s.on("error", () => {}); // RST on destroy is expected, not a finding
    });

    try {
      // 1. abort a content-length POST mid-body (the F3 repro)
      await raw("POST /tally HTTP/1.1\r\nHost: x\r\nContent-Length: 100000\r\n\r\n{\"partial\":");
      // 2. abort a chunked POST mid-chunk
      await raw("POST /tally HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n");
      // 3. abort during a static download (response already streaming)
      await fetch(`http://127.0.0.1:${port}/`).then((r) => r.body.cancel()); // reader abort mid-stream
      await raw("GET / HTTP/1.1\r\nHost: x\r\n\r\n", { holdMs: 30 });
      // 4. garbage HTTP and hostile request lines
      await raw("GARBAGE\r\n\r\n");
      await raw("\x00\x01\x02\x03\r\n\r\n");
      // 5. a very long URL and a long header line (Node itself must 404/431, not crash)
      await raw(`GET /${"a".repeat(10_000)} HTTP/1.1\r\nHost: x\r\n\r\n`);
      await raw(`GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${"b".repeat(20_000)}\r\n\r\n`);
      // 6. bodiless POST and a HEAD
      await raw("POST /tally HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n");
      await raw("HEAD /health HTTP/1.1\r\nHost: x\r\n\r\n");
      // 7. /risk with hostile query encodings
      for (const q of ["%", "%zz", "%E0%A4%A", "%ff", ""]) {
        const r = await fetch(`http://127.0.0.1:${port}/risk?agent=${q}`);
        expect([200, 400, 500].includes(r.status), `agent=${q}`).to.equal(true);
      }

      // Let any late rejection from destroyed sockets surface, then judge.
      await new Promise((r) => setTimeout(r, 500));
      expect(violations, violations.join("; ")).to.have.lengthOf(0);
      // …and the process survived everything.
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).to.equal(200);
    } finally {
      process.off("unhandledRejection", onRejection);
      process.off("uncaughtException", onUncaught);
      server.close();
    }
  });
});
