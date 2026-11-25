// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiptsView {
    function receipts(address) external view returns (uint256);
    function payers(address) external view returns (uint256);
    function paid(address) external view returns (uint256);
    function reputation(address) external view returns (uint256);
}

/// Step 3: on-chain manipulation flags, computed from the state layer.
/// A stateless view — anyone can deploy one pointed at any Receipts
/// instance, and anyone can call it without running a gate. The flags are
/// heuristics, not verdicts: they mark what deserves a closer look.
contract Heuristics {
    IReceiptsView public immutable receipts;

    // A single receipt proves nothing; three from one payer is a pattern.
    uint256 public constant SINGLE_PAYER_MIN_RECEIPTS = 3;
    // Receipts per payer at or above which the payer set looks concentrated.
    uint256 public constant CONCENTRATION_RATIO = 3;

    constructor(IReceiptsView _receipts) {
        if (address(_receipts) == address(0)) revert BadInput();
        receipts = _receipts;
    }

    struct Flags {
        uint256 receiptCount;
        uint256 payerCount;
        uint256 ratioBps; // receipts per payer, scaled by 1e4 (0 when no receipts)
        bool singlePayer; // every receipt from one payer, and enough of them
        bool repeatHeavy; // high receipts-per-payer ratio across payers
        bool flagged; // any flag
    }

    error BadInput();

    function assess(address agent) external view returns (Flags memory f) {
        f.receiptCount = receipts.receipts(agent);
        f.payerCount = receipts.payers(agent);
        if (f.receiptCount > 0 && f.payerCount > 0) {
            f.ratioBps = (f.receiptCount * 1e4) / f.payerCount;
        }
        f.singlePayer = f.receiptCount >= SINGLE_PAYER_MIN_RECEIPTS && f.payerCount == 1;
        f.repeatHeavy = f.payerCount > 1 && f.ratioBps >= CONCENTRATION_RATIO * 1e4;
        f.flagged = f.singlePayer || f.repeatHeavy;
    }
}
