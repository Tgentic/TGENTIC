// Step 2 tests: the state/policy split. An m-of-n verifier set approves actions
// with signatures; anyone may submit; the set can rotate without touching state.
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("policy (Step 2: state/policy split, m-of-n)", function () {
  let bond, receipts, policy, v1, v2, v3, nv1, nv2, agent, payer, rando;

  beforeEach(async () => {
    [v1, v2, v3, nv1, nv2, agent, payer, rando] = await ethers.getSigners();
    bond = await ethers.deployContract("MockToken", ["Bond", "BOND", 18, 0]);
    receipts = await ethers.deployContract("Receipts", [await bond.getAddress(), 0]);
    policy = await ethers.deployContract("Policy", [await receipts.getAddress(), [v1.address, v2.address, v3.address], 2n]);
    await receipts.setPolicy(await policy.getAddress());
  });

  // Sign a digest with `signers`, returning signatures sorted by recovered address (what Policy expects).
  const signed = async (digest, signers) => {
    const bytes = ethers.getBytes(digest);
    const pairs = await Promise.all(signers.map(async (s) => {
      const sig = await s.signMessage(bytes);
      return { sig, addr: ethers.verifyMessage(bytes, sig) };
    }));
    pairs.sort((a, b) => BigInt(a.addr) < BigInt(b.addr) ? -1 : 1);
    return pairs.map((p) => p.sig);
  };

  const tallyAction = () => ({
    agent: agent.address, payer: payer.address, txHash: ethers.id("tx-1"),
    amount: 1_000_000n, rating: 4,
  });

  async function submitTally(signers, action = tallyAction()) {
    const sigs = await signed(await policy.tallyDigest(action.agent, action.payer, action.txHash, action.amount, action.rating), signers);
    return policy.submitTally(action.agent, action.payer, action.txHash, action.amount, action.rating, sigs);
  }

  it("records a tally with m-of-n verifier signatures, submitted by anyone", async () => {
    await submitTally([v1, v2]); // the signatures carry the authority; rando could submit too
    expect(await receipts.reputation(agent.address)).to.equal(1_000_000n * 4n);
    expect(await receipts.receipts(agent.address)).to.equal(1n);
    expect(await receipts.payers(agent.address)).to.equal(1n);
    expect(await receipts.used(ethers.id("tx-1"))).to.equal(true);
  });

  it("rejects fewer signatures than the threshold", async () => {
    const a = tallyAction();
    const sigs = await signed(await policy.tallyDigest(a.agent, a.payer, a.txHash, a.amount, a.rating), [v1]);
    await expect(policy.submitTally(a.agent, a.payer, a.txHash, a.amount, a.rating, sigs))
      .to.be.revertedWithCustomError(policy, "NotEnoughSigners").withArgs(1n, 2n);
  });

  it("rejects a duplicated signer", async () => {
    const a = tallyAction();
    const sig = (await signed(await policy.tallyDigest(a.agent, a.payer, a.txHash, a.amount, a.rating), [v1]))[0];
    await expect(policy.submitTally(a.agent, a.payer, a.txHash, a.amount, a.rating, [sig, sig]))
      .to.be.revertedWithCustomError(policy, "DuplicateSigner");
  });

  it("rejects a signature from a non-verifier", async () => {
    await expect(submitTally([v1, rando])).to.be.revertedWithCustomError(policy, "NotVerifier").withArgs(rando.address);
  });

  it("rejects a replayed receipt (the state layer's anti-replay stands)", async () => {
    await submitTally([v1, v2]);
    await expect(submitTally([v2, v3])).to.be.revertedWithCustomError(receipts, "AlreadyTallied");
  });

  it("slash burns the bond and wipes the reputation, with the evidence hash signed by the verifiers", async () => {
    await submitTally([v1, v2]);
    await bond.transfer(agent.address, 100n);
    await bond.connect(agent).approve(await receipts.getAddress(), 100n);
    await receipts.connect(agent).deposit(100n);
    expect(await receipts.reputation(agent.address)).to.equal(1_000_000n * 4n);

    const evidence = ethers.id("evidence: two self-transfers between the same pair, 10 minutes apart");
    const sigs = await signed(await policy.slashDigest(agent.address, 100n, evidence), [v2, v3]);
    await expect(policy.submitSlash(agent.address, 100n, "wash trading", evidence, sigs))
      .to.emit(policy, "SlashSubmitted").withArgs(agent.address, 100n, evidence, "wash trading", (await ethers.getSigners())[0].address);

    expect(await receipts.reputation(agent.address)).to.equal(0n);
    expect(await bond.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(100n);
  });

  it("rotates the verifier set without touching state, and the old set loses power", async () => {
    const next = [nv1.address, nv2.address];
    const sigs = await signed(await policy.rotationDigest(next, 2n), [v1, v3]);
    await expect(policy.rotate(next, 2n, sigs)).to.emit(policy, "Rotated").withArgs(next, 2n, 1n);
    expect(await policy.rotationNonce()).to.equal(1n);

    // the new set can tally...
    await submitTally([nv1, nv2]);
    expect(await receipts.receipts(agent.address)).to.equal(1n);

    // ...and the old set no longer counts (signatures are checked in sorted order, so the lower address is reported)
    const a = { ...tallyAction(), txHash: ethers.id("tx-2") };
    await expect(submitTally([v1, v2], a)).to.be.revertedWithCustomError(policy, "NotVerifier").withArgs(v2.address);
  });

  it("the state layer refuses direct calls from anyone but the policy", async () => {
    const a = tallyAction();
    await expect(receipts.connect(rando).tally(a.agent, a.payer, a.txHash, a.amount, a.rating))
      .to.be.revertedWithCustomError(receipts, "NotPolicy");
  });

  it("setPolicy can be wired exactly once", async () => {
    await expect(receipts.setPolicy(rando.address)).to.be.revertedWithCustomError(receipts, "BadInput");
  });
});
