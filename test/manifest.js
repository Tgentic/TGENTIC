// Step 6: signed agent manifest — sign, verify, tamper detection, delegated keys.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { createWalletClient, custom } = require("viem");

describe("agent manifest", function () {
  let mf, wallet;
  const walletOf = (account) =>
    createWalletClient({ account, chain: { id: 31337, name: "hardhat" }, transport: custom(network.provider) });

  before(async () => {
    mf = await import("../gate/src/manifest.js");
  });

  beforeEach(async () => {
    [wallet] = await ethers.getSigners();
  });

  const base = (agent) => mf.newManifest({
    chainId: 31337, agent, agentId: 26520,
    name: "TGENTIC reference agent",
    endpoints: [{ name: "web", url: "https://www.tgentic.xyz/app" }],
  });

  it("round-trips: sign by the agent wallet, verify offline", async () => {
    const w = walletOf(wallet.address);
    const signed = await mf.signManifest(w, base(wallet.address));
    const res = await mf.verifyManifest(signed);
    expect(res.ok).to.equal(true);
    expect(res.signer).to.equal(wallet.address.toLowerCase());
  });

  it("canonical message is stable across key order", async () => {
    const m = base(wallet.address);
    const shuffled = Object.fromEntries(Object.entries(m).reverse());
    expect(mf.manifestMessage(shuffled)).to.equal(mf.manifestMessage(m));
  });

  it("rejects a manifest signed by an unrelated key", async () => {
    const [, stranger] = await ethers.getSigners();
    const w = walletOf(stranger.address);
    const signed = await mf.signManifest(w, base(wallet.address)); // claims wallet's agent
    const res = await mf.verifyManifest(signed);
    expect(res.ok).to.equal(false);
    expect(res.errors[0]).to.include("signingKey");
  });

  it("rejects tampered content after signing", async () => {
    const w = walletOf(wallet.address);
    const signed = await mf.signManifest(w, base(wallet.address));
    signed.name = "different name — tampered";
    const res = await mf.verifyManifest(signed);
    expect(res.ok).to.equal(false);
  });

  it("rejects a forged manifest where a stranger self-declares their key in signingKeys", async () => {
    const [, attacker] = await ethers.getSigners();
    const w = walletOf(attacker.address);
    const m = { ...base(wallet.address), signingKeys: [attacker.address] };
    const signed = await mf.signManifest(w, m);
    const res = await mf.verifyManifest(signed);
    expect(res.ok).to.equal(false);
    expect(res.errors[0]).to.include("signingKey");
  });

  it("accepts a delegated signingKey only with sequential rotation and blocks version-skip / revoked keys", async () => {
    const [, delegate, delegate2, attacker] = await ethers.getSigners();
    const v1 = await mf.signManifest(
      walletOf(wallet.address),
      { ...base(wallet.address), version: 1, signingKeys: [wallet.address, delegate.address] },
    );
    const v2 = await mf.signManifest(
      walletOf(delegate.address),
      { ...base(wallet.address), version: 2, name: "rotated", signingKeys: [delegate2.address] },
    );
    const v3 = await mf.signManifest(
      walletOf(delegate2.address),
      { ...base(wallet.address), version: 3, name: "rotated-2", signingKeys: [delegate2.address] },
    );
    // Standalone v2 signed by delegate fails without a verified predecessor; null opts does not throw.
    expect((await mf.verifyManifest(v2, null)).ok).to.equal(false);
    // With verified v1 as predecessor, sequential v2 succeeds.
    const res = await mf.verifyManifest(v2, { previous: v1 });
    expect(res.ok).to.equal(true);
    expect(res.signer).to.equal(delegate.address.toLowerCase());
    // Version-skip (e.g. v1 -> v3 or huge version) is rejected.
    const vSkip = await mf.signManifest(walletOf(delegate.address), { ...base(wallet.address), version: 3, signingKeys: [delegate.address] });
    expect((await mf.verifyManifest(vSkip, { previous: v1 })).ok).to.equal(false);
    // Multi-hop chain [v1, v2, v3] succeeds, while revoked `delegate` cannot sign v3.
    const chainOk = await mf.verifyManifestChain([v1, v2, v3]);
    expect(chainOk.ok).to.equal(true);
    expect(chainOk.signer).to.equal(delegate2.address.toLowerCase());
    const v3ByRevoked = await mf.signManifest(walletOf(delegate.address), { ...base(wallet.address), version: 3, signingKeys: [delegate.address] });
    expect((await mf.verifyManifestChain([v1, v2, v3ByRevoked])).ok).to.equal(false);
    // Forged predecessor cannot authorize an attacker.
    const fakePrev = await mf.signManifest(walletOf(attacker.address), { ...base(wallet.address), version: 1, signingKeys: [attacker.address] });
    const fakeV2 = await mf.signManifest(walletOf(attacker.address), { ...base(wallet.address), version: 2, signingKeys: [attacker.address] });
    expect((await mf.verifyManifest(fakeV2, { previous: fakePrev })).ok).to.equal(false);
  });

  it("rejects a delegated key NOT listed in the manifest", async () => {
    const [, stranger] = await ethers.getSigners();
    const w = walletOf(stranger.address);
    const signed = await mf.signManifest(w, base(wallet.address));
    expect((await mf.verifyManifest(signed)).ok).to.equal(false);
  });

  it("validateManifest flags bad shape and unsafe integer versions", () => {
    expect(mf.validateManifest({})).to.not.have.length(0);
    expect(mf.validateManifest({ ...base(wallet.address), version: 0 })).to.include("version must be a positive safe integer");
    expect(mf.validateManifest({ ...base(wallet.address), version: 1e300 })).to.include("version must be a positive safe integer");
    expect(mf.validateManifest({ ...base(wallet.address), endpoints: [{ name: "x", url: "ftp://nope" }] })[0]).to.include("http");
  });
});
