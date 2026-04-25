import {
  CHAIN_SEQUENCE,
  BSC_CONSTANTS_PATH,
  CHAIN_CONFIGS,
  AERODROME_VOTER_ADDRESS,
  AERODROME_V2_PAIR_FACTORY_ADDRESS,
  AERODROME_V2_PROTOCOL,
  Q96,
  Q128,
  MaxUint256,
  ZeroAddress,
  SECONDS_PER_DAY,
  PRICE_API_BASE,
  EIP1167_PREFIX,
  EIP1167_SUFFIX,
  SICKLE_DEPLOY_EVENT_TOPIC,
  COLLECT_EVENT_TOPICS,
  SLOT0_SELECTOR,
  EARNED_SELECTOR,
  REWARD_TOKEN_SELECTOR,
  GET_REWARD_BY_TOKEN_SELECTOR,
  GET_REWARD_BY_ACCOUNT_SELECTOR,
  ACCOUNT_WIDE_CLAIM_SELECTORS,
  HARVEST_BY_TOKEN_SELECTOR,
  PENDING_CAKE_SELECTOR,
  CAKE_SELECTOR,
  CAKE_LOWER_SELECTOR,
  PANCAKE_CAKE_TOKEN,
  FEE_GROWTH_GLOBAL0_SELECTOR,
  FEE_GROWTH_GLOBAL1_SELECTOR,
  TICKS_SELECTOR,
  CL_PROTOCOL_ADAPTERS,
  NFPM_ABI,
  FACTORY_ABI,
  FACTORY_INT24_ABI,
  POSITION_MANAGER_ABI,
  AERODROME_VOTER_ABI,
  AERODROME_V2_GAUGE_ABI,
  AERODROME_V2_POOL_ABI,
  AERODROME_V2_FACTORY_ABI,
  POOL_ABI,
  ERC20_ABI,
  STORAGE_KEYS,
  ACCOUNT_BADGE_SIZE,
  JAZZICON_MODULE_URL,
  VFAT_CONTRACT_CACHE_TTL_MS,
  RPC_MAX_RETRIES,
  PRICE_MAX_RETRIES,
  RETRY_BASE_MS,
  TRACE_MAX_FIELD_CHARS,
  TRACE_MAX_ENTRIES
} from "./src/config/constants.js";
import { createStorageService } from "./src/services/storage.js";
import { createTraceLogger } from "./src/services/traceLogger.js";
import { createRpcClient } from "./src/services/rpcClient.js";
import { createPricingService } from "./src/services/pricing.js";
import { createPortfolioFacade } from "./src/domain/portfolio/fetchPortfolio.js";

const { ethers } = window;

let ACTIVE_CHAIN_KEY = "base";
let CHAIN_ID = CHAIN_CONFIGS.base.chainId;
let CHAIN_NAME = CHAIN_CONFIGS.base.chainName;
let CHAIN_RPC_NETWORK = CHAIN_CONFIGS.base.rpcNetwork;
let CHAIN_PRICE_NETWORK = CHAIN_CONFIGS.base.priceNetwork;
let STANDARD_POSITION_MANAGER_ADDRESS = CHAIN_CONFIGS.base.standardPositionManagerAddress;
let ENABLE_AERODROME_V2_PATHS = CHAIN_CONFIGS.base.enableAerodromeV2Paths;
let SICKLE_FACTORY_ALLOWLIST = [
  ...CHAIN_CONFIGS.base.sickleFactoryAllowlist
];
let VFAT_IMPLEMENTATION_ALLOWLIST = new Set([
  ...CHAIN_CONFIGS.base.vfatImplementationAllowlist
]);
let CL_POSITION_MANAGERS = [
  ...CHAIN_CONFIGS.base.clPositionManagers
];
let CL_PROTOCOL_BY_MANAGER = new Map();
function rebuildClProtocolByManager() {
  CL_PROTOCOL_BY_MANAGER = new Map(
    CL_POSITION_MANAGERS.map((item) => [ethers.getAddress(item.address).toLowerCase(), item.protocol])
  );
}
rebuildClProtocolByManager();

function normalizeAddressList(values = []) {
  const normalized = [];
  for (const value of values || []) {
    try {
      normalized.push(ethers.getAddress(value));
    } catch {
      // Ignore invalid addresses in optional config payloads.
    }
  }
  return [...new Set(normalized)];
}

function normalizePositionManagers(values = []) {
  const normalized = [];
  const seen = new Set();
  for (const value of values || []) {
    try {
      const address = ethers.getAddress(value?.address || value);
      const key = address.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const protocol = typeof value?.protocol === "string" && value.protocol.trim()
        ? value.protocol.trim()
        : "Unknown CL";
      normalized.push({ protocol, address });
    } catch {
      // Ignore invalid manager payloads.
    }
  }
  return normalized;
}

function chooseStandardManagerAddress() {
  const pancake = CL_POSITION_MANAGERS.find((item) => item.protocol.toLowerCase().includes("pancake"));
  if (pancake?.address) {
    return ethers.getAddress(pancake.address);
  }
  if (CL_POSITION_MANAGERS[0]?.address) {
    return ethers.getAddress(CL_POSITION_MANAGERS[0].address);
  }
  return ethers.getAddress(STANDARD_POSITION_MANAGER_ADDRESS);
}

async function loadChainOverrides() {
  let bscOverrides = null;
  try {
    const response = await fetch(BSC_CONSTANTS_PATH, { cache: "no-store" });
    if (!response.ok) {
      state.chainOverridesByKey.set("bsc", null);
      return;
    }
    const payload = await response.json();
    const configuredFactories = normalizeAddressList(payload?.sickleFactoryAllowlist || []);
    const configuredImplementations = normalizeAddressList(payload?.vfatImplementationAllowlist || []);
    const configuredManagers = normalizePositionManagers(payload?.clPositionManagers || []);
    bscOverrides = {
      sickleFactoryAllowlist: configuredFactories.length ? configuredFactories : null,
      vfatImplementationAllowlist: configuredImplementations.length ? configuredImplementations : null,
      clPositionManagers: configuredManagers.length ? configuredManagers : null
    };
  } catch {
    bscOverrides = null;
  }
  state.chainOverridesByKey.set("bsc", bscOverrides);
}

function resetRuntimeCaches() {
  state.provider = null;
  state.providerKey = "";
  state.prices.clear();
  state.tokens.clear();
  state.managerFactories.clear();
  state.poolByManagerKey.clear();
  state.txByHash.clear();
  state.ownerAdapterByAddress.clear();
  state.gaugeRewardTokenByAddress.clear();
  state.aerodromeGaugeByAddress.clear();
  state.aerodromeV2PoolByAddress.clear();
  state.aerodromeV2PoolFeeByAddress.clear();
}

function applyChainContext(chainKey) {
  const baseConfig = CHAIN_CONFIGS[chainKey] || CHAIN_CONFIGS.base;
  const overrides = state.chainOverridesByKey.get(chainKey) || null;

  ACTIVE_CHAIN_KEY = baseConfig.key;
  CHAIN_ID = baseConfig.chainId;
  CHAIN_NAME = baseConfig.chainName;
  CHAIN_RPC_NETWORK = baseConfig.rpcNetwork;
  CHAIN_PRICE_NETWORK = baseConfig.priceNetwork;
  STANDARD_POSITION_MANAGER_ADDRESS = baseConfig.standardPositionManagerAddress;
  ENABLE_AERODROME_V2_PATHS = Boolean(baseConfig.enableAerodromeV2Paths);

  const factories = normalizeAddressList(overrides?.sickleFactoryAllowlist || baseConfig.sickleFactoryAllowlist || []);
  SICKLE_FACTORY_ALLOWLIST = factories.length ? factories : [];

  const implementations = normalizeAddressList(overrides?.vfatImplementationAllowlist || baseConfig.vfatImplementationAllowlist || []);
  VFAT_IMPLEMENTATION_ALLOWLIST = new Set(implementations.map((value) => value.toLowerCase()));

  const managers = normalizePositionManagers(overrides?.clPositionManagers || baseConfig.clPositionManagers || []);
  CL_POSITION_MANAGERS = managers;
  rebuildClProtocolByManager();
}

const state = {
  provider: null,
  providerKey: "",
  prices: new Map(),
  tokens: new Map(),
  managerFactories: new Map(),
  poolByManagerKey: new Map(),
  txByHash: new Map(),
  ownerAdapterByAddress: new Map(),
  gaugeRewardTokenByAddress: new Map(),
  aerodromeGaugeByAddress: new Map(),
  aerodromeV2PoolByAddress: new Map(),
  aerodromeV2PoolFeeByAddress: new Map(),
  chainOverridesByKey: new Map(),
  badgeAddress: "",
  jazziconFactory: null,
  jazziconFactoryPromise: null,
  introPlayed: false,
  introCleanupTimer: null,
  updatePulseTimer: null,
  traceSessionId: 0,
  traceStartedAt: "",
  traceEntries: [],
  traceOverflowed: false
};

