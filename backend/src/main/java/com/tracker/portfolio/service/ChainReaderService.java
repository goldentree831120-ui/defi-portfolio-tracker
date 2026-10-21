package com.tracker.portfolio.service;

import com.tracker.portfolio.config.Web3Properties;
import org.springframework.stereotype.Service;
import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.FunctionReturnDecoder;
import org.web3j.abi.TypeReference;
import org.web3j.abi.datatypes.Address;
import org.web3j.abi.datatypes.Bool;
import org.web3j.abi.datatypes.Function;
import org.web3j.abi.datatypes.generated.Uint256;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.request.Transaction;
import org.web3j.protocol.core.methods.response.EthCall;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads on-chain state with hand-encoded ABI calls instead of a generated
 * contract wrapper. Web3j can generate typed wrapper classes from an ABI +
 * bytecode (via `web3j generate solidity`), but that requires the Solidity
 * compiler's JSON output as a build step. Encoding calls directly with
 * {@link FunctionEncoder}/{@link FunctionReturnDecoder} avoids that extra
 * toolchain step and is worth understanding on its own - it's what a
 * generated wrapper does under the hood.
 */
@Service
public class ChainReaderService {

    private final Web3j web3j;
    private final Web3Properties props;

    public ChainReaderService(Web3j web3j, Web3Properties props) {
        this.web3j = web3j;
        this.props = props;
    }

    /** ERC-20 balanceOf(address) -> uint256, in wei. */
    public BigInteger tokenBalanceOf(String walletAddress) {
        Function function = new Function(
                "balanceOf",
                List.of(new Address(walletAddress)),
                List.of(new TypeReference<Uint256>() {})
        );
        return callAndDecodeUint256(props.getTokenAddress(), function);
    }

    /** Staking.positionsCount(address) -> uint256. */
    public int stakingPositionsCount(String walletAddress) {
        Function function = new Function(
                "positionsCount",
                List.of(new Address(walletAddress)),
                List.of(new TypeReference<Uint256>() {})
        );
        return callAndDecodeUint256(props.getStakingAddress(), function).intValueExact();
    }

    /**
     * Reads one staking position via the compiler-generated mapping getter
     * `positions(address,uint256)`, which returns the struct's fields as
     * plain scalars in declaration order (Solidity flattens struct getters
     * for public mapping/array state) - no struct ABI decoding required.
     */
    public StakingPosition stakingPositionAt(String walletAddress, int index) {
        Function function = new Function(
                "positions",
                List.of(new Address(walletAddress), new Uint256(BigInteger.valueOf(index))),
                List.of(
                        new TypeReference<Uint256>() {}, // amount
                        new TypeReference<Uint256>() {}, // startTime
                        new TypeReference<Uint256>() {}, // lockDuration
                        new TypeReference<Uint256>() {}, // rewardRateBps
                        new TypeReference<Uint256>() {}, // lastClaimTime
                        new TypeReference<Bool>() {}      // withdrawn
                )
        );

        List<org.web3j.abi.datatypes.Type> decoded = callAndDecode(props.getStakingAddress(), function);

        BigInteger amount = (BigInteger) decoded.get(0).getValue();
        BigInteger startTime = (BigInteger) decoded.get(1).getValue();
        BigInteger lockDuration = (BigInteger) decoded.get(2).getValue();
        BigInteger rewardRateBps = (BigInteger) decoded.get(3).getValue();
        BigInteger lastClaimTime = (BigInteger) decoded.get(4).getValue();
        boolean withdrawn = (Boolean) decoded.get(5).getValue();

        return new StakingPosition(index, amount, startTime, lockDuration, rewardRateBps, lastClaimTime, withdrawn);
    }

    /** Staking.pendingRewards(address,uint256) -> uint256, in wei. */
    public BigInteger pendingRewards(String walletAddress, int positionIndex) {
        Function function = new Function(
                "pendingRewards",
                List.of(new Address(walletAddress), new Uint256(BigInteger.valueOf(positionIndex))),
                List.of(new TypeReference<Uint256>() {})
        );
        return callAndDecodeUint256(props.getStakingAddress(), function);
    }

    /** Convenience: every open (non-withdrawn) position for a wallet, with rewards attached. */
    public List<StakingPosition> allPositions(String walletAddress) {
        int count = stakingPositionsCount(walletAddress);
        List<StakingPosition> result = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            StakingPosition position = stakingPositionAt(walletAddress, i);
            if (!position.withdrawn()) {
                BigInteger reward = pendingRewards(walletAddress, i);
                position = position.withPendingRewards(reward);
            }
            result.add(position);
        }
        return result;
    }

    private BigInteger callAndDecodeUint256(String contractAddress, Function function) {
        List<org.web3j.abi.datatypes.Type> decoded = callAndDecode(contractAddress, function);
        return decoded.isEmpty() ? BigInteger.ZERO : (BigInteger) decoded.get(0).getValue();
    }

    private List<org.web3j.abi.datatypes.Type> callAndDecode(String contractAddress, Function function) {
        String encoded = FunctionEncoder.encode(function);
        try {
            EthCall response = web3j.ethCall(
                    Transaction.createEthCallTransaction(null, contractAddress, encoded),
                    DefaultBlockParameterName.LATEST
            ).send();

            if (response.hasError()) {
                throw new ChainReadException("eth_call failed: " + response.getError().getMessage());
            }
            return FunctionReturnDecoder.decode(response.getValue(), function.getOutputParameters());
        } catch (Exception e) {
            throw new ChainReadException("Failed to read " + function.getName() + " from " + contractAddress, e);
        }
    }

    public record StakingPosition(
            int index,
            BigInteger amount,
            BigInteger startTime,
            BigInteger lockDuration,
            BigInteger rewardRateBps,
            BigInteger lastClaimTime,
            boolean withdrawn,
            BigInteger pendingRewards
    ) {
        StakingPosition(int index, BigInteger amount, BigInteger startTime, BigInteger lockDuration,
                         BigInteger rewardRateBps, BigInteger lastClaimTime, boolean withdrawn) {
            this(index, amount, startTime, lockDuration, rewardRateBps, lastClaimTime, withdrawn, BigInteger.ZERO);
        }

        StakingPosition withPendingRewards(BigInteger reward) {
            return new StakingPosition(index, amount, startTime, lockDuration, rewardRateBps, lastClaimTime, withdrawn, reward);
        }
    }

    public static class ChainReadException extends RuntimeException {
        public ChainReadException(String message) {
            super(message);
        }

        public ChainReadException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
