---
name: defi-positions-summary
description: Discover and summarize DeFi LP positions by running `cli_uniswap_positions_json/uniswap_positions_cli.py`, then report deposited value, claimable now (fees plus emissions), 24h totals, APR, token-level fee/emission distribution, out-of-range pools, and near-out-of-range pools. Use when the user asks to read API key and wallet from a file (for example `.env`) and return actionable portfolio monitoring summaries.
---

# Defi Positions Summary

## Overview

Run the local Python scanner, generate portfolio JSON, and return a concise operational summary for monitoring LP health, rewards, and range risk.

Use `scripts/summarize_positions.py` for deterministic computation of range-risk and token distribution.

## Workflow

1. Resolve inputs.
- If the user provides a file path, read it and extract API key and wallet(s).
- Common key names: `ALCHEMY_API_KEY`, `alchemy_key`.
- Common wallet names: `default_wallet`, `default_wallet_1`, `wallet`.
- If values are missing, ask for the missing piece only.

2. Run discovery unless user explicitly says to reuse an existing JSON.
- Execute:
```powershell
python cli_uniswap_positions_json/uniswap_positions_cli.py --alchemy-api-key <KEY> --wallet <WALLET> --output cli_uniswap_positions_json/vfat_output.json --pretty
```
- If multiple wallets are present, run one command with repeated `--wallet` args or summarize one wallet at a time.

3. Load output JSON and select rows.
- Default to `openRows`.
- If requested, use `vfatClCurrentRows` or `vfatV2CurrentRows`.
- Prefer deterministic summary script:
```powershell
python defi-positions-summary/scripts/summarize_positions.py --portfolio-json cli_uniswap_positions_json/vfat_output.json --rows-source openRows --near-threshold 0.10 --pretty --output cli_uniswap_positions_json/positions_summary.json
```

4. Compute per-position summary fields.
- Pool: `poolPair`
- Deposited USD: `currentPoolUsd`
- Claimable now:
  - fees USD: `vfatFeesClaimableNowUsd`
  - emissions USD: `vfatEmissionsClaimableNowUsd`
  - total USD: `vfatClaimableNowUsd` if present, else `(fees + emissions)`
- Past 24h:
  - fees USD: `fees24hUsd`
  - emissions USD: `emissions24hUsd`
  - total USD: `(fees24hUsd + emissions24hUsd)`
- APR: `apr24hPct`

5. Compute range-risk classification.
- Base status:
  - `out_of_range` when `vfatInRange == false`
  - `in_range` when `vfatInRange == true`
  - `range_n/a` when `vfatInRange == null`
- Near-out-of-range logic for CL rows with numeric bounds:
  - `width = poolRangeUpperPrice - poolRangeLowerPrice`
  - `distLower = poolCurrentPrice - poolRangeLowerPrice`
  - `distUpper = poolRangeUpperPrice - poolCurrentPrice`
  - `nearest = min(distLower, distUpper)`
  - `margin = nearest / width`
  - Default near threshold: `0.10` (10%).
  - Mark `near_out_of_range` when `vfatInRange == true` and `margin <= threshold`.
  - Include nearest edge (`lower` or `upper`) and margin percentage.
- If bounds are missing (for example Aerodrome V2), keep `range_n/a`.

6. Compute token-level distribution breakdown.
- Fees 24h token distribution:
  - Use `fees24hToken0`, `fees24hToken1` amounts.
  - Use `poolPair` and `poolToken0/poolToken1` to label token symbols.
  - USD can come directly from known fees USD per token or via token price lookup.
- Emissions 24h token distribution:
  - Use `emissions24hBreakdown[]` fields:
    - `symbol`, `amount`, `usd`, `pendingNow`
- Claimable now emissions distribution:
  - Aggregate `pendingNow` from `emissions24hBreakdown[]`.
- Combined 24h distribution:
  - Aggregate `(fees token map + emissions token map)` by symbol.
- Important limitation:
  - Claimable-now fees token split is not always available in output JSON.
  - When unavailable, report fees claimable now only as USD total.

7. Return output in sections.
- Position table: pair, deposited, claimable now (fees + emissions), past 24h (fees + emissions), APR.
- Range report:
  - Out-of-range pools list.
  - Near-out-of-range pools list with edge + margin.
- Token distribution report:
  - Fees 24h by token, emissions 24h by token, combined 24h by token.
  - Emissions claimable now by token.
  - Format example: `WETH: 0.005 ($12.34)`.

8. Add portfolio totals.
- Total deposited
- Total claimable now
- Total 24h fees
- Total 24h emissions
- Total 24h combined

## Script

`scripts/summarize_positions.py` output sections:
- `positions`: per-pool table data (deposited, claimable now, 24h, APR, range status)
- `rangeReport`: out-of-range, near-out-of-range, and range-n/a lists
- `tokenDistribution`: fees24h, emissions24h, combined24h, emissionsClaimableNow
- `totals`: aggregated USD totals
- `warnings`: scanner and price lookup warnings

Common command:
```powershell
python defi-positions-summary/scripts/summarize_positions.py --portfolio-json cli_uniswap_positions_json/vfat_output.json --pretty
```

## Output Rules

- Mask secrets: never print full API key; if needed show last 4 only.
- Preserve input row ordering unless the user asks to sort.
- Do not invent missing values; show `n/a` for missing per-row fields.
- Round display values for readability (normally 2-4 decimals), but keep internal arithmetic precise.
- If row count in the summary differs from expected count, state the mismatch explicitly.
- If `metricsQuality`/`metricsReason` indicates partial data, mention that briefly.
- If scanner returns `vfatClError`, include it as a warning line.
- If near-threshold is user-specified, use it and state it explicitly.

## Quick Prompts

- "Use the API key and wallet in `.env`, run discovery, summarize positions, and tell me which pools are out of range."
- "Use `cli_uniswap_positions_json/.env.prod`, scan wallet, then return deposited, claimable now, 24h totals, APR, and out-of-range pools."
- "Reuse `cli_uniswap_positions_json/vfat_output.json` only, summarize and list out-of-range pools."
- "Show which pools are near out-of-range using a 10% threshold."
- "Break down fees and emissions by token like `WETH: amount ($usd)` and include combined 24h totals."
