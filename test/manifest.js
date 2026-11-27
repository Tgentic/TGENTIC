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

  it("accepts a delegated signingKey listed in the manifest", async () => {
    const [, delegate] = await ethers.getSigners();
    const w = walletOf(delegate.address);
    const m = { ...base(wallet.address), signingKeys: [wallet.address, delegate.address] };
    const signed = await mf.signManifest(w, m);
    const res = await mf.verifyManifest(signed);
    expect(res.ok).to.equal(true);
    expect(res.signer).to.equal(delegate.address.toLowerCase());
  });

  it("rejects a delegated key NOT listed in the manifest", async () => {
    const [, stranger] = await ethers.getSigners();
    const w = walletOf(stranger.address);
    const signed = await mf.signManifest(w, base(wallet.address));
    expect((await mf.verifyManifest(signed)).ok).to.equal(false);
  });

  it("validateManifest flags bad shape", () => {
    expect(mf.validateManifest({})).to.not.have.length(0);
    expect(mf.validateManifest({ ...base(wallet.address), version: 0 })).to.include("version must be a positive integer");
    expect(mf.validateManifest({ ...base(wallet.address), endpoints: [{ name: "x", url: "ftp://nope" }] })[0]).to.include("http");
  });
});
