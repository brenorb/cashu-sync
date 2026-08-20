import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  type Event,
  type VerifiedEvent,
} from "nostr-tools";
import {
  decodeAuthorityPayloadV0,
  type AuthorityPayloadV0,
  type AuthorityValidationOptions,
} from "./authorityPayload";
import { bytesToHex } from "./syncCrypto";
import {
  canonicalJson,
  exactKeys,
  record,
  safeInteger,
  stringValue,
} from "./validation";

export const AUTO_PAIRING_TTL_SECONDS_V0 = 180;
const AUTO_PAIRING_RESPONSE_TIMEOUT_MS = 15_000;
const QR_TYPE = "cashu-sync-auto-pairing" as const;
const REQUEST_TYPE = "cashu-sync-auto-pairing-request" as const;
const RESPONSE_TYPE = "cashu-sync-auto-pairing-response" as const;
const ACK_TYPE = "cashu-sync-auto-pairing-ack" as const;
const GIFT_WRAP_KIND = 1059;
const SEAL_KIND = 13;
const RUMOR_KIND = 14;
const HEX = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const MAX_QR_CHARS = 2_000;

export class AutomaticPairingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AutomaticPairingError";
  }
}

export type AutoPairingQrV0 = {
  schema: 0;
  type: typeof QR_TYPE;
  pairing_id: string;
  challenge: string;
  request_pubkey: string;
  expires_at: number;
  relay_url: string;
};

type PairingRequestV0 = {
  schema: 0;
  type: typeof REQUEST_TYPE;
  pairing_id: string;
  challenge: string;
  request_pubkey: string;
  response_pubkey: string;
  expires_at: number;
};

type PairingEnvelopeV0 = Omit<PairingRequestV0, "type">;

type PairingResponseV0 = PairingEnvelopeV0 & {
  type: typeof RESPONSE_TYPE;
  authority: AuthorityPayloadV0;
};

type PairingAckV0 = PairingEnvelopeV0 & { type: typeof ACK_TYPE };

export interface PairingWebSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type PairingRelay = {
  publish(event: Event): Promise<void>;
  watch(
    recipientPubkey: string,
    onEvent: (event: Event) => void,
    onError?: (error: Error) => void
  ): () => void;
};

export type AutomaticPairingHooks = AuthorityValidationOptions & {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  ephemeralSecret?: () => Uint8Array;
  webSocketFactory?: (url: string) => PairingWebSocket;
  timeoutMs?: number;
  pairingTimeoutMs?: number;
};

function randomBytes(hooks: AutomaticPairingHooks, length: number): Uint8Array {
  const value =
    hooks.randomBytes?.(length) ??
    crypto.getRandomValues(new Uint8Array(length));
  if (value.length !== length)
    throw new AutomaticPairingError("pairing randomness has the wrong length");
  return value.slice();
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64(value: string, path: string): Uint8Array {
  if (!B64.test(value))
    throw new AutomaticPairingError(`${path}: invalid base64url`);
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (cause) {
    throw new AutomaticPairingError(`${path}: invalid base64url`, { cause });
  }
}

function publicKey(value: unknown, path: string): string {
  return stringValue(value, path, { min: 64, max: 64, pattern: HEX });
}

function token(value: unknown, path: string): string {
  const result = stringValue(value, path, { min: 43, max: 43, pattern: B64 });
  if (fromB64(result, path).length !== 32)
    throw new AutomaticPairingError(`${path}: expected 32 bytes`);
  return result;
}

function now(hooks: AutomaticPairingHooks): number {
  return hooks.now?.() ?? Math.floor(Date.now() / 1000);
}

function relayUrl(value: unknown, allowLoopbackHttp: boolean): string {
  const raw = stringValue(value, "pairing relay_url", { min: 1, max: 2_048 });
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new AutomaticPairingError("pairing relay_url: invalid URL", {
      cause,
    });
  }
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(url.hostname);
  if (
    url.protocol !== "wss:" &&
    !(allowLoopbackHttp && loopback && url.protocol === "ws:")
  ) {
    throw new AutomaticPairingError(
      "pairing relay_url: use wss:// (or explicit loopback ws://)"
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AutomaticPairingError("pairing relay_url: origin only");
  }
  return url.toString().replace(/\/$/, "");
}

function parseQr(
  value: unknown,
  hooks: AutomaticPairingHooks
): AutoPairingQrV0 {
  let raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "string" && raw.length > MAX_QR_CHARS)
    throw new AutomaticPairingError("pairing QR is too large");
  if (typeof raw === "string") {
    try {
      const url = new URL(raw, window.location.href);
      const encoded =
        url.searchParams.get("pairing") ??
        (url.hash.includes("?")
          ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1)).get(
              "pairing"
            )
          : null);
      if (encoded) {
        raw = JSON.parse(new TextDecoder().decode(fromB64(encoded, "pairing")));
      } else if (B64.test(raw)) {
        raw = JSON.parse(new TextDecoder().decode(fromB64(raw, "pairing")));
      }
    } catch {
      // Raw JSON is accepted for camera/copy testing.
    }
  }
  const input = record(
    typeof raw === "string" ? JSON.parse(raw) : raw,
    "pairing QR"
  );
  exactKeys(
    input,
    [
      "schema",
      "type",
      "pairing_id",
      "challenge",
      "request_pubkey",
      "expires_at",
      "relay_url",
    ],
    [],
    "pairing QR"
  );
  if (input.schema !== 0 || input.type !== QR_TYPE)
    throw new AutomaticPairingError("pairing QR: unsupported type");
  const expiry = safeInteger(input.expires_at, "pairing QR.expires_at");
  const current = now(hooks);
  if (expiry <= current || expiry > current + AUTO_PAIRING_TTL_SECONDS_V0)
    throw new AutomaticPairingError("pairing QR: expired");
  return {
    schema: 0,
    type: QR_TYPE,
    pairing_id: token(input.pairing_id, "pairing QR.pairing_id"),
    challenge: token(input.challenge, "pairing QR.challenge"),
    request_pubkey: publicKey(
      input.request_pubkey,
      "pairing QR.request_pubkey"
    ),
    expires_at: expiry,
    relay_url: relayUrl(input.relay_url, hooks.allowLoopbackHttp ?? false),
  };
}

