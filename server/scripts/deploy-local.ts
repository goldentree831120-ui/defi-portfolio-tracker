// Deploys TrackerToken + Staking to a FRESH local Hardhat chain (used by docker compose's
// local mode). A fresh chain's deployer (account #0) always gets the same addresses for its
// first two contracts, which is what lets the frontend image be built with the Staking address
// baked in. Safe to re-run: if the contracts are already there, it does nothing.
//
//   RPC_URL=http://127.0.0.1:8545 tsx scripts/deploy-local.ts
import { ContractFactory, JsonRpcProvider, parseEther, type BaseContract, type ContractTransactionResponse } from "ethers";
import { loadContract } from "../test/support/contracts.ts";

export const LOCAL = {
  token: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  staking: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;

type Send = Promise<ContractTransactionResponse>;
type Token = BaseContract & { approve(s: string, a: bigint): Send; transfer(t: string, a: bigint): Send };
type Staking = BaseContract & { fundRewardPool(a: bigint): Send };

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });

for (let i = 0; ; i++) {
  try {
    await provider.getBlockNumber();
    break;
  } catch {
    if (i >= 60) throw new Error(`no chain at ${rpcUrl} after 60 s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const chainId = Number((await provider.getNetwork()).chainId);
if (chainId !== 31337) throw new Error(`refusing to deploy: chain id is ${chainId}, this script is for a local Hardhat chain (31337)`);

if ((await provider.getCode(LOCAL.staking)) !== "0x") {
  console.log(`already deployed: Staking ${LOCAL.staking}`);
} else {
  const owner = await provider.getSigner(0);
  if ((await provider.getTransactionCount(owner.address)) !== 0) {
    throw new Error("account #0 has already sent transactions, so the addresses won't match: start from a fresh chain");
  }
  const T = loadContract("TrackerToken");
  const S = loadContract("Staking");
  const token = (await (await new ContractFactory(T.abi, T.bytecode, owner).deploy()).waitForDeployment()) as unknown as Token;
  const staking = (await (await new ContractFactory(S.abi, S.bytecode, owner).deploy(await token.getAddress())).waitForDeployment()) as unknown as Staking;
  if ((await token.getAddress()) !== LOCAL.token || (await staking.getAddress()) !== LOCAL.staking) {
    throw new Error(`unexpected addresses ${await token.getAddress()} / ${await staking.getAddress()}`);
  }
  await (await token.approve(LOCAL.staking, parseEther("200000"))).wait();
  await (await staking.fundRewardPool(parseEther("200000"))).wait();
  for (const i of [1, 2]) {
    const user = await provider.getSigner(i);
    await (await token.transfer(user.address, parseEther("1000"))).wait();
  }
  console.log(`deployed: TrackerToken ${LOCAL.token}, Staking ${LOCAL.staking}; 1,000 TRK sent to test accounts #1 and #2`);
}
provider.destroy();
