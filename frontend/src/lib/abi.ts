// Human-readable ABI fragments for exactly the functions the UI uses.
//
// The OpenZeppelin v5 custom errors are listed on BOTH contracts on purpose:
// when Staking calls token.transferFrom and the token reverts with, say,
// ERC20InsufficientAllowance, SafeERC20 bubbles the raw revert data up through
// Staking. ethers can only decode it into a readable error if the error's
// signature is in the ABI of the contract we called.

export const OZ_ERRORS = [
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error SafeERC20FailedOperation(address token)',
  'error ReentrancyGuardReentrantCall()',
  'error OwnableUnauthorizedAccount(address account)',
] as const

export const STAKING_ABI = [
  'function stakingToken() view returns (address)',
  'function lockOptionsCount() view returns (uint256)',
  'function lockOptions(uint256) view returns (uint256 lockDuration, uint256 rewardRateBps)',
  'function positionsOf(address user) view returns (tuple(uint256 amount, uint256 startTime, uint256 lockDuration, uint256 rewardRateBps, uint256 lastClaimTime, bool withdrawn)[])',
  'function pendingRewards(address user, uint256 positionId) view returns (uint256)',
  'function stake(uint256 amount, uint8 optionIndex)',
  'function claimRewards(uint256 positionId)',
  'function withdraw(uint256 positionId)',
  'event Staked(address indexed user, uint256 indexed positionId, uint256 amount, uint256 lockDuration)',
  'event RewardsClaimed(address indexed user, uint256 indexed positionId, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 indexed positionId, uint256 amount, uint256 penalty)',
  ...OZ_ERRORS,
] as const

export const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  ...OZ_ERRORS,
] as const
