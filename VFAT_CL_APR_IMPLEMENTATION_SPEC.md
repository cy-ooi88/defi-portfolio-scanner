# VFat CL + Aerodrome V2 APR (Base) - Deterministic Reimplementation Spec

## 1. Goal
This document is a strict reimplementation contract for the VFat pipeline in this repo, covering CL NFTs and Aerodrome V2 gauge-staked LP positions.

If another LLM (or engineer) follows this spec exactly, it should reproduce the same behavior and outputs without reading this repo's code.

## 2. Scope and fixed assumptions
- Chain: Base mainnet only (`chainId = 8453`, `0x2105`)
- Data sources: Alchemy Base RPC + Alchemy Prices API
- No subgraph/protocol REST API dependency
- Supported CL protocols:
  - Aerodrome SlipStream
  - PancakeSwap V3
  - Uniswap V3
- Supported non-CL protocol path:
  - Aerodrome V2 gauges (fungible LP staking)
- 24h window: block timestamp based (`latest.timestamp - 86400`)
- APR annualization factor: `365`

## 3. Output fields (current UI contract)
For each currently active VFat row (CL or Aerodrome V2):
- `Protocol`
- `Pool` (token symbol pair)
- `Fee`
- `Range (lower -> upper)` (price = token1 per token0; `n/a` for Aerodrome V2)
- `Current price` (token1 per token0; `n/a` for Aerodrome V2)
- `Fees (24h, USD)` (3 decimals)
- `Emissions (24h, USD)` (3 decimals or `n/a`)
- `Total Deposited (USD)` (2 decimals)
- `APR (24h annualized)` (percent)

Rows are sorted by `Total Deposited (USD)` descending.

## 4. Constants (must match)

### 4.1 Position manager allowlist (ERC-721 contracts)
- Aerodrome SlipStream NFPM: `0x827922686190790b37229fd06084350e74485b72`
- PancakeSwap V3 NFPM: `0x46a15b0b27311cedf172ab29e4f4766fbe7f4364`
- Uniswap V3 NFPM: `0x03a520b32c04bf3beef7beb72e919cf822ed34f1`

### 4.2 VFat discovery constants
- Sickle factory allowlist: `0x71d234a3e1dfc161cc1d081e6496e76627baac31`
- Sickle deploy topic: `0xb1a29087760d8e8f9b263f598962f752e7bd23badd44897e2966d376d1a59dca`
- VFat implementation allowlist: `0xfff75d099baee29f447866bc5299cd67c04761c8`
- EIP-1167 bytecode pattern:
  - prefix: `363d3d373d3d3d363d73`
  - suffix: `5af43d82803e903d91602b57fd5bf3`

### 4.3 ABI selectors/topics used
- `slot0()` -> `0x3850c7bd`
- `earned(address,uint256)` -> `0x3e491d47`
- `rewardToken()` -> `0xf7c618c1`
- `getReward(uint256)` -> `0x1c4b774b`
- `getReward(address)` -> `0xc00007b0` (known but not token-attributable)
- `pendingCake(uint256)` -> `0xce5f39c6`
- `harvest(uint256,address)` -> `0x18fccc76`
- `CAKE()` -> `0x4ca6ef28`
- `cake()` -> `0xdce17484`
- Pancake CAKE fallback token: `0x3055913c90fcc1a6ce9a358911721eeb942013a1`

Collect event topics (must query both):
- `Collect(uint256,address,uint256,uint256)`
- `Collect(uint256,address,uint128,uint128)`

### 4.4 numeric constants
- `Q96 = 2^96`
- `Q128 = 2^128`
- `MaxUint256 = 2^256 - 1`
- `ZeroAddress = 0x0000000000000000000000000000000000000000`
- `SECONDS_PER_DAY = 86400`

### 4.5 Aerodrome V2 constants
- Voter: `0x16613524e02ad97edfef371bc883f2f5d6c480a5`
- V2 pair factory: `0x420dd381b31aef6683db6b902084cb0ffece40da`

## 5. RPC/API methods required
- `alchemy_getAssetTransfers` (with pagination via `pageKey`)
- `eth_getTransactionReceipt`
- `eth_getTransactionByHash`
- `eth_getCode`
- `eth_call`
- `eth_getLogs`
- `eth_getBlockByNumber`
- Alchemy Prices API:
  - `POST https://api.g.alchemy.com/prices/v1/{API_KEY}/tokens/by-address`
  - network field must be `base-mainnet`

