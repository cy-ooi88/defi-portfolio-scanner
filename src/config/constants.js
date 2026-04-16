const { ethers } = window;

export const CHAIN_SEQUENCE = ["base", "bsc"];
export const BSC_CONSTANTS_PATH = "./bsc_vfat_constants.json";
export const CHAIN_CONFIGS = {
  base: {
    key: "base",
    chainId: 8453,
    chainName: "Base",
    rpcNetwork: "base-mainnet",
    priceNetwork: "base-mainnet",
    standardPositionManagerAddress: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
    enableAerodromeV2Paths: true,
    sickleFactoryAllowlist: ["0x71d234a3e1dfc161cc1d081e6496e76627baac31"],
    vfatImplementationAllowlist: ["0xfff75d099baee29f447866bc5299cd67c04761c8"],
    clPositionManagers: [
      { protocol: "Aerodrome SlipStream", address: "0x827922686190790b37229fd06084350e74485b72" },
      { protocol: "PancakeSwap V3", address: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364" },
      { protocol: "Uniswap V3", address: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1" }
    ]
  },
  bsc: {
    key: "bsc",
    chainId: 56,
    chainName: "BSC",
    rpcNetwork: "bnb-mainnet",
    priceNetwork: "bnb-mainnet",
    standardPositionManagerAddress: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364",
    enableAerodromeV2Paths: false,
    sickleFactoryAllowlist: [
      "0x53d9780dbd3831e3a797fd215be4131636cd5fdf",
      "0x71d234a3e1dfc161cc1d081e6496e76627baac31"
    ],
    vfatImplementationAllowlist: [
      "0x7f4b6f10c34470ebddf5e7ab049d8dffb01f8a6f",
      "0xfff75d099baee29f447866bc5299cd67c04761c8"
    ],
    clPositionManagers: [
      { protocol: "PancakeSwap V3", address: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364" },
      { protocol: "Uniswap V3", address: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1" }
    ]
  }
};

export const AERODROME_VOTER_ADDRESS = "0x16613524e02ad97edfef371bc883f2f5d6c480a5";
export const AERODROME_V2_PAIR_FACTORY_ADDRESS = "0x420dd381b31aef6683db6b902084cb0ffece40da";
export const AERODROME_V2_PROTOCOL = "Aerodrome V2";
export const Q96 = 2n ** 96n;
export const Q128 = 2n ** 128n;
export const MaxUint256 = (2n ** 256n) - 1n;
export const ZeroAddress = "0x0000000000000000000000000000000000000000";
export const SECONDS_PER_DAY = 24 * 60 * 60;
export const PRICE_API_BASE = "https://api.g.alchemy.com/prices/v1";
export const EIP1167_PREFIX = "363d3d373d3d3d363d73";
export const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";
export const SICKLE_DEPLOY_EVENT_TOPIC = "0xb1a29087760d8e8f9b263f598962f752e7bd23badd44897e2966d376d1a59dca";
export const COLLECT_EVENT_TOPICS = [
  ethers.id("Collect(uint256,address,uint256,uint256)"),
  ethers.id("Collect(uint256,address,uint128,uint128)")
];

export const SLOT0_SELECTOR = "0x3850c7bd";
export const EARNED_SELECTOR = "0x3e491d47";
export const REWARD_TOKEN_SELECTOR = "0xf7c618c1";
export const GET_REWARD_BY_TOKEN_SELECTOR = "0x1c4b774b";
export const GET_REWARD_BY_ACCOUNT_SELECTOR = "0xc00007b0";
export const ACCOUNT_WIDE_CLAIM_SELECTORS = new Set([
  GET_REWARD_BY_ACCOUNT_SELECTOR,
  "0xcef6d209",
  "0x16fbdebe"
]);
export const HARVEST_BY_TOKEN_SELECTOR = "0x18fccc76";
export const PENDING_CAKE_SELECTOR = "0xce5f39c6";
export const CAKE_SELECTOR = "0x4ca6ef28";
export const CAKE_LOWER_SELECTOR = "0xdce17484";
export const PANCAKE_CAKE_TOKEN = "0x3055913c90fcc1a6ce9a358911721eeb942013a1";
export const FEE_GROWTH_GLOBAL0_SELECTOR = "0xf3058399";
export const FEE_GROWTH_GLOBAL1_SELECTOR = "0x46141319";
export const TICKS_SELECTOR = "0xf30dba93";

export const CL_PROTOCOL_ADAPTERS = {
  "Uniswap V3": {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "none"
  },
  "Aerodrome SlipStream": {
    feesMode: "none",
    emissionsMode: "pending_delta_plus_realized"
  },
  "PancakeSwap V3": {
    feesMode: "realized_plus_pending_delta",
    emissionsMode: "pending_delta_plus_realized"
  }
};

export const NFPM_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
];

export const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
];
export const FACTORY_INT24_ABI = [
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address pool)"
];
export const POSITION_MANAGER_ABI = [
  "function factory() view returns (address)"
];
export const AERODROME_VOTER_ABI = [
  "function isGauge(address target) view returns (bool)"
];
export const AERODROME_V2_GAUGE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function earned(address account) view returns (uint256)"
];
export const AERODROME_V2_POOL_ABI = [
  "function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)",
  "function totalSupply() view returns (uint256)",
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function stable() view returns (bool)"
];
export const AERODROME_V2_FACTORY_ABI = [
  "function isPool(address pool) view returns (bool)",
  "function getFee(address pool, bool stable) view returns (uint256)"
];

export const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)"
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
];

export const STORAGE_KEYS = {
  wallet: "defi_scanner_wallet",
  alchemyKey: "defi_scanner_alchemy_key",
  vfatContractsCache: "defi_scanner_vfat_contract_cache_v1"
};
export const ACCOUNT_BADGE_SIZE = 56;
export const JAZZICON_MODULE_URL = "https://cdn.jsdelivr.net/npm/@metamask/jazzicon@2.0.0/+esm";
export const VFAT_CONTRACT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const RPC_MAX_RETRIES = 3;
export const PRICE_MAX_RETRIES = 2;
export const RETRY_BASE_MS = 220;
export const TRACE_MAX_FIELD_CHARS = 24000;
export const TRACE_MAX_ENTRIES = 20000;