const els = {
  form: document.getElementById("lookupForm"),
  refreshButton: document.getElementById("refreshButton"),
  refreshTopButton: document.getElementById("refreshTopButton"),
  settingsButton: document.getElementById("settingsButton"),
  downloadLogsButton: document.getElementById("downloadLogsButton"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  settingsCloseButton: document.getElementById("settingsCloseButton"),
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
  totalIncomeDaily: document.getElementById("totalIncomeDaily"),
  incomeProjectionNote: document.getElementById("incomeProjectionNote"),
  openCount: document.getElementById("openCount"),
  rangeSummary: document.getElementById("rangeSummary"),
  rangeSummaryNote: document.getElementById("rangeSummaryNote"),
  exchangeCountChip: document.getElementById("exchangeCountChip"),
  openSectionTitle: document.getElementById("openSectionTitle"),
  openTableBody: document.getElementById("openTableBody"),
  openEmpty: document.getElementById("openEmpty"),
  openDedupeStatus: document.getElementById("openDedupeStatus"),
  vfatContractsCountChip: document.getElementById("vfatContractsCountChip"),
  vfatCurrentCountChip: document.getElementById("vfatCurrentCountChip"),
  vfatUncertainCountChip: document.getElementById("vfatUncertainCountChip"),
  vfatErrorText: document.getElementById("vfatErrorText"),
  loadingFields: Array.from(document.querySelectorAll("[data-loading-field]"))
};

function setLoadingState(isLoading) {
  for (const field of els.loadingFields) {
    field.classList.toggle("loading-field--busy", isLoading);
  }
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function collectIntroTargets() {
  const targets = [];
  const seen = new Set();
  const push = (node) => {
    if (!node || seen.has(node)) {
      return;
    }
    seen.add(node);
    targets.push(node);
  };

  push(document.querySelector(".topbar"));
  push(document.querySelector(".summary"));
  for (const section of document.querySelectorAll(".section-card")) {
    push(section);
  }

  let cardCount = 0;
  for (const card of document.querySelectorAll(".position-card")) {
    if (cardCount >= 10) {
      break;
    }
    push(card);
    cardCount += 1;
  }
  return targets;
}

function runIntroMotionOnce() {
  if (state.introPlayed) {
    return;
  }
  state.introPlayed = true;

  if (prefersReducedMotion()) {
    return;
  }

  const targets = collectIntroTargets();
  if (!targets.length) {
    return;
  }

  targets.forEach((target, index) => {
    target.classList.add("motion-intro");
    target.classList.remove("motion-intro--in");
    target.style.setProperty("--motion-delay", `${Math.min(index * 42, 420)}ms`);
  });

  requestAnimationFrame(() => {
    targets.forEach((target) => target.classList.add("motion-intro--in"));
  });

  if (state.introCleanupTimer) {
    clearTimeout(state.introCleanupTimer);
  }
  state.introCleanupTimer = setTimeout(() => {
    targets.forEach((target) => {
      target.classList.remove("motion-intro", "motion-intro--in");
      target.style.removeProperty("--motion-delay");
    });
    state.introCleanupTimer = null;
  }, 1300);
}

function pulseUpdatedFields() {
  if (prefersReducedMotion() || !els.loadingFields.length) {
    return;
  }

  for (const field of els.loadingFields) {
    field.classList.remove("loading-field--updated");
    // Restart animation class for every refresh cycle.
    void field.offsetWidth;
    field.classList.add("loading-field--updated");
  }

  if (state.updatePulseTimer) {
    clearTimeout(state.updatePulseTimer);
  }
  state.updatePulseTimer = setTimeout(() => {
    for (const field of els.loadingFields) {
      field.classList.remove("loading-field--updated");
    }
    state.updatePulseTimer = null;
  }, 700);
}

function setBusy(isBusy, text = "") {
  if (els.refreshButton) {
    els.refreshButton.disabled = isBusy;
  }
  els.refreshTopButton.disabled = isBusy;
  setLoadingState(isBusy);
  if (text && els.statusText) {
    els.statusText.textContent = text;
  }
}

function setStatus(text, tone = "neutral") {
  if (!els.statusText) {
    return;
  }
  els.statusText.textContent = text;
  els.statusText.style.color = tone === "error" ? "var(--red)" : tone === "success" ? "var(--green)" : "var(--text)";
}

function updateBanner(text, chipText, tone = "neutral") {
  if (!els.bannerText || !els.bannerChip) {
    return;
  }
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

const storageService = createStorageService({
  storageKeys: STORAGE_KEYS,
  getActiveChainKey: () => ACTIVE_CHAIN_KEY,
  normalizeAddressList,
  vfatTtlMs: VFAT_CONTRACT_CACHE_TTL_MS
});

function loadPersistedCredentials() {
  const saved = storageService.loadPersistedCredentials();
  els.walletInput.value = saved.wallet;
  els.alchemyInput.value = saved.apiKey;
}

function persistCredentials(wallet, apiKey) {
  storageService.persistCredentials(wallet, apiKey);
}

function getVfatCacheStorageKey() {
  return storageService.getVfatCacheStorageKey();
}

function readCachedVfatContracts(wallet) {
  return storageService.readCachedVfatContracts(wallet);
}

function writeCachedVfatContracts(wallet, addresses) {
  storageService.writeCachedVfatContracts(wallet, addresses);
}

function syncCredentialBanner() {
  const hasWallet = Boolean(els.walletInput.value.trim());
  const hasApiKey = Boolean(els.alchemyInput.value.trim());
  if (hasWallet && hasApiKey) {
    updateBanner("Wallet address and Alchemy key are loaded from browser local storage.", "Credentials ready", "success");
    return;
  }
  updateBanner("Bring your own wallet + Alchemy key. Values are only stored in this browser local storage.", "Credentials needed", "warning");
}

function openSettings() {
  els.settingsOverlay.classList.remove("hidden");
  els.settingsOverlay.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  els.settingsOverlay.classList.add("hidden");
  els.settingsOverlay.setAttribute("aria-hidden", "true");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskAlchemySecrets(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }
  return text
    .replace(/(g\.alchemy\.com\/v2\/)[^"'\s/?]+/gi, "$1***")
    .replace(/(api\.g\.alchemy\.com\/prices\/v1\/)[^"'\s/?]+/gi, "$1***");
}

const traceLogger = createTraceLogger({
  state,
  maxFieldChars: TRACE_MAX_FIELD_CHARS,
  maxEntries: TRACE_MAX_ENTRIES,
  maskSecrets: maskAlchemySecrets
});

function truncateTraceField(value) {
  return traceLogger.truncateTraceField(value);
}

function normalizeTraceField(value) {
  return traceLogger.normalizeTraceField(value);
}

function pushTrace(eventType, fields = {}) {
  traceLogger.pushTrace(eventType, fields);
}

function startTraceSession(label = "manual_lookup") {
  traceLogger.startTraceSession(label);
  pushTrace("session", {
    message: `lookup_start ${label}`
  });
}

function traceLogFilename(date = new Date()) {
  return traceLogger.traceLogFilename(date);
}

function buildTraceLogText() {
  return traceLogger.buildTraceLogText();
}

function downloadTraceLogs() {
  if (!state.traceEntries.length) {
    setStatus("No trace logs available yet. Run a lookup first.", "warning");
    return;
  }
  traceLogger.downloadTraceLogs();
  setStatus(`Trace log downloaded (${state.traceEntries.length} events).`, "success");
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableRpcPayloadError(errorPayload) {
  const code = Number(errorPayload?.code);
  const message = String(errorPayload?.message || "");
  if (code === -32005 || code === -32603 || code === -32000) {
    return true;
  }
  return /rate|limit|too many|timeout|temporar|busy|capacity|unavailable|gateway/i.test(message);
}

function isDeterministicEthCallRevert(errorPayload) {
  const message = String(errorPayload?.message || "");
  const dataMessage = typeof errorPayload?.data === "string"
    ? errorPayload.data
    : String(errorPayload?.data?.message || "");
  const combined = `${message} ${dataMessage}`.toLowerCase();
  return /execution reverted|owner query for nonexistent token|nonexistent token|invalid token|revert\b/.test(combined);
}

const rpcClient = createRpcClient({
  state,
  rpcMaxRetries: RPC_MAX_RETRIES,
  retryBaseMs: RETRY_BASE_MS,
  activeChainKey: () => ACTIVE_CHAIN_KEY,
  chainId: () => CHAIN_ID,
  chainRpcNetwork: () => CHAIN_RPC_NETWORK,
  pushTrace,
  delay
});

function getProvider(apiKey) {
  return rpcClient.getProvider(apiKey);
}

async function rpcCall(apiKey, method, params) {
  return rpcClient.rpcCall(apiKey, method, params);
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
  const fallbackCandidates = [];
  const strictAllowlist = new Set([...VFAT_IMPLEMENTATION_ALLOWLIST].map((value) => value.toLowerCase()));

  for (const contractAddress of deployedContracts) {
    try {
      const code = await provider.getCode(contractAddress);
      const implementation = parseEip1167Implementation(code);
      if (!implementation) {
        continue;
      }
      const normalizedContract = ethers.getAddress(contractAddress);
      const normalizedImplementation = ethers.getAddress(implementation);
      const row = {
        address: normalizedContract,
        implementation: normalizedImplementation,
        kind: "eip1167"
      };

      if (!strictAllowlist.size || strictAllowlist.has(normalizedImplementation.toLowerCase())) {
        classified.push(row);
        continue;
      }
      fallbackCandidates.push({
        ...row,
        kind: "eip1167_fallback"
      });
    } catch {
      // Ignore code fetch failures and continue with the rest.
    }
  }

  if (classified.length) {
    return classified;
  }
  // Fallback for stale allowlists: downstream ERC-721 + live-liquidity checks still gate validity.
  return fallbackCandidates;
}

function buildVfatContractHealthNote(vfatContracts) {
  const fallbackCount = (vfatContracts || []).filter((item) => item?.kind === "eip1167_fallback").length;
  if (!fallbackCount) {
    return "";
  }
  return `${fallbackCount} VFat contract${fallbackCount === 1 ? "" : "s"} matched fallback clone detection because constants allowlist did not match.`;
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

function resolveBlockNumberFromTag(tag) {
  if (typeof tag === "number" && Number.isFinite(tag)) {
    return tag;
  }
  if (typeof tag === "string" && tag.startsWith("0x")) {
    return parseHexToNumber(tag);
  }
  return null;
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

function isExecutionRevertedNaError(error) {
  const message = String(error?.message || "");
  return /execution reverted:\s*NA/i.test(message);
}

function isRecentPositionActivityWithinWindow(row, blockWindow) {
  return Number.isFinite(row?.blockNumber)
    && row.blockNumber > 0
    && Number.isFinite(blockWindow?.fromBlock)
    && row.blockNumber >= blockWindow.fromBlock;
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
    positionType: "cl",
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
  const fromBlock = Number.isFinite(blockWindow?.fromBlock)
    ? blockWindow.fromBlock
    : resolveBlockNumberFromTag(blockWindow?.fromBlockTag);
  const toBlock = Number.isFinite(blockWindow?.toBlock)
    ? blockWindow.toBlock
    : resolveBlockNumberFromTag(blockWindow?.toBlockTag);
  const isRangeTooWide = Number.isFinite(fromBlock)
    && Number.isFinite(toBlock)
    && (toBlock - fromBlock > 9);
  if (isRangeTooWide) {
    pushTrace("collect_logs_skipped", {
      chain: ACTIVE_CHAIN_KEY,
      tokenContract: row.tokenContract,
      tokenIdHex: row.tokenIdHex,
      fromBlock,
      toBlock,
      reason: "eth_getLogs skipped for Free-tier block-range limit (>10 inclusive blocks unsupported)"
    });
    return { amount0: 0n, amount1: 0n };
  }

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
  fromBlockTag = "0x0",
  toBlockTag = "latest"
}) {
  const transfers = [];
  let pageKey;
  do {
    const params = {
      fromBlock: fromBlockTag,
      toBlock: toBlockTag,
      excludeZeroValue: false,
      category: ["erc20"],
      maxCount: "0x3e8"
    };
    if (Array.isArray(contractAddresses) && contractAddresses.length) {
      params.contractAddresses = contractAddresses;
    }
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

function normalizeNullableAddress(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    return ethers.getAddress(value);
  } catch {
    return null;
  }
}

async function isAerodromeGauge(address, provider) {
  if (!ENABLE_AERODROME_V2_PATHS) {
    return false;
  }
  const gauge = ethers.getAddress(address);
  const key = gauge.toLowerCase();
  if (state.aerodromeGaugeByAddress.has(key)) {
    return state.aerodromeGaugeByAddress.get(key);
  }
  try {
    const voter = new ethers.Contract(AERODROME_VOTER_ADDRESS, AERODROME_VOTER_ABI, provider);
    const result = await voter.isGauge(gauge);
    const normalized = Boolean(result);
    state.aerodromeGaugeByAddress.set(key, normalized);
    return normalized;
  } catch {
    state.aerodromeGaugeByAddress.set(key, false);
    return false;
  }
}

async function isAerodromeV2Pool(poolAddress, provider) {
  if (!ENABLE_AERODROME_V2_PATHS) {
    return false;
  }
  const pool = ethers.getAddress(poolAddress);
  const key = pool.toLowerCase();
  if (state.aerodromeV2PoolByAddress.has(key)) {
    return state.aerodromeV2PoolByAddress.get(key);
  }
  try {
    const factory = new ethers.Contract(AERODROME_V2_PAIR_FACTORY_ADDRESS, AERODROME_V2_FACTORY_ABI, provider);
    const isPool = Boolean(await factory.isPool(pool));
    state.aerodromeV2PoolByAddress.set(key, isPool);
    return isPool;
  } catch {
    state.aerodromeV2PoolByAddress.set(key, false);
    return false;
  }
}

async function resolveAerodromeV2PoolFee(poolAddress, stable, provider) {
  if (!ENABLE_AERODROME_V2_PATHS) {
    return null;
  }
  const pool = ethers.getAddress(poolAddress);
  const key = `${pool.toLowerCase()}:${stable ? "1" : "0"}`;
  if (state.aerodromeV2PoolFeeByAddress.has(key)) {
    return state.aerodromeV2PoolFeeByAddress.get(key);
  }
  try {
    const factory = new ethers.Contract(AERODROME_V2_PAIR_FACTORY_ADDRESS, AERODROME_V2_FACTORY_ABI, provider);
    const feeRaw = await factory.getFee(pool, stable);
    const fee = Number(feeRaw);
    const resolved = Number.isFinite(fee) ? fee : null;
    state.aerodromeV2PoolFeeByAddress.set(key, resolved);
    return resolved;
  } catch {
    state.aerodromeV2PoolFeeByAddress.set(key, null);
    return null;
  }
}

async function fetchAerodromeV2PoolSnapshot(poolAddress, provider) {
  const pool = new ethers.Contract(poolAddress, AERODROME_V2_POOL_ABI, provider);
  try {
    const metadata = await pool.metadata();
    const token0 = ethers.getAddress(metadata.t0 ?? metadata[5]);
    const token1 = ethers.getAddress(metadata.t1 ?? metadata[6]);
    const reserve0 = BigInt(metadata.r0 ?? metadata[2]);
    const reserve1 = BigInt(metadata.r1 ?? metadata[3]);
    const stable = Boolean(metadata.st ?? metadata[4]);
    return { token0, token1, reserve0, reserve1, stable };
  } catch {
    const [token0Raw, token1Raw, reserve0Raw, reserve1Raw, stableRaw] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.reserve0(),
      pool.reserve1(),
      pool.stable()
    ]);
    return {
      token0: ethers.getAddress(token0Raw),
      token1: ethers.getAddress(token1Raw),
      reserve0: BigInt(reserve0Raw),
      reserve1: BigInt(reserve1Raw),
      stable: Boolean(stableRaw)
    };
  }
}

async function findAerodromeGaugeCounterparties(vfatContract, apiKey) {
  const normalizedVfat = ethers.getAddress(vfatContract);
  const [outbound, inbound] = await Promise.all([
    fetchErc20TransfersInWindow(apiKey, {
      fromAddress: normalizedVfat
    }),
    fetchErc20TransfersInWindow(apiKey, {
      toAddress: normalizedVfat
    })
  ]);

  const counterparties = new Set();
  const vfatLower = normalizedVfat.toLowerCase();
  for (const transfer of [...outbound, ...inbound]) {
    const from = normalizeNullableAddress(transfer?.from);
    const to = normalizeNullableAddress(transfer?.to);
    if (!from || !to) {
      continue;
    }
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    if (fromLower === vfatLower && toLower !== vfatLower && toLower !== ZeroAddress.toLowerCase()) {
      counterparties.add(to);
      continue;
    }
    if (toLower === vfatLower && fromLower !== vfatLower && fromLower !== ZeroAddress.toLowerCase()) {
      counterparties.add(from);
    }
  }
  return [...counterparties];
}

async function buildAerodromeV2Row(vfatContract, gaugeAddress, blockWindow, apiKey, provider) {
  const normalizedVfat = ethers.getAddress(vfatContract);
  const normalizedGauge = ethers.getAddress(gaugeAddress);
  const defaults = {
    fees24hToken0: null,
    fees24hToken1: null,
    fees24hUsd: 0,
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    vfatFeesClaimableNowUsd: 0,
    vfatEmissionsClaimableNowUsd: null,
    vfatClaimableNowUsd: null,
    vfatInRange: null,
    apr24hPct: null,
    metricsQuality: "partial",
    metricsReason: "partial_call_failed"
  };

  try {
    const gauge = new ethers.Contract(normalizedGauge, AERODROME_V2_GAUGE_ABI, provider);
    const stakedBalance = BigInt(await gauge.balanceOf(normalizedVfat));
    if (stakedBalance <= 0n) {
      return null;
    }
    const vfatTokenIdHex = `0x${normalizedVfat.slice(2).toLowerCase()}`;
    const vfatTokenIdDecimal = tokenIdToDecimal(vfatTokenIdHex);

    const baseRow = {
      ...defaults,
      source: "vfat",
      positionType: "aerodrome_v2",
      protocol: AERODROME_V2_PROTOCOL,
      tokenContract: normalizedGauge,
      tokenIdHex: vfatTokenIdHex,
      tokenIdDecimal: vfatTokenIdDecimal,
      tokenKey: `vfatv2:${normalizedVfat.toLowerCase()}:${normalizedGauge.toLowerCase()}`,
      vfatContract: normalizedVfat,
      currentOwner: normalizedVfat,
      ownerScope: "vfat",
      ownerCheck: "confirmed",
      ownerResolved: normalizedVfat.toLowerCase(),
      liveLiquidity: stakedBalance.toString(),
      adapterType: "aerodrome_v2_gauge",
      poolPair: "Unknown/Unknown",
      poolFee: null,
      poolStable: null,
      poolToken0: null,
      poolToken1: null,
      poolTickLower: null,
      poolTickUpper: null,
      poolRangeLowerPrice: null,
      poolRangeUpperPrice: null,
      poolCurrentPrice: null,
      currentPoolUsd: null
    };

    const [poolAddressRaw, rewardTokenRaw] = await Promise.all([
      gauge.stakingToken(),
      gauge.rewardToken()
    ]);
    const poolAddress = ethers.getAddress(poolAddressRaw);
    const rewardToken = ethers.getAddress(rewardTokenRaw);

    if (!(await isAerodromeV2Pool(poolAddress, provider))) {
      return null;
    }

    let row = { ...baseRow };
    try {
      const [poolSnapshot, totalSupplyRaw] = await Promise.all([
        fetchAerodromeV2PoolSnapshot(poolAddress, provider),
        new ethers.Contract(poolAddress, AERODROME_V2_POOL_ABI, provider).totalSupply()
      ]);
      const totalSupply = BigInt(totalSupplyRaw);
      if (totalSupply > 0n) {
        const amount0Raw = (stakedBalance * poolSnapshot.reserve0) / totalSupply;
        const amount1Raw = (stakedBalance * poolSnapshot.reserve1) / totalSupply;
        const [token0Meta, token1Meta] = await Promise.all([
          getTokenMeta(poolSnapshot.token0, provider),
          getTokenMeta(poolSnapshot.token1, provider)
        ]);
        const prices = await getPrices([token0Meta.address, token1Meta.address], apiKey);
        const token0Price = prices[token0Meta.address];
        const token1Price = prices[token1Meta.address];
        const pooled0 = normalizeAmount(amount0Raw, token0Meta.decimals);
        const pooled1 = normalizeAmount(amount1Raw, token1Meta.decimals);
        const currentPoolUsd = (Number.isFinite(token0Price) ? pooled0 * token0Price : 0)
          + (Number.isFinite(token1Price) ? pooled1 * token1Price : 0);
        const poolFee = await resolveAerodromeV2PoolFee(poolAddress, poolSnapshot.stable, provider);
        row = {
          ...row,
          poolPair: `${token0Meta.symbol}/${token1Meta.symbol} (${poolSnapshot.stable ? "stable" : "volatile"})`,
          poolFee,
          poolStable: poolSnapshot.stable,
          poolToken0: token0Meta.address,
          poolToken1: token1Meta.address,
          currentPoolUsd
        };
      }
    } catch {
      // Keep row as partial if valuation fails.
    }

    if (!blockWindow) {
      return row;
    }

    try {
      const [pendingNowRaw, pendingStartRaw] = await Promise.all([
        gauge.earned(normalizedVfat),
        gauge.earned(normalizedVfat, { blockTag: blockWindow.fromBlock })
      ]);
      const pendingNow = BigInt(pendingNowRaw);
      const pendingStart = BigInt(pendingStartRaw);
      const rewardMeta = await getTokenMeta(rewardToken, provider);
      const rewardPrices = await getPrices([rewardMeta.address], apiKey);
      const rewardPrice = rewardPrices[rewardMeta.address];
      if (!Number.isFinite(rewardPrice)) {
        return row;
      }

      const rewardTransfers = await fetchErc20TransfersInWindow(apiKey, {
        fromAddress: normalizedGauge,
        toAddress: normalizedVfat,
        contractAddresses: [rewardToken],
        fromBlockTag: blockWindow.fromBlockTag,
        toBlockTag: blockWindow.toBlockTag
      });
      let realizedReward = 0n;
      for (const transfer of rewardTransfers) {
        const amount = parseTransferRawAmount(transfer);
        if (amount > 0n) {
          realizedReward += amount;
        }
      }

      const pendingDelta = safePositive(pendingNow - pendingStart);
      const emissionsRaw = pendingDelta + realizedReward;
      const emissions24hAmount = normalizeAmount(emissionsRaw, rewardMeta.decimals);
      const pendingNowAmount = normalizeAmount(pendingNow, rewardMeta.decimals);
      const emissions24hUsd = emissions24hAmount * rewardPrice;
      const pendingNowUsd = pendingNowAmount * rewardPrice;
      const apr24hPct = Number.isFinite(row.currentPoolUsd) && row.currentPoolUsd > 0
        ? (emissions24hUsd / row.currentPoolUsd) * 365 * 100
        : null;

      return {
        ...row,
        emissions24hUsd,
        emissions24hBreakdown: [{
          token: rewardMeta.address,
          symbol: rewardMeta.symbol,
          amount: emissions24hAmount,
          usd: emissions24hUsd,
          pendingNow: pendingNowAmount
        }],
        vfatEmissionsClaimableNowUsd: pendingNowUsd,
        vfatClaimableNowUsd: pendingNowUsd,
        apr24hPct,
        metricsQuality: "full",
        metricsReason: "full"
      };
    } catch {
      return row;
    }
  } catch {
    return null;
  }
}

async function fetchVFatAerodromeV2Rows(vfatContracts, apiKey, provider, onStatus = () => {}) {
  if (!ENABLE_AERODROME_V2_PATHS) {
    return [];
  }
  if (!vfatContracts?.length) {
    return [];
  }

  let blockWindow = null;
  try {
    onStatus("Resolving 24h block window for Aerodrome V2 metrics...");
    blockWindow = await resolve24hBlockWindow(apiKey);
  } catch {
    // Keep V2 valuation path alive even if 24h metrics window resolution fails.
  }

  const rows = [];
  for (let i = 0; i < vfatContracts.length; i += 1) {
    const vfatContract = ethers.getAddress(vfatContracts[i].address || vfatContracts[i]);
    onStatus(`Scanning Aerodrome V2 gauges for ${shortenAddress(vfatContract)} (${i + 1}/${vfatContracts.length})...`);
    const counterparties = await findAerodromeGaugeCounterparties(vfatContract, apiKey);
    const gaugeChecks = await Promise.allSettled(counterparties.map((address) => isAerodromeGauge(address, provider)));
    const gauges = [];
    for (let j = 0; j < counterparties.length; j += 1) {
      if (gaugeChecks[j].status === "fulfilled" && gaugeChecks[j].value) {
        gauges.push(counterparties[j]);
      }
    }
    for (const gauge of gauges) {
      const row = await buildAerodromeV2Row(vfatContract, gauge, blockWindow, apiKey, provider);
      if (row) {
        rows.push(row);
      }
    }
  }
  return rows.sort((a, b) => {
    const aUsd = Number.isFinite(a.currentPoolUsd) ? a.currentPoolUsd : -Infinity;
    const bUsd = Number.isFinite(b.currentPoolUsd) ? b.currentPoolUsd : -Infinity;
    return bUsd - aUsd;
  });
}

function getClaimScopeKey(row) {
  if (!row?.protocol || !row?.currentOwner || !row?.vfatContract) {
    return null;
  }
  return `${row.protocol}:${row.currentOwner.toLowerCase()}:${row.vfatContract.toLowerCase()}`;
}

function buildClaimScopeCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = getClaimScopeKey(row);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
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

async function fetchAerodromeEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount = 0) {
  if (row.adapterType !== "aerodrome_clgauge") {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
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
    const nowResult = await rpcCall(apiKey, "eth_call", [{ to: gaugeAddress, data: earnedData }, "latest"]);
    pendingNow = decodeUint256CallResult(nowResult);
  } catch {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }
  try {
    const startResult = await rpcCall(apiKey, "eth_call", [{ to: gaugeAddress, data: earnedData }, blockWindow.fromBlockTag]);
    pendingStart = decodeUint256CallResult(startResult);
  } catch (error) {
    const canUseZeroBaseline = isExecutionRevertedNaError(error) && isRecentPositionActivityWithinWindow(row, blockWindow);
    if (canUseZeroBaseline) {
      pendingStart = 0n;
    } else {
      return {
        emissions24hUsd: null,
        emissions24hBreakdown: [],
        pendingEmissionsNowUsd: null,
        metricsQuality: "partial",
        metricsReason: "partial_call_failed"
      };
    }
  }

  let realizedAttributed = 0n;
  let ambiguousClaims = 0n;
  const rewardToken = await resolveGaugeRewardToken(gaugeAddress, apiKey);
  if (!rewardToken) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
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
      pendingEmissionsNowUsd: null,
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
      if (claimScopeCount === 1) {
        realizedAttributed += claimAmount;
      } else {
        ambiguousClaims += claimAmount;
      }
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
    } else if (ACCOUNT_WIDE_CLAIM_SELECTORS.has(selector)) {
      if (claimScopeCount === 1) {
        realizedAttributed += claimAmount;
      } else {
        ambiguousClaims += claimAmount;
      }
    } else if (claimScopeCount === 1) {
      // Treat unknown wrapper selector as account-wide claim only when scope is unambiguous.
      realizedAttributed += claimAmount;
    } else {
      ambiguousClaims += claimAmount;
    }
  }
  if (!rewardToken || !provider) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
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
      pendingEmissionsNowUsd: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const pendingEmissionsNowUsd = normalizeAmount(pendingNow, tokenMeta.decimals) * rewardPrice;
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
    pendingEmissionsNowUsd,
    metricsQuality,
    metricsReason
  };
}

async function fetchPancakeEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount = 0) {
  if (row.adapterType !== "pancake_masterchef") {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
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
      pendingEmissionsNowUsd: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const rewardToken = await resolvePancakeRewardToken(masterchef, apiKey);
  if (!rewardToken || !provider) {
    return {
      emissions24hUsd: null,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: null,
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
      pendingEmissionsNowUsd: null,
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
    } else if (ACCOUNT_WIDE_CLAIM_SELECTORS.has(selector)) {
      if (claimScopeCount === 1) {
        realizedAttributed += rawAmount;
      } else {
        ambiguousClaims += rawAmount;
      }
    } else if (claimScopeCount === 1) {
      // Treat unknown wrapper selector as account-wide claim only when scope is unambiguous.
      realizedAttributed += rawAmount;
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
      pendingEmissionsNowUsd: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    };
  }

  const pendingEmissionsNowUsd = normalizeAmount(pendingNow, tokenMeta.decimals) * rewardPrice;
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
    pendingEmissionsNowUsd,
    metricsQuality: ambiguousClaims > 0n ? "partial" : "full",
    metricsReason: ambiguousClaims > 0n ? "partial_ambiguous_claim" : "full"
  };
}

async function fetchEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount = 0) {
  const adapter = CL_PROTOCOL_ADAPTERS[row.protocol] || {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "none"
  };
  if (adapter.emissionsMode === "none") {
    return {
      emissions24hUsd: 0,
      emissions24hBreakdown: [],
      pendingEmissionsNowUsd: 0,
      metricsQuality: "full",
      metricsReason: "full"
    };
  }

  if (row.protocol === "Aerodrome SlipStream") {
    return fetchAerodromeEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount);
  }

  if (row.protocol === "PancakeSwap V3") {
    return fetchPancakeEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount);
  }

  return {
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    pendingEmissionsNowUsd: null,
    metricsQuality: "partial",
    metricsReason: "partial_unclassified"
  };
}

