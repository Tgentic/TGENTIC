// Example x402 (v2) paid agent on Robinhood Chain, paid in USDG.
// The payment protocol is handled by the official @x402/* packages, not custom code.
import express from "express";
import { createHash } from "node:crypto";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const ROBINHOOD_CHAIN = "eip155:4663";
// USDG is not in the built-in x402 asset table yet, so it is declared here.
// name() on the contract = "Global Dollar"; version "1" matches the Naven x402 endpoint on this chain.
export const USDG = { asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", extra: { name: "Global Dollar", version: "1" } };
const MAX_TEXT = 2000;

/**
 * @param {object} o
 * @param {string} o.payTo        the agent wallet that receives payments
 * @param {string} o.facilitatorUrl x402 facilitator URL (e.g. from Naven)
 * @param {string} [o.amount]     price in USDG atomic units (6 decimals); "10000" = 0.01 USDG
 * @param {string} [o.gateUrl]    TGENTIC gate URL for the post-payment rating step
 */
export function createApp({ payTo, facilitatorUrl, amount = "10000", network = ROBINHOOD_CHAIN, asset = USDG, gateUrl }) {
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(network, new ExactEvmScheme());
  const app = express();

  // Reject bad input BEFORE requesting payment, so nobody pays for a request that is bound to fail.
  app.get("/hash", (req, res, next) => {
    const text = req.query.text;
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT) {
      return res.status(400).json({ error: "BAD_TEXT", message: `Send ?text= with 1 to ${MAX_TEXT} characters.` });
    }
    next();
  });

  app.use(paymentMiddleware({
    "GET /hash": {
      accepts: [{ scheme: "exact", price: { amount, asset: asset.asset, extra: asset.extra }, network, payTo }],
      description: "SHA-256 of a text: a sample paid agent job",
      mimeType: "application/json",
    },
  }, resourceServer));

  app.get("/hash", (req, res) => {
    res.json({
      sha256: createHash("sha256").update(req.query.text).digest("hex"),
      ...(gateUrl && {
        tgentic: {
          gate: `${gateUrl.replace(/\/$/, "")}/tally`,
          next: "Take the transaction hash from the PAYMENT-RESPONSE header, sign the TGENTIC feedback message with the wallet that paid, and POST it to the gate.",
        },
      }),
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true, network, payTo, amount }));
  return app;
}
