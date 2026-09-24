const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Staking", function () {
  let token, staking, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TrackerToken");
    token = await Token.deploy();

    const Staking = await ethers.getContractFactory("Staking");
    staking = await Staking.deploy(await token.getAddress());

    // fund alice/bob and the reward pool
    await token.transfer(alice.address, ethers.parseEther("1000"));
    await token.transfer(bob.address, ethers.parseEther("1000"));
    await token.approve(await staking.getAddress(), ethers.parseEther("100000"));
    await staking.fundRewardPool(ethers.parseEther("50000"));
  });

  it("lets a user stake into the 30-day tier and accrue rewards over time", async function () {
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(alice).stake(ethers.parseEther("100"), 0); // 5% APY tier

    await time.increase(30 * 24 * 60 * 60); // fast-forward 30 days

    const pending = await staking.pendingRewards(alice.address, 0);
    // ~100 * 5% * (30/365) ≈ 0.4109 tokens
    expect(pending).to.be.closeTo(ethers.parseEther("0.4109"), ethers.parseEther("0.01"));
  });

  it("applies a 10% early-exit penalty when withdrawing before lock ends", async function () {
    await token.connect(bob).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(bob).stake(ethers.parseEther("100"), 1); // 90-day tier

    await time.increase(10 * 24 * 60 * 60); // only 10 of 90 days elapsed

    const balBefore = await token.balanceOf(bob.address);
    await staking.connect(bob).withdraw(0);
    const balAfter = await token.balanceOf(bob.address);

    // principal returned should be <= 90 (100 - 10% penalty), plus a small reward
    const principalReturned = balAfter - balBefore;
    expect(principalReturned).to.be.lt(ethers.parseEther("91"));
    expect(principalReturned).to.be.gt(ethers.parseEther("89"));
  });

  it("returns full principal with no penalty once the lock has expired", async function () {
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("50"));
    await staking.connect(alice).stake(ethers.parseEther("50"), 0); // 30-day tier

    await time.increase(31 * 24 * 60 * 60);

    const balBefore = await token.balanceOf(alice.address);
    await staking.connect(alice).withdraw(0);
    const balAfter = await token.balanceOf(alice.address);

    expect(balAfter - balBefore).to.be.gte(ethers.parseEther("50"));
  });

  it("reverts if staking with an invalid lock option", async function () {
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("10"));
    await expect(staking.connect(alice).stake(ethers.parseEther("10"), 9)).to.be.revertedWith(
      "invalid lock option"
    );
  });

  it("reverts on double withdrawal of the same position", async function () {
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("10"));
    await staking.connect(alice).stake(ethers.parseEther("10"), 0);
    await time.increase(31 * 24 * 60 * 60);

    await staking.connect(alice).withdraw(0);
    await expect(staking.connect(alice).withdraw(0)).to.be.revertedWith("already withdrawn");
  });
});