async function enrichCurrentRowWith24hMetrics(row, blockWindow, apiKey, provider, claimScopeCount = 0) {
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
    vfatFeesClaimableNowUsd: null,
    vfatEmissionsClaimableNowUsd: null,
    vfatClaimableNowUsd: null,
    vfatInRange: null,
    apr24hPct: null,
    metricsQuality: "partial",
    metricsReason: "partial_call_failed"
  };

  let snapshotNow = await fetchClaimableSnapshotAtBlock(row, "latest", apiKey, provider);
  if (!snapshotNow) {
    await delay(RETRY_BASE_MS);
    snapshotNow = await fetchClaimableSnapshotAtBlock(row, "latest", apiKey, provider);
  }
  if (!snapshotNow) {
    return { ...row, ...defaults };
  }

  let snapshot24h = await fetchClaimableSnapshotAtBlock(row, blockWindow.fromBlockTag, apiKey, provider);
  if (!snapshot24h) {
    await delay(RETRY_BASE_MS);
    snapshot24h = await fetchClaimableSnapshotAtBlock(row, blockWindow.fromBlockTag, apiKey, provider);
  }
  const collect24h = await fetchCollectAmounts24h(row, apiKey, blockWindow);

  const pendingNow0 = snapshotNow.claimable?.amount0 || 0n;
  const pendingNow1 = snapshotNow.claimable?.amount1 || 0n;
  const pendingStart0 = snapshot24h?.claimable?.amount0 || 0n;
  const pendingStart1 = snapshot24h?.claimable?.amount1 || 0n;
  const pendingDelta0 = safePositive(pendingNow0 - pendingStart0);
  const pendingDelta1 = safePositive(pendingNow1 - pendingStart1);
  const rawFees0 = collect24h.amount0 + pendingDelta0;
  const rawFees1 = collect24h.amount1 + pendingDelta1;
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
  const claimableNowToken0 = normalizeAmount(pendingNow0, token0Meta.decimals);
  const claimableNowToken1 = normalizeAmount(pendingNow1, token1Meta.decimals);
  const price0 = valuation.prices[token0Meta.address] ?? 0;
  const price1 = valuation.prices[token1Meta.address] ?? 0;
  const fees24hUsd = (Number.isFinite(price0) ? fees24hToken0 * price0 : 0) + (Number.isFinite(price1) ? fees24hToken1 * price1 : 0);
  const vfatFeesClaimableNowUsd = adapter.feesMode === "none"
    ? 0
    : (Number.isFinite(price0) ? claimableNowToken0 * price0 : 0) + (Number.isFinite(price1) ? claimableNowToken1 * price1 : 0);
  let emissions = {
    emissions24hUsd: null,
    emissions24hBreakdown: [],
    pendingEmissionsNowUsd: null,
    metricsQuality: "partial",
    metricsReason: "partial_call_failed"
  };
  try {
    emissions = await fetchEmissions24h(row, blockWindow, apiKey, provider, claimScopeCount);
  } catch {
    // Keep fees + APR path alive even if emission endpoints fail.
  }
  const currentPoolUsd = valuation.currentPoolUsd;
  const vfatEmissionsClaimableNowUsd = Number.isFinite(emissions.pendingEmissionsNowUsd) ? emissions.pendingEmissionsNowUsd : null;
  const claimableNowContributors = [vfatFeesClaimableNowUsd, vfatEmissionsClaimableNowUsd].filter((value) => Number.isFinite(value));
  const vfatClaimableNowUsd = claimableNowContributors.length
    ? claimableNowContributors.reduce((sum, value) => sum + value, 0)
    : null;
  const vfatInRange = Number.isFinite(row.poolCurrentPrice) && Number.isFinite(row.poolRangeLowerPrice) && Number.isFinite(row.poolRangeUpperPrice)
    ? row.poolCurrentPrice >= row.poolRangeLowerPrice && row.poolCurrentPrice < row.poolRangeUpperPrice
    : null;
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
    vfatFeesClaimableNowUsd,
    vfatEmissionsClaimableNowUsd,
    vfatClaimableNowUsd,
    vfatInRange,
    apr24hPct,
    metricsQuality,
    metricsReason: emissions.metricsReason
  };
}

