# DeFi Portfolio Tracker

A full-stack Web3 project built with **Java, Spring Boot, Web3j, Solidity, and a small HTML/JS dashboard**.

The idea was simple: instead of having the frontend talk directly to an Ethereum RPC for everything, I wanted to build a backend that reads blockchain data, stores snapshots, and exposes it through a REST API.

The project tracks:

* ERC-20 token balances
* Staking positions
* Pending staking rewards
* Lock periods and APY
* Historical balance/staking snapshots

The contracts run on the **Ethereum Sepolia testnet**.

## Project Structure

```text
contracts/
    Solidity contracts, deployment scripts, and tests

backend/
    Spring Boot + Web3j backend
    REST API
    Database/cache
    Static HTML/JS dashboard
```

## How It Works

The flow is roughly:

```text
Ethereum / Sepolia
        ↓
     Web3j
        ↓
 Spring Boot Backend
        ↓
   H2 / PostgreSQL
        ↓
     REST API
        ↓
 HTML/JS Dashboard
```

The backend periodically reads the required data from the blockchain and stores a snapshot in the database.

The dashboard then reads from the API instead of making blockchain calls directly.

This keeps the frontend simple and gives the project a more realistic backend architecture.

---

# 1. Smart Contracts

The `contracts` directory contains two Solidity contracts:

### TrackerToken

A basic ERC-20 token based on OpenZeppelin.

* Initial supply: **1,000,000 tokens**
* Used as the token for the staking contract

### Staking

A simple tiered staking contract with three lock periods:

| Lock Period | APY |
| ----------- | --: |
| 30 days     |  5% |
| 90 days     | 12% |
| 180 days    | 25% |

There is also a **10% penalty on early withdrawal**.

The contract uses OpenZeppelin's `ReentrancyGuard` for state-changing functions.

The tests cover:

* Reward calculation over time
* Early withdrawal penalty
* Full withdrawal after the lock period
* Invalid lock tier
* Double withdrawal

## Running the Contracts

```bash
cd contracts

npm install

cp .env.example .env
```

Add your Sepolia RPC URL and a test wallet's private key to `.env`.

Then:

```bash
npx hardhat compile
npx hardhat test
```

To deploy:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The deployment script prints the addresses of the deployed contracts. These addresses are needed by the backend.

### Getting a Sepolia RPC URL

