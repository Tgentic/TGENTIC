const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TGENTIC", () => {
  let t, tok, gate, agent, p1, p2, other;
  const h = (n) => ethers.id("tx" + n);
  const MIN = 100n;
  const DEAD = "0x000000000000000000000000000000000000dEaD";

  async function setup(fee = 0) {
    [gate, agent, p1, p2, other] = await ethers.getSigners();
    tok = await ethers.deployContract("MockToken", ["Test Tally", "tTGEN", 18, fee]);
    t = await ethers.deployContract("TGENTIC", [gate.address, await tok.getAddress(), MIN]);
    await tok.transfer(agent.address, 1000n);
    await tok.connect(agent).approve(await t.getAddress(), 1000n);
  }
  beforeEach(() => setup());

  describe("reputation", () => {
    it("is zero without payments", async () => {
      expect(await t.reputation(agent.address)).to.equal(0);
    });

    it("counts amount x score, receipts, and unique payers", async () => {
      await t.tally(agent.address, p1.address, h(1), 100n, 5);
      await t.tally(agent.address, p1.address, h(2), 50n, 4);
      await t.tally(agent.address, p2.address, h(3), 10n, 1);
      expect(await t.reputation(agent.address)).to.equal(100n * 5n + 50n * 4n + 10n);
      expect(await t.paid(agent.address)).to.equal(160n);
      expect(await t.receipts(agent.address)).to.equal(3);
      expect(await t.payers(agent.address)).to.equal(2);
    });

    it("rejects the same tx hash twice", async () => {
      await t.tally(agent.address, p1.address, h(1), 1n, 3);
      await expect(t.tally(agent.address, p1.address, h(1), 1n, 3)).to.be.revertedWithCustomError(t, "AlreadyTallied");
    });

    it("only the gate may record and slash", async () => {
      await expect(t.connect(other).tally(agent.address, p1.address, h(1), 1n, 3)).to.be.revertedWithCustomError(t, "NotGate");
      await expect(t.connect(other).slash(agent.address, 1n, "x")).to.be.revertedWithCustomError(t, "NotGate");
    });

    it("rejects bad input", async () => {
      for (const a of [
        [agent.address, p1.address, h(1), 1n, 0],
        [agent.address, p1.address, h(1), 1n, 6],
        [agent.address, p1.address, h(1), 0n, 3],
        [agent.address, p1.address, ethers.ZeroHash, 1n, 3],
        [ethers.ZeroAddress, p1.address, h(1), 1n, 3],
      ]) await expect(t.tally(...a)).to.be.revertedWithCustomError(t, "BadInput");
    });
  });

  describe("bond", () => {
    it("the score reads zero until the bond reaches the minimum", async () => {
      await t.tally(agent.address, p1.address, h(1), 10n, 5);
      expect(await t.score(agent.address)).to.equal(0);
      await t.connect(agent).deposit(99n);
      expect(await t.score(agent.address)).to.equal(0);
      await t.connect(agent).deposit(1n);
      expect(await t.score(agent.address)).to.equal(50);
    });

    it("records what a fee-on-transfer token actually delivered", async () => {
      await setup(1000); // 10% fee
      await t.connect(agent).deposit(200n);
      expect(await t.bond(agent.address)).to.equal(180n);
    });

    it("withdrawal needs startUnlock + 7 days, and a deposit cancels it", async () => {
      await t.connect(agent).deposit(200n);
      await expect(t.connect(agent).withdraw(50n)).to.be.revertedWithCustomError(t, "Locked");
      await t.connect(agent).startUnlock();
      await time.increase(7 * 24 * 3600 - 5);
      await expect(t.connect(agent).withdraw(50n)).to.be.revertedWithCustomError(t, "Locked");
      await time.increase(10);
      await t.connect(agent).withdraw(50n);
      expect(await t.bond(agent.address)).to.equal(150n);
      await t.connect(agent).startUnlock();
      await t.connect(agent).deposit(10n);
      await expect(t.connect(agent).withdraw(1n)).to.be.revertedWithCustomError(t, "Locked");
    });

    it("cannot withdraw more than the bond", async () => {
      await t.connect(agent).deposit(100n);
      await t.connect(agent).startUnlock();
      await time.increase(7 * 24 * 3600 + 1);
      await expect(t.connect(agent).withdraw(101n)).to.be.revertedWithCustomError(t, "BadInput");
    });

    it("slash burns the bond to DEAD and wipes the reputation", async () => {
      await t.connect(agent).deposit(200n);
      await t.tally(agent.address, p1.address, h(1), 10n, 5);
      await t.slash(agent.address, 150n, "self-dealing");
      expect(await t.bond(agent.address)).to.equal(50n);
      expect(await tok.balanceOf(DEAD)).to.equal(150n);
      expect(await t.reputation(agent.address)).to.equal(0);
      expect(await t.score(agent.address)).to.equal(0);
    });

    it("slash is capped at the existing bond", async () => {
      await t.connect(agent).deposit(100n);
      await t.slash(agent.address, 999n, "x");
      expect(await t.bond(agent.address)).to.equal(0);
      expect(await tok.balanceOf(DEAD)).to.equal(100n);
    });
  });
});