async function enrichCurrentRowsWith24hMetrics(rows, apiKey, provider, onStatus = () => {}) {
  if (!rows.length) {
    return [];
  }

  onStatus("Resolving 24h block window for CL position metrics...");
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
      vfatFeesClaimableNowUsd: null,
      vfatEmissionsClaimableNowUsd: null,
      vfatClaimableNowUsd: null,
      vfatInRange: null,
      apr24hPct: null,
      metricsQuality: "partial",
      metricsReason: "partial_call_failed"
    }));
  }
  const claimScopeCounts = buildClaimScopeCounts(rows);
  const enriched = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    onStatus(`Calculating 24h fees/emissions APR (${i + 1}/${rows.length}) for ${row.protocol} #${row.tokenIdDecimal}...`);
    const claimScopeKey = getClaimScopeKey(row);
    const claimScopeCount = claimScopeKey ? (claimScopeCounts.get(claimScopeKey) || 0) : 0;
    try {
      const withMetrics = await enrichCurrentRowWith24hMetrics(row, blockWindow, apiKey, provider, claimScopeCount);
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
        vfatFeesClaimableNowUsd: null,
        vfatEmissionsClaimableNowUsd: null,
        vfatClaimableNowUsd: null,
        vfatInRange: null,
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
      ownerResolved: null,
      positionType: latest.positionType || "cl",
      poolStable: null
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
    row.positionType = row.positionType || "cl";
    row.poolStable = null;
    row.adapterType = await classifyOwnerAdapter(row, apiKey);
    filteredRows.push(row);
  }

  filteredRows.sort(compareClRowsDesc);
  return filteredRows;
}

