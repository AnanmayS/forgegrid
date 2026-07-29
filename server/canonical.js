import { createHash } from "node:crypto";

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function shortDigest(value) {
  return digest(value).slice(0, 12);
}
