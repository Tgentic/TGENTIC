// MCP endpoint tests: JSON-RPC over the same ctx as the gate, tools read chain state.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("mcp", function () {
  let core, mcp, usdg, tm, gate, facil, payer, agent, ctx, payerW;
  const AMOUNT = 100_000_000n;

  before(async () => {
    core = await import("../gate/src/core.js");
    mcp = await import("../gate/src/mcp.js");
  });

  beforeEach(async () => {
    [gate, facil, payer, agent] = await ethers.getSigners();
    usdg = await ethers.deployContract("MockToken", ["Test USDG", "tUSDG", 6, 0]);
    tm = await ethers.deployContract("TGENTIC", [gate.address, await usdg.getAddress(), 0]);
    await usdg.transfer(payer.address, 10n * AMOUNT);
    await usdg.connect(payer).approve(facil.address, 10n * AMOUNT);
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const mk = (account) => core.makeClients({ chainId, provider: network.provider, account });
    const g = mk(gate.address);
    payerW = mk(payer.address).walletClient;
    ctx = {
      publicClient: g.publicClient, walletClient: g.walletClient, chainId,
      tgentic: await tm.getAddress(), usdg: await usdg.getAddress(),
      facilitators: new Set([facil.address.toLowerCase()]), minConfirmations: 1, inflight: new Set(),
      detectFromBlock: 0n,
    };
  });

  const tally = async (rating = 5) => {
    const txHash = (await (await usdg.connect(facil).transferFrom(payer.address, agent.address, AMOUNT)).wait()).hash;
    const signature = await payerW.signMessage({ message: core.feedbackMessage({ chainId: ctx.chainId, agent: agent.address, txHash, rating }) });
    await core.handleTally(ctx, { agent: agent.address, txHash, rating, signature });
  };

  it("initialize returns protocol version + tools capability", async () => {
    const res = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res.status).to.equal(200);
    expect(res.body.result.protocolVersion).to.be.a("string");
    expect(res.body.result.serverInfo.name).to.equal("tgentic-mcp");
    expect(res.body.result.capabilities.tools).to.exist;
  });

  it("tools/list exposes the reputation tools", async () => {
    const res = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = res.body.result.tools.map((t) => t.name);
    expect(names).to.include("get_agent_score");
    expect(names).to.include("get_agent_risk");
  });

  it("get_agent_score reads real chain state after a tally", async () => {
    await tally(4);
    const res = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "get_agent_score", arguments: { agent: agent.address } },
    });
    const out = res.body.result.structuredContent;
    expect(out.receipts).to.equal("1");
    expect(out.payers).to.equal("1");
    expect(out.counted).to.equal(true); // TGENTIC v1 test contract counts without bond
    expect(out.score).to.equal((AMOUNT * 4n).toString());
  });

  it("get_agent_risk returns heuristic flags for a tallied agent", async () => {
    await tally(5);
    const res = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "get_agent_risk", arguments: { agent: agent.address } },
    });
    const out = res.body.result.structuredContent;
    expect(out.receipts).to.equal(1);
    expect(out.agent.toLowerCase()).to.equal(agent.address.toLowerCase());
  });

  it("rejects a bad agent address", async () => {
    const res = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "get_agent_score", arguments: { agent: "0x123" } },
    });
    expect(res.body.error).to.exist;
    expect(res.body.error.code).to.equal(-32602);
  });

  it("unknown method and unknown tool return errors", async () => {
    const res = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 6, method: "bogus/method" });
    expect(res.body.error.code).to.equal(-32601);
    const res2 = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope", arguments: { agent: agent.address } } });
    expect(res2.body.error.code).to.equal(-32602);
  });

  it("resources/list + resources/read serve a real leaderboard", async () => {
    await tally(5);
    const list = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 10, method: "resources/list" });
    expect(list.body.result.resources[0].uri).to.equal("resource://tgentic/leaderboard/latest");
    const res = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 11, method: "resources/read",
      params: { uri: "resource://tgentic/leaderboard/latest" },
    });
    const data = JSON.parse(res.body.result.contents[0].text);
    expect(data.agents).to.have.length(1);
    expect(data.agents[0].agent).to.equal(agent.address);
    const bad = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 12, method: "resources/read", params: { uri: "resource://nope" } });
    expect(bad.body.error.code).to.equal(-32602);
  });

  it("prompts/list + prompts/get return the audit template", async () => {
    const list = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 13, method: "prompts/list" });
    expect(list.body.result.prompts[0].name).to.equal("audit_agent");
    const res = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 14, method: "prompts/get",
      params: { name: "audit_agent", arguments: { agent: agent.address } },
    });
    expect(res.body.result.messages[0].content.text).to.include(agent.address);
    const bad = await mcp.handleMcp(ctx, { jsonrpc: "2.0", id: 15, method: "prompts/get", params: { name: "nope" } });
    expect(bad.body.error.code).to.equal(-32602);
  });

  it("notifications get 202 with no body; batches work", async () => {
    const res = await mcp.handleMcp(ctx, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).to.equal(202);
    const batch = await mcp.handleMcp(ctx, [
      { jsonrpc: "2.0", id: 8, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 9, method: "tools/list" },
    ]);
    expect(batch.status).to.equal(200);
    expect(batch.body).to.have.length(2);
  });

  it("rejects batches larger than MAX_BATCH and handles null tool arguments cleanly", async () => {
    const huge = Array.from({ length: mcp.MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: "2.0", id: i + 1, method: "ping" }));
    const res = await mcp.handleMcp(ctx, huge);
    expect(res.status).to.equal(400);
    expect(res.body.error.code).to.equal(-32600);

    const nullArgs = await mcp.handleMcp(ctx, {
      jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "get_agent_score", arguments: null },
    });
    expect(nullArgs.body.error.code).to.equal(-32602);
    expect(nullArgs.body.error.message).to.include("0x address");
  });

  it("get_agent_score reports counted from bond >= minBond even with 0 receipts", async () => {
    const bondedTm = await ethers.deployContract("TGENTIC", [gate.address, await usdg.getAddress(), 500_000n]);
    await usdg.transfer(agent.address, 500_000n);
    await usdg.connect(agent).approve(await bondedTm.getAddress(), 500_000n);
    await bondedTm.connect(agent).deposit(500_000n);
    const res = await mcp.handleMcp({ ...ctx, tgentic: await bondedTm.getAddress() }, {
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "get_agent_score", arguments: { agent: agent.address } },
    });
    expect(res.body.result.structuredContent.score).to.equal("0");
    expect(res.body.result.structuredContent.counted).to.equal(true);
  });

  it("HTTP: /mcp charges per batch item against rate limit and caps SSE per-IP, globally, and by TTL", async () => {
    const srv = await import("../gate/src/server.js");
    const server = srv.createServer(ctx, { mcpRatePerMinute: 5, maxSseConnections: 2, maxSsePerIp: 1, sseDurationMs: 120 }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      // A 6-item batch exceeds mcpRatePerMinute=5 on a single IP.
      const batch = Array.from({ length: 6 }, (_, i) => ({ jsonrpc: "2.0", id: i + 1, method: "ping" }));
      const r1 = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify(batch),
      });
      expect(r1.status).to.equal(429);

      // Per-IP SSE cap (1): same IP gets 503 on a second concurrent stream, while a second IP succeeds.
      const c1 = new AbortController();
      const s1 = await fetch(`${base}/mcp`, { headers: { "x-forwarded-for": "10.0.0.2" }, signal: c1.signal });
      expect(s1.status).to.equal(200);
      const s1Dup = await fetch(`${base}/mcp`, { headers: { "x-forwarded-for": "10.0.0.2" } });
      expect(s1Dup.status).to.equal(503);

      const c2 = new AbortController();
      const s2 = await fetch(`${base}/mcp`, { headers: { "x-forwarded-for": "10.0.0.3" }, signal: c2.signal });
      expect(s2.status).to.equal(200);
      // Global SSE cap (2): third IP gets 503.
      const s3 = await fetch(`${base}/mcp`, { headers: { "x-forwarded-for": "10.0.0.4" } });
      expect(s3.status).to.equal(503);

      // After sseDurationMs elapses, slots auto-release without client abort.
      await new Promise((r) => setTimeout(r, 180));
      const c4 = new AbortController();
      const s4 = await fetch(`${base}/mcp`, { headers: { "x-forwarded-for": "10.0.0.4" }, signal: c4.signal });
      expect(s4.status).to.equal(200);
      c1.abort(); c2.abort(); c4.abort();
    } finally {
      server.close();
    }
  });
});