async function fetchVFatClDataForWallet(wallet, apiKey, provider, onStatus = () => {}) {
  let directDeployedContracts = [];
  let factoryDeployedContracts = [];
  let deployedContracts = [];
  let identifiedVfatContracts = [];
  let usedCachedVfatContracts = false;
  const cachedVfatContracts = readCachedVfatContracts(wallet);

  if (cachedVfatContracts !== null) {
    usedCachedVfatContracts = true;
    onStatus(`Using cached VFat contract set for ${CHAIN_NAME} to reduce RPC load (${cachedVfatContracts.length} contracts)...`);
    identifiedVfatContracts = cachedVfatContracts.map((address) => ({
      address,
      implementation: null,
      kind: "cache"
    }));
  } else {
    onStatus(`Discovering direct deployments on ${CHAIN_NAME} for VFat extraction...`);
    directDeployedContracts = await findDirectlyDeployedContracts(wallet, apiKey);
    onStatus(`Checking known Sickle factory deployments on ${CHAIN_NAME}...`);
    factoryDeployedContracts = await findFactoryDeployedContracts(wallet, apiKey);
    deployedContracts = [...new Set([...directDeployedContracts, ...factoryDeployedContracts])];
    onStatus("Identifying VFat contracts from discovered deployments...");
    identifiedVfatContracts = await identifyVFatContracts(deployedContracts, provider);
    writeCachedVfatContracts(wallet, identifiedVfatContracts.map((item) => item.address));
  }
  const vfatClHistoryRows = [];

  for (const vfatContract of identifiedVfatContracts) {
    onStatus(`Fetching CL transfer history for ${shortenAddress(vfatContract.address)}...`);
    const rows = await fetchClTransfersForVfatContract(vfatContract.address, apiKey);
    vfatClHistoryRows.push(...rows);
  }

  if (usedCachedVfatContracts && cachedVfatContracts?.length && !vfatClHistoryRows.length) {
    onStatus(`No CL history found for cached VFat contracts. Re-running ${CHAIN_NAME} deployment discovery...`);
    directDeployedContracts = await findDirectlyDeployedContracts(wallet, apiKey);
    factoryDeployedContracts = await findFactoryDeployedContracts(wallet, apiKey);
    deployedContracts = [...new Set([...directDeployedContracts, ...factoryDeployedContracts])];
    identifiedVfatContracts = await identifyVFatContracts(deployedContracts, provider);
    writeCachedVfatContracts(wallet, identifiedVfatContracts.map((item) => item.address));
    for (const vfatContract of identifiedVfatContracts) {
      onStatus(`Fetching CL transfer history for ${shortenAddress(vfatContract.address)}...`);
      const rows = await fetchClTransfersForVfatContract(vfatContract.address, apiKey);
      vfatClHistoryRows.push(...rows);
    }
  }

  const currentOwnedRows = await buildCurrentOwnedRows(vfatClHistoryRows, apiKey, provider, onStatus);
  onStatus("Computing 24h fees, emissions, and APR for active CL positions...");
  const vfatClCurrentRows = await enrichCurrentRowsWith24hMetrics(currentOwnedRows, apiKey, provider, onStatus);
  const vfatV2CurrentRows = ENABLE_AERODROME_V2_PATHS
    ? await fetchVFatAerodromeV2Rows(identifiedVfatContracts, apiKey, provider, onStatus)
    : [];
  const vfatClCurrentTokenCount = vfatClCurrentRows.length;
  const vfatV2CurrentTokenCount = vfatV2CurrentRows.length;
  const vfatClOwnedByVfatCount = vfatClCurrentRows.filter((row) => row.ownerScope === "vfat").length;
  const vfatClExternalizedCount = vfatClCurrentRows.filter((row) => row.ownerScope === "external").length;
  const vfatClUncertainCount = vfatClCurrentRows.filter((row) => row.ownerCheck !== "confirmed").length;

  return {
    directDeployedContracts,
    factoryDeployedContracts,
    deployedContracts,
    vfatContracts: identifiedVfatContracts,
    vfatClCurrentRows,
    vfatV2CurrentRows,
    vfatClCurrentTokenCount,
    vfatV2CurrentTokenCount,
    vfatClOwnedByVfatCount,
    vfatClExternalizedCount,
    vfatClUncertainCount
  };
}

