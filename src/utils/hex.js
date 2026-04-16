export function parseHexToNumber(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }
  return Number.parseInt(value, 16) || 0;
}

export function resolveBlockNumberFromTag(tag) {
  if (typeof tag === "number" && Number.isFinite(tag)) {
    return tag;
  }
  if (typeof tag === "string" && tag.startsWith("0x")) {
    return parseHexToNumber(tag);
  }
  return null;
}

export function parseHexToBigInt(value) {
  if (!value || typeof value !== "string" || !value.startsWith("0x")) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function toBlockTag(value) {
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`;
  }
  return value || "latest";
}

export function readWord(data, index) {
  if (!data || typeof data !== "string" || !data.startsWith("0x")) {
    return null;
  }
  const stripped = data.slice(2);
  const offset = index * 64;
  if (stripped.length < offset + 64) {
    return null;
  }
  return stripped.slice(offset, offset + 64);
}

export function parseInt24FromWord(wordHex) {
  if (!wordHex || wordHex.length !== 64) {
    return null;
  }
  try {
    const value = Number.parseInt(wordHex.slice(58), 16);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value >= 0x800000 ? value - 0x1000000 : value;
  } catch {
    return null;
  }
}

export function encodeInt24Word(value) {
  const max = 2 ** 23;
  if (!Number.isInteger(value) || value < -max || value >= max) {
    throw new Error(`int24 out of range: ${value}`);
  }
  const encoded = value < 0 ? (2 ** 24) + value : value;
  return encoded.toString(16).padStart(64, "0");
}

export function parseWordToBigInt(wordHex) {
  if (!wordHex || wordHex.length !== 64) {
    return 0n;
  }
  try {
    return BigInt(`0x${wordHex}`);
  } catch {
    return 0n;
  }
}

export function parseTxSelector(inputData) {
  if (!inputData || typeof inputData !== "string" || !inputData.startsWith("0x") || inputData.length < 10) {
    return null;
  }
  return inputData.slice(0, 10).toLowerCase();
}
