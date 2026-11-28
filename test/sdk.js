// Step 4 tests: the SDK — the read path a third-party developer integrates.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("sdk (Step 4: integration)", function () {
  let gate, agent, payer, other, t, tg;

  beforeEach(async () => {
    [gate, agent, payer, other] = await ethers.getSigners();
    const bond = await ethers.deployContract("MockToken", ["Bond", "BOND", 18, 0]);
    t = await ethers.deployContract("TGENTIC", [gate.address, await bond.getAddress(), 0]);

    const { createClient } = await import("../sdk/src/index.js");
    tg = createClient({ provider: network.provider, address: await t.getAddress(), deployBlock: 0n });
  });

  const tally = (to, from, tag, amount = 1000000n, rating = 4) =>
    t.connect(gate).tally(to.address, from.address, ethers.id(`tx-${tag}`), amount, rating);

  it("reads the score and bond state without touching the contract ABI by hand", async () => {
    await tally(agent, payer, "a", 2000000n, 5);
    const s = await tg.score(agent.address);
    expect(s.score).to.equal(2000000n * 5n);
    expect(s.receipts).to.equal(1n);
    expect(s.payers).to.equal(1n);
    expect(s.counted).to.equal(true); // minBond is 0 in this fixture
  });

  it("receipts() returns the payment trail", async () => {
    await tally(agent, payer, "one", 777000n, 4);
    const rs = await tg.receipts(agent.address);
    expect(rs).to.have.lengthOf(1);
    expect(rs[0].payer).to.equal(payer.address);
    expect(rs[0].amount).to.equal(777000n);
    expect(rs[0].rating).to.equal(4);
    expect(rs[0].txHash).to.equal(ethers.id("tx-one"));
  });

  it("risk() runs the same detector the gate and dapp use", async () => {
    for (let i = 0; i < 4; i++) await tally(agent, payer, `w-${i}`);
    const r = await tg.risk(agent.address);
    expect(r.receipts).to.equal(4);
    expect(r.topPayerShareBps).to.equal(10000);
    expect(r.flags).to.include("single-payer");
    expect(r.flagged).to.equal(true);
  });

  it("does not flag one receipt from one payer — a payment is not a pattern", async () => {
    await tally(agent, payer, "solo");
    const r = await tg.risk(agent.address);
    expect(r.receipts).to.equal(1);
    expect(r.topPayerShareBps).to.equal(10000);
    expect(r.flagged).to.equal(false);
  });

  it("recent() and top() drive a leaderboard without local bookkeeping", async () => {
    await tally(agent, payer, "x", 1000000n, 2); // score 2,000,000 (earlier)
    await tally(other, payer, "y", 5000000n, 5); // score 25,000,000 (later, higher)
    const feed = await tg.recent(1);
    expect(feed[0].agent).to.equal(other.address);
    expect(await tg.recent(0)).to.deep.equal([]);
    expect(await tg.recent(Number.NaN)).to.deep.equal([]);
    const rows = await tg.top();
    expect(rows).to.have.lengthOf(2);
    expect(rows[0].agent).to.equal(other.address);
    expect(rows[1].agent).to.equal(agent.address);
    expect(rows[1].score).to.equal(2000000n);
    // top(1) must return the highest-scoring agent, not merely the chronologically earliest one.
    const top1 = await tg.top(1);
    expect(top1).to.have.lengthOf(1);
    expect(top1[0].agent).to.equal(other.address);
  });

  it("verify() is the hiring-flow answer: score + signals together", async () => {
    for (let i = 0; i < 3; i++) await tally(agent, payer, `v-${i}`);
    const v = await tg.verify(agent.address);
    expect(v.score).to.equal(12000000n);
    expect(v.counted).to.equal(true);
    expect(v.flagged).to.equal(true); // one payer, three receipts — the wash-trading shape
  });

  it("rejects a malformed agent address", async () => {
    try { await tg.score("0x1"); expect.fail("should have thrown"); }
    catch (e) { expect(e.message).to.include("Not an address"); }
  });

  it("paginates getLogs correctly with a tiny blockRange", async () => {
    const { createClient } = await import("../sdk/src/index.js");
    const paged = createClient({ provider: network.provider, address: await t.getAddress(), deployBlock: 0n, blockRange: 1n });
    await tally(agent, payer, "pg-1");
    await tally(agent, other, "pg-2", 500000n, 5);
    const rs = await paged.receipts(agent.address);
    expect(rs).to.have.lengthOf(2);
    expect(rs.map((r) => r.txHash)).to.have.members([ethers.id("tx-pg-1"), ethers.id("tx-pg-2")]);
    const feed = await paged.recent(5);
    expect(feed.length).to.be.greaterThan(0);
  });

  it("computeFlags stays the canonical detector — gate and web share this file", async () => {
    const { computeFlags } = await import("../sdk/src/flags.js");
    const txHash = ethers.id("same-payment");
    const l1 = { blockNumber: 10n, payer: "0x1111111111111111111111111111111111111111", amount: 5n, txHash };
    const l2 = { blockNumber: 20n, payer: "0x1111111111111111111111111111111111111111", amount: 5n, txHash };
    expect(computeFlags([l1, l2], "0x0").receipts).to.equal(1);
  });
});
