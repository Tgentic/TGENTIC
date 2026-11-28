"""SDK tests — keccak vectors, ABI codec (cross-checked vs viem), the detector,
and the client end-to-end against replayed mainnet responses."""

import unittest

from tgentic import create_client, compute_flags
from tgentic._keccak import keccak256
from tgentic.abi import encode_call, event_topic, pad_address, selector

AGENT = "0x85db450017b448439dc63a7c566dd9b9e933d2be"


class Keccak(unittest.TestCase):
    def test_published_vectors(self):
        self.assertEqual(keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        self.assertEqual(keccak256(b"transfer(address,uint256)").hex(),
            "a9059cbb2ab09eb219583f4a59a5d0623ade346d962bcd4e46b11da047c9049b")

    def test_selectors_match_viem(self):
        # values cross-checked against viem toFunctionSelector
        self.assertEqual(selector("score(address)").hex(), "776f3843")
        self.assertEqual(selector("minBond()").hex(), "831518b7")
        self.assertEqual(selector("reputation(address)").hex(), "b9f79451")


class Abi(unittest.TestCase):
    def test_encode_matches_viem(self):
        # byte-identical to viem encodeFunctionData
        self.assertEqual(
            encode_call("score(address)", ("address", AGENT)),
            "0x776f3843000000000000000000000000" + AGENT[2:])

    def test_event_topic(self):
        self.assertEqual(
            event_topic("Tallied(address,address,bytes32,uint256,uint8)"),
            "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e")

    def test_pad_address(self):
        self.assertEqual(pad_address(AGENT), "0x" + "0" * 24 + AGENT[2:])
        self.assertEqual(pad_address(AGENT.upper().replace("0X", "0x")), "0x" + "0" * 24 + AGENT[2:])


def _log(block, payer, amount=200000, rating=5,
         tx="0x" + "ab" * 32, agent=AGENT):
    return {"agent": agent, "payer": payer, "tx_hash": tx, "amount": amount,
            "rating": rating, "block_number": block,
            "log_transaction_hash": "0x" + "cd" * 32}


class Flags(unittest.TestCase):
    def test_clean(self):
        r = compute_flags([_log(1, "0x" + "1" * 40)])
        self.assertEqual(r["flags"], [])
        self.assertFalse(r["flagged"])
        self.assertEqual(r["top_payer_share_bps"], 10000)

    def test_dedupe_across_state_layers(self):
        # same payment tx in v1 + v2 logs counts once
        tx = "0x" + "ef" * 32
        r = compute_flags([_log(1, "0x" + "1" * 40, tx=tx),
                           _log(2, "0x" + "1" * 40, tx=tx)])
        self.assertEqual(r["receipts"], 1)

    def test_single_payer(self):
        p = "0x" + "9" * 40
        r = compute_flags([_log(i * 100, p, amount=i * 1000, tx=f"0x{i:064x}")
                           for i in range(1, 4)])
        self.assertIn("single-payer", r["flags"])

    def test_repeat_heavy(self):
        # 6 receipts / 2 payers -> average 3 per payer -> repeat-heavy
        logs = [_log(100 + i * 37, "0x" + "1" * 40, amount=i + 1, tx=f"0x{i:064x}")
                for i in range(1, 6)]
        logs += [_log(400, "0x" + "2" * 40, amount=9, tx="0x" + "ff" * 32)]
        self.assertIn("repeat-heavy", compute_flags(logs)["flags"])

    def test_regular_timing(self):
        logs = [_log(100 + 50 * i, "0x" + f"{i+1:040x}", amount=1000 + i,
                     tx=f"0x{i:064x}") for i in range(4)]
        self.assertIn("regular-timing", compute_flags(logs)["flags"])

    def test_dedupe_without_tx_hash_is_order_independent(self):
        # F1 parity with sdk/src/flags.js: missing tx_hash uses content-derived key
        p = "0x" + "1" * 40
        a = {"block_number": 10, "payer": p, "amount": 500}
        b = {"block_number": 20, "payer": p, "amount": 500}
        r1 = compute_flags([a, a, b])
        r2 = compute_flags([b, a, a])
        self.assertEqual(r1["receipts"], 2)
        self.assertEqual(r2["receipts"], 2)
        self.assertEqual(r1["flags"], r2["flags"])

    def test_rounding_matches_js_half_up(self):
        # 1 / 32 * 10000 = 312.5 -> JS Math.round gives 313 (not banker's 312)
        logs = [_log(100 + i, f"0x{i + 1:040x}", amount=100 + i, tx=f"0x{i + 1:064x}")
                for i in range(32)]
        self.assertEqual(compute_flags(logs)["top_payer_share_bps"], 313)

    def test_amount_cycling(self):
        logs = [_log(i * 100, "0x" + f"{i+1:040x}", amount=5000,
                     tx=f"0x{i:064x}") for i in range(3)]
        self.assertIn("amount-cycling", compute_flags(logs)["flags"])


class Client(unittest.TestCase):
    """End-to-end against replayed mainnet responses (block ~123M state)."""

    def setUp(self):
        uints = {"score": 1000000, "reputation": 1000000, "paid": 200000,
                 "receipts": 1, "payers": 1, "bond": 500000, "unlockAt": 0}
        self.stub = {
            "776f3843": hex(uints["score"]), "b9f79451": hex(uints["reputation"]),
            "a340cf79": hex(uints["paid"]), "4de4797b": hex(uints["receipts"]),
            "4a714c24": hex(uints["payers"]), "247ce85b": hex(uints["bond"]),
            "89b7e586": hex(uints["unlockAt"]), "831518b7": hex(500000)}

    LOG_BLOCK = 122286811  # the same first payment, at its v2 Receipts block

    def _tg(self, latest=None):
        latest = latest or self.LOG_BLOCK

        def transport(method, params):
            if method == "eth_call":
                return self.stub[params[0]["data"][2:10]]
            if method == "eth_blockNumber":
                return hex(latest)
            if method == "eth_getLogs":
                q = params[0]
                lo, hi = int(q["fromBlock"], 16), int(q["toBlock"], 16)
                # range-aware: the log only exists inside its own block window
                if not (lo <= self.LOG_BLOCK <= hi):
                    return []
                return [{
                    "address": q["address"],
                    "topics": [
                        "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e",
                        "0x" + "0" * 24 + AGENT[2:],
                        "0x" + "0" * 24 + "0416478379d1bce57d1ef75d1e6a81ff3018f5b1",
                        "0x44d4be1951fe871593f4e4dd25d9b34c2f048150fa707bb721b84284f0736096"],
                    "data": "0x" + f"{200000:064x}" + f"{5:064x}",
                    "blockNumber": hex(self.LOG_BLOCK),
                    "transactionHash": "0x2d475b2ab23a66c9bdf6c5608b247e2b81d272c6e9e5e2cc8af32509e34b9daf"}]
            raise AssertionError(method)
        return create_client(transport=transport)

    def test_verify_mainnet_shape(self):
        v = self._tg().verify(AGENT)
        self.assertEqual(v["score"], 1000000)
        self.assertEqual(v["paid"], 200000)
        self.assertTrue(v["counted"])
        self.assertEqual(v["flags"], [])
        self.assertEqual(v["top_payer_share_bps"], 10000)

    def test_receipts(self):
        r = self._tg().receipts(AGENT)[0]
        self.assertEqual(r["payer"], "0x0416478379d1bce57d1ef75d1e6a81ff3018f5b1")
        self.assertEqual(r["amount"], 200000)
        self.assertEqual(r["rating"], 5)
        self.assertEqual(r["block_number"], 122286811)
        self.assertEqual(r["tx_hash"],
            "0x44d4be1951fe871593f4e4dd25d9b34c2f048150fa707bb721b84284f0736096")

    def test_recent(self):
        rec = self._tg().recent(5)
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec[0]["agent"], AGENT)
        self.assertEqual(self._tg().recent(0), [])
        self.assertEqual(self._tg().recent(None), [])

    def test_non_range_rpc_error_does_not_halve_repeatedly(self):
        calls = 0

        def transport(method, params):
            nonlocal calls
            if method == "eth_blockNumber":
                return hex(self.LOG_BLOCK)
            if method == "eth_getLogs":
                calls += 1
                raise RuntimeError("RPC error: 429 rate limited")
            raise AssertionError(method)

        with self.assertRaises(RuntimeError):
            create_client(transport=transport).receipts(AGENT)
        self.assertEqual(calls, 1)

    def test_range_error_containing_hex_429_still_halves(self):
        calls = 0

        def transport(method, params):
            nonlocal calls
            if method == "eth_blockNumber":
                return hex(self.LOG_BLOCK + 10)
            if method == "eth_getLogs":
                calls += 1
                lo, hi = int(params[0]["fromBlock"], 16), int(params[0]["toBlock"], 16)
                if hi - lo > 5:
                    raise RuntimeError("RPC error: block range 0x4291..0x429f exceeds max range")
                return []
            raise AssertionError(method)

        self.assertEqual(create_client(transport=transport, deploy_block=self.LOG_BLOCK).receipts(AGENT), [])
        self.assertGreater(calls, 1)

    def test_top_ranks_by_score_before_truncating(self):
        a1 = "0x" + "1" * 40
        a2 = "0x" + "2" * 40
        scores = {a1: 100, a2: 9999}

        def transport(method, params):
            if method == "eth_blockNumber":
                return hex(self.LOG_BLOCK + 10)
            if method == "eth_getLogs":
                return [
                    {
                        "address": params[0]["address"],
                        "topics": [
                            "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e",
                            "0x" + "0" * 24 + a1[2:],
                            "0x" + "0" * 24 + "0416478379d1bce57d1ef75d1e6a81ff3018f5b1",
                            "0x" + "11" * 32,
                        ],
                        "data": "0x" + f"{100:064x}" + f"{1:064x}",
                        "blockNumber": hex(self.LOG_BLOCK),
                        "transactionHash": "0x" + "aa" * 32,
                    },
                    {
                        "address": params[0]["address"],
                        "topics": [
                            "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e",
                            "0x" + "0" * 24 + a2[2:],
                            "0x" + "0" * 24 + "0416478379d1bce57d1ef75d1e6a81ff3018f5b1",
                            "0x" + "22" * 32,
                        ],
                        "data": "0x" + f"{9999:064x}" + f"{1:064x}",
                        "blockNumber": hex(self.LOG_BLOCK + 1),
                        "transactionHash": "0x" + "bb" * 32,
                    },
                ]
            if method == "eth_call":
                sel = params[0]["data"][2:10]
                if sel == "831518b7":
                    return hex(500000)
                addr = "0x" + params[0]["data"][-40:]
                if sel == "247ce85b":  # bond
                    return hex(500000)
                if sel in ("776f3843", "b9f79451"):  # score, reputation
                    return hex(scores[addr])
                return hex(1)
            raise AssertionError(method)

        rows = create_client(transport=transport).top(limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["agent"], a2)
        self.assertEqual(rows[0]["score"], 9999)

    def test_bad_address(self):
        with self.assertRaises(ValueError):
            self._tg().score("not-an-address")

    def test_paginates_getlogs_across_windows(self):
        # latest far enough that deploy_block..latest spans several windows —
        # the range-aware stub only answers inside the log's own window
        from tgentic.client import LOG_BLOCK_RANGE
        latest = 122282476 + 2 * LOG_BLOCK_RANGE + 5000
        calls = []

        def transport(method, params):
            if method == "eth_blockNumber":
                return hex(latest)
            if method == "eth_getLogs":
                q = params[0]
                calls.append((int(q["fromBlock"], 16), int(q["toBlock"], 16)))
                lo, hi = int(q["fromBlock"], 16), int(q["toBlock"], 16)
                if not (lo <= self.LOG_BLOCK <= hi):
                    return []
                return [{
                    "address": q["address"],
                    "topics": [
                        "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e",
                        "0x" + "0" * 24 + AGENT[2:],
                        "0x" + "0" * 24 + "0416478379d1bce57d1ef75d1e6a81ff3018f5b1",
                        "0x44d4be1951fe871593f4e4dd25d9b34c2f048150fa707bb721b84284f0736096"],
                    "data": "0x" + f"{200000:064x}" + f"{5:064x}",
                    "blockNumber": hex(self.LOG_BLOCK),
                    "transactionHash": "0x2d475b2ab23a66c9bdf6c5608b247e2b81d272c6e9e5e2cc8af32509e34b9daf"}]
            raise AssertionError(method)

        from tgentic import create_client as cc
        tg = cc(transport=transport)
        rs = tg.receipts(AGENT)
        self.assertEqual(len(rs), 1)
        self.assertGreater(len(calls), 1)  # actually paged
        # every request stayed under the cap
        for lo, hi in calls:
            self.assertLessEqual(hi - lo + 1, LOG_BLOCK_RANGE)


if __name__ == "__main__":
    unittest.main()
