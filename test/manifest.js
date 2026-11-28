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

  describe("key rotation — resolveManifests", () => {
    const versioned = (agent, version, signingKeys) =>
      mf.newManifest({ ...base(agent), version, signingKeys: signingKeys ?? [agent] });

    it("accepts a v2 signed by the key v1 authorized", async () => {
      const [, newKey] = await ethers.getSigners();
      const v1 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 1));
      // v1 authorized agent+its keys (default [agent]); v2 rotates in newKey,
      // signed by the still-authorized agent key.
      const v2 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 2, [newKey.address]));
      const { current, chain, errors } = await mf.resolveManifests([v2, v1]); // unordered input
      expect(errors).to.have.length(0);
      expect(current.version).to.equal(2);
      expect(chain.map((c) => c.ok)).to.deep.equal([true, true]);
    });

    it("drops a v2 signed by a key v1 never authorized", async () => {
      const [, stranger] = await ethers.getSigners();
      const v1 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 1));
      // The forged v2 verifies standalone — stranger declared itself in its
      // own signingKeys and signed it. Only the chain rule rejects it.
      const forged = await mf.signManifest(walletOf(stranger.address), versioned(wallet.address, 2, [stranger.address]));
      expect((await mf.verifyManifest(forged)).ok).to.equal(true);
      const { current, errors } = await mf.resolveManifests([v1, forged]);
      expect(current.version).to.equal(1); // chain stops at the trusted tip
      expect(errors[0]).to.include("not authorized");
    });

    it("full rotation: v2 authorizes newKey, v3 is signed by newKey alone", async () => {
      const [, newKey] = await ethers.getSigners();
      const v1 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 1));
      const v2 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 2, [newKey.address]));
      // After rotation the agent key is no longer declared — only newKey signs v3.
      const v3 = await mf.signManifest(walletOf(newKey.address), versioned(wallet.address, 3, [newKey.address]));
      const { current, errors } = await mf.resolveManifests([v1, v2, v3]);
      expect(errors).to.have.length(0);
      expect(current.version).to.equal(3);
    });

    it("retired delegated keys lose authority; the agent key itself never does", async () => {
      const [, oldDelegate, newKey] = await ethers.getSigners();
      // v1: agent delegates to oldDelegate. v2: the root key rotates the set
      // to newKey (rotation decisions belong to the root — a delegate can only
      // sign manifests that still list it). v3 signed by the retired
      // oldDelegate must not extend the chain.
      const v1 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 1, [oldDelegate.address]));
      const v2 = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 2, [newKey.address]));
      const stale = await mf.signManifest(walletOf(oldDelegate.address), versioned(wallet.address, 3, [oldDelegate.address]));
      const res = await mf.resolveManifests([v1, v2, stale]);
      expect(res.current.version).to.equal(2);
      expect(res.errors[0]).to.include("not authorized");
      // …but the agent address anchors the identity forever — it is the
      // recovery path if a delegated key goes rogue.
      const recovery = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 3, [wallet.address]));
      const res2 = await mf.resolveManifests([v1, v2, recovery]);
      expect(res2.errors).to.have.length(0);
      expect(res2.current.version).to.equal(3);
    });

    it("manifestHash is stable and changes with content", async () => {
      const a = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 1));
      const b = await mf.signManifest(walletOf(wallet.address), versioned(wallet.address, 2));
      expect(mf.manifestHash(a)).to.match(/^0x[0-9a-f]{64}$/);
      expect(mf.manifestHash(a)).to.not.equal(mf.manifestHash(b));
      expect(mf.manifestHash(a)).to.equal(mf.manifestHash({ ...a, signature: "0x00" })); // sig-independent
    });
  });

  it("gate/manifests mirrors repo manifests/ — the deployed copy must not drift", () => {
    const fs = require("node:fs"), path = require("node:path");
    const read = (d) => Object.fromEntries(
      fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort()
        .map((f) => [f, fs.readFileSync(path.join(d, f), "utf8")]));
    expect(read("gate/manifests")).to.deep.equal(read("manifests"));
  });
});
