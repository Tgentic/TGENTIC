#!/usr/bin/env python3
"""TGENTIC receipt tallier — rate a payment you made, on-chain.

Signs the payer's feedback message (TGENTIC feedback / chain / agent / tx /
rating) and posts it to the gate, which verifies the tx settled through a
whitelisted facilitator and records the receipt on the reputation contract.

Usage:
  python3 tools/tally.py <agent-address> <tx-hash> --rating 5 --key 0xPAYER_KEY
  python3 tools/tally.py 0x4faa… 0x31dc… --rating 4 --key $DEPLOYER_PRIVATE_KEY

The key must belong to the PAYER in that transaction — the signature is what
makes the receipt attributable. Rating 1-5.
Deps: pip install eth-account requests. Exit 0 = tallied; 1 = rejected; 2 = usage.
"""

import argparse
import sys

import requests
from eth_account import Account

from tgentic_spec import CHAIN_ID, EXPLORER, GATE, sign_feedback


def main():
    p = argparse.ArgumentParser(description="Tally a payment receipt on TGENTIC.")
    p.add_argument("agent", help="agent that was paid (0x…)")
    p.add_argument("tx", help="the settlement transaction hash (0x…, 32 bytes)")
    p.add_argument("--rating", type=int, required=True, help="1-5")
    p.add_argument("--key", required=True, help="payer private key — must match the tx's payer")
    p.add_argument("--gate", default=GATE)
    args = p.parse_args()

    if not (args.agent.startswith("0x") and len(args.agent) == 42):
        p.error("agent must be a 0x-prefixed 20-byte address")
    if not (args.tx.startswith("0x") and len(args.tx) == 66):
        p.error("tx must be a 0x-prefixed 32-byte hash")
    if not 1 <= args.rating <= 5:
        p.error("rating must be 1-5")

    payer = Account.from_key(args.key).address
    signature = sign_feedback(args.key, CHAIN_ID, args.agent, args.tx, args.rating)
    print(f"signing as payer {payer[:10]}…{payer[-4:]} — rating {args.rating}/5")

    res = requests.post(
        f"{args.gate.rstrip('/')}/tally",
        json={"agent": args.agent, "txHash": args.tx, "rating": args.rating, "signature": signature},
        timeout=30,
    )
    body = res.json()
    if res.status_code != 200:
        sys.exit(f"rejected ({res.status_code}): {body.get('error')} — {body.get('message', '')}")
    print(f"tallied: {EXPLORER}/tx/{body['tallyTx']}")
    print(f"  agent {body['agent']}  amount {body['amount']}  rating {body['rating']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
