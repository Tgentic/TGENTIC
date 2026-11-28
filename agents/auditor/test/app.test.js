// Auditor x402 flow without real money: mock facilitator, official client,
// and an injected buildReport so no chain is needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { createApp, USDG, ROBINHOOD_CHAIN } from "../src/app.js";

const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const SUBJECT = "0x22b45314537662e3105692756e7ce69ee6ade375";
const TX = `0x${"cd".repeat(32)}`;
let fac, app, base;
const calls = { verify: [], settle: [] };

const fakeReport = async (agent) => ({
  type: "tgentic/audit-report/1",
  auditor: { name: "TGENTIC auditor", agent: PAY_TO },
  subject: { agent, manifest: null },
  financials: { score: "0", reputation: "0", receipts: "0", payers: "0", bond: "0", counted: false },
  risk: { flagged: false, flags: [], topPayerShareBps: 0, topAmount: "0", intervalCount: 0 },
  summary: "No paid work is recorded.",
  issuedAt: "2026-01-01T00:00:00.000Z",
  signature: `0x${"11".repeat(65)}`,
});

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
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
  app = http.createServer(createApp({ payTo: PAY_TO, facilitatorUrl: facUrl, buildReport: fakeReport, gateUrl: "https://gate.example" }));
  base = await listen(app);
});
after(() => { fac.close(); app.close(); });

test("without payment: 402 with USDG terms and the audit description", async () => {
  const r = await fetch(`${base}/report?agent=${SUBJECT}`);
  assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
  const a = req.accepts[0];
  assert.equal(a.network, "eip155:4663");
  assert.equal(a.asset.toLowerCase(), USDG.asset.toLowerCase());
  assert.equal(a.amount, "10000");
  assert.equal(a.payTo, PAY_TO);
});

test("bad agent is rejected before payment is requested", async () => {
  const r = await fetch(`${base}/report?agent=not-an-address`);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "BAD_AGENT");
});

test("with payment: signed report + tally hint come back", async () => {
  const payer = privateKeyToAccount(generatePrivateKey());
  const payFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:*", client: new ExactEvmScheme(payer) }] });
  const r = await payFetch(`${base}/report?agent=${SUBJECT}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.type, "tgentic/audit-report/1");
  assert.equal(body.subject.agent, SUBJECT);
  assert.match(body.signature, /^0x[0-9a-f]+$/);
  assert.equal(body.tgentic.gate, "https://gate.example/tally");

  const settled = decodePaymentResponseHeader(r.headers.get("payment-response"));
  assert.equal(settled.transaction, TX);
  const { authorization } = calls.settle[0].paymentPayload.payload;
  assert.equal(authorization.to, PAY_TO);
  assert.equal(authorization.value, "10000");
});
