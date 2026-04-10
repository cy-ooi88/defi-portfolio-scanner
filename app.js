const { ethers } = window;

const BASE_CHAIN_ID = 8453;
const NFPM_ADDRESS = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const FACTORY_ADDRESS = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
const MaxUint256 = (2n ** 256n) - 1n;
const ZeroAddress = "0x0000000000000000000000000000000000000000";
const SECONDS_PER_DAY = 24 * 60 * 60;
const PRICE_API_BASE = "https://api.g.alchemy.com/prices/v1";
const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const SICKLE_DEPLOY_EVENT_TOPIC = "0xb1a29087760d8e8f9b263f598962f752e7bd23badd44897e2966d376d1a59dca";
const COLLECT_EVENT_TOPICS = [
  ethers.id("Collect(uint256,address,uint256,uint256)"),
  ethers.id("Collect(uint256,address,uint128,uint128)")
];
const SLOT0_SELECTOR = "0x3850c7bd";
// Explicitly pinned selectors/topics (resolved with web3_sha3) to avoid runtime selector drift.
const EARNED_SELECTOR = "0x3e491d47"; // earned(address,uint256)
const REWARD_TOKEN_SELECTOR = "0xf7c618c1"; // rewardToken()
const GET_REWARD_BY_TOKEN_SELECTOR = "0x1c4b774b"; // getReward(uint256)
const GET_REWARD_BY_ACCOUNT_SELECTOR = "0xc00007b0"; // getReward(address)
const HARVEST_BY_TOKEN_SELECTOR = "0x18fccc76"; // harvest(uint256,address)
const PENDING_CAKE_SELECTOR = "0xce5f39c6"; // pendingCake(uint256)
const CAKE_SELECTOR = "0x4ca6ef28"; // CAKE()
const CAKE_LOWER_SELECTOR = "0xdce17484"; // cake()
const PANCAKE_CAKE_TOKEN = "0x3055913c90fcc1a6ce9a358911721eeb942013a1";
const FEE_GROWTH_GLOBAL0_SELECTOR = ethers.id("feeGrowthGlobal0X128()").slice(0, 10);
const FEE_GROWTH_GLOBAL1_SELECTOR = ethers.id("feeGrowthGlobal1X128()").slice(0, 10);
const TICKS_SELECTOR = ethers.id("ticks(int24)").slice(0, 10);
const SICKLE_FACTORY_ALLOWLIST = [
  "0x71d234a3e1dfc161cc1d081e6496e76627baac31"
];
const VFAT_IMPLEMENTATION_ALLOWLIST = new Set([
  "0xfff75d099baee29f447866bc5299cd67c04761c8"
]);
const CL_POSITION_MANAGERS = [
  { protocol: "Aerodrome SlipStream", address: "0x827922686190790b37229fd06084350e74485b72" },
  { protocol: "PancakeSwap V3", address: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364" },
  { protocol: "Uniswap V3", address: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1" }
];
const CL_PROTOCOL_BY_MANAGER = new Map(
  CL_POSITION_MANAGERS.map((item) => [ethers.getAddress(item.address).toLowerCase(), item.protocol])
);
const CL_PROTOCOL_ADAPTERS = {
  "Uniswap V3": {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "none"
  },
  "Aerodrome SlipStream": {
    // SlipStream LP fees are directed to veAERO voters, not directly to LP NFT holders.
    feesMode: "none",
    emissionsMode: "pending_delta_plus_realized"
  },
  "PancakeSwap V3": {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "pending_delta_plus_realized"
  }
};

const NFPM_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
];
const FACTORY_INT24_ABI = [
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address pool)"
];
const POSITION_MANAGER_ABI = [
  "function factory() view returns (address)"
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)"
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const state = {
  provider: null,
  providerKey: "",
  prices: new Map(),
  tokens: new Map(),
  managerFactories: new Map(),
  poolByManagerKey: new Map(),
  txByHash: new Map(),
  ownerAdapterByAddress: new Map(),
  gaugeRewardTokenByAddress: new Map()
};

const els = {
  form: document.getElementById("lookupForm"),
  refreshButton: document.getElementById("refreshButton"),
  refreshTopButton: document.getElementById("refreshTopButton"),
  walletInput: document.getElementById("walletInput"),
  alchemyInput: document.getElementById("alchemyInput"),
  statusText: document.getElementById("statusText"),
  lastUpdatedText: document.getElementById("lastUpdatedText"),
  walletHeadline: document.getElementById("walletHeadline"),
  walletSubline: document.getElementById("walletSubline"),
  accountBadge: document.getElementById("accountBadge"),
  bannerText: document.getElementById("bannerText"),
  bannerChip: document.getElementById("bannerChip"),
  totalValue: document.getElementById("totalValue"),
  totalClaimable: document.getElementById("totalClaimable"),
  openCount: document.getElementById("openCount"),
  rangeSummary: document.getElementById("rangeSummary"),
  exchangeCountChip: document.getElementById("exchangeCountChip"),
  openSectionTitle: document.getElementById("openSectionTitle"),
  exitedSectionTitle: document.getElementById("exitedSectionTitle"),
  openPositions: document.getElementById("openPositions"),
  exitedPositions: document.getElementById("exitedPositions"),
  openEmpty: document.getElementById("openEmpty"),
  exitedEmpty: document.getElementById("exitedEmpty"),
  vfatSectionTitle: document.getElementById("vfatSectionTitle"),
  vfatDeployedCountChip: document.getElementById("vfatDeployedCountChip"),
  vfatFactoryCountChip: document.getElementById("vfatFactoryCountChip"),
  vfatContractsCountChip: document.getElementById("vfatContractsCountChip"),
  vfatCurrentCountChip: document.getElementById("vfatCurrentCountChip"),
  vfatOwnedByVfatCountChip: document.getElementById("vfatOwnedByVfatCountChip"),
  vfatExternalizedCountChip: document.getElementById("vfatExternalizedCountChip"),
  vfatUncertainCountChip: document.getElementById("vfatUncertainCountChip"),
  vfatErrorText: document.getElementById("vfatErrorText"),
  vfatCurrentTableBody: document.getElementById("vfatCurrentTableBody"),
  vfatCurrentEmpty: document.getElementById("vfatCurrentEmpty"),
  vfatEmptyNoDeployments: document.getElementById("vfatEmptyNoDeployments"),
  vfatEmptyNoContracts: document.getElementById("vfatEmptyNoContracts")
};

function setBusy(isBusy, text = "") {
  els.refreshButton.disabled = isBusy;
  els.refreshTopButton.disabled = isBusy;
  if (text) {
    els.statusText.textContent = text;
  }
}

function setStatus(text, tone = "neutral") {
  els.statusText.textContent = text;
  els.statusText.style.color = tone === "error" ? "var(--red)" : tone === "success" ? "var(--green)" : "var(--text)";
}

function updateBanner(text, chipText, tone = "neutral") {
  els.bannerText.textContent = text;
  els.bannerChip.textContent = chipText;
  els.bannerChip.className = "chip";
  if (tone === "success") {
    els.bannerChip.classList.add("base");
  } else if (tone === "warning") {
    els.bannerChip.classList.add("warning");
  } else {
    els.bannerChip.classList.add("subtle");
  }
}

