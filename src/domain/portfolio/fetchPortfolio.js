const { ethers } = window;

/**
 * Portfolio domain runtime extracted from legacy bridge.
 */
export function createPortfolioFacade({
  deps,
  ctx
}) {
  const {
    normalizePositionIdentityKey,
    normalizePositionManagers,
    chooseStandardManagerAddress,
    getProvider,
    getPrices,
    fetchPosition,
    enrichValues,
    normalizeStandardOpenPositionRow,
    enrichCurrentRowsWith24hMetrics,
    fetchAerodromeSlipstreamStakedRows,
    fetchVFatClDataForWallet,
    buildVfatContractHealthNote,
    delay,
    applyChainContext,
    resetRuntimeCaches
  } = deps;

  const {
    getChainSequence,
    getChainConfigs,
    getChainName,
    getActiveChainKey,
    getClPositionManagers
  } = ctx;

  function annotateProtocolDisplay(rows, { isVfat = false } = {}) {
    return (rows || []).map((row) => ({
      ...row,
      source: isVfat ? "vfat" : (row.source || "standard"),
      protocolDisplay: isVfat ? `${row.protocol} (VFat)` : (row.protocolDisplay || row.protocol)
    }));
  }

  function mergeOpenRowsWithVfatPreference(standardRows, vfatRows) {
    const mergedByKey = new Map();
    let dedupeCount = 0;

    for (const row of (standardRows || [])) {
      const key = normalizePositionIdentityKey(row.tokenContract, row.tokenIdHex);
      mergedByKey.set(key, row);
    }

    for (const row of (vfatRows || [])) {
      const key = normalizePositionIdentityKey(row.tokenContract, row.tokenIdHex);
      if (mergedByKey.has(key)) {
        dedupeCount += 1;
        const existing = mergedByKey.get(key);
        if ((existing?.source || "standard") !== "vfat" && row.ownerCheck !== "confirmed") {
          continue;
        }
      }
      mergedByKey.set(key, row);
    }

    const openRows = [...mergedByKey.values()].sort((a, b) => {
      const aUsd = Number.isFinite(a.currentPoolUsd) ? a.currentPoolUsd : -Infinity;
      const bUsd = Number.isFinite(b.currentPoolUsd) ? b.currentPoolUsd : -Infinity;
      return bUsd - aUsd;
    });
    return {
      openRows,
      dedupeCount
    };
  }

  function buildUnifiedSummaryTotals(openRows) {
    let pooledUsd = 0;
    let claimableUsd = 0;
    let inRangeCount = 0;
    let rangeConsideredCount = 0;
    let clOpenCount = 0;
    const uniquePools = new Set();

    for (const row of (openRows || [])) {
      const positionType = row.positionType || "cl";
      if (Number.isFinite(row.currentPoolUsd)) {
        pooledUsd += row.currentPoolUsd;
      }
      if (Number.isFinite(row.vfatClaimableNowUsd)) {
        claimableUsd += row.vfatClaimableNowUsd;
      }
      if (positionType === "cl") {
        clOpenCount += 1;
        if (typeof row.vfatInRange === "boolean") {
          rangeConsideredCount += 1;
          if (row.vfatInRange) {
            inRangeCount += 1;
          }
        }
      } else if (positionType === "aerodrome_v2") {
        rangeConsideredCount += 1;
        inRangeCount += 1;
      }
      if (row.poolPair) {
        uniquePools.add(`${row.chainKey || getActiveChainKey()}:${row.protocol || "unknown"}:${row.poolPair}:${Number.isFinite(row.poolFee) ? row.poolFee : "na"}`);
      }
    }

    const openCount = (openRows || []).length;
    const rangeExcludedCount = clOpenCount - rangeConsideredCount;

    return {
      pooledUsd,
      claimableUsd,
      openCount,
      inRangeCount,
      rangeConsideredCount,
      rangeExcludedCount,
      poolCount: uniquePools.size
    };
  }

  async function fetchPositionsThrottled(tokenRefs, provider, onStatus = () => {}) {
    const positions = [];
    let failures = 0;
    const batchSize = 2;

    for (let i = 0; i < tokenRefs.length; i += batchSize) {
      const batch = tokenRefs.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map((item) => fetchPosition(item.tokenId, item.managerAddress, provider))
      );
      for (const result of settled) {
        if (result.status === "fulfilled") {
          positions.push(result.value);
        } else {
          failures += 1;
        }
      }
      if (i + batchSize < tokenRefs.length) {
        onStatus(`Throttling ${getChainName()} wallet-held reads (${Math.min(i + batchSize, tokenRefs.length)}/${tokenRefs.length})...`);
        await delay(160);
      }
    }

    return { positions, failures };
  }

  async function fetchPortfolioSingleChain(wallet, apiKey, onStatus = () => {}) {
    const provider = getProvider(apiKey);
    const owner = ethers.getAddress(wallet);
    const configuredManagers = normalizePositionManagers(getClPositionManagers());
    const managerAddresses = configuredManagers.length
      ? configuredManagers.map((item) => ethers.getAddress(item.address))
      : [chooseStandardManagerAddress()];
    onStatus(`Fetching wallet-held position NFTs from ${managerAddresses.length} manager${managerAddresses.length === 1 ? "" : "s"} on ${getChainName()}...`);

    const tokenRefs = [];
    for (const managerAddress of managerAddresses) {
      const manager = new ethers.Contract(managerAddress, deps.nfpmAbi, provider);
      let balance = 0;
      try {
        balance = Number(await manager.balanceOf(owner));
      } catch {
        continue;
      }
      if (!Number.isFinite(balance) || balance <= 0) {
        continue;
      }
      const ids = await Promise.all(
        Array.from({ length: balance }, (_, index) => manager.tokenOfOwnerByIndex(owner, index))
      );
      for (const tokenId of ids) {
        tokenRefs.push({ tokenId, managerAddress });
      }
    }

    const throttledReads = await fetchPositionsThrottled(tokenRefs, provider, onStatus);
    const rawPositions = throttledReads.positions;
    const walletPositionReadFailures = throttledReads.failures;
    const uniqueAddresses = [...new Set(rawPositions.flatMap((item) => [item.token0.address, item.token1.address]))];
    const prices = await getPrices(uniqueAddresses, apiKey);
    const positions = rawPositions.map((item) => enrichValues(item, prices));
    const standardOpenPositions = positions.filter((item) => item.liquidity > 0n);
    const standardRowsCurrent = standardOpenPositions.map((position) => normalizeStandardOpenPositionRow(position, owner));

    onStatus("Computing 24h fees, emissions, and APR for wallet-held CL positions...");
    const standardRowsEnriched = await enrichCurrentRowsWith24hMetrics(standardRowsCurrent, apiKey, provider, onStatus);

    const aerodromeSlipstreamStakedRows = typeof fetchAerodromeSlipstreamStakedRows === "function"
      ? await fetchAerodromeSlipstreamStakedRows(owner, apiKey, provider, onStatus)
      : [];

    const vfatData = {
      vfatContracts: [],
      vfatClCurrentRows: [],
      vfatV2CurrentRows: [],
      vfatClCurrentTokenCount: 0,
      vfatV2CurrentTokenCount: 0,
      vfatClOwnedByVfatCount: 0,
      vfatClExternalizedCount: 0,
      vfatClUncertainCount: 0,
      vfatClError: ""
    };
    if (walletPositionReadFailures > 0) {
      vfatData.vfatClError = `${walletPositionReadFailures} wallet-held NFT read${walletPositionReadFailures === 1 ? "" : "s"} failed and were skipped on ${getChainName()} (wallet scan warning, VFat scan still runs).`;
    }

    try {
      const fetchedVfat = await fetchVFatClDataForWallet(owner, apiKey, provider, onStatus);
      vfatData.vfatContracts = fetchedVfat.vfatContracts;
      vfatData.vfatClCurrentRows = fetchedVfat.vfatClCurrentRows;
      vfatData.vfatV2CurrentRows = fetchedVfat.vfatV2CurrentRows;
      vfatData.vfatClCurrentTokenCount = fetchedVfat.vfatClCurrentTokenCount;
      vfatData.vfatV2CurrentTokenCount = fetchedVfat.vfatV2CurrentTokenCount;
      vfatData.vfatClOwnedByVfatCount = fetchedVfat.vfatClOwnedByVfatCount;
      vfatData.vfatClExternalizedCount = fetchedVfat.vfatClExternalizedCount;
      vfatData.vfatClUncertainCount = fetchedVfat.vfatClUncertainCount;
      const fallbackNote = buildVfatContractHealthNote(fetchedVfat.vfatContracts);
      if (fallbackNote) {
        vfatData.vfatClError = vfatData.vfatClError
          ? `${vfatData.vfatClError} | ${fallbackNote}`
          : fallbackNote;
      }
    } catch (error) {
      const vfatError = error?.message || "Failed to fetch VFat position data.";
      vfatData.vfatClError = vfatData.vfatClError
        ? `${vfatData.vfatClError} | ${vfatError}`
        : vfatError;
    }

    const standardRows = annotateProtocolDisplay([
      ...standardRowsEnriched,
      ...aerodromeSlipstreamStakedRows
    ], { isVfat: false });
    const vfatRows = annotateProtocolDisplay([
      ...(vfatData.vfatClCurrentRows || []),
      ...(vfatData.vfatV2CurrentRows || [])
    ], { isVfat: true });
    const mergedOpen = mergeOpenRowsWithVfatPreference(standardRows, vfatRows);
    const unifiedTotals = buildUnifiedSummaryTotals(mergedOpen.openRows);

    return {
      chainKey: getActiveChainKey(),
      chainName: getChainName(),
      owner,
      openRows: mergedOpen.openRows.map((row) => ({
        ...row,
        chainKey: getActiveChainKey(),
        chainName: getChainName()
      })),
      openRowsDedupeCount: mergedOpen.dedupeCount,
      vfatContracts: vfatData.vfatContracts,
      vfatClCurrentRows: vfatData.vfatClCurrentRows,
      vfatV2CurrentRows: vfatData.vfatV2CurrentRows,
      vfatClCurrentTokenCount: vfatData.vfatClCurrentTokenCount,
      vfatV2CurrentTokenCount: vfatData.vfatV2CurrentTokenCount,
      vfatCurrentTokenCount: vfatData.vfatClCurrentTokenCount + vfatData.vfatV2CurrentTokenCount,
      vfatClOwnedByVfatCount: vfatData.vfatClOwnedByVfatCount,
      vfatClExternalizedCount: vfatData.vfatClExternalizedCount,
      vfatClUncertainCount: vfatData.vfatClUncertainCount,
      vfatClError: vfatData.vfatClError,
      totals: {
        pooledUsd: unifiedTotals.pooledUsd,
        claimableUsd: unifiedTotals.claimableUsd,
        openCount: unifiedTotals.openCount,
        poolCount: unifiedTotals.poolCount,
        inRangeCount: unifiedTotals.inRangeCount,
        rangeConsideredCount: unifiedTotals.rangeConsideredCount,
        rangeExcludedCount: unifiedTotals.rangeExcludedCount
      }
    };
  }

  function mergeChainErrors(chainErrors) {
    return chainErrors
      .map((item) => `${item.chainName}: ${item.message}`)
      .join(" | ");
  }

  async function fetchPortfolio(wallet, apiKey, onStatus = () => {}) {
    const owner = ethers.getAddress(wallet);
    const chainPortfolios = [];
    const chainErrors = [];

    for (const chainKey of getChainSequence()) {
      const config = getChainConfigs()[chainKey];
      if (!config) {
        continue;
      }
      applyChainContext(chainKey);
      resetRuntimeCaches();
      try {
        onStatus(`Loading ${getChainName()} positions...`);
        const scopedStatus = (message) => onStatus(`[${getChainName()}] ${message}`);
        const portfolio = await fetchPortfolioSingleChain(wallet, apiKey, scopedStatus);
        chainPortfolios.push(portfolio);
      } catch (error) {
        chainErrors.push({
          chainKey,
          chainName: config.chainName,
          message: error?.message || "Failed to load chain data."
        });
      }
    }

    if (!chainPortfolios.length) {
      throw new Error(chainErrors.length ? mergeChainErrors(chainErrors) : "Failed to load portfolio data.");
    }

    const openRows = chainPortfolios
      .flatMap((item) => item.openRows || [])
      .sort((a, b) => {
        const aUsd = Number.isFinite(a.currentPoolUsd) ? a.currentPoolUsd : -Infinity;
        const bUsd = Number.isFinite(b.currentPoolUsd) ? b.currentPoolUsd : -Infinity;
        return bUsd - aUsd;
      });
    const unifiedTotals = buildUnifiedSummaryTotals(openRows);
    const mergedVfatErrorParts = [
      ...chainPortfolios.map((item) => item.vfatClError).filter(Boolean),
      ...(chainErrors.length ? [mergeChainErrors(chainErrors)] : [])
    ];

    return {
      owner,
      openRows,
      openRowsDedupeCount: chainPortfolios.reduce((sum, item) => sum + (item.openRowsDedupeCount || 0), 0),
      vfatContracts: chainPortfolios.flatMap((item) => item.vfatContracts || []),
      vfatClCurrentRows: chainPortfolios.flatMap((item) => item.vfatClCurrentRows || []),
      vfatV2CurrentRows: chainPortfolios.flatMap((item) => item.vfatV2CurrentRows || []),
      vfatClCurrentTokenCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatClCurrentTokenCount || 0), 0),
      vfatV2CurrentTokenCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatV2CurrentTokenCount || 0), 0),
      vfatCurrentTokenCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatCurrentTokenCount || 0), 0),
      vfatClOwnedByVfatCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatClOwnedByVfatCount || 0), 0),
      vfatClExternalizedCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatClExternalizedCount || 0), 0),
      vfatClUncertainCount: chainPortfolios.reduce((sum, item) => sum + (item.vfatClUncertainCount || 0), 0),
      vfatClError: mergedVfatErrorParts.join(" | "),
      chainsLoaded: chainPortfolios.map((item) => item.chainName).filter(Boolean),
      totals: {
        pooledUsd: unifiedTotals.pooledUsd,
        claimableUsd: unifiedTotals.claimableUsd,
        openCount: unifiedTotals.openCount,
        poolCount: unifiedTotals.poolCount,
        inRangeCount: unifiedTotals.inRangeCount,
        rangeConsideredCount: unifiedTotals.rangeConsideredCount,
        rangeExcludedCount: unifiedTotals.rangeExcludedCount
      }
    };
  }

  return {
    fetchPortfolio,
    fetchPortfolioSingleChain,
    fetchPositionsThrottled,
    mergeChainErrors,
    buildUnifiedSummaryTotals
  };
}
