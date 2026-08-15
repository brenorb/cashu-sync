import { finalizeEvent, nip42, utils, type Event } from "nostr-tools";
import { getSyncPublicKey, verifyEventFresh } from "src/sync/syncCrypto";
import { SYNC_EVENT_D_TAG_V0, SYNC_EVENT_KIND_V0 } from "src/sync/types";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_CIPHERTEXT_CHARS_V0 = 100_000;
const HEX_EVENT_ID = /^[0-9a-f]{64}$/;

export type SyncRelayClientErrorCode =
  | "configuration"
  | "invalid-event"
  | "timeout"
  | "disconnected"
  | "auth"
  | "admission"
  | "relay"
  | "protocol";

export class SyncRelayClientError extends Error {
  readonly code: SyncRelayClientErrorCode;

  constructor(code: SyncRelayClientErrorCode, message: string) {
    super(message);
    this.name = "SyncRelayClientError";
    this.code = code;
  }
}

export type RelayPublishResult =
  | { status: "accepted"; reason: string }
  | { status: "conflict"; reason: string }
  | {
      status: "rejected";
      category: "auth" | "admission" | "relay";
      reason: string;
    }
  | { status: "ambiguous"; cause: "timeout" | "disconnected" };

export interface RelayWebSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type RelayWebSocketFactory = (url: string) => RelayWebSocket;

export type SyncRelayClientOptions = {
  relayUrl: string;
  syncSecret: Uint8Array;
  timeoutMs?: number;
  allowInsecureLoopback?: boolean;
  webSocketFactory?: RelayWebSocketFactory;
};

type Operation =
  | { type: "query" }
  | { type: "query-recent"; limit: number }
  | { type: "publish"; event: Event };

type OperationResult = Event | Event[] | null | RelayPublishResult;

export class SyncRelayClient {
  private readonly relayUrl: string;
  private readonly syncSecret: Uint8Array;
  private readonly syncPublicKey: string;
  private readonly timeoutMs: number;
  private readonly webSocketFactory: RelayWebSocketFactory;
  private subscriptionSerial = 0;

