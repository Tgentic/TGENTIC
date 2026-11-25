"""Minimal ABI codec — only what TGENTIC reads need (static types)."""

from ._keccak import keccak256


def selector(signature: str) -> bytes:
    """4-byte function selector for a canonical signature like 'score(address)'."""
    return keccak256(signature.encode())[:4]


def event_topic(signature: str) -> str:
    """topic0 (32-byte hash) for an event signature."""
    return "0x" + keccak256(signature.encode()).hex()


def _word(value: bytes) -> bytes:
    assert len(value) <= 32
    return bytes(32 - len(value)) + value


def encode_call(signature: str, *args) -> str:
    """Encode a call as 0x-prefixed calldata. args: ('address','0x..') | ('uint256',int) | ('bytes32','0x..')."""
    out = bytearray(selector(signature))
    for typ, val in args:
        if typ == "address":
            a = val[2:] if val.startswith("0x") else val
            out += _word(bytes.fromhex(a))
        elif typ in ("uint8", "uint64", "uint256"):
            out += int(val).to_bytes(32, "big")
        elif typ == "bytes32":
            h = val[2:] if val.startswith("0x") else val
            out += _word(bytes.fromhex(h))
        else:
            raise ValueError(f"unsupported type {typ}")
    return "0x" + bytes(out).hex()


def decode_uint(hexdata: str, index: int = 0) -> int:
    w = hexdata[2 + 64 * index: 2 + 64 * (index + 1)]
    return int(w, 16)


def decode_address(hexdata: str, index: int = 0) -> str:
    w = hexdata[2 + 64 * index: 2 + 64 * (index + 1)]
    return "0x" + w[24:]


def pad_address(addr: str) -> str:
    """Address -> 32-byte log topic."""
    a = addr[2:] if addr.startswith("0x") else addr
    return "0x" + a.rjust(64, "0")
