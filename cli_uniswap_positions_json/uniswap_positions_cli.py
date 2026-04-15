#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
from web3 import Web3

Q96 = 1 << 96
Q128 = 1 << 128
MAX_UINT256 = (1 << 256) - 1
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
CHAIN_SEQUENCE = ["base", "bsc"]
EIP1167_PREFIX = "363d3d373d3d3d363d73"
EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3"
SICKLE_DEPLOY_EVENT_TOPIC = "0xb1a29087760d8e8f9b263f598962f752e7bd23badd44897e2966d376d1a59dca"
SLOT0_SELECTOR = "0x3850c7bd"
FEE_GROWTH_GLOBAL0_SELECTOR = "0xf3058399"
FEE_GROWTH_GLOBAL1_SELECTOR = "0x46141319"
TICKS_SELECTOR = "0xf30dba93"
AERODROME_VOTER_ADDRESS = "0x16613524e02ad97edfef371bc883f2f5d6c480a5"
AERODROME_V2_PAIR_FACTORY_ADDRESS = "0x420dd381b31aef6683db6b902084cb0ffece40da"
AERODROME_V2_PROTOCOL = "Aerodrome V2"
SECONDS_PER_DAY = 24 * 60 * 60
COLLECT_EVENT_TOPICS = [
    "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01",  # Collect(uint256,address,uint256,uint256)
    "0x4d8babf9b22e68d8f3c8653392a91073d3f3d246ad70593d8c8ed3fe381b3c96",  # Collect(uint256,address,uint128,uint128)
]
EARNED_SELECTOR = "0x3e491d47"  # earned(address,uint256)
REWARD_TOKEN_SELECTOR = "0xf7c618c1"  # rewardToken()
GET_REWARD_BY_TOKEN_SELECTOR = "0x1c4b774b"  # getReward(uint256)
GET_REWARD_BY_ACCOUNT_SELECTOR = "0xc00007b0"  # getReward(address)
ACCOUNT_WIDE_CLAIM_SELECTORS = {
    GET_REWARD_BY_ACCOUNT_SELECTOR,
    "0xcef6d209",  # observed blanket-claim route
    "0x16fbdebe",  # observed claim+conversion route
}
HARVEST_BY_TOKEN_SELECTOR = "0x18fccc76"  # harvest(uint256,address)
PENDING_CAKE_SELECTOR = "0xce5f39c6"  # pendingCake(uint256)
CAKE_SELECTOR = "0x4ca6ef28"  # CAKE()
CAKE_LOWER_SELECTOR = "0xdce17484"  # cake()
PANCAKE_CAKE_TOKEN = "0x3055913c90fcc1a6ce9a358911721eeb942013a1"
POSITIONS_SELECTOR = "0x99fbab88"  # positions(uint256)
RETRY_BASE_MS = 220

CHAIN_CONFIGS: dict[str, dict[str, Any]] = {
    "base": {
        "key": "base",
        "chainName": "Base",
        "rpcNetwork": "base-mainnet",
        "priceNetwork": "base-mainnet",
        "enableAerodromeV2Paths": True,
        "sickleFactoryAllowlist": ["0x71d234a3e1dfc161cc1d081e6496e76627baac31"],
        "vfatImplementationAllowlist": ["0xfff75d099baee29f447866bc5299cd67c04761c8"],
        "clPositionManagers": [
            {"protocol": "Aerodrome SlipStream", "address": "0x827922686190790b37229fd06084350e74485b72"},
            {"protocol": "PancakeSwap V3", "address": "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364"},
            {"protocol": "Uniswap V3", "address": "0x03a520b32c04bf3beef7beb72e919cf822ed34f1"},
        ],
    },
    "bsc": {
        "key": "bsc",
        "chainName": "BSC",
        "rpcNetwork": "bnb-mainnet",
        "priceNetwork": "bnb-mainnet",
        "enableAerodromeV2Paths": False,
        "sickleFactoryAllowlist": [
            "0x53d9780dbd3831e3a797fd215be4131636cd5fdf",
            "0x71d234a3e1dfc161cc1d081e6496e76627baac31",
        ],
        "vfatImplementationAllowlist": [
            "0x7f4b6f10c34470ebddf5e7ab049d8dffb01f8a6f",
            "0xfff75d099baee29f447866bc5299cd67c04761c8",
        ],
        "clPositionManagers": [
            {"protocol": "PancakeSwap V3", "address": "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364"},
            {"protocol": "Uniswap V3", "address": "0x03a520b32c04bf3beef7beb72e919cf822ed34f1"},
        ],
    },
}
CL_PROTOCOL_ADAPTERS: dict[str, dict[str, str]] = {
    "Uniswap V3": {"feesMode": "realized_plus_pending_delta", "emissionsMode": "none"},
    "Aerodrome SlipStream": {"feesMode": "none", "emissionsMode": "pending_delta_plus_realized"},
    "PancakeSwap V3": {"feesMode": "realized_plus_pending_delta", "emissionsMode": "pending_delta_plus_realized"},
}

NFPM_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "owner", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "tokenOfOwnerByIndex", "type": "function", "stateMutability": "view", "inputs": [{"name": "owner", "type": "address"}, {"name": "index", "type": "uint256"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "ownerOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "tokenId", "type": "uint256"}], "outputs": [{"name": "", "type": "address"}]},
    {"name": "positions", "type": "function", "stateMutability": "view", "inputs": [{"name": "tokenId", "type": "uint256"}], "outputs": [{"name": "nonce", "type": "uint96"}, {"name": "operator", "type": "address"}, {"name": "token0", "type": "address"}, {"name": "token1", "type": "address"}, {"name": "fee", "type": "uint24"}, {"name": "tickLower", "type": "int24"}, {"name": "tickUpper", "type": "int24"}, {"name": "liquidity", "type": "uint128"}, {"name": "feeGrowthInside0LastX128", "type": "uint256"}, {"name": "feeGrowthInside1LastX128", "type": "uint256"}, {"name": "tokensOwed0", "type": "uint128"}, {"name": "tokensOwed1", "type": "uint128"}]},
]
POS_MANAGER_ABI = [{"name": "factory", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]}]
FACTORY_ABI = [{"name": "getPool", "type": "function", "stateMutability": "view", "inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}, {"name": "fee", "type": "uint24"}], "outputs": [{"name": "pool", "type": "address"}]}]
FACTORY_INT24_ABI = [{"name": "getPool", "type": "function", "stateMutability": "view", "inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}, {"name": "tickSpacing", "type": "int24"}], "outputs": [{"name": "pool", "type": "address"}]}]
POOL_ABI = [
    {"name": "slot0", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "sqrtPriceX96", "type": "uint160"}, {"name": "tick", "type": "int24"}, {"name": "", "type": "uint16"}, {"name": "", "type": "uint16"}, {"name": "", "type": "uint16"}, {"name": "", "type": "uint8"}, {"name": "", "type": "bool"}]},
    {"name": "feeGrowthGlobal0X128", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "feeGrowthGlobal1X128", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "ticks", "type": "function", "stateMutability": "view", "inputs": [{"name": "tick", "type": "int24"}], "outputs": [{"name": "", "type": "uint128"}, {"name": "", "type": "int128"}, {"name": "feeGrowthOutside0X128", "type": "uint256"}, {"name": "feeGrowthOutside1X128", "type": "uint256"}, {"name": "", "type": "int56"}, {"name": "", "type": "uint160"}, {"name": "", "type": "uint32"}, {"name": "", "type": "bool"}]},
]
ERC20_ABI = [
    {"name": "symbol", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]
VOTER_ABI = [{"name": "isGauge", "type": "function", "stateMutability": "view", "inputs": [{"name": "target", "type": "address"}], "outputs": [{"name": "", "type": "bool"}]}]
AERODROME_V2_GAUGE_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "stakingToken", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]},
    {"name": "rewardToken", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]},
    {"name": "earned", "type": "function", "stateMutability": "view", "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]
AERODROME_V2_POOL_ABI = [
    {"name": "metadata", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "dec0", "type": "uint256"}, {"name": "dec1", "type": "uint256"}, {"name": "r0", "type": "uint256"}, {"name": "r1", "type": "uint256"}, {"name": "st", "type": "bool"}, {"name": "t0", "type": "address"}, {"name": "t1", "type": "address"}]},
    {"name": "totalSupply", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "reserve0", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "reserve1", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "token0", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]},
    {"name": "token1", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]},
    {"name": "stable", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "bool"}]},
]
AERODROME_V2_FACTORY_ABI = [
    {"name": "isPool", "type": "function", "stateMutability": "view", "inputs": [{"name": "pool", "type": "address"}], "outputs": [{"name": "", "type": "bool"}]},
    {"name": "getFee", "type": "function", "stateMutability": "view", "inputs": [{"name": "pool", "type": "address"}, {"name": "stable", "type": "bool"}], "outputs": [{"name": "", "type": "uint256"}]},
]


def csum(addr: str) -> str:
    return Web3.to_checksum_address(addr)


def norm_token_hex(token_hex: str) -> str:
    try:
        return hex(int(token_hex, 16))
    except Exception:
        return token_hex.lower()


def token_id_decimal(token_hex: str) -> str:
    try:
        return str(int(token_hex, 16))
    except Exception:
        return token_hex


def parse_eip1167_implementation(code_hex: str | None) -> str | None:
    if not code_hex or code_hex == "0x":
        return None
    code = code_hex[2:].lower() if code_hex.startswith("0x") else code_hex.lower()
    expected = len(EIP1167_PREFIX) + 40 + len(EIP1167_SUFFIX)
    if len(code) != expected:
        return None
    if not code.startswith(EIP1167_PREFIX) or not code.endswith(EIP1167_SUFFIX):
        return None
    return f"0x{code[len(EIP1167_PREFIX):len(EIP1167_PREFIX) + 40]}"


def topic_address(topic: str | None) -> str | None:
    if not topic or not isinstance(topic, str) or not topic.startswith("0x") or len(topic) < 66:
        return None
    return f"0x{topic[-40:]}"


def data_address(data: str | None) -> str | None:
    if not data or not isinstance(data, str) or not data.startswith("0x") or len(data) < 66:
        return None
    return f"0x{data[-40:]}"


def read_word(data_hex: str, index: int) -> str | None:
    if not data_hex or not isinstance(data_hex, str) or not data_hex.startswith("0x"):
        return None
    stripped = data_hex[2:]
    offset = index * 64
    if len(stripped) < offset + 64:
        return None
    return stripped[offset:offset + 64]


def parse_int24_word(word_hex: str | None) -> int | None:
    if not word_hex or len(word_hex) != 64:
        return None
    try:
        value = int(word_hex[58:], 16)
    except Exception:
        return None
    return value - 0x1000000 if value >= 0x800000 else value


def encode_int24_word(value: int) -> str:
    mx = 2 ** 23
    if value < -mx or value >= mx:
        raise ValueError(f"int24 out of range: {value}")
    enc = (2 ** 24) + value if value < 0 else value
    return hex(enc)[2:].rjust(64, "0")


def encode_address_word(address: str) -> str:
    return csum(address)[2:].lower().rjust(64, "0")


def pad_token_id_to_word(token_id_hex: str) -> str:
    return norm_token_hex(token_id_hex)[2:].rjust(64, "0")


def token_id_to_topic(token_id_hex: str) -> str:
    return "0x" + norm_token_hex(token_id_hex)[2:].rjust(64, "0")


def decode_uint256_call_result(result_hex: str | None) -> int:
    word = read_word(result_hex or "", 0)
    if not word:
        return 0
    try:
        return int(word, 16)
    except Exception:
        return 0


def decode_address_call_result(result_hex: str | None) -> str | None:
    word = read_word(result_hex or "", 0)
    if not word:
        return None
    try:
        return csum("0x" + word[-40:])
    except Exception:
        return None


def safe_positive(value: int) -> int:
    return value if value >= 0 else 0


def to_block_tag(value: int | str) -> str:
    if isinstance(value, int):
        return hex(value)
    return value


