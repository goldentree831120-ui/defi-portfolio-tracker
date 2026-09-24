const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Token = await ethers.getContractFactory("TrackerToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  console.log("TrackerToken deployed to:", await token.getAddress());

  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(await token.getAddress());
  await staking.waitForDeployment();
  console.log("Staking deployed to:", await staking.getAddress());

  // Fund the reward pool with 20% of supply so the tracker has something to read.
  const fundAmount = ethers.parseEther("200000");
  await (await token.approve(await staking.getAddress(), fundAmount)).wait();
  await (await staking.fundRewardPool(fundAmount)).wait();
  console.log("Reward pool funded with", ethers.formatEther(fundAmount), "TRK");

  console.log("\nCopy these into backend/src/main/resources/application.yml:");
  console.log("token-address:", await token.getAddress());
  console.log("staking-address:", await staking.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
