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
});
