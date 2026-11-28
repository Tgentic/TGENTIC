"""Manipulation heuristics — the same detector the gate, dapp, TS SDK and the
on-chain Heuristics contract run. Flags are heuristics, not verdicts.

Port of sdk/src/flags.js — keep thresholds identical across SDKs.
"""


def compute_flags(logs, agent=None):
    """logs: iterable of dicts with block_number, payer, amount, tx_hash(optional).
    Returns a dict of signals and the flags list."""
    seen = {}
    for l in logs:
        tx_hash = l.get("tx_hash")
        key = (
            str(tx_hash).lower()
            if tx_hash
            else f"log-{l['block_number']}-{str(l['payer']).lower()}-{l['amount']}"
        )
        if key not in seen:
            seen[key] = l
    logs = sorted(seen.values(), key=lambda l: l["block_number"])

    per_payer = {}
    for l in logs:
        p = l["payer"].lower()
        per_payer[p] = per_payer.get(p, 0) + 1
    top_payer, top_count = max(per_payer.items(), key=lambda kv: kv[1], default=("", 0))
    # Half-up rounding to match JS Math.round() in sdk/src/flags.js.
    top_payer_share_bps = (top_count * 10000 * 2 + len(logs)) // (2 * len(logs)) if logs else 0

    intervals = [logs[i]["block_number"] - logs[i - 1]["block_number"]
                 for i in range(1, len(logs))]
    regular_timing = False
    if len(intervals) >= 3:
        mean = sum(intervals) / len(intervals)
        variance = sum((v - mean) ** 2 for v in intervals) / len(intervals)
        regular_timing = variance ** 0.5 <= max(1, mean * 0.2)

    per_amount = {}
    for l in logs:
        a = str(l["amount"])
        per_amount[a] = per_amount.get(a, 0) + 1
    top_amount, top_amount_count = max(per_amount.items(), key=lambda kv: kv[1], default=("", 0))
    amount_cycling = top_amount_count >= 3 and len(per_amount) <= 2

    flags = []
    if len(logs) >= 3 and len(per_payer) == 1:
        flags.append("single-payer")
    if len(per_payer) > 1 and len(logs) / len(per_payer) >= 3:
        flags.append("repeat-heavy")
    if regular_timing:
        flags.append("regular-timing")
    if amount_cycling:
        flags.append("amount-cycling")

    return {
        "agent": agent,
        "receipts": len(logs),
        "payers": len(per_payer),
        "top_payer_share_bps": top_payer_share_bps,
        "top_payer": top_payer,
        "top_amount": top_amount,
        "top_amount_count": top_amount_count,
        "interval_count": len(intervals),
        "flags": flags,
        "flagged": len(flags) > 0,
    }
