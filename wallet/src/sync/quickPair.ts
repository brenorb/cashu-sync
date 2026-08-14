import type {
  AuthorityPayloadV0,
  AuthorityValidationOptions,
} from "./authorityPayload";
import {
  decryptRecoveryBundleV0,
  encryptRecoveryBundleV0,
} from "./recoveryBundle";
import {
  SyncValidationError,
  canonicalJson,
  exactKeys,
  record,
  safeInteger,
  stringValue,
} from "./validation";

const TYPE = "cashu-sync-quick-pair" as const;
const MAX_AGE_SECONDS = 10 * 60;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type QuickPairPayloadV0 = {
  schema: 0;
  type: typeof TYPE;
  expires_at: number;
  passphrase: string;
  bundle: string;
};

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(value: string): string {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function randomPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  try {
    let binary = "";
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } finally {
    bytes.fill(0);
  }
}

function parse(value: unknown): QuickPairPayloadV0 {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  const input = record(raw, "quick pair");
  exactKeys(
    input,
    ["schema", "type", "expires_at", "passphrase", "bundle"],
    [],
    "quick pair"
  );
  if (input.schema !== 0 || input.type !== TYPE) {
    throw new SyncValidationError("quick pair: unsupported type");
  }
  const expires = safeInteger(input.expires_at, "quick pair.expires_at");
  if (
    expires < Math.floor(Date.now() / 1000) ||
    expires > Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS
  ) {
    throw new SyncValidationError("quick pair: expired or invalid expiry");
  }
  const passphrase = stringValue(input.passphrase, "quick pair.passphrase", {
    min: 20,
    max: 256,
    pattern: BASE64URL,
  });
  const bundle = stringValue(input.bundle, "quick pair.bundle", {
    min: 1,
    max: 100_000,
  });
  return { schema: 0, type: TYPE, expires_at: expires, passphrase, bundle };
}

export async function createQuickPairV0(
  authority: AuthorityPayloadV0,
  options: AuthorityValidationOptions = {}
): Promise<string> {
  const passphrase = randomPassphrase();
  const payload: QuickPairPayloadV0 = {
    schema: 0,
    type: TYPE,
    expires_at: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
    passphrase,
    bundle: await encryptRecoveryBundleV0(authority, passphrase, options),
  };
  return encode(canonicalJson(payload));
}

export async function consumeQuickPairV0(
  value: unknown,
  options: AuthorityValidationOptions = {}
): Promise<AuthorityPayloadV0> {
  let decoded: string;
  try {
    decoded = decode(
      stringValue(value, "quick pair", { min: 1, max: 140_000 })
    );
  } catch (error) {
    throw new SyncValidationError(
      `quick pair: invalid payload${
        error instanceof Error ? ` (${error.message})` : ""
      }`
    );
  }
  let payload: QuickPairPayloadV0;
  try {
    payload = parse(decoded);
  } catch (error) {
    if (error instanceof SyncValidationError) throw error;
    throw new SyncValidationError("quick pair: invalid payload");
  }
  return decryptRecoveryBundleV0(payload.bundle, payload.passphrase, options);
}