function shortenAddress(address) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function setAccountBadgePlaceholder(label = "LP") {
  if (!els.accountBadge) {
    return;
  }
  els.accountBadge.textContent = label;
  els.accountBadge.classList.add("account-badge--placeholder");
}

function accountBadgeSeed(address) {
  if (typeof address !== "string" || address.length < 10) {
    return 0;
  }
  const seed = Number.parseInt(address.slice(2, 10), 16);
  return Number.isFinite(seed) ? seed : 0;
}

function drawJazzicon(address) {
  if (!els.accountBadge || typeof state.jazziconFactory !== "function") {
    return;
  }

  let iconNode;
  try {
    iconNode = state.jazziconFactory(ACCOUNT_BADGE_SIZE, accountBadgeSeed(address));
  } catch {
    return;
  }
  if (!iconNode || typeof iconNode !== "object" || typeof iconNode.nodeType !== "number") {
    return;
  }

  els.accountBadge.replaceChildren(iconNode);
  els.accountBadge.classList.remove("account-badge--placeholder");
}

function loadJazziconFactory() {
  if (typeof state.jazziconFactory === "function") {
    return Promise.resolve(state.jazziconFactory);
  }
  if (!state.jazziconFactoryPromise) {
    state.jazziconFactoryPromise = import(JAZZICON_MODULE_URL)
      .then((module) => {
        const candidate = module?.default || module?.jazzicon || module;
        if (typeof candidate !== "function") {
          throw new Error("Jazzicon loader did not return a function.");
        }
        state.jazziconFactory = candidate;
        return candidate;
      })
      .catch(() => null);
  }
  return state.jazziconFactoryPromise;
}

function renderAccountBadge(address) {
  if (!address) {
    state.badgeAddress = "";
    setAccountBadgePlaceholder("LP");
    return;
  }

  state.badgeAddress = address.toLowerCase();
  setAccountBadgePlaceholder(address.slice(2, 4).toUpperCase());
  if (typeof state.jazziconFactory === "function") {
    drawJazzicon(address);
    return;
  }

  loadJazziconFactory().then((factory) => {
    if (!factory || state.badgeAddress !== address.toLowerCase()) {
      return;
    }
    drawJazzicon(address);
  });
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
  return formatUsdWithRules(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatUsdFixed(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return formatUsdWithRules(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

function toSubscriptDigits(text) {
  return String(text).split("").map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      return String.fromCodePoint(0x2080 + (code - 48));
    }
    return char;
  }).join("");
}

function formatTinyUsd(absValue, shownDigits = 3) {
  if (!(absValue > 0) || absValue >= 0.01) {
    return null;
  }
  const fixed = absValue.toFixed(20);
  const decimalPart = fixed.includes(".") ? fixed.split(".")[1] : "";
  if (!decimalPart) {
    return null;
  }
  let zeroCount = 0;
  while (zeroCount < decimalPart.length && decimalPart[zeroCount] === "0") {
    zeroCount += 1;
  }
  if (zeroCount < 2 || zeroCount >= decimalPart.length) {
    return null;
  }
  const significantDigits = (decimalPart.slice(zeroCount) + "000").slice(0, shownDigits);
  return `0.0${toSubscriptDigits(String(zeroCount))}${significantDigits}`;
}

function formatUsdWithRules(value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  const tinyDisplay = formatTinyUsd(absValue, 3);
  if (tinyDisplay) {
    return `${sign}$${tinyDisplay}`;
  }

  const resolvedMin = absValue < 1 ? Math.max(3, minimumFractionDigits) : minimumFractionDigits;
  const resolvedMax = absValue < 1 ? Math.max(3, maximumFractionDigits) : maximumFractionDigits;
  const amountText = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: resolvedMin,
    maximumFractionDigits: resolvedMax
  }).format(absValue);
  return `${sign}$${amountText}`;
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

const pricingService = createPricingService({
  state,
  erc20Abi: ERC20_ABI,
  priceApiBase: PRICE_API_BASE,
  priceMaxRetries: PRICE_MAX_RETRIES,
  retryBaseMs: RETRY_BASE_MS,
  getChainPriceNetwork: () => CHAIN_PRICE_NETWORK,
  pushTrace,
  delay
});

async function getTokenMeta(address, provider) {
  return pricingService.getTokenMeta(address, provider);
}