export function decodeAutoPairingQrV0(
  value: unknown,
  hooks: AutomaticPairingHooks = {}
): AutoPairingQrV0 {
  try {
    return parseQr(value, hooks);
  } catch (error) {
    if (error instanceof AutomaticPairingError) throw error;
    throw new AutomaticPairingError("pairing QR: invalid payload", {
      cause: error,
    });
  }
}

export function encodeAutoPairingQrV0(value: AutoPairingQrV0): string {
  return canonicalJson(value);
}

export function createAutoPairingUrl(
  qr: AutoPairingQrV0,
  origin = window.location.href
): string {
  const url = new URL(origin);
  url.hash = `/settings/sync?pairing=${b64(
    new TextEncoder().encode(encodeAutoPairingQrV0(qr))
  )}`;
  return url.toString();
}

function eventRecipient(event: Event): string | null {
  const tag = event.tags.find((value) => value[0] === "p");
  return tag?.[1] ?? null;
}

function encrypt(
  plaintext: string,
  senderSecret: Uint8Array,
  recipient: string,
  hooks: AutomaticPairingHooks
): string {
  const key = nip44.v2.utils.getConversationKey(
    bytesToHex(senderSecret),
    recipient
  );
  const nonce = hooks.randomBytes ? randomBytes(hooks, 32) : undefined;
  try {
    return nip44.v2.encrypt(plaintext, key, nonce);
  } finally {
    key.fill(0);
    nonce?.fill(0);
  }
}

function decrypt(
  ciphertext: string,
  receiverSecret: Uint8Array,
  sender: string
): string {
  const key = nip44.v2.utils.getConversationKey(
    bytesToHex(receiverSecret),
    sender
  );
  try {
    return nip44.v2.decrypt(ciphertext, key);
  } finally {
    key.fill(0);
  }
}

function giftWrap(
  value: unknown,
  senderSecret: Uint8Array,
  recipient: string,
  hooks: AutomaticPairingHooks
): VerifiedEvent {
  const sealSecret = generateSecretKey();
  const giftSecret = generateSecretKey();
  try {
    const rumor = {
      kind: RUMOR_KIND,
      pubkey: getPublicKey(senderSecret),
      created_at: now(hooks),
      tags: [["p", recipient]],
      content: JSON.stringify(value),
    };
    const seal = finalizeEvent(
      {
        kind: SEAL_KIND,
        created_at: now(hooks),
        tags: [],
        content: encrypt(JSON.stringify(rumor), sealSecret, recipient, hooks),
      },
      sealSecret
    );
    return finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        created_at: now(hooks) - 1,
        tags: [["p", recipient]],
        content: encrypt(JSON.stringify(seal), giftSecret, recipient, hooks),
      },
      giftSecret
    );
  } finally {
    sealSecret.fill(0);
    giftSecret.fill(0);
  }
}

