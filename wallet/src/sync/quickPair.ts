import type {
  AuthorityPayloadV0,
  AuthorityValidationOptions,
} from "./authorityPayload";
import {
  decryptRecoveryBundleV0,
  encryptRecoveryBundleV0,
  RECOVERY_BUNDLE_ITERATIONS_V0,
} from "./recoveryBundle";
import {
  SyncValidationError,
  canonicalJson,
  exactKeys,
  record,
  safeInteger,
  stringValue,
} from "./validation";

const MAX_AGE_SECONDS = 10 * 60;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BUNDLE_TYPE = "cashu-sync-full-recovery" as const;
const KDF_NAME = "PBKDF2-HMAC-SHA256" as const;
const CIPHER_NAME = "AES-256-GCM" as const;

export type QuickPairPayloadV0 = {
  v: 0;
  e: number;
  p: string;
  s: string;
  n: string;
  c: string;
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

function validateExpiry(value: unknown, path: string): number {
  const expires = safeInteger(value, path);
  if (
    expires < Math.floor(Date.now() / 1000) ||
    expires > Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS
  ) {
    throw new SyncValidationError("quick pair: expired or invalid expiry");
  }
  return expires;
}

function parseCompact(value: unknown): QuickPairPayloadV0 {
  const input = record(value, "quick pair");
  exactKeys(input, ["v", "e", "p", "s", "n", "c"], [], "quick pair");
  if (input.v !== 0) {
    throw new SyncValidationError("quick pair: unsupported version");
  }
  const expires = validateExpiry(input.e, "quick pair.e");
  const passphrase = stringValue(input.p, "quick pair.p", {
    min: 20,
    max: 256,
    pattern: BASE64URL,
  });
  const salt = stringValue(input.s, "quick pair.s", {
    min: 22,
    max: 22,
    pattern: BASE64URL,
  });
  const nonce = stringValue(input.n, "quick pair.n", {
    min: 16,
    max: 16,
    pattern: BASE64URL,
  });
  const ciphertext = stringValue(input.c, "quick pair.c", {
    min: 22,
    max: 32_768,
    pattern: BASE64URL,
  });
  return { v: 0, e: expires, p: passphrase, s: salt, n: nonce, c: ciphertext };
}

function parseLegacy(value: unknown): QuickPairPayloadV0 {
  const input = record(value, "quick pair");
  exactKeys(
    input,
    ["schema", "type", "expires_at", "passphrase", "bundle"],
    [],
    "quick pair"
  );
  if (input.schema !== 0 || input.type !== "cashu-sync-quick-pair") {
    throw new SyncValidationError("quick pair: unsupported type");
  }
  const expires = validateExpiry(input.expires_at, "quick pair.expires_at");
  const passphrase = stringValue(input.passphrase, "quick pair.passphrase", {
    min: 20,
    max: 256,
    pattern: BASE64URL,
  });
  const bundle = stringValue(input.bundle, "quick pair.bundle", {
    min: 1,
    max: 100_000,
  });
  const parsedBundle = record(JSON.parse(bundle), "quick pair.bundle");
  const kdf = record(parsedBundle.kdf, "quick pair.bundle.kdf");
  const cipher = record(parsedBundle.cipher, "quick pair.bundle.cipher");
  return {
    v: 0,
    e: expires,
    p: passphrase,
    s: stringValue(kdf.salt, "quick pair.bundle.kdf.salt", {
      min: 22,
      max: 22,
      pattern: BASE64URL,
    }),
    n: stringValue(cipher.nonce, "quick pair.bundle.cipher.nonce", {
      min: 16,
      max: 16,
      pattern: BASE64URL,
    }),
    c: stringValue(parsedBundle.ciphertext, "quick pair.bundle.ciphertext", {
      min: 22,
      max: 32_768,
      pattern: BASE64URL,
    }),
  };
}

function parse(value: unknown): QuickPairPayloadV0 {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  const input = record(raw, "quick pair");
  return Object.prototype.hasOwnProperty.call(input, "v")
    ? parseCompact(input)
    : parseLegacy(input);
}

function bundleFromCompact(payload: QuickPairPayloadV0): string {
  return canonicalJson({
    schema: 0,
    type: BUNDLE_TYPE,
    kdf: {
      name: KDF_NAME,
      iterations: RECOVERY_BUNDLE_ITERATIONS_V0,
      salt: payload.s,
    },
    cipher: { name: CIPHER_NAME, nonce: payload.n },
    ciphertext: payload.c,
  });
}

export async function createQuickPairV0(
  authority: AuthorityPayloadV0,
  options: AuthorityValidationOptions = {}
): Promise<string> {
  const passphrase = randomPassphrase();
  const bundle = record(
    JSON.parse(await encryptRecoveryBundleV0(authority, passphrase, options)),
    "recovery bundle"
  );
  const kdf = record(bundle.kdf, "recovery bundle.kdf");
  const cipher = record(bundle.cipher, "recovery bundle.cipher");
  const payload: QuickPairPayloadV0 = {
    v: 0,
    e: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
    p: passphrase,
    s: stringValue(kdf.salt, "recovery bundle.kdf.salt"),
    n: stringValue(cipher.nonce, "recovery bundle.cipher.nonce"),
    c: stringValue(bundle.ciphertext, "recovery bundle.ciphertext"),
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
  return decryptRecoveryBundleV0(
    bundleFromCompact(payload),
    payload.p,
    options
  );
}
