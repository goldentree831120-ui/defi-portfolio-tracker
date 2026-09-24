// Compiles the contracts with the locally-installed `solc` npm package and
// writes output directly into Hardhat's artifacts/ folder, in the same JSON
// shape `npx hardhat compile` would produce. This exists only because this
// sandbox's network egress doesn't allow binaries.soliditylang.org, which is
// where Hardhat normally downloads the solc binary from. On a normal machine
// (or in CI/GitHub Actions) `npx hardhat compile` works out of the box and
// this script is not needed.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts");
const NODE_MODULES = path.join(__dirname, "node_modules");

function findImports(importPath) {
  try {
    const resolved = importPath.startsWith(".")
      ? path.join(CONTRACTS_DIR, importPath)
      : path.join(NODE_MODULES, importPath);
    return { contents: fs.readFileSync(resolved, "utf8") };
  } catch (e) {
    return { error: "File not found: " + importPath };
  }
}

function compileFile(fileName) {
  const filePath = path.join(CONTRACTS_DIR, fileName);
  const source = fs.readFileSync(filePath, "utf8");

  const input = {
    language: "Solidity",
    sources: { [`contracts/${fileName}`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    const fatal = output.errors.filter((e) => e.severity === "error");
    output.errors.forEach((e) => console.log(e.formattedMessage));
    if (fatal.length) process.exit(1);
  }

  const contracts = output.contracts[`contracts/${fileName}`];
  for (const contractName of Object.keys(contracts)) {
    const c = contracts[contractName];
    const outDir = path.join(ARTIFACTS_DIR, "contracts", fileName);
    fs.mkdirSync(outDir, { recursive: true });

    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName: `contracts/${fileName}`,
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      linkReferences: c.evm.bytecode.linkReferences || {},
      deployedLinkReferences: c.evm.deployedBytecode.linkReferences || {},
    };

    fs.writeFileSync(path.join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    console.log(`Compiled ${contractName} -> artifacts/contracts/${fileName}/${contractName}.json`);
  }
}

fs.readdirSync(CONTRACTS_DIR)
  .filter((f) => f.endsWith(".sol"))
  .forEach(compileFile);

console.log("\nDone. On a machine with normal network access, just run `npx hardhat compile` instead.");