## 6. Canonical data model (minimum)

## 6.1 Transfer history row (`ClTransferRow`)
- `vfatContract: address`
- `tokenContract: address` (must be one of allowlisted managers)
- `protocol: "Aerodrome SlipStream" | "PancakeSwap V3" | "Uniswap V3"`
- `tokenIdHex: 0x...`
- `tokenIdDecimal: string`
- `tokenKey = lower(vfatContract) + ":" + lower(tokenContract) + ":" + lower(tokenIdHex)`
- `direction: "out" | "in" | "self"`
- `action: "deposited" | "received" | "minted" | "burned" | "internal"`
- `txHash`
- `blockNumber`
- `blockTimestamp`
- `from`
- `to`
- `sortRef` (use transfer unique id if present)

## 6.2 Current active row (`CurrentClRow`)
Required fields used in APR and rendering:
- `positionType: "cl" | "aerodrome_v2"`
- `protocol`, `poolPair`, `poolFee`
- `poolStable: bool | null`
- `poolTickLower`, `poolTickUpper`
- `poolRangeLowerPrice`, `poolRangeUpperPrice`, `poolCurrentPrice`
- `currentOwner`, `ownerScope`, `ownerCheck`
- `adapterType`
- `fees24hUsd`
- `emissions24hUsd`
- `currentPoolUsd`
- `apr24hPct`
- `metricsQuality: "full" | "partial"`
- `metricsReason: "full" | "partial_ambiguous_claim" | "partial_unclassified" | "partial_call_failed"`

## 7. End-to-end pipeline

### Step 1: Inputs
- Validate wallet checksum with `ethers.getAddress(wallet)`
- Read Alchemy key

### Step 2: Discover direct deployments
Use `alchemy_getAssetTransfers`:
- `fromAddress = wallet`
- `fromBlock = "0x0"`, `toBlock = "latest"`
- `category = ["external"]`
- `maxCount = "0x3e8"`
- paginate by `pageKey`

Keep transfers where `to == null`, then:
- call `eth_getTransactionReceipt(hash)`
- collect `receipt.contractAddress`
- dedupe

### Step 3: Sickle factory fallback discovery
For each allowed factory:
- query `alchemy_getAssetTransfers` with
  - `fromAddress = wallet`
  - `toAddress = factory`
  - same block range + pagination
- gather tx hashes, fetch receipts
- parse receipt logs:
  - `log.address` must equal factory
  - `topics[0] == SICKLE_DEPLOY_EVENT_TOPIC`
  - `topics[1]` decoded address must equal wallet (admin)
  - contract address from log data last 20 bytes

Union direct + factory deployments, dedupe.

### Step 4: Identify VFat contracts
For each discovered contract:
- `eth_getCode(address, "latest")`
- parse as EIP-1167:
  - exact pattern `prefix + 20-byte impl + suffix`
- keep only if impl is in allowlist

### Step 5: Pull CL NFT transfer history per VFat contract
For each identified VFat contract, call `alchemy_getAssetTransfers` twice:
- outbound: `fromAddress = vfatContract`
- inbound: `toAddress = vfatContract`
Common params:
- `fromBlock = "0x0"`, `toBlock = "latest"`
- `category = ["erc721"]`
- `contractAddresses = [all 3 manager addresses]`
- `withMetadata = true`
- pagination via `pageKey`

Map each transfer to `ClTransferRow`.
Sort ascending by `(blockNumber, txHash, sortRef)` when deriving state.

### Step 5B: Discover Aerodrome V2 gauges per VFat contract
For each identified VFat contract:
- query ERC20 transfers both directions with `alchemy_getAssetTransfers`:
  - outbound: `fromAddress = vfatContract`
  - inbound: `toAddress = vfatContract`
  - `fromBlock = "0x0"`, `toBlock = "latest"`, paginated
- collect counterparties from transfer `from/to`
- keep only counterparties where `voter.isGauge(counterparty) == true`
- keep only gauges with active stake:
  - `gauge.balanceOf(vfatContract) > 0`
- keep only Aerodrome V2 gauges:
  - `v2PairFactory.isPool(gauge.stakingToken()) == true`

### Step 6: Derive current ownership candidates
Group history by `tokenKey`.
For each group:
- latest transfer = current inferred state
- exclude if latest `to == ZeroAddress` (burned)
- keep row with:
  - `currentOwner = latest.to`
  - `ownerScope = "vfat"` if owner is VFat else `"external"`

