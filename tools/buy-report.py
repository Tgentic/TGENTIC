#!/usr/bin/env python3
"""TGENTIC audit buyer — the full x402 loop in Python.

Fetch the 402 offer (priced by YOUR reputation), sign an EIP-3009
TransferWithAuthorization, pay, then verify the auditor's signature on the
report locally — the trust check never trusts the server.

Usage:
  python3 tools/buy-report.py <agent-address> --key 0xPAYER_KEY
  python3 tools/buy-report.py <agent> --key $DEPLOYER_PRIVATE_KEY --html --out report.html
  python3 tools/buy-report.py <agent> --key 0x... --gate http://localhost:8080

Deps: pip install eth-account requests
Exit 0 = paid + verified (JSON) or paid + saved (HTML); 1 = flow failure; 2 = usage.
"""

import argparse
import base64
import json
import sys

import requests
from eth_account import Account

from tgentic_spec import (
    CHAIN_ID,
    GATE,
    USDG,
    eip3009_message,
    payment_payload,
    recover_report_signer,
)


def b64(s):
    return base64.b64encode(s.encode()).decode()


def main():
    p = argparse.ArgumentParser(description="Buy a signed TGENTIC audit over x402.")
    p.add_argument("agent", help="agent address to audit (0x…)")
    p.add_argument("--key", required=True, help="payer private key (0x…) — signs, never leaves this process")
    p.add_argument("--gate", default=GATE, help=f"gate base url (default {GATE})")
    p.add_argument("--out", help="write the report to this file (default: audit-report-<agent>.json|html)")
    p.add_argument("--html", action="store_true", help="request the HTML certificate instead of JSON")
    args = p.parse_args()

    agent = args.agent.lower()
    if not (agent.startswith("0x") and len(agent) == 42):
        p.error("agent must be a 0x-prefixed 20-byte address")
    acct = Account.from_key(args.key)
    payer = acct.address
    gate = args.gate.rstrip("/")

    # 1. the offer — buyer-priced: the gate recomputes our reputation discount
    offer_url = f"{gate}/audit/report?agent={agent}&buyer={payer}"
    res = requests.get(offer_url, timeout=20)
    if res.status_code != 402 or res.json().get("x402Version") != 2:
        sys.exit(f"expected a 402 offer, got {res.status_code}: {res.text[:300]}")
    req = res.json()["accepts"][0]
    print(f"offer <- {offer_url}")
    print(f"  {req['amount']} atomic {req['asset']} -> {req['payTo']} (scheme {req['scheme']}, {req['network']})")

    # 2. sign the EIP-3009 authorization under the USDG domain
    full, nonce = eip3009_message(req, payer)
    signature = acct.sign_typed_data(full_message=full).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    print(f"paying with {payer[:10]}…{payer[-4:]}")

    # 3. pay — the gate verifies the signature then settles on-chain itself
    fmt = "&format=html" if args.html else ""
    res = requests.get(
        f"{gate}/audit/report?agent={agent}{fmt}",
        headers={
            "accept": "text/html" if args.html else "application/json",
            "payment-signature": b64(json.dumps(payment_payload(req, payer, signature, nonce, full["message"]))),
        },
        timeout=30,
    )
    settle = res.headers.get("payment-response")
    if settle:
        settle = json.loads(base64.b64decode(settle))
    if res.status_code != 200:
        try:
            err = res.json()
        except ValueError:
            err = {"error": res.text[:300]}
        sys.exit(f"payment rejected ({res.status_code}): {err.get('error') or err.get('reason') or err}")

    out = args.out or f"audit-report-{agent}.{'html' if args.html else 'json'}"
    if args.html:
        html = res.text
        with open(out, "w") as f:
            f.write(html)
        print(f"settled: {settle.get('transaction') if settle else '(no payment-response header)'}")
        print(f"saved -> {out} (open in a browser — verification instructions inside)")
        return 0

    report = res.json()
    signer = recover_report_signer(report)
    auditor = report.get("auditor", {}).get("agent", "")
    ok = signer.lower() == auditor.lower()
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"settled: {settle.get('transaction') if settle else '(no payment-response header)'}")
    print(f"signature: {'OK' if ok else 'MISMATCH'} — recovers {signer} (auditor {auditor})")
    print(f"saved -> {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