function openGift(event: Event, receiverSecret: Uint8Array): unknown {
  if (
    event.kind !== GIFT_WRAP_KIND ||
    !verifyEvent(event) ||
    !eventRecipient(event)
  )
    throw new AutomaticPairingError(
      "pairing relay event is not a valid gift wrap"
    );
  const seal = JSON.parse(decrypt(event.content, receiverSecret, event.pubkey));
  if (
    !seal ||
    seal.kind !== SEAL_KIND ||
    typeof seal.pubkey !== "string" ||
    typeof seal.content !== "string" ||
    !verifyEvent(seal)
  )
    throw new AutomaticPairingError("pairing seal is invalid");
  const rumor = JSON.parse(decrypt(seal.content, receiverSecret, seal.pubkey));
  if (
    !rumor ||
    rumor.kind !== RUMOR_KIND ||
    !Array.isArray(rumor.tags) ||
    !rumor.tags.some(
      (tag: unknown) =>
        Array.isArray(tag) && tag[0] === "p" && tag[1] === eventRecipient(event)
    )
  )
    throw new AutomaticPairingError("pairing rumor is invalid");
  return JSON.parse(rumor.content);
}

export class PairingRelayClient implements PairingRelay {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly factory: (url: string) => PairingWebSocket;

  constructor(options: {
    relayUrl: string;
    timeoutMs?: number;
    allowLoopbackHttp?: boolean;
    webSocketFactory?: (url: string) => PairingWebSocket;
  }) {
    this.url = relayUrlFn(options.relayUrl, options.allowLoopbackHttp ?? false);
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.factory =
      options.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as PairingWebSocket);
  }

  publish(event: Event): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: PairingWebSocket;
      try {
        socket = this.factory(this.url);
      } catch (cause) {
        reject(
          new AutomaticPairingError("pairing relay unavailable", { cause })
        );
        return;
      }
      const finish = (error?: Error) => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          /* noop */
        }
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(
        () => finish(new AutomaticPairingError("pairing relay timed out")),
        this.timeoutMs
      );
      socket.onopen = () => {
        try {
          socket.send(JSON.stringify(["EVENT", event]));
        } catch (cause) {
          finish(
            new AutomaticPairingError("pairing relay unavailable", { cause })
          );
        }
      };
      socket.onerror = () =>
        finish(new AutomaticPairingError("pairing relay unavailable"));
      socket.onclose = () =>
        finish(new AutomaticPairingError("pairing relay disconnected"));
      socket.onmessage = ({ data }) => {
        if (typeof data !== "string") return;
        try {
          const message = JSON.parse(data);
          if (
            Array.isArray(message) &&
            message[0] === "OK" &&
            message[1] === event.id
          ) {
            if (message[2] === true) finish();
            else
              finish(
                new AutomaticPairingError(
                  `pairing relay rejected event${
                    typeof message[3] === "string" ? `: ${message[3]}` : ""
                  }`
                )
              );
          }
        } catch {
          /* ignore unrelated frames */
        }
      };
    });
  }

  watch(
    recipientPubkey: string,
    onEvent: (event: Event) => void,
    onError?: (error: Error) => void
  ): () => void {
    let stopped = false;
    let socket: PairingWebSocket | null = null;
    try {
      socket = this.factory(this.url);
    } catch (cause) {
      throw new AutomaticPairingError("pairing relay unavailable", { cause });
    }
    const sub = `pair-${b64(crypto.getRandomValues(new Uint8Array(6)))}`;
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      stopped = true;
      if (connectionTimer !== null) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
      if (socket) {
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          /* noop */
        }
      }
    };
    connectionTimer = setTimeout(() => {
      if (!stopped && socket?.readyState !== 1) {
        onError?.(new AutomaticPairingError("pairing relay timed out"));
        close();
      }
    }, this.timeoutMs);
    socket.onopen = () => {
      if (connectionTimer !== null) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
      if (!stopped)
        socket?.send(
          JSON.stringify([
            "REQ",
            sub,
            { kinds: [GIFT_WRAP_KIND], "#p": [recipientPubkey], limit: 20 },
          ])
        );
    };
    socket.onmessage = ({ data }) => {
      if (stopped || typeof data !== "string") return;
      try {
        const message = JSON.parse(data);
        if (
          Array.isArray(message) &&
          message[0] === "EVENT" &&
          message[1] === sub &&
          message[2] &&
          message[2].kind === GIFT_WRAP_KIND &&
          eventRecipient(message[2]) === recipientPubkey
        )
          onEvent(message[2] as Event);
      } catch {
        /* ignore malformed/unrelated frames */
      }
    };
    socket.onerror = () => {
      if (!stopped)
        onError?.(new AutomaticPairingError("pairing relay unavailable"));
      close();
    };
    socket.onclose = () => {
      if (!stopped)
        onError?.(new AutomaticPairingError("pairing relay disconnected"));
      socket = null;
    };
    return close;
  }
}

