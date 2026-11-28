// One-off v1 -> v2 cutover for Robinhood Chain MAINNET (4663).
//   DRY_RUN=1 npx hardhat run scripts/cutover-v2-mainnet.js --network robinhoodMainnet
//   npx hardhat run scripts/cutover-v2-mainnet.js --network robinhoodMainnet
//
// What it does, in order:
//   1. Replays every v1 `Tallied` event that is not already recorded in v2
//      through Policy.submitTally (2-of-3 verifier signatures, sorted ascending).
//   2. Tops up each agent's USDG balance (from the deployer) where needed and has
//      every agent approve + deposit exactly minBond into the v2 Receipts contract.
//   3. Verifies per-agent parity (receipts, reputation, bond) between v1 and v2.
//
// It does NOT switch readers (dapp/gate/SDKs) — that is a separate deploy step.
// Keys come from .env (DEPLOYER/GATE/FACILITATOR/AGENT) and _bootstrap-keys.json
// (the six bootstrap agent EOAs). Nothing secret is written to disk.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const DRY_RUN = process.env.DRY_RUN === "1";
const CHUNK = 8_000_000n; // under the public RPC's ~10M-block getLogs cap

const v1dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "4663.json"), "utf8"));
const v2dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "4663-v2.json"), "utf8"));

const TALLIED_TOPIC = ethers.id("Tallied(address,address,bytes32,uint256,uint8)");
const MIN_BOND = BigInt(v2dep.minBond);
const TOPUP_BUFFER = 20_000n; // 0.02 USDG headroom so approve+deposit never dust-fails

async function getLogsChunked(filter, fromBlock, toBlock) {
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
    const logs = await ethers.provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
    out.push(...logs);
    if (end === toBlock) break;
  }
  return out;
}

function decodeTallied(log) {
  return {
    agent: ethers.getAddress("0x" + log.topics[1].slice(26)),
    payer: ethers.getAddress("0x" + log.topics[2].slice(26)),
    txHash: log.topics[3],
    amount: BigInt(log.data.slice(0, 66)),
    rating: Number(BigInt("0x" + log.data.slice(66, 130))),
    block: log.blockNumber,
  };
}

// Sign `digest` (bytes32) with each wallet and return sigs sorted by recovered signer,
// exactly what Policy._check expects.
async function sortedSigs(digest, wallets) {
  const bytes = ethers.getBytes(digest);
  const pairs = await Promise.all(wallets.map(async (w) => {
    const sig = await w.signMessage(bytes);
    return { sig, addr: ethers.verifyMessage(bytes, sig) };
  }));
  pairs.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
  return { sigs: pairs.map((p) => p.sig), signers: pairs.map((p) => p.addr) };
}

