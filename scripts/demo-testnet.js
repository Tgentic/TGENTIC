// Usage (the gate must be running: cd gate && npm start):
//   npx hardhat run scripts/demo-testnet.js --network robinhoodTestnet
// Full flow on a real chain: the agent deposits a bond, the payer pays tUSDG through the test facilitator,
// the payer signs a rating, the gate records the tally, then the score is read from the contract.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

async function main() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "46630.json"), "utf8"));
  const gateUrl = process.env.GATE_URL || "http://localhost:8788";
  const w = (k) => new ethers.Wallet(process.env[`${k}_PRIVATE_KEY`], ethers.provider);
  const agent = w("AGENT"), payer = w("PAYER"), facil = w("FACILITATOR");
  const tally = await ethers.getContractAt("MockToken", d.bondToken);
  const usdg = await ethers.getContractAt("MockToken", d.usdg);
  const tm = await ethers.getContractAt("TGENTIC", d.tgentic);

  if ((await tm.bond(agent.address)) < BigInt(d.minBond)) {
    await (await tally.connect(agent).approve(d.tgentic, ethers.parseUnits("200", 18))).wait();
    await (await tm.connect(agent).deposit(ethers.parseUnits("200", 18))).wait();
    console.log("agent bond: 200 tTGEN");
  }

  const amount = ethers.parseUnits("25", 6);
  await (await usdg.connect(payer).approve(facil.address, amount)).wait();
  const pay = await (await usdg.connect(facil).transferFrom(payer.address, agent.address, amount)).wait();
  console.log(`payment 25 tUSDG, tx ${pay.hash}`);

  const rating = 5;
  const message = `TGENTIC feedback\nchain: 46630\nagent: ${ethers.getAddress(agent.address)}\ntx: ${pay.hash.toLowerCase()}\nrating: ${rating}`;
  const signature = await payer.signMessage(message);
  const res = await fetch(`${gateUrl}/tally`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: agent.address, txHash: pay.hash, rating, signature }) });
  console.log(`gate ${res.status}`, await res.json());

  console.log(`score ${ethers.formatUnits(await tm.score(agent.address), 6)}, receipts ${await tm.receipts(agent.address)}, payers ${await tm.payers(agent.address)}`);
  console.log(`agent address for the dapp: ${agent.address}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
