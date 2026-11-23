// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address from, address to, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// An agent's reputation = Σ(verified USDG payments x score 1-5). Without payments, zero.
/// The score is only readable while the agent keeps a token bond >= minBond; the bond is burned on proven wash-trading.
/// Tx hash verification happens off-chain in the `gate`.
contract TGENTIC {
    // shortcut: a single gate key is fully trusted (to record AND to slash); upgrade to a multisig / multi-verifier before mainnet.
    address public immutable gate;
    IERC20 public immutable token; // the bond token, set at deploy (the live instance bonds USDG)
    uint256 public immutable minBond; // minimum bond for the score to be readable
    uint256 public constant UNLOCK_DELAY = 7 days; // slash window before the bond can be withdrawn
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    mapping(bytes32 => bool) public used; // tx hashes already counted (anti-replay)
    mapping(address => uint256) public paid; // total verified USDG (6 decimals)
    mapping(address => uint256) public reputation; // raw Σ(amount x score)
    mapping(address => uint256) public receipts;
    mapping(address => uint256) public payers; // unique payers
    mapping(address => uint256) public bond;
    mapping(address => uint256) public unlockAt; // 0 = no unlock in progress
    mapping(address => mapping(address => bool)) private seen;

    event Tallied(address indexed agent, address indexed payer, bytes32 indexed txHash, uint256 amount, uint8 rating);
    event Bonded(address indexed agent, uint256 amount);
    event UnlockStarted(address indexed agent, uint256 at);
    event Withdrawn(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 amount, string reason);

    error NotGate();
    error AlreadyTallied();
    error BadInput();
    error Locked();
    error TransferFailed();

    modifier onlyGate() {
        if (msg.sender != gate) revert NotGate();
        _;
    }

    constructor(address _gate, address _token, uint256 _minBond) {
        if (_gate == address(0) || _token == address(0)) revert BadInput();
        gate = _gate;
        token = IERC20(_token);
        minBond = _minBond;
    }

    function tally(address agent, address payer, bytes32 txHash, uint256 amount, uint8 rating) external onlyGate {
        if (agent == address(0) || amount == 0 || rating < 1 || rating > 5 || txHash == 0) revert BadInput();
        if (used[txHash]) revert AlreadyTallied();
        used[txHash] = true;

        paid[agent] += amount;
        reputation[agent] += amount * rating;
        receipts[agent]++;
        if (!seen[agent][payer]) {
            seen[agent][payer] = true;
            payers[agent]++;
        }
        emit Tallied(agent, payer, txHash, amount, rating);
    }

    /// The score consumers are allowed to use: zero while the bond is below the minimum.
    function score(address agent) external view returns (uint256) {
        return bond[agent] >= minBond ? reputation[agent] : 0;
    }

    function deposit(uint256 amount) external {
        uint256 before = token.balanceOf(address(this));
        _pullFrom(msg.sender, amount);
        uint256 got = token.balanceOf(address(this)) - before; // fee-on-transfer tokens are recorded by what was actually received
        if (got == 0) revert BadInput();
        bond[msg.sender] += got;
        unlockAt[msg.sender] = 0; // adding to the bond cancels a pending unlock
        emit Bonded(msg.sender, got);
    }

    function startUnlock() external {
        unlockAt[msg.sender] = block.timestamp + UNLOCK_DELAY;
        emit UnlockStarted(msg.sender, unlockAt[msg.sender]);
    }

    function withdraw(uint256 amount) external {
        uint256 at = unlockAt[msg.sender];
        if (at == 0 || block.timestamp < at) revert Locked();
        if (amount == 0 || amount > bond[msg.sender]) revert BadInput();
        bond[msg.sender] -= amount;
        unlockAt[msg.sender] = 0;
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// Proof of wash-trading/self-dealing: the bond is cut and burned, the reputation wiped.
    function slash(address agent, uint256 amount, string calldata reason) external onlyGate {
        if (amount > bond[agent]) amount = bond[agent];
        bond[agent] -= amount;
        reputation[agent] = 0;
        if (amount > 0) _push(DEAD, amount);
        emit Slashed(agent, amount, reason);
    }

    function _pullFrom(address from, uint256 v) private {
        (bool ok, bytes memory r) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, address(this), v)));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 v) private {
        (bool ok, bytes memory r) = address(token).call(abi.encodeCall(IERC20.transfer, (to, v)));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }
}