async function sendOrSim(contract, method, args, label, simulate) {
  if (DRY_RUN) {
    if (simulate) {
      await contract[method].staticCall(...args);
      console.log(`  [dry] ${label}: simulated OK`);
    } else {
      console.log(`  [dry] ${label}: would send`);
    }
    return null;
  }
  const tx = await contract[method](...args);
  console.log(`  ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`    confirmed block ${rc.blockNumber}, gas ${rc.gasUsed}`);
  return rc;
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 4663n) throw new Error(`Expected mainnet 4663, got ${chainId}`);
  if (DRY_RUN) console.log("=== DRY RUN — no transactions will be sent ===\n");

  const [deployer] = await ethers.getSigners();
  const env = process.env;
  for (const k of ["DEPLOYER_PRIVATE_KEY", "GATE_PRIVATE_KEY", "FACILITATOR_PRIVATE_KEY", "AGENT_PRIVATE_KEY"]) {
    if (!env[k]) throw new Error(`Missing ${k} in .env`);
  }

  const receipts = await ethers.getContractAt("Receipts", v2dep.receipts);
  const policy = await ethers.getContractAt("Policy", v2dep.policy);
  const usdg = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"],
    v1dep.bondToken
  );

  const latest = await ethers.provider.getBlockNumber();
  console.log(`latest block ${latest}\n`);

  // ---------- Phase 1: replay v1 tallies into v2 ----------
  console.log("Phase 1: tally replay");
  const v1Logs = await getLogsChunked(
    { address: v1dep.tgentic, topics: [TALLIED_TOPIC] },
    BigInt(v1dep.deployBlock), BigInt(latest)
  );
  const v1Tallies = v1Logs.map(decodeTallied);
  console.log(`  v1 Tallied events: ${v1Tallies.length}`);

  const pending = [];
  for (const t of v1Tallies) {
    if (await receipts.used(t.txHash)) {
      console.log(`  skip (already in v2): agent ${t.agent} tx ${t.txHash.slice(0, 12)}…`);
      continue;
    }
    pending.push(t);
  }
  console.log(`  to replay: ${pending.length}\n`);

  const gateW = new ethers.Wallet(env.GATE_PRIVATE_KEY, ethers.provider);
  const facW = new ethers.Wallet(env.FACILITATOR_PRIVATE_KEY, ethers.provider);
  const signers = [gateW, facW]; // 2-of-3 threshold

  for (const t of pending) {
    const digest = await policy.tallyDigest(t.agent, t.payer, t.txHash, t.amount, t.rating);
    const { sigs, signers: recovered } = await sortedSigs(digest, signers);
    const isVer = await Promise.all(recovered.map((a) => policy.isVerifier(a)));
    if (!isVer.every(Boolean)) throw new Error(`Recovered non-verifier signer for ${t.txHash}`);
    console.log(`  replay agent ${t.agent} payer ${t.payer} amount ${t.amount} rating ${t.rating}`);
    console.log(`    signers ${recovered.join(", ")} (sorted)`);
    await sendOrSim(policy, "submitTally", [t.agent, t.payer, t.txHash, t.amount, t.rating, sigs],
      `submitTally ${t.txHash.slice(0, 14)}…`, true);
  }

  // ---------- Phase 2: agent bonds into v2 ----------
  console.log("\nPhase 2: agent bonds");
  const keyFile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "_bootstrap-keys.json"), "utf8"));
  const agentEntries = [
    { address: new ethers.Wallet(env.AGENT_PRIVATE_KEY).address, key: env.AGENT_PRIVATE_KEY, label: "existing" },
    ...keyFile.agents.map((a) => ({ address: a.address, key: a.key, label: "bootstrap" })),
  ];

  for (const ag of agentEntries) {
    const agent = new ethers.Wallet(ag.key.startsWith("0x") ? ag.key : "0x" + ag.key, ethers.provider);
    const addr = agent.address;
    if (addr.toLowerCase() !== ag.address.toLowerCase()) throw new Error(`Key/address mismatch for ${ag.label} agent`);

    const [v2bond, v2receiptsCnt, bal, allowance, eth] = await Promise.all([
      receipts.bond(addr), receipts.receipts(addr), usdg.balanceOf(addr),
      usdg.allowance(addr, v2dep.receipts), ethers.provider.getBalance(addr),
    ]);
    console.log(`  ${ag.label} ${addr}: v2bond ${v2bond} bal ${bal} allow ${allowance} ETH ${ethers.formatEther(eth)}`);
    if (v2bond >= MIN_BOND) { console.log("    already bonded, skip"); continue; }

    if (bal < MIN_BOND) {
      const topup = MIN_BOND - bal + TOPUP_BUFFER;
      const depUsdg = await usdg.balanceOf(deployer.address);
      if (depUsdg < topup) throw new Error(`Deployer USDG ${depUsdg} < needed topup ${topup}`);
      console.log(`    topup ${topup} USDG-units from deployer`);
      if (!DRY_RUN) {
        const tx = await usdg.transfer(addr, topup);
        console.log(`    transfer: ${tx.hash}`);
        await tx.wait();
      } else {
        console.log("    [dry] usdg.transfer simulated (skipped send)");
      }
    }

    if (allowance < MIN_BOND) {
      console.log(`    approve ${MIN_BOND} to Receipts`);
      await sendOrSim(usdg.connect(agent), "approve", [v2dep.receipts, MIN_BOND], `approve ${addr.slice(0, 10)}…`, false);
    }
    console.log(`    deposit ${MIN_BOND}`);
    await sendOrSim(receipts.connect(agent), "deposit", [MIN_BOND], `deposit ${addr.slice(0, 10)}…`, false);
  }

  // ---------- Phase 3: parity verification ----------
  console.log("\nPhase 3: v1 vs v2 parity");
  const v1 = await ethers.getContractAt("TGENTIC", v1dep.tgentic);
  let ok = true;
  const seen = new Set();
  for (const t of v1Tallies) seen.add(t.agent.toLowerCase());
  for (const agentAddr of seen) {
    const [r1, r2, rc1, rc2, b1, b2] = await Promise.all([
      v1.reputation(agentAddr), receipts.reputation(agentAddr),
      v1.receipts(agentAddr), receipts.receipts(agentAddr),
      v1.bond(agentAddr), receipts.bond(agentAddr),
    ]);
    const match = r1 === r2 && rc1 === rc2;
    if (!match) ok = false;
    console.log(`  ${agentAddr}: rep ${r1}/${r2} receipts ${rc1}/${rc2} bond ${b1}/${b2} ${match ? "OK" : "MISMATCH"}`);
  }
  const v2Count = v1Tallies.length; // every v1 tally must now exist in v2
  let usedCount = 0;
  for (const t of v1Tallies) if (await receipts.used(t.txHash)) usedCount++;
  console.log(`  v2 used[] coverage: ${usedCount}/${v2Count} v1 tallies`);
  if (usedCount !== v2Count) ok = false;
  console.log(ok ? "\nPARITY OK" : "\nPARITY FAILED — investigate before reader cutover");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