You can use a provider such as [Alchemy](https://www.alchemy.com/?utm_source=chatgpt.com) or [Infura](https://www.infura.io/?utm_source=chatgpt.com).

For testing, use a **separate wallet** containing only testnet funds. Never put the private key of a wallet containing real assets into `.env`.

Sepolia ETH can be obtained from a Sepolia faucet.

> The contracts were also tested in a sandboxed environment where direct Solidity compiler downloads were unavailable. In that environment I used the `solc` npm package and ran Hardhat with `--no-compile`. On a normal machine, the standard Hardhat commands above should work.

---

# 2. Backend

The backend is a **Spring Boot application using Web3j**.

After deploying the contracts, configure the following environment variables:

```bash
export WEB3_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
export TOKEN_ADDRESS=0x...
export STAKING_ADDRESS=0x...
export WATCHED_WALLETS=0xYourTestWallet
```

Then start the application:

```bash
cd backend
mvn spring-boot:run
```

The application runs on:

```text
http://localhost:8080
```

## REST API

| Method | Endpoint                                  | Description                              |
| ------ | ----------------------------------------- | ---------------------------------------- |
| GET    | `/api/wallets/{address}`                  | Get the latest cached snapshot           |
| POST   | `/api/wallets/{address}/refresh`          | Read the latest data from the blockchain |
| GET    | `/api/wallets/{address}/history?limit=30` | Get historical snapshots                 |

For example:

```text
GET /api/wallets/0x123...
```

returns the latest cached wallet information.

To force a blockchain refresh:

```text
POST /api/wallets/0x123.../refresh
```

---

## Reading Blockchain Data with Web3j

One part of the backend I wanted to understand properly was how contract calls actually work underneath Web3j.

Instead of using a generated contract wrapper, `ChainReaderService` builds the contract calls using Web3j's:

```text
FunctionEncoder
FunctionReturnDecoder
```

This means the service explicitly handles the encoding of function calls and decoding of returned values.

For the staking positions, the contract's mapping getter can be called directly:

```text
positions(address,uint256)
```

The Solidity compiler generates this getter for the mapping, so the backend can retrieve the individual fields without having to deal with a dynamic array of structs.

It's a little more manual, but it makes the interaction with the contract ABI easier to understand.

---

# Snapshot Polling

`SnapshotPollingService` periodically refreshes the wallets configured in `WATCHED_WALLETS`.

The default polling interval is:

```text
60 seconds
```

The general flow is:

```text
Scheduler
    ↓
Read wallet data from Ethereum
    ↓
Create snapshot
    ↓
Store snapshot in database
    ↓
REST API reads cached data
```

This means most API requests don't need to make another RPC call.

For a larger system, I wouldn't keep polling every wallet forever. A better approach would be to listen for contract events such as:

```text
Staked
Withdrawn
RewardsClaimed
```

and update the relevant wallet data when something actually changes.

That's also one of the main areas I'd improve if I were taking this project further.

---

# Database

The project uses **H2 by default**, so there is no database setup required for local development.

For example:

```text
H2
 ↓
Snapshots
 ↓
REST API
```

PostgreSQL can also be used by changing the database configuration in `application.yml`.

The database stores wallet snapshots so that the API can return historical data and the dashboard can display changes over time.

---

# 3. Dashboard

The frontend is intentionally small.

It's a single HTML/JavaScript page located at:

```text
backend/src/main/resources/static/index.html
```

There is no React application or separate frontend build process.

Spring Boot serves the page directly.

The dashboard lets you:

* Enter a wallet address
* Load the latest cached data
* Force a blockchain refresh
* View token balance
* View total staked amount
* View pending rewards
* View individual staking positions
* See lock period, APY, and position status
* View historical snapshots

The goal here wasn't to build a complicated UI. Most of the work in this project is in the **smart contracts and backend integration**.

---

# Running the Full Project

### 1. Deploy the contracts

```bash
cd contracts

npm install
cp .env.example .env

npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the deployed contract addresses.

### 2. Configure the backend

```bash
cd backend

export WEB3_RPC_URL=...
export TOKEN_ADDRESS=...
export STAKING_ADDRESS=...
export WATCHED_WALLETS=...
```

### 3. Start Spring Boot

```bash
mvn spring-boot:run
```

### 4. Open the dashboard

```text
http://localhost:8080
```

---

# What I Wanted to Learn From This

This project was mainly about putting together the different pieces of a Web3 backend rather than just building a staking contract.

In particular, I wanted hands-on experience with:

* Solidity contract development
* Ethereum RPC calls
* Web3j
* ABI encoding/decoding
* Spring Boot REST APIs
* Blockchain data caching
* Scheduled background jobs
* H2/PostgreSQL persistence
* Contract event handling
* Connecting on-chain data to a backend service

It also gave me a chance to use my Java/backend experience in a Web3 project instead of relying entirely on a JavaScript frontend.

---

# Possible Improvements

There are a few directions I'd take this project next:

* Replace polling with event-driven updates using Web3j
* Track multiple staking protocols
* Add more ERC-20 tokens
* Add wallet-level portfolio valuation
* Add authentication and user-managed wallets
* Add PostgreSQL for a production deployment
* Deploy the backend publicly
* Add more contract integration tests
* Add monitoring and error handling for RPC failures

The current version is intentionally kept small enough that the entire flow — **Solidity → Ethereum → Web3j → Spring Boot → database → REST API → dashboard** — can be understood without too much abstraction.
