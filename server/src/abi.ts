import { Interface } from "ethers";

/** The parts of contracts/contracts/Staking.sol the indexer reads. */
export const stakingAbi = new Interface([
  "event Staked(address indexed user, uint256 indexed positionId, uint256 amount, uint256 lockDuration)",
  "event RewardsClaimed(address indexed user, uint256 indexed positionId, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 indexed positionId, uint256 amount, uint256 penalty)",
  "function lockOptionsCount() view returns (uint256)",
  "function lockOptions(uint256) view returns (uint256 lockDuration, uint256 rewardRateBps)",
]);

export const EVENT_TOPICS = ["Staked", "RewardsClaimed", "Withdrawn"].map(
  (name) => stakingAbi.getEvent(name)!.topicHash,
);
