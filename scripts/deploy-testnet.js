// Usage: npx hardhat run scripts/deploy-testnet.js --network robinhoodTestnet
// Deploys test tokens (tTGEN, tUSDG) + TGENTIC to the Robinhood Chain testnet, hands out gas and tokens,
// then writes the addresses to deployments/46630.json, web/.env, and gate/.env.
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const GAS_EACH = ethers.parseEther("0.002");   // for GATE, FACILITATOR, PAYER, AGENT
const MIN_BOND = ethers.parseUnits("100", 18);  // 100 tTGEN

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 46630n) throw new Error(`Expected chain 46630, got ${chainId}`);
  const out = path.join(__dirname, "..", "deployments", "46630.json");
  if (fs.existsSync(out) && process.env.FORCE !== "1") throw new Error(`${out} already exists. Set FORCE=1 to deploy again.`);

  const env = process.env;
  const addr = (k) => new ethers.Wallet(env[`${k}_PRIVATE_KEY`]).address;
  const [deployer] = await ethers.getSigners();
  const roles = { gate: addr("GATE"), facilitator: addr("FACILITATOR"), payer: addr("PAYER"), agent: addr("AGENT") };

  const bal = await ethers.provider.getBalance(deployer.address);
  const need = GAS_EACH * 4n + ethers.parseEther("0.005");
  console.log(`deployer ${deployer.address}, balance ${ethers.formatEther(bal)} ETH`);
  if (bal < need) throw new Error(`Fund the deployer with at least ${ethers.formatEther(need)} testnet ETH from https://faucet.testnet.chain.robinhood.com`);

  const tally = await ethers.deployContract("MockToken", ["Test Tally", "tTGEN", 18, 0]);
  await tally.waitForDeployment();
  const usdg = await ethers.deployContract("MockToken", ["Test USDG", "tUSDG", 6, 0]);
  await usdg.waitForDeployment();
  const tm = await ethers.deployContract("TGENTIC", [roles.gate, await tally.getAddress(), MIN_BOND]);
  const tmReceipt = await (await tm.waitForDeployment()).deploymentTransaction().wait();
  console.log(`tTGEN ${await tally.getAddress()}\ntUSDG  ${await usdg.getAddress()}\nTGENTIC ${await tm.getAddress()} (block ${tmReceipt.blockNumber})`);

  for (const [role, to] of Object.entries(roles)) {
    await (await deployer.sendTransaction({ to, value: GAS_EACH })).wait();
    console.log(`gas -> ${role} ${to}`);
  }
  await (await usdg.transfer(roles.payer, ethers.parseUnits("1000", 6))).wait();
  await (await tally.transfer(roles.agent, ethers.parseUnits("500", 18))).wait();
  console.log("1000 tUSDG -> payer, 500 tTGEN -> agent");

  const d = {
    chainId: 46630, rpc: network.config.url, deployBlock: tmReceipt.blockNumber,
    tgentic: await tm.getAddress(), bondToken: await tally.getAddress(), usdg: await usdg.getAddress(),
    minBond: MIN_BOND.toString(), deployer: deployer.address, ...roles,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(d, null, 2));

  const root = path.join(__dirname, "..");
  fs.writeFileSync(path.join(root, "web", ".env"), [
    "# Written by scripts/deploy-testnet.js",
    `VITE_TGENTIC_ADDRESS=${d.tgentic}`, `VITE_DEPLOY_BLOCK=${d.deployBlock}`,
    "VITE_CHAIN_ID=46630", "VITE_CHAIN_NAME=Robinhood Chain Testnet", `VITE_RPC_URL=${d.rpc}`,
    "VITE_EXPLORER=https://explorer.testnet.chain.robinhood.com", "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "gate", ".env"), [
    "# Written by scripts/deploy-testnet.js (testnet, test tokens and facilitator)",
    `GATE_PRIVATE_KEY=${env.GATE_PRIVATE_KEY}`, `TGENTIC_ADDRESS=${d.tgentic}`, `FACILITATORS=${d.facilitator}`,
    "CHAIN_ID=46630", `RPC_URL=${d.rpc}`, `USDG_ADDRESS=${d.usdg}`, "MIN_CONFIRMATIONS=1", "PORT=8788",
    "ALLOWED_ORIGIN=http://localhost:5173", "",
  ].join("\n"), { mode: 0o600 });
  console.log(`Wrote ${out}, web/.env, gate/.env`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
