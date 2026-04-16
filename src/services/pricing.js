const { ethers } = window;

export function tokenClass(symbol) {
  const key = symbol.toUpperCase();
  if (key === "WETH" || key === "ETH") {
    return "token-weth";
  }
  if (key === "USDC") {
    return "token-usdc";
  }
  return "token-default";
}

/**
 * @param {{
 *  state: { tokens: Map<string, any>, prices: Map<string, number|null> },
 *  erc20Abi: string[],
 *  priceApiBase: string,
 *  priceMaxRetries: number,
 *  retryBaseMs: number,
 *  getChainPriceNetwork: () => string,
 *  pushTrace: (eventType:string, fields?:Record<string, unknown>) => void,
 *  delay: (ms:number) => Promise<void>
 * }} deps
 */
export function createPricingService({
  state,
  erc20Abi,
  priceApiBase,
  priceMaxRetries,
  retryBaseMs,
  getChainPriceNetwork,
  pushTrace,
  delay
}) {
  async function getTokenMeta(address, provider) {
    const normalized = ethers.getAddress(address);
    if (state.tokens.has(normalized)) {
      return state.tokens.get(normalized);
    }

    const contract = new ethers.Contract(normalized, erc20Abi, provider);
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
      let payload = null;
      let resolved = false;
      let lastError = null;
      const requestUrl = `${priceApiBase}/${apiKey}/tokens/by-address`;

      for (let attempt = 0; attempt <= priceMaxRetries; attempt += 1) {
        const attemptNumber = attempt + 1;
        const requestPayload = {
          addresses: missing.map((address) => ({
            network: getChainPriceNetwork(),
            address
          }))
        };

        try {
          const response = await fetch(requestUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(requestPayload)
          });

          const responseText = await response.text();
          let parsed = null;
          try {
            parsed = responseText ? JSON.parse(responseText) : null;
          } catch {
            parsed = null;
          }

          if (!response.ok) {
            const shouldRetry = (response.status === 429 || response.status >= 500) && attempt < priceMaxRetries;
            pushTrace("price_http_error", {
              attempt: attemptNumber,
              status: response.status,
              shouldRetry,
              missingCount: missing.length,
              response: responseText
            });
            if (shouldRetry) {
              await delay(retryBaseMs * (2 ** attempt));
              continue;
            }
            throw new Error(`Price HTTP ${response.status}`);
          }

          payload = parsed;
          resolved = true;
          break;
        } catch (error) {
          lastError = error;
          const shouldRetry = attempt < priceMaxRetries;
          pushTrace("price_exception", {
            attempt: attemptNumber,
            shouldRetry,
            missingCount: missing.length,
            error: error?.message || String(error)
          });
          if (shouldRetry) {
            await delay(retryBaseMs * (2 ** attempt));
          }
        }
      }

      if (!resolved) {
        pushTrace("price_failed", {
          missingCount: missing.length,
          error: lastError?.message || "unknown"
        });
      }

      for (const item of payload?.data || []) {
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

  return {
    getTokenMeta,
    getPrices
  };
}
