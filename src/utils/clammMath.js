const MaxUint256 = (2n ** 256n) - 1n;
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;

export function tickToPrice(tick, token0Decimals, token1Decimals) {
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function subIn256(a, b) {
  return a >= b ? a - b : (MaxUint256 - (b - a)) + 1n;
}

export function getSqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error(`Tick out of range: ${tick}`);
  }

  let absTick = BigInt(tick < 0 ? -tick : tick);
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) {
    ratio = MaxUint256 / ratio;
  }

  const result = ratio >> 32n;
  return (ratio & ((1n << 32n) - 1n)) === 0n ? result : result + 1n;
}

export function getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  let sqrtA = sqrtRatioAX96;
  let sqrtB = sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 <= sqrtA) {
    amount0 = ((liquidity * (sqrtB - sqrtA)) * Q96) / sqrtB / sqrtA;
  } else if (sqrtPriceX96 < sqrtB) {
    amount0 = ((liquidity * (sqrtB - sqrtPriceX96)) * Q96) / sqrtB / sqrtPriceX96;
    amount1 = (liquidity * (sqrtPriceX96 - sqrtA)) / Q96;
  } else {
    amount1 = (liquidity * (sqrtB - sqrtA)) / Q96;
  }

  return { amount0, amount1 };
}

export function getClaimableAmounts(position, poolState) {
  const feeGrowthGlobal0 = BigInt(poolState.feeGrowthGlobal0);
  const feeGrowthGlobal1 = BigInt(poolState.feeGrowthGlobal1);
  const feeGrowthOutsideLower0 = BigInt(poolState.lowerTick.feeGrowthOutside0X128);
  const feeGrowthOutsideLower1 = BigInt(poolState.lowerTick.feeGrowthOutside1X128);
  const feeGrowthOutsideUpper0 = BigInt(poolState.upperTick.feeGrowthOutside0X128);
  const feeGrowthOutsideUpper1 = BigInt(poolState.upperTick.feeGrowthOutside1X128);
  const tickCurrent = Number(poolState.slot0.tick);
  const tickLower = Number(position.tickLower);
  const tickUpper = Number(position.tickUpper);
  const liquidity = BigInt(position.liquidity);

  const feeGrowthBelow0 = tickCurrent >= tickLower ? feeGrowthOutsideLower0 : subIn256(feeGrowthGlobal0, feeGrowthOutsideLower0);
  const feeGrowthBelow1 = tickCurrent >= tickLower ? feeGrowthOutsideLower1 : subIn256(feeGrowthGlobal1, feeGrowthOutsideLower1);
  const feeGrowthAbove0 = tickCurrent < tickUpper ? feeGrowthOutsideUpper0 : subIn256(feeGrowthGlobal0, feeGrowthOutsideUpper0);
  const feeGrowthAbove1 = tickCurrent < tickUpper ? feeGrowthOutsideUpper1 : subIn256(feeGrowthGlobal1, feeGrowthOutsideUpper1);

  const feeGrowthInside0 = subIn256(subIn256(feeGrowthGlobal0, feeGrowthBelow0), feeGrowthAbove0);
  const feeGrowthInside1 = subIn256(subIn256(feeGrowthGlobal1, feeGrowthBelow1), feeGrowthAbove1);

  const pending0 = BigInt(position.tokensOwed0) + (liquidity * subIn256(feeGrowthInside0, BigInt(position.feeGrowthInside0LastX128))) / Q128;
  const pending1 = BigInt(position.tokensOwed1) + (liquidity * subIn256(feeGrowthInside1, BigInt(position.feeGrowthInside1LastX128))) / Q128;

  return { amount0: pending0, amount1: pending1 };
}
