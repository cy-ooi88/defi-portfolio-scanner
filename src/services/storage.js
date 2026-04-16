const { ethers } = window;

/**
 * @param {{
 *   storageKeys: { wallet: string, alchemyKey: string, vfatContractsCache: string },
 *   getActiveChainKey: () => string,
 *   normalizeAddressList: (values: string[]) => string[],
 *   vfatTtlMs: number
 * }} deps
 */
export function createStorageService({ storageKeys, getActiveChainKey, normalizeAddressList, vfatTtlMs }) {
  function getVfatCacheStorageKey() {
    return `${storageKeys.vfatContractsCache}:${getActiveChainKey()}`;
  }

  function loadPersistedCredentials() {
    try {
      return {
        wallet: localStorage.getItem(storageKeys.wallet) || "",
        apiKey: localStorage.getItem(storageKeys.alchemyKey) || ""
      };
    } catch {
      return { wallet: "", apiKey: "" };
    }
  }

  function persistCredentials(wallet, apiKey) {
    try {
      if (wallet) {
        localStorage.setItem(storageKeys.wallet, wallet);
      } else {
        localStorage.removeItem(storageKeys.wallet);
      }
      if (apiKey) {
        localStorage.setItem(storageKeys.alchemyKey, apiKey);
      } else {
        localStorage.removeItem(storageKeys.alchemyKey);
      }
    } catch {
      // Ignore localStorage access errors.
    }
  }

  function readCachedVfatContracts(wallet) {
    try {
      const owner = ethers.getAddress(wallet).toLowerCase();
      const raw = localStorage.getItem(getVfatCacheStorageKey());
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const entry = parsed?.[owner];
      if (!entry || !Array.isArray(entry.addresses) || !Number.isFinite(entry.updatedAt)) {
        return null;
      }
      if ((Date.now() - entry.updatedAt) > vfatTtlMs) {
        return null;
      }
      return normalizeAddressList(entry.addresses);
    } catch {
      return null;
    }
  }

  function writeCachedVfatContracts(wallet, addresses) {
    try {
      const owner = ethers.getAddress(wallet).toLowerCase();
      const normalizedAddresses = normalizeAddressList(addresses);
      const key = getVfatCacheStorageKey();
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      parsed[owner] = {
        addresses: normalizedAddresses,
        updatedAt: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(parsed));
    } catch {
      // Ignore localStorage access errors.
    }
  }

  return {
    loadPersistedCredentials,
    persistCredentials,
    getVfatCacheStorageKey,
    readCachedVfatContracts,
    writeCachedVfatContracts
  };
}
