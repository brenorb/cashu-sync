import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SyncRelayClient,
  SyncRelayClientError,
  type RelayWebSocket,
} from "src/sync/relayClient";
import { getSyncPublicKey, hexToBytes } from "src/sync/syncCrypto";
import { SYNC_EVENT_D_TAG_V0, SYNC_EVENT_KIND_V0 } from "src/sync/types";

const secret = hexToBytes(
  "1111111111111111111111111111111111111111111111111111111111111111"
);
const serviceUrl = "https://sync.example.com/";
const relayUrl = "wss://sync.example.com";
const normalizedRelayUrl = serviceUrl.replace("https:", "wss:");

class FakeWebSocket implements RelayWebSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(envelope: unknown): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  disconnect(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fixture(options: { timeoutMs?: number; url?: string } = {}) {
  const sockets: FakeWebSocket[] = [];
  const client = new SyncRelayClient({
    relayUrl: options.url ?? relayUrl,
    syncSecret: secret,
    timeoutMs: options.timeoutMs ?? 1_000,
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { client, sockets };
}

function sentEnvelope(socket: FakeWebSocket, index: number): unknown[] {
  return JSON.parse(socket.sent[index]) as unknown[];
}

function authenticate(socket: FakeWebSocket): void {
  const initialRequest = sentEnvelope(socket, 0);
  expect(initialRequest[0]).toBe("REQ");
  socket.receive(["NOTICE", "unrelated"]);
  socket.receive(["AUTH", "challenge-123"]);
  const authEnvelope = sentEnvelope(socket, 1);
  expect(authEnvelope[0]).toBe("AUTH");
  const authEvent = authEnvelope[1] as Event;
  expect(verifyEvent(authEvent)).toBe(true);
  expect(authEvent.pubkey).toBe(getSyncPublicKey(secret));
  expect(authEvent.kind).toBe(22242);
  expect(authEvent.tags).toEqual([
    ["relay", normalizedRelayUrl],
    ["challenge", "challenge-123"],
  ]);
  socket.receive(["OK", "f".repeat(64), true, "unrelated"]);
  socket.receive(["OK", authEvent.id, true, ""]);
}

function syncEvent(previous = ""): Event {
  return finalizeEvent(
    {
      kind: SYNC_EVENT_KIND_V0,
      created_at: 1_780_000_400,
      tags: [
        ["d", SYNC_EVENT_D_TAG_V0],
        ["prev", previous],
        ["schema", "0"],
      ],
      content: "opaque-ciphertext",
    },
    secret
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncRelayClient", () => {
  it("authenticates against the normalized ServiceURL, queries its exact v0 scope, and closes cleanly", async () => {
    const { client, sockets } = fixture();
    const query = client.queryCurrent();
    const socket = sockets[0];
    socket.open();
    authenticate(socket);

    const closeEnvelope = sentEnvelope(socket, 2);
    const request = sentEnvelope(socket, 3);
    expect(closeEnvelope[0]).toBe("CLOSE");
    expect(request).toEqual([
      "REQ",
      expect.any(String),
      {
        authors: [getSyncPublicKey(secret)],
        kinds: [SYNC_EVENT_KIND_V0],
        "#d": [SYNC_EVENT_D_TAG_V0],
        limit: 1,
      },
    ]);
    const subscriptionId = request[1];
    const event = syncEvent();
    socket.receive(["EVENT", "another-subscription", event]);
    socket.receiveRaw("not-json");
    socket.receive(["EVENT", subscriptionId, event]);

    await expect(query).resolves.toEqual(JSON.parse(JSON.stringify(event)));
    expect(sentEnvelope(socket, 4)).toEqual(["CLOSE", subscriptionId]);
    expect(socket.closed).toBe(true);
  });

  it("returns null on matching EOSE and rejects a wrong schema envelope", async () => {
    const emptyFixture = fixture();
    const emptyQuery = emptyFixture.client.queryCurrent();
    const emptySocket = emptyFixture.sockets[0];
    emptySocket.open();
    authenticate(emptySocket);
    const emptyRequest = sentEnvelope(emptySocket, 3);
    emptySocket.receive(["EOSE", emptyRequest[1]]);
    await expect(emptyQuery).resolves.toBeNull();
    expect(emptySocket.closed).toBe(true);

    const invalidFixture = fixture();
    const invalidQuery = invalidFixture.client.queryCurrent();
    const invalidSocket = invalidFixture.sockets[0];
    invalidSocket.open();
    authenticate(invalidSocket);
    const invalidRequest = sentEnvelope(invalidSocket, 3);
    const invalid = finalizeEvent(
      {
        ...syncEvent(),
        tags: [
          ["d", SYNC_EVENT_D_TAG_V0],
          ["prev", ""],
          ["schema", "1"],
        ],
      },
      secret
    );
    invalidSocket.receive(["EVENT", invalidRequest[1], invalid]);
    await expect(invalidQuery).rejects.toMatchObject({ code: "protocol" });
    expect(invalidSocket.closed).toBe(true);
  });

  it("collects a bounded newest-first retained history through EOSE", async () => {
    const { client, sockets } = fixture();
    const query = client.queryRecent(8);
    const socket = sockets[0];
    socket.open();
    authenticate(socket);

    const request = sentEnvelope(socket, 3);
    expect(request).toEqual([
      "REQ",
      expect.any(String),
      {
        authors: [getSyncPublicKey(secret)],
        kinds: [SYNC_EVENT_KIND_V0],
        "#d": [SYNC_EVENT_D_TAG_V0],
        limit: 8,
      },
    ]);
    const subscriptionId = request[1];
    const genesis = syncEvent();
    const child = syncEvent(genesis.id);
    socket.receive(["EVENT", subscriptionId, child]);
    socket.receive(["EVENT", subscriptionId, genesis]);
    socket.receive(["EVENT", subscriptionId, child]);
    socket.receive(["EOSE", subscriptionId]);

    await expect(query).resolves.toEqual(
      JSON.parse(JSON.stringify([child, genesis]))
    );
    expect(socket.closed).toBe(true);
  });

  it("rejects invalid retained-history limits before opening a socket", () => {
    const { client, sockets } = fixture();
    expect(() => client.queryRecent(0)).toThrow(/limit/i);
    expect(() => client.queryRecent(101)).toThrow(/limit/i);
    expect(sockets).toHaveLength(0);
  });

  it("publishes only its own valid event and waits for the matching OK", async () => {
    const { client, sockets } = fixture();
    const event = syncEvent();
    const publish = client.publish(event);
    const socket = sockets[0];
    socket.open();
    authenticate(socket);

    const eventEnvelope = sentEnvelope(socket, 3);
    expect(eventEnvelope).toEqual(["EVENT", JSON.parse(JSON.stringify(event))]);
    socket.receive(["OK", "e".repeat(64), true, "unrelated"]);
    socket.receive(["OK", event.id, true, "stored"]);

    await expect(publish).resolves.toEqual({
      status: "accepted",
      reason: "stored",
    });
    expect(socket.closed).toBe(true);
  });

  it("distinguishes CAS conflict and admission rejection", async () => {
    const conflictFixture = fixture();
    const event = syncEvent();
    const conflict = conflictFixture.client.publish(event);
    const conflictSocket = conflictFixture.sockets[0];
    conflictSocket.open();
    authenticate(conflictSocket);
    conflictSocket.receive([
      "OK",
      event.id,
      false,
      "conflict: stale previous event",
    ]);
    await expect(conflict).resolves.toEqual({
      status: "conflict",
      reason: "conflict: stale previous event",
    });

    const rejectedFixture = fixture();
    const rejected = rejectedFixture.client.publish(event);
    const rejectedSocket = rejectedFixture.sockets[0];
    rejectedSocket.open();
    authenticate(rejectedSocket);
    rejectedSocket.receive([
      "OK",
      event.id,
      false,
      "restricted: sync pubkey is not admitted",
    ]);
    await expect(rejected).resolves.toEqual({
      status: "rejected",
      category: "admission",
      reason: "restricted: sync pubkey is not admitted",
    });
  });

  it("distinguishes authentication rejection", async () => {
    const { client, sockets } = fixture();
    const publish = client.publish(syncEvent());
    const socket = sockets[0];
    socket.open();
    socket.receive(["AUTH", "challenge-123"]);
    const authEvent = sentEnvelope(socket, 1)[1] as Event;
    socket.receive([
      "OK",
      authEvent.id,
      false,
      "error: failed to authenticate",
    ]);

    await expect(publish).resolves.toEqual({
      status: "rejected",
      category: "auth",
      reason: "error: failed to authenticate",
    });
    expect(socket.sent.some((raw) => raw.startsWith('["EVENT"'))).toBe(false);
  });

  it("surfaces query admission rejection without accepting relay state", async () => {
    const { client, sockets } = fixture();
    const query = client.queryCurrent();
    const socket = sockets[0];
    socket.open();
    authenticate(socket);
    const request = sentEnvelope(socket, 3);
    socket.receive([
      "CLOSED",
      request[1],
      "restricted: sync pubkey is not admitted",
    ]);

    await expect(query).rejects.toMatchObject({ code: "admission" });
    expect(socket.closed).toBe(true);
  });

  it("rejects a foreign event before opening a socket", () => {
    const { client, sockets } = fixture();
    const otherSecret = hexToBytes(
      "2222222222222222222222222222222222222222222222222222222222222222"
    );
    const foreign = finalizeEvent(
      {
        kind: SYNC_EVENT_KIND_V0,
        created_at: 1_780_000_400,
        tags: [
          ["d", SYNC_EVENT_D_TAG_V0],
          ["prev", ""],
          ["schema", "0"],
        ],
        content: "opaque-ciphertext",
      },
      otherSecret
    );

    expect(() => client.publish(foreign)).toThrow(/sync key/i);
    expect(sockets).toHaveLength(0);
  });

  it("rejects a mutated finalized event before opening a socket", () => {
    const { client, sockets } = fixture();
    const mutated = syncEvent();
    mutated.created_at += 1;

    expect(() => client.publish(mutated)).toThrow(/valid v0 event/i);
    expect(sockets).toHaveLength(0);
  });

  it("rejects ciphertext above the v0 bound before opening a socket", () => {
    const { client, sockets } = fixture();
    const oversized = finalizeEvent(
      {
        kind: SYNC_EVENT_KIND_V0,
        created_at: 1_780_000_400,
        tags: [
          ["d", SYNC_EVENT_D_TAG_V0],
          ["prev", ""],
          ["schema", "0"],
        ],
        content: "x".repeat(100_001),
      },
      secret
    );

    expect(() => client.publish(oversized)).toThrow(/valid v0 event/i);
    expect(sockets).toHaveLength(0);
  });

  it("keeps pre-EVENT auth timeout and disconnect ambiguous", async () => {
    vi.useFakeTimers();
    const timeoutFixture = fixture({ timeoutMs: 100 });
    const timeoutPublish = timeoutFixture.client.publish(syncEvent());
    const timeoutSocket = timeoutFixture.sockets[0];
    timeoutSocket.open();
    await vi.advanceTimersByTimeAsync(101);
    await expect(timeoutPublish).resolves.toEqual({
      status: "ambiguous",
      cause: "timeout",
    });
    expect(timeoutSocket.sent.some((raw) => raw.startsWith('["EVENT"'))).toBe(
      false
    );

    vi.useRealTimers();
    const disconnectFixture = fixture();
    const disconnectPublish = disconnectFixture.client.publish(syncEvent());
    const disconnectSocket = disconnectFixture.sockets[0];
    disconnectSocket.open();
    disconnectSocket.disconnect();
    await expect(disconnectPublish).resolves.toEqual({
      status: "ambiguous",
      cause: "disconnected",
    });
    expect(
      disconnectSocket.sent.some((raw) => raw.startsWith('["EVENT"'))
    ).toBe(false);
  });

  it("reports publish timeout and disconnect as ambiguous", async () => {
    vi.useFakeTimers();
    const timeoutFixture = fixture({ timeoutMs: 100 });
    const timeoutPublish = timeoutFixture.client.publish(syncEvent());
    const timeoutSocket = timeoutFixture.sockets[0];
    timeoutSocket.open();
    authenticate(timeoutSocket);
    await vi.advanceTimersByTimeAsync(101);
    await expect(timeoutPublish).resolves.toEqual({
      status: "ambiguous",
      cause: "timeout",
    });
    expect(timeoutSocket.closed).toBe(true);

    vi.useRealTimers();
    const disconnectFixture = fixture();
    const disconnectPublish = disconnectFixture.client.publish(syncEvent());
    const disconnectSocket = disconnectFixture.sockets[0];
    disconnectSocket.open();
    authenticate(disconnectSocket);
    disconnectSocket.disconnect();
    await expect(disconnectPublish).resolves.toEqual({
      status: "ambiguous",
      cause: "disconnected",
    });
  });

  it("throws bounded query transport errors and closes its socket", async () => {
    vi.useFakeTimers();
    const { client, sockets } = fixture({ timeoutMs: 100 });
    const query = client.queryCurrent();
    const rejection = expect(query).rejects.toMatchObject({ code: "timeout" });
    const socket = sockets[0];
    socket.open();
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(socket.closed).toBe(true);

    vi.useRealTimers();
    const disconnectedFixture = fixture();
    const disconnected = disconnectedFixture.client.queryCurrent();
    const disconnectedSocket = disconnectedFixture.sockets[0];
    disconnectedSocket.open();
    disconnectedSocket.disconnect();
    await expect(disconnected).rejects.toMatchObject({ code: "disconnected" });
  });

  it("requires wss except for explicitly allowed loopback ws", () => {
    expect(
      () =>
        new SyncRelayClient({
          relayUrl: "ws://sync.example.com",
          syncSecret: secret,
        })
    ).toThrow(SyncRelayClientError);
    expect(
      () =>
        new SyncRelayClient({
          relayUrl: "ws://127.0.0.1:3334",
          syncSecret: secret,
        })
    ).toThrow(/loopback/i);
    expect(
      () =>
        new SyncRelayClient({
          relayUrl: "ws://192.168.1.2:3334",
          syncSecret: secret,
          allowInsecureLoopback: true,
        })
    ).toThrow(/loopback/i);
    expect(
      () =>
        new SyncRelayClient({
          relayUrl: "ws://[::1]:3334",
          syncSecret: secret,
          allowInsecureLoopback: true,
        })
    ).not.toThrow();
    for (const invalidUrl of [
      "wss://user:pass@sync.example.com",
      "wss://sync.example.com/relay",
      "wss://sync.example.com?tenant=wallet",
      "wss://sync.example.com#fragment",
    ]) {
      expect(
        () =>
          new SyncRelayClient({
            relayUrl: invalidUrl,
            syncSecret: secret,
          })
      ).toThrow(/origin/i);
    }
    expect(
      () =>
        new SyncRelayClient({
          relayUrl: "ws://localhost:3334",
          syncSecret: secret,
          allowInsecureLoopback: true,
        })
    ).not.toThrow();
    expect(
      () =>
        new SyncRelayClient({
          relayUrl,
          syncSecret: secret,
          timeoutMs: 30_001,
        })
    ).toThrow(/timeout/i);
  });
});
