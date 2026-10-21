package com.tracker.portfolio.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Arrays;
import java.util.List;

/**
 * Binds the `web3.*` block in application.yml. Kept as a plain properties
 * class (rather than scattering @Value everywhere) so every on-chain
 * setting lives in one place.
 */
@ConfigurationProperties(prefix = "web3")
public class Web3Properties {

    private String rpcUrl;
    private String tokenAddress;
    private String stakingAddress;
    private long pollIntervalMs = 60_000L;
    private String watchedWallets = "";

    public String getRpcUrl() {
        return rpcUrl;
    }

    public void setRpcUrl(String rpcUrl) {
        this.rpcUrl = rpcUrl;
    }

    public String getTokenAddress() {
        return tokenAddress;
    }

    public void setTokenAddress(String tokenAddress) {
        this.tokenAddress = tokenAddress;
    }

    public String getStakingAddress() {
        return stakingAddress;
    }

    public void setStakingAddress(String stakingAddress) {
        this.stakingAddress = stakingAddress;
    }

    public long getPollIntervalMs() {
        return pollIntervalMs;
    }

    public void setPollIntervalMs(long pollIntervalMs) {
        this.pollIntervalMs = pollIntervalMs;
    }

    public String getWatchedWallets() {
        return watchedWallets;
    }

    public void setWatchedWallets(String watchedWallets) {
        this.watchedWallets = watchedWallets;
    }

    public List<String> watchedWalletList() {
        if (watchedWallets == null || watchedWallets.isBlank()) {
            return List.of();
        }
        return Arrays.stream(watchedWallets.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }
}
