Project Map

Files:

* index.html: App shell and DOM IDs; loads `ethers` CDN and `main.js`.
* main.js: Bootstrap wrapper; dynamic-imports bridge and handles boot failure fallback.
* app.js: Re-export compatibility entry for `bootApp`.
* legacy-app-bridge.js: Primary runtime orchestrator (chain loop, discovery, valuation, rendering, UI events).
* src/config/constants.js: Chain configs, addresses/selectors, ABI exports, retry/cache/storage constants.
* src/config/chains.js: Re-export chain-related constants.
* src/config/abis.js: Re-export ABI constants.
* bsc_vfat_constants.json: Runtime BSC override allowlists/managers loaded at boot.
* src/services/rpcClient.js: Alchemy RPC transport, provider init, retry logic, RPC error classification.
* src/services/pricing.js: Token metadata + Alchemy price API fetch/caching/retries.
* src/services/storage.js: LocalStorage credentials + per-chain VFat contract cache (TTL).
* src/services/traceLogger.js: In-memory trace session buffer + masked log download.
* src/domain/discovery/index.js: Discovery facade stub.
* src/domain/history/index.js: History facade stub.
* src/domain/portfolio/fetchPortfolio.js: Portfolio facade stub.
* src/ui/controls.js: UI controls facade stub.
* src/ui/renderers.js: Renderer facade stub.
* new_app.html: Alternate BSC-only page variant.
* new_app.js: Alternate monolithic BSC-only runtime variant.

Key Entry Points:

* start (main.js): Verifies `window.ethers`, imports bridge, invokes app boot.
* bootApp: One-time guard around `boot`.
* boot: Loads chain overrides, restores persisted credentials, runs initial lookup.
* runLookup: Validates inputs, starts trace session, executes fetch/render lifecycle.
* fetchPortfolio: Multi-chain aggregator (`base` then `bsc`) and cross-chain merge.
* fetchPortfolioSingleChain: Wallet-held NFT scan + VFat pipeline + chain totals.
* fetchVFatClDataForWallet: Deployment discovery, VFat identification, transfer-history reconstruction, active-position validation.
* mergeOpenRowsWithVfatPreference: Dedupes by `tokenContract + tokenIdHex`, prefers VFat rows.
* renderSummary / renderOpenSectionDiagnostics / renderOpenRowsTable: Final UI projection.
* downloadTraceLogs: Exports current trace buffer to local file.

Data Flow:

* Browser load -> `main.js:start` -> `bootApp` -> `boot` -> `runLookup`
* Settings form/localStorage -> wallet + Alchemy key -> `runLookup` validation
* `CHAIN_SEQUENCE` -> `applyChainContext` + `resetRuntimeCaches` -> `fetchPortfolioSingleChain`
* Wallet address -> manager NFT reads (`balanceOf`/`tokenOfOwnerByIndex`/`positions`) -> standard CL rows
* Token addresses -> pricing service (Alchemy prices API) -> USD valuation fields
* Wallet address + allowlists -> deployment discovery (`alchemy_getAssetTransfers` + receipts) -> candidate contracts
* Candidate contracts + bytecode parse -> EIP-1167 implementation filter -> VFat contracts
* VFat contracts + ERC721 transfers -> CL history rows -> current owner/liquidity validation -> current VFat rows
* Current rows -> 24h fees/emissions/APR enrichment -> merged open rows
* Standard rows + VFat rows -> VFat-preferred dedupe -> unified totals
* Unified portfolio -> renderers -> summary chips + table rows
* Runtime events/errors/RPC calls -> trace logger -> downloadable masked trace log

Critical Constraints:

* `window.ethers` must be loaded before `main.js` boot.
* Lookup must abort on missing wallet or missing Alchemy API key.
* Chain processing order is fixed by `CHAIN_SEQUENCE` (`base`, `bsc`).
* Chain context must be switched via `applyChainContext` and caches reset per chain.
* CL protocol attribution depends on configured `CL_POSITION_MANAGERS`; unknown managers are ignored/unknown.
* VFat dedupe policy must preserve VFat precedence on identity collisions.
* VFat cache is per-chain and TTL-bound (`VFAT_CONTRACT_CACHE_TTL_MS`).
* RPC/price retries are bounded (`RPC_MAX_RETRIES`, `PRICE_MAX_RETRIES`) with exponential backoff.
* Trace logs must mask Alchemy secrets before storing/downloading.
* If strict VFat implementation allowlist misses all matches, fallback clone detection path is used.

Guidance Rules for Future Agents:

* Start with the smallest relevant file
* Do not read entire files unless necessary
* Ask for specific functions if more context is needed
