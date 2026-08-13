const TEXT_ENCODER = new TextEncoder();

export class SyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncValidationError";
  }
}

export function fail(path: string, message: string): never {
  throw new SyncValidationError(`${path}: ${message}`);
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string
) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "unknown field");
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${path}.${key}`, "missing field");
    }
  }
}

export function stringValue(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {}
): string {
  if (typeof value !== "string") fail(path, "expected a string");
  const min = options.min ?? 0;
  const max = options.max ?? 16_384;
  if (value.length < min || value.length > max) {
    fail(path, `length must be between ${min} and ${max}`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    fail(path, "invalid format");
  }
  return value;
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

export function safeInteger(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {}
): number {
  if (!Number.isSafeInteger(value)) fail(path, "expected a safe integer");
  const numberValue = value as number;
  if (
    numberValue < (options.min ?? 0) ||
    numberValue > (options.max ?? Number.MAX_SAFE_INTEGER)
  ) {
    fail(path, "integer outside allowed range");
  }
  return numberValue;
}

export function decimalAmount(value: unknown, path: string): string {
  const result = stringValue(value, path, { min: 1, max: 20 });
  if (!/^(0|[1-9]\d*)$/.test(result)) {
    fail(path, "expected a canonical non-negative decimal integer");
  }
  return result;
}

export function arrayValue(
  value: unknown,
  path: string,
  max = 10_000
): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (value.length > max) fail(path, `array exceeds ${max} entries`);
  return value;
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function nullable<T>(
  value: unknown,
  decode: (input: unknown) => T
): T | null {
  return value === null ? null : decode(value);
}

export function utf8Length(value: string): number {
  return TEXT_ENCODER.encode(value).length;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}
