const { ethers } = window;

export function isRetryableHttpStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isRetryableRpcPayloadError(errorPayload) {
  const code = Number(errorPayload?.error?.code);
  const message = String(errorPayload?.error?.message || "").toLowerCase();
  return code === -32005
    || code === -32603
    || message.includes("rate limit")
    || message.includes("timeout")
    || message.includes("temporarily unavailable");
}

export function isDeterministicEthCallRevert(errorPayload) {
  const code = Number(errorPayload?.error?.code);
  const message = String(errorPayload?.error?.message || "").toLowerCase();
  return code === 3
    || code === -32000
    || message.includes("execution reverted");
}

/**
 * @param {{
 *  state: { provider:any, providerKey:string },
 *  rpcMaxRetries:number,
 *  retryBaseMs:number,
 *  activeChainKey: () => string,
 *  chainId: () => number,
 *  chainRpcNetwork: () => string,
 *  pushTrace: (eventType:string, fields?:Record<string, unknown>) => void,
 *  delay: (ms:number) => Promise<void>
 * }} deps
 */
export function createRpcClient({
  state,
  rpcMaxRetries,
  retryBaseMs,
  activeChainKey,
  chainId,
  chainRpcNetwork,
  pushTrace,
  delay
}) {
  function getProvider(apiKey) {
    const providerKey = `${activeChainKey()}:${apiKey}`;
    if (!state.provider || state.providerKey !== providerKey) {
      const requestUrl = `https://${chainRpcNetwork()}.g.alchemy.com/v2/${apiKey}`;
      const provider = new ethers.JsonRpcProvider(requestUrl, chainId(), {
        staticNetwork: true
      });
      const originalSend = provider.send.bind(provider);
      const chainKey = activeChainKey();
      provider.send = async (method, params) => {
        pushTrace("provider_request", {
          chain: chainKey,
          method,
          url: requestUrl,
          request: { method, params }
        });
        try {
          const result = await originalSend(method, params);
          pushTrace("provider_response", {
            chain: chainKey,
            method,
            url: requestUrl,
            result
          });
          return result;
        } catch (error) {
          pushTrace("provider_error", {
            chain: chainKey,
            method,
            url: requestUrl,
            error: error?.message || String(error)
          });
          throw error;
        }
      };
      state.provider = provider;
      state.providerKey = providerKey;
      pushTrace("provider_init", {
        chainRpcNetwork: chainRpcNetwork(),
        providerKey
      });
    }
    return state.provider;
  }

  async function rpcCall(apiKey, method, params) {
    const url = `https://${chainRpcNetwork()}.g.alchemy.com/v2/${apiKey}`;
    let lastError = null;

    for (let attempt = 0; attempt <= rpcMaxRetries; attempt += 1) {
      const payload = {
        jsonrpc: "2.0",
        id: Date.now() + attempt,
        method,
        params
      };
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        let responseJson = null;
        try {
          responseJson = responseText ? JSON.parse(responseText) : null;
        } catch {
          responseJson = null;
        }

        if (!response.ok) {
          const retryableHttp = isRetryableHttpStatus(response.status);
          const retryablePayload = responseJson && isRetryableRpcPayloadError(responseJson);
          const shouldRetry = (retryableHttp || retryablePayload) && attempt < rpcMaxRetries;
          pushTrace("rpc_http_error", {
            method,
            status: response.status,
            attempt: attempt + 1,
            shouldRetry,
            params,
            response: responseText
          });
          if (shouldRetry) {
            await delay(retryBaseMs * (2 ** attempt));
            continue;
          }
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        if (responseJson?.error) {
          const retryable = isRetryableRpcPayloadError(responseJson);
          if (retryable && attempt < rpcMaxRetries) {
            pushTrace("rpc_payload_retry", {
              method,
              attempt: attempt + 1,
              code: responseJson.error.code,
              message: responseJson.error.message,
              params
            });
            await delay(retryBaseMs * (2 ** attempt));
            continue;
          }
          if (isDeterministicEthCallRevert(responseJson) && method === "eth_call") {
            pushTrace("rpc_eth_call_revert", {
              method,
              attempt: attempt + 1,
              code: responseJson.error.code,
              message: responseJson.error.message,
              params
            });
          }
          throw new Error(responseJson.error.message || "RPC error");
        }

        return responseJson?.result;
      } catch (error) {
        lastError = error;
        if (attempt < rpcMaxRetries) {
          pushTrace("rpc_exception_retry", {
            method,
            attempt: attempt + 1,
            error: error?.message || String(error),
            params
          });
          await delay(retryBaseMs * (2 ** attempt));
          continue;
        }
      }
    }

    throw new Error(lastError?.message || `RPC failed: ${method}`);
  }

  return {
    getProvider,
    rpcCall
  };
}
