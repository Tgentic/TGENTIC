import { isAddress } from "viem";
import { createApp } from "./app.js";

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`Missing ${k} in .env (see .env.example).`); process.exit(1); } return env[k]; };

const payTo = need("PAY_TO");
if (!isAddress(payTo)) { console.error(`PAY_TO is not an address: ${payTo}`); process.exit(1); }
const amount = env.PRICE_ATOMIC ?? "10000";
if (!/^[1-9][0-9]*$/.test(amount)) { console.error("PRICE_ATOMIC must be a whole number of USDG atomic units (6 decimals)."); process.exit(1); }

const port = Number(env.PORT ?? 4021);
createApp({ payTo, facilitatorUrl: need("FACILITATOR_URL"), amount, gateUrl: env.GATE_URL }).listen(port, () => {
  console.log(`Paid agent on :${port}, GET /hash costs ${Number(amount) / 1e6} USDG, paid to ${payTo}.`);
});
