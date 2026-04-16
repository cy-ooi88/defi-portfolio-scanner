export function shortenAddress(address) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function shortenHash(hash) {
  if (!hash || typeof hash !== "string") {
    return "n/a";
  }
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return formatUsdWithRules(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatUsdFixed(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return formatUsdWithRules(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

export function toSubscriptDigits(text) {
  return String(text).split("").map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      return String.fromCodePoint(0x2080 + (code - 48));
    }
    return char;
  }).join("");
}

export function formatTinyUsd(absValue, shownDigits = 3) {
  if (!(absValue > 0) || absValue >= 0.01) {
    return null;
  }
  const fixed = absValue.toFixed(20);
  const decimalPart = fixed.includes(".") ? fixed.split(".")[1] : "";
  if (!decimalPart) {
    return null;
  }
  let zeroCount = 0;
  while (zeroCount < decimalPart.length && decimalPart[zeroCount] === "0") {
    zeroCount += 1;
  }
  if (zeroCount < 2 || zeroCount >= decimalPart.length) {
    return null;
  }
  const significantDigits = (decimalPart.slice(zeroCount) + "000").slice(0, shownDigits);
  return `0.0${toSubscriptDigits(String(zeroCount))}${significantDigits}`;
}

export function formatUsdWithRules(value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  const tinyDisplay = formatTinyUsd(absValue, 3);
  if (tinyDisplay) {
    return `${sign}$${tinyDisplay}`;
  }

  const resolvedMin = absValue < 1 ? Math.max(3, minimumFractionDigits) : minimumFractionDigits;
  const resolvedMax = absValue < 1 ? Math.max(3, maximumFractionDigits) : maximumFractionDigits;
  const amountText = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: resolvedMin,
    maximumFractionDigits: resolvedMax
  }).format(absValue);
  return `${sign}$${amountText}`;
}

export function formatToken(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const abs = Math.abs(value);
  const resolvedDecimals = abs >= 1000 ? 2 : abs >= 1 ? Math.min(decimals, 4) : 6;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: resolvedDecimals
  }).format(value);
}

export function formatPercent(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(value)}%`;
}

export function formatFeeTier(fee) {
  return `${(Number(fee) / 10000).toFixed(Number(fee) % 10000 === 0 ? 0 : 2)}%`;
}

export function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

export function formatTimeStamp(date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
