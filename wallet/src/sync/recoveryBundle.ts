import {
  decodeAuthorityPayloadV0,
  type AuthorityPayloadV0,
  type AuthorityValidationOptions,
} from "./authorityPayload";
import {
  SyncValidationError,
  canonicalJson,
  exactKeys,
  record,
  stringValue,
} from "./validation";

/** V0 fixes PBKDF2-HMAC-SHA256 at 600,000 iterations; imports cannot downgrade it. */
export const RECOVERY_BUNDLE_ITERATIONS_V0 = 600_000;
export const RECOVERY_PASSPHRASE_MIN_LENGTH = 10;
export const RECOVERY_PASSPHRASE_MAX_LENGTH = 1024;

const BUNDLE_TYPE = "cashu-sync-full-recovery" as const;
const KDF_NAME = "PBKDF2-HMAC-SHA256" as const;
const CIPHER_NAME = "AES-256-GCM" as const;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export class RecoveryBundleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RecoveryBundleError";
  }
}

export type RecoveryBundleV0 = {
  schema: 0;
  type: typeof BUNDLE_TYPE;
  kdf: {
    name: typeof KDF_NAME;
    iterations: typeof RECOVERY_BUNDLE_ITERATIONS_V0;
    salt: string;
  };
  cipher: {
    name: typeof CIPHER_NAME;
    nonce: string;
  };
  ciphertext: string;
};

export type RecoveryBundleOptions = AuthorityValidationOptions & {
  randomBytes?: (length: number) => Uint8Array;
};

function wrap<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RecoveryBundleError) throw error;
    if (error instanceof SyncValidationError) {
      throw new RecoveryBundleError(error.message, { cause: error });
    }
    throw error;
  }
}