### Step 7: Live validation and active filter
For each candidate:
- `ownerOf(tokenId)` via `eth_call`
- `positions(tokenId)` via `eth_call`
- exclude row unless:
  - owner is non-zero
  - liquidity > 0

Then update row with live values:
- owner / ownerScope / ownerCheck (`confirmed` if matches latest transfer owner else `uncertain`)
- token addresses, fee tier, ticks
- pool pair symbol
- range prices and current price

### Step 8: Resolve 24h block window
1. Fetch latest header: `eth_getBlockByNumber("latest", false)`
2. `targetTimestamp = latest.timestamp - 86400`
3. Binary search block `b` in `[0, latest.number]` such that:
   - `timestamp(b) <= targetTimestamp`
   - `timestamp(b+1) > targetTimestamp` (or `b` is best candidate)
4. Use:
   - `fromBlockTag = hex(b)`
   - `toBlockTag = hex(latest.number)`

### Step 9: Classify owner adapter
This step applies to CL rows only.

For each active row, classify `currentOwner`:

1. If `eth_getCode(currentOwner)` is empty -> `direct_owner`
2. Aerodrome probe:
   - call `earned(vfatContract, tokenId)` on `currentOwner`
   - success and non-empty result -> `aerodrome_clgauge`
3. Pancake probe:
   - call `pendingCake(tokenId)` on `currentOwner`
   - success and non-empty result -> `pancake_masterchef`
4. Else `unknown`

### Step 10: Compute fees (24h)
For each row:
1. Fetch claimable snapshot now and at `fromBlockTag`:
   - use `positions(tokenId)` at block
   - resolve pool via manager factory
   - fetch pool state at block:
     - `slot0`
     - `feeGrowthGlobal0X128`, `feeGrowthGlobal1X128`
     - `ticks(tickLower)`, `ticks(tickUpper)`
   - compute claimable with fee growth math (Section 8.3)
2. Fetch realized collect in 24h:
   - `eth_getLogs` on manager contract address
   - for each collect topic variant
   - filter topic[1] = tokenId (32-byte word)
   - parse amounts as last two 32-byte words in log data
   - dedupe by `(txHash, logIndex)`
3. Per token:
   - `pendingDelta = pendingNow - pendingStart`
   - `rawFees = collect24h + pendingDelta`
   - `feesRaw = max(rawFees, 0)` (clamp negative to zero)
4. Protocol override:
   - Aerodrome `feesMode=none` => force fees raw to `0`
5. Convert raw token fees to USD using current token prices

### Step 11: Compute emissions (24h), protocol-native

### 11.1 Aerodrome SlipStream
Only valid if `adapterType == aerodrome_clgauge`, else partial-unclassified.

1. Pending delta:
   - `pendingNow = earned(vfat, tokenId)` at latest
   - `pendingStart = earned(vfat, tokenId)` at fromBlock
   - `pendingDelta = max(pendingNow - pendingStart, 0)`
2. Reward token:
   - `rewardToken()` on gauge
3. Realized in-window reward transfers:
   - query ERC20 transfers:
     - `fromAddress = gauge`
     - `toAddress = vfat`
     - `contractAddresses = [rewardToken]`
     - `fromBlock=fromBlockTag`, `toBlock=toBlockTag`, paginated
4. Attribution by tx input:
   - fetch tx by hash
   - if selector is `getReward(uint256)` and arg tokenId matches row => attributed
   - otherwise ambiguous
5. `emissionsRaw = pendingDelta + realizedAttributed`
6. Convert to USD with reward token price
7. If any ambiguous realized amount exists:
   - `metricsQuality = partial`
   - `metricsReason = partial_ambiguous_claim`
   else full.

### 11.2 PancakeSwap V3
Only valid if `adapterType == pancake_masterchef`, else partial-unclassified.

1. Pending delta:
   - `pendingNow = pendingCake(tokenId)` at latest
   - `pendingStart = pendingCake(tokenId)` at fromBlock
   - `pendingDelta = max(pendingNow - pendingStart, 0)`
2. Reward token:
   - try `CAKE()`, then `cake()`, else fallback constant CAKE address
3. Realized in-window reward transfers:
   - query ERC20 transfers:
     - `fromAddress = masterchef`
     - `toAddress = vfat`
     - reward token only
