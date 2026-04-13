#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEPLOY_TOPIC = "0xb1a29087760d8e8f9b263f598962f752e7bd23badd44897e2966d376d1a59dca";
const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const FACTORY_SELECTOR = "0xc45a0155"; // factory()
const POSITIONS_SELECTOR = "0x99fbab88"; // positions(uint256)
const DEFAULT_OUT_FILE = "bsc_vfat_constants.json";
const KNOWN_PROTOCOL_BY_MANAGER = new Map([
  ["0x46a15b0b27311cedf172ab29e4f4766fbe7f4364", "PancakeSwap V3"],
  ["0x03a520b32c04bf3beef7beb72e919cf822ed34f1", "Uniswap V3"]
]);

function parseArgs(argv) {
  const args = { wallets: [], out: DEFAULT_OUT_FILE, envFile: ".env" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--wallet" && argv[i + 1]) {
      args.wallets.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--env-file" && argv[i + 1]) {
      args.envFile = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function parseEnv(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [k, v] = trimmed.split("=", 2);
    out[k.trim()] = (v || "").trim();
  }
  return out;
}

function normalizeAddress(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return null;
  }
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

function topicAddress(topic) {
  if (typeof topic !== "string" || !topic.startsWith("0x") || topic.length < 66) {
    return null;
  }
  return normalizeAddress(`0x${topic.slice(-40)}`);
}

function dataAddress(data) {
  if (typeof data !== "string" || !data.startsWith("0x") || data.length < 66) {
    return null;
  }
  return normalizeAddress(`0x${data.slice(-40)}`);
}

function parseEip1167Implementation(codeHex) {
  if (!codeHex || codeHex === "0x") {
    return null;
  }
  const code = codeHex.startsWith("0x") ? codeHex.slice(2).toLowerCase() : String(codeHex).toLowerCase();
  const expectedLength = EIP1167_PREFIX.length + 40 + EIP1167_SUFFIX.length;
  if (code.length !== expectedLength) {
    return null;
  }
  if (!code.startsWith(EIP1167_PREFIX) || !code.endsWith(EIP1167_SUFFIX)) {
    return null;
  }
  return normalizeAddress(`0x${code.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}`);
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`${method} failed (${response.status})`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC error for ${method}`);
  }
  return payload.result;
}

async function getAssetTransfersAll(rpcUrl, params) {
  const transfers = [];
  let pageKey;
  do {
    const scoped = { ...params };
    if (pageKey) {
      scoped.pageKey = pageKey;
    }
    const result = await rpcCall(rpcUrl, "alchemy_getAssetTransfers", [scoped]);
    transfers.push(...(result?.transfers || []));
    pageKey = result?.pageKey;
  } while (pageKey);
  return transfers;
}

function toProtocolName(managerAddress) {
  const normalized = normalizeAddress(managerAddress);
  if (!normalized) {
    return "Unknown CL";
  }
  return KNOWN_PROTOCOL_BY_MANAGER.get(normalized) || "Unknown CL";
}

async function discoverForWallet(rpcUrl, wallet) {
  const owner = normalizeAddress(wallet);
  if (!owner) {
    return {
      owner: wallet,
      scannedExternalTransfers: 0,
      directDeployments: [],
      sickleFactories: [],
      deployedClones: []
    };
  }

  const externalTransfers = await getAssetTransfersAll(rpcUrl, {
    fromBlock: "0x0",
    toBlock: "latest",
    fromAddress: owner,
    excludeZeroValue: false,
    category: ["external"],
    maxCount: "0x3e8"
  });

  const txHashes = [...new Set(externalTransfers.map((item) => item.hash).filter(Boolean))];
  const directDeployments = new Set();
  const sickleFactories = new Set();
  const deployedClones = new Set();

  for (const hash of txHashes) {
    try {
      const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [hash]);
      const direct = normalizeAddress(receipt?.contractAddress);
      if (direct) {
        directDeployments.add(direct);
      }
      for (const log of receipt?.logs || []) {
        const topic0 = String(log?.topics?.[0] || "").toLowerCase();
        if (topic0 !== DEPLOY_TOPIC) {
          continue;
        }
        const admin = topicAddress(log?.topics?.[1]);
        if (admin !== owner) {
          continue;
        }
        const factory = normalizeAddress(log?.address);
        const clone = dataAddress(log?.data);
        if (factory) {
          sickleFactories.add(factory);
        }
        if (clone) {
          deployedClones.add(clone);
        }
      }
    } catch {
      // Keep scan best-effort.
    }
  }

  return {
    owner,
    scannedExternalTransfers: externalTransfers.length,
    directDeployments: [...directDeployments],
    sickleFactories: [...sickleFactories],
    deployedClones: [...deployedClones]
  };
}

async function classifyImplementations(rpcUrl, addresses) {
  const byImplementation = new Map();
  const cloneAddresses = new Set();
  for (const address of addresses) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      continue;
    }
    try {
      const code = await rpcCall(rpcUrl, "eth_getCode", [normalized, "latest"]);
      const implementation = parseEip1167Implementation(code);
      if (!implementation) {
        continue;
      }
      cloneAddresses.add(normalized);
      byImplementation.set(implementation, (byImplementation.get(implementation) || 0) + 1);
    } catch {
      // Skip addresses that fail code lookup.
    }
  }
  return {
    cloneAddresses: [...cloneAddresses],
    implementations: [...byImplementation.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([implementation, cloneCount]) => ({ implementation, cloneCount }))
  };
}

async function discoverManagers(rpcUrl, vfatClones) {
  const managerCandidates = new Set();
  for (const clone of vfatClones) {
    try {
      const [outbound, inbound] = await Promise.all([
        getAssetTransfersAll(rpcUrl, {
          fromBlock: "0x0",
          toBlock: "latest",
          fromAddress: clone,
          excludeZeroValue: false,
          withMetadata: true,
          category: ["erc721"],
          maxCount: "0x3e8"
        }),
        getAssetTransfersAll(rpcUrl, {
          fromBlock: "0x0",
          toBlock: "latest",
          toAddress: clone,
          excludeZeroValue: false,
          withMetadata: true,
          category: ["erc721"],
          maxCount: "0x3e8"
        })
      ]);
      for (const transfer of [...outbound, ...inbound]) {
        const tokenContract = normalizeAddress(transfer?.rawContract?.address);
        if (tokenContract) {
          managerCandidates.add(tokenContract);
        }
      }
    } catch {
      // Keep manager inference best-effort.
    }
  }

  const managers = [];
  for (const candidate of managerCandidates) {
    try {
      const [factoryResult, positionsResult] = await Promise.allSettled([
        rpcCall(rpcUrl, "eth_call", [{ to: candidate, data: FACTORY_SELECTOR }, "latest"]),
        rpcCall(rpcUrl, "eth_call", [{ to: candidate, data: `${POSITIONS_SELECTOR}${"0".repeat(64)}` }, "latest"])
      ]);
      const hasFactory = factoryResult.status === "fulfilled" && typeof factoryResult.value === "string" && factoryResult.value !== "0x";
      const hasPositions = positionsResult.status === "fulfilled" && typeof positionsResult.value === "string" && positionsResult.value.length >= 64;
      if (!hasFactory && !hasPositions) {
        continue;
      }
      managers.push({
        protocol: toProtocolName(candidate),
        address: candidate
      });
    } catch {
      // Ignore probe failures.
    }
  }
  return managers
    .sort((a, b) => a.address.localeCompare(b.address))
    .filter((item, idx, arr) => idx === arr.findIndex((x) => x.address === item.address));
}

async function main() {
  const args = parseArgs(process.argv);
  const envPath = path.resolve(process.cwd(), args.envFile);
  const envMap = parseEnv(await readFile(envPath, "utf8"));
  const apiKey = process.env.ALCHEMY_KEY || envMap.alchemy_key || "";
  if (!apiKey) {
    throw new Error("Missing Alchemy key. Provide .env alchemy_key or ALCHEMY_KEY env var.");
  }

  const envWallets = Object.entries(envMap)
    .filter(([key, value]) => key.startsWith("default_wallet") && value)
    .map(([, value]) => value);
  const wallets = [...new Set([...args.wallets, ...envWallets].map(normalizeAddress).filter(Boolean))];
  if (!wallets.length) {
    throw new Error("No wallets provided. Use --wallet or define default_wallet* in .env.");
  }

  const rpcUrl = `https://bnb-mainnet.g.alchemy.com/v2/${apiKey}`;
  const walletScans = [];
  const candidateContracts = new Set();
  const discoveredFactories = new Set();
  for (const wallet of wallets) {
    const scan = await discoverForWallet(rpcUrl, wallet);
    walletScans.push(scan);
    for (const deployed of scan.directDeployments || []) {
      candidateContracts.add(deployed);
    }
    for (const clone of scan.deployedClones || []) {
      candidateContracts.add(clone);
    }
    for (const factory of scan.sickleFactories || []) {
      discoveredFactories.add(factory);
    }
  }

  const implementationScan = await classifyImplementations(rpcUrl, [...candidateContracts]);
  const inferredManagers = await discoverManagers(rpcUrl, implementationScan.cloneAddresses);
  const constants = {
    generatedAt: new Date().toISOString(),
    chainId: 56,
    sourceWallets: wallets,
    sickleFactoryAllowlist: [...discoveredFactories].sort(),
    vfatImplementationAllowlist: implementationScan.implementations.map((item) => item.implementation),
    clPositionManagers: inferredManagers,
    diagnostics: {
      scannedWallets: walletScans.length,
      candidateContractsScanned: candidateContracts.size,
      vfatCloneCount: implementationScan.cloneAddresses.length,
      implementationRanked: implementationScan.implementations,
      walletScans
    }
  };

  const outPath = path.resolve(process.cwd(), args.out || DEFAULT_OUT_FILE);
  await writeFile(outPath, `${JSON.stringify(constants, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