  constructor(options: SyncRelayClientOptions) {
    this.relayUrl = normalizeRelayUrl(
      options.relayUrl,
      options.allowInsecureLoopback ?? false
    );
    this.syncSecret = new Uint8Array(options.syncSecret);
    try {
      this.syncPublicKey = getSyncPublicKey(this.syncSecret);
    } catch {
      throw new SyncRelayClientError(
        "configuration",
        "sync secret must be a valid 32-byte secp256k1 key"
      );
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new SyncRelayClientError(
        "configuration",
        `timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds`
      );
    }
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as RelayWebSocket);
  }

  queryCurrent(): Promise<Event | null> {
    return this.run({ type: "query" }) as Promise<Event | null>;
  }

  queryRecent(limit: number): Promise<Event[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SyncRelayClientError(
        "configuration",
        "retained-history limit must be between 1 and 100"
      );
    }
    return this.run({ type: "query-recent", limit }) as Promise<Event[]>;
  }

  publish(event: Event): Promise<RelayPublishResult> {
    if (!isExactSyncEvent(event, this.syncPublicKey)) {
      throw new SyncRelayClientError(
        "invalid-event",
        "published event must be a valid v0 event signed by the sync key"
      );
    }
    return this.run({ type: "publish", event }) as Promise<RelayPublishResult>;
  }

  /** Keeps an authenticated subscription open for remote wallet updates. */
  watchCurrent(onEvent: (event: Event) => void): () => void {
    let stopped = false;
    let socket: RelayWebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    let subscriptionId: string | null = null;
    let authEventId: string | null = null;
    let authenticated = false;

    const clearConnectionTimer = (): void => {
      if (connectionTimer !== null) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
    };

    const scheduleReconnect = (): void => {
      if (stopped || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1_000);
    };

    const closeConnection = (): void => {
      clearConnectionTimer();
      subscriptionId = null;
      authEventId = null;
      authenticated = false;
      if (socket === null) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // The watcher will reconnect if it was not explicitly stopped.
      }
      socket = null;
    };

    const reconnect = (): void => {
      if (stopped) return;
      closeConnection();
      scheduleReconnect();
    };

    const send = (envelope: unknown[]): boolean => {
      try {
        if (socket === null || socket.readyState !== 1) throw new Error();
        socket.send(JSON.stringify(envelope));
        return true;
      } catch {
        reconnect();
        return false;
      }
    };

    const request = (): void => {
      subscriptionId = this.nextSubscriptionId();
      send([
        "REQ",
        subscriptionId,
        {
          authors: [this.syncPublicKey],
          kinds: [SYNC_EVENT_KIND_V0],
          "#d": [SYNC_EVENT_D_TAG_V0],
          limit: 1,
        },
      ]);
    };

    const connect = (): void => {
      if (stopped || socket !== null) return;
      try {
        socket = this.webSocketFactory(this.relayUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      authenticated = false;
      authEventId = null;
      subscriptionId = null;
      const currentSocket = socket;
      currentSocket.onopen = request;
      currentSocket.onclose = reconnect;
      currentSocket.onerror = reconnect;
      currentSocket.onmessage = ({ data }) => {
        if (stopped || currentSocket !== socket || typeof data !== "string") {
          return;
        }
        let envelope: unknown;
        try {
          envelope = JSON.parse(data);
        } catch {
          return;
        }
        if (!Array.isArray(envelope) || typeof envelope[0] !== "string") {
          return;
        }
        switch (envelope[0]) {
          case "AUTH": {
            if (authenticated || authEventId !== null) return;
            const challenge = envelope[1];
            if (typeof challenge !== "string" || challenge.length === 0) {
              reconnect();
              return;
            }
            try {
              const authEvent = finalizeEvent(
                nip42.makeAuthEvent(this.relayUrl, challenge),
                this.syncSecret
              );
              authEventId = authEvent.id;
              send(["AUTH", authEvent]);
            } catch {
              reconnect();
            }
            return;
          }
          case "OK": {
            const eventId = envelope[1];
            const ok = envelope[2];
            if (
              authEventId === null ||
              eventId !== authEventId ||
              typeof ok !== "boolean"
            ) {
              return;
            }
            authEventId = null;
            if (!ok) {
              reconnect();
              return;
            }
            clearConnectionTimer();
            authenticated = true;
            if (subscriptionId !== null) {
              send(["CLOSE", subscriptionId]);
            }
            request();
            return;
          }
          case "EVENT": {
            if (
              !authenticated ||
              subscriptionId === null ||
              envelope[1] !== subscriptionId ||
              !isExactSyncEvent(envelope[2], this.syncPublicKey)
            ) {
              return;
            }
            onEvent(envelope[2]);
            return;
          }
          case "CLOSED": {
            const reason = typeof envelope[2] === "string" ? envelope[2] : "";
            if (!authenticated && reason.startsWith("auth-required:")) return;
            reconnect();
            return;
          }
        }
      };
      connectionTimer = setTimeout(reconnect, this.timeoutMs);
    };

    const stop = (): void => {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      closeConnection();
    };

    connect();
    return stop;
  }

  private run(operation: Operation): Promise<OperationResult> {
    return new Promise((resolve, reject) => {
      let socket: RelayWebSocket;
      let settled = false;
      let authenticated = false;
      let authEventId: string | null = null;
      let activeSubscriptionId: string | null = null;
      let publishSent = false;
      const recentEvents: Event[] = [];
      const recentEventIds = new Set<string>();

      const finish = (result: OperationResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        resolve(result);
      };

      const fail = (error: SyncRelayClientError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        reject(error);
      };

      const ambiguous = (cause: "timeout" | "disconnected"): void => {
        if (operation.type === "publish") {
          finish({ status: "ambiguous", cause });
        } else {
          fail(new SyncRelayClientError(cause, `relay ${cause}`));
        }
      };

      const send = (envelope: unknown[]): boolean => {
        try {
          if (socket.readyState !== 1) throw new Error("socket is not open");
          socket.send(JSON.stringify(envelope));
          return true;
        } catch {
          ambiguous("disconnected");
          return false;
        }
      };

      const closeSubscription = (): void => {
        if (activeSubscriptionId === null) return;
        const subscriptionId = activeSubscriptionId;
        activeSubscriptionId = null;
        if (socket.readyState === 1) {
          try {
            socket.send(JSON.stringify(["CLOSE", subscriptionId]));
          } catch {
            // The operation result decides whether a failed close is ambiguous.
          }
        }
      };

      const cleanup = (): void => {
        closeSubscription();
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          // The operation has already reached its result.
        }
      };

      const requestCurrent = (): void => {
        activeSubscriptionId = this.nextSubscriptionId();
        send([
          "REQ",
          activeSubscriptionId,
          {
            authors: [this.syncPublicKey],
            kinds: [SYNC_EVENT_KIND_V0],
            "#d": [SYNC_EVENT_D_TAG_V0],
            limit: operation.type === "query-recent" ? operation.limit : 1,
          },
        ]);
      };

      const afterAuthentication = (): void => {
        closeSubscription();
        if (operation.type !== "publish") {
          requestCurrent();
          return;
        }
        publishSent = send(["EVENT", operation.event]);
      };

      const handleMessage = (raw: unknown): void => {
        if (settled || typeof raw !== "string") return;
        let envelope: unknown;
        try {
          envelope = JSON.parse(raw);
        } catch {
          return;
        }
        if (!Array.isArray(envelope) || typeof envelope[0] !== "string") return;

        switch (envelope[0]) {
          case "AUTH": {
            const challenge = envelope[1];
            if (
              authenticated ||
              authEventId !== null ||
              typeof challenge !== "string" ||
              challenge.length === 0
            ) {
              return;
            }
            const authEvent = finalizeEvent(
              nip42.makeAuthEvent(this.relayUrl, challenge),
              this.syncSecret
            );
            authEventId = authEvent.id;
            send(["AUTH", authEvent]);
            return;
          }
          case "OK": {
            const eventId = envelope[1];
            const ok = envelope[2];
            const reason = typeof envelope[3] === "string" ? envelope[3] : "";
            if (typeof eventId !== "string" || typeof ok !== "boolean") return;
            if (authEventId !== null && eventId === authEventId) {
              authEventId = null;
              if (!ok) {
                if (operation.type === "publish") {
                  finish({ status: "rejected", category: "auth", reason });
                } else {
                  fail(new SyncRelayClientError("auth", reason));
                }
                return;
              }
              authenticated = true;
              afterAuthentication();
              return;
            }
            if (
              operation.type === "publish" &&
              publishSent &&
              eventId === operation.event.id
            ) {
              finish(classifyPublishResponse(ok, reason));
            }
            return;
          }
          case "EVENT": {
            if (
              operation.type === "publish" ||
              !authenticated ||
              envelope[1] !== activeSubscriptionId
            ) {
              return;
            }
            const event = envelope[2];
            if (!isExactSyncEvent(event, this.syncPublicKey)) {
              fail(
                new SyncRelayClientError(
                  "protocol",
                  "relay returned an invalid v0 sync event"
                )
              );
              return;
            }
            if (operation.type === "query-recent") {
              if (!recentEventIds.has(event.id)) {
                recentEventIds.add(event.id);
                recentEvents.push(event);
              }
              return;
            }
            finish(event);
            return;
          }
          case "EOSE":
            if (
              operation.type !== "publish" &&
              authenticated &&
              envelope[1] === activeSubscriptionId
            ) {
              finish(operation.type === "query-recent" ? recentEvents : null);
            }
            return;
          case "CLOSED": {
            if (envelope[1] !== activeSubscriptionId) return;
            const reason = typeof envelope[2] === "string" ? envelope[2] : "";
            if (!authenticated && reason.startsWith("auth-required:")) return;
            const category = rejectionCategory(reason);
            if (operation.type === "publish") {
              finish({ status: "rejected", category, reason });
            } else {
              fail(new SyncRelayClientError(category, reason));
            }
            return;
          }
        }
      };

      const timeout = setTimeout(() => ambiguous("timeout"), this.timeoutMs);
      try {
        socket = this.webSocketFactory(this.relayUrl);
      } catch {
        clearTimeout(timeout);
        if (operation.type === "publish") {
          resolve({ status: "ambiguous", cause: "disconnected" });
        } else {
          reject(
            new SyncRelayClientError(
              "disconnected",
              "could not create relay WebSocket"
            )
          );
        }
        return;
      }
      socket.onopen = requestCurrent;
      socket.onmessage = (event) => handleMessage(event.data);
      socket.onclose = () => ambiguous("disconnected");
      socket.onerror = () => ambiguous("disconnected");
    });
  }

  private nextSubscriptionId(): string {
    this.subscriptionSerial += 1;
    return `cashu-sync-${this.subscriptionSerial}`;
  }
}