4. Attribution by tx input:
   - if selector `harvest(uint256,address)` and tokenId arg matches => attributed
   - else ambiguous
5. `emissionsRaw = pendingDelta + realizedAttributed`
6. Convert to USD
7. Ambiguous realized amount => partial_ambiguous_claim

### 11.3 Uniswap V3
- Emissions not applicable:
  - `emissions24hUsd = 0`
  - metrics full

### 11.4 Aerodrome V2 gauge LP
For each active V2 row:
1. Determine staked LP amount:
   - `stake = gauge.balanceOf(vfat)`
2. Value current deposit from LP share:
   - `pool = gauge.stakingToken()`
   - read pool reserves + total supply
   - `amount0Raw = stake * reserve0 / totalSupply`
   - `amount1Raw = stake * reserve1 / totalSupply`
   - convert to USD by token prices => `currentPoolUsd`
3. Fees policy:
   - `fees24hUsd = 0`
4. Emissions:
   - `pendingNow = gauge.earned(vfat)` at latest
   - `pendingStart = gauge.earned(vfat)` at fromBlock
   - `pendingDelta = max(pendingNow - pendingStart, 0)`
   - realized transfers in window:
     - ERC20 transfers with `fromAddress = gauge`, `toAddress = vfat`, `contract = rewardToken`
   - `emissionsRaw = pendingDelta + realized`
   - convert to USD with reward token price
5. Claimable now:
   - `vfatClaimableNowUsd = pendingNowUsd` (emissions only)
6. APR:
   - `apr24hPct = (emissions24hUsd / currentPoolUsd) * 365 * 100` when denominator > 0
7. Range fields:
   - `poolTickLower`, `poolTickUpper`, `poolRange*`, `poolCurrentPrice`, `vfatInRange` are `null`
8. Quality:
   - if reward price missing or required call fails, keep row with `metricsReason = partial_call_failed`

### Step 12: Current deposited USD denominator
Compute from **current liquidity composition**, not historical notional:

1. `sqrtLowerX96 = getSqrtRatioAtTick(tickLower)`
2. `sqrtUpperX96 = getSqrtRatioAtTick(tickUpper)`
3. `sqrtPriceX96 = slot0.sqrtPriceX96` (latest snapshot)
4. Use `getAmountsForLiquidity` (Section 8.2) to get `amount0Raw`, `amount1Raw`
5. Normalize by decimals and multiply by current token USD prices
6. `currentPoolUsd = amount0 * price0 + amount1 * price1`

### Step 13: APR
Protocol-effective numerator:
- `feeContribution = fees24hUsd` (except Aerodrome forced zero)
- `emissionContribution = emissions24hUsd` if finite else `0`

Formula:

`APR_24h_annualized_pct = ((feeContribution + emissionContribution) / currentPoolUsd) * 365 * 100`

If `currentPoolUsd <= 0` or missing => `APR = n/a`.

## 8. Exact math details

### 8.1 Tick -> price
Price shown is token1 per token0:

`price = (1.0001 ^ tick) * 10^(token0Decimals - token1Decimals)`

### 8.1.1 Tick -> sqrt ratio implementation requirement
For `getSqrtRatioAtTick`, port Uniswap `TickMath.getSqrtRatioAtTick` exactly:
- tick bounds must be `-887272 <= tick <= 887272`
- same fixed-point constants and bit-step multiplication flow
- for positive ticks, invert with `MaxUint256 / ratio`
- same rounding-up behavior at the Q128.128 -> Q64.96 conversion:
  - `result = ratio >> 32`
  - if `(ratio & ((1 << 32) - 1)) != 0`, return `result + 1`, else `result`

### 8.2 Liquidity -> token amounts
Let:
- `sqrtP = sqrtPriceX96`
- `sqrtA = sqrtRatioAX96`
- `sqrtB = sqrtRatioBX96`
- enforce `sqrtA <= sqrtB`
- `L = liquidity`

If `sqrtP <= sqrtA`:
- `amount0 = ((L * (sqrtB - sqrtA)) * Q96) / sqrtB / sqrtA`
- `amount1 = 0`

Else if `sqrtA < sqrtP < sqrtB`:
- `amount0 = ((L * (sqrtB - sqrtP)) * Q96) / sqrtB / sqrtP`
- `amount1 = (L * (sqrtP - sqrtA)) / Q96`

Else (`sqrtP >= sqrtB`):
- `amount0 = 0`
- `amount1 = (L * (sqrtB - sqrtA)) / Q96`