async function getPrices(addresses, apiKey) {
  return pricingService.getPrices(addresses, apiKey);
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

async function fetchPosition(tokenId, managerAddress, provider) {
  const normalizedManager = ethers.getAddress(managerAddress);
  const manager = new ethers.Contract(normalizedManager, NFPM_ABI, provider);
  const position = await manager.positions(tokenId);

  const [token0Meta, token1Meta] = await Promise.all([
    getTokenMeta(position.token0, provider),
    getTokenMeta(position.token1, provider)
  ]);
  const poolAddress = await resolvePoolAddressForManager(
    normalizedManager,
    position.token0,
    position.token1,
    Number(position.fee),
    provider
  );

  if (!poolAddress || poolAddress === ZeroAddress) {
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
    managerAddress: normalizedManager,
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

function normalizePositionIdentityKey(tokenContract, tokenIdHex) {
  const normalizedTokenId = normalizeTokenIdHex(String(tokenIdHex)).toLowerCase();
  try {
    return `${ethers.getAddress(tokenContract).toLowerCase()}:${normalizedTokenId}`;
  } catch {
    return `${String(tokenContract).toLowerCase()}:${normalizedTokenId}`;
  }
}

function normalizeStandardOpenPositionRow(position, owner) {
  const managerAddress = ethers.getAddress(position.managerAddress || chooseStandardManagerAddress());
  const protocol = CL_PROTOCOL_BY_MANAGER.get(managerAddress.toLowerCase()) || "PancakeSwap V3";
  const tokenIdHex = normalizeTokenIdHex(`0x${BigInt(position.tokenId).toString(16)}`);
  return {
    source: "standard",
    positionType: "cl",
    protocol,
    protocolDisplay: protocol,
    tokenContract: managerAddress,
    tokenIdHex,
    tokenIdDecimal: position.tokenId.toString(),
    tokenKey: `wallet:${managerAddress.toLowerCase()}:${tokenIdHex.toLowerCase()}`,
    vfatContract: owner,
    currentOwner: owner,
    ownerScope: "external",
    ownerCheck: "confirmed",
    ownerResolved: owner.toLowerCase(),
    liveLiquidity: position.liquidity.toString(),
    adapterType: "direct_owner",
    poolPair: `${position.token0.symbol}/${position.token1.symbol}`,
    poolFee: Number(position.position.fee),
    poolToken0: position.token0.address,
    poolToken1: position.token1.address,
    poolTickLower: Number(position.position.tickLower),
    poolTickUpper: Number(position.position.tickUpper),
    poolStable: null,
    poolRangeLowerPrice: Number.isFinite(position.rangePriceLower) ? position.rangePriceLower : null,
    poolRangeUpperPrice: Number.isFinite(position.rangePriceUpper) ? position.rangePriceUpper : null,
    poolCurrentPrice: Number.isFinite(position.price0) ? position.price0 : null
  };
}

const portfolioFacade = createPortfolioFacade({
  deps: {
    nfpmAbi: NFPM_ABI,
    normalizePositionIdentityKey,
    normalizePositionManagers,
    chooseStandardManagerAddress,
    getProvider,
    getPrices,
    fetchPosition,
    enrichValues,
    normalizeStandardOpenPositionRow,
    enrichCurrentRowsWith24hMetrics,
    fetchVFatClDataForWallet,
    buildVfatContractHealthNote,
    delay,
    applyChainContext,
    resetRuntimeCaches
  },
  ctx: {
    getChainSequence: () => CHAIN_SEQUENCE,
    getChainConfigs: () => CHAIN_CONFIGS,
    getChainName: () => CHAIN_NAME,
    getActiveChainKey: () => ACTIVE_CHAIN_KEY,
    getClPositionManagers: () => CL_POSITION_MANAGERS
  }
});

function buildUnifiedSummaryTotals(openRows) {
  return portfolioFacade.buildUnifiedSummaryTotals(openRows);
}

async function fetchPortfolioSingleChain(wallet, apiKey, onStatus = () => {}) {
  return portfolioFacade.fetchPortfolioSingleChain(wallet, apiKey, onStatus);
}

function mergeChainErrors(chainErrors) {
  return portfolioFacade.mergeChainErrors(chainErrors);
}

async function fetchPositionsThrottled(tokenRefs, provider, onStatus = () => {}) {
  return portfolioFacade.fetchPositionsThrottled(tokenRefs, provider, onStatus);
}

async function fetchPortfolio(wallet, apiKey, onStatus = () => {}) {
  return portfolioFacade.fetchPortfolio(wallet, apiKey, onStatus);
}

function renderSummary(portfolio) {
  const { owner, openRows, totals } = portfolio;
  const outOfRange = Math.max(0, totals.rangeConsideredCount - totals.inRangeCount);
  const incomeDailyUsd = openRows.reduce((sum, row) => {
    const fees = Number.isFinite(row?.fees24hUsd) ? row.fees24hUsd : 0;
    const emissions = Number.isFinite(row?.emissions24hUsd) ? row.emissions24hUsd : 0;
    return sum + fees + emissions;
  }, 0);
  const incomeWeeklyUsd = incomeDailyUsd * 7;
  const incomeMonthlyUsd = incomeDailyUsd * 30;
  const incomeYearlyUsd = incomeDailyUsd * 365;

  renderAccountBadge(owner);
  els.walletHeadline.textContent = shortenAddress(owner);
  els.walletSubline.textContent = `${totals.openCount} active position${totals.openCount === 1 ? "" : "s"} on Base + BSC`;
  els.totalValue.textContent = formatUsd(totals.pooledUsd);
  els.totalClaimable.textContent = formatUsd(totals.claimableUsd);
  if (els.totalIncomeDaily) {
    els.totalIncomeDaily.textContent = `${formatUsd(incomeDailyUsd)}/day`;
  }
  if (els.incomeProjectionNote) {
    els.incomeProjectionNote.textContent = `W ${formatUsd(incomeWeeklyUsd)} | M ${formatUsd(incomeMonthlyUsd)} | Y ${formatUsd(incomeYearlyUsd)}`;
  }
  if (els.openCount) {
    els.openCount.textContent = String(totals.openCount);
  }
  els.rangeSummary.textContent = `${totals.inRangeCount} / ${totals.rangeConsideredCount}`;
  if (els.rangeSummaryNote) {
    els.rangeSummaryNote.textContent = totals.rangeExcludedCount > 0
      ? `${totals.rangeExcludedCount} pools excluded due to missing live range/price reads`
      : "(In Range / Total)";
  }
  els.exchangeCountChip.textContent = `${totals.poolCount} pool${totals.poolCount === 1 ? "" : "s"}`;
  els.openSectionTitle.textContent = `Open LP positions (${openRows.length})`;
  if (totals.openCount) {
    const exclusionNote = totals.rangeExcludedCount > 0 ? ` (${totals.rangeExcludedCount} excluded)` : "";
    setStatus(`${totals.inRangeCount} in range, ${outOfRange} out of range${exclusionNote}.`, "success");
  } else {
    setStatus("No active Base + BSC LP positions found.");
  }
}

function renderOpenSectionDiagnostics(portfolio) {
  const vfatCount = portfolio.vfatContracts.length;
  const vfatPositionCount = Number.isFinite(portfolio.vfatCurrentTokenCount)
    ? portfolio.vfatCurrentTokenCount
    : ((portfolio.vfatClCurrentRows?.length || 0) + (portfolio.vfatV2CurrentRows?.length || 0));
  const uncertainCount = portfolio.vfatClUncertainCount;

  if (els.vfatContractsCountChip) {
    els.vfatContractsCountChip.textContent = `${vfatCount} VFat contract${vfatCount === 1 ? "" : "s"}`;
  }
  if (els.vfatCurrentCountChip) {
    els.vfatCurrentCountChip.textContent = `${vfatPositionCount} VFat position${vfatPositionCount === 1 ? "" : "s"}`;
  }
  if (els.vfatUncertainCountChip) {
    els.vfatUncertainCountChip.textContent = `${uncertainCount} uncertain`;
  }
  if (els.openDedupeStatus) {
    els.openDedupeStatus.textContent = `Duplicate policy: prefer VFat rows when tokenContract + tokenIdHex collide. This refresh merged ${portfolio.openRowsDedupeCount} duplicate${portfolio.openRowsDedupeCount === 1 ? "" : "s"}.`;
  }
  if (els.vfatErrorText) {
    if (portfolio.vfatClError) {
      els.vfatErrorText.textContent = `VFat pipeline warning: ${portfolio.vfatClError}`;
      els.vfatErrorText.classList.remove("hidden");
    } else {
      els.vfatErrorText.textContent = "";
      els.vfatErrorText.classList.add("hidden");
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

function buildRangeCurrentDisplay(row) {
  const hasRange = Number.isFinite(row.poolRangeLowerPrice) && Number.isFinite(row.poolRangeUpperPrice);
  const hasCurrent = Number.isFinite(row.poolCurrentPrice);
  if (!hasRange || !hasCurrent || row.poolRangeUpperPrice <= row.poolRangeLowerPrice) {
    const fallbackTooltip = "Range: unavailable\nCurrent: unavailable";
    const safeFallbackTooltip = escapeHtml(fallbackTooltip);
    return `
      <div class="range-mini range-mini--na" data-tooltip="${safeFallbackTooltip}" tabindex="0" role="img" aria-label="${safeFallbackTooltip}">
        <span class="range-mini__label">n/a</span>
        <span class="range-mini__track">
          <span class="range-mini__edge range-mini__edge--left"></span>
          <span class="range-mini__edge range-mini__edge--right"></span>
          <span class="range-mini__marker range-mini__marker--na" style="left:50%"></span>
        </span>
      </div>
    `;
  }

  const lower = row.poolRangeLowerPrice;
  const upper = row.poolRangeUpperPrice;
  const current = row.poolCurrentPrice;
  const span = upper - lower;
  const markerPercent = clamp(((current - lower) / span) * 100, 0, 100);
  const rangeState = current < lower ? "below range" : current > upper ? "above range" : "in range";
  const widthPct = lower !== 0 ? (span / Math.abs(lower)) * 100 : Number.NaN;
  const labelText = Number.isFinite(widthPct) ? formatPercent(widthPct, 2) : "n/a";
  const label = escapeHtml(labelText);
  const tooltipText = escapeHtml(
    `Range: ${formatToken(lower, 6)} -> ${formatToken(upper, 6)}\nCurrent: ${formatToken(current, 6)} (${rangeState})`
  );
  const outClass = rangeState === "in range" ? "" : " range-mini--out";

  return `
    <div class="range-mini${outClass}" data-tooltip="${tooltipText}" tabindex="0" role="img" aria-label="${tooltipText}">
      <span class="range-mini__label">${label}</span>
      <span class="range-mini__track">
        <span class="range-mini__edge range-mini__edge--left"></span>
        <span class="range-mini__edge range-mini__edge--right"></span>
        <span class="range-mini__marker" style="left:${markerPercent}%"></span>
      </span>
    </div>
  `;
}

function buildFeesEmissionsDisplay(row, quality) {
  const hasFees = Number.isFinite(row.fees24hUsd);
  const hasEmissions = Number.isFinite(row.emissions24hUsd);
  const total24hUsd = (hasFees ? row.fees24hUsd : 0) + (hasEmissions ? row.emissions24hUsd : 0);
  const hasAnyValue = hasFees || hasEmissions;
  const totalText = hasAnyValue ? formatUsdFixed(total24hUsd, 3) : "n/a";
  let tooltipText = `Fees: ${hasFees ? formatUsdFixed(row.fees24hUsd, 3) : "n/a"}\nEmissions: ${hasEmissions ? formatUsdFixed(row.emissions24hUsd, 3) : "n/a"}`;
  if (quality.chipLabel === "full" && quality.detail === "protocol-native data") {
    tooltipText += "\nFULL / protocol-native data";
  }
  const safeTooltipText = escapeHtml(tooltipText);
  const safeTotalText = escapeHtml(totalText);

  return `<span class="table-tooltip mono" data-tooltip="${safeTooltipText}" tabindex="0">${safeTotalText}</span>`;
}

function resolveClRangeState(row) {
  if ((row.positionType || "cl") === "aerodrome_v2") {
    return "in";
  }
  const hasRange = Number.isFinite(row.poolRangeLowerPrice) && Number.isFinite(row.poolRangeUpperPrice);
  const hasCurrent = Number.isFinite(row.poolCurrentPrice);
  if (!hasRange || !hasCurrent || row.poolRangeUpperPrice <= row.poolRangeLowerPrice) {
    return "unknown";
  }
  if (row.poolCurrentPrice < row.poolRangeLowerPrice || row.poolCurrentPrice > row.poolRangeUpperPrice) {
    return "out";
  }
  return "in";
}

function renderCurrentClRow(row) {
  const tr = document.createElement("tr");
  const quality = metricsQualityView(row);
  const rangeState = resolveClRangeState(row);
  const qualityIsFull = quality.chipLabel === "full";
  const rangeFlagClass = rangeState === "out" ? "cl-flag--out" : rangeState === "in" ? "cl-flag--in" : "cl-flag--na";
  const rangeFlagLabel = rangeState === "out" ? "out of range" : rangeState === "in" ? "in range" : "range n/a";
  const qualityFlagClass = qualityIsFull ? "cl-flag--full" : "cl-flag--partial";
  const qualityFlagLabel = qualityIsFull ? "full data" : "partial data";
  const safeQualityDetail = escapeHtml(quality.detail || "incomplete metrics");
  const protocolLabel = row.chainName
    ? `${row.chainName} · ${row.protocolDisplay || row.protocol}`
    : (row.protocolDisplay || row.protocol);
  const safeProtocol = escapeHtml(protocolLabel);
  const safePoolPair = escapeHtml(row.poolPair || "Unknown/Unknown");
  const safeFee = Number.isFinite(row.poolFee) ? escapeHtml(formatFeeTier(row.poolFee)) : "n/a";
  const rangeCurrentDisplay = buildRangeCurrentDisplay(row);
  const safeAvailableToClaim = Number.isFinite(row.vfatClaimableNowUsd)
    ? escapeHtml(formatUsd(row.vfatClaimableNowUsd))
    : "n/a";
  const feesEmissionsDisplay = buildFeesEmissionsDisplay(row, quality);
  const safeTotalDeposited = Number.isFinite(row.currentPoolUsd)
    ? escapeHtml(formatUsd(row.currentPoolUsd))
    : "n/a";
  const safeApr24h = Number.isFinite(row.apr24hPct)
    ? escapeHtml(formatPercent(row.apr24hPct, 2))
    : "n/a";
  tr.className = `cl-row ${qualityIsFull ? "cl-row--full" : "cl-row--partial"} ${rangeState === "out" ? "cl-row--out" : rangeState === "in" ? "cl-row--in" : "cl-row--unknown"}`;

  tr.innerHTML = `
    <td>${safeProtocol}</td>
    <td>
      <div class="cl-cell-main">${safePoolPair}</div>
      <div class="cl-cell-flags">
        <span class="cl-flag ${rangeFlagClass}">${rangeFlagLabel}</span>
        <span class="cl-flag ${qualityFlagClass}" title="${safeQualityDetail}">${qualityFlagLabel}</span>
      </div>
    </td>
    <td class="mono cl-cell-num">${safeFee}</td>
    <td class="mono range-price-cell">${rangeCurrentDisplay}</td>
    <td class="mono cl-cell-num">${safeAvailableToClaim}</td>
    <td class="mono cl-cell-num">${feesEmissionsDisplay}</td>
    <td class="mono cl-cell-num">${safeTotalDeposited}</td>
    <td class="mono cl-cell-num">${safeApr24h}</td>
  `;
  return tr;
}

function renderOpenRowsTable(portfolio) {
  els.openTableBody.innerHTML = "";

  if (!portfolio.openRows.length) {
    els.openEmpty.classList.remove("hidden");
    return;
  }

  els.openEmpty.classList.add("hidden");
  for (const [index, row] of portfolio.openRows.entries()) {
    const tr = renderCurrentClRow(row);
    if (!prefersReducedMotion()) {
      tr.classList.add("cl-row--stagger");
      tr.style.setProperty("--row-delay", `${Math.min(index * 18, 220)}ms`);
    }
    els.openTableBody.appendChild(tr);
  }
}

function clearDashboard() {
  els.walletHeadline.textContent = "Waiting for wallet";
  els.walletSubline.textContent = "Open settings to enter wallet + API key.";
  renderAccountBadge("");
  els.totalValue.textContent = "$0.00";
  els.totalClaimable.textContent = "$0.00";
  if (els.totalIncomeDaily) {
    els.totalIncomeDaily.textContent = "$0.00/day";
  }
  if (els.incomeProjectionNote) {
    els.incomeProjectionNote.textContent = "W $0.00 | M $0.00 | Y $0.00";
  }
  if (els.openCount) {
    els.openCount.textContent = "0";
  }
  els.rangeSummary.textContent = "0 / 0";
  if (els.rangeSummaryNote) {
    els.rangeSummaryNote.textContent = "in range vs total";
  }
  els.exchangeCountChip.textContent = "0 pools";
  els.openSectionTitle.textContent = "Open LP positions (0)";
  els.openTableBody.innerHTML = "";
  els.openEmpty.classList.remove("hidden");
  els.vfatContractsCountChip.textContent = "0 VFat contracts";
  els.vfatCurrentCountChip.textContent = "0 VFat positions";
  els.vfatUncertainCountChip.textContent = "0 uncertain";
  if (els.openDedupeStatus) {
    els.openDedupeStatus.textContent = "Duplicate policy: prefer VFat rows when tokenContract + tokenIdHex collide. This refresh merged 0 duplicates.";
  }
  els.vfatErrorText.textContent = "";
  els.vfatErrorText.classList.add("hidden");
}

async function runLookup({ openSettingsOnMissing = false } = {}) {
  const wallet = els.walletInput.value.trim();
  const apiKey = els.alchemyInput.value.trim();
  persistCredentials(wallet, apiKey);
  syncCredentialBanner();
  startTraceSession(`wallet=${wallet || "missing_wallet"}`);

  if (!wallet) {
    pushTrace("lookup_validation_error", {
      reason: "missing_wallet"
    });
    setStatus("Enter a wallet address in Settings.", "error");
    if (els.lastUpdatedText) {
      els.lastUpdatedText.textContent = "Waiting for credentials.";
    }
    if (openSettingsOnMissing) {
      openSettings();
    }
    return;
  }
  if (!apiKey) {
    pushTrace("lookup_validation_error", {
      reason: "missing_api_key",
      wallet
    });
    setStatus("Enter an Alchemy API key in Settings.", "error");
    if (els.lastUpdatedText) {
      els.lastUpdatedText.textContent = "Waiting for credentials.";
    }
    if (openSettingsOnMissing) {
      openSettings();
    }
    return;
  }

  let didRender = false;
  try {
    setBusy(true, "Reading Base + BSC contracts...");
    const portfolio = await fetchPortfolio(wallet, apiKey, (message) => setStatus(message));
    renderSummary(portfolio);
    renderOpenSectionDiagnostics(portfolio);
    renderOpenRowsTable(portfolio);
    didRender = true;
    if (els.lastUpdatedText) {
      els.lastUpdatedText.textContent = `Last updated ${formatTimeStamp(new Date())}`;
    }
    closeSettings();
    pushTrace("lookup_success", {
      openCount: portfolio?.totals?.openCount ?? 0,
      poolCount: portfolio?.totals?.poolCount ?? 0,
      vfatContracts: portfolio?.vfatContracts?.length ?? 0,
      vfatPositions: portfolio?.vfatCurrentTokenCount ?? 0
    });
  } catch (error) {
    pushTrace("lookup_error", {
      error: error?.message || String(error)
    });
    clearDashboard();
    setStatus(error.message || "Something went wrong while loading positions.", "error");
    if (els.lastUpdatedText) {
      els.lastUpdatedText.textContent = "Fetch failed.";
    }
  } finally {
    pushTrace("session", {
      message: `lookup_end rendered=${didRender}`
    });
    setBusy(false);
    if (didRender) {
      runIntroMotionOnce();
      pulseUpdatedFields();
    }
  }
}

async function boot() {
  await loadChainOverrides();
  applyChainContext("base");
  clearDashboard();
  loadPersistedCredentials();
  syncCredentialBanner();
  setStatus("Loading Base + BSC positions...");
  await runLookup({ openSettingsOnMissing: true });
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  closeSettings();
  await runLookup();
});

els.settingsButton.addEventListener("click", () => {
  openSettings();
});

if (els.downloadLogsButton) {
  els.downloadLogsButton.addEventListener("click", () => {
    downloadTraceLogs();
  });
}

els.settingsCloseButton.addEventListener("click", () => {
  closeSettings();
});

els.settingsOverlay.addEventListener("click", (event) => {
  if (event.target === els.settingsOverlay) {
    closeSettings();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.settingsOverlay.classList.contains("hidden")) {
    closeSettings();
  }
});

els.walletInput.addEventListener("change", () => {
  persistCredentials(els.walletInput.value.trim(), els.alchemyInput.value.trim());
  syncCredentialBanner();
});

els.alchemyInput.addEventListener("change", () => {
  persistCredentials(els.walletInput.value.trim(), els.alchemyInput.value.trim());
  syncCredentialBanner();
});

els.refreshTopButton.addEventListener("click", async () => {
  await runLookup();
});

let bootPromise = null;

/**
 * Bootstraps the scanner app exactly once from the ESM entrypoint.
 */
export function bootApp() {
  if (!bootPromise) {
    bootPromise = boot();
  }
  return bootPromise;
}

