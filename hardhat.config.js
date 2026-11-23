require("@nomicfoundation/hardhat-toolbox");
try { process.loadEnvFile(); } catch {} // optional .env; holds one-off testnet keys

const env = process.env;
const networks = {};
customChains = [
  {
    network: "robinhoodMainnet",
    chainId: 4663,
    urls: { apiURL: "https://robinhoodchain.blockscout.com/api", browserURL: "https://robinhoodchain.blockscout.com" },
  },
];
if (env.DEPLOYER_PRIVATE_KEY) {
  networks.robinhoodTestnet = { url: env.TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com", chainId: 46630, accounts: [env.DEPLOYER_PRIVATE_KEY] };
  if (env.DEPLOYER_PRIVATE_KEY) {
    networks.robinhoodMainnet = { url: env.MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com", chainId: 4663, accounts: [env.DEPLOYER_PRIVATE_KEY] };
  }
}

module.exports = { solidity: { version: "0.8.24", settings: { evmVersion: "cancun" } }, networks, etherscan: { apiKey: { robinhoodMainnet: 'blockscout-no-key' }, customChains },
sourcify: { enabled: true } };
