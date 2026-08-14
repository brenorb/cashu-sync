import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/authority-v0.json";
import {
  AutoPairingHostSession,
  AutoPairingJoinSession,
  AutomaticPairingError,
  decodeAutoPairingQrV0,
  encodeAutoPairingQrV0,
  type PairingRelay,
} from "../automaticPairing";
import type { Event } from "nostr-tools";

class MemoryPairingRelay implements PairingRelay {
  private readonly events: Event[] = [];
  private readonly watchers = new Map<string, Set<(event: Event) => void>>();

  publish(event: Event): Promise<void> {
    this.events.push(event);
    const recipient = event.tags.find((tag) => tag[0] === "p")?.[1];
    for (const callback of this.watchers.get(recipient ?? "") ?? []) {
      queueMicrotask(() => callback(event));
    }
    return Promise.resolve();
  }

  watch(recipient: string, callback: (event: Event) => void): () => void {
    const callbacks = this.watchers.get(recipient) ?? new Set();
    callbacks.add(callback);
    this.watchers.set(recipient, callbacks);
    for (const event of this.events) {
      if (event.tags.some((tag) => tag[0] === "p" && tag[1] === recipient)) {
        queueMicrotask(() => callback(event));
      }
    }
    return () => callbacks.delete(callback);
  }
}

const hooks = {
  allowLoopbackHttp: true,
  now: () => 1_000,
  randomBytes: (length: number) =>
    Uint8Array.from({ length }, (_, i) => (i + 9) & 0xff),
  ephemeralSecret: () =>
    Uint8Array.from({ length: 32 }, (_, i) => (i + 33) & 0xff),
};

describe("automatic one-QR pairing", () => {
  it("transfers authority through the pairing relay and acknowledges automatically", async () => {
    const relay = new MemoryPairingRelay();
    const host = AutoPairingHostSession.create({
      relayUrl: "ws://127.0.0.1:3335",
      relay,
      hooks,
    });
    const qr = encodeAutoPairingQrV0(host.qr);
    expect(qr).not.toContain(fixture.mnemonic);
    expect(qr).not.toContain(fixture.sync_secret);
    expect(qr).not.toContain("ciphertext");

    let hostDone = false;
    let imported: unknown = null;
    host.start(
      fixture,
      () => {
        hostDone = true;
      },
      (error) => {
        throw error;
      }
    );
    const join = AutoPairingJoinSession.fromQr(qr, { relay, hooks });
    await join.start(
      async (authority) => {
        imported = authority;
      },
      (error) => {
        throw error;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imported).toEqual(fixture);
    expect(hostDone).toBe(true);
  });

  it("rejects expiry, tampering, and QR secrets", () => {
    const relay = new MemoryPairingRelay();
    const host = AutoPairingHostSession.create({
      relayUrl: "ws://127.0.0.1:3335",
      relay,
      hooks,
    });
    const qr = encodeAutoPairingQrV0(host.qr);
    expect(() =>
      decodeAutoPairingQrV0(
        qr.replace(host.qr.challenge, "A".repeat(42)),
        hooks
      )
    ).toThrow(AutomaticPairingError);
    expect(() =>
      decodeAutoPairingQrV0(
        JSON.stringify({ ...host.qr, expires_at: 999 }),
        hooks
      )
    ).toThrow(/expired/i);
    expect(qr).not.toMatch(/mnemonic|sync_secret|passphrase|ciphertext/i);
  });

  it("rejects a production pairing relay that is not WSS", () => {
    expect(() =>
      AutoPairingHostSession.create({
        relayUrl: "ws://pairing.example",
        hooks,
      })
    ).toThrow(/wss/i);
  });

  it("reports an unavailable pairing relay without importing anything", async () => {
    const host = AutoPairingHostSession.create({
      relayUrl: "ws://127.0.0.1:3335",
      hooks,
      relay: {
        publish: async () => {
          throw new Error("offline");
        },
        watch: () => () => undefined,
      },
    });
    const join = AutoPairingJoinSession.fromQr(encodeAutoPairingQrV0(host.qr), {
      hooks,
      relay: {
        publish: async () => {
          throw new Error("offline");
        },
        watch: () => () => undefined,
      },
    });
    let error = "";
    await join.start(
      async () => {
        throw new Error("must not import");
      },
      (cause) => {
        error = cause.message;
      }
    );
    expect(error).toBe("offline");
  });
});
