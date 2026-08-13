import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import {
  decodeAuthorityPayloadV0,
  decodeUnixSeconds,
  type AuthorityPayloadV0,
  type AuthorityValidationOptions,
} from "./authorityPayload";
import { bytesToHex } from "./syncCrypto";
import {
  SyncValidationError,
  exactKeys,
  record,
  stringValue,
} from "./validation";

export const PAIRING_TTL_SECONDS_V0 = 300;
const PAIRING_REQUEST_TYPE = "cashu-sync-pairing-request" as const;
const PAIRING_RESPONSE_TYPE = "cashu-sync-pairing-response" as const;
const HEX_PUBLIC_KEY = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class PairingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PairingError";
  }
}

export type PairingRequestV0 = {
  schema: 0;
  type: typeof PAIRING_REQUEST_TYPE;
  challenge: string;
  ephemeral_pubkey: string;
  expires_at: number;
};

export type PairingResponseV0 = {
  schema: 0;
  type: typeof PAIRING_RESPONSE_TYPE;
  challenge: string;
  request_pubkey: string;
  response_pubkey: string;
  expires_at: number;
  ciphertext: string;
};

type PairingPlaintextV0 = AuthorityPayloadV0 & {
  type: "cashu-sync-pairing-authority";
  challenge: string;
  request_pubkey: string;
  response_pubkey: string;
  expires_at: number;
};

export type PairingHooks = {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  ephemeralSecret?: () => Uint8Array;
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function challenge(value: unknown, path: string): string {
  const result = stringValue(value, path, {
    min: 43,
    max: 43,
    pattern: BASE64URL,
  });
  const decoded = atob(result.replace(/-/g, "+").replace(/_/g, "/") + "=");
  if (decoded.length !== 32)
    throw new PairingError(`${path}: expected 32 bytes`);
  if (
    base64url(
      Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    ) !== result
  ) {
    throw new PairingError(`${path}: non-canonical base64url`);
  }
  return result;
}

function publicKey(value: unknown, path: string): string {
  const result = stringValue(value, path, {
    min: 64,
    max: 64,
    pattern: HEX_PUBLIC_KEY,
  });
  try {
    nip44.v2.utils.getConversationKey("1".repeat(64), result);
  } catch {
    throw new PairingError(`${path}: invalid public key`);
  }
  return result;
}

function parseJson(value: unknown, path: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new PairingError(`${path}: invalid JSON`);
  }
}

function wrap<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof PairingError) throw error;
    if (error instanceof SyncValidationError) {
      throw new PairingError(error.message, { cause: error });
    }
    throw error;
  }
}

export function decodePairingRequestV0(value: unknown): PairingRequestV0 {
  return wrap(() => {
    const input = record(
      parseJson(value, "pairing request"),
      "pairing request"
    );
    exactKeys(
      input,
      ["schema", "type", "challenge", "ephemeral_pubkey", "expires_at"],
      [],
      "pairing request"
    );
    if (input.schema !== 0 || input.type !== PAIRING_REQUEST_TYPE) {
      throw new PairingError("pairing request: unsupported schema or type");
    }
    return {
      schema: 0,
      type: PAIRING_REQUEST_TYPE,
      challenge: challenge(input.challenge, "pairing request.challenge"),
      ephemeral_pubkey: publicKey(
        input.ephemeral_pubkey,
        "pairing request.ephemeral_pubkey"
      ),
      expires_at: decodeUnixSeconds(
        input.expires_at,
        "pairing request.expires_at"
      ),
    };
  });
}

function decodeResponse(value: unknown): PairingResponseV0 {
  return wrap(() => {
    const input = record(
      parseJson(value, "pairing response"),
      "pairing response"
    );
    exactKeys(
      input,
      [
        "schema",
        "type",
        "challenge",
        "request_pubkey",
        "response_pubkey",
        "expires_at",
        "ciphertext",
      ],
      [],
      "pairing response"
    );
    if (input.schema !== 0 || input.type !== PAIRING_RESPONSE_TYPE) {
      throw new PairingError("pairing response: unsupported schema or type");
    }
    return {
      schema: 0,
      type: PAIRING_RESPONSE_TYPE,
      challenge: challenge(input.challenge, "pairing response.challenge"),
      request_pubkey: publicKey(
        input.request_pubkey,
        "pairing response.request_pubkey"
      ),
      response_pubkey: publicKey(
        input.response_pubkey,
        "pairing response.response_pubkey"
      ),
      expires_at: decodeUnixSeconds(
        input.expires_at,
        "pairing response.expires_at"
      ),
      ciphertext: stringValue(input.ciphertext, "pairing response.ciphertext", {
        min: 1,
        max: 16_384,
      }),
    };
  });
}

function pairingPlaintext(
  value: unknown,
  validation: AuthorityValidationOptions
): PairingPlaintextV0 {
  const input = record(value, "pairing plaintext");
  exactKeys(
    input,
    [
      "schema",
      "type",
      "mnemonic",
      "sync_secret",
      "mint_url",
      "relay_url",
      "head_event_id",
      "challenge",
      "request_pubkey",
      "response_pubkey",
      "expires_at",
    ],
    [],
    "pairing plaintext"
  );
  if (input.type !== "cashu-sync-pairing-authority") {
    throw new PairingError("pairing plaintext: unsupported type");
  }
  const authority = decodeAuthorityPayloadV0(
    {
      schema: input.schema,
      mnemonic: input.mnemonic,
      sync_secret: input.sync_secret,
      mint_url: input.mint_url,
      relay_url: input.relay_url,
      head_event_id: input.head_event_id,
    },
    validation,
    "pairing plaintext"
  );
  return {
    ...authority,
    type: "cashu-sync-pairing-authority",
    challenge: challenge(input.challenge, "pairing plaintext.challenge"),
    request_pubkey: publicKey(
      input.request_pubkey,
      "pairing plaintext.request_pubkey"
    ),
    response_pubkey: publicKey(
      input.response_pubkey,
      "pairing plaintext.response_pubkey"
    ),
    expires_at: decodeUnixSeconds(
      input.expires_at,
      "pairing plaintext.expires_at"
    ),
  };
}

