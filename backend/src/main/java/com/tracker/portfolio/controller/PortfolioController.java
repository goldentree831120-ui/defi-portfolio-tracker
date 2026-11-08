package com.tracker.portfolio.controller;

import com.tracker.portfolio.dto.PortfolioResponse;
import com.tracker.portfolio.model.PortfolioSnapshot;
import com.tracker.portfolio.repository.PortfolioSnapshotRepository;
import com.tracker.portfolio.service.ChainReaderService;
import com.tracker.portfolio.service.SnapshotPollingService;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/wallets")
public class PortfolioController {

    private final PortfolioSnapshotRepository repository;
    private final SnapshotPollingService pollingService;
    private final ChainReaderService chainReader;

    public PortfolioController(PortfolioSnapshotRepository repository, SnapshotPollingService pollingService,
                                ChainReaderService chainReader) {
        this.repository = repository;
        this.pollingService = pollingService;
        this.chainReader = chainReader;
    }

  
    @GetMapping("/{address}")
    public ResponseEntity<PortfolioResponse> getLatest(@PathVariable String address) {
        return repository.findTopByWalletAddressIgnoreCaseOrderByCapturedAtDesc(address)
                .map(snapshot -> ResponseEntity.ok(toResponse(snapshot)))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

 
    @PostMapping("/{address}/refresh")
    public ResponseEntity<PortfolioResponse> refresh(@PathVariable String address) {
        PortfolioSnapshot snapshot = pollingService.refreshWallet(address);
        return ResponseEntity.ok(toResponse(snapshot));
    }

    
    @GetMapping("/{address}/history")
    public ResponseEntity<List<PortfolioResponse>> history(
            @PathVariable String address,
            @RequestParam(defaultValue = "30") int limit
    ) {
        List<PortfolioSnapshot> snapshots = repository.findByWalletAddressIgnoreCaseOrderByCapturedAtDesc(
                address, PageRequest.of(0, Math.min(limit, 200)));

        List<PortfolioResponse> body = snapshots.stream()
                .map(s -> PortfolioResponse.from(s, List.of()))
                .toList();

        return ResponseEntity.ok(body);
    }

    private PortfolioResponse toResponse(PortfolioSnapshot snapshot) {
        List<PortfolioResponse.PositionView> positions = chainReader.allPositions(snapshot.getWalletAddress())
                .stream()
                .map(p -> new PortfolioResponse.PositionView(
                        p.index(),
                        PortfolioResponse.toTokenUnits(p.amount().toString()),
                        Instant.ofEpochSecond(p.startTime().longValueExact()),
                        p.lockDuration().longValueExact(),
                        p.rewardRateBps().intValueExact(),
                        p.withdrawn(),
                        PortfolioResponse.toTokenUnits(p.pendingRewards().toString()),
                        Instant.now().getEpochSecond() >= p.startTime().longValueExact() + p.lockDuration().longValueExact()
                ))
                .toList();

        return PortfolioResponse.from(snapshot, positions);
    }
}
