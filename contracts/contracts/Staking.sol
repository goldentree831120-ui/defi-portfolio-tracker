// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Staking
/// @notice Time-weighted staking pool with a tiered APY: the longer a user
///         commits to lock their stake, the higher the reward rate. This is
///         the "stretch feature" version of a basic stake/unstake contract -
///         it exists to give the portfolio tracker something richer than a
///         flat balance to read and display (position, lock tier, accrued
///         rewards, unlock time).
contract Staking is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;

    struct LockOption {
        uint256 lockDuration; // seconds
        uint256 rewardRateBps; // annual reward rate, in basis points (100 = 1%)
    }

    struct Position {
        uint256 amount;
        uint256 startTime;
        uint256 lockDuration;
        uint256 rewardRateBps;
        uint256 lastClaimTime;
        bool withdrawn;
    }

    LockOption[] public lockOptions;
    mapping(address => Position[]) public positions;

    event Staked(address indexed user, uint256 indexed positionId, uint256 amount, uint256 lockDuration);
    event RewardsClaimed(address indexed user, uint256 indexed positionId, uint256 amount);
    event Withdrawn(address indexed user, uint256 indexed positionId, uint256 amount, uint256 penalty);

    constructor(IERC20 _stakingToken) Ownable(msg.sender) {
        stakingToken = _stakingToken;

        // Tiered lock options: longer lock => higher APY.
        lockOptions.push(LockOption({lockDuration: 30 days, rewardRateBps: 500}));   // 5% APY
        lockOptions.push(LockOption({lockDuration: 90 days, rewardRateBps: 1200}));  // 12% APY
        lockOptions.push(LockOption({lockDuration: 180 days, rewardRateBps: 2500})); // 25% APY
    }

    function lockOptionsCount() external view returns (uint256) {
        return lockOptions.length;
    }

    function positionsOf(address user) external view returns (Position[] memory) {
        return positions[user];
    }

    /// @notice Number of positions (open or closed) a user has ever created.
    /// @dev Exposed separately from {positionsOf} so an off-chain client
    ///      (e.g. the Java backend, via Web3j) can page through positions
    ///      with the auto-generated `positions(address,uint256)` getter -
    ///      which returns plain scalars - instead of ABI-decoding a dynamic
    ///      array of structs, which most Web3j versions handle poorly.
    function positionsCount(address user) external view returns (uint256) {
        return positions[user].length;
    }

    /// @notice Stake `amount` tokens under lock tier `optionIndex`.
    function stake(uint256 amount, uint8 optionIndex) external nonReentrant {
        require(amount > 0, "amount must be > 0");
        require(optionIndex < lockOptions.length, "invalid lock option");

        LockOption memory opt = lockOptions[optionIndex];

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        positions[msg.sender].push(
            Position({
                amount: amount,
                startTime: block.timestamp,
                lockDuration: opt.lockDuration,
                rewardRateBps: opt.rewardRateBps,
                lastClaimTime: block.timestamp,
                withdrawn: false
            })
        );

        emit Staked(msg.sender, positions[msg.sender].length - 1, amount, opt.lockDuration);
    }

    /// @dev Simple linear accrual: amount * rateBps/10000 * elapsed/365 days.
    function pendingRewards(address user, uint256 positionId) public view returns (uint256) {
        Position storage p = positions[user][positionId];
        if (p.withdrawn) return 0;

        uint256 elapsed = block.timestamp - p.lastClaimTime;
        return (p.amount * p.rewardRateBps * elapsed) / (10_000 * 365 days);
    }

    function claimRewards(uint256 positionId) public nonReentrant {
        uint256 reward = pendingRewards(msg.sender, positionId);
        require(reward > 0, "no rewards accrued");

        positions[msg.sender][positionId].lastClaimTime = block.timestamp;

        stakingToken.safeTransfer(msg.sender, reward);
        emit RewardsClaimed(msg.sender, positionId, reward);
    }

    /// @notice Withdraw principal. Withdrawing before the lock expires costs
    ///         a 10% early-exit penalty (kept in the contract), which is the
    ///         kind of edge case worth documenting for interviews.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[msg.sender][positionId];
        require(!p.withdrawn, "already withdrawn");
        require(p.amount > 0, "empty position");

        uint256 reward = pendingRewards(msg.sender, positionId);
        p.lastClaimTime = block.timestamp;
        p.withdrawn = true;

        uint256 amount = p.amount;
        uint256 penalty = 0;

        if (block.timestamp < p.startTime + p.lockDuration) {
            penalty = (amount * 1000) / 10_000; // 10% early-exit penalty
            amount -= penalty;
        }

        if (reward > 0) {
            stakingToken.safeTransfer(msg.sender, reward);
            emit RewardsClaimed(msg.sender, positionId, reward);
        }

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, positionId, amount, penalty);
    }

    /// @notice Owner tops up the reward pool (must approve first).
    function fundRewardPool(uint256 amount) external onlyOwner {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }
}
