package com.tracker.portfolio.dto;

import com.tracker.portfolio.model.PortfolioSnapshot;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.util.List;

/** API-facing view of a snapshot: wei amounts converted to human-readable token units (18 decimals). */
public record PortfolioResponse(
        String walletAddress,
        BigDecimal tokenBalance,
        BigDecimal stakedTotal,
        BigDecimal pendingRewards,
        int openPositionCount,
        Instant capturedAt,
        List<PositionView> positions
) {
    private static final BigInteger WEI_PER_TOKEN = BigInteger.TEN.pow(18);

    public static PortfolioResponse from(PortfolioSnapshot snapshot, List<PositionView> positions) {
        return new PortfolioResponse(
                snapshot.getWalletAddress(),
                toTokenUnits(snapshot.getTokenBalanceWei()),
                toTokenUnits(snapshot.getStakedTotalWei()),
                toTokenUnits(snapshot.getPendingRewardsWei()),
                snapshot.getOpenPositionCount(),
                snapshot.getCapturedAt(),
                positions
        );
    }

    public static BigDecimal toTokenUnits(String weiAmount) {
        return new BigDecimal(new BigInteger(weiAmount)).divide(new BigDecimal(WEI_PER_TOKEN));
    }

    public record PositionView(
            int index,
            BigDecimal amount,
            Instant startTime,
            long lockDurationSeconds,
            int rewardRateBps,
            boolean withdrawn,
            BigDecimal pendingRewards,
            boolean unlocked
    ) {
    }
}
