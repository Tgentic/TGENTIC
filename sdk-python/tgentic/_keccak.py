"""Pure-Python Keccak-256 — Ethereum's hash (the pre-NIST variant, NOT SHA3-256).

Vendored so the SDK stays zero-dependency. Implements the Keccak-f[1600]
permutation: rate 136 bytes, capacity 512 bits, 0x01 domain padding.
Pinned against published vectors in tests/.
"""

_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)

# Rotation offsets indexed [x][y].
_ROT = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)

_MASK = (1 << 64) - 1
_RATE = 136  # bytes; 1088-bit rate for Keccak-256


def _rol(x, n):
    return ((x << n) | (x >> (64 - n))) & _MASK


def _keccak_f(s):
    for rc in _RC:
        # theta
        c = [s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20] for x in range(5)]
        for x in range(5):
            d = c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1)
            for y in range(5):
                s[x + 5 * y] ^= d
        # rho + pi
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rol(s[x + 5 * y], _ROT[x][y])
        # chi
        for y in range(5):
            row = b[5 * y:5 * y + 5]
            for x in range(5):
                s[x + 5 * y] = row[x] ^ ((~row[(x + 1) % 5] & _MASK) & row[(x + 2) % 5])
        # iota
        s[0] ^= rc


def _absorb(s, block):
    for i in range(len(block) // 8):
        s[i] ^= int.from_bytes(block[8 * i:8 * i + 8], "little")


def keccak256(data: bytes) -> bytes:
    """Keccak-256 digest of *data* (32 bytes)."""
    s = [0] * 25
    off = 0
    while len(data) - off >= _RATE:
        _absorb(s, data[off:off + _RATE])
        _keccak_f(s)
        off += _RATE
    last = bytearray(data[off:])
    last.append(0x01)  # Keccak domain suffix (SHA3 would use 0x06)
    last.extend(b"\x00" * (_RATE - len(last)))
    last[-1] ^= 0x80
    _absorb(s, bytes(last))
    _keccak_f(s)
    return b"".join(w.to_bytes(8, "little") for w in s)[:32]