All integer math uses bigint floor division.

### 8.3 Claimable fees from fee-growth
Use Uniswap-style in-range fee growth:

`subIn256(a,b) = a-b if a>=b else (MaxUint256 - (b-a)) + 1`

Given:
- `fg0`, `fg1` = feeGrowthGlobal
- `foL0`, `foL1` = feeGrowthOutside at lower tick
- `foU0`, `foU1` = feeGrowthOutside at upper tick
- `tickCurrent`, `tickLower`, `tickUpper`
- position fields:
  - `liquidity`
  - `feeGrowthInside{0,1}LastX128`
  - `tokensOwed{0,1}`

Compute:
- `feeGrowthBelow0 = (tickCurrent >= tickLower) ? foL0 : subIn256(fg0, foL0)`
- `feeGrowthBelow1 = (tickCurrent >= tickLower) ? foL1 : subIn256(fg1, foL1)`
- `feeGrowthAbove0 = (tickCurrent < tickUpper) ? foU0 : subIn256(fg0, foU0)`
- `feeGrowthAbove1 = (tickCurrent < tickUpper) ? foU1 : subIn256(fg1, foU1)`
- `inside0 = subIn256(subIn256(fg0, feeGrowthBelow0), feeGrowthAbove0)`
- `inside1 = subIn256(subIn256(fg1, feeGrowthBelow1), feeGrowthAbove1)`
- `pending0 = tokensOwed0 + (liquidity * subIn256(inside0, feeGrowthInside0LastX128)) / Q128`
- `pending1 = tokensOwed1 + (liquidity * subIn256(inside1, feeGrowthInside1LastX128)) / Q128`

## 8.4 24h deltas
For both fees and emissions pending components:

`delta = max(pending_now - pending_24h_start, 0)`

Never allow negative contribution.

## 9. Failure and quality semantics (do not deviate)
- Any required onchain read failure for a metrics path -> `metricsReason = partial_call_failed`
- Owner adapter not recognized for protocol -> `partial_unclassified`
- Reward transfer seen but cannot be tokenId-attributed -> `partial_ambiguous_claim`
- Full success and deterministic attribution -> `full`

Rendering semantics:
- `emissions24hUsd` missing/unavailable -> display `n/a` (not fabricated zero)
- Keep rows visible even when partial

## 10. Formatting and sorting semantics
- Fees and emissions: USD with exactly 3 decimals
- Total deposited: USD with 2 decimals
- APR: 2 decimal percent
- Sort rows by `currentPoolUsd` descending, missing values last

## 11. Pagination/dedup rules
- All `alchemy_getAssetTransfers` calls must page until `pageKey` is absent
- Dedupe CL transfer rows by stable unique transfer id (or fallback composite key)
- Dedupe collect logs by `(transactionHash, logIndex)`
- Dedupe deployment tx hashes and deployed contract addresses

## 12. Pseudocode (reference implementation shape)
```text
input wallet, alchemyKey
direct = findDirectlyDeployedContracts(wallet)
factory = findFactoryDeployedContracts(wallet)
deployed = dedupe(direct + factory)
vfats = identifyVFatContracts(deployed)

history = []
for each vfat in vfats:
  history += fetchClTransfersForVfatContract(vfat)

currentCandidates = latest-per-token(history) excluding zero-owner
active = liveValidateOwnerAndLiquidity(currentCandidates)
for each row in active:
  row.adapterType = classifyOwnerAdapter(row.currentOwner, row.protocol)

window = resolve24hBlockWindow()
for each row in active:
  fees = computeFees24h(row, window)
  emissions = computeEmissions24h(row, window, adapterType)
  usdDenom = computeCurrentPoolUsd(row)
  apr = annualize((fees.protocolAdjusted + emissions), usdDenom)
  attach row metrics + quality reason

rows = sort by currentPoolUsd desc
render rows
```

## 13. Acceptance checklist
- Wallet `0x4ac9b6795a2dfb386ad6ac2aa5a4b717aa8cc8e4` should produce the same active CL set as this repo.
- Aerodrome rows:
  - fee contribution is always 0 in APR numerator
  - emissions path is gauge-native
- Pancake rows:
  - both fee and emissions paths active
- Uniswap rows:
  - emissions fixed at zero/not applicable
- APR uses denominator = current deposited USD from live liquidity composition.
- Rows ordered by total deposited descending.
