// A bare Hardhat network for tests: automine on, chain id 31337. No compilation happens here;
// contracts are deployed from ../contracts/artifacts (run `npx hardhat compile` there once).
module.exports = { networks: { hardhat: { chainId: 31337 } } };
