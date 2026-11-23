// Full x402 flow test without real money: a mock facilitator and the official @x402/fetch client with a random wallet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { createApp, USDG, ROBINHOOD_CHAIN } from "../src/app.js";

const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const TX = `0x${"ab".repeat(32)}`;
const calls = { verify: [], settle: [] };
let fac, app, base;

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  // Mock facilitator following the x402 v2 spec (GET /supported, POST /verify, POST /settle).
  fac = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const payer = body.paymentPayload?.payload?.authorization?.from;
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/supported") return send({ kinds: [{ x402Version: 2, scheme: "exact", network: ROBINHOOD_CHAIN }], extensions: [], signers: { "eip155:*": ["0x1111111111111111111111111111111111111111"] } });
    if (req.url === "/verify") { calls.verify.push(body); return send({ isValid: true, payer }); }
    if (req.url === "/settle") { calls.settle.push(body); return send({ success: true, payer, transaction: TX, network: ROBINHOOD_CHAIN }); }
    res.writeHead(404); res.end();
  });
  const facUrl = await listen(fac);
  app = http.createServer(createApp({ payTo: PAY_TO, facilitatorUrl: facUrl, gateUrl: "https://gate.example" }));
  base = await listen(app);
});
after(() => { fac.close(); app.close(); });

test("without payment: 402 with the USDG terms on Robinhood Chain", async () => {
  const r = await fetch(`${base}/hash?text=hi`);
  assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
  assert.equal(req.x402Version, 2);
  const a = req.accepts[0];
  assert.equal(a.scheme, "exact");
  assert.equal(a.network, "eip155:4663");
  assert.equal(a.asset.toLowerCase(), USDG.asset.toLowerCase());
  assert.equal(a.amount, "10000");
  assert.equal(a.payTo, PAY_TO);
  assert.deepEqual({ name: a.extra.name, version: a.extra.version }, { name: "Global Dollar", version: "1" });
});

test("bad input is rejected before payment is requested", async () => {
  const r = await fetch(`${base}/hash?text=${"x".repeat(2001)}`);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "BAD_TEXT");
});

test("with payment: the official client signs, the facilitator settles, the result + PAYMENT-RESPONSE come back", async () => {
  const payer = privateKeyToAccount(generatePrivateKey());
  const payFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:*", client: new ExactEvmScheme(payer) }] });
  const r = await payFetch(`${base}/hash?text=hello`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.sha256, createHash("sha256").update("hello").digest("hex"));
  assert.equal(body.tgentic.gate, "https://gate.example/tally");

  const settled = decodePaymentResponseHeader(r.headers.get("payment-response"));
  assert.equal(settled.transaction, TX);
  assert.equal(calls.verify.length, 1);
  assert.equal(calls.settle.length, 1);

  // The EIP-3009 signature must be valid for the real USDG domain, or a live facilitator would reject it.
  const { authorization, signature } = calls.settle[0].paymentPayload.payload;
  assert.equal(authorization.to, PAY_TO);
  assert.equal(authorization.value, "10000");
  assert.equal(authorization.from, payer.address);
  const ok = await verifyTypedData({
    address: payer.address,
    domain: { name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: USDG.asset },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
    signature,
  });
  assert.equal(ok, true);
});