function relayUrlFn(value: string, allowLoopbackHttp: boolean): string {
  return relayUrl(value, allowLoopbackHttp);
}

function pairRequest(
  value: AutoPairingQrV0,
  responseSecret: Uint8Array
): PairingRequestV0 {
  return {
    schema: 0,
    type: REQUEST_TYPE,
    pairing_id: value.pairing_id,
    challenge: value.challenge,
    request_pubkey: value.request_pubkey,
    response_pubkey: getPublicKey(responseSecret),
    expires_at: value.expires_at,
  };
}

export class AutoPairingHostSession {
  readonly qr: AutoPairingQrV0;
  private readonly secret: Uint8Array;
  private readonly hooks: AutomaticPairingHooks;
  private readonly relay: PairingRelay;
  private stopWatch: (() => void) | null = null;
  private handled = false;

  private constructor(
    secret: Uint8Array,
    qr: AutoPairingQrV0,
    relay: PairingRelay,
    hooks: AutomaticPairingHooks
  ) {
    this.secret = secret;
    this.qr = qr;
    this.relay = relay;
    this.hooks = hooks;
  }

  static create(options: {
    relayUrl: string;
    hooks?: AutomaticPairingHooks;
    relay?: PairingRelay;
  }): AutoPairingHostSession {
    const hooks = options.hooks ?? {};
    const secret = (hooks.ephemeralSecret?.() ?? generateSecretKey()).slice();
    const current = now(hooks);
    const qr: AutoPairingQrV0 = {
      schema: 0,
      type: QR_TYPE,
      pairing_id: b64(randomBytes(hooks, 32)),
      challenge: b64(randomBytes(hooks, 32)),
      request_pubkey: getPublicKey(secret),
      expires_at: current + AUTO_PAIRING_TTL_SECONDS_V0,
      relay_url: relayUrl(options.relayUrl, hooks.allowLoopbackHttp ?? false),
    };
    return new AutoPairingHostSession(
      secret,
      qr,
      options.relay ??
        new PairingRelayClient({
          relayUrl: qr.relay_url,
          allowLoopbackHttp: hooks.allowLoopbackHttp,
          webSocketFactory: hooks.webSocketFactory,
        }),
      hooks
    );
  }

  start(
    authorityValue: unknown,
    onComplete: () => void,
    onError: (error: Error) => void
  ): void {
    const authority = decodeAuthorityPayloadV0(authorityValue, this.hooks);
    try {
      this.stopWatch = this.relay.watch(
        this.qr.request_pubkey,
        (event) => {
          if (this.handled || now(this.hooks) >= this.qr.expires_at) return;
          let request: PairingRequestV0;
          try {
            request = record(
              openGift(event, this.secret),
              "pairing request"
            ) as PairingRequestV0;
            if (
              request.schema !== 0 ||
              request.type !== REQUEST_TYPE ||
              request.pairing_id !== this.qr.pairing_id ||
              request.challenge !== this.qr.challenge ||
              request.request_pubkey !== this.qr.request_pubkey ||
              request.expires_at !== this.qr.expires_at
            )
              throw new AutomaticPairingError(
                "pairing request binding mismatch"
              );
            publicKey(request.response_pubkey, "pairing response_pubkey");
          } catch {
            return;
          }
          this.handled = true;
          void (async () => {
            try {
              await this.relay.publish(
                giftWrap(
                  {
                    schema: 0,
                    type: RESPONSE_TYPE,
                    pairing_id: this.qr.pairing_id,
                    challenge: this.qr.challenge,
                    request_pubkey: this.qr.request_pubkey,
                    response_pubkey: request.response_pubkey,
                    expires_at: this.qr.expires_at,
                    authority,
                  },
                  this.secret,
                  request.response_pubkey,
                  this.hooks
                )
              );
              const stop = this.relay.watch(
                this.qr.request_pubkey,
                (ackEvent) => {
                  try {
                    const ack = record(
                      openGift(ackEvent, this.secret),
                      "pairing ack"
                    ) as PairingAckV0;
                    if (
                      ack.type === ACK_TYPE &&
                      ack.pairing_id === this.qr.pairing_id &&
                      ack.challenge === this.qr.challenge &&
                      ack.response_pubkey === request.response_pubkey
                    ) {
                      stop();
                      this.destroy();
                      onComplete();
                    }
                  } catch {
                    /* ignore replay/tamper */
                  }
                },
                (error) => {
                  stop();
                  this.destroy();
                  onError(error);
                }
              );
            } catch (error) {
              this.destroy();
              onError(
                error instanceof Error
                  ? error
                  : new AutomaticPairingError("pairing failed")
              );
            }
          })();
        },
        (error) => {
          if (!this.handled) {
            this.destroy();
            onError(error);
          }
        }
      );
    } catch (error) {
      this.destroy();
      onError(
        error instanceof Error
          ? error
          : new AutomaticPairingError("pairing relay unavailable")
      );
    }
  }

