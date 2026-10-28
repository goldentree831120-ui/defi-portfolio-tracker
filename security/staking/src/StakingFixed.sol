// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title StakingFixed
/// @notice The original Staking contract with the two findings from SECURITY.md fixed.
///         Diff against src/original/Staking.sol; every change is marked [F1] or [F2].
///
///   [F1] Principal and rewards are accounted separately. `totalStaked` is everyone's
///        principal; `rewardReserve` is what the owner funded plus early-exit penalties.
///        Rewards are only ever paid from `rewardReserve`, so one user's rewards can never
///        come out of another user's principal. Invariant: balance >= totalStaked + rewardReserve.
///   [F2] Rewards stop accruing at the end of the lock. In the original, a 180-day position
///        kept earning 25% APY forever after unlocking, while being withdrawable at any time
///        with no penalty: the lock only mattered for the first 180 days.
contract StakingFixed is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;

    struct LockOption {
        uint256 lockDuration;
        uint256 rewardRateBps;
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

    uint256 public totalStaked; // [F1] sum of open principal
    uint256 public rewardReserve; // [F1] funded rewards + penalties, the ONLY source of rewards

    event Staked(address indexed user, uint256 indexed positionId, uint256 amount, uint256 lockDuration);
    event RewardsClaimed(address indexed user, uint256 indexed positionId, uint256 amount);
    event RewardShortfall(address indexed user, uint256 indexed positionId, uint256 owed, uint256 paid); // [F1]
    event Withdrawn(address indexed user, uint256 indexed positionId, uint256 amount, uint256 penalty);
    event RewardPoolFunded(uint256 amount);

    constructor(IERC20 _stakingToken) Ownable(msg.sender) {
        stakingToken = _stakingToken;
        lockOptions.push(LockOption({lockDuration: 30 days, rewardRateBps: 500}));
        lockOptions.push(LockOption({lockDuration: 90 days, rewardRateBps: 1200}));
        lockOptions.push(LockOption({lockDuration: 180 days, rewardRateBps: 2500}));
    }

    function lockOptionsCount() external view returns (uint256) {
        return lockOptions.length;
    }

    function positionsOf(address user) external view returns (Position[] memory) {
        return positions[user];
    }

    function positionsCount(address user) external view returns (uint256) {
        return positions[user].length;
    }

    function stake(uint256 amount, uint8 optionIndex) external nonReentrant {
        require(amount > 0, "amount must be > 0");
        require(optionIndex < lockOptions.length, "invalid lock option");
        LockOption memory opt = lockOptions[optionIndex];

        uint256 before = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        amount = stakingToken.balanceOf(address(this)) - before; // credit what actually arrived
        totalStaked += amount; // [F1]

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

    /// @dev [F2] Accrues only up to the end of the lock.
    function pendingRewards(address user, uint256 positionId) public view returns (uint256) {
        Position storage p = positions[user][positionId];
        if (p.withdrawn) return 0;
        uint256 end = p.startTime + p.lockDuration;
        uint256 until = block.timestamp < end ? block.timestamp : end;
        if (until <= p.lastClaimTime) return 0;
        return (p.amount * p.rewardRateBps * (until - p.lastClaimTime)) / (10_000 * 365 days);
    }

    function claimRewards(uint256 positionId) public nonReentrant {
        uint256 reward = pendingRewards(msg.sender, positionId);
        require(reward > 0, "no rewards accrued");
        require(reward <= rewardReserve, "reward pool empty"); // [F1] never touch principal
        positions[msg.sender][positionId].lastClaimTime = block.timestamp;
        rewardReserve -= reward;
        stakingToken.safeTransfer(msg.sender, reward);
        emit RewardsClaimed(msg.sender, positionId, reward);
    }

    /// @notice Principal is always returned in full (minus any early-exit penalty), even if the
    ///         reward pool is empty. Rewards are paid up to what the pool holds.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[msg.sender][positionId];
        require(!p.withdrawn, "already withdrawn");
        require(p.amount > 0, "empty position");

        uint256 owed = pendingRewards(msg.sender, positionId);
        p.lastClaimTime = block.timestamp;
        p.withdrawn = true;

        uint256 amount = p.amount;
        totalStaked -= amount; // [F1]
        uint256 penalty = 0;
        if (block.timestamp < p.startTime + p.lockDuration) {
            penalty = (amount * 1000) / 10_000;
            amount -= penalty;
            rewardReserve += penalty; // [F1] penalties fund future rewards instead of vanishing
        }

        uint256 reward = owed <= rewardReserve ? owed : rewardReserve; // [F1]
        rewardReserve -= reward;
        if (reward < owed) emit RewardShortfall(msg.sender, positionId, owed, reward);
        if (reward > 0) {
            stakingToken.safeTransfer(msg.sender, reward);
            emit RewardsClaimed(msg.sender, positionId, reward);
        }
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, positionId, amount, penalty);
    }

    function fundRewardPool(uint256 amount) external onlyOwner {
        uint256 before = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - before;
        rewardReserve += received; // [F1]
        emit RewardPoolFunded(received);
    }
}
