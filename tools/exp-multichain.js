// EXP-B: cross-chain replay experiment (Step 5 groundwork — simulation only).
//
// Question: when TGENTIC runs on chain A AND chain B, does one payment
// produce a receipt on both? The contract's used[txHash] is per-instance,
// so the answer is almost certainly YES at contract level — the question is
// where the safeguard must live. This script demonstrates the property on a
// local hardhat network standing in for two chains.
//
// Run: npx hardhat run tools/exp-multichain.js
const { ethers } = require("hardhat");

async function main() {
  const [gate, agent, payer] = await ethers.getSigners();

  // "chain A" and "chain B": two independent deployments, same gate key
  const tokenA = await (await ethers.deployContract("MockToken", ["USDG", "USDG", 6, 0])).getAddress();
  const tokenB = await (await ethers.deployContract("MockToken", ["USDG", "USDG", 6, 0])).getAddress();
  const chainA = await ethers.deployContract("TGENTIC", [gate.address, tokenA, 500000n]);
  const chainB = await ethers.deployContract("TGENTIC", [gate.address, tokenB, 500000n]);
  const a = await chainA.getAddress(), b = await chainB.getAddress();

  // one payment, one txHash — the SAME bytes32 on both chains
  const txHash = ethers.keccak256(ethers.toUtf8Bytes("payment-on-chain-A"));
  const amount = 100000n, rating = 5;

  // gate tallies on chain A (payment settled there — legitimate)
  await chainA.connect(gate).tally(agent.address, payer.address, txHash, amount, rating);
  // naive multi-chain gate tallies the SAME txHash on chain B
  await chainB.connect(gate).tally(agent.address, payer.address, txHash, amount, rating);

  const [paidA, repA, rcA] = await Promise.all([chainA.paid(agent.address), chainA.reputation(agent.address), chainA.receipts(agent.address)]);
  const [paidB, repB, rcB] = await Promise.all([chainB.paid(agent.address), chainB.reputation(agent.address), chainB.receipts(agent.address)]);

  console.log("=== EXP-B result: one payment, two chains ===");
  console.log(`chain A: paid=${paidA} reputation=${repA} receipts=${rcA}`);
  console.log(`chain B: paid=${paidB} reputation=${repB} receipts=${rcB}`);
  console.log(`combined view: paid=${paidA + paidB} reputation=${repA + repB} (2x the real payment)`);
  console.log("");
  console.log("CONTRACT-LEVEL PROPERTY: used[txHash] is per-deployment — both accept.");
  console.log("This is CORRECT for chain-local boards. It becomes a vulnerability ONLY IF");
  console.log("the gate accepts a txHash settled on a different chain than the tally target.");
  console.log("Safeguard must live in the GATE: verify the payment tx ON the same chain");
  console.log("as the contract being tallied — or tag receipts with chainId (Step 8 trees).");
}
main().catch((e) => { console.error(e); process.exit(1); });
