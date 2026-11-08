package com.tracker.portfolio.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.http.HttpService;


@Configuration
@EnableConfigurationProperties(Web3Properties.class)
public class Web3Config {

    @Bean
    public Web3j web3j(Web3Properties properties) {
        return Web3j.build(new HttpService(properties.getRpcUrl()));
    }
}
