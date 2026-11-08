package com.tracker.portfolio.model;

import jakarta.persistence.*;

import java.time.Instant;


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

    
    @Column(nullable = false, length = 78)
    private String stakedTotalWei;

   
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