def parse_hex_to_int(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.startswith("0x"):
        try:
            return int(value, 16)
        except Exception:
            return 0
    return 0


def parse_tx_selector(input_data: str | None) -> str | None:
    if not input_data or not isinstance(input_data, str) or not input_data.startswith("0x") or len(input_data) < 10:
        return None
    return input_data[:10].lower()


def read_calldata_arg_word(input_data: str | None, arg_index: int) -> str | None:
    if not input_data or not isinstance(input_data, str) or not input_data.startswith("0x"):
        return None
    start = 10 + (arg_index * 64)
    end = start + 64
    if len(input_data) < end:
        return None
    return input_data[start:end]


def parse_transfer_raw_amount(transfer: dict[str, Any]) -> int:
    value = ((transfer.get("rawContract") or {}).get("value"))
    if isinstance(value, str) and value.startswith("0x"):
        try:
            return int(value, 16)
        except Exception:
            return 0
    return 0


def parse_collect_log_amounts(log: dict[str, Any]) -> tuple[int, int]:
    data = log.get("data")
    if not data or not isinstance(data, str) or not data.startswith("0x"):
        return 0, 0
    word_count = (len(data) - 2) // 64
    if word_count < 2:
        return 0, 0
    amount0_word = read_word(data, word_count - 2)
    amount1_word = read_word(data, word_count - 1)
    if not amount0_word or not amount1_word:
        return 0, 0
    try:
        return int(amount0_word, 16), int(amount1_word, 16)
    except Exception:
        return 0, 0


def parse_positions_snapshot(result_hex: str | None) -> dict[str, Any] | None:
    if not result_hex or not isinstance(result_hex, str) or not result_hex.startswith("0x"):
        return None
    data = result_hex[2:]
    if len(data) < 64 * 12:
        return None
    try:
        token0 = decode_address_call_result("0x" + data[(64 * 2):(64 * 3)])
        token1 = decode_address_call_result("0x" + data[(64 * 3):(64 * 4)])
        fee = int(data[(64 * 4):(64 * 5)], 16)
        tick_lower = parse_int24_word(data[(64 * 5):(64 * 6)])
        tick_upper = parse_int24_word(data[(64 * 6):(64 * 7)])
        if not token0 or not token1 or tick_lower is None or tick_upper is None:
            return None
        return {
            "token0": token0,
            "token1": token1,
            "fee": fee,
            "tickLower": tick_lower,
            "tickUpper": tick_upper,
            "liquidity": int(data[(64 * 7):(64 * 8)], 16),
            "feeGrowthInside0LastX128": int(data[(64 * 8):(64 * 9)], 16),
            "feeGrowthInside1LastX128": int(data[(64 * 9):(64 * 10)], 16),
            "tokensOwed0": int(data[(64 * 10):(64 * 11)], 16),
            "tokensOwed1": int(data[(64 * 11):(64 * 12)], 16),
        }
    except Exception:
        return None


def is_execution_reverted_na_error(error: Exception) -> bool:
    return "execution reverted: na" in str(error).lower()


def is_recent_position_activity_within_window(row: dict[str, Any], block_window: dict[str, Any] | None) -> bool:
    block_number = row.get("blockNumber")
    from_block = (block_window or {}).get("fromBlock")
    return (
        isinstance(block_number, int)
        and block_number > 0
        and isinstance(from_block, int)
        and block_number >= from_block
    )


def tick_to_price(tick: int, d0: int, d1: int) -> float | None:
    try:
        return math.pow(1.0001, tick) * math.pow(10, d0 - d1)
    except Exception:
        return None


def sub256(a: int, b: int) -> int:
    return a - b if a >= b else (MAX_UINT256 - (b - a)) + 1


def sqrt_ratio_at_tick(tick: int) -> int:
    if tick < -887272 or tick > 887272:
        raise ValueError("tick out of range")
    abs_tick = abs(tick)
    ratio = 0xFFFcb933BD6fAD37AA2D162D1A594001 if (abs_tick & 1) else 0x100000000000000000000000000000000
    if abs_tick & 0x2: ratio = (ratio * 0xFFF97272373D413259A46990580E213A) >> 128
    if abs_tick & 0x4: ratio = (ratio * 0xFFF2E50F5F656932EF12357CF3C7FDCC) >> 128
    if abs_tick & 0x8: ratio = (ratio * 0xFFE5CACA7E10E4E61C3624EAA0941CD0) >> 128
    if abs_tick & 0x10: ratio = (ratio * 0xFFCB9843D60F6159C9DB58835C926644) >> 128
    if abs_tick & 0x20: ratio = (ratio * 0xFF973B41FA98C081472E6896DFB254C0) >> 128
    if abs_tick & 0x40: ratio = (ratio * 0xFF2EA16466C96A3843EC78B326B52861) >> 128
    if abs_tick & 0x80: ratio = (ratio * 0xFE5DEE046A99A2A811C461F1969C3053) >> 128
    if abs_tick & 0x100: ratio = (ratio * 0xFCBE86C7900A88AEDCFFC83B479AA3A4) >> 128
    if abs_tick & 0x200: ratio = (ratio * 0xF987A7253AC413176F2B074CF7815E54) >> 128
    if abs_tick & 0x400: ratio = (ratio * 0xF3392B0822B70005940C7A398E4B70F3) >> 128
    if abs_tick & 0x800: ratio = (ratio * 0xE7159475A2C29B7443B29C7FA6E889D9) >> 128
    if abs_tick & 0x1000: ratio = (ratio * 0xD097F3BDFD2022B8845AD8F792AA5825) >> 128
    if abs_tick & 0x2000: ratio = (ratio * 0xA9F746462D870FDF8A65DC1F90E061E5) >> 128
    if abs_tick & 0x4000: ratio = (ratio * 0x70D869A156D2A1B890BB3DF62BAF32F7) >> 128
    if abs_tick & 0x8000: ratio = (ratio * 0x31BE135F97D08FD981231505542FCFA6) >> 128
    if abs_tick & 0x10000: ratio = (ratio * 0x09AA508B5B7A84E1C677DE54F3E99BC9) >> 128
    if abs_tick & 0x20000: ratio = (ratio * 0x5D6AF8DEDB81196699C329225EE604) >> 128
    if abs_tick & 0x40000: ratio = (ratio * 0x2216E584F5FA1EA926041BEDFE98) >> 128
    if abs_tick & 0x80000: ratio = (ratio * 0x48A170391F7DC42444E8FA2) >> 128
    if tick > 0:
        ratio = MAX_UINT256 // ratio
    out = ratio >> 32
    return out if (ratio & ((1 << 32) - 1)) == 0 else out + 1


def amounts_for_liq(sqrt_p: int, sqrt_a: int, sqrt_b: int, liq: int) -> tuple[int, int]:
    if sqrt_a > sqrt_b:
        sqrt_a, sqrt_b = sqrt_b, sqrt_a
    if sqrt_p <= sqrt_a:
        return ((liq * (sqrt_b - sqrt_a) * Q96) // sqrt_b // sqrt_a, 0)
    if sqrt_p < sqrt_b:
        a0 = (liq * (sqrt_b - sqrt_p) * Q96) // sqrt_b // sqrt_p
        a1 = (liq * (sqrt_p - sqrt_a)) // Q96
        return (a0, a1)
    return (0, (liq * (sqrt_b - sqrt_a)) // Q96)


def claimable(position: dict[str, int], slot0: Any, fg0: int, fg1: int, lower_tick: Any, upper_tick: Any) -> tuple[int, int]:
    tick_now = int(slot0[1])
    low = int(position["tickLower"])
    up = int(position["tickUpper"])
    liq = int(position["liquidity"])
    below0 = int(lower_tick[2]) if tick_now >= low else sub256(fg0, int(lower_tick[2]))
    below1 = int(lower_tick[3]) if tick_now >= low else sub256(fg1, int(lower_tick[3]))
    above0 = int(upper_tick[2]) if tick_now < up else sub256(fg0, int(upper_tick[2]))
    above1 = int(upper_tick[3]) if tick_now < up else sub256(fg1, int(upper_tick[3]))
    inside0 = sub256(sub256(fg0, below0), above0)
    inside1 = sub256(sub256(fg1, below1), above1)
    p0 = int(position["tokensOwed0"]) + (liq * sub256(inside0, int(position["feeGrowthInside0LastX128"])) // Q128)
    p1 = int(position["tokensOwed1"]) + (liq * sub256(inside1, int(position["feeGrowthInside1LastX128"])) // Q128)
    return p0, p1


@dataclass
class Cache:
    token: dict[str, dict[str, Any]] = field(default_factory=dict)
    price: dict[str, float | None] = field(default_factory=dict)
    factory: dict[str, str | None] = field(default_factory=dict)
    pool: dict[str, str | None] = field(default_factory=dict)


class Scanner:
    def __init__(self, api_key: str, project_root: Path, timeout: int):
        self.api_key = api_key
        self.project_root = project_root
        self.timeout = timeout
        self.http = requests.Session()
        self.bsc_overrides = self._load_bsc_overrides()
        self.owner_adapter_cache: dict[str, str] = {}
        self.gauge_reward_token_cache: dict[str, str | None] = {}
        self.tx_by_hash_cache: dict[str, dict[str, Any] | None] = {}
        self.block_header_cache: dict[str, dict[str, int]] = {}

    def _load_bsc_overrides(self) -> dict[str, Any] | None:
        p = self.project_root / "bsc_vfat_constants.json"
        if not p.exists():
            return None
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
        out = []
        seen = set()
        for item in j.get("clPositionManagers", []):
            try:
                addr = csum(item["address"])
            except Exception:
                continue
            if addr.lower() in seen:
                continue
            seen.add(addr.lower())
            out.append({"protocol": str(item.get("protocol") or "Unknown CL"), "address": addr})
        factories = []
        for value in j.get("sickleFactoryAllowlist", []):
            try:
                factories.append(csum(value))
            except Exception:
                continue
        impls = []
        for value in j.get("vfatImplementationAllowlist", []):
            try:
                impls.append(csum(value))
            except Exception:
                continue
        if not out and not factories and not impls:
            return None
        return {
            "clPositionManagers": out or None,
            "sickleFactoryAllowlist": factories or None,
            "vfatImplementationAllowlist": impls or None,
        }

    def _w3(self, chain: dict[str, Any]) -> Web3:
        return Web3(Web3.HTTPProvider(f"https://{chain['rpcNetwork']}.g.alchemy.com/v2/{self.api_key}", request_kwargs={"timeout": self.timeout}))

    def _rpc_url(self, chain: dict[str, Any]) -> str:
        return f"https://{chain['rpcNetwork']}.g.alchemy.com/v2/{self.api_key}"

    def _rpc_call(self, chain: dict[str, Any], method: str, params: list[Any]) -> Any:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        r = self.http.post(self._rpc_url(chain), json=payload, timeout=self.timeout)
        r.raise_for_status()
        body = r.json()
        if body.get("error"):
            raise RuntimeError(body["error"].get("message") or f"RPC error for {method}")
        if "result" not in body:
            raise RuntimeError(f"Malformed RPC response for {method}")
        return body["result"]

    def _rpc_eth_call(self, chain: dict[str, Any], to: str, data: str, block_tag: int | str = "latest") -> str:
        return self._rpc_call(
            chain,
            "eth_call",
            [{"to": csum(to), "data": data}, to_block_tag(block_tag)],
        )

    def _fetch_block_header(self, chain: dict[str, Any], block_tag: int | str = "latest") -> dict[str, int]:
        tag = to_block_tag(block_tag)
        cache_key = f"{chain['key']}:{tag}"
        cached = self.block_header_cache.get(cache_key)
        if cached:
            return cached
        block = self._rpc_call(chain, "eth_getBlockByNumber", [tag, False]) or {}
        number = parse_hex_to_int(block.get("number"))
        timestamp = parse_hex_to_int(block.get("timestamp"))
        if number <= 0 and tag != "0x0":
            raise RuntimeError(f"Missing block header for {tag}")
        header = {"number": number, "timestamp": timestamp}
        self.block_header_cache[cache_key] = header
        return header

    def _find_block_at_or_before_timestamp(self, chain: dict[str, Any], target_timestamp: int, latest_block_number: int) -> int:
        if target_timestamp <= 0:
            return 0
        low = 0
        high = latest_block_number
        candidate = 0
        while low <= high:
            mid = (low + high) // 2
            ts = self._fetch_block_header(chain, mid)["timestamp"]
            if ts <= target_timestamp:
                candidate = mid
                low = mid + 1
            else:
                high = mid - 1
        return candidate

    def _resolve_24h_block_window(self, chain: dict[str, Any]) -> dict[str, Any]:
        latest = self._fetch_block_header(chain, "latest")
        start_timestamp = max(0, int(latest["timestamp"]) - SECONDS_PER_DAY)
        from_block = self._find_block_at_or_before_timestamp(chain, start_timestamp, int(latest["number"]))
        return {
            "fromBlock": from_block,
            "toBlock": int(latest["number"]),
            "fromBlockTag": to_block_tag(from_block),
            "toBlockTag": to_block_tag(int(latest["number"])),
        }

    def _fetch_transaction_by_hash_cached(self, chain: dict[str, Any], tx_hash: str | None) -> dict[str, Any] | None:
        if not tx_hash:
            return None
        key = str(tx_hash).lower()
        if key in self.tx_by_hash_cache:
            return self.tx_by_hash_cache[key]
        try:
            tx = self._rpc_call(chain, "eth_getTransactionByHash", [tx_hash])
            self.tx_by_hash_cache[key] = tx or None
            return tx or None
        except Exception:
            self.tx_by_hash_cache[key] = None
            return None

    def _alchemy_get_transfers(self, chain: dict[str, Any], params: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page_key: str | None = None
        while True:
            q = dict(params)
            if page_key:
                q["pageKey"] = page_key
            result = self._rpc_call(chain, "alchemy_getAssetTransfers", [q]) or {}
            out.extend(result.get("transfers", []) or [])
            page_key = result.get("pageKey")
            if not page_key:
                break
        return out

    def _chain_cfg(self, chain_key: str) -> dict[str, Any]:
        c = dict(CHAIN_CONFIGS[chain_key])
        if chain_key == "bsc" and self.bsc_overrides:
            if self.bsc_overrides.get("clPositionManagers"):
                c["clPositionManagers"] = self.bsc_overrides["clPositionManagers"]
            if self.bsc_overrides.get("sickleFactoryAllowlist"):
                c["sickleFactoryAllowlist"] = self.bsc_overrides["sickleFactoryAllowlist"]
            if self.bsc_overrides.get("vfatImplementationAllowlist"):
                c["vfatImplementationAllowlist"] = self.bsc_overrides["vfatImplementationAllowlist"]
        return c

    def _token_meta(self, w3: Web3, cache: Cache, addr: str) -> dict[str, Any]:
        a = csum(addr)
        if a.lower() in cache.token:
            return cache.token[a.lower()]
        c = w3.eth.contract(address=a, abi=ERC20_ABI)
        sym = a[2:6].upper()
        dec = 18
        try: sym = c.functions.symbol().call()
        except Exception: pass
        try: dec = int(c.functions.decimals().call())
        except Exception: pass
        m = {"address": a, "symbol": sym, "decimals": dec}
        cache.token[a.lower()] = m
        return m

    def _prices(self, chain: dict[str, Any], cache: Cache, addresses: list[str]) -> dict[str, float | None]:
        addrs = [csum(a) for a in addresses]
        missing = [a for a in addrs if a.lower() not in cache.price]
        if missing:
            url = f"https://api.g.alchemy.com/prices/v1/{self.api_key}/tokens/by-address"
            body = {"addresses": [{"network": chain["priceNetwork"], "address": a} for a in missing]}
            r = self.http.post(url, json=body, timeout=self.timeout)
            r.raise_for_status()
            data = r.json().get("data", [])
            for item in data:
                try: a = csum(item["address"])
                except Exception: continue
                v = None
                for p in item.get("prices", []):
                    if str(p.get("currency", "")).lower() == "usd":
                        try: v = float(p.get("value"))
                        except Exception: v = None
                        break
                cache.price[a.lower()] = v
            for a in missing:
                cache.price.setdefault(a.lower(), None)
        return {a: cache.price.get(a.lower()) for a in addrs}

    def _factory(self, w3: Web3, cache: Cache, manager: str) -> str | None:
        m = csum(manager)
        if m.lower() in cache.factory:
            return cache.factory[m.lower()]
        try:
            c = w3.eth.contract(address=m, abi=POS_MANAGER_ABI)
            f = csum(c.functions.factory().call())
            out = None if f.lower() == ZERO_ADDRESS.lower() else f
        except Exception:
            out = None
        cache.factory[m.lower()] = out
        return out

    def _pool(self, w3: Web3, cache: Cache, manager: str, t0: str, t1: str, fee: int) -> str | None:
        m, a0, a1 = csum(manager), csum(t0), csum(t1)
        k = f"{m.lower()}:{a0.lower()}:{a1.lower()}:{fee}"
        if k in cache.pool:
            return cache.pool[k]
        f = self._factory(w3, cache, m)
        if not f:
            cache.pool[k] = None
            return None
        out = None
        for abi, x, y in [(FACTORY_ABI, a0, a1), (FACTORY_ABI, a1, a0), (FACTORY_INT24_ABI, a0, a1), (FACTORY_INT24_ABI, a1, a0)]:
            try:
                fc = w3.eth.contract(address=f, abi=abi)
                p = csum(fc.functions.getPool(x, y, fee).call())
                if p.lower() != ZERO_ADDRESS.lower():
                    out = p
                    break
            except Exception:
                continue
        cache.pool[k] = out
        return out

    @staticmethod
    def _eth_call_hex(w3: Web3, to: str, data: str) -> str:
        raw = w3.eth.call({"to": csum(to), "data": data})
        if isinstance(raw, (bytes, bytearray)):
            return "0x" + bytes(raw).hex()
        as_hex = getattr(raw, "hex", None)
        if callable(as_hex):
            value = as_hex()
            return value if str(value).startswith("0x") else f"0x{value}"
        value = str(raw)
        return value if value.startswith("0x") else f"0x{value}"

    def _fetch_position(self, w3: Web3, cache: Cache, chain_key: str, proto_by_mgr: dict[str, str], owner: str, token_id: int, manager: str) -> dict[str, Any]:
        m = csum(manager)
        c = w3.eth.contract(address=m, abi=NFPM_ABI)
        p = c.functions.positions(int(token_id)).call()
        pos = {"token0": csum(p[2]), "token1": csum(p[3]), "fee": int(p[4]), "tickLower": int(p[5]), "tickUpper": int(p[6]), "liquidity": int(p[7]), "feeGrowthInside0LastX128": int(p[8]), "feeGrowthInside1LastX128": int(p[9]), "tokensOwed0": int(p[10]), "tokensOwed1": int(p[11])}
        t0 = self._token_meta(w3, cache, pos["token0"])
        t1 = self._token_meta(w3, cache, pos["token1"])
        pool_addr = self._pool(w3, cache, m, pos["token0"], pos["token1"], pos["fee"])
        if not pool_addr:
            raise RuntimeError("pool not found")
        slot0_raw = self._eth_call_hex(w3, pool_addr, SLOT0_SELECTOR)
        sqrt_word = read_word(slot0_raw, 0)
        tick_word = read_word(slot0_raw, 1)
        if not sqrt_word or not tick_word:
            raise RuntimeError("invalid slot0")
        tick_current = parse_int24_word(tick_word)
        if tick_current is None:
            raise RuntimeError("invalid slot0 tick")
        sqrt_p = int(sqrt_word, 16)
        fg0_raw = self._eth_call_hex(w3, pool_addr, FEE_GROWTH_GLOBAL0_SELECTOR)
        fg1_raw = self._eth_call_hex(w3, pool_addr, FEE_GROWTH_GLOBAL1_SELECTOR)
        fg0_word = read_word(fg0_raw, 0)
        fg1_word = read_word(fg1_raw, 0)
        if not fg0_word or not fg1_word:
            raise RuntimeError("invalid fee growth")
        fg0 = int(fg0_word, 16)
        fg1 = int(fg1_word, 16)
        low_raw = self._eth_call_hex(w3, pool_addr, f"{TICKS_SELECTOR}{encode_int24_word(pos['tickLower'])}")
        up_raw = self._eth_call_hex(w3, pool_addr, f"{TICKS_SELECTOR}{encode_int24_word(pos['tickUpper'])}")
        low0 = read_word(low_raw, 2)
        low1 = read_word(low_raw, 3)
        up0 = read_word(up_raw, 2)
        up1 = read_word(up_raw, 3)
        if not low0 or not low1 or not up0 or not up1:
            raise RuntimeError("invalid ticks data")
        low_tick = [0, 0, int(low0, 16), int(low1, 16)]
        up_tick = [0, 0, int(up0, 16), int(up1, 16)]
        slot0 = [sqrt_p, tick_current]
        sqrt_a = sqrt_ratio_at_tick(pos["tickLower"])
        sqrt_b = sqrt_ratio_at_tick(pos["tickUpper"])
        amt0, amt1 = amounts_for_liq(sqrt_p, sqrt_a, sqrt_b, int(pos["liquidity"]))
        clm0, clm1 = claimable(pos, slot0, fg0, fg1, low_tick, up_tick)
        p0 = tick_to_price(tick_current, t0["decimals"], t1["decimals"])
        r0 = tick_to_price(pos["tickLower"], t0["decimals"], t1["decimals"])
        r1 = tick_to_price(pos["tickUpper"], t0["decimals"], t1["decimals"])
        return {
            "source": "standard",
            "positionType": "cl",
            "protocol": proto_by_mgr.get(m.lower(), "PancakeSwap V3"),
            "protocolDisplay": proto_by_mgr.get(m.lower(), "PancakeSwap V3"),
            "tokenContract": m,
            "tokenIdHex": norm_token_hex(hex(token_id)),
            "tokenIdDecimal": str(token_id),
            "tokenKey": f"wallet:{m.lower()}:{norm_token_hex(hex(token_id)).lower()}",
            "vfatContract": owner,
            "currentOwner": owner,
            "ownerScope": "external",
            "ownerCheck": "confirmed",
            "ownerResolved": owner.lower(),
            "liveLiquidity": str(pos["liquidity"]),
            "adapterType": "direct_owner",
            "poolPair": f"{t0['symbol']}/{t1['symbol']}",
            "poolFee": pos["fee"],
            "poolToken0": t0["address"],
            "poolToken1": t1["address"],
            "poolTickLower": pos["tickLower"],
            "poolTickUpper": pos["tickUpper"],
            "poolStable": None,
            "poolRangeLowerPrice": r0,
            "poolRangeUpperPrice": r1,
            "poolCurrentPrice": p0,
            "currentPoolUsd": None,
            "fees24hToken0": None,
            "fees24hToken1": None,
            "fees24hUsd": None,
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "vfatFeesClaimableNowUsd": None,
            "vfatEmissionsClaimableNowUsd": 0,
            "vfatClaimableNowUsd": None,
            "vfatInRange": bool(pos["tickLower"] <= tick_current < pos["tickUpper"]),
            "apr24hPct": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_python_cli_no_24h",
            "_v": {"pooled0": amt0, "pooled1": amt1, "claimable0": clm0, "claimable1": clm1, "d0": t0["decimals"], "d1": t1["decimals"], "a0": t0["address"], "a1": t1["address"], "chainKey": chain_key},
        }

    def _enrich_prices(self, chain: dict[str, Any], cache: Cache, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        addrs = sorted({row["_v"]["a0"] for row in rows} | {row["_v"]["a1"] for row in rows})
        prices = self._prices(chain, cache, addrs) if addrs else {}
        out = []
        for row in rows:
            v = row.pop("_v")
            p0 = prices.get(v["a0"]) or 0
            p1 = prices.get(v["a1"]) or 0
            pooled0 = float(v["pooled0"]) / float(10 ** v["d0"])
            pooled1 = float(v["pooled1"]) / float(10 ** v["d1"])
            claim0 = float(v["claimable0"]) / float(10 ** v["d0"])
            claim1 = float(v["claimable1"]) / float(10 ** v["d1"])
            row["currentPoolUsd"] = (pooled0 * p0) + (pooled1 * p1)
            claimable_fees_now = (claim0 * p0) + (claim1 * p1)
            protocol_name = str(row.get("protocol") or "")
            if protocol_name == "Aerodrome SlipStream":
                # Match webapp adapter behavior: SlipStream fees are not directly claimable as LP fees.
                row["vfatFeesClaimableNowUsd"] = 0.0
                row["vfatClaimableNowUsd"] = 0.0
            else:
                row["vfatFeesClaimableNowUsd"] = claimable_fees_now
                row["vfatClaimableNowUsd"] = claimable_fees_now
            row["chainKey"] = v["chainKey"]
            out.append(row)
        out.sort(key=lambda x: x["currentPoolUsd"] if isinstance(x.get("currentPoolUsd"), (int, float)) else -float("inf"), reverse=True)
        return out

    @staticmethod
    def _parse_slot0_from_eth_call(raw_result: str | None) -> dict[str, int] | None:
        if not raw_result or not isinstance(raw_result, str) or not raw_result.startswith("0x"):
            return None
        sqrt_word = read_word(raw_result, 0)
        tick_word = read_word(raw_result, 1)
        if not sqrt_word or not tick_word:
            return None
        tick = parse_int24_word(tick_word)
        if tick is None:
            return None
        try:
            return {"sqrtPriceX96": int(sqrt_word, 16), "tick": int(tick)}
        except Exception:
            return None

    def _fetch_pool_state_at_block(
        self, chain: dict[str, Any], pool_address: str, tick_lower: int, tick_upper: int, block_tag: int | str
    ) -> dict[str, Any] | None:
        try:
            slot0_raw = self._rpc_eth_call(chain, pool_address, SLOT0_SELECTOR, block_tag)
            fg0_raw = self._rpc_eth_call(chain, pool_address, FEE_GROWTH_GLOBAL0_SELECTOR, block_tag)
            fg1_raw = self._rpc_eth_call(chain, pool_address, FEE_GROWTH_GLOBAL1_SELECTOR, block_tag)
            low_raw = self._rpc_eth_call(chain, pool_address, f"{TICKS_SELECTOR}{encode_int24_word(tick_lower)}", block_tag)
            up_raw = self._rpc_eth_call(chain, pool_address, f"{TICKS_SELECTOR}{encode_int24_word(tick_upper)}", block_tag)
            slot0 = self._parse_slot0_from_eth_call(slot0_raw)
            fg0_word = read_word(fg0_raw, 0)
            fg1_word = read_word(fg1_raw, 0)
            low0 = read_word(low_raw, 2)
            low1 = read_word(low_raw, 3)
            up0 = read_word(up_raw, 2)
            up1 = read_word(up_raw, 3)
            if not slot0 or not fg0_word or not fg1_word or not low0 or not low1 or not up0 or not up1:
                return None
            return {
                "slot0": slot0,
                "feeGrowthGlobal0": int(fg0_word, 16),
                "feeGrowthGlobal1": int(fg1_word, 16),
                "lowerTick": {
                    "feeGrowthOutside0X128": int(low0, 16),
                    "feeGrowthOutside1X128": int(low1, 16),
                },
                "upperTick": {
                    "feeGrowthOutside0X128": int(up0, 16),
                    "feeGrowthOutside1X128": int(up1, 16),
                },
            }
        except Exception:
            return None

    def _fetch_claimable_snapshot_at_block(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_tag: int | str,
    ) -> dict[str, Any] | None:
        try:
            token_word = pad_token_id_to_word(str(row.get("tokenIdHex") or "0x0"))
            positions_raw = self._rpc_eth_call(chain, row["tokenContract"], f"{POSITIONS_SELECTOR}{token_word}", block_tag)
            position = parse_positions_snapshot(positions_raw)
            if not position:
                return None
            pool_address = self._pool(w3, cache, row["tokenContract"], position["token0"], position["token1"], int(position["fee"]))
            if not pool_address:
                return None
            pool_state = self._fetch_pool_state_at_block(
                chain,
                pool_address,
                int(position["tickLower"]),
                int(position["tickUpper"]),
                block_tag,
            )
            if not pool_state:
                return None
            claimable0, claimable1 = claimable(
                position,
                [int(pool_state["slot0"]["sqrtPriceX96"]), int(pool_state["slot0"]["tick"])],
                int(pool_state["feeGrowthGlobal0"]),
                int(pool_state["feeGrowthGlobal1"]),
                [0, 0, int(pool_state["lowerTick"]["feeGrowthOutside0X128"]), int(pool_state["lowerTick"]["feeGrowthOutside1X128"])],
                [0, 0, int(pool_state["upperTick"]["feeGrowthOutside0X128"]), int(pool_state["upperTick"]["feeGrowthOutside1X128"])],
            )
            return {
                "position": position,
                "poolAddress": pool_address,
                "poolState": pool_state,
                "claimable": {"amount0": int(claimable0), "amount1": int(claimable1)},
            }
        except Exception:
            return None

    def _calculate_current_pool_usd(
        self, chain: dict[str, Any], w3: Web3, cache: Cache, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        position = snapshot.get("position") or {}
        pool_state = snapshot.get("poolState") or {}
        slot0 = pool_state.get("slot0") or {}
        if not position or not slot0.get("sqrtPriceX96"):
            return {"currentPoolUsd": None, "token0Meta": None, "token1Meta": None, "prices": None}
        token0_meta = self._token_meta(w3, cache, position["token0"])
        token1_meta = self._token_meta(w3, cache, position["token1"])
        prices = self._prices(chain, cache, [token0_meta["address"], token1_meta["address"]])
        sqrt_lower = sqrt_ratio_at_tick(int(position["tickLower"]))
        sqrt_upper = sqrt_ratio_at_tick(int(position["tickUpper"]))
        pooled0_raw, pooled1_raw = amounts_for_liq(
            int(slot0["sqrtPriceX96"]),
            sqrt_lower,
            sqrt_upper,
            int(position["liquidity"]),
        )
        pooled0 = float(pooled0_raw) / float(10 ** int(token0_meta["decimals"]))
        pooled1 = float(pooled1_raw) / float(10 ** int(token1_meta["decimals"]))
        price0 = prices.get(token0_meta["address"]) or 0
        price1 = prices.get(token1_meta["address"]) or 0
        current_pool_usd = (pooled0 * float(price0) if isinstance(price0, (int, float)) else 0.0) + (
            pooled1 * float(price1) if isinstance(price1, (int, float)) else 0.0
        )
        return {
            "currentPoolUsd": current_pool_usd if math.isfinite(current_pool_usd) else None,
            "token0Meta": token0_meta,
            "token1Meta": token1_meta,
            "prices": prices,
        }

    def _fetch_collect_amounts_24h(
        self, chain: dict[str, Any], row: dict[str, Any], block_window: dict[str, Any]
    ) -> tuple[int, int]:
        from_block = block_window.get("fromBlock")
        to_block = block_window.get("toBlock")
        if isinstance(from_block, int) and isinstance(to_block, int) and (to_block - from_block > 9):
            return 0, 0
        token_topic = token_id_to_topic(str(row.get("tokenIdHex") or "0x0"))
        logs: list[dict[str, Any]] = []
        for collect_topic in COLLECT_EVENT_TOPICS:
            try:
                result = self._rpc_call(
                    chain,
                    "eth_getLogs",
                    [{
                        "fromBlock": block_window["fromBlockTag"],
                        "toBlock": block_window["toBlockTag"],
                        "address": csum(row["tokenContract"]),
                        "topics": [collect_topic, token_topic],
                    }],
                ) or []
                logs.extend(result)
            except Exception:
                continue
        amount0, amount1 = 0, 0
        seen: set[str] = set()
        for log in logs:
            dedupe = f"{log.get('transactionHash') or ''}:{log.get('logIndex') or ''}"
            if dedupe in seen:
                continue
            seen.add(dedupe)
            a0, a1 = parse_collect_log_amounts(log)
            amount0 += int(a0)
            amount1 += int(a1)
        return amount0, amount1

    @staticmethod
    def _get_claim_scope_key(row: dict[str, Any]) -> str | None:
        protocol = row.get("protocol")
        current_owner = row.get("currentOwner")
        vfat_contract = row.get("vfatContract")
        if not protocol or not current_owner or not vfat_contract:
            return None
        return f"{protocol}:{str(current_owner).lower()}:{str(vfat_contract).lower()}"

    def _build_claim_scope_counts(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in rows:
            key = self._get_claim_scope_key(row)
            if not key:
                continue
            counts[key] = counts.get(key, 0) + 1
        return counts

    @staticmethod
    def _partial_metrics_defaults(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "currentPoolUsd": None,
            "fees24hToken0": None,
            "fees24hToken1": None,
            "fees24hUsd": None,
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "vfatFeesClaimableNowUsd": None,
            "vfatEmissionsClaimableNowUsd": None,
            "vfatClaimableNowUsd": None,
            "vfatInRange": None,
            "apr24hPct": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_call_failed",
        }

    def _classify_owner_adapter(self, chain: dict[str, Any], row: dict[str, Any]) -> str:
        cache_key = f"{row.get('protocol')}:{str(row.get('currentOwner') or '').lower()}"
        cached = self.owner_adapter_cache.get(cache_key)
        if cached:
            return cached
        try:
            code = self._rpc_call(chain, "eth_getCode", [csum(str(row["currentOwner"])), "latest"])
            if not code or code == "0x":
                self.owner_adapter_cache[cache_key] = "direct_owner"
                return "direct_owner"
        except Exception:
            self.owner_adapter_cache[cache_key] = "unknown"
            return "unknown"

        token_word = pad_token_id_to_word(str(row.get("tokenIdHex") or "0x0"))
        if row.get("protocol") == "Aerodrome SlipStream":
            try:
                data = f"{EARNED_SELECTOR}{encode_address_word(str(row['vfatContract']))}{token_word}"
                result = self._rpc_eth_call(chain, str(row["currentOwner"]), data, "latest")
                if result and result != "0x":
                    self.owner_adapter_cache[cache_key] = "aerodrome_clgauge"
                    return "aerodrome_clgauge"
            except Exception:
                pass
        if row.get("protocol") == "PancakeSwap V3":
            try:
                data = f"{PENDING_CAKE_SELECTOR}{token_word}"
                result = self._rpc_eth_call(chain, str(row["currentOwner"]), data, "latest")
                if result and result != "0x":
                    self.owner_adapter_cache[cache_key] = "pancake_masterchef"
                    return "pancake_masterchef"
            except Exception:
                pass
        self.owner_adapter_cache[cache_key] = "unknown"
        return "unknown"

    def _resolve_gauge_reward_token(self, chain: dict[str, Any], gauge_address: str) -> str | None:
        gauge = csum(gauge_address)
        key = gauge.lower()
        if key in self.gauge_reward_token_cache:
            return self.gauge_reward_token_cache[key]
        try:
            result = self._rpc_eth_call(chain, gauge, REWARD_TOKEN_SELECTOR, "latest")
            token = decode_address_call_result(result)
            normalized = csum(token) if token and token.lower() != ZERO_ADDRESS.lower() else None
            self.gauge_reward_token_cache[key] = normalized
            return normalized
        except Exception:
            self.gauge_reward_token_cache[key] = None
            return None

    def _resolve_pancake_reward_token(self, chain: dict[str, Any], masterchef: str) -> str | None:
        chef = csum(masterchef)
        for selector in [CAKE_SELECTOR, CAKE_LOWER_SELECTOR]:
            try:
                result = self._rpc_eth_call(chain, chef, selector, "latest")
                token = decode_address_call_result(result)
                if token and token.lower() != ZERO_ADDRESS.lower():
                    return csum(token)
            except Exception:
                continue
        try:
            return csum(PANCAKE_CAKE_TOKEN)
        except Exception:
            return None

    def _fetch_aerodrome_emissions_24h(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_window: dict[str, Any],
        claim_scope_count: int = 0,
    ) -> dict[str, Any]:
        if row.get("adapterType") != "aerodrome_clgauge":
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_unclassified",
            }
        gauge = csum(str(row["currentOwner"]))
        token_word = pad_token_id_to_word(str(row["tokenIdHex"]))
        token_topic = token_id_to_topic(str(row["tokenIdHex"])).lower()
        earned_data = f"{EARNED_SELECTOR}{encode_address_word(str(row['vfatContract']))}{token_word}"
        try:
            pending_now = decode_uint256_call_result(self._rpc_eth_call(chain, gauge, earned_data, "latest"))
        except Exception:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        try:
            pending_start = decode_uint256_call_result(
                self._rpc_eth_call(chain, gauge, earned_data, block_window["fromBlockTag"])
            )
        except Exception as exc:
            if is_execution_reverted_na_error(exc) and is_recent_position_activity_within_window(row, block_window):
                pending_start = 0
            else:
                return {
                    "emissions24hUsd": None,
                    "emissions24hBreakdown": [],
                    "pendingEmissionsNowUsd": None,
                    "metricsQuality": "partial",
                    "metricsReason": "partial_call_failed",
                }

        reward_token = self._resolve_gauge_reward_token(chain, gauge)
        if not reward_token:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        try:
            reward_transfers = self._fetch_erc20_transfers(
                chain,
                from_address=gauge,
                to_address=str(row["vfatContract"]),
                contract_addresses=[reward_token],
                from_block=block_window["fromBlockTag"],
                to_block=block_window["toBlockTag"],
            )
        except Exception:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }

        realized_attributed = 0
        ambiguous_claims = 0
        for transfer in reward_transfers:
            claim_amount = parse_transfer_raw_amount(transfer)
            if claim_amount <= 0:
                continue
            tx = self._fetch_transaction_by_hash_cached(chain, transfer.get("hash"))
            input_data = (tx or {}).get("input")
            if not input_data:
                if claim_scope_count == 1:
                    realized_attributed += claim_amount
                else:
                    ambiguous_claims += claim_amount
                continue
            selector = parse_tx_selector(str(input_data))
            if selector == GET_REWARD_BY_TOKEN_SELECTOR:
                tx_token_word = (read_calldata_arg_word(str(input_data), 0) or "").lower()
                if ("0x" + tx_token_word) == token_topic:
                    realized_attributed += claim_amount
                else:
                    ambiguous_claims += claim_amount
            elif selector in ACCOUNT_WIDE_CLAIM_SELECTORS:
                if claim_scope_count == 1:
                    realized_attributed += claim_amount
                else:
                    ambiguous_claims += claim_amount
            elif claim_scope_count == 1:
                realized_attributed += claim_amount
            else:
                ambiguous_claims += claim_amount

        pending_delta = safe_positive(int(pending_now) - int(pending_start))
        emissions_raw = int(pending_delta) + int(realized_attributed)
        reward_meta = self._token_meta(w3, cache, reward_token)
        reward_price = self._prices(chain, cache, [reward_meta["address"]]).get(reward_meta["address"])
        if not isinstance(reward_price, (int, float)):
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        reward_decimals = int(reward_meta["decimals"])
        pending_now_amount = float(pending_now) / float(10 ** reward_decimals)
        emissions_amount = float(emissions_raw) / float(10 ** reward_decimals)
        emissions_usd = emissions_amount * float(reward_price)
        return {
            "emissions24hUsd": emissions_usd,
            "emissions24hBreakdown": [{
                "token": reward_meta["address"],
                "symbol": reward_meta["symbol"],
                "amount": emissions_amount,
                "usd": emissions_usd,
                "pendingNow": pending_now_amount,
            }],
            "pendingEmissionsNowUsd": pending_now_amount * float(reward_price),
            "metricsQuality": "partial" if ambiguous_claims > 0 else "full",
            "metricsReason": "partial_ambiguous_claim" if ambiguous_claims > 0 else "full",
        }

    def _fetch_pancake_emissions_24h(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_window: dict[str, Any],
        claim_scope_count: int = 0,
    ) -> dict[str, Any]:
        if row.get("adapterType") != "pancake_masterchef":
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_unclassified",
            }
        chef = csum(str(row["currentOwner"]))
        token_word = pad_token_id_to_word(str(row["tokenIdHex"]))
        data = f"{PENDING_CAKE_SELECTOR}{token_word}"
        try:
            pending_now = decode_uint256_call_result(self._rpc_eth_call(chain, chef, data, "latest"))
            pending_start = decode_uint256_call_result(self._rpc_eth_call(chain, chef, data, block_window["fromBlockTag"]))
        except Exception:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        reward_token = self._resolve_pancake_reward_token(chain, chef)
        if not reward_token:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        try:
            reward_transfers = self._fetch_erc20_transfers(
                chain,
                from_address=chef,
                to_address=str(row["vfatContract"]),
                contract_addresses=[reward_token],
                from_block=block_window["fromBlockTag"],
                to_block=block_window["toBlockTag"],
            )
        except Exception:
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }

        token_topic = token_id_to_topic(str(row["tokenIdHex"])).lower()
        realized_attributed = 0
        ambiguous_claims = 0
        for transfer in reward_transfers:
            raw_amount = parse_transfer_raw_amount(transfer)
            if raw_amount <= 0:
                continue
            tx = self._fetch_transaction_by_hash_cached(chain, transfer.get("hash"))
            selector = parse_tx_selector((tx or {}).get("input"))
            if selector == HARVEST_BY_TOKEN_SELECTOR:
                tx_token_word = (read_calldata_arg_word((tx or {}).get("input"), 0) or "").lower()
                if ("0x" + tx_token_word) == token_topic:
                    realized_attributed += raw_amount
                else:
                    ambiguous_claims += raw_amount
            elif selector in ACCOUNT_WIDE_CLAIM_SELECTORS:
                if claim_scope_count == 1:
                    realized_attributed += raw_amount
                else:
                    ambiguous_claims += raw_amount
            elif claim_scope_count == 1:
                realized_attributed += raw_amount
            else:
                ambiguous_claims += raw_amount

        pending_delta = safe_positive(int(pending_now) - int(pending_start))
        emissions_raw = int(pending_delta) + int(realized_attributed)
        reward_meta = self._token_meta(w3, cache, reward_token)
        reward_price = self._prices(chain, cache, [reward_meta["address"]]).get(reward_meta["address"])
        if not isinstance(reward_price, (int, float)):
            return {
                "emissions24hUsd": None,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": None,
                "metricsQuality": "partial",
                "metricsReason": "partial_call_failed",
            }
        reward_decimals = int(reward_meta["decimals"])
        pending_now_amount = float(pending_now) / float(10 ** reward_decimals)
        emissions_amount = float(emissions_raw) / float(10 ** reward_decimals)
        emissions_usd = emissions_amount * float(reward_price)
        return {
            "emissions24hUsd": emissions_usd,
            "emissions24hBreakdown": [{
                "token": reward_meta["address"],
                "symbol": reward_meta["symbol"],
                "amount": emissions_amount,
                "usd": emissions_usd,
                "pendingNow": pending_now_amount,
            }],
            "pendingEmissionsNowUsd": pending_now_amount * float(reward_price),
            "metricsQuality": "partial" if ambiguous_claims > 0 else "full",
            "metricsReason": "partial_ambiguous_claim" if ambiguous_claims > 0 else "full",
        }

    def _fetch_emissions_24h(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_window: dict[str, Any],
        claim_scope_count: int = 0,
    ) -> dict[str, Any]:
        adapter = CL_PROTOCOL_ADAPTERS.get(str(row.get("protocol")), {
            "feesMode": "realized_plus_pending_delta",
            "emissionsMode": "none",
        })
        if adapter.get("emissionsMode") == "none":
            return {
                "emissions24hUsd": 0.0,
                "emissions24hBreakdown": [],
                "pendingEmissionsNowUsd": 0.0,
                "metricsQuality": "full",
                "metricsReason": "full",
            }
        if row.get("protocol") == "Aerodrome SlipStream":
            return self._fetch_aerodrome_emissions_24h(chain, w3, cache, row, block_window, claim_scope_count)
        if row.get("protocol") == "PancakeSwap V3":
            return self._fetch_pancake_emissions_24h(chain, w3, cache, row, block_window, claim_scope_count)
        return {
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "pendingEmissionsNowUsd": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_unclassified",
        }

    def _enrich_current_row_with_24h_metrics(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_window: dict[str, Any],
        claim_scope_count: int = 0,
    ) -> dict[str, Any]:
        adapter = CL_PROTOCOL_ADAPTERS.get(str(row.get("protocol")), {
            "feesMode": "realized_plus_pending_delta",
            "emissionsMode": "none",
        })
        defaults = self._partial_metrics_defaults(row)
        snapshot_now = self._fetch_claimable_snapshot_at_block(chain, w3, cache, row, "latest")
        if not snapshot_now:
            time.sleep(RETRY_BASE_MS / 1000.0)
            snapshot_now = self._fetch_claimable_snapshot_at_block(chain, w3, cache, row, "latest")
        if not snapshot_now:
            return defaults

        snapshot_start = self._fetch_claimable_snapshot_at_block(chain, w3, cache, row, block_window["fromBlockTag"])
        if not snapshot_start:
            time.sleep(RETRY_BASE_MS / 1000.0)
            snapshot_start = self._fetch_claimable_snapshot_at_block(chain, w3, cache, row, block_window["fromBlockTag"])

        collect_amount0, collect_amount1 = self._fetch_collect_amounts_24h(chain, row, block_window)
        pending_now0 = int((snapshot_now.get("claimable") or {}).get("amount0") or 0)
        pending_now1 = int((snapshot_now.get("claimable") or {}).get("amount1") or 0)
        pending_start0 = int(((snapshot_start or {}).get("claimable") or {}).get("amount0") or 0)
        pending_start1 = int(((snapshot_start or {}).get("claimable") or {}).get("amount1") or 0)
        pending_delta0 = safe_positive(pending_now0 - pending_start0)
        pending_delta1 = safe_positive(pending_now1 - pending_start1)
        raw_fees0 = int(collect_amount0) + int(pending_delta0)
        raw_fees1 = int(collect_amount1) + int(pending_delta1)
        fees_raw0 = 0 if adapter.get("feesMode") == "none" else raw_fees0
        fees_raw1 = 0 if adapter.get("feesMode") == "none" else raw_fees1

        valuation = self._calculate_current_pool_usd(chain, w3, cache, snapshot_now)
        token0_meta = valuation.get("token0Meta")
        token1_meta = valuation.get("token1Meta")
        prices = valuation.get("prices")
        if not token0_meta or not token1_meta or not prices:
            return defaults

        dec0 = int(token0_meta["decimals"])
        dec1 = int(token1_meta["decimals"])
        fees24h_token0 = float(fees_raw0) / float(10 ** dec0)
        fees24h_token1 = float(fees_raw1) / float(10 ** dec1)
        claimable_now_token0 = float(pending_now0) / float(10 ** dec0)
        claimable_now_token1 = float(pending_now1) / float(10 ** dec1)
        price0 = prices.get(token0_meta["address"]) or 0
        price1 = prices.get(token1_meta["address"]) or 0
        fees24h_usd = (fees24h_token0 * float(price0) if isinstance(price0, (int, float)) else 0.0) + (
            fees24h_token1 * float(price1) if isinstance(price1, (int, float)) else 0.0
        )
        if adapter.get("feesMode") == "none":
            vfat_fees_claimable_now_usd = 0.0
        else:
            vfat_fees_claimable_now_usd = (
                claimable_now_token0 * float(price0) if isinstance(price0, (int, float)) else 0.0
            ) + (claimable_now_token1 * float(price1) if isinstance(price1, (int, float)) else 0.0)

        emissions = {
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "pendingEmissionsNowUsd": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_call_failed",
        }
        try:
            emissions = self._fetch_emissions_24h(chain, w3, cache, row, block_window, claim_scope_count)
        except Exception:
            pass

        current_pool_usd = valuation.get("currentPoolUsd")
        pending_emissions_now_usd = emissions.get("pendingEmissionsNowUsd")
        vfat_emissions_claimable_now_usd = (
            float(pending_emissions_now_usd) if isinstance(pending_emissions_now_usd, (int, float)) else None
        )
        claim_contributors = [
            vfat_fees_claimable_now_usd if isinstance(vfat_fees_claimable_now_usd, (int, float)) else None,
            vfat_emissions_claimable_now_usd,
        ]
        claim_values = [float(v) for v in claim_contributors if isinstance(v, (int, float))]
        vfat_claimable_now_usd = sum(claim_values) if claim_values else None

        if all(isinstance(row.get(k), (int, float)) for k in ["poolCurrentPrice", "poolRangeLowerPrice", "poolRangeUpperPrice"]):
            vfat_in_range = float(row["poolRangeLowerPrice"]) <= float(row["poolCurrentPrice"]) < float(row["poolRangeUpperPrice"])
        else:
            vfat_in_range = None
        fee_contribution = 0.0 if adapter.get("feesMode") == "none" else (float(fees24h_usd) if isinstance(fees24h_usd, (int, float)) else 0.0)
        emission_contribution = float(emissions["emissions24hUsd"]) if isinstance(emissions.get("emissions24hUsd"), (int, float)) else 0.0
        numerator = fee_contribution + emission_contribution
        apr24h_pct = (
            (numerator / float(current_pool_usd)) * 365 * 100
            if isinstance(current_pool_usd, (int, float)) and float(current_pool_usd) > 0
            else None
        )
        metrics_quality = "partial" if emissions.get("metricsQuality") == "partial" else "full"
        return {
            **row,
            "currentPoolUsd": current_pool_usd,
            "fees24hToken0": fees24h_token0,
            "fees24hToken1": fees24h_token1,
            "fees24hUsd": fees24h_usd,
            "emissions24hUsd": emissions.get("emissions24hUsd"),
            "emissions24hBreakdown": emissions.get("emissions24hBreakdown") or [],
            "vfatFeesClaimableNowUsd": vfat_fees_claimable_now_usd,
            "vfatEmissionsClaimableNowUsd": vfat_emissions_claimable_now_usd,
            "vfatClaimableNowUsd": vfat_claimable_now_usd,
            "vfatInRange": vfat_in_range,
            "apr24hPct": apr24h_pct,
            "metricsQuality": metrics_quality,
            "metricsReason": emissions.get("metricsReason") or "partial_call_failed",
        }

    def _enrich_vfat_cl_rows_with_24h_metrics(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        rows: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str]:
        if not rows:
            return [], ""
        try:
            block_window = self._resolve_24h_block_window(chain)
        except Exception as exc:
            return [self._partial_metrics_defaults(row) for row in rows], f"CL 24h block window resolution failed: {exc}"
        for row in rows:
            try:
                row["adapterType"] = self._classify_owner_adapter(chain, row)
            except Exception:
                row["adapterType"] = "unknown"
        counts = self._build_claim_scope_counts(rows)
        enriched: list[dict[str, Any]] = []
        failures = 0
        for row in rows:
            scope_key = self._get_claim_scope_key(row)
            scope_count = counts.get(scope_key, 0) if scope_key else 0
            try:
                enriched.append(self._enrich_current_row_with_24h_metrics(chain, w3, cache, row, block_window, scope_count))
            except Exception:
                failures += 1
                enriched.append(self._partial_metrics_defaults(row))
        err = f"{failures} CL row(s) failed 24h enrichment" if failures else ""
        return enriched, err

    @staticmethod
    def _row_sort_key_asc(row: dict[str, Any]) -> tuple[Any, ...]:
        return (int(row.get("blockNumber") or 0), str(row.get("txHash") or ""), str(row.get("sortRef") or ""))

    @staticmethod
    def _addr_or_zero(value: Any) -> str:
        if not value:
            return ZERO_ADDRESS
        try:
            return csum(str(value))
        except Exception:
            return str(value).lower()

    def _find_directly_deployed_contracts(self, chain: dict[str, Any], wallet: str) -> list[str]:
        owner = csum(wallet)
        transfers = self._alchemy_get_transfers(
            chain,
            {
                "fromBlock": "0x0",
                "toBlock": "latest",
                "fromAddress": owner,
                "excludeZeroValue": False,
                "category": ["external"],
                "maxCount": "0x3e8",
            },
        )
        hashes = sorted({t.get("hash") for t in transfers if t.get("to") is None and t.get("hash")})
        deployed: list[str] = []
        for h in hashes:
            try:
                receipt = self._rpc_call(chain, "eth_getTransactionReceipt", [h]) or {}
                contract_address = receipt.get("contractAddress")
                if contract_address:
                    deployed.append(csum(contract_address))
            except Exception:
                continue
        return sorted({d.lower(): d for d in deployed}.values())

    def _find_factory_deployed_contracts(self, chain: dict[str, Any], wallet: str) -> list[str]:
        owner = csum(wallet).lower()
        factories = [csum(a) for a in chain.get("sickleFactoryAllowlist", [])]
        deployment_hashes: set[str] = set()
        for factory in factories:
            transfers = self._alchemy_get_transfers(
                chain,
                {
                    "fromBlock": "0x0",
                    "toBlock": "latest",
                    "fromAddress": owner,
                    "toAddress": factory,
                    "excludeZeroValue": False,
                    "category": ["external"],
                    "maxCount": "0x3e8",
                },
            )
            for t in transfers:
                h = t.get("hash")
                if h:
                    deployment_hashes.add(h)

        allowed_factories = {f.lower() for f in factories}
        out: list[str] = []
        for h in sorted(deployment_hashes):
            try:
                receipt = self._rpc_call(chain, "eth_getTransactionReceipt", [h]) or {}
            except Exception:
                continue
            for log in receipt.get("logs", []) or []:
                try:
                    log_addr = csum(log.get("address", ZERO_ADDRESS)).lower()
                except Exception:
                    continue
                topics = log.get("topics") or []
                if log_addr not in allowed_factories:
                    continue
                if not topics or str(topics[0]).lower() != SICKLE_DEPLOY_EVENT_TOPIC:
                    continue
                admin = topic_address(topics[1] if len(topics) > 1 else None)
                if not admin:
                    continue
                try:
                    if csum(admin).lower() != owner:
                        continue
                except Exception:
                    continue
                sickle = data_address(log.get("data"))
                if sickle:
                    try:
                        out.append(csum(sickle))
                    except Exception:
                        continue
        return sorted({x.lower(): x for x in out}.values())

    def _identify_vfat_contracts(self, chain: dict[str, Any], w3: Web3, deployed_contracts: list[str]) -> list[dict[str, Any]]:
        strict_allow = {csum(a).lower() for a in chain.get("vfatImplementationAllowlist", [])}
        classified: list[dict[str, Any]] = []
        fallback: list[dict[str, Any]] = []
        for addr in deployed_contracts:
            try:
                code = w3.eth.get_code(csum(addr)).hex()
            except Exception:
                continue
            impl = parse_eip1167_implementation(code)
            if not impl:
                continue
            try:
                n_addr = csum(addr)
                n_impl = csum(impl)
            except Exception:
                continue
            row = {"address": n_addr, "implementation": n_impl, "kind": "eip1167"}
            if not strict_allow or n_impl.lower() in strict_allow:
                classified.append(row)
            else:
                row2 = dict(row)
                row2["kind"] = "eip1167_fallback"
                fallback.append(row2)
        return classified if classified else fallback

    def _fetch_transfers_by_address(
        self,
        chain: dict[str, Any],
        address_key: str,
        address_value: str,
        contract_addresses: list[str],
    ) -> list[dict[str, Any]]:
        params = {
            "fromBlock": "0x0",
            "toBlock": "latest",
            "excludeZeroValue": False,
            "withMetadata": True,
            "category": ["erc721"],
            "contractAddresses": contract_addresses,
            "maxCount": "0x3e8",
            address_key: address_value,
        }
        return self._alchemy_get_transfers(chain, params)

    def _map_cl_transfer_row(self, vfat_contract: str, transfer: dict[str, Any], proto_by_mgr: dict[str, str]) -> dict[str, Any] | None:
        token_contract_raw = ((transfer.get("rawContract") or {}).get("address"))
        token_id_raw = transfer.get("erc721TokenId")
        if not token_contract_raw or not token_id_raw:
            return None
        try:
            token_contract = csum(token_contract_raw)
        except Exception:
            return None
        protocol = proto_by_mgr.get(token_contract.lower())
        if not protocol:
            return None
        vfat = csum(vfat_contract)
        vfat_lower = vfat.lower()
        from_addr = self._addr_or_zero(transfer.get("from"))
        to_addr = self._addr_or_zero(transfer.get("to"))
        from_lower, to_lower = from_addr.lower(), to_addr.lower()
        token_id_hex = norm_token_hex(str(token_id_raw))
        direction = "self"
        if from_lower == vfat_lower and to_lower != vfat_lower:
            direction = "out"
        elif to_lower == vfat_lower and from_lower != vfat_lower:
            direction = "in"
        action = "internal"
        if direction == "out":
            action = "burned" if to_lower == ZERO_ADDRESS.lower() else "deposited"
        elif direction == "in":
            action = "minted" if from_lower == ZERO_ADDRESS.lower() else "received"
        counterparty = to_addr if direction == "out" else from_addr if direction == "in" else vfat
        block_num_hex = transfer.get("blockNum") or "0x0"
        block_num = int(block_num_hex, 16) if isinstance(block_num_hex, str) and block_num_hex.startswith("0x") else 0
        return {
            "positionType": "cl",
            "vfatContract": vfat,
            "tokenContract": token_contract,
            "tokenContractLower": token_contract.lower(),
            "protocol": protocol,
            "tokenIdHex": token_id_hex,
            "tokenIdDecimal": token_id_decimal(token_id_hex),
            "tokenKey": f"{vfat_lower}:{token_contract.lower()}:{token_id_hex.lower()}",
            "direction": direction,
            "action": action,
            "txHash": transfer.get("hash") or "",
            "blockNumHex": block_num_hex,
            "blockNumber": block_num,
            "blockTimestamp": ((transfer.get("metadata") or {}).get("blockTimestamp")),
            "from": from_addr,
            "to": to_addr,
            "counterparty": counterparty,
            "sortRef": transfer.get("uniqueId") or f"{transfer.get('hash') or ''}:{token_id_raw}",
        }

    def _fetch_cl_transfers_for_vfat_contract(
        self,
        chain: dict[str, Any],
        vfat_contract: str,
        manager_addresses: list[str],
        proto_by_mgr: dict[str, str],
    ) -> list[dict[str, Any]]:
        vfat = csum(vfat_contract)
        outbound = self._fetch_transfers_by_address(chain, "fromAddress", vfat, manager_addresses)
        inbound = self._fetch_transfers_by_address(chain, "toAddress", vfat, manager_addresses)
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for transfer in [*outbound, *inbound]:
            row = self._map_cl_transfer_row(vfat, transfer, proto_by_mgr)
            if not row:
                continue
            dedupe = f"{row['vfatContract'].lower()}:{transfer.get('uniqueId') or f"{row['txHash']}:{row['tokenContractLower']}:{row['tokenIdHex']}:{row['from']}:{row['to']}"}"
            if dedupe in seen:
                continue
            seen.add(dedupe)
            rows.append(row)
        rows.sort(key=self._row_sort_key_asc, reverse=True)
        return rows

    @staticmethod
    def _merge_open_rows_with_vfat_preference(standard_rows: list[dict[str, Any]], vfat_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        merged: dict[str, dict[str, Any]] = {}
        dedupe = 0
        for row in standard_rows:
            key = f"{csum(row['tokenContract']).lower()}:{norm_token_hex(str(row['tokenIdHex'])).lower()}"
            merged[key] = row
        for row in vfat_rows:
            key = f"{csum(row['tokenContract']).lower()}:{norm_token_hex(str(row['tokenIdHex'])).lower()}"
            if key in merged:
                dedupe += 1
            merged[key] = row
        out = list(merged.values())
        out.sort(key=lambda x: x["currentPoolUsd"] if isinstance(x.get("currentPoolUsd"), (int, float)) else -float("inf"), reverse=True)
        return out, dedupe

    def _fetch_erc20_transfers(
        self,
        chain: dict[str, Any],
        from_address: str | None = None,
        to_address: str | None = None,
        contract_addresses: list[str] | None = None,
        from_block: str = "0x0",
        to_block: str = "latest",
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "fromBlock": from_block,
            "toBlock": to_block,
            "excludeZeroValue": False,
            "category": ["erc20"],
            "maxCount": "0x3e8",
        }
        if from_address:
            params["fromAddress"] = csum(from_address)
        if to_address:
            params["toAddress"] = csum(to_address)
        if contract_addresses:
            params["contractAddresses"] = [csum(a) for a in contract_addresses]
        return self._alchemy_get_transfers(chain, params)

    def _find_aerodrome_gauge_counterparties(self, chain: dict[str, Any], vfat_contract: str) -> list[str]:
        vfat = csum(vfat_contract)
        outbound = self._fetch_erc20_transfers(chain, from_address=vfat)
        inbound = self._fetch_erc20_transfers(chain, to_address=vfat)
        counterparties: set[str] = set()
        vfat_lower = vfat.lower()
        for transfer in [*outbound, *inbound]:
            frm = transfer.get("from")
            to = transfer.get("to")
            try:
                frm_n = csum(frm) if frm else None
            except Exception:
                frm_n = None
            try:
                to_n = csum(to) if to else None
            except Exception:
                to_n = None
            if not frm_n or not to_n:
                continue
            f_l, t_l = frm_n.lower(), to_n.lower()
            if f_l == vfat_lower and t_l != vfat_lower and t_l != ZERO_ADDRESS.lower():
                counterparties.add(to_n)
            elif t_l == vfat_lower and f_l != vfat_lower and f_l != ZERO_ADDRESS.lower():
                counterparties.add(frm_n)
        return sorted(counterparties)

    def _is_aerodrome_gauge(self, w3: Web3, address: str) -> bool:
        try:
            voter = w3.eth.contract(address=csum(AERODROME_VOTER_ADDRESS), abi=VOTER_ABI)
            return bool(voter.functions.isGauge(csum(address)).call())
        except Exception:
            return False

    def _is_aerodrome_v2_pool(self, w3: Web3, pool_address: str) -> bool:
        try:
            factory = w3.eth.contract(address=csum(AERODROME_V2_PAIR_FACTORY_ADDRESS), abi=AERODROME_V2_FACTORY_ABI)
            return bool(factory.functions.isPool(csum(pool_address)).call())
        except Exception:
            return False

    def _build_aerodrome_v2_row(
        self, chain: dict[str, Any], w3: Web3, cache: Cache, vfat_contract: str, gauge_address: str
    ) -> dict[str, Any] | None:
        vfat = csum(vfat_contract)
        gauge = csum(gauge_address)
        gauge_contract = w3.eth.contract(address=gauge, abi=AERODROME_V2_GAUGE_ABI)
        try:
            staked_balance = int(gauge_contract.functions.balanceOf(vfat).call())
        except Exception:
            return None
        if staked_balance <= 0:
            return None

        try:
            pool_addr = csum(gauge_contract.functions.stakingToken().call())
        except Exception:
            return None
        if not self._is_aerodrome_v2_pool(w3, pool_addr):
            return None

        reward_token: str | None = None
        pending_now_usd: float | None = None
        try:
            reward_token = csum(gauge_contract.functions.rewardToken().call())
            pending_now_raw = int(gauge_contract.functions.earned(vfat).call())
            reward_meta = self._token_meta(w3, cache, reward_token)
            reward_prices = self._prices(chain, cache, [reward_meta["address"]])
            rp = reward_prices.get(reward_meta["address"])
            if isinstance(rp, (int, float)):
                pending_now_usd = (float(pending_now_raw) / float(10 ** int(reward_meta["decimals"]))) * float(rp)
        except Exception:
            pending_now_usd = None

        pool = w3.eth.contract(address=pool_addr, abi=AERODROME_V2_POOL_ABI)
        token0 = token1 = None
        reserve0 = reserve1 = 0
        stable = False
        try:
            m = pool.functions.metadata().call()
            token0 = csum(m[5])
            token1 = csum(m[6])
            reserve0 = int(m[2])
            reserve1 = int(m[3])
            stable = bool(m[4])
        except Exception:
            try:
                token0 = csum(pool.functions.token0().call())
                token1 = csum(pool.functions.token1().call())
                reserve0 = int(pool.functions.reserve0().call())
                reserve1 = int(pool.functions.reserve1().call())
                stable = bool(pool.functions.stable().call())
            except Exception:
                return None

        try:
            total_supply = int(pool.functions.totalSupply().call())
        except Exception:
            return None
        if total_supply <= 0:
            return None

        amount0_raw = (staked_balance * reserve0) // total_supply
        amount1_raw = (staked_balance * reserve1) // total_supply
        token0_meta = self._token_meta(w3, cache, token0)
        token1_meta = self._token_meta(w3, cache, token1)
        prices = self._prices(chain, cache, [token0_meta["address"], token1_meta["address"]])
        p0 = prices.get(token0_meta["address"])
        p1 = prices.get(token1_meta["address"])
        amt0 = float(amount0_raw) / float(10 ** int(token0_meta["decimals"]))
        amt1 = float(amount1_raw) / float(10 ** int(token1_meta["decimals"]))
        current_pool_usd = (amt0 * float(p0) if isinstance(p0, (int, float)) else 0.0) + (
            amt1 * float(p1) if isinstance(p1, (int, float)) else 0.0
        )

        pool_fee: int | None = None
        try:
            factory = w3.eth.contract(address=csum(AERODROME_V2_PAIR_FACTORY_ADDRESS), abi=AERODROME_V2_FACTORY_ABI)
            pool_fee = int(factory.functions.getFee(pool_addr, stable).call())
        except Exception:
            pool_fee = None

        token_id_hex = f"0x{vfat[2:].lower()}"
        return {
            "source": "vfat",
            "positionType": "aerodrome_v2",
            "protocol": AERODROME_V2_PROTOCOL,
            "protocolDisplay": f"{AERODROME_V2_PROTOCOL} (VFat)",
            "tokenContract": gauge,
            "tokenIdHex": token_id_hex,
            "tokenIdDecimal": token_id_decimal(token_id_hex),
            "tokenKey": f"vfatv2:{vfat.lower()}:{gauge.lower()}",
            "vfatContract": vfat,
            "currentOwner": vfat,
            "ownerScope": "vfat",
            "ownerCheck": "confirmed",
            "ownerResolved": vfat.lower(),
            "liveLiquidity": str(staked_balance),
            "adapterType": "aerodrome_v2_gauge",
            "poolPair": f"{token0_meta['symbol']}/{token1_meta['symbol']} ({'stable' if stable else 'volatile'})",
            "poolFee": pool_fee,
            "poolStable": stable,
            "poolToken0": token0_meta["address"],
            "poolToken1": token1_meta["address"],
            "poolTickLower": None,
            "poolTickUpper": None,
            "poolRangeLowerPrice": None,
            "poolRangeUpperPrice": None,
            "poolCurrentPrice": None,
            "currentPoolUsd": current_pool_usd,
            "fees24hToken0": None,
            "fees24hToken1": None,
            "fees24hUsd": 0.0,
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "vfatFeesClaimableNowUsd": 0.0,
            "vfatEmissionsClaimableNowUsd": pending_now_usd,
            "vfatClaimableNowUsd": pending_now_usd,
            "vfatInRange": None,
            "apr24hPct": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_call_failed",
            "chainKey": chain["key"],
        }

    @staticmethod
    def _partial_v2_metrics_defaults(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "fees24hToken0": None,
            "fees24hToken1": None,
            "fees24hUsd": 0.0,
            "emissions24hUsd": None,
            "emissions24hBreakdown": [],
            "vfatFeesClaimableNowUsd": 0.0,
            "vfatEmissionsClaimableNowUsd": None,
            "vfatClaimableNowUsd": None,
            "vfatInRange": None,
            "apr24hPct": None,
            "metricsQuality": "partial",
            "metricsReason": "partial_call_failed",
        }

    def _enrich_v2_row_with_24h_metrics(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        row: dict[str, Any],
        block_window: dict[str, Any],
    ) -> dict[str, Any]:
        defaults = self._partial_v2_metrics_defaults(row)
        try:
            gauge = csum(str(row["tokenContract"]))
            vfat = csum(str(row["vfatContract"]))
            gauge_contract = w3.eth.contract(address=gauge, abi=AERODROME_V2_GAUGE_ABI)
            reward_token = csum(gauge_contract.functions.rewardToken().call())
            pending_now = int(gauge_contract.functions.earned(vfat).call())
            pending_start = int(gauge_contract.functions.earned(vfat).call(block_identifier=int(block_window["fromBlock"])))
            reward_transfers = self._fetch_erc20_transfers(
                chain,
                from_address=gauge,
                to_address=vfat,
                contract_addresses=[reward_token],
                from_block=block_window["fromBlockTag"],
                to_block=block_window["toBlockTag"],
            )
            realized_reward = 0
            for transfer in reward_transfers:
                realized_reward += parse_transfer_raw_amount(transfer)
            pending_delta = safe_positive(pending_now - pending_start)
            emissions_raw = int(pending_delta) + int(realized_reward)
            reward_meta = self._token_meta(w3, cache, reward_token)
            reward_price = self._prices(chain, cache, [reward_meta["address"]]).get(reward_meta["address"])
            if not isinstance(reward_price, (int, float)):
                return defaults
            reward_decimals = int(reward_meta["decimals"])
            emissions_amount = float(emissions_raw) / float(10 ** reward_decimals)
            pending_now_amount = float(pending_now) / float(10 ** reward_decimals)
            emissions_usd = emissions_amount * float(reward_price)
            pending_now_usd = pending_now_amount * float(reward_price)
            pool_usd = row.get("currentPoolUsd")
            apr24h_pct = (
                (emissions_usd / float(pool_usd)) * 365 * 100
                if isinstance(pool_usd, (int, float)) and float(pool_usd) > 0
                else None
            )
            return {
                **row,
                "fees24hToken0": None,
                "fees24hToken1": None,
                "fees24hUsd": 0.0,
                "emissions24hUsd": emissions_usd,
                "emissions24hBreakdown": [{
                    "token": reward_meta["address"],
                    "symbol": reward_meta["symbol"],
                    "amount": emissions_amount,
                    "usd": emissions_usd,
                    "pendingNow": pending_now_amount,
                }],
                "vfatFeesClaimableNowUsd": 0.0,
                "vfatEmissionsClaimableNowUsd": pending_now_usd,
                "vfatClaimableNowUsd": pending_now_usd,
                "vfatInRange": None,
                "apr24hPct": apr24h_pct,
                "metricsQuality": "full",
                "metricsReason": "full",
            }
        except Exception:
            return defaults

    def _enrich_v2_rows_with_24h_metrics(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        rows: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str]:
        if not rows:
            return [], ""
        try:
            block_window = self._resolve_24h_block_window(chain)
        except Exception as exc:
            return [self._partial_v2_metrics_defaults(row) for row in rows], f"V2 24h block window resolution failed: {exc}"
        out: list[dict[str, Any]] = []
        failures = 0
        for row in rows:
            try:
                out.append(self._enrich_v2_row_with_24h_metrics(chain, w3, cache, row, block_window))
            except Exception:
                failures += 1
                out.append(self._partial_v2_metrics_defaults(row))
        err = f"{failures} V2 row(s) failed 24h enrichment" if failures else ""
        return out, err

    def _build_vfat_rows(
        self,
        chain: dict[str, Any],
        w3: Web3,
        cache: Cache,
        owner: str,
        proto_by_mgr: dict[str, str],
    ) -> dict[str, Any]:
        direct = self._find_directly_deployed_contracts(chain, owner)
        factory = self._find_factory_deployed_contracts(chain, owner)
        deployed = sorted({*(direct or []), *(factory or [])})
        identified = self._identify_vfat_contracts(chain, w3, deployed)
        if not identified:
            return {
                "vfatContracts": [],
                "vfatClCurrentRows": [],
                "vfatV2CurrentRows": [],
                "vfatClCurrentTokenCount": 0,
                "vfatV2CurrentTokenCount": 0,
                "vfatClOwnedByVfatCount": 0,
                "vfatClExternalizedCount": 0,
                "vfatClUncertainCount": 0,
                "error": "",
            }

        manager_addresses = [csum(item["address"]) for item in chain["clPositionManagers"]]
        history_rows: list[dict[str, Any]] = []
        for item in identified:
            try:
                history_rows.extend(
                    self._fetch_cl_transfers_for_vfat_contract(chain, item["address"], manager_addresses, proto_by_mgr)
                )
            except Exception:
                continue

        rows_by_token: dict[str, list[dict[str, Any]]] = {}
        for row in history_rows:
            rows_by_token.setdefault(row["tokenKey"], []).append(row)

        current_rows: list[dict[str, Any]] = []
        for rows in rows_by_token.values():
            rows.sort(key=self._row_sort_key_asc)
            latest = rows[-1]
            if latest["to"].lower() == ZERO_ADDRESS.lower():
                continue
            try:
                manager = csum(latest["tokenContract"])
                token_id_int = int(str(latest["tokenIdHex"]), 16)
                manager_contract = w3.eth.contract(address=manager, abi=NFPM_ABI)
                live_owner = csum(manager_contract.functions.ownerOf(token_id_int).call())
                live_pos = manager_contract.functions.positions(token_id_int).call()
                if int(live_pos[7]) <= 0:
                    continue
                base_row = self._fetch_position(w3, cache, chain["key"], proto_by_mgr, latest["vfatContract"], token_id_int, manager)
                base_row["source"] = "vfat"
                base_row["protocolDisplay"] = f"{base_row['protocol']} (VFat)"
                base_row["tokenKey"] = f"{latest['vfatContract'].lower()}:{base_row['tokenContract'].lower()}:{base_row['tokenIdHex'].lower()}"
                base_row["vfatContract"] = latest["vfatContract"]
                base_row["currentOwner"] = live_owner
                base_row["ownerScope"] = "vfat" if live_owner.lower() == latest["vfatContract"].lower() else "external"
                base_row["ownerCheck"] = "confirmed" if live_owner.lower() == latest["to"].lower() else "uncertain"
                base_row["ownerResolved"] = live_owner.lower()
                base_row["liveLiquidity"] = str(int(live_pos[7]))
                base_row["adapterType"] = "unknown"
                current_rows.append(base_row)
            except Exception:
                continue

        metrics_errors: list[str] = []
        current_rows = self._enrich_prices(chain, cache, current_rows)
        current_rows, cl_metrics_error = self._enrich_vfat_cl_rows_with_24h_metrics(chain, w3, cache, current_rows)
        if cl_metrics_error:
            metrics_errors.append(cl_metrics_error)
        v2_rows: list[dict[str, Any]] = []
        if bool(chain.get("enableAerodromeV2Paths")):
            for vfat in identified:
                vfat_addr = csum(vfat["address"])
                try:
                    counterparties = self._find_aerodrome_gauge_counterparties(chain, vfat_addr)
                except Exception:
                    counterparties = []
                for cp in counterparties:
                    if not self._is_aerodrome_gauge(w3, cp):
                        continue
                    try:
                        row = self._build_aerodrome_v2_row(chain, w3, cache, vfat_addr, cp)
                    except Exception:
                        row = None
                    if row:
                        v2_rows.append(row)
        v2_rows, v2_metrics_error = self._enrich_v2_rows_with_24h_metrics(chain, w3, cache, v2_rows)
        if v2_metrics_error:
            metrics_errors.append(v2_metrics_error)
        v2_rows.sort(key=lambda x: x["currentPoolUsd"] if isinstance(x.get("currentPoolUsd"), (int, float)) else -float("inf"), reverse=True)
        return {
            "vfatContracts": identified,
            "vfatClCurrentRows": current_rows,
            "vfatV2CurrentRows": v2_rows,
            "vfatClCurrentTokenCount": len(current_rows),
            "vfatV2CurrentTokenCount": len(v2_rows),
            "vfatClOwnedByVfatCount": len([r for r in current_rows if r.get("ownerScope") == "vfat"]),
            "vfatClExternalizedCount": len([r for r in current_rows if r.get("ownerScope") == "external"]),
            "vfatClUncertainCount": len([r for r in current_rows if r.get("ownerCheck") != "confirmed"]),
            "error": " | ".join(metrics_errors),
        }

    def fetch_portfolio(self, wallet: str) -> dict[str, Any]:
        owner = csum(wallet)
        chain_rows: list[dict[str, Any]] = []
        chain_errors: list[str] = []
        fatal_chain_errors: list[str] = []
        chains_loaded: list[str] = []
        open_rows_dedupe_count = 0
        all_vfat_contracts: list[dict[str, Any]] = []
        all_vfat_cl_rows: list[dict[str, Any]] = []
        all_vfat_v2_rows: list[dict[str, Any]] = []
        vfat_cl_current_token_count = 0
        vfat_v2_current_token_count = 0
        vfat_cl_owned_by_vfat_count = 0
        vfat_cl_externalized_count = 0
        vfat_cl_uncertain_count = 0
        for ck in CHAIN_SEQUENCE:
            try:
                c = self._chain_cfg(ck)
                w3 = self._w3(c)
                cache = Cache()
                proto = {csum(x["address"]).lower(): x["protocol"] for x in c["clPositionManagers"]}
                refs = []
                for mgr in c["clPositionManagers"]:
                    try:
                        mc = w3.eth.contract(address=csum(mgr["address"]), abi=NFPM_ABI)
                        bal = int(mc.functions.balanceOf(owner).call())
                    except Exception:
                        continue
                    for i in range(max(0, bal)):
                        try:
                            refs.append((int(mc.functions.tokenOfOwnerByIndex(owner, i).call()), csum(mgr["address"])))
                        except Exception:
                            continue
                rows = []
                fail = 0
                for tid, mgr in refs:
                    try:
                        row = self._fetch_position(w3, cache, c["key"], proto, owner, tid, mgr)
                        if int(row.get("liveLiquidity") or "0") > 0:
                            rows.append(row)
                    except Exception:
                        fail += 1
                standard_rows = self._enrich_prices(c, cache, rows)

                vfat_rows = []
                vfat_error = ""
                vfat_result = self._build_vfat_rows(c, w3, cache, owner, proto)
                all_vfat_contracts.extend(vfat_result["vfatContracts"])
                all_vfat_cl_rows.extend(vfat_result["vfatClCurrentRows"])
                all_vfat_v2_rows.extend(vfat_result["vfatV2CurrentRows"])
                vfat_rows = [*(vfat_result["vfatClCurrentRows"]), *(vfat_result["vfatV2CurrentRows"])]
                vfat_cl_current_token_count += int(vfat_result["vfatClCurrentTokenCount"])
                vfat_v2_current_token_count += int(vfat_result["vfatV2CurrentTokenCount"])
                vfat_cl_owned_by_vfat_count += int(vfat_result["vfatClOwnedByVfatCount"])
                vfat_cl_externalized_count += int(vfat_result["vfatClExternalizedCount"])
                vfat_cl_uncertain_count += int(vfat_result["vfatClUncertainCount"])
                vfat_error = str(vfat_result.get("error") or "")

                merged_rows, dedupe_count = self._merge_open_rows_with_vfat_preference(standard_rows, vfat_rows)
                open_rows_dedupe_count += dedupe_count
                chain_rows.extend([{**r, "chainName": c["chainName"]} for r in merged_rows])
                chains_loaded.append(c["chainName"])
                if fail:
                    chain_errors.append(f"{c['chainName']}: {fail} wallet-held NFT read(s) failed")
                if vfat_error:
                    chain_errors.append(f"{c['chainName']}: {vfat_error}")
            except Exception as exc:
                fatal_chain_errors.append(f"{CHAIN_CONFIGS[ck]['chainName']}: {exc}")
                continue
        chain_rows.sort(key=lambda x: x["currentPoolUsd"] if isinstance(x.get("currentPoolUsd"), (int, float)) else -float("inf"), reverse=True)
        if not chains_loaded and fatal_chain_errors:
            raise RuntimeError(" | ".join(fatal_chain_errors))
        totals = build_totals(chain_rows)
        error_parts: list[str] = []
        if chain_errors:
            error_parts.extend(chain_errors)
        if fatal_chain_errors:
            error_parts.extend(fatal_chain_errors)
        msg = " | ".join(error_parts)
        return {
            "owner": owner,
            "openRows": chain_rows,
            "openRowsDedupeCount": open_rows_dedupe_count,
            "vfatContracts": all_vfat_contracts,
            "vfatClCurrentRows": all_vfat_cl_rows,
            "vfatV2CurrentRows": all_vfat_v2_rows,
            "vfatClCurrentTokenCount": vfat_cl_current_token_count,
            "vfatV2CurrentTokenCount": vfat_v2_current_token_count,
            "vfatCurrentTokenCount": vfat_cl_current_token_count + vfat_v2_current_token_count,
            "vfatClOwnedByVfatCount": vfat_cl_owned_by_vfat_count,
            "vfatClExternalizedCount": vfat_cl_externalized_count,
            "vfatClUncertainCount": vfat_cl_uncertain_count,
            "vfatClError": msg,
            "chainsLoaded": chains_loaded,
            "totals": totals,
        }


def build_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    pooled = 0.0
    claim = 0.0
    in_range = 0
    considered = 0
    pools = set()
    for r in rows:
        if isinstance(r.get("currentPoolUsd"), (int, float)) and math.isfinite(r["currentPoolUsd"]):
            pooled += float(r["currentPoolUsd"])
        if isinstance(r.get("vfatClaimableNowUsd"), (int, float)) and math.isfinite(r["vfatClaimableNowUsd"]):
            claim += float(r["vfatClaimableNowUsd"])
        if isinstance(r.get("vfatInRange"), bool):
            considered += 1
            if r["vfatInRange"]:
                in_range += 1
        pools.add(f"{r.get('chainKey')}:{r.get('protocol')}:{r.get('poolPair')}:{r.get('poolFee')}")
    return {
        "pooledUsd": pooled,
        "claimableUsd": claim,
        "openCount": len(rows),
        "poolCount": len(pools),
        "inRangeCount": in_range,
        "rangeConsideredCount": considered,
        "rangeExcludedCount": len(rows) - considered,
    }


def load_wallets(args: argparse.Namespace) -> list[str]:
    wallets = [w.strip() for w in args.wallet if w and w.strip()]
    if args.wallet_file:
        if not args.wallet_file.exists():
            raise FileNotFoundError(f"Wallet file not found: {args.wallet_file}")
        for line in args.wallet_file.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s and not s.startswith("#"):
                wallets.append(s)
    deduped, seen = [], set()
    for w in wallets:
        if w.lower() in seen:
            continue
        deduped.append(w)
        seen.add(w.lower())
    return deduped


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pure Python CL LP scanner (Base + BSC) with webapp-like JSON.")
    p.add_argument("--alchemy-api-key", default=os.environ.get("ALCHEMY_API_KEY", "").strip())
    p.add_argument("--wallet", action="append", default=[])
    p.add_argument("--wallet-file", type=Path)
    p.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument("--timeout", type=int, default=25)
    p.add_argument("--output", type=Path)
    p.add_argument("--pretty", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.alchemy_api_key:
        print("Missing Alchemy API key. Use --alchemy-api-key or ALCHEMY_API_KEY.", file=sys.stderr)
        return 2
    try:
        wallets = load_wallets(args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not wallets:
        print("No wallet addresses provided. Use --wallet and/or --wallet-file.", file=sys.stderr)
        return 2
    project_root = args.project_root.resolve()
    if not (project_root / "app.js").exists():
        print(f"app.js not found in project root: {project_root}", file=sys.stderr)
        return 2
    scanner = Scanner(args.alchemy_api_key, project_root, args.timeout)
    results = []
    for w in wallets:
        try: results.append(scanner.fetch_portfolio(w))
        except Exception as exc: results.append({"wallet": w, "error": str(exc)})
    out: Any = results[0] if len(results) == 1 else {"walletCount": len(results), "results": results}
    text = json.dumps(out, indent=2 if args.pretty else None, ensure_ascii=True, separators=None if args.pretty else (",", ":"))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
