package com.tracker.portfolio.repository;

import com.tracker.portfolio.model.PortfolioSnapshot;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PortfolioSnapshotRepository extends JpaRepository<PortfolioSnapshot, Long> {

    Optional<PortfolioSnapshot> findTopByWalletAddressIgnoreCaseOrderByCapturedAtDesc(String walletAddress);

    List<PortfolioSnapshot> findByWalletAddressIgnoreCaseOrderByCapturedAtDesc(String walletAddress, Pageable pageable);
}
