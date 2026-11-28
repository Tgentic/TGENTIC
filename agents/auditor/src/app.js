// x402-paid audit endpoint on Robinhood Chain, settled in USDG.
// GET /report?agent=0x… costs PRICE_ATOMIC — the payment protocol is the
// official @x402/* packages; the work behind it is report.js.
import express from "express";
import { isAddress } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const ROBINHOOD_CHAIN = "eip155:4663";
export const USDG = { asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", extra: { name: "Global Dollar", version: "1" } };

/**
 * @param {object} o
 * @param {string} o.payTo           the auditor wallet receiving USDG — same key that signs reports
 * @param {string} o.facilitatorUrl  x402 facilitator URL
 * @param {(target:string)=>Promise<object>} o.buildReport  audit builder (injected so tests don't need a chain)
 * @param {string} [o.amount]        USDG atomic units; "10000" = 0.01 USDG
 * @param {string} [o.gateUrl]       TGENTIC gate — shown to the payer for the post-payment rating step
 */
export function createApp({ payTo, facilitatorUrl, buildReport, amount = "10000", network = ROBINHOOD_CHAIN, asset = USDG, gateUrl }) {
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(network, new ExactEvmScheme());
  const app = express();

  // Reject bad input BEFORE requesting payment — nobody pays for a request bound to fail.
  app.get("/report", (req, res, next) => {
    const agent = req.query.agent;
    if (typeof agent !== "string" || !isAddress(agent)) {
      return res.status(400).json({ error: "BAD_AGENT", message: "Send ?agent=0x… — a 20-byte hex address." });
    }
    next();
  });

  app.use(paymentMiddleware({
    "GET /report": {
      accepts: [{ scheme: "exact", price: { amount, asset: asset.asset, extra: asset.extra }, network, payTo }],
      description: "Signed agent-trust audit: on-chain score, receipt trail, manipulation heuristics and identity manifest — verified and attested by the auditor",
      mimeType: "application/json",
    },
  }, resourceServer));

  app.get("/report", async (req, res) => {
    const report = await buildReport(req.query.agent);
    res.json({
      ...report,
      tgentic: {
        gate: `${gateUrl.replace(/\/$/, "")}/tally`,
        next: "Take the transaction hash from the PAYMENT-RESPONSE header, sign the TGENTIC feedback message with the wallet that paid, and POST it to the gate — that is how this audit becomes a receipt.",
      },
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true, network, payTo, amount }));
  return app;
}
