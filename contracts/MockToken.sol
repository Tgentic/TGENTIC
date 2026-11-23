// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// For tests and testnet only (tTGEN, tUSDG). feeBps simulates a token that takes a fee on transfer.
contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public immutable feeBps;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _feeBps) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        feeBps = _feeBps;
        balanceOf[msg.sender] = 1_000_000 * 10 ** _decimals;
        emit Transfer(address(0), msg.sender, balanceOf[msg.sender]);
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        _move(msg.sender, to, v);
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        allowance[from][msg.sender] -= v;
        _move(from, to, v);
        return true;
    }

    function _move(address from, address to, uint256 v) private {
        balanceOf[from] -= v;
        uint256 got = v - (v * feeBps) / 10_000;
        balanceOf[to] += got;
        emit Transfer(from, to, got);
    }
}
