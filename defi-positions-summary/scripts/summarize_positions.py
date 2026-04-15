#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests

CHAIN_TO_PRICE_NETWORK = {
    "base": "base-mainnet",
    "bsc": "bnb-mainnet",
}

API_KEY_NAMES = ("ALCHEMY_API_KEY", "alchemy_key")


def load_env_map(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, value = s.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def resolve_api_key(explicit_key: str | None, env_file: Path | None) -> str | None:
    if explicit_key:
        return explicit_key.strip() or None
    if env_file:
        env_map = load_env_map(env_file)
        for name in API_KEY_NAMES:
            value = env_map.get(name)
            if value:
                return value
    return None


def parse_pair_symbols(pool_pair: str | None) -> tuple[str | None, str | None]:
    if not isinstance(pool_pair, str) or "/" not in pool_pair:
        return None, None
    left, right = pool_pair.split("/", 1)
    right = right.replace(" (stable)", "").replace(" (volatile)", "")
    return left.strip() or None, right.strip() or None


def to_num(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def add_token_entry(
    bucket: dict[str, dict[str, float]],
    symbol: str,
    amount: float,
    usd: float | None = None,
) -> None:
    if not symbol:
        return
    row = bucket.setdefault(symbol, {"amount": 0.0, "usd": 0.0})
    row["amount"] += amount
    if isinstance(usd, (int, float)):
        row["usd"] += float(usd)


def fetch_prices_by_network(
    api_key: str | None,
    requests_session: requests.Session,
    addresses_by_network: dict[str, set[str]],
) -> tuple[dict[tuple[str, str], float | None], list[str]]:
    prices: dict[tuple[str, str], float | None] = {}
    warnings: list[str] = []
    if not api_key:
        warnings.append("Price lookup skipped: missing Alchemy API key.")
        return prices, warnings

    for network, addrs in addresses_by_network.items():
        addresses = sorted({a.lower() for a in addrs if isinstance(a, str) and a.startswith("0x") and len(a) == 42})
        if not addresses:
            continue
        url = f"https://api.g.alchemy.com/prices/v1/{api_key}/tokens/by-address"
        payload = {"addresses": [{"network": network, "address": addr} for addr in addresses]}
        try:
            resp = requests_session.post(url, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json().get("data", []) or []
            seen: set[str] = set()
            for item in data:
                addr = str(item.get("address") or "").lower()
                if not addr:
                    continue
                usd_value = None
                for price_item in item.get("prices", []) or []:
                    if str(price_item.get("currency") or "").lower() != "usd":
                        continue
                    try:
                        usd_value = float(price_item.get("value"))
                    except Exception:
                        usd_value = None
                    break
                prices[(network, addr)] = usd_value
                seen.add(addr)
            for addr in addresses:
                if addr not in seen:
                    prices[(network, addr)] = None
        except Exception as exc:
            warnings.append(f"Price lookup failed for network {network}: {exc}")
            for addr in addresses:
                prices.setdefault((network, addr), None)
    return prices, warnings


def distribution_rows(bucket: dict[str, dict[str, float]]) -> list[dict[str, float | str]]:
    rows = []
    for symbol, values in bucket.items():
        rows.append({"token": symbol, "amount": float(values["amount"]), "usd": float(values["usd"])})
    rows.sort(key=lambda x: x["usd"], reverse=True)
    return rows


def summarize(args: argparse.Namespace) -> dict[str, Any]:
    portfolio = json.loads(args.portfolio_json.read_text(encoding="utf-8"))
    rows = list(portfolio.get(args.rows_source) or [])
    near_threshold = float(args.near_threshold)
    if near_threshold < 0:
        near_threshold = 0.0

    owner = portfolio.get("owner")
    warning_parts: list[str] = []
    vfat_error = str(portfolio.get("vfatClError") or "").strip()
    if vfat_error:
        warning_parts.append(vfat_error)

    api_key = resolve_api_key(args.alchemy_api_key, args.env_file)

    fees24_bucket: dict[str, dict[str, float]] = {}
    emissions24_bucket: dict[str, dict[str, float]] = {}
    emissions_now_bucket: dict[str, dict[str, float]] = {}

    positions: list[dict[str, Any]] = []
    out_of_range: list[dict[str, Any]] = []
    near_out_of_range: list[dict[str, Any]] = []
    range_na: list[dict[str, Any]] = []

    addresses_by_network: dict[str, set[str]] = {}
    pending_fee_usd_rows: list[dict[str, Any]] = []
    pending_em_now_rows: list[dict[str, Any]] = []

    for idx, row in enumerate(rows, start=1):
        pool_pair = row.get("poolPair")
        symbol0, symbol1 = parse_pair_symbols(pool_pair)
        chain_key = str(row.get("chainKey") or "").lower()
        network = CHAIN_TO_PRICE_NETWORK.get(chain_key)
        token0 = str(row.get("poolToken0") or "").lower()
        token1 = str(row.get("poolToken1") or "").lower()

        fees24_t0 = to_num(row.get("fees24hToken0"))
        fees24_t1 = to_num(row.get("fees24hToken1"))
        fees24_usd = to_num(row.get("fees24hUsd"))
        emissions24_usd = to_num(row.get("emissions24hUsd"))
        emissions_now_usd = to_num(row.get("vfatEmissionsClaimableNowUsd"))
        claimable_fees_now_usd = to_num(row.get("vfatFeesClaimableNowUsd"))
        claimable_total_now_usd = to_num(row.get("vfatClaimableNowUsd"))

        if claimable_total_now_usd is None:
            claimable_total_now_usd = (claimable_fees_now_usd or 0.0) + (emissions_now_usd or 0.0)
        past24_total_usd = (fees24_usd or 0.0) + (emissions24_usd or 0.0)

        lo = to_num(row.get("poolRangeLowerPrice"))
        hi = to_num(row.get("poolRangeUpperPrice"))
        cur = to_num(row.get("poolCurrentPrice"))
        in_range = row.get("vfatInRange")

        range_status = "range_n/a"
        nearest_edge = None
        margin = None
        if isinstance(lo, float) and isinstance(hi, float) and isinstance(cur, float) and hi > lo:
            if cur < lo or cur >= hi:
                range_status = "out_of_range"
            else:
                width = hi - lo
                dist_lower = cur - lo
                dist_upper = hi - cur
                nearest = min(dist_lower, dist_upper)
                margin = nearest / width if width > 0 else None
                nearest_edge = "lower" if dist_lower <= dist_upper else "upper"
                if isinstance(margin, float) and margin <= near_threshold:
                    range_status = "near_out_of_range"
                else:
                    range_status = "in_range"
        else:
            if in_range is False:
                range_status = "out_of_range"
            elif in_range is True:
                range_status = "in_range"

        position = {
            "index": idx,
            "poolPair": pool_pair,
            "protocol": row.get("protocol"),
            "chainName": row.get("chainName"),
            "tokenIdDecimal": row.get("tokenIdDecimal"),
            "depositedUsd": to_num(row.get("currentPoolUsd")),
            "claimableNow": {
                "feesUsd": claimable_fees_now_usd,
                "emissionsUsd": emissions_now_usd,
                "totalUsd": claimable_total_now_usd,
            },
            "past24h": {
                "feesUsd": fees24_usd,
                "emissionsUsd": emissions24_usd,
                "totalUsd": past24_total_usd,
            },
            "apr24hPct": to_num(row.get("apr24hPct")),
            "range": {
                "status": range_status,
                "nearThreshold": near_threshold,
                "nearestEdge": nearest_edge,
                "margin": margin,
                "marginPct": (margin * 100.0) if isinstance(margin, float) else None,
            },
            "metricsQuality": row.get("metricsQuality"),
            "metricsReason": row.get("metricsReason"),
        }
        positions.append(position)

        range_item = {
            "poolPair": position["poolPair"],
            "protocol": position["protocol"],
            "chainName": position["chainName"],
            "tokenIdDecimal": position["tokenIdDecimal"],
            "nearestEdge": position["range"]["nearestEdge"],
            "marginPct": position["range"]["marginPct"],
        }
        if range_status == "out_of_range":
            out_of_range.append(range_item)
        elif range_status == "near_out_of_range":
            near_out_of_range.append(range_item)
        elif range_status == "range_n/a":
            range_na.append(range_item)

        # Fees 24h token amounts.
        if isinstance(fees24_t0, float) and fees24_t0 != 0 and symbol0:
            add_token_entry(fees24_bucket, symbol0, fees24_t0, None)
            if network and token0:
                addresses_by_network.setdefault(network, set()).add(token0)
                pending_fee_usd_rows.append({"symbol": symbol0, "network": network, "address": token0, "amount": fees24_t0})
        if isinstance(fees24_t1, float) and fees24_t1 != 0 and symbol1:
            add_token_entry(fees24_bucket, symbol1, fees24_t1, None)
            if network and token1:
                addresses_by_network.setdefault(network, set()).add(token1)
                pending_fee_usd_rows.append({"symbol": symbol1, "network": network, "address": token1, "amount": fees24_t1})

        # Emissions 24h and emissions claimable now from breakdown.
        for item in row.get("emissions24hBreakdown") or []:
            symbol = str(item.get("symbol") or "").strip()
            token_addr = str(item.get("token") or "").lower()
            amount = to_num(item.get("amount"))
            usd = to_num(item.get("usd"))
            pending_now = to_num(item.get("pendingNow"))
            if symbol and isinstance(amount, float):
                add_token_entry(emissions24_bucket, symbol, amount, usd)
            if symbol and isinstance(pending_now, float):
                add_token_entry(emissions_now_bucket, symbol, pending_now, None)
                if network and token_addr:
                    addresses_by_network.setdefault(network, set()).add(token_addr)
                    pending_em_now_rows.append(
                        {"symbol": symbol, "network": network, "address": token_addr, "amount": pending_now}
                    )

    session = requests.Session()
    prices, price_warnings = fetch_prices_by_network(api_key, session, addresses_by_network)
    warning_parts.extend(price_warnings)

    for item in pending_fee_usd_rows:
        price = prices.get((item["network"], item["address"]))
        if isinstance(price, (int, float)):
            add_token_entry(fees24_bucket, item["symbol"], 0.0, float(item["amount"]) * float(price))
    for item in pending_em_now_rows:
        price = prices.get((item["network"], item["address"]))
        if isinstance(price, (int, float)):
            add_token_entry(emissions_now_bucket, item["symbol"], 0.0, float(item["amount"]) * float(price))

    combined24_bucket: dict[str, dict[str, float]] = {}
    for symbol, values in fees24_bucket.items():
        add_token_entry(combined24_bucket, symbol, values["amount"], values["usd"])
    for symbol, values in emissions24_bucket.items():
        add_token_entry(combined24_bucket, symbol, values["amount"], values["usd"])

    totals = {
        "depositedUsd": sum((to_num(p.get("depositedUsd")) or 0.0) for p in positions),
        "claimableNowUsd": sum((to_num((p.get("claimableNow") or {}).get("totalUsd")) or 0.0) for p in positions),
        "fees24hUsd": sum((to_num((p.get("past24h") or {}).get("feesUsd")) or 0.0) for p in positions),
        "emissions24hUsd": sum((to_num((p.get("past24h") or {}).get("emissionsUsd")) or 0.0) for p in positions),
    }
    totals["combined24hUsd"] = totals["fees24hUsd"] + totals["emissions24hUsd"]

    return {
        "owner": owner,
        "sourceFile": str(args.portfolio_json),
        "rowSource": args.rows_source,
        "rowCount": len(positions),
        "nearThreshold": near_threshold,
        "positions": positions,
        "rangeReport": {
            "outOfRange": out_of_range,
            "nearOutOfRange": near_out_of_range,
            "rangeNA": range_na,
            "counts": {
                "outOfRange": len(out_of_range),
                "nearOutOfRange": len(near_out_of_range),
                "rangeNA": len(range_na),
            },
        },
        "tokenDistribution": {
            "fees24h": distribution_rows(fees24_bucket),
            "emissions24h": distribution_rows(emissions24_bucket),
            "combined24h": distribution_rows(combined24_bucket),
            "emissionsClaimableNow": distribution_rows(emissions_now_bucket),
            "limitations": [
                "Claimable-now fees token split may be unavailable; only USD total can be reported in that case."
            ],
        },
        "totals": totals,
        "warnings": [w for w in warning_parts if w],
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Deterministic summary for DeFi scanner output JSON.")
    p.add_argument(
        "--portfolio-json",
        type=Path,
        default=Path("cli_uniswap_positions_json/vfat_output.json"),
        help="Path to scanner output JSON.",
    )
    p.add_argument(
        "--rows-source",
        choices=["openRows", "vfatClCurrentRows", "vfatV2CurrentRows"],
        default="openRows",
        help="Which row array to summarize.",
    )
    p.add_argument(
        "--near-threshold",
        type=float,
        default=0.10,
        help="Near-out-of-range threshold as fraction of range width (default 0.10 = 10%%).",
    )
    p.add_argument("--alchemy-api-key", default=None, help="Optional API key for token price lookup.")
    p.add_argument("--env-file", type=Path, default=Path(".env"), help="Optional .env path for alchemy key fallback.")
    p.add_argument("--output", type=Path, default=None, help="Optional output path for summary JSON.")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON.")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.portfolio_json.exists():
        raise FileNotFoundError(f"Portfolio JSON not found: {args.portfolio_json}")
    summary = summarize(args)
    text = json.dumps(
        summary,
        indent=2 if args.pretty else None,
        ensure_ascii=True,
        separators=None if args.pretty else (",", ":"),
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
