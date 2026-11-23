// Deploys to Robinhood Chain MAINNET (4663):
//   npx hardhat run scripts/deploy-mainnet.js --network robinhoodMainnet
//
// REQUIRED before running:
//   1. Fund the deployer (.env: DEPLOYER_PRIVATE_KEY) with real gas on Robinhood Chain mainnet.
//   2. The default bond token = mainnet USDG (0x5fc5...d168). Override via the BOND_TOKEN / MIN_BOND env vars if needed.
//
// The script writes: deployments/4663.json, web/.env (mainnet), gate/.env (mainnet).
// It does NOT touch any other project's .env.
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const MIN_BOND = BigInt(process.env.MIN_BOND_RAW || ethers.parseUnits("100", 18).toString());
const BOND_TOKEN = process.env.BOND_TOKEN || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // USDG mainnet

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 4663n) throw new Error(`Expected chain 4663 (mainnet), got ${chainId}`);
  const out = path.join(__dirname, "..", "deployments", "4663.json");
  if (fs.existsSync(out) && process.env.FORCE !== "1") throw new Error(`${out} already exists. Set FORCE=1 to redeploy.`);

  const env = process.env;
  const addr = (k) => new ethers.Wallet(env[`${k}_PRIVATE_KEY`]).address;
  const roles = { gate: addr("GATE"), facilitator: addr("FACILITATOR"), payer: addr("PAYER"), agent: addr("AGENT") };

  const bal = await ethers.provider.getBalance((await ethers.getSigners())[0].address);
  console.log(`deployer ${(await ethers.getSigners())[0].address}, balance ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) throw new Error("Deployer is empty. Fund it with real gas on Robinhood Chain mainnet first.");

  const tm = await ethers.deployContract("TGENTIC", [roles.gate, BOND_TOKEN, MIN_BOND]);
  const receipt = await (await tm.waitForDeployment()).deploymentTransaction().wait();
  console.log(`TGENTIC ${await tm.getAddress()} (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);

  const d = {
    chainId: 4663, rpc: network.config.url, deployBlock: receipt.blockNumber,
    tgentic: await tm.getAddress(), bondToken: BOND_TOKEN, minBond: MIN_BOND.toString(),
    deployer: (await ethers.getSigners())[0].address, ...roles,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(d, null, 2));

  // Preserve VITE_PRIVY_APP_ID if it already exists in web/.env.
  const webEnvPath = path.join(__dirname, "..", "web", ".env");
  const prevPrivy = fs.existsSync(webEnvPath)
    ? (fs.readFileSync(webEnvPath, "utf8").match(/^VITE_PRIVY_APP_ID=(.*)$/m)?.[1] ?? "")
    : "";
  fs.writeFileSync(webEnvPath, [
    "# Written by scripts/deploy-mainnet.js",
    `VITE_TGENTIC_ADDRESS=${d.tgentic}`, `VITE_DEPLOY_BLOCK=${d.deployBlock}`,
    "VITE_CHAIN_ID=4663", "VITE_CHAIN_NAME=Robinhood Chain", `VITE_RPC_URL=${d.rpc}`,
    "VITE_EXPLORER=https://robinhoodchain.blockscout.com",
    `VITE_PRIVY_APP_ID=${env.VITE_PRIVY_APP_ID || prevPrivy}`, "",
  ].join("\n"));
  fs.writeFileSync(path.join(__dirname, "..", "gate", ".env"), [
    "# Written by scripts/deploy-mainnet.js (mainnet, real USDG)",
    `GATE_PRIVATE_KEY=${env.GATE_PRIVATE_KEY}`, `TGENTIC_ADDRESS=${d.tgentic}`, `FACILITATORS=${env.FACILITATORS || "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f"}`,
    "CHAIN_ID=4663", `RPC_URL=${d.rpc}`, `USDG_ADDRESS=${process.env.USDG_ADDRESS || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"}`,
    "MIN_CONFIRMATIONS=3", "PORT=8788", "ALLOWED_ORIGIN=https://tgentic.xyz", "",
  ].join("\n"), { mode: 0o600 });
  console.log(`Wrote ${out}, web/.env, gate/.env`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
