#!/usr/bin/env python3
"""TGENTIC signing specs — shared by buy-report.py, tally.py and any Python client.

These are the SAME byte-level formats the gate verifies:
  * feedback_message — EIP-191 personal_sign, gate/src/core.js feedbackMessage
  * report_message   — canonical JSON of the signed doc, gate/src/manifest.js manifestMessage
  * EIP-3009 auth    — EIP-712 TransferWithAuthorization under the USDG domain

Drift rule: if the gate's spec changes, change it HERE — every Python tool
imports this module instead of re-deriving the format.

Deps: eth-account (pip install eth-account). requests only in the CLIs.
"""

import json

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address

CHAIN_ID = 4663
GATE = "https://www.tgentic.xyz"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
USDG_DOMAIN = {"name": "Global Dollar", "version": "1"}
EXPLORER = "https://robinhoodchain.blockscout.com"


def canonical_json(value):
    """Recursive key-sorted compact JSON — byte-identical to JS
    JSON.stringify(sortValue(v)): sorted keys at every depth, no spaces,
    non-ASCII emitted as UTF-8 (JS does not escape it)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def report_message(report):
    """The exact string an auditor's signature commits to: canonical JSON of
    the report minus its `signature` field."""
    doc = {k: v for k, v in report.items() if k != "signature"}
    return canonical_json(doc)


def recover_report_signer(report):
    """Recover the EIP-191 signer of a report document — the offline trust
    check. Returns the checksummed signer address."""
    return Account.recover_message(
        encode_defunct(text=report_message(report)), signature=report["signature"]
    )


def feedback_message(chain_id, agent, tx_hash, rating, manifest_hash=None):
    """The payer's rating message, gate/src/core.js feedbackMessage. Includes
    the chain id so it cannot be replayed on another chain."""
    msg = (
        f"TGENTIC feedback\nchain: {chain_id}\nagent: {to_checksum_address(agent)}"
        f"\ntx: {tx_hash.lower()}\nrating: {rating}"
    )
    if manifest_hash:
        msg += f"\nmanifest: {manifest_hash.lower()}"
    return msg


def sign_feedback(private_key, chain_id, agent, tx_hash, rating, manifest_hash=None):
    """EIP-191 signature of the feedback message — what POST /tally verifies."""
    msg = feedback_message(chain_id, agent, tx_hash, rating, manifest_hash)
    sig = Account.sign_message(encode_defunct(text=msg), private_key).signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig


def eip3009_message(offer, payer):
    """The full EIP-712 envelope for TransferWithAuthorization, built from the
    gate's offer (`accepts[0]`). Mirrors sdk/src/gate.js buyAudit."""
    import secrets, time

    chain_id = int(offer["network"].split(":")[1])
    now = int(time.time())
    nonce = "0x" + secrets.token_bytes(32).hex()
    domain = {
        "name": offer.get("extra", {}).get("name", USDG_DOMAIN["name"]),
        "version": offer.get("extra", {}).get("version", USDG_DOMAIN["version"]),
        "chainId": chain_id,
        "verifyingContract": to_checksum_address(offer["asset"]),
    }
    message = {
        "from": to_checksum_address(payer),
        "to": to_checksum_address(offer["payTo"]),
        "value": int(offer["amount"]),
        "validAfter": now - 60,
        "validBefore": now + min(int(offer.get("maxTimeoutSeconds", 300)), 300),
        "nonce": nonce,
    }
    full = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": domain,
        "message": message,
    }
    return full, nonce


def payment_payload(offer, payer, signature, nonce, message):
    """The v2 payment body the gate's verifyPayment consumes — `accepted`
    echoes the offer's requirement, authorization fields stringified."""
    return {
        "x402Version": 2,
        "accepted": offer,
        "payload": {
            "signature": signature,
            "authorization": {
                "from": message["from"],
                "to": message["to"],
                "value": str(message["value"]),
                "validAfter": str(message["validAfter"]),
                "validBefore": str(message["validBefore"]),
                "nonce": nonce,
            },
        },
    }


if __name__ == "__main__":
    # Spec parity fixture — the gate's JS canonical form must produce the
    # identical bytes. If this fails, signature recovery will fail too.
    fixture = {"b": [3, {"z": 1, "a": "é"}], "a": {"y": None, "x": True}}
    want = '{"a":{"x":true,"y":null},"b":[3,{"a":"é","z":1}]}'
    got = canonical_json(fixture)
    assert got == want, f"canonical_json drift:\n  got  {got}\n  want {want}"
    print("tgentic_spec: canonical_json parity ok")
