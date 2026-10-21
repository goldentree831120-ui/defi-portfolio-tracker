package com.tracker.portfolio.service;

import com.tracker.portfolio.config.Web3Properties;
import com.tracker.portfolio.model.PortfolioSnapshot;
import com.tracker.portfolio.repository.PortfolioSnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;

/**
 * Periodically re-reads each watched wallet's on-chain state and stores a
 * snapshot. This is the piece that makes the difference between "hits an
 * RPC node on every page load" (slow, rate-limited, fragile) and a backend
 * that behaves like a real service with its own cache. In production this
 * would likely be driven by chain event logs instead of polling every
 * wallet on a timer - see the README for that tradeoff.
 */
@Service
public class SnapshotPollingService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotPollingService.class);

    private final ChainReaderService chainReader;
    private final PortfolioSnapshotRepository repository;
    private final Web3Properties props;

    public SnapshotPollingService(ChainReaderService chainReader, PortfolioSnapshotRepository repository,
                                   Web3Properties props) {
        this.chainReader = chainReader;
        this.repository = repository;
        this.props = props;
    }

    @Scheduled(fixedDelayString = "${web3.poll-interval-ms:60000}")
    public void pollWatchedWallets() {
        List<String> wallets = props.watchedWalletList();
        if (wallets.isEmpty()) {
            log.debug("No wallets configured in web3.watched-wallets - skipping scheduled poll");
            return;
        }
        wallets.forEach(this::refreshWallet);
    }

    /** Reads fresh on-chain state for one wallet and persists a snapshot. Also used by the on-demand API. */
    public PortfolioSnapshot refreshWallet(String walletAddress) {
        try {
            BigInteger tokenBalance = chainReader.tokenBalanceOf(walletAddress);
            List<ChainReaderService.StakingPosition> positions = chainReader.allPositions(walletAddress);

            BigInteger stakedTotal = positions.stream()
                    .filter(p -> !p.withdrawn())
                    .map(ChainReaderService.StakingPosition::amount)
                    .reduce(BigInteger.ZERO, BigInteger::add);

            BigInteger pendingRewards = positions.stream()
                    .filter(p -> !p.withdrawn())
                    .map(ChainReaderService.StakingPosition::pendingRewards)
                    .reduce(BigInteger.ZERO, BigInteger::add);

            long openCount = positions.stream().filter(p -> !p.withdrawn()).count();

            PortfolioSnapshot snapshot = new PortfolioSnapshot(
                    walletAddress.toLowerCase(),
                    tokenBalance.toString(),
                    stakedTotal.toString(),
                    pendingRewards.toString(),
                    (int) openCount,
                    Instant.now()
            );

            repository.save(snapshot);
            log.info("Refreshed snapshot for {}: balance={}, staked={}, pendingRewards={}",
                    walletAddress, tokenBalance, stakedTotal, pendingRewards);
            return snapshot;
        } catch (Exception e) {
            log.error("Failed to refresh snapshot for wallet {}", walletAddress, e);
            throw e;
        }
    }
}