function normalizeRelayUrl(
  raw: string,
  allowInsecureLoopback: boolean
): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SyncRelayClientError("configuration", "invalid relay URL");
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new SyncRelayClientError(
      "configuration",
      "relay URL must be an origin without credentials, path, query, or fragment"
    );
  }
  if (parsed.protocol === "ws:") {
    if (!allowInsecureLoopback || !isLoopbackHost(parsed.hostname)) {
      throw new SyncRelayClientError(
        "configuration",
        "insecure ws relay is allowed only for explicitly enabled loopback"
      );
    }
  } else if (parsed.protocol !== "wss:") {
    throw new SyncRelayClientError(
      "configuration",
      "production relay URL must use wss"
    );
  }
  return utils.normalizeURL(parsed.toString());
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet)) &&
    octets.every((octet) => Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

function isExactSyncEvent(
  candidate: unknown,
  expectedPublicKey: string
): candidate is Event {
  if (typeof candidate !== "object" || candidate === null) return false;
  const event = candidate as Event;
  if (
    event.pubkey !== expectedPublicKey ||
    event.kind !== SYNC_EVENT_KIND_V0 ||
    typeof event.content !== "string" ||
    event.content.length === 0 ||
    event.content.length > MAX_CIPHERTEXT_CHARS_V0 ||
    !Array.isArray(event.tags)
  ) {
    return false;
  }
  if (!verifyEventFresh(event)) return false;
  if (
    event.tags.length !== 3 ||
    !sameTag(event.tags[0], ["d", SYNC_EVENT_D_TAG_V0]) ||
    !sameTag(event.tags[2], ["schema", "0"])
  ) {
    return false;
  }
  const previous = event.tags[1];
  return (
    previous.length === 2 &&
    previous[0] === "prev" &&
    (previous[1] === "" || HEX_EVENT_ID.test(previous[1]))
  );
}

function sameTag(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function classifyPublishResponse(
  ok: boolean,
  reason: string
): RelayPublishResult {
  if (ok) return { status: "accepted", reason };
  if (reason.startsWith("conflict:")) return { status: "conflict", reason };
  return { status: "rejected", category: rejectionCategory(reason), reason };
}

function rejectionCategory(reason: string): "auth" | "admission" | "relay" {
  if (reason.startsWith("auth-required:") || /authenticate/i.test(reason)) {
    return "auth";
  }
  if (reason.startsWith("restricted:")) return "admission";
  return "relay";
}
