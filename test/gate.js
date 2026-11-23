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

  it("waits for enough confirmations", async () => {
    ctx.minConfirmations = 3;
    const txHash = await pay();
    const body = { agent: agent.address, txHash, rating: 3, signature: await sign(payerW, txHash, 3) };
    expect(await code(core.handleTally(ctx, body))).to.equal("NOT_CONFIRMED");
    await network.provider.send("hardhat_mine", ["0x2"]);
    expect(await code(core.handleTally(ctx, body))).to.equal("OK");
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
});