function parseEnv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((accumulator, line) => {
      const separator = line.indexOf("=");
      if (separator === -1) {
        return accumulator;
      }
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

async function loadEnv() {
  try {
    const response = await fetch("./.env", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const env = parseEnv(await response.text());
    if (env.default_wallet && !els.walletInput.value) {
      els.walletInput.value = env.default_wallet;
    }
    if (env.alchemy_key && !els.alchemyInput.value) {
      els.alchemyInput.value = env.alchemy_key;
    }
    updateBanner("Loaded default wallet and Alchemy key from ./.env.", "Env loaded", "success");
  } catch (error) {
    const fileProtocol = window.location.protocol === "file:";
    updateBanner(
      fileProtocol
        ? "Browser file mode usually blocks reading .env. Serve the folder over local HTTP, or paste the values manually below."
        : `Could not read ./.env (${error.message}). You can still paste the wallet and key manually.`,
      fileProtocol ? "Serve locally" : "Env missing",
      "warning"
    );
  }
}

function getProvider(apiKey) {
  if (!state.provider || state.providerKey !== apiKey) {
    state.provider = new ethers.JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${apiKey}`, BASE_CHAIN_ID, {
      staticNetwork: true
    });
    state.providerKey = apiKey;
  }
  return state.provider;
}

async function rpcCall(apiKey, method, params) {
  const response = await fetch(`https://base-mainnet.g.alchemy.com/v2/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC request failed (${response.status})`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC error for ${method}`);
  }
  return payload.result;
}

function parseEip1167Implementation(codeHex) {
  if (!codeHex || codeHex === "0x") {
    return null;
  }

  const code = codeHex.startsWith("0x") ? codeHex.slice(2).toLowerCase() : codeHex.toLowerCase();
  const expectedLength = EIP1167_PREFIX.length + 40 + EIP1167_SUFFIX.length;
  if (code.length !== expectedLength) {
    return null;
  }
  if (!code.startsWith(EIP1167_PREFIX) || !code.endsWith(EIP1167_SUFFIX)) {
    return null;
  }
  return `0x${code.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}`;
}

async function findDirectlyDeployedContracts(wallet, apiKey) {
  const owner = ethers.getAddress(wallet);
  const deploymentTxHashes = [];
  let pageKey;

  do {
    const params = {
      fromBlock: "0x0",
      toBlock: "latest",
      fromAddress: owner,
      excludeZeroValue: false,
      category: ["external"],
      maxCount: "0x3e8"
    };
    if (pageKey) {
      params.pageKey = pageKey;
    }

    const result = await rpcCall(apiKey, "alchemy_getAssetTransfers", [params]);
    const transfers = result?.transfers || [];
    for (const transfer of transfers) {
      if (transfer.to === null) {
        deploymentTxHashes.push(transfer.hash);
      }
    }
    pageKey = result?.pageKey;
  } while (pageKey);

  if (!deploymentTxHashes.length) {
    return [];
  }

  const uniqueTxHashes = [...new Set(deploymentTxHashes)];
  const receiptResults = await Promise.allSettled(
    uniqueTxHashes.map((hash) => rpcCall(apiKey, "eth_getTransactionReceipt", [hash]))
  );

  const deployedContracts = [];
  for (const receiptResult of receiptResults) {
    if (receiptResult.status === "fulfilled" && receiptResult.value?.contractAddress) {
      deployedContracts.push(ethers.getAddress(receiptResult.value.contractAddress));
    }
  }

  return [...new Set(deployedContracts)];
}

function topicAddress(topic) {
  if (!topic || !topic.startsWith("0x") || topic.length < 66) {
    return null;
  }
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function dataAddress(data) {
  if (!data || !data.startsWith("0x") || data.length < 66) {
    return null;
  }
  return `0x${data.slice(-40).toLowerCase()}`;
}

async function findFactoryDeployedContracts(wallet, apiKey) {
  const owner = ethers.getAddress(wallet).toLowerCase();
  const deploymentHashes = new Set();

  for (const factoryAddress of SICKLE_FACTORY_ALLOWLIST) {
    let pageKey;
    do {
      const params = {
        fromBlock: "0x0",
        toBlock: "latest",
        fromAddress: owner,
        toAddress: factoryAddress,
        excludeZeroValue: false,
        category: ["external"],
        maxCount: "0x3e8"
      };
      if (pageKey) {
        params.pageKey = pageKey;
      }

      const result = await rpcCall(apiKey, "alchemy_getAssetTransfers", [params]);
      const transfers = result?.transfers || [];
      for (const transfer of transfers) {
        deploymentHashes.add(transfer.hash);
      }
      pageKey = result?.pageKey;
    } while (pageKey);
  }

  if (!deploymentHashes.size) {
    return [];
  }

  const receiptResults = await Promise.allSettled(
    [...deploymentHashes].map((hash) => rpcCall(apiKey, "eth_getTransactionReceipt", [hash]))
  );
  const deployedContracts = [];
  const allowedFactories = new Set(SICKLE_FACTORY_ALLOWLIST.map((address) => ethers.getAddress(address).toLowerCase()));

  for (const receiptResult of receiptResults) {
    if (receiptResult.status !== "fulfilled" || !receiptResult.value?.logs?.length) {
      continue;
    }
    const logs = receiptResult.value.logs;
    for (const log of logs) {
      const logAddress = log.address ? ethers.getAddress(log.address).toLowerCase() : "";
      if (!allowedFactories.has(logAddress)) {
        continue;
      }
      if (!Array.isArray(log.topics) || log.topics[0]?.toLowerCase() !== SICKLE_DEPLOY_EVENT_TOPIC) {
        continue;
      }
      const admin = topicAddress(log.topics[1]);
      if (admin !== owner) {
        continue;
      }
      const sickle = dataAddress(log.data);
      if (sickle) {
        deployedContracts.push(ethers.getAddress(sickle));
      }
    }
  }

  return [...new Set(deployedContracts)];
}

async function identifyVFatContracts(deployedContracts, provider) {
  const classified = [];

  for (const contractAddress of deployedContracts) {
    try {
      const code = await provider.getCode(contractAddress);
      const implementation = parseEip1167Implementation(code);
      if (!implementation) {
        continue;
      }
      if (!VFAT_IMPLEMENTATION_ALLOWLIST.has(implementation.toLowerCase())) {
        continue;
      }
      classified.push({
        address: ethers.getAddress(contractAddress),
        implementation: ethers.getAddress(implementation),
        kind: "eip1167"
      });
    } catch {
      // Ignore code fetch failures and continue with the rest.
    }
  }

  return classified;
}

function normalizeAddressOrZero(value) {
  if (!value) {
    return ZeroAddress;
  }
  try {
    return ethers.getAddress(value);
  } catch {
    return String(value).toLowerCase();
  }
}

function normalizeTokenIdHex(tokenId) {
  if (typeof tokenId !== "string" || !tokenId.startsWith("0x")) {
    return "0x0";
  }
  try {
    return `0x${BigInt(tokenId).toString(16)}`;
  } catch {
    return tokenId.toLowerCase();
  }
}

function tokenIdToDecimal(tokenIdHex) {
  try {
    return BigInt(tokenIdHex).toString();
  } catch {
    return tokenIdHex;
  }
}

function parseBlockNumber(blockNumHex) {
  if (!blockNumHex || typeof blockNumHex !== "string") {
    return 0;
  }
  return Number.parseInt(blockNumHex, 16) || 0;
}

function parseHexToNumber(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }
  return Number.parseInt(value, 16) || 0;
}

function parseHexToBigInt(value) {
  if (!value || typeof value !== "string" || !value.startsWith("0x")) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function toBlockTag(value) {
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`;
  }
  return value || "latest";
}

function readWord(data, index) {
  if (!data || typeof data !== "string" || !data.startsWith("0x")) {
    return null;
  }
  const stripped = data.slice(2);
  const offset = index * 64;
  if (stripped.length < offset + 64) {
    return null;
  }
  return stripped.slice(offset, offset + 64);
}

function parseInt24FromWord(wordHex) {
  if (!wordHex || wordHex.length !== 64) {
    return null;
  }
  try {
    const value = Number.parseInt(wordHex.slice(58), 16);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value >= 0x800000 ? value - 0x1000000 : value;
  } catch {
    return null;
  }
}

function encodeInt24Word(value) {
  const max = 2 ** 23;
  if (!Number.isInteger(value) || value < -max || value >= max) {
    throw new Error(`int24 out of range: ${value}`);
  }
  const encoded = value < 0 ? (2 ** 24) + value : value;
  return encoded.toString(16).padStart(64, "0");
}

function tokenIdToTopic(tokenIdHex) {
  const normalized = normalizeTokenIdHex(tokenIdHex).slice(2);
  return `0x${normalized.padStart(64, "0")}`;
}

function encodeAddressWord(address) {
  const normalized = ethers.getAddress(address).toLowerCase().slice(2);
  return normalized.padStart(64, "0");
}

function parseWordToBigInt(wordHex) {
  if (!wordHex || wordHex.length !== 64) {
    return 0n;
  }
  try {
    return BigInt(`0x${wordHex}`);
  } catch {
    return 0n;
  }
}

function parseTxSelector(inputData) {
  if (!inputData || typeof inputData !== "string" || !inputData.startsWith("0x") || inputData.length < 10) {
    return null;
  }
  return inputData.slice(0, 10).toLowerCase();
}

async function ethCallAtBlock(apiKey, to, data, blockTag = "latest") {
  return rpcCall(apiKey, "eth_call", [{ to, data }, toBlockTag(blockTag)]);
}

async function fetchBlockHeader(apiKey, blockTag = "latest") {
  const block = await rpcCall(apiKey, "eth_getBlockByNumber", [toBlockTag(blockTag), false]);
  if (!block?.number || !block?.timestamp) {
    throw new Error(`Missing block header for ${blockTag}`);
  }
  return {
    number: parseHexToNumber(block.number),
    timestamp: parseHexToNumber(block.timestamp)
  };
}

async function findBlockAtOrBeforeTimestamp(apiKey, targetTimestamp, latestBlockNumber) {
  if (!Number.isFinite(targetTimestamp) || targetTimestamp <= 0) {
    return 0;
  }
  let low = 0;
  let high = latestBlockNumber;
  let candidate = 0;
  const cache = new Map();

  const getTimestamp = async (blockNumber) => {
    if (cache.has(blockNumber)) {
      return cache.get(blockNumber);
    }
    const header = await fetchBlockHeader(apiKey, blockNumber);
    cache.set(blockNumber, header.timestamp);
    return header.timestamp;
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const timestamp = await getTimestamp(mid);
    if (timestamp <= targetTimestamp) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}

async function resolve24hBlockWindow(apiKey) {
  const latest = await fetchBlockHeader(apiKey, "latest");
  const startTimestamp = Math.max(0, latest.timestamp - SECONDS_PER_DAY);
  const fromBlock = await findBlockAtOrBeforeTimestamp(apiKey, startTimestamp, latest.number);
  return {
    fromBlock,
    toBlock: latest.number,
    fromBlockTag: toBlockTag(fromBlock),
    toBlockTag: toBlockTag(latest.number)
  };
}

function compareClRowsAsc(a, b) {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber - b.blockNumber;
  }
  if (a.txHash !== b.txHash) {
    return a.txHash.localeCompare(b.txHash);
  }
  return a.sortRef.localeCompare(b.sortRef);
}

function compareClRowsDesc(a, b) {
  return compareClRowsAsc(b, a);
}

async function fetchTransfersByAddress(apiKey, addressKey, addressValue, contractAddresses) {
  const transfers = [];
  let pageKey;

  do {
    const params = {
      fromBlock: "0x0",
      toBlock: "latest",
      excludeZeroValue: false,
      withMetadata: true,
      category: ["erc721"],
      contractAddresses,
      maxCount: "0x3e8",
      [addressKey]: addressValue
    };

    if (pageKey) {
      params.pageKey = pageKey;
    }

    const result = await rpcCall(apiKey, "alchemy_getAssetTransfers", [params]);
    transfers.push(...(result?.transfers || []));
    pageKey = result?.pageKey;
  } while (pageKey);

  return transfers;
}

function mapClTransferRow(vfatContract, transfer) {
  const tokenContractRaw = transfer.rawContract?.address;
  if (!tokenContractRaw || !transfer.erc721TokenId) {
    return null;
  }

  const tokenContract = ethers.getAddress(tokenContractRaw);
  const tokenContractLower = tokenContract.toLowerCase();
  const protocol = CL_PROTOCOL_BY_MANAGER.get(tokenContractLower);
  if (!protocol) {
    return null;
  }

  const vfatAddress = ethers.getAddress(vfatContract);
  const vfatLower = vfatAddress.toLowerCase();
  const from = normalizeAddressOrZero(transfer.from);
  const to = normalizeAddressOrZero(transfer.to);
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  const tokenIdHex = normalizeTokenIdHex(transfer.erc721TokenId);
  const tokenIdDecimal = tokenIdToDecimal(tokenIdHex);
  const direction = fromLower === vfatLower && toLower !== vfatLower
    ? "out"
    : toLower === vfatLower && fromLower !== vfatLower
      ? "in"
      : "self";

  let action = "internal";
  if (direction === "out") {
    action = toLower === ZeroAddress.toLowerCase() ? "burned" : "deposited";
  } else if (direction === "in") {
    action = fromLower === ZeroAddress.toLowerCase() ? "minted" : "received";
  }

  const counterparty = direction === "out" ? to : direction === "in" ? from : vfatAddress;

  return {
    vfatContract: vfatAddress,
    tokenContract,
    tokenContractLower,
    protocol,
    tokenIdHex,
    tokenIdDecimal,
    tokenKey: `${vfatLower}:${tokenContractLower}:${tokenIdHex.toLowerCase()}`,
    direction,
    action,
    txHash: transfer.hash || "",
    blockNumHex: transfer.blockNum || "0x0",
    blockNumber: parseBlockNumber(transfer.blockNum),
    blockTimestamp: transfer.metadata?.blockTimestamp || null,
    from,
    to,
    counterparty,
    sortRef: transfer.uniqueId || `${transfer.hash || ""}:${transfer.erc721TokenId}`
  };
}

async function fetchClTransfersForVfatContract(vfatContract, apiKey) {
  const normalizedContract = ethers.getAddress(vfatContract);
  const managerAddresses = CL_POSITION_MANAGERS.map((item) => ethers.getAddress(item.address));
  const [outbound, inbound] = await Promise.all([
    fetchTransfersByAddress(apiKey, "fromAddress", normalizedContract, managerAddresses),
    fetchTransfersByAddress(apiKey, "toAddress", normalizedContract, managerAddresses)
  ]);

  const rows = [];
  const seen = new Set();

  for (const transfer of [...outbound, ...inbound]) {
    try {
      const row = mapClTransferRow(normalizedContract, transfer);
      if (!row) {
        continue;
      }
      const dedupeKey = `${row.vfatContract.toLowerCase()}:${transfer.uniqueId || `${row.txHash}:${row.tokenContractLower}:${row.tokenIdHex}:${row.from}:${row.to}`}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      rows.push(row);
    } catch {
      // Ignore malformed rows and continue.
    }
  }

  rows.sort(compareClRowsDesc);
  return rows;
}

function padTokenIdToWord(tokenIdHex) {
  const normalized = normalizeTokenIdHex(tokenIdHex).slice(2);
  return normalized.padStart(64, "0");
}

function parseOwnerFromEthCall(result) {
  if (!result || typeof result !== "string" || result.length < 66 || result === "0x") {
    return null;
  }
  try {
    return ethers.getAddress(`0x${result.slice(-40)}`);
  } catch {
    return null;
  }
}

function parseAddressWord(wordHex) {
  if (!wordHex || wordHex.length !== 64) {
    return null;
  }
  try {
    return ethers.getAddress(`0x${wordHex.slice(24)}`);
  } catch {
    return null;
  }
}

function parseSignedInt24Word(wordHex) {
  return parseInt24FromWord(wordHex);
}

function parsePositionsSnapshot(result) {
  if (!result || typeof result !== "string" || !result.startsWith("0x")) {
    return null;
  }
  const data = result.slice(2);
  if (data.length < 64 * 12) {
    return null;
  }

  try {
    const token0 = parseAddressWord(data.slice(64 * 2, 64 * 3));
    const token1 = parseAddressWord(data.slice(64 * 3, 64 * 4));
    const feeHex = data.slice(64 * 4, 64 * 5);
    const tickLowerHex = data.slice(64 * 5, 64 * 6);
    const tickUpperHex = data.slice(64 * 6, 64 * 7);
    const liquidityHex = data.slice(64 * 7, 64 * 8);
    const feeGrowthInside0LastX128Hex = data.slice(64 * 8, 64 * 9);
    const feeGrowthInside1LastX128Hex = data.slice(64 * 9, 64 * 10);
    const tokensOwed0Hex = data.slice(64 * 10, 64 * 11);
    const tokensOwed1Hex = data.slice(64 * 11, 64 * 12);
    const fee = Number.parseInt(feeHex, 16);
    const tickLower = parseSignedInt24Word(tickLowerHex);
    const tickUpper = parseSignedInt24Word(tickUpperHex);
    const liquidity = BigInt(`0x${liquidityHex}`);
    return {
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      liquidity,
      feeGrowthInside0LastX128: BigInt(`0x${feeGrowthInside0LastX128Hex}`),
      feeGrowthInside1LastX128: BigInt(`0x${feeGrowthInside1LastX128Hex}`),
      tokensOwed0: BigInt(`0x${tokensOwed0Hex}`),
      tokensOwed1: BigInt(`0x${tokensOwed1Hex}`)
    };
  } catch {
    return null;
  }
}

async function fetchPoolCurrentPrice(managerAddress, token0Address, token1Address, fee, token0Decimals, token1Decimals, provider) {
  try {
    const poolAddress = await resolvePoolAddressForManager(managerAddress, token0Address, token1Address, fee, provider);
    if (!poolAddress) {
      return null;
    }

    const slot0Raw = await provider.call({
      to: poolAddress,
      data: SLOT0_SELECTOR // slot0()
    });
    const slot0 = parseSlot0FromEthCall(slot0Raw);
    if (!slot0 || !Number.isFinite(slot0.tick)) {
      return null;
    }
    return tickToPrice(slot0.tick, token0Decimals, token1Decimals);
  } catch {
    return null;
  }
}

async function resolveManagerFactory(managerAddress, provider) {
  const manager = ethers.getAddress(managerAddress);
  const managerLower = manager.toLowerCase();
  if (state.managerFactories.has(managerLower)) {
    return state.managerFactories.get(managerLower);
  }

  try {
    const managerContract = new ethers.Contract(manager, POSITION_MANAGER_ABI, provider);
    const factoryAddress = await managerContract.factory();
    const normalized = factoryAddress ? ethers.getAddress(factoryAddress) : null;
    const resolved = normalized && normalized !== ZeroAddress ? normalized : null;
    state.managerFactories.set(managerLower, resolved);
    return resolved;
  } catch {
    state.managerFactories.set(managerLower, null);
    return null;
  }
}

async function resolvePoolAddressForManager(managerAddress, token0Address, token1Address, fee, provider) {
  const manager = ethers.getAddress(managerAddress);
  const token0 = ethers.getAddress(token0Address);
  const token1 = ethers.getAddress(token1Address);
  const key = `${manager.toLowerCase()}:${token0.toLowerCase()}:${token1.toLowerCase()}:${fee}`;
  if (state.poolByManagerKey.has(key)) {
    return state.poolByManagerKey.get(key);
  }

  const factoryAddress = await resolveManagerFactory(manager, provider);
  if (!factoryAddress) {
    state.poolByManagerKey.set(key, null);
    return null;
  }

  const tryGetPool = async (abi, tokenA, tokenB, spacingOrFee) => {
    try {
      const factory = new ethers.Contract(factoryAddress, abi, provider);
      const poolAddress = await factory.getPool(tokenA, tokenB, spacingOrFee);
      if (!poolAddress) {
        return null;
      }
      const normalizedPool = ethers.getAddress(poolAddress);
      return normalizedPool === ZeroAddress ? null : normalizedPool;
    } catch {
      return null;
    }
  };

  let poolAddress = await tryGetPool(FACTORY_ABI, token0, token1, fee);
  if (!poolAddress) {
    poolAddress = await tryGetPool(FACTORY_ABI, token1, token0, fee);
  }
  if (!poolAddress) {
    poolAddress = await tryGetPool(FACTORY_INT24_ABI, token0, token1, fee);
  }
  if (!poolAddress) {
    poolAddress = await tryGetPool(FACTORY_INT24_ABI, token1, token0, fee);
  }

  state.poolByManagerKey.set(key, poolAddress || null);
  return poolAddress || null;
}

function parseSlot0FromEthCall(rawResult) {
  if (!rawResult || typeof rawResult !== "string" || !rawResult.startsWith("0x")) {
    return null;
  }
  const sqrtPriceWord = readWord(rawResult, 0);
  const tickWord = readWord(rawResult, 1);
  if (!sqrtPriceWord || !tickWord) {
    return null;
  }
  const sqrtPriceX96 = BigInt(`0x${sqrtPriceWord}`);
  const tick = parseSignedInt24Word(tickWord);
  if (!Number.isFinite(tick)) {
    return null;
  }
  return { sqrtPriceX96, tick };
}

async function fetchPoolStateAtBlock(apiKey, poolAddress, tickLower, tickUpper, blockTag) {
  try {
    const lowerTickCalldata = `${TICKS_SELECTOR}${encodeInt24Word(tickLower)}`;
    const upperTickCalldata = `${TICKS_SELECTOR}${encodeInt24Word(tickUpper)}`;
    const [slot0Raw, feeGrowthGlobal0Raw, feeGrowthGlobal1Raw, lowerTickRaw, upperTickRaw] = await Promise.all([
      ethCallAtBlock(apiKey, poolAddress, SLOT0_SELECTOR, blockTag),
      ethCallAtBlock(apiKey, poolAddress, FEE_GROWTH_GLOBAL0_SELECTOR, blockTag),
      ethCallAtBlock(apiKey, poolAddress, FEE_GROWTH_GLOBAL1_SELECTOR, blockTag),
      ethCallAtBlock(apiKey, poolAddress, lowerTickCalldata, blockTag),
      ethCallAtBlock(apiKey, poolAddress, upperTickCalldata, blockTag)
    ]);

    const slot0 = parseSlot0FromEthCall(slot0Raw);
    const feeGrowthGlobal0Word = readWord(feeGrowthGlobal0Raw, 0);
    const feeGrowthGlobal1Word = readWord(feeGrowthGlobal1Raw, 0);
    const lowerOutside0Word = readWord(lowerTickRaw, 2);
    const lowerOutside1Word = readWord(lowerTickRaw, 3);
    const upperOutside0Word = readWord(upperTickRaw, 2);
    const upperOutside1Word = readWord(upperTickRaw, 3);
    if (!slot0 || !feeGrowthGlobal0Word || !feeGrowthGlobal1Word || !lowerOutside0Word || !lowerOutside1Word || !upperOutside0Word || !upperOutside1Word) {
      return null;
    }

    return {
      slot0,
      feeGrowthGlobal0: BigInt(`0x${feeGrowthGlobal0Word}`),
      feeGrowthGlobal1: BigInt(`0x${feeGrowthGlobal1Word}`),
      lowerTick: {
        feeGrowthOutside0X128: BigInt(`0x${lowerOutside0Word}`),
        feeGrowthOutside1X128: BigInt(`0x${lowerOutside1Word}`)
      },
      upperTick: {
        feeGrowthOutside0X128: BigInt(`0x${upperOutside0Word}`),
        feeGrowthOutside1X128: BigInt(`0x${upperOutside1Word}`)
      }
    };
  } catch {
    return null;
  }
}

async function fetchLiveNftState(tokenContract, tokenIdHex, apiKey, provider) {
  const normalizedContract = ethers.getAddress(tokenContract);
  const tokenWord = padTokenIdToWord(tokenIdHex);
  const ownerCalldata = `0x6352211e${tokenWord}`; // ownerOf(uint256)
  const positionsCalldata = `0x99fbab88${tokenWord}`; // positions(uint256)

  const [ownerCall, positionsCall] = await Promise.allSettled([
    rpcCall(apiKey, "eth_call", [{ to: normalizedContract, data: ownerCalldata }, "latest"]),
    rpcCall(apiKey, "eth_call", [{ to: normalizedContract, data: positionsCalldata }, "latest"])
  ]);

  const ownerAddress = ownerCall.status === "fulfilled" ? parseOwnerFromEthCall(ownerCall.value) : null;
  const parsedPositions = positionsCall.status === "fulfilled" ? parsePositionsSnapshot(positionsCall.value) : null;
  const liquidity = parsedPositions?.liquidity ?? null;
  const fee = Number.isFinite(parsedPositions?.fee) ? parsedPositions.fee : null;
  const tickLower = Number.isFinite(parsedPositions?.tickLower) ? parsedPositions.tickLower : null;
  const tickUpper = Number.isFinite(parsedPositions?.tickUpper) ? parsedPositions.tickUpper : null;
  const token0Address = parsedPositions?.token0 || null;
  const token1Address = parsedPositions?.token1 || null;
  let pairLabel = "Unknown/Unknown";
  let rangeLowerPrice = null;
  let rangeUpperPrice = null;
  let currentPrice = null;

  if (token0Address && token1Address && provider) {
    const [token0MetaResult, token1MetaResult] = await Promise.allSettled([
      getTokenMeta(token0Address, provider),
      getTokenMeta(token1Address, provider)
    ]);
    const symbol0 = token0MetaResult.status === "fulfilled"
      ? token0MetaResult.value.symbol
      : token0Address.slice(2, 6).toUpperCase();
    const symbol1 = token1MetaResult.status === "fulfilled"
      ? token1MetaResult.value.symbol
      : token1Address.slice(2, 6).toUpperCase();
    pairLabel = `${symbol0}/${symbol1}`;

    const token0Decimals = token0MetaResult.status === "fulfilled" ? token0MetaResult.value.decimals : 18;
    const token1Decimals = token1MetaResult.status === "fulfilled" ? token1MetaResult.value.decimals : 18;
    if (Number.isFinite(tickLower) && Number.isFinite(tickUpper)) {
      rangeLowerPrice = tickToPrice(tickLower, token0Decimals, token1Decimals);
      rangeUpperPrice = tickToPrice(tickUpper, token0Decimals, token1Decimals);
    }
    if (Number.isFinite(fee)) {
      currentPrice = await fetchPoolCurrentPrice(
        normalizedContract,
        token0Address,
        token1Address,
        fee,
        token0Decimals,
        token1Decimals,
        provider
      );
    }
  }

  return {
    ownerAddress,
    liquidity,
    fee,
    token0Address,
    token1Address,
    pairLabel,
    tickLower,
    tickUpper,
    rangeLowerPrice,
    rangeUpperPrice,
    currentPrice
  };
}

function parseCollectLogAmounts(log) {
  if (!log?.data || typeof log.data !== "string" || !log.data.startsWith("0x")) {
    return { amount0: 0n, amount1: 0n };
  }

  const wordCount = Math.floor((log.data.length - 2) / 64);
  if (wordCount < 2) {
    return { amount0: 0n, amount1: 0n };
  }

  const amount0Word = readWord(log.data, wordCount - 2);
  const amount1Word = readWord(log.data, wordCount - 1);
  if (!amount0Word || !amount1Word) {
    return { amount0: 0n, amount1: 0n };
  }
  return {
    amount0: BigInt(`0x${amount0Word}`),
    amount1: BigInt(`0x${amount1Word}`)
  };
}

async function fetchCollectAmounts24h(row, apiKey, blockWindow) {
  const tokenTopic = tokenIdToTopic(row.tokenIdHex);
  const logs = [];

  for (const collectTopic of COLLECT_EVENT_TOPICS) {
    try {
      const result = await rpcCall(apiKey, "eth_getLogs", [{
        fromBlock: blockWindow.fromBlockTag,
        toBlock: blockWindow.toBlockTag,
        address: row.tokenContract,
        topics: [collectTopic, tokenTopic]
      }]);
      logs.push(...(result || []));
    } catch {
      // Skip collect topic variants that are unsupported on this manager.
    }
  }

  let amount0 = 0n;
  let amount1 = 0n;
  const seen = new Set();
  for (const log of logs) {
    const dedupe = `${log.transactionHash || ""}:${log.logIndex || ""}`;
    if (seen.has(dedupe)) {
      continue;
    }
    seen.add(dedupe);
    const parsed = parseCollectLogAmounts(log);
    amount0 += parsed.amount0;
    amount1 += parsed.amount1;
  }

  return { amount0, amount1 };
}

async function fetchClaimableSnapshotAtBlock(row, blockTag, apiKey, provider) {
  try {
    const tokenWord = padTokenIdToWord(row.tokenIdHex);
    const positionsCalldata = `0x99fbab88${tokenWord}`;
    const positionsRaw = await ethCallAtBlock(apiKey, row.tokenContract, positionsCalldata, blockTag);
    const position = parsePositionsSnapshot(positionsRaw);
    if (!position || !position.token0 || !position.token1 || !Number.isFinite(position.fee) || !Number.isFinite(position.tickLower) || !Number.isFinite(position.tickUpper)) {
      return null;
    }

    const poolAddress = await resolvePoolAddressForManager(
      row.tokenContract,
      position.token0,
      position.token1,
      position.fee,
      provider
    );
    if (!poolAddress) {
      return null;
    }

    const poolState = await fetchPoolStateAtBlock(apiKey, poolAddress, position.tickLower, position.tickUpper, blockTag);
    if (!poolState) {
      return null;
    }

    const claimable = getClaimableAmounts(position, poolState);
    return {
      position,
      poolAddress,
      poolState,
      claimable
    };
  } catch {
    return null;
  }
}

function safePositive(value) {
  return value < 0n ? 0n : value;
}

async function calculateCurrentPoolUsd(snapshot, provider, apiKey) {
  const position = snapshot.position;
  const poolState = snapshot.poolState;
  if (!position || !poolState?.slot0?.sqrtPriceX96) {
    return {
      currentPoolUsd: null,
      token0Meta: null,
      token1Meta: null,
      prices: null
    };
  }

  const [token0Meta, token1Meta] = await Promise.all([
    getTokenMeta(position.token0, provider),
    getTokenMeta(position.token1, provider)
  ]);
  const prices = await getPrices([token0Meta.address, token1Meta.address], apiKey);
  const sqrtLowerX96 = getSqrtRatioAtTick(Number(position.tickLower));
  const sqrtUpperX96 = getSqrtRatioAtTick(Number(position.tickUpper));
  const pooled = getAmountsForLiquidity(
    poolState.slot0.sqrtPriceX96,
    sqrtLowerX96,
    sqrtUpperX96,
    BigInt(position.liquidity)
  );

  const pooled0 = normalizeAmount(pooled.amount0, token0Meta.decimals);
  const pooled1 = normalizeAmount(pooled.amount1, token1Meta.decimals);
  const price0 = prices[token0Meta.address] ?? 0;
  const price1 = prices[token1Meta.address] ?? 0;
  const currentPoolUsd = (Number.isFinite(price0) ? pooled0 * price0 : 0) + (Number.isFinite(price1) ? pooled1 * price1 : 0);
  return {
    currentPoolUsd: Number.isFinite(currentPoolUsd) ? currentPoolUsd : null,
    token0Meta,
    token1Meta,
    prices
  };
}

function readCalldataArgWord(inputData, argIndex) {
  if (!inputData || typeof inputData !== "string" || !inputData.startsWith("0x")) {
    return null;
  }
  const start = 10 + (argIndex * 64);
  const end = start + 64;
  if (inputData.length < end) {
    return null;
  }
  return inputData.slice(start, end);
}

function readCalldataArgUint(inputData, argIndex) {
  const word = readCalldataArgWord(inputData, argIndex);
  if (!word) {
    return null;
  }
  return parseWordToBigInt(word);
}

function decodeUint256CallResult(result) {
  const word = readWord(result, 0);
  return parseWordToBigInt(word);
}

function decodeAddressCallResult(result) {
  const word = readWord(result, 0);
  return parseAddressWord(word);
}

async function fetchTransactionByHashCached(apiKey, txHash) {
  if (!txHash) {
    return null;
  }
  const key = txHash.toLowerCase();
  if (state.txByHash.has(key)) {
    return state.txByHash.get(key);
  }
  try {
    const tx = await rpcCall(apiKey, "eth_getTransactionByHash", [txHash]);
    state.txByHash.set(key, tx || null);
    return tx || null;
  } catch {
    state.txByHash.set(key, null);
    return null;
  }
}

function parseTransferRawAmount(transfer) {
  const hexValue = transfer?.rawContract?.value;
  if (typeof hexValue === "string" && hexValue.startsWith("0x")) {
    return parseHexToBigInt(hexValue);
  }
  return 0n;
}

async function fetchErc20TransfersInWindow(apiKey, {
  fromAddress,
  toAddress,
  contractAddresses,
  fromBlockTag,
  toBlockTag
}) {
  const transfers = [];
  let pageKey;
  do {
    const params = {
      fromBlock: fromBlockTag,
      toBlock: toBlockTag,
      excludeZeroValue: false,
      category: ["erc20"],
      contractAddresses,
      maxCount: "0x3e8"
    };
    if (fromAddress) {
      params.fromAddress = fromAddress;
    }
    if (toAddress) {
      params.toAddress = toAddress;
    }
    if (pageKey) {
      params.pageKey = pageKey;
    }
    const result = await rpcCall(apiKey, "alchemy_getAssetTransfers", [params]);
    transfers.push(...(result?.transfers || []));
    pageKey = result?.pageKey;
  } while (pageKey);
  return transfers;
}

async function classifyOwnerAdapter(row, apiKey) {
  const cacheKey = `${row.protocol}:${row.currentOwner.toLowerCase()}`;
  if (state.ownerAdapterByAddress.has(cacheKey)) {
    return state.ownerAdapterByAddress.get(cacheKey);
  }

  try {
    const code = await rpcCall(apiKey, "eth_getCode", [row.currentOwner, "latest"]);
    if (!code || code === "0x") {
      state.ownerAdapterByAddress.set(cacheKey, "direct_owner");
      return "direct_owner";
    }
  } catch {
    state.ownerAdapterByAddress.set(cacheKey, "unknown");
    return "unknown";
  }

  const tokenWord = padTokenIdToWord(row.tokenIdHex);
  if (row.protocol === "Aerodrome SlipStream") {
    try {
      const data = `${EARNED_SELECTOR}${encodeAddressWord(row.vfatContract)}${tokenWord}`;
      const result = await rpcCall(apiKey, "eth_call", [{ to: row.currentOwner, data }, "latest"]);
      if (result && result !== "0x") {
        state.ownerAdapterByAddress.set(cacheKey, "aerodrome_clgauge");
        return "aerodrome_clgauge";
      }
    } catch {
      // keep probing
    }
  }

  if (row.protocol === "PancakeSwap V3") {
    try {
      const data = `${PENDING_CAKE_SELECTOR}${tokenWord}`;
      const result = await rpcCall(apiKey, "eth_call", [{ to: row.currentOwner, data }, "latest"]);
      if (result && result !== "0x") {
        state.ownerAdapterByAddress.set(cacheKey, "pancake_masterchef");
        return "pancake_masterchef";
      }
    } catch {
      // keep probing
    }
  }

  state.ownerAdapterByAddress.set(cacheKey, "unknown");
  return "unknown";
}

async function resolveGaugeRewardToken(gaugeAddress, apiKey) {
  const gauge = ethers.getAddress(gaugeAddress);
  const key = gauge.toLowerCase();
  if (state.gaugeRewardTokenByAddress.has(key)) {
    return state.gaugeRewardTokenByAddress.get(key);
  }
  try {
    const result = await rpcCall(apiKey, "eth_call", [{ to: gauge, data: REWARD_TOKEN_SELECTOR }, "latest"]);
    const rewardToken = decodeAddressCallResult(result);
    const normalized = rewardToken ? ethers.getAddress(rewardToken) : null;
    state.gaugeRewardTokenByAddress.set(key, normalized);
    return normalized;
  } catch {
    state.gaugeRewardTokenByAddress.set(key, null);
    return null;
  }
}

async function resolvePancakeRewardToken(masterchefAddress, apiKey) {
  const chef = ethers.getAddress(masterchefAddress);
  const selectors = [CAKE_SELECTOR, CAKE_LOWER_SELECTOR];
  for (const selector of selectors) {
    try {
      const result = await rpcCall(apiKey, "eth_call", [{ to: chef, data: selector }, "latest"]);
      const token = decodeAddressCallResult(result);
      if (token && token.toLowerCase() !== ZeroAddress.toLowerCase()) {
        return ethers.getAddress(token);
      }
    } catch {
      // Try next selector.
    }
  }
  return ethers.getAddress(PANCAKE_CAKE_TOKEN);
}

async function fetchAerodromeEmissions24h(row, blockWindow, apiKey, provider) {
  if (row.adapterType !== "aerodrome_clgauge") {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_unclassified"
    };
  }

  const gaugeAddress = ethers.getAddress(row.currentOwner);
  const tokenWord = padTokenIdToWord(row.tokenIdHex);
  const tokenTopic = tokenIdToTopic(row.tokenIdHex).toLowerCase();
  const earnedData = `${EARNED_SELECTOR}${encodeAddressWord(row.vfatContract)}${tokenWord}`;

  let pendingNow;
  let pendingStart;
  try {
    const [nowResult, startResult] = await Promise.all([
      rpcCall(apiKey, "eth_call", [{ to: gaugeAddress, data: earnedData }, "latest"]),
      rpcCall(apiKey, "eth_call", [{ to: gaugeAddress, data: earnedData }, blockWindow.fromBlockTag])
    ]);
    pendingNow = decodeUint256CallResult(nowResult);
    pendingStart = decodeUint256CallResult(startResult);
  } catch {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  let realizedAttributed = 0n;
  let ambiguousClaims = 0n;
  const rewardToken = await resolveGaugeRewardToken(gaugeAddress, apiKey);
  if (!rewardToken) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  let rewardTransfers = [];
  try {
    rewardTransfers = await fetchErc20TransfersInWindow(apiKey, {
      fromAddress: gaugeAddress,
      toAddress: row.vfatContract,
      contractAddresses: [rewardToken],
      fromBlockTag: blockWindow.fromBlockTag,
      toBlockTag: blockWindow.toBlockTag
    });
  } catch {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  for (const transfer of rewardTransfers) {
    const claimAmount = parseTransferRawAmount(transfer);
    if (claimAmount <= 0n) {
      continue;
    }

    const tx = await fetchTransactionByHashCached(apiKey, transfer.hash);
    if (!tx?.input) {
      ambiguousClaims += claimAmount;
      continue;
    }

    const selector = parseTxSelector(tx.input);
    if (selector === GET_REWARD_BY_TOKEN_SELECTOR) {
      const txTokenWord = (readCalldataArgWord(tx.input, 0) || "").toLowerCase();
      if (`0x${txTokenWord}` === tokenTopic) {
        realizedAttributed += claimAmount;
      } else {
        ambiguousClaims += claimAmount;
      }
    } else {
      ambiguousClaims += claimAmount;
    }
  }
  if (!rewardToken || !provider) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const pendingDelta = safePositive(pendingNow - pendingStart);
  const emissionsRaw = pendingDelta + realizedAttributed;
  const tokenMeta = await getTokenMeta(rewardToken, provider);
  const prices = await getPrices([tokenMeta.address], apiKey);
  const rewardPrice = prices[tokenMeta.address];
  if (!Number.isFinite(rewardPrice)) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const emissionsAmount = normalizeAmount(emissionsRaw, tokenMeta.decimals);
  const emissions24hUsd = emissionsAmount * rewardPrice;
  const metricsReason = ambiguousClaims > 0n ? "partial_ambiguous_claim" : "full";
  const metricsQuality = ambiguousClaims > 0n ? "partial" : "full";

  return {
    emissions24hUsd,
    emissions24hBreakdown: [{
      token: tokenMeta.address,
      symbol: tokenMeta.symbol,
      amount: emissionsAmount,
      usd: emissions24hUsd,
      pendingNow: normalizeAmount(pendingNow, tokenMeta.decimals)
    }],
    metricsQuality,
    metricsReason
  };
}

async function fetchPancakeEmissions24h(row, blockWindow, apiKey, provider) {
  if (row.adapterType !== "pancake_masterchef") {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_unclassified"
    };
  }

  const masterchef = ethers.getAddress(row.currentOwner);
  const tokenWord = padTokenIdToWord(row.tokenIdHex);
  let pendingNow;
  let pendingStart;
  try {
    const data = `${PENDING_CAKE_SELECTOR}${tokenWord}`;
    const [nowResult, startResult] = await Promise.all([
      rpcCall(apiKey, "eth_call", [{ to: masterchef, data }, "latest"]),
      rpcCall(apiKey, "eth_call", [{ to: masterchef, data }, blockWindow.fromBlockTag])
    ]);
    pendingNow = decodeUint256CallResult(nowResult);
    pendingStart = decodeUint256CallResult(startResult);
  } catch {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const rewardToken = await resolvePancakeRewardToken(masterchef, apiKey);
  if (!rewardToken || !provider) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  let rewardTransfers = [];
  try {
    rewardTransfers = await fetchErc20TransfersInWindow(apiKey, {
      fromAddress: masterchef,
      toAddress: row.vfatContract,
      contractAddresses: [rewardToken],
      fromBlockTag: blockWindow.fromBlockTag,
      toBlockTag: blockWindow.toBlockTag
    });
  } catch {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const tokenTopic = tokenIdToTopic(row.tokenIdHex).toLowerCase();
  let realizedAttributed = 0n;
  let ambiguousClaims = 0n;
  for (const transfer of rewardTransfers) {
    const rawAmount = parseTransferRawAmount(transfer);
    if (rawAmount <= 0n) {
      continue;
    }
    const tx = await fetchTransactionByHashCached(apiKey, transfer.hash);
    const selector = parseTxSelector(tx?.input);
    if (selector === HARVEST_BY_TOKEN_SELECTOR) {
      const txTokenWord = (readCalldataArgWord(tx.input, 0) || "").toLowerCase();
      if (`0x${txTokenWord}` === tokenTopic) {
        realizedAttributed += rawAmount;
      } else {
        ambiguousClaims += rawAmount;
      }
    } else {
      ambiguousClaims += rawAmount;
    }
  }

  const pendingDelta = safePositive(pendingNow - pendingStart);
  const emissionsRaw = pendingDelta + realizedAttributed;
  const tokenMeta = await getTokenMeta(rewardToken, provider);
  const prices = await getPrices([tokenMeta.address], apiKey);
  const rewardPrice = prices[tokenMeta.address];
  if (!Number.isFinite(rewardPrice)) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const emissionsAmount = normalizeAmount(emissionsRaw, tokenMeta.decimals);
  const emissions24hUsd = emissionsAmount * rewardPrice;
  return {
    emissions24hUsd,
    emissions24hBreakdown: [{
      token: tokenMeta.address,
      symbol: tokenMeta.symbol,
      amount: emissionsAmount,
      usd: emissions24hUsd,
      pendingNow: normalizeAmount(pendingNow, tokenMeta.decimals)
    }],
    metricsQuality: ambiguousClaims > 0n ? "partial" : "full",
    metricsReason: ambiguousClaims > 0n ? "partial_ambiguous_claim" : "full"
  };
}

async function fetchEmissions24h(row, blockWindow, apiKey, provider) {
  const adapter = CL_PROTOCOL_ADAPTERS[row.protocol] || {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "none"
  };
  if (adapter.emissionsMode === "none") {
    return {
      emissions24hUsd: 0,
      emissions24hBreakdown: [],
      metricsQuality: "full",
      metricsReason: "full"
    };
  }

  if (row.protocol === "Aerodrome SlipStream") {
    return fetchAerodromeEmissions24h(row, blockWindow, apiKey, provider);
  }

  if (row.protocol === "PancakeSwap V3") {
    return fetchPancakeEmissions24h(row, blockWindow, apiKey, provider);
  }

  return {
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    metricsQuality: "partial",
    metricsReason: "partial_unclassified"
  };
}

async function enrichCurrentRowWith24hMetrics(row, blockWindow, apiKey, provider) {
  const adapter = CL_PROTOCOL_ADAPTERS[row.protocol] || {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "none"
  };
  const defaults = {
    currentPoolUsd: null,
    fees24hToken0: null,
    fees24hToken1: null,
    fees24hUsd: null,
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    apr24hPct: null,
    metricsQuality: "partial",
    metricsReason: "partial_call_failed"
  };

  const snapshotNow = await fetchClaimableSnapshotAtBlock(row, "latest", apiKey, provider);
  if (!snapshotNow) {
    return { ...row, ...defaults };
  }

  const snapshot24h = await fetchClaimableSnapshotAtBlock(row, blockWindow.fromBlockTag, apiKey, provider);
  const collect24h = await fetchCollectAmounts24h(row, apiKey, blockWindow);

  const pendingNow0 = snapshotNow.claimable?.amount0 || 0n;
  const pendingNow1 = snapshotNow.claimable?.amount1 || 0n;
  const pendingStart0 = snapshot24h?.claimable?.amount0 || 0n;
  const pendingStart1 = snapshot24h?.claimable?.amount1 || 0n;
  const rawFees0 = safePositive(collect24h.amount0 + (pendingNow0 - pendingStart0));
  const rawFees1 = safePositive(collect24h.amount1 + (pendingNow1 - pendingStart1));
  const fees24hRaw0 = adapter.feesMode === "none" ? 0n : rawFees0;
  const fees24hRaw1 = adapter.feesMode === "none" ? 0n : rawFees1;

  const valuation = await calculateCurrentPoolUsd(snapshotNow, provider, apiKey);
  const token0Meta = valuation.token0Meta;
  const token1Meta = valuation.token1Meta;
  if (!token0Meta || !token1Meta || !valuation.prices) {
    return { ...row, ...defaults };
  }

  const fees24hToken0 = normalizeAmount(fees24hRaw0, token0Meta.decimals);
  const fees24hToken1 = normalizeAmount(fees24hRaw1, token1Meta.decimals);
  const price0 = valuation.prices[token0Meta.address] ?? 0;
  const price1 = valuation.prices[token1Meta.address] ?? 0;
  const fees24hUsd = (Number.isFinite(price0) ? fees24hToken0 * price0 : 0) + (Number.isFinite(price1) ? fees24hToken1 * price1 : 0);
  let emissions = {
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    metricsQuality: "partial",
    metricsReason: "partial_call_failed"
  };
  try {
    emissions = await fetchEmissions24h(row, blockWindow, apiKey, provider);
  } catch {
    // Keep fees + APR path alive even if emission endpoints fail.
  }
  const currentPoolUsd = valuation.currentPoolUsd;
  const feeContribution = adapter.feesMode === "none" ? 0 : (Number.isFinite(fees24hUsd) ? fees24hUsd : 0);
  const emissionContribution = Number.isFinite(emissions.emissions24hUsd) ? emissions.emissions24hUsd : 0;
  const numerator = feeContribution + emissionContribution;
  const apr24hPct = Number.isFinite(currentPoolUsd) && currentPoolUsd > 0
    ? (numerator / currentPoolUsd) * 365 * 100
    : null;
  const metricsQuality = emissions.metricsQuality === "partial" ? "partial" : "full";

  return {
    ...row,
    currentPoolUsd,
    fees24hToken0,
    fees24hToken1,
    fees24hUsd,
    emissions24hUsd: emissions.emissions24hUsd,
    emissions24hBreakdown: emissions.emissions24hBreakdown,
    apr24hPct,
    metricsQuality,
    metricsReason: emissions.metricsReason
  };
}

async function enrichCurrentRowsWith24hMetrics(rows, apiKey, provider, onStatus = () => {}) {
  if (!rows.length) {
    return [];
  }

  onStatus("Resolving 24h block window for VFat metrics...");
  let blockWindow;
  try {
    blockWindow = await resolve24hBlockWindow(apiKey);
  } catch {
    return rows.map((row) => ({
      ...row,
      currentPoolUsd: null,
      fees24hToken0: null,
      fees24hToken1: null,
      fees24hUsd: null,
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      apr24hPct: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    }));
  }
  const enriched = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    onStatus(`Calculating 24h fees/emissions APR (${i + 1}/${rows.length}) for ${row.protocol} #${row.tokenIdDecimal}...`);
    try {
      const withMetrics = await enrichCurrentRowWith24hMetrics(row, blockWindow, apiKey, provider);
      enriched.push(withMetrics);
    } catch {
      enriched.push({
        ...row,
        currentPoolUsd: null,
        fees24hToken0: null,
        fees24hToken1: null,
        fees24hUsd: null,
        emissions24hUsd: null,
        emissions24hBreakdown: [],
        apr24hPct: null,
        metricsQuality: "partial",
        metricsReason: "partial_call_failed"
      });
    }
  }
  return enriched;
}

async function buildCurrentOwnedRows(historyRows, apiKey, provider, onStatus = () => {}) {
  const rowsByToken = new Map();
  for (const row of historyRows) {
    const list = rowsByToken.get(row.tokenKey) || [];
    list.push(row);
    rowsByToken.set(row.tokenKey, list);
  }

  const currentOwnedRows = [];
  for (const rows of rowsByToken.values()) {
    rows.sort(compareClRowsAsc);
    const latest = rows[rows.length - 1];
    const vfatLower = latest.vfatContract.toLowerCase();
    const latestOwner = latest.to.toLowerCase();
    if (latestOwner === ZeroAddress.toLowerCase()) {
      continue;
    }

    currentOwnedRows.push({
      ...latest,
      currentOwner: latest.to,
      ownerScope: latestOwner === vfatLower ? "vfat" : "external",
      ownerCheck: "unchecked",
      ownerResolved: null
    });
  }

  if (!currentOwnedRows.length) {
    return [];
  }

  onStatus("Validating active CL positions with live owner + liquidity checks...");
  const validations = await Promise.allSettled(
    currentOwnedRows.map((row) => fetchLiveNftState(row.tokenContract, row.tokenIdHex, apiKey, provider))
  );

  const filteredRows = [];
  for (let i = 0; i < currentOwnedRows.length; i += 1) {
    const row = currentOwnedRows[i];
    const validation = validations[i];

    if (validation.status !== "fulfilled") {
      continue;
    }

    const liveOwner = validation.value.ownerAddress;
    const liquidity = validation.value.liquidity;
    if (!liveOwner || liveOwner.toLowerCase() === ZeroAddress.toLowerCase() || !liquidity || liquidity <= 0n) {
      continue;
    }

    const latestToLower = row.currentOwner.toLowerCase();
    const liveOwnerLower = liveOwner.toLowerCase();
    row.currentOwner = liveOwner;
    row.ownerScope = liveOwnerLower === row.vfatContract.toLowerCase() ? "vfat" : "external";
    row.ownerCheck = liveOwnerLower === latestToLower ? "confirmed" : "uncertain";
    row.ownerResolved = liveOwnerLower;
    row.liveLiquidity = liquidity.toString();
    row.poolPair = validation.value.pairLabel;
    row.poolFee = validation.value.fee;
    row.poolToken0 = validation.value.token0Address;
    row.poolToken1 = validation.value.token1Address;
    row.poolTickLower = validation.value.tickLower;
    row.poolTickUpper = validation.value.tickUpper;
    row.poolRangeLowerPrice = validation.value.rangeLowerPrice;
    row.poolRangeUpperPrice = validation.value.rangeUpperPrice;
    row.poolCurrentPrice = validation.value.currentPrice;
    row.adapterType = await classifyOwnerAdapter(row, apiKey);
    filteredRows.push(row);
  }

  filteredRows.sort(compareClRowsDesc);
  return filteredRows;
}

async function fetchVFatClDataForWallet(wallet, apiKey, provider, onStatus = () => {}) {
  onStatus("Discovering direct deployments on Base for VFat extraction...");
  const directDeployedContracts = await findDirectlyDeployedContracts(wallet, apiKey);
  onStatus("Checking known Sickle factory deployments on Base...");
  const factoryDeployedContracts = await findFactoryDeployedContracts(wallet, apiKey);
  const deployedContracts = [...new Set([...directDeployedContracts, ...factoryDeployedContracts])];
  onStatus("Identifying VFat contracts from discovered deployments...");
  const identifiedVfatContracts = await identifyVFatContracts(deployedContracts, provider);
  const vfatClHistoryRows = [];

  for (const vfatContract of identifiedVfatContracts) {
    onStatus(`Fetching CL transfer history for ${shortenAddress(vfatContract.address)}...`);
    const rows = await fetchClTransfersForVfatContract(vfatContract.address, apiKey);
    vfatClHistoryRows.push(...rows);
  }

  const currentOwnedRows = await buildCurrentOwnedRows(vfatClHistoryRows, apiKey, provider, onStatus);
  onStatus("Computing 24h fees, emissions, and APR for active CL positions...");
  const vfatClCurrentRows = await enrichCurrentRowsWith24hMetrics(currentOwnedRows, apiKey, provider, onStatus);
  const vfatClCurrentTokenCount = vfatClCurrentRows.length;
  const vfatClOwnedByVfatCount = vfatClCurrentRows.filter((row) => row.ownerScope === "vfat").length;
  const vfatClExternalizedCount = vfatClCurrentRows.filter((row) => row.ownerScope === "external").length;
  const vfatClUncertainCount = vfatClCurrentRows.filter((row) => row.ownerCheck !== "confirmed").length;

  return {
    directDeployedContracts,
    factoryDeployedContracts,
    deployedContracts,
    vfatContracts: identifiedVfatContracts,
    vfatClCurrentRows,
    vfatClCurrentTokenCount,
    vfatClOwnedByVfatCount,
    vfatClExternalizedCount,
    vfatClUncertainCount
  };
}

function shortenAddress(address) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function shortenHash(hash) {
  if (!hash || typeof hash !== "string") {
    return "n/a";
  }
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatUsdFixed(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}

function formatToken(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const abs = Math.abs(value);
  const resolvedDecimals = abs >= 1000 ? 2 : abs >= 1 ? Math.min(decimals, 4) : 6;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: resolvedDecimals
  }).format(value);
}

function formatPercent(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(value)}%`;
}

function formatFeeTier(fee) {
  return `${(Number(fee) / 10000).toFixed(Number(fee) % 10000 === 0 ? 0 : 2)}%`;
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function formatTimeStamp(date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function tokenClass(symbol) {
  const key = symbol.toUpperCase();
  if (key === "WETH" || key === "ETH") {
    return "token-weth";
  }
  if (key === "USDC") {
    return "token-usdc";
  }
  return "token-default";
}

async function getTokenMeta(address, provider) {
  const normalized = ethers.getAddress(address);
  if (state.tokens.has(normalized)) {
    return state.tokens.get(normalized);
  }

  const contract = new ethers.Contract(normalized, ERC20_ABI, provider);
  const [symbolResult, decimalsResult] = await Promise.allSettled([
    contract.symbol(),
    contract.decimals()
  ]);

  const meta = {
    address: normalized,
    symbol: symbolResult.status === "fulfilled" ? symbolResult.value : normalized.slice(2, 6).toUpperCase(),
    decimals: decimalsResult.status === "fulfilled" ? Number(decimalsResult.value) : 18
  };

  state.tokens.set(normalized, meta);
  return meta;
}

async function getPrices(addresses, apiKey) {
  const missing = addresses.filter((address) => !state.prices.has(address));
  if (missing.length) {
    const response = await fetch(`${PRICE_API_BASE}/${apiKey}/tokens/by-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addresses: missing.map((address) => ({
          network: "base-mainnet",
          address
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Price lookup failed (${response.status})`);
    }

    const payload = await response.json();
    for (const item of payload.data || []) {
      const price = item.prices?.find((entry) => entry.currency === "usd")?.value;
      state.prices.set(ethers.getAddress(item.address), price ? Number(price) : null);
    }
    for (const address of missing) {
      if (!state.prices.has(address)) {
        state.prices.set(address, null);
      }
    }
  }

  return addresses.reduce((accumulator, address) => {
    accumulator[address] = state.prices.get(address) ?? null;
    return accumulator;
  }, {});
}

function normalizeAmount(amount, decimals) {
  return Number(ethers.formatUnits(amount, decimals));
}

function tickToPrice(tick, token0Decimals, token1Decimals) {
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function subIn256(a, b) {
  return a >= b ? a - b : (MaxUint256 - (b - a)) + 1n;
}

// Ported from Uniswap TickMath so we can convert ticks to sqrt ratios in the browser.
function getSqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error(`Tick out of range: ${tick}`);
  }

  let absTick = BigInt(tick < 0 ? -tick : tick);
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) {
    ratio = MaxUint256 / ratio;
  }

  const result = ratio >> 32n;
  return (ratio & ((1n << 32n) - 1n)) === 0n ? result : result + 1n;
}

function getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  let sqrtA = sqrtRatioAX96;
  let sqrtB = sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 <= sqrtA) {
    amount0 = ((liquidity * (sqrtB - sqrtA)) * Q96) / sqrtB / sqrtA;
  } else if (sqrtPriceX96 < sqrtB) {
    amount0 = ((liquidity * (sqrtB - sqrtPriceX96)) * Q96) / sqrtB / sqrtPriceX96;
    amount1 = (liquidity * (sqrtPriceX96 - sqrtA)) / Q96;
  } else {
    amount1 = (liquidity * (sqrtB - sqrtA)) / Q96;
  }

  return { amount0, amount1 };
}

// This mirrors Uniswap fee-growth math and returns the currently claimable token amounts.
function getClaimableAmounts(position, poolState) {
  const feeGrowthGlobal0 = BigInt(poolState.feeGrowthGlobal0);
  const feeGrowthGlobal1 = BigInt(poolState.feeGrowthGlobal1);
  const feeGrowthOutsideLower0 = BigInt(poolState.lowerTick.feeGrowthOutside0X128);
  const feeGrowthOutsideLower1 = BigInt(poolState.lowerTick.feeGrowthOutside1X128);
  const feeGrowthOutsideUpper0 = BigInt(poolState.upperTick.feeGrowthOutside0X128);
  const feeGrowthOutsideUpper1 = BigInt(poolState.upperTick.feeGrowthOutside1X128);
  const tickCurrent = Number(poolState.slot0.tick);
  const tickLower = Number(position.tickLower);
  const tickUpper = Number(position.tickUpper);
  const liquidity = BigInt(position.liquidity);

  const feeGrowthBelow0 = tickCurrent >= tickLower ? feeGrowthOutsideLower0 : subIn256(feeGrowthGlobal0, feeGrowthOutsideLower0);
  const feeGrowthBelow1 = tickCurrent >= tickLower ? feeGrowthOutsideLower1 : subIn256(feeGrowthGlobal1, feeGrowthOutsideLower1);
  const feeGrowthAbove0 = tickCurrent < tickUpper ? feeGrowthOutsideUpper0 : subIn256(feeGrowthGlobal0, feeGrowthOutsideUpper0);
  const feeGrowthAbove1 = tickCurrent < tickUpper ? feeGrowthOutsideUpper1 : subIn256(feeGrowthGlobal1, feeGrowthOutsideUpper1);

  const feeGrowthInside0 = subIn256(subIn256(feeGrowthGlobal0, feeGrowthBelow0), feeGrowthAbove0);
  const feeGrowthInside1 = subIn256(subIn256(feeGrowthGlobal1, feeGrowthBelow1), feeGrowthAbove1);

  const pending0 = BigInt(position.tokensOwed0) + (liquidity * subIn256(feeGrowthInside0, BigInt(position.feeGrowthInside0LastX128))) / Q128;
  const pending1 = BigInt(position.tokensOwed1) + (liquidity * subIn256(feeGrowthInside1, BigInt(position.feeGrowthInside1LastX128))) / Q128;

  return { amount0: pending0, amount1: pending1 };
}

async function fetchPosition(tokenId, provider) {
  const manager = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI, provider);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const position = await manager.positions(tokenId);

  const [token0Meta, token1Meta, poolAddress] = await Promise.all([
    getTokenMeta(position.token0, provider),
    getTokenMeta(position.token1, provider),
    factory.getPool(position.token0, position.token1, position.fee)
  ]);

  if (poolAddress === ZeroAddress) {
    throw new Error(`No pool found for token ${tokenId.toString()}`);
  }

  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [slot0, feeGrowthGlobal0, feeGrowthGlobal1, lowerTick, upperTick] = await Promise.all([
    pool.slot0(),
    pool.feeGrowthGlobal0X128(),
    pool.feeGrowthGlobal1X128(),
    pool.ticks(position.tickLower),
    pool.ticks(position.tickUpper)
  ]);

  const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96);
  const sqrtLowerX96 = getSqrtRatioAtTick(Number(position.tickLower));
  const sqrtUpperX96 = getSqrtRatioAtTick(Number(position.tickUpper));
  const liquidity = BigInt(position.liquidity);
  const pooled = getAmountsForLiquidity(sqrtPriceX96, sqrtLowerX96, sqrtUpperX96, liquidity);
  const claimable = getClaimableAmounts(position, {
    slot0,
    feeGrowthGlobal0,
    feeGrowthGlobal1,
    lowerTick,
    upperTick
  });

  const currentTick = Number(slot0.tick);
  const inRange = currentTick >= Number(position.tickLower) && currentTick < Number(position.tickUpper);
  const price0 = tickToPrice(currentTick, token0Meta.decimals, token1Meta.decimals);
  const rangePriceLower = tickToPrice(Number(position.tickLower), token0Meta.decimals, token1Meta.decimals);
  const rangePriceUpper = tickToPrice(Number(position.tickUpper), token0Meta.decimals, token1Meta.decimals);

  return {
    tokenId,
    poolAddress,
    position,
    currentTick,
    inRange,
    liquidity,
    pooled,
    claimable,
    token0: token0Meta,
    token1: token1Meta,
    price0,
    rangePriceLower,
    rangePriceUpper
  };
}

function enrichValues(position, prices) {
  const token0Price = prices[position.token0.address] ?? null;
  const token1Price = prices[position.token1.address] ?? null;
  const pooled0 = normalizeAmount(position.pooled.amount0, position.token0.decimals);
  const pooled1 = normalizeAmount(position.pooled.amount1, position.token1.decimals);
  const claimable0 = normalizeAmount(position.claimable.amount0, position.token0.decimals);
  const claimable1 = normalizeAmount(position.claimable.amount1, position.token1.decimals);
  const pooledUsd = (token0Price ? pooled0 * token0Price : 0) + (token1Price ? pooled1 * token1Price : 0);
  const claimableUsd = (token0Price ? claimable0 * token0Price : 0) + (token1Price ? claimable1 * token1Price : 0);

  return {
    ...position,
    token0Price,
    token1Price,
    pooled0,
    pooled1,
    claimable0,
    claimable1,
    pooledUsd,
    claimableUsd
  };
}

async function fetchPortfolio(wallet, apiKey, onStatus = () => {}) {
  const provider = getProvider(apiKey);
  const owner = ethers.getAddress(wallet);
  const manager = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI, provider);
  onStatus("Fetching position NFTs from Uniswap v3 on Base...");
  const balance = Number(await manager.balanceOf(owner));
  const ids = await Promise.all(
    Array.from({ length: balance }, (_, index) => manager.tokenOfOwnerByIndex(owner, index))
  );

  const rawPositions = await Promise.all(ids.map((tokenId) => fetchPosition(tokenId, provider)));
  const uniqueAddresses = [...new Set(rawPositions.flatMap((item) => [item.token0.address, item.token1.address]))];
  const prices = await getPrices(uniqueAddresses, apiKey);
  const positions = rawPositions.map((item) => enrichValues(item, prices));
  const openPositions = positions.filter((item) => item.liquidity > 0n);
  const exitedPositions = positions.filter((item) => item.liquidity === 0n);
  const inRangeCount = openPositions.filter((item) => item.inRange).length;
  const vfatData = {
    directDeployedContracts: [],
    factoryDeployedContracts: [],
    deployedContracts: [],
    vfatContracts: [],
    vfatClCurrentRows: [],
    vfatClCurrentTokenCount: 0,
    vfatClOwnedByVfatCount: 0,
    vfatClExternalizedCount: 0,
    vfatClUncertainCount: 0,
    vfatClError: ""
  };

  try {
    const fetchedVfat = await fetchVFatClDataForWallet(owner, apiKey, provider, onStatus);
    vfatData.directDeployedContracts = fetchedVfat.directDeployedContracts;
    vfatData.factoryDeployedContracts = fetchedVfat.factoryDeployedContracts;
    vfatData.deployedContracts = fetchedVfat.deployedContracts;
    vfatData.vfatContracts = fetchedVfat.vfatContracts;
    vfatData.vfatClCurrentRows = fetchedVfat.vfatClCurrentRows;
    vfatData.vfatClCurrentTokenCount = fetchedVfat.vfatClCurrentTokenCount;
    vfatData.vfatClOwnedByVfatCount = fetchedVfat.vfatClOwnedByVfatCount;
    vfatData.vfatClExternalizedCount = fetchedVfat.vfatClExternalizedCount;
    vfatData.vfatClUncertainCount = fetchedVfat.vfatClUncertainCount;
  } catch (error) {
    vfatData.vfatClError = error?.message || "Failed to fetch VFat CL position transfers.";
  }

  return {
    owner,
    openPositions,
    exitedPositions,
    directDeployedContracts: vfatData.directDeployedContracts,
    factoryDeployedContracts: vfatData.factoryDeployedContracts,
    deployedContracts: vfatData.deployedContracts,
    vfatContracts: vfatData.vfatContracts,
    vfatClCurrentRows: vfatData.vfatClCurrentRows,
    vfatClCurrentTokenCount: vfatData.vfatClCurrentTokenCount,
    vfatClOwnedByVfatCount: vfatData.vfatClOwnedByVfatCount,
    vfatClExternalizedCount: vfatData.vfatClExternalizedCount,
    vfatClUncertainCount: vfatData.vfatClUncertainCount,
    vfatClError: vfatData.vfatClError,
    totals: {
      pooledUsd: openPositions.reduce((sum, item) => sum + item.pooledUsd, 0),
      claimableUsd: openPositions.reduce((sum, item) => sum + item.claimableUsd, 0),
      inRangeCount
    }
  };
}

function renderSummary(portfolio) {
  const { owner, openPositions, totals } = portfolio;
  const outOfRange = openPositions.length - totals.inRangeCount;
  els.accountBadge.textContent = owner.slice(2, 4).toUpperCase();
  els.walletHeadline.textContent = shortenAddress(owner);
  els.walletSubline.textContent = `${openPositions.length} active position${openPositions.length === 1 ? "" : "s"} on Base`;
  els.totalValue.textContent = formatUsd(totals.pooledUsd);
  els.totalClaimable.textContent = formatUsd(totals.claimableUsd);
  els.openCount.textContent = String(openPositions.length);
  els.rangeSummary.textContent = `${totals.inRangeCount} / ${openPositions.length}`;
  els.exchangeCountChip.textContent = `${new Set(openPositions.map((item) => item.poolAddress)).size} pool${openPositions.length === 1 ? "" : "s"}`;
  els.openSectionTitle.textContent = `Open LP positions (${portfolio.openPositions.length})`;
  els.exitedSectionTitle.textContent = `Exited LP positions (${portfolio.exitedPositions.length})`;
  if (openPositions.length) {
    setStatus(`${totals.inRangeCount} in range, ${outOfRange} out of range.`, "success");
  } else {
    setStatus("No active Base Uniswap v3 positions found.");
  }
}

function createTokenBreakdown(symbolA, valueA, symbolB, valueB) {
  return `${formatToken(valueA)} ${symbolA}<br>${formatToken(valueB)} ${symbolB}`;
}

function renderPositionCard(position) {
  const denominator = Number(position.position.tickUpper) - Number(position.position.tickLower) || 1;
  const rangePercent = clamp((position.currentTick - Number(position.position.tickLower)) / denominator, 0, 1) * 100;
  const card = document.createElement("article");
  card.className = "position-card";
  const statusClass = position.inRange ? "in-range" : "out-range";
  const statusLabel = position.inRange ? "In range" : "Out of range";
  const priceQuote = Number.isFinite(position.price0)
    ? `1 ${position.token0.symbol} = ${formatToken(position.price0, 4)} ${position.token1.symbol}`
    : "n/a";

  card.innerHTML = `
    <div class="position-head">
      <div>
        <div class="pair-title">
          <div class="token-stack">
            <span class="token-pill ${tokenClass(position.token0.symbol)}">${position.token0.symbol.slice(0, 2)}</span>
            <span class="token-pill ${tokenClass(position.token1.symbol)}">${position.token1.symbol.slice(0, 2)}</span>
          </div>
          <h3>${position.token0.symbol}/${position.token1.symbol}</h3>
          <span class="chip fee">${formatFeeTier(position.position.fee)}</span>
        </div>
        <div class="chip-row">
          <span class="chip ${statusClass}">${statusLabel}</span>
          <span class="chip base">Base</span>
          <span class="chip protocol">Uniswap v3</span>
          <span class="chip subtle">NFT #${position.tokenId.toString()}</span>
        </div>
      </div>

      <div class="chip-row">
        <span class="chip subtle mono">tick ${position.currentTick}</span>
        <span class="chip subtle mono">${position.position.tickLower} -> ${position.position.tickUpper}</span>
      </div>

      <div class="right-actions">
        <span class="chip subtle mono">pool ${shortenAddress(position.poolAddress)}</span>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <p class="field-label">pooled assets</p>
        <div class="summary-value">${formatUsd(position.pooledUsd)}</div>
        <div class="metric-sub">${createTokenBreakdown(position.token0.symbol, position.pooled0, position.token1.symbol, position.pooled1)}</div>
      </div>

      <div class="metric-card">
        <p class="field-label">claimable now</p>
        <div class="summary-value">${formatUsd(position.claimableUsd)}</div>
        <div class="metric-sub">${createTokenBreakdown(position.token0.symbol, position.claimable0, position.token1.symbol, position.claimable1)}</div>
      </div>

      <div class="metric-card">
        <p class="field-label">current price</p>
        <div class="summary-value">${priceQuote}</div>
        <div class="metric-sub">using live pool tick on Base</div>
      </div>

      <div class="metric-card">
        <p class="field-label">liquidity</p>
        <div class="summary-value">${formatCompactNumber(Number(position.liquidity))}</div>
        <div class="metric-sub">raw Uniswap liquidity units</div>
      </div>
    </div>

    <div class="range-wrap">
      <div class="range-caption">
        <p class="note">range ${formatToken(position.rangePriceLower, 4)} -> ${formatToken(position.rangePriceUpper, 4)} ${position.token1.symbol} per ${position.token0.symbol}</p>
        <p class="note">${statusLabel}</p>
      </div>
      <div class="range-track">
        <div class="range-pointer ${position.inRange ? "" : "outside"}" style="left:${rangePercent}%"></div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-card">
        <p class="detail-label">token prices</p>
        <div class="detail-value mono">
          ${position.token0.symbol}: ${position.token0Price ? formatUsd(position.token0Price) : "n/a"}<br>
          ${position.token1.symbol}: ${position.token1Price ? formatUsd(position.token1Price) : "n/a"}
        </div>
      </div>

      <div class="detail-card">
        <p class="detail-label">contract addresses</p>
        <div class="detail-value mono">
          ${position.token0.symbol}: ${shortenAddress(position.token0.address)}<br>
          ${position.token1.symbol}: ${shortenAddress(position.token1.address)}
        </div>
      </div>

      <div class="detail-card">
        <p class="detail-label">calculation note</p>
        <div class="detail-value">
          Claimable value is derived from live fee-growth math and may include any tokens currently owed to the NFT.
        </div>
      </div>
    </div>
  `;

  return card;
}

function renderPositions(portfolio) {
  els.openPositions.innerHTML = "";
  els.exitedPositions.innerHTML = "";

  if (!portfolio.openPositions.length) {
    els.openEmpty.classList.remove("hidden");
  } else {
    els.openEmpty.classList.add("hidden");
    for (const position of portfolio.openPositions) {
      els.openPositions.appendChild(renderPositionCard(position));
    }
  }

  if (!portfolio.exitedPositions.length) {
    els.exitedEmpty.classList.remove("hidden");
  } else {
    els.exitedEmpty.classList.add("hidden");
    for (const position of portfolio.exitedPositions) {
      els.exitedPositions.appendChild(renderPositionCard(position));
    }
  }
}

function metricsQualityView(row) {
  if (row.metricsQuality === "full") {
    return { chipClass: "safe", chipLabel: "full", detail: "protocol-native data" };
  }
  if (row.metricsReason === "partial_ambiguous_claim") {
    return { chipClass: "warning", chipLabel: "partial", detail: "account-wide claim attribution" };
  }
  if (row.metricsReason === "partial_unclassified") {
    return { chipClass: "warning", chipLabel: "partial", detail: "owner adapter unclassified" };
  }
  if (row.metricsReason === "partial_call_failed") {
    return { chipClass: "warning", chipLabel: "partial", detail: "onchain read failed" };
  }
  return { chipClass: "warning", chipLabel: "partial", detail: "incomplete metrics" };
}

function renderCurrentClRow(row) {
  const tr = document.createElement("tr");
  const quality = metricsQualityView(row);
  const safeProtocol = escapeHtml(row.protocol);
  const safePoolPair = escapeHtml(row.poolPair || "Unknown/Unknown");
  const safeFee = Number.isFinite(row.poolFee) ? escapeHtml(formatFeeTier(row.poolFee)) : "n/a";
  const safeRange = Number.isFinite(row.poolRangeLowerPrice) && Number.isFinite(row.poolRangeUpperPrice)
    ? `${escapeHtml(formatToken(row.poolRangeLowerPrice, 6))} -> ${escapeHtml(formatToken(row.poolRangeUpperPrice, 6))}`
    : "n/a";
  const safeCurrentPrice = Number.isFinite(row.poolCurrentPrice)
    ? escapeHtml(formatToken(row.poolCurrentPrice, 6))
    : "n/a";
  const safeFees24h = Number.isFinite(row.fees24hUsd)
    ? escapeHtml(formatUsdFixed(row.fees24hUsd, 3))
    : "n/a";
  const safeEmissions24h = Number.isFinite(row.emissions24hUsd)
    ? escapeHtml(formatUsdFixed(row.emissions24hUsd, 3))
    : "n/a";
  const safeTotalDeposited = Number.isFinite(row.currentPoolUsd)
    ? escapeHtml(formatUsd(row.currentPoolUsd))
    : "n/a";
  const safeApr24h = Number.isFinite(row.apr24hPct)
    ? escapeHtml(formatPercent(row.apr24hPct, 2))
    : "n/a";
  const safeQualityDetail = escapeHtml(quality.detail || "");

  tr.innerHTML = `
    <td>${safeProtocol}</td>
    <td>${safePoolPair}</td>
    <td class="mono">${safeFee}</td>
    <td class="mono">${safeRange}</td>
    <td class="mono">${safeCurrentPrice}</td>
    <td class="mono">${safeFees24h}</td>
    <td class="mono">${safeEmissions24h}<br><span class="chip ${quality.chipClass}">${quality.chipLabel}</span><span class="muted-inline">${safeQualityDetail}</span></td>
    <td class="mono">${safeTotalDeposited}</td>
    <td class="mono">${safeApr24h}</td>
  `;
  return tr;
}

function renderVFatSection(portfolio) {
  const directCount = portfolio.directDeployedContracts.length;
  const factoryCount = portfolio.factoryDeployedContracts.length;
  const deployedCount = portfolio.deployedContracts.length;
  const vfatCount = portfolio.vfatContracts.length;
  const tokenCount = portfolio.vfatClCurrentTokenCount;
  const currentCount = portfolio.vfatClCurrentRows.length;
  const ownedByVfatCount = portfolio.vfatClOwnedByVfatCount;
  const externalizedCount = portfolio.vfatClExternalizedCount;
  const uncertainCount = portfolio.vfatClUncertainCount;

  els.vfatSectionTitle.textContent = `VFat CL positions (Base) (${tokenCount})`;
  els.vfatDeployedCountChip.textContent = `${directCount} direct deployment${directCount === 1 ? "" : "s"}`;
  els.vfatFactoryCountChip.textContent = `${factoryCount} factory deployment${factoryCount === 1 ? "" : "s"}`;
  els.vfatContractsCountChip.textContent = `${vfatCount} VFat contract${vfatCount === 1 ? "" : "s"}`;
  els.vfatCurrentCountChip.textContent = `${currentCount} active positions`;
  els.vfatOwnedByVfatCountChip.textContent = `${ownedByVfatCount} owned by VFat`;
  els.vfatExternalizedCountChip.textContent = `${externalizedCount} externalized`;
  els.vfatUncertainCountChip.textContent = `${uncertainCount} uncertain`;

  els.vfatCurrentTableBody.innerHTML = "";
  els.vfatErrorText.classList.add("hidden");
  els.vfatEmptyNoDeployments.classList.add("hidden");
  els.vfatEmptyNoContracts.classList.add("hidden");
  els.vfatCurrentEmpty.classList.add("hidden");

  if (portfolio.vfatClError) {
    els.vfatErrorText.textContent = `VFat CL pipeline warning: ${portfolio.vfatClError}`;
    els.vfatErrorText.classList.remove("hidden");
  }

  if (deployedCount === 0) {
    els.vfatEmptyNoDeployments.classList.remove("hidden");
    return;
  }

  if (vfatCount === 0) {
    els.vfatEmptyNoContracts.classList.remove("hidden");
    return;
  }

  if (!currentCount) {
    els.vfatCurrentEmpty.classList.remove("hidden");
  } else {
    const sortedRows = [...portfolio.vfatClCurrentRows].sort((a, b) => {
      const aUsd = Number.isFinite(a.currentPoolUsd) ? a.currentPoolUsd : -Infinity;
      const bUsd = Number.isFinite(b.currentPoolUsd) ? b.currentPoolUsd : -Infinity;
      return bUsd - aUsd;
    });
    for (const row of sortedRows) {
      els.vfatCurrentTableBody.appendChild(renderCurrentClRow(row));
    }
  }
}

function clearDashboard() {
  els.totalValue.textContent = "$0.00";
  els.totalClaimable.textContent = "$0.00";
  els.openCount.textContent = "0";
  els.rangeSummary.textContent = "0 / 0";
  els.exchangeCountChip.textContent = "0 pools";
  els.openSectionTitle.textContent = "Open LP positions (0)";
  els.exitedSectionTitle.textContent = "Exited LP positions (0)";
  els.openPositions.innerHTML = "";
  els.exitedPositions.innerHTML = "";
  els.openEmpty.classList.remove("hidden");
  els.exitedEmpty.classList.remove("hidden");
  els.vfatSectionTitle.textContent = "VFat CL positions (Base)";
  els.vfatDeployedCountChip.textContent = "0 direct deployments";
  els.vfatFactoryCountChip.textContent = "0 factory deployments";
  els.vfatContractsCountChip.textContent = "0 VFat contracts";
  els.vfatCurrentCountChip.textContent = "0 active positions";
  els.vfatOwnedByVfatCountChip.textContent = "0 owned by VFat";
  els.vfatExternalizedCountChip.textContent = "0 externalized";
  els.vfatUncertainCountChip.textContent = "0 uncertain";
  els.vfatCurrentTableBody.innerHTML = "";
  els.vfatCurrentEmpty.classList.add("hidden");
  els.vfatErrorText.classList.add("hidden");
  els.vfatEmptyNoDeployments.classList.remove("hidden");
  els.vfatEmptyNoContracts.classList.add("hidden");
}

async function runLookup() {
  const wallet = els.walletInput.value.trim();
  const apiKey = els.alchemyInput.value.trim();

  if (!wallet) {
    setStatus("Enter a wallet address first.", "error");
    return;
  }
  if (!apiKey) {
    setStatus("Enter an Alchemy API key first.", "error");
    return;
  }

  try {
    setBusy(true, "Reading Base contracts...");
    const portfolio = await fetchPortfolio(wallet, apiKey, (message) => setStatus(message));
    renderSummary(portfolio);
    renderPositions(portfolio);
    renderVFatSection(portfolio);
    els.lastUpdatedText.textContent = `Last updated ${formatTimeStamp(new Date())}`;
  } catch (error) {
    clearDashboard();
    setStatus(error.message || "Something went wrong while loading positions.", "error");
    els.lastUpdatedText.textContent = "Fetch failed.";
  } finally {
    setBusy(false);
  }
}

async function boot() {
  clearDashboard();
  await loadEnv();
  if (els.walletInput.value && els.alchemyInput.value) {
    await runLookup();
  } else {
    setStatus("Load `.env` or paste credentials to begin.");
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runLookup();
});

els.refreshTopButton.addEventListener("click", async () => {
  await runLookup();
});

boot();
