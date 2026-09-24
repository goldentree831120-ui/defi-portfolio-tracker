const { ethers } = require("hardhat");

async function main() {
  const TOKEN_ADDRESS = "0x5Db69118dB4652CBC39F027Fb28b6B5e8A9eE593";
  const STAKING_ADDRESS = "0x707AbBCEd16c1872e08ba56d079eacE17960F8D6";
  const AMOUNT = ethers.parseEther("100"); // stake 100 TRK
  const LOCK_OPTION = 0; // 0 = 30 days, 1 = 90 days, 2 = 180 days

  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);

  const token = await ethers.getContractAt("TrackerToken", TOKEN_ADDRESS);
  const staking = await ethers.getContractAt("Staking", STAKING_ADDRESS);

  console.log("Approving staking contract to spend", ethers.formatEther(AMOUNT), "TRK...");
  const approveTx = await token.approve(STAKING_ADDRESS, AMOUNT);
  await approveTx.wait();
  console.log("Approved.");

  console.log("Staking...");
  const stakeTx = await staking.stake(AMOUNT, LOCK_OPTION);
  await stakeTx.wait();
  console.log("Staked successfully!");

  const positions = await staking.positionsOf(signer.address);
  console.log("Positions:", positions);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
