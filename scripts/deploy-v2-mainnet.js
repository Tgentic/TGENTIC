// Deploys the v2 line (Receipts + Policy — roadmap Step 2) to Robinhood Chain MAINNET (4663):
//   npx hardhat run scripts/deploy-v2-mainnet.js --network robinhoodMainnet
//   (or --network localhost for a dry run on a local node)
//
// Verifier set: the GATE, FACILITATOR and PAYER addresses from .env, threshold 2-of-3.
// The v1 deployment is untouched — this is a parallel line, written to deployments/<chainId>-v2.json.
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const BOND_TOKEN = process.env.BOND_TOKEN || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // USDG mainnet
const MIN_BOND = BigInt(process.env.MIN_BOND_RAW || "500000"); // 0.5 USDG, matching v1

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const isLocal = chainId === 31337n;
  if (!isLocal && chainId !== 4663n) throw new Error(`Expected chain 4663 (mainnet) or 31337 (local), got ${chainId}`);

  const env = process.env;
  for (const k of ["GATE", "FACILITATOR", "PAYER"]) {
    if (!env[`${k}_PRIVATE_KEY`]) throw new Error(`Missing ${k}_PRIVATE_KEY in .env (see .env.example).`);
  }
  const addr = (k) => new ethers.Wallet(env[`${k}_PRIVATE_KEY`]).address;
  const verifiers = [addr("GATE"), addr("FACILITATOR"), addr("PAYER")];
  const threshold = 2;

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer ${deployer.address}, balance ${ethers.formatEther(bal)} ETH`);
  console.log(`verifier set (2-of-3): ${verifiers.join(", ")}`);
  if (bal === 0n) throw new Error("Deployer is empty. Fund it with gas on Robinhood Chain mainnet first.");

  const receipts = await ethers.deployContract("Receipts", [BOND_TOKEN, MIN_BOND]);
  await receipts.waitForDeployment();
  const policy = await ethers.deployContract("Policy", [await receipts.getAddress(), verifiers, threshold]);
  await policy.waitForDeployment();
  const wire = await (await receipts.setPolicy(await policy.getAddress())).wait();

  // Verify the wiring on chain before writing anything.
  const policyAddr = await policy.getAddress();
  const receiptsAddr = await receipts.getAddress();
  if ((await policy.threshold()) !== 2n) throw new Error("Threshold verification failed");
  if ((await receipts.policy()) !== policyAddr) throw new Error("Policy wiring verification failed");
  for (const v of verifiers) if (!(await policy.isVerifier(v))) throw new Error(`Verifier check failed: ${v}`);

  const d = {
    chainId: Number(chainId), line: "v2", rpc: network.config.url,
    receipts: receiptsAddr, policy: policyAddr,
    bondToken: BOND_TOKEN, minBond: MIN_BOND.toString(),
    verifiers, threshold, deployer: deployer.address,
    deployTxs: { receipts: receipts.deploymentTransaction().hash, policy: policy.deploymentTransaction().hash, wire: wire.hash },
  };
  const out = path.join(__dirname, "..", "deployments", `${d.chainId}-v2.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(d, null, 2));
  console.log(`Receipts ${receiptsAddr}`);
  console.log(`Policy ${policyAddr} (2-of-3, wired at ${wire.hash})`);
  console.log(`Wrote ${out}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
