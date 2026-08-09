export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

export function firstDefined(record: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

/**
 * Reads the first defined value and requires a non-blank string.
 * Returns the original (untrimmed) value.
 */
export function readString(record: UnknownRecord, ...keys: string[]): string | undefined {
  const value = firstDefined(record, ...keys);
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Scans keys in order and returns the first non-blank string, trimmed.
 * Unlike `readString`, a defined-but-wrong-typed value on an earlier key
 * does not stop the scan.
 */
export function readTrimmedString(record: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function readNumber(record: UnknownRecord, ...keys: string[]): number | undefined {
  const value = firstDefined(record, ...keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function readBoolean(record: UnknownRecord, ...keys: string[]): boolean | undefined {
  const value = firstDefined(record, ...keys);
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Scans keys in order and returns the first boolean value.
 * Unlike `readBoolean`, a defined-but-non-boolean value on an earlier key
 * does not stop the scan.
 */
export function readScannedBoolean(record: UnknownRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

export function readTimestamp(record: UnknownRecord, ...keys: string[]): number | undefined {
  const value = firstDefined(record, ...keys);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}