export function createPairingResponseV0(
  requestValue: unknown,
  authorityValue: unknown,
  options: PairingHooks & AuthorityValidationOptions = {}
): string {
  return wrap(() => {
    const request = decodePairingRequestV0(requestValue);
    const now = options.now?.() ?? Math.floor(Date.now() / 1000);
    if (
      now >= request.expires_at ||
      request.expires_at > now + PAIRING_TTL_SECONDS_V0
    ) {
      throw new PairingError("pairing request expired or exceeds v0 TTL");
    }
    const authority = decodeAuthorityPayloadV0(authorityValue, options);
    const secret = (options.ephemeralSecret?.() ?? generateSecretKey()).slice();
    try {
      const responsePubkey = getPublicKey(secret);
      const plaintext: PairingPlaintextV0 = {
        ...authority,
        type: "cashu-sync-pairing-authority",
        challenge: request.challenge,
        request_pubkey: request.ephemeral_pubkey,
        response_pubkey: responsePubkey,
        expires_at: request.expires_at,
      };
      const conversationKey = nip44.v2.utils.getConversationKey(
        bytesToHex(secret),
        request.ephemeral_pubkey
      );
      const nonce = options.randomBytes
        ? options.randomBytes(32).slice()
        : undefined;
      try {
        if (nonce && nonce.length !== 32) {
          throw new PairingError("NIP-44 nonce randomness must be 32 bytes");
        }
        const response: PairingResponseV0 = {
          schema: 0,
          type: PAIRING_RESPONSE_TYPE,
          challenge: request.challenge,
          request_pubkey: request.ephemeral_pubkey,
          response_pubkey: responsePubkey,
          expires_at: request.expires_at,
          ciphertext: nip44.v2.encrypt(
            JSON.stringify(plaintext),
            conversationKey,
            nonce
          ),
        };
        return JSON.stringify(response);
      } finally {
        nonce?.fill(0);
        conversationKey.fill(0);
      }
    } finally {
      secret.fill(0);
    }
  });
}

export class PairingSessionV0 {
  private consumed = false;
  private secret: Uint8Array;
  private readonly request: PairingRequestV0;
  readonly validation: AuthorityValidationOptions;

  private constructor(
    secret: Uint8Array,
    request: PairingRequestV0,
    validation: AuthorityValidationOptions
  ) {
    this.secret = secret;
    this.request = request;
    this.validation = validation;
  }

  static create(options: PairingHooks & AuthorityValidationOptions = {}) {
    const secret = (options.ephemeralSecret?.() ?? generateSecretKey()).slice();
    try {
      const random =
        options.randomBytes?.(32) ?? crypto.getRandomValues(new Uint8Array(32));
      if (random.length !== 32) {
        throw new PairingError("challenge randomness must be 32 bytes");
      }
      const now = options.now?.() ?? Math.floor(Date.now() / 1000);
      return new PairingSessionV0(
        secret,
        {
          schema: 0,
          type: PAIRING_REQUEST_TYPE,
          challenge: base64url(random),
          ephemeral_pubkey: getPublicKey(secret),
          expires_at: now + PAIRING_TTL_SECONDS_V0,
        },
        { allowLoopbackHttp: options.allowLoopbackHttp }
      );
    } catch (error) {
      secret.fill(0);
      throw error;
    }
  }

  get destroyed() {
    return this.secret.length === 0;
  }

  requestQrPayload(): string {
    if (this.destroyed) throw new PairingError("pairing session destroyed");
    return JSON.stringify(this.request);
  }

  consumeResponse(value: unknown, now = Math.floor(Date.now() / 1000)) {
    if (this.destroyed || this.consumed)
      throw new PairingError("pairing session destroyed");
    try {
      const response = decodeResponse(value);
      if (now >= this.request.expires_at || now >= response.expires_at) {
        throw new PairingError("pairing response expired");
      }
      if (response.challenge !== this.request.challenge) {
        throw new PairingError("pairing challenge mismatch");
      }
      if (
        response.request_pubkey !== this.request.ephemeral_pubkey ||
        response.expires_at !== this.request.expires_at
      ) {
        throw new PairingError("pairing request binding mismatch");
      }
      const conversationKey = nip44.v2.utils.getConversationKey(
        bytesToHex(this.secret),
        response.response_pubkey
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(
          nip44.v2.decrypt(response.ciphertext, conversationKey)
        );
      } catch (error) {
        throw new PairingError("pairing response authentication failed", {
          cause: error,
        });
      } finally {
        conversationKey.fill(0);
      }
      const plaintext = wrap(() => pairingPlaintext(decoded, this.validation));
      if (
        plaintext.challenge !== response.challenge ||
        plaintext.request_pubkey !== response.request_pubkey ||
        plaintext.response_pubkey !== response.response_pubkey ||
        plaintext.expires_at !== response.expires_at
      ) {
        throw new PairingError(
          "pairing response authenticated binding mismatch"
        );
      }
      this.consumed = true;
      const {
        type: _type,
        challenge: _challenge,
        request_pubkey: _request,
        response_pubkey: _response,
        expires_at: _expiry,
        ...authority
      } = plaintext;
      return authority;
    } finally {
      this.destroy();
    }
  }

  destroy() {
    this.secret.fill(0);
    this.secret = new Uint8Array(0);
    this.consumed = true;
  }
}