  destroy(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.secret.fill(0);
  }
}

export class AutoPairingJoinSession {
  readonly qr: AutoPairingQrV0;
  private readonly secret: Uint8Array;
  private readonly hooks: AutomaticPairingHooks;
  private readonly relay: PairingRelay;
  private stopWatch: (() => void) | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private completed = false;

  private constructor(
    qr: AutoPairingQrV0,
    secret: Uint8Array,
    relay: PairingRelay,
    hooks: AutomaticPairingHooks
  ) {
    this.qr = qr;
    this.secret = secret;
    this.relay = relay;
    this.hooks = hooks;
  }

  static fromQr(
    value: unknown,
    options: { hooks?: AutomaticPairingHooks; relay?: PairingRelay } = {}
  ): AutoPairingJoinSession {
    const hooks = options.hooks ?? {};
    const qr = decodeAutoPairingQrV0(value, hooks);
    const secret = (hooks.ephemeralSecret?.() ?? generateSecretKey()).slice();
    return new AutoPairingJoinSession(
      qr,
      secret,
      options.relay ??
        new PairingRelayClient({
          relayUrl: qr.relay_url,
          allowLoopbackHttp: hooks.allowLoopbackHttp,
          webSocketFactory: hooks.webSocketFactory,
        }),
      hooks
    );
  }

  async start(
    onAuthority: (authority: AuthorityPayloadV0) => Promise<void>,
    onError: (error: Error) => void
  ): Promise<void> {
    if (this.completed)
      throw new AutomaticPairingError("pairing session already used");
    const request = pairRequest(this.qr, this.secret);
    try {
      await this.relay.publish(
        giftWrap(request, this.secret, this.qr.request_pubkey, this.hooks)
      );
      this.stopWatch = this.relay.watch(
        request.response_pubkey,
        (event) => {
          if (this.completed || now(this.hooks) >= this.qr.expires_at) return;
          try {
            const response = record(
              openGift(event, this.secret),
              "pairing response"
            ) as PairingResponseV0;
            if (
              response.schema !== 0 ||
              response.type !== RESPONSE_TYPE ||
              response.pairing_id !== this.qr.pairing_id ||
              response.challenge !== this.qr.challenge ||
              response.request_pubkey !== this.qr.request_pubkey ||
              response.response_pubkey !== request.response_pubkey ||
              response.expires_at !== this.qr.expires_at
            )
              throw new AutomaticPairingError(
                "pairing response binding mismatch"
              );
            const authority = decodeAuthorityPayloadV0(
              response.authority,
              this.hooks
            );
            this.completed = true;
            void onAuthority(authority)
              .then(async () => {
                await this.relay.publish(
                  giftWrap(
                    { ...request, type: ACK_TYPE },
                    this.secret,
                    this.qr.request_pubkey,
                    this.hooks
                  )
                );
                this.destroy();
              })
              .catch((error) => {
                this.destroy();
                onError(
                  error instanceof Error
                    ? error
                    : new AutomaticPairingError("pairing import failed")
                );
              });
          } catch {
            /* ignore replay/tamper */
          }
        },
        (error) => {
          if (!this.completed) {
            this.destroy();
            onError(error);
          }
        }
      );
      const remainingMs = Math.max(
        1,
        (this.qr.expires_at - now(this.hooks)) * 1_000
      );
      this.responseTimer = setTimeout(() => {
        if (this.completed) return;
        this.destroy();
        onError(new AutomaticPairingError("pairing response timed out"));
      }, Math.min(this.hooks.pairingTimeoutMs ?? AUTO_PAIRING_RESPONSE_TIMEOUT_MS, remainingMs));
    } catch (error) {
      this.destroy();
      onError(
        error instanceof Error
          ? error
          : new AutomaticPairingError("pairing failed")
      );
    }
  }

  destroy(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.responseTimer !== null) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    this.secret.fill(0);
  }
}