function parseJson(value: unknown, path: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new RecoveryBundleError(`${path}: invalid JSON`, { cause: error });
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(
  value: unknown,
  path: string,
  expectedLength?: number
): Uint8Array {
  const encoded = stringValue(value, path, {
    min: 1,
    max: 32_768,
    pattern: BASE64URL,
  });
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch (error) {
    throw new RecoveryBundleError(`${path}: invalid base64url`, {
      cause: error,
    });
  }
  const result = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  if (base64url(result) !== encoded) {
    throw new RecoveryBundleError(`${path}: non-canonical base64url`);
  }
  if (expectedLength !== undefined && result.length !== expectedLength) {
    throw new RecoveryBundleError(
      `${path}: expected ${expectedLength} decoded bytes`
    );
  }
  return result;
}

function passphraseBytes(passphrase: unknown): Uint8Array {
  if (typeof passphrase !== "string") {
    throw new RecoveryBundleError("passphrase: expected a string");
  }
  const encoded = TEXT_ENCODER.encode(passphrase);
  if (
    encoded.length < RECOVERY_PASSPHRASE_MIN_LENGTH ||
    encoded.length > RECOVERY_PASSPHRASE_MAX_LENGTH
  ) {
    encoded.fill(0);
    throw new RecoveryBundleError(
      `passphrase: UTF-8 length must be between ${RECOVERY_PASSPHRASE_MIN_LENGTH} and ${RECOVERY_PASSPHRASE_MAX_LENGTH} bytes`
    );
  }
  return encoded;
}

function decodeBundle(value: unknown): RecoveryBundleV0 {
  return wrap(() => {
    const input = record(
      parseJson(value, "recovery bundle"),
      "recovery bundle"
    );
    exactKeys(
      input,
      ["schema", "type", "kdf", "cipher", "ciphertext"],
      [],
      "recovery bundle"
    );
    if (input.schema !== 0 || input.type !== BUNDLE_TYPE) {
      throw new RecoveryBundleError(
        "recovery bundle: unsupported schema or type"
      );
    }
    const kdf = record(input.kdf, "recovery bundle.kdf");
    exactKeys(kdf, ["name", "iterations", "salt"], [], "recovery bundle.kdf");
    if (
      kdf.name !== KDF_NAME ||
      kdf.iterations !== RECOVERY_BUNDLE_ITERATIONS_V0
    ) {
      throw new RecoveryBundleError(
        "recovery bundle.kdf: unsupported parameters"
      );
    }
    const cipher = record(input.cipher, "recovery bundle.cipher");
    exactKeys(cipher, ["name", "nonce"], [], "recovery bundle.cipher");
    if (cipher.name !== CIPHER_NAME) {
      throw new RecoveryBundleError("recovery bundle.cipher: unsupported name");
    }
    const salt = stringValue(kdf.salt, "recovery bundle.kdf.salt");
    const nonce = stringValue(cipher.nonce, "recovery bundle.cipher.nonce");
    decodeBase64url(salt, "recovery bundle.kdf.salt", SALT_BYTES);
    decodeBase64url(nonce, "recovery bundle.cipher.nonce", NONCE_BYTES);
    const ciphertext = stringValue(
      input.ciphertext,
      "recovery bundle.ciphertext",
      { min: 22, max: 32_768, pattern: BASE64URL }
    );
    const ciphertextBytes = decodeBase64url(
      ciphertext,
      "recovery bundle.ciphertext"
    );
    if (ciphertextBytes.length < 16) {
      throw new RecoveryBundleError(
        "recovery bundle.ciphertext: missing authentication tag"
      );
    }
    return {
      schema: 0,
      type: BUNDLE_TYPE,
      kdf: {
        name: KDF_NAME,
        iterations: RECOVERY_BUNDLE_ITERATIONS_V0,
        salt,
      },
      cipher: { name: CIPHER_NAME, nonce },
      ciphertext,
    };
  });
}

function aad(bundle: Omit<RecoveryBundleV0, "ciphertext">): Uint8Array {
  return TEXT_ENCODER.encode(canonicalJson(bundle));
}

async function deriveKey(
  passphrase: Uint8Array,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passphrase,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: RECOVERY_BUNDLE_ITERATIONS_V0,
      salt,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function randomBytes(
  length: number,
  source: RecoveryBundleOptions["randomBytes"]
): Uint8Array {
  const result = (
    source?.(length) ?? crypto.getRandomValues(new Uint8Array(length))
  ).slice();
  if (result.length !== length) {
    result.fill(0);
    throw new RecoveryBundleError(`random source: expected ${length} bytes`);
  }
  return result;
}

export async function encryptRecoveryBundleV0(
  authorityValue: unknown,
  passphrase: unknown,
  options: RecoveryBundleOptions = {}
): Promise<string> {
  const authority = wrap(() =>
    decodeAuthorityPayloadV0(authorityValue, options)
  );
  const password = passphraseBytes(passphrase);
  const salt = randomBytes(SALT_BYTES, options.randomBytes);
  const nonce = randomBytes(NONCE_BYTES, options.randomBytes);
  try {
    const header: Omit<RecoveryBundleV0, "ciphertext"> = {
      schema: 0,
      type: BUNDLE_TYPE,
      kdf: {
        name: KDF_NAME,
        iterations: RECOVERY_BUNDLE_ITERATIONS_V0,
        salt: base64url(salt),
      },
      cipher: { name: CIPHER_NAME, nonce: base64url(nonce) },
    };
    const key = await deriveKey(password, salt);
    const plaintext = TEXT_ENCODER.encode(canonicalJson(authority));
    try {
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad(header) },
        key,
        plaintext
      );
      return canonicalJson({
        ...header,
        ciphertext: base64url(new Uint8Array(encrypted)),
      });
    } finally {
      plaintext.fill(0);
    }
  } finally {
    password.fill(0);
    salt.fill(0);
    nonce.fill(0);
  }
}

export async function decryptRecoveryBundleV0(
  bundleValue: unknown,
  passphrase: unknown,
  options: AuthorityValidationOptions = {}
): Promise<AuthorityPayloadV0> {
  const bundle = decodeBundle(bundleValue);
  const password = passphraseBytes(passphrase);
  const salt = decodeBase64url(bundle.kdf.salt, "recovery bundle.kdf.salt");
  const nonce = decodeBase64url(
    bundle.cipher.nonce,
    "recovery bundle.cipher.nonce"
  );
  const ciphertext = decodeBase64url(
    bundle.ciphertext,
    "recovery bundle.ciphertext"
  );
  try {
    const key = await deriveKey(password, salt);
    let plaintext: Uint8Array;
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: aad({
            schema: bundle.schema,
            type: bundle.type,
            kdf: bundle.kdf,
            cipher: bundle.cipher,
          }),
        },
        key,
        ciphertext
      );
      plaintext = new Uint8Array(decrypted);
    } catch (error) {
      throw new RecoveryBundleError("recovery bundle authentication failed", {
        cause: error,
      });
    }
    try {
      const decoded = JSON.parse(TEXT_DECODER.decode(plaintext));
      return wrap(() => decodeAuthorityPayloadV0(decoded, options));
    } catch (error) {
      if (error instanceof RecoveryBundleError) throw error;
      throw new RecoveryBundleError("recovery bundle plaintext is invalid", {
        cause: error,
      });
    } finally {
      plaintext.fill(0);
    }
  } finally {
    password.fill(0);
    salt.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
  }
}
