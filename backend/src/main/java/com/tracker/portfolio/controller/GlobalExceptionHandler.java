package com.tracker.portfolio.controller;

import com.tracker.portfolio.service.ChainReaderService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    /** RPC node unreachable / bad response - a 502 (Bad Gateway) is more honest than a generic 500. */
    @ExceptionHandler(ChainReaderService.ChainReadException.class)
    public ResponseEntity<Map<String, String>> handleChainReadException(ChainReaderService.ChainReadException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Failed to read on-chain data", "details", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
