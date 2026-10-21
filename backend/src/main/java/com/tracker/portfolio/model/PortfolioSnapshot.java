package com.tracker.portfolio.model;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * A point-in-time snapshot of one wallet's on-chain position, as read via
 * Web3j and cached here so the API doesn't have to hit the RPC node on
 * every request. {@link com.tracker.portfolio.service.SnapshotPollingService}
 * writes new rows on a schedule; the REST layer mostly reads from here.
 *
 * Wei amounts are stored as strings (not long/double) because ERC-20
 * balances routinely exceed Java's numeric range at 18-decimal precision.
 */
@Entity
@Table(name = "portfolio_snapshot", indexes = {
        @Index(name = "idx_wallet_captured", columnList = "walletAddress,capturedAt")
})
public class PortfolioSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 42)
    private String walletAddress;

    /** Raw token balance, in wei, as a decimal string. */
    @Column(nullable = false, length = 78)
    private String tokenBalanceWei;

    /** Sum of `amount` across all non-withdrawn staking positions, in wei. */
    @Column(nullable = false, length = 78)
    private String stakedTotalWei;

    /** Sum of pendingRewards() across all non-withdrawn positions, in wei. */
    @Column(nullable = false, length = 78)
    private String pendingRewardsWei;

    @Column(nullable = false)
    private int openPositionCount;

    @Column(nullable = false)
    private Instant capturedAt;

    protected PortfolioSnapshot() {
        // JPA
    }

    public PortfolioSnapshot(String walletAddress, String tokenBalanceWei, String stakedTotalWei,
                              String pendingRewardsWei, int openPositionCount, Instant capturedAt) {
        this.walletAddress = walletAddress;
        this.tokenBalanceWei = tokenBalanceWei;
        this.stakedTotalWei = stakedTotalWei;
        this.pendingRewardsWei = pendingRewardsWei;
        this.openPositionCount = openPositionCount;
        this.capturedAt = capturedAt;
    }

    public Long getId() {
        return id;
    }

    public String getWalletAddress() {
        return walletAddress;
    }

    public String getTokenBalanceWei() {
        return tokenBalanceWei;
    }

    public String getStakedTotalWei() {
        return stakedTotalWei;
    }

    public String getPendingRewardsWei() {
        return pendingRewardsWei;
    }

    public int getOpenPositionCount() {
        return openPositionCount;
    }

    public Instant getCapturedAt() {
        return capturedAt;
    }
}
