// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Staking} from "tracker/Staking.sol";
import {TrackerToken} from "tracker/TrackerToken.sol";
import {StakingFixed} from "../src/StakingFixed.sol";

/// Each attack is run against the ORIGINAL contract (as deployed on Sepolia) and against
/// StakingFixed. Tests named `_original_succeeds` document a real weakness; `_fixed_fails`
/// shows the fix stops it; `_fails` means the original already defends against it.
contract StakingAttacksTest is Test {
    TrackerToken internal trk;
    Staking internal staking;
    StakingFixed internal fixd;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        vm.startPrank(owner);
        trk = new TrackerToken();
        staking = new Staking(IERC20(address(trk)));
        fixd = new StakingFixed(IERC20(address(trk)));
        trk.transfer(alice, 10_000e18);
        trk.transfer(bob, 10_000e18);
        vm.stopPrank();
        address[3] memory us = [alice, bob, attacker];
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(us[i]);
            trk.approve(address(staking), type(uint256).max);
            trk.approve(address(fixd), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _fundOriginal(uint256 amt) internal {
        vm.startPrank(owner);
        trk.approve(address(staking), amt);
        staking.fundRewardPool(amt);
        vm.stopPrank();
    }

    // ==================================================================
    // Finding 1: rewards are paid out of other users' principal
    // ==================================================================

    /// With no reward funding at all, alice still "earns" 25% and is paid it from bob's
    /// deposit. Bob, who did nothing wrong, can no longer withdraw.
    function test_F1_rewardsPaidFromPrincipal_original_succeeds() public {
        vm.prank(alice);
        staking.stake(1_000e18, 2); // 180 days, 25%
        vm.prank(bob);
        staking.stake(1_000e18, 0); // 30 days, 5%
        skip(365 days);

        vm.prank(alice);
        staking.withdraw(0);
        assertEq(trk.balanceOf(alice), 10_000e18 + 250e18); // +250 that nobody funded

        assertEq(trk.balanceOf(address(staking)), 750e18); // bob's 1,000 is now 750
        vm.prank(bob);
        vm.expectRevert(); // ERC20InsufficientBalance: bob's principal is gone
        staking.withdraw(0);
    }

    function test_F1_rewardsPaidFromPrincipal_fixed_fails() public {
        vm.prank(alice);
        fixd.stake(1_000e18, 2);
        vm.prank(bob);
        fixd.stake(1_000e18, 0);
        skip(365 days);

        vm.prank(alice);
        fixd.withdraw(0); // empty reward pool: principal back, reward shortfall logged
        assertEq(trk.balanceOf(alice), 10_000e18);
        vm.prank(bob);
        fixd.withdraw(0);
        assertEq(trk.balanceOf(bob), 10_000e18); // bob is whole
    }

    /// Even ONE staker alone can't get their own deposit back if the pool is empty:
    /// withdraw() pays the reward first, then the principal transfer fails, and the whole
    /// call reverts. The principal is stuck until the owner funds the pool.
    function test_F1b_emptyPoolLocksPrincipal_original_succeeds() public {
        vm.prank(alice);
        staking.stake(1_000e18, 0);
        skip(31 days);
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance(staking, 1000, 1000 + reward)
        staking.withdraw(0);
        assertEq(trk.balanceOf(address(staking)), 1_000e18); // alice's money, unreachable by alice
    }

    function test_F1b_emptyPoolStillReturnsPrincipal_fixed() public {
        vm.prank(alice);
        fixd.stake(1_000e18, 0);
        skip(31 days);
        vm.prank(alice);
        fixd.withdraw(0);
        assertEq(trk.balanceOf(alice), 10_000e18);
    }

    /// The reward pool is finite (200,000 TRK on Sepolia) but obligations grow forever.
    /// Once accrued rewards exceed the funding, every claim eats principal.
    function test_F1_fundedPoolStillInsolventOverTime_original_succeeds() public {
        vm.startPrank(owner);
        trk.approve(address(staking), 100e18);
        staking.fundRewardPool(100e18); // pool covers 100 TRK of rewards
        vm.stopPrank();
        vm.prank(alice);
        staking.stake(1_000e18, 2);
        vm.prank(bob);
        staking.stake(1_000e18, 2);
        skip(2 * 365 days); // each is owed 500, pool + principals = 2,100

        vm.prank(alice);
        staking.withdraw(0); // takes 1,000 + 500
        vm.prank(bob);
        vm.expectRevert(); // 600 left for bob's 1,500
        staking.withdraw(0);
    }

    // ==================================================================
    // Finding 2: the lock is optional after it expires
    // ==================================================================

    /// A 180-day position keeps earning 25% APY after unlocking, while being withdrawable
    /// at any moment with no penalty. After day 180 it's a flexible 25% account.
    function test_F2_rewardsAccrueForeverAfterUnlock_original_succeeds() public {
        vm.prank(alice);
        staking.stake(1_000e18, 2);
        skip(3 * 365 days);
        assertEq(staking.pendingRewards(alice, 0), 750e18); // 3 years at 25%, for a 180-day lock
    }

    function test_F2_rewardsStopAtUnlock_fixed() public {
        vm.prank(alice);
        fixd.stake(1_000e18, 2);
        skip(3 * 365 days);
        uint256 principal = 1_000e18;
        assertEq(fixd.pendingRewards(alice, 0), (principal * 2500 * 180 days) / (10_000 * 365 days));
    }

    // ==================================================================
    // Whoever holds the TrackerToken owner key
    // ==================================================================

    /// F1 lets any large staker walk off with other stakers' principal. Normally that
    /// takes real capital. The TrackerToken owner key (an earlier deployer key was
    /// exposed in contracts/.env.example; see OPS-1 in SECURITY.md) makes it free: mint TRK, stake it in the 180-day tier sized so its reward equals
    /// everyone else's deposits, wait for the lock, withdraw.
    function test_ownerKeyHolder_drainsAllPrincipal_original_succeeds() public {
        vm.prank(alice);
        staking.stake(5_000e18, 0);
        vm.prank(bob);
        staking.stake(5_000e18, 0);
        uint256 victims = trk.balanceOf(address(staking)); // 10,000 TRK

        // reward after 180 days at 25% = victims  =>  stake = victims * 365 / (0.25 * 180)
        uint256 stakeAmt = (victims * 10_000 * 365) / (2_500 * 180);
        vm.prank(owner); // = anyone holding the owner key
        trk.mint(attacker, stakeAmt);
        vm.prank(attacker);
        staking.stake(stakeAmt, 2);
        skip(180 days);
        vm.prank(attacker);
        staking.withdraw(0);

        uint256 profit = trk.balanceOf(attacker) - stakeAmt;
        assertGt(profit, victims * 99 / 100); // ~all of alice's and bob's deposits
        vm.prank(alice);
        vm.expectRevert();
        staking.withdraw(0);
    }

    function test_ownerKeyHolder_cannotTouchPrincipal_fixed_fails() public {
        vm.prank(alice);
        fixd.stake(5_000e18, 0);
        vm.prank(bob);
        fixd.stake(5_000e18, 0);

        vm.prank(owner);
        trk.mint(attacker, 1e9 * 1e18);
        vm.prank(attacker);
        fixd.stake(1e9 * 1e18, 2);
        skip(1 days);
        vm.prank(attacker);
        vm.expectRevert(bytes("reward pool empty")); // nothing was funded: there is nothing to take
        fixd.claimRewards(0);

        skip(30 days);
        vm.prank(alice);
        fixd.withdraw(0);
        assertEq(trk.balanceOf(alice), 10_000e18); // principal intact
    }

    // ==================================================================
    // Attacks the original already stops
    // ==================================================================

    /// A token with a transfer hook (ERC-777 style) calls back into the receiver.
    /// The attacker re-enters withdraw() from the hook to be paid twice. TRK has no hook,
    /// so this guards against swapping in such a token; ReentrancyGuard blocks it.
    function test_reentrancyThroughTokenHook_fails() public {
        HookToken hook = new HookToken();
        Staking s = new Staking(IERC20(address(hook)));
        Reenterer r = new Reenterer(s, hook);
        hook.setHook(address(r), true);
        hook.mint(address(r), 100e18);
        hook.mint(address(s), 1_000e18); // other users' funds in the contract
        r.stakeAll();
        skip(31 days);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.attack();
    }

    function test_earlyWithdrawCannotDodgePenalty_fails() public {
        _fundOriginal(1_000e18);
        vm.prank(alice);
        staking.stake(1_000e18, 2);
        skip(179 days);
        vm.prank(alice);
        staking.withdraw(0);
        uint256 principal = 1_000e18;
        uint256 reward = (principal * 2500 * 179 days) / (10_000 * 365 days);
        assertEq(trk.balanceOf(alice), 10_000e18 - 100e18 + reward); // paid the 10%
    }

    function test_doubleWithdrawOrClaimAfterWithdraw_fails() public {
        _fundOriginal(1_000e18);
        vm.prank(alice);
        staking.stake(1_000e18, 0);
        skip(31 days);
        vm.startPrank(alice);
        staking.withdraw(0);
        vm.expectRevert(bytes("already withdrawn"));
        staking.withdraw(0);
        vm.expectRevert(bytes("no rewards accrued"));
        staking.claimRewards(0);
        vm.stopPrank();
    }

    /// Positions are indexed per msg.sender, so there is no way to name someone else's.
    function test_cannotWithdrawSomeoneElsesPosition_fails() public {
        vm.prank(alice);
        staking.stake(1_000e18, 0);
        skip(31 days);
        vm.prank(attacker);
        vm.expectRevert(); // panic: index out of bounds on attacker's own (empty) array
        staking.withdraw(0);
    }

    function test_onlyOwnerFundsPool_fails() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        staking.fundRewardPool(1);
    }

    // ==================================================================
    // Fuzz: the fix keeps principal covered for any sequence of two stakers
    // ==================================================================

    function testFuzz_fixed_principalAlwaysCovered(uint256 a, uint256 b, uint8 ta, uint8 tb, uint256 wait, uint256 fund)
        public
    {
        a = bound(a, 1, 10_000e18);
        b = bound(b, 1, 10_000e18);
        fund = bound(fund, 0, 1_000e18);
        wait = bound(wait, 0, 5 * 365 days);
        if (fund > 0) {
            vm.startPrank(owner);
            trk.approve(address(fixd), fund);
            fixd.fundRewardPool(fund);
            vm.stopPrank();
        }
        vm.prank(alice);
        fixd.stake(a, uint8(bound(ta, 0, 2)));
        vm.prank(bob);
        fixd.stake(b, uint8(bound(tb, 0, 2)));
        skip(wait);
        vm.prank(alice);
        fixd.withdraw(0);
        assertGe(trk.balanceOf(address(fixd)), fixd.totalStaked() + fixd.rewardReserve());
        vm.prank(bob);
        fixd.withdraw(0); // never reverts: bob's principal is always there
        assertEq(fixd.totalStaked(), 0);
    }
}

/// ERC-20 that calls `onTokenReceived` on opted-in recipients after every transfer (ERC-777 style).
contract HookToken is ERC20 {
    mapping(address => bool) public hooked; // receivers that opted in to the callback

    constructor() ERC20("Hook", "HOOK") {}

    function setHook(address who, bool on) external {
        hooked[who] = on;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && hooked[to]) {
            Reenterer(to).onTokenReceived();
        }
    }
}

contract Reenterer {
    Staking internal s;
    HookToken internal t;
    bool internal attacking;

    constructor(Staking s_, HookToken t_) {
        s = s_;
        t = t_;
    }

    function stakeAll() external {
        t.approve(address(s), type(uint256).max);
        s.stake(100e18, 0);
    }

    function attack() external {
        attacking = true;
        s.withdraw(0);
    }

    function onTokenReceived() external {
        if (attacking) {
            attacking = false;
            s.withdraw(0); // second withdrawal of the same position, mid-transfer
        }
    }
}
