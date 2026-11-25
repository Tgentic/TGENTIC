// Step 3 tests: manipulation resistance — the on-chain flags, the event-based
// detector, and the application-layer rate limit.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("heuristics (Step 3: manipulation resistance)", function () {
  let bond, receipts, policy, heur, gate, v1, v2, v3, agent, payer, other, ctx, srv;

  beforeEach(async () => {
    [gate, v1, v2, v3, agent, payer, other] = await ethers.getSigners();
    bond = await ethers.deployContract("MockToken", ["Bond", "BOND", 18, 0]);
    receipts = await ethers.deployContract("Receipts", [await bond.getAddress(), 0]);
    policy = await ethers.deployContract("Policy", [await receipts.getAddress(), [v1.address, v2.address, v3.address], 2n]);
    await receipts.setPolicy(await policy.getAddress());
    heur = await ethers.deployContract("Heuristics", [await receipts.getAddress()]);

    const core = await import("../gate/src/core.js");
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const g = core.makeClients({ chainId, provider: network.provider, account: gate.address });
    ctx = { publicClient: g.publicClient, walletClient: g.walletClient, chainId, tgentic: await receipts.getAddress(), inflight: new Set() };
  });

  const signed = async (digest, signers) => {
    const bytes = ethers.getBytes(digest);
    const pairs = await Promise.all(signers.map(async (s) => {
      const sig = await s.signMessage(bytes);
      return { sig, addr: ethers.verifyMessage(bytes, sig) };
    }));
    pairs.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
    return pairs.map((p) => p.sig);
  };

  async function tally({ from, to, amount = 1000000n, rating = 4, txTag }) {
    const txHash = ethers.id(`tx-${txTag}`);
    const sigs = await signed(await policy.tallyDigest(to.address, from.address, txHash, amount, rating), [v1, v2]);
    await policy.submitTally(to.address, from.address, txHash, amount, rating, sigs);
    return txHash;
  }

  it("flags nothing for an agent with no receipts (no data, no verdict)", async () => {
    const f = await heur.assess(agent.address);
    expect(f.receiptCount).to.equal(0n);
    expect(f.flagged).to.equal(false);
  });

  it("flags a single payer after three receipts (the wash-trading shape)", async () => {
    for (let i = 0; i < 3; i++) await tally({ from: payer, to: agent, txTag: `w-${i}` });
    const f = await heur.assess(agent.address);
    expect(f.receiptCount).to.equal(3n);
    expect(f.payerCount).to.equal(1n);
    expect(f.singlePayer).to.equal(true);
    expect(f.flagged).to.equal(true);
  });

  it("flags repeat-heavy concentration across a small payer set", async () => {
    for (let i = 0; i < 5; i++) await tally({ from: payer, to: agent, txTag: `r-${i}` });
    for (let i = 0; i < 2; i++) await tally({ from: other, to: agent, txTag: `o-${i}` });
    const f = await heur.assess(agent.address); // 7 receipts, 2 payers, ratio 3.5
    expect(f.singlePayer).to.equal(false);
    expect(f.repeatHeavy).to.equal(true);
    expect(f.flagged).to.equal(true);
  });

  it("does not flag a genuinely diverse payer base", async () => {
    for (let i = 0; i < 4; i++) await tally({ from: i % 2 ? payer : other, to: agent, txTag: `d-${i}` });
    const f = await heur.assess(agent.address); // 4 receipts, 2 payers, ratio 2
    expect(f.flagged).to.equal(false);
  });

  describe("gate detector (event history)", function () {
    const { assessAgent } = require("../gate/src/heuristics.js");

    it("sees payer concentration, timing and amount patterns the state cannot", async () => {
      for (let i = 0; i < 4; i++) await tally({ from: payer, to: agent, amount: 1000000n, txTag: `g-${i}` });
      const r = await assessAgent(ctx.publicClient, { address: ctx.tgentic, agent: agent.address, fromBlock: 0n });
      expect(r.receipts).to.equal(4);
      expect(r.payers).to.equal(1);
      expect(r.topPayerShareBps).to.equal(10000);
      expect(r.flags).to.include("single-payer");
      expect(r.flags).to.include("regular-timing"); // hardhat mines one block per tx: perfectly regular
      expect(r.flags).to.include("amount-cycling"); // same amount four times
      expect(r.flagged).to.equal(true);
    });

    it("reads the payer and amount, not just counts", async () => {
      await tally({ from: payer, to: agent, amount: 777000n, txTag: "one" });
      const r = await assessAgent(ctx.publicClient, { address: ctx.tgentic, agent: agent.address, fromBlock: 0n });
      expect(r.topPayer).to.equal(payer.address.toLowerCase());
      expect(r.topAmount).to.equal("777000");
    });
  });

  describe("HTTP: /risk and the request budget", function () {
    beforeEach(async () => {
      srv = (await import("../gate/src/server.js")).createServer(ctx, { ratePerMinute: 3 }).listen(0);
      await new Promise((r) => srv.once("listening", r));
    });
    afterEach(() => srv.close());

    const get = (p) => fetch(`http://127.0.0.1:${srv.address().port}${p}`);

    it("answers /risk with the detector's assessment", async () => {
      const res = await get(`/risk?agent=${agent.address}`);
      expect(res.status).to.equal(200);
      const j = await res.json();
      expect(j).to.have.property("receipts");
      expect(j).to.have.property("flags");
    });

    it("rejects a bad agent address", async () => {
      expect((await get("/risk?agent=0x1")).status).to.equal(400);
    });

    it("enforces the per-minute request budget (burst -> 429)", async () => {
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await get(`/risk?agent=${agent.address}`)).status);
      expect(codes[0]).to.equal(200); // first 3 within the window pass
      expect(codes.slice(3)).to.deep.equal([429, 429]);
    });
  });
});
