# Uniswap Positions CLI (Pure Python)

This CLI reads wallet-held CL position NFTs on Base + BSC using Alchemy RPC + price APIs, then returns JSON in a webapp-like schema.

## What it does

- Inputs: Alchemy API key + wallet address(es)
- Scans configured CL position managers from `app.js` (with optional BSC manager overrides from `bsc_vfat_constants.json`)
- Computes:
  - pool value (`currentPoolUsd`)
  - claimable fees now (`vfatClaimableNowUsd`)
  - in-range flags and summary totals
- Outputs merged JSON similar to `fetchPortfolio(...)`

## Current limitation

- VFat current-position discovery is implemented (CL + Aerodrome V2 position rows).
- 24h fee/emissions/APR metrics are implemented for VFat CL and Aerodrome V2 rows.
- `vfatClError` now only reports runtime scan/enrichment issues (if any).

## Install

```bash
pip install -r requirements.txt
```

## Usage

Single wallet:

```bash
python uniswap_positions_cli.py --alchemy-api-key YOUR_KEY --wallet 0xYourWallet --pretty
```

Multiple wallets:

```bash
python uniswap_positions_cli.py --alchemy-api-key YOUR_KEY --wallet 0xWalletA --wallet 0xWalletB --pretty
```

Wallet file:

```bash
python uniswap_positions_cli.py --alchemy-api-key YOUR_KEY --wallet-file wallets.txt --pretty
```

Write output:

```bash
python uniswap_positions_cli.py --alchemy-api-key YOUR_KEY --wallet 0xYourWallet --output out.json --pretty
```

Env var:

```bash
export ALCHEMY_API_KEY=YOUR_KEY
python uniswap_positions_cli.py --wallet 0xYourWallet --pretty
```
