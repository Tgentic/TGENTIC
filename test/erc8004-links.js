// Regression guard: every transaction hash published in the ERC-8004 map
// must be a full 32-byte hex string. A 63-char transcription typo once
// shipped a dead explorer link for agentId 26523 — this test makes that
// class of bug fail CI instead of reaching the public site.
const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

describe("erc8004 link integrity", function () {
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "src", "app", "erc8004.js"), "utf8");

  it("every 0x-hex literal is a valid address (40) or tx hash (64)", function () {
    const literals = src.match(/0x[0-9a-fA-F]+/g) || [];
    expect(literals.length).to.be.greaterThan(0);
    for (const lit of literals) {
      const len = lit.length - 2;
      expect([40, 64], `malformed hex literal ${lit}`).to.include(len);
    }
  });

  it("every agent entry has agentId, registerTx and feedbackTxs", function () {
    const ids = [...src.matchAll(/agentId:\s*(\d+)/g)].map((m) => Number(m[1]));
    const regs = [...src.matchAll(/registerTx:\s*"(0x[0-9a-fA-F]+)"/g)];
    const fbs = [...src.matchAll(/feedbackTxs:\s*\[([^\]]*)\]/g)];
    expect(ids.length).to.be.greaterThan(0);
    expect(regs.length).to.equal(ids.length);
    expect(fbs.length).to.equal(ids.length);
    for (const m of regs) expect(m[1]).to.match(/^0x[0-9a-fA-F]{64}$/);
    for (const m of fbs) {
      const hashes = m[1].match(/0x[0-9a-fA-F]+/g) || [];
      for (const h of hashes) expect(h).to.match(/^0x[0-9a-fA-F]{64}$/);
    }
  });
});
