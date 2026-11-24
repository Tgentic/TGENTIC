// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Receipts.sol";

/// Minimal ECDSA recovery over EIP-191 signed message hashes, with the
/// standard guards (length, v, s-malleability). No dependencies.
library LibECDSA {
    error BadSignature();

    /// Recover the signer of `digest` (as signed by ethers/viem `signMessage`).
    function recoverSigned(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := shr(248, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27; // accept 0/1 and 27/28 encodings
        if (v != 27 && v != 28) revert BadSignature();
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address signer = ecrecover(signed, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}

/// Policy layer: who may count (roadmap Step 2). An m-of-n verifier set
/// approves tally, slash and rotation actions with signatures; anyone may
/// submit an approved action (the signatures carry the authority, the
/// submitter only pays gas). The set can rotate without touching state.
contract Policy {
    bytes32 private constant DOMAIN = keccak256("TGENTIC-Policy-v2");

    Receipts public immutable receipts;
    uint256 public threshold; // m
    address[] public verifiers; // n
    mapping(address => bool) public isVerifier;
    uint256 public rotationNonce; // replay guard for rotations

    event TallySubmitted(address indexed agent, address indexed payer, bytes32 indexed txHash, uint256 amount, uint8 rating, address submitter);
    event SlashSubmitted(address indexed agent, uint256 amount, bytes32 indexed evidenceHash, string reason, address submitter);
    event Rotated(address[] verifiers, uint256 threshold, uint256 indexed nonce);

    error BadInput();
    error NotEnoughSigners(uint256 have, uint256 need);
    error DuplicateSigner();
    error NotVerifier(address signer);

    constructor(Receipts _receipts, address[] memory _verifiers, uint256 _threshold) {
        if (address(_receipts) == address(0)) revert BadInput();
        receipts = _receipts;
        _setVerifiers(_verifiers, _threshold);
    }

    // ---------------- actions (anyone may submit, m signatures decide) ----------------

    function submitTally(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating, bytes[] calldata sigs) external {
        _check(tallyDigest(agent, payer, txHash, amount, rating), sigs);
        receipts.tally(agent, payer, txHash, amount, rating);
        emit TallySubmitted(agent, payer, txHash, amount, rating, msg.sender);
    }

    /// A slash requires the hash of the published evidence (tx hashes, pattern
    /// description) — the evidence is part of the signed digest, so verifiers
    /// sign what they reviewed.
    function submitSlash(address agent, uint256 amount, string calldata reason, bytes32 evidenceHash, bytes[] calldata sigs) external {
        _check(slashDigest(agent, amount, evidenceHash), sigs);
        receipts.slash(agent, amount, reason);
        emit SlashSubmitted(agent, amount, evidenceHash, reason, msg.sender);
    }

    function rotate(address[] calldata newVerifiers, uint256 newThreshold, bytes[] calldata sigs) external {
        _check(rotationDigest(newVerifiers, newThreshold), sigs);
        rotationNonce++;
        _setVerifiers(newVerifiers, newThreshold);
        emit Rotated(newVerifiers, newThreshold, rotationNonce);
    }

    // ---------------- digests (what a verifier signs) ----------------

    function tallyDigest(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, "tally", block.chainid, address(this), agent, payer, txHash, amount, rating));
    }

    function slashDigest(address agent, uint256 amount, bytes32 evidenceHash) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, "slash", block.chainid, address(this), agent, amount, evidenceHash));
    }

    function rotationDigest(address[] calldata newVerifiers, uint256 newThreshold) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, "rotate", block.chainid, address(this), keccak256(abi.encode(newVerifiers)), newThreshold, rotationNonce));
    }

    // ---------------- internals ----------------

    /// Signatures must be sorted ascending by signer, which proves the first
    /// `threshold` of them are distinct verifiers.
    function _check(bytes32 digest, bytes[] calldata sigs) internal view {
        if (sigs.length < threshold) revert NotEnoughSigners(sigs.length, threshold);
        address prev;
        for (uint256 i = 0; i < threshold; i++) {
            address signer = LibECDSA.recoverSigned(digest, sigs[i]);
            if (!isVerifier[signer]) revert NotVerifier(signer);
            if (i > 0 && signer <= prev) revert DuplicateSigner();
            prev = signer;
        }
    }

    function _setVerifiers(address[] memory list, uint256 m) private {
        if (m == 0 || list.length == 0 || m > list.length) revert BadInput();
        for (uint256 i = 0; i < verifiers.length; i++) isVerifier[verifiers[i]] = false;
        verifiers = list;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == address(0) || isVerifier[list[i]]) revert BadInput();
            isVerifier[list[i]] = true;
        }
        threshold = m;
    }
}
