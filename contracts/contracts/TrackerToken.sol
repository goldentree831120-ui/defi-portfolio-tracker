// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TrackerToken
/// @notice Simple ERC-20 used as the demo asset for the portfolio tracker
///         and as the staking/reward token for {Staking}.
contract TrackerToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    constructor() ERC20("Tracker Token", "TRK") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Lets the owner mint extra tokens (e.g. to fund the staking
    ///         contract's reward pool). Kept intentionally simple for a demo.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
