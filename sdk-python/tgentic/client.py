"""tgentic — read and verify TGENTIC agent reputation. Zero dependencies.

    import tgentic
    tg = tgentic.create_client()            # mainnet by default
    tg.verify("0xAgent…")                   # score + manipulation signals

The client speaks plain JSON-RPC via urllib; pass `transport` (a callable
(method, params) -> result) to ride your own stack or to test offline.
"""

import json
import re
import urllib.request

from .abi import decode_uint, encode_call, event_topic, pad_address
from .flags import compute_flags

CHAIN_ID = 4663
MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com"

# Deployed contract addresses on mainnet (chain 4663).
ADDRESSES = {
    # v1 tally: score, receipts, bond — what the dapp and gate read today
    "tally": "0xCb2A4c9C2a552CBfE04DC0BbbCdC84E51ae734c8",
    "deploy_block": 118987578,
    # v2 line: state/policy split (m-of-n verifiers) + the on-chain flag contract
    "receipts": "0x23537F09062134e6cfD8FF8D0a49b263D93bdB27",
    "policy": "0x4651c76C501C54b6b649F4024BE34F7C58f7f4D3",
    "heuristics": "0xe9D4eaa060Eb0E7EEE599c026C217e3b06082d47",
    # the bond/payment token (USDG)
    "bond_token": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
}

_TALLIED_TOPIC = event_topic("Tallied(address,address,bytes32,uint256,uint8)")
_UINT_VIEWS = ("score", "reputation", "paid", "receipts", "payers", "bond", "unlockAt")
_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _check_addr(a):
    if not isinstance(a, str) or not _ADDR_RE.match(a):
        raise ValueError(f"Not an address: {a}")
    return a


def _urllib_transport(url):
    def call(method, params):
        body = json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        ).encode()
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read())
        if out.get("error"):
            raise RuntimeError(f"RPC error: {out['error']}")
        return out["result"]

    return call


class Client:
    def __init__(self, rpc_url=MAINNET_RPC, transport=None,
                 address=ADDRESSES["tally"], deploy_block=ADDRESSES["deploy_block"]):
        self.address = address
        self.deploy_block = deploy_block
        self._rpc = transport or _urllib_transport(rpc_url)

    def _view_uint(self, name, *args):
        data = encode_call(f"{name}(address)", *args) if args else encode_call(f"{name}()")
        res = self._rpc("eth_call", [{"to": self.address, "data": data}, "latest"])
        return int(res, 16)

    def _tallied(self, agent=None):
        topics = [_TALLIED_TOPIC] + ([pad_address(agent)] if agent else [])
        logs = self._rpc("eth_getLogs", [{
            "address": self.address,
            "fromBlock": hex(self.deploy_block),
            "toBlock": "latest",
            "topics": topics,
        }])
        return [_receipt(l) for l in logs]

    def score(self, agent):
        """Counted score + raw reputation + bond state."""
        a = _check_addr(agent)
        out = {f: self._view_uint(f, ("address", a)) for f in _UINT_VIEWS}
        out["min_bond"] = self._view_uint("minBond")
        return {
            "agent": a,
            "score": out["score"],
            "reputation": out["reputation"],
            "paid": out["paid"],
            "receipts": out["receipts"],
            "payers": out["payers"],
            "bond": out["bond"],
            "unlock_at": out["unlockAt"],
            "min_bond": out["min_bond"],
            "counted": out["bond"] >= out["min_bond"],
        }

    def receipts(self, agent):
        """An agent's receipts — each one a real payment verified on chain."""
        return self._tallied(_check_addr(agent))

    def risk(self, agent):
        """Manipulation signals over the receipt history. Heuristics, not verdicts."""
        a = _check_addr(agent)
        return compute_flags(self._tallied(a), a)

    def recent(self, n=10):
        """The latest n receipts across all agents."""
        return self._tallied()[-n:][::-1]

    def top(self, limit=100):
        """Leaderboard rows: one entry per agent with a score and flags."""
        agents = []
        for r in self._tallied():
            if r["agent"] not in agents:
                agents.append(r["agent"])
        return [{**self.score(a), "flags": self.risk(a)["flags"]}
                for a in agents[:limit]]

    def verify(self, agent):
        """The one call a hiring flow needs: score + signals in one object."""
        s = self.score(agent)
        r = self.risk(agent)
        return {**s, "flags": r["flags"], "flagged": r["flagged"],
                "top_payer_share_bps": r["top_payer_share_bps"]}


def _receipt(l):
    t, d = l["topics"], l["data"]
    return {
        "agent": "0x" + t[1][-40:],
        "payer": "0x" + t[2][-40:],
        "tx_hash": t[3],
        "amount": decode_uint(d, 0),
        "rating": decode_uint(d, 1),
        "block_number": int(l["blockNumber"], 16),
        "log_transaction_hash": l["transactionHash"],
    }


def create_client(rpc_url=MAINNET_RPC, transport=None,
                  address=ADDRESSES["tally"],
                  deploy_block=ADDRESSES["deploy_block"]):
    """Create a TGENTIC client. Defaults to mainnet."""
    return Client(rpc_url, transport, address, deploy_block)
