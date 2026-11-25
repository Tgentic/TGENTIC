#!/usr/bin/env python3
"""TGENTIC receipt watcher — realtime monitor for Tallied events on mainnet.

Polls the tally contract for new Tallied receipts and prints each one as it
lands. Payers not listed as known team wallets are flagged EXTERNAL — that is
the moment the first non-team receipt hits the board, which the dapp picks up
on its next poll automatically.

Usage:
  python3 tools/watch-receipts.py                    # watch, 15s interval
  python3 tools/watch-receipts.py --interval 5       # faster polling
  python3 tools/watch-receipts.py --once             # single scan, then exit
  python3 tools/watch-receipts.py --known 0xabc,0xdef
  TGENTIC_KNOWN_PAYERS=0xabc,0xdef python3 tools/watch-receipts.py

Exit code 0 = clean run/interrupt, 2 = usage error.
Stdlib only. Uses urllib, falling back to curl when the edge blocks it.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

# Tallied(address indexed agent, address indexed payer, bytes32 indexed txHash,
#        uint256 amount, uint8 rating) — topic verified against mainnet logs.
TALLIED_TOPIC = "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e"
CONTRACT = "0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8"
DEPLOY_BLOCK = 118987578
EXPLORER = "https://robinhoodchain.blockscout.com"
DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com"
USDG_DECIMALS = 6


def rpc_call(rpc, method, params):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    try:
        req = urllib.request.Request(rpc, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            out = r.read()
    except Exception:
        out = subprocess.run(
            ["curl", "-s", "-X", "POST", rpc, "-H", "Content-Type: application/json", "-d", payload],
            capture_output=True, timeout=30).stdout
    res = json.loads(out)
    if "error" in res:
        raise RuntimeError(f"RPC error: {res['error']}")
    return res["result"]


def scan(rpc, contract, from_block):
    logs = rpc_call(rpc, "eth_getLogs", [{
        "address": contract,
        "topics": [TALLIED_TOPIC],
        "fromBlock": hex(from_block),
        "toBlock": "latest",
    }])
    return logs


def describe(log, known):
    agent = "0x" + log["topics"][1][-40:]
    payer = "0x" + log["topics"][2][-40:]
    txh = log["topics"][3]
    amount = int(log["data"][2:66], 16)
    rating = int(log["data"][66:130], 16)
    block = int(log["blockNumber"], 16)
    tag = "team" if payer.lower() in known else "EXTERNAL"
    return (f"#{block}  {tag:8}  agent {agent[:10]}…  payer {payer[:10]}…  "
            f"{amount / 10 ** USDG_DECIMALS:.3f} USDG  rating {rating}/5  "
            f"{EXPLORER}/tx/{txh}")


def main():
    ap = argparse.ArgumentParser(description="Watch Tallied receipts on TGENTIC mainnet.")
    ap.add_argument("--rpc", default=os.environ.get("TGENTIC_RPC", DEFAULT_RPC))
    ap.add_argument("--contract", default=CONTRACT)
    ap.add_argument("--from-block", type=int, default=DEPLOY_BLOCK)
    ap.add_argument("--interval", type=float, default=15)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--known", default=os.environ.get("TGENTIC_KNOWN_PAYERS", ""),
                    help="comma-separated team payer addresses")
    a = ap.parse_args()
    known = {p.strip().lower() for p in a.known.split(",") if p.strip()}
    seen = set()

    print(f"watching {a.contract} from block {a.from_block} ({'once' if a.once else f'every {a.interval:g}s'})")
    print(f"known team payers: {len(known)} — anything else prints as EXTERNAL")
    try:
        while True:
            try:
                logs = scan(a.rpc, a.contract, a.from_block)
            except Exception as e:
                print(f"poll failed: {e}", file=sys.stderr)
                logs = []
            new = [l for l in logs if (l["transactionHash"], l["logIndex"]) not in seen]
            for l in new:
                seen.add((l["transactionHash"], l["logIndex"]))
                print(describe(l, known), flush=True)
            if a.once:
                if not logs:
                    print("no Tallied receipts found")
                return 0
            time.sleep(a.interval)
    except KeyboardInterrupt:
        print(f"\nstopped — {len(seen)} receipts seen")
        return 0


if __name__ == "__main__":
    sys.exit(main())
