// Privy (optional): active only when VITE_PRIVY_APP_ID is set in web/.env.
// Without it, the dapp falls back to the browser wallet (window.ethereum) as before.
import { defineChain } from "viem";
import { env } from "./env.js";

const APP_ID = env.VITE_PRIVY_APP_ID || "";
export const HAS_PRIVY = /^[a-z]{2}/.test(APP_ID) && APP_ID.length > 10;

export const privyChain = defineChain({
  id: Number(env.VITE_CHAIN_ID || 4663),
  name: env.VITE_CHAIN_NAME || "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: env.VITE_EXPLORER || "https://robinhoodchain.blockscout.com" } },
});

export const privyConfig = {
  embeddedWallets: { createOnLogin: "users-without-wallets", showWalletUIs: false },
  defaultChain: privyChain,
  appearance: { theme: "dark", accentColor: "#2b6cf6" },
};
