import { describe, expect, it } from "vitest";
import { getPublicKey } from "nostr-tools";
import {
  PairingError,
  PairingSessionV0,
  createPairingResponseV0,
  decodePairingRequestV0,
  type PairingRequestV0,
} from "src/sync/pairingCrypto";
import { hexToBytes } from "src/sync/syncCrypto";
import fixture from "../__fixtures__/authority-v0.json";

const requestSecret = hexToBytes("1".repeat(64));
const responseSecret = hexToBytes("2".repeat(64));
const now = 1_780_000_000;

function session() {
  return PairingSessionV0.create({
    now: () => now,
    randomBytes: () => Uint8Array.from({ length: 32 }, (_, i) => i),
    ephemeralSecret: () => requestSecret.slice(),
  });
}

describe("two-QR pairing", () => {
  it("round-trips full authority with no secret in the request QR", () => {
    const receiver = session();
    const requestQr = receiver.requestQrPayload();
    expect(requestQr).not.toContain("mnemonic");
    expect(requestQr).not.toContain(fixture.sync_secret);
    expect(Object.keys(JSON.parse(requestQr)).sort()).toEqual([
      "challenge",
      "ephemeral_pubkey",
      "expires_at",
      "schema",
      "type",
    ]);

    const responseQr = createPairingResponseV0(requestQr, fixture, {
      now: () => now + 1,
      ephemeralSecret: () => responseSecret.slice(),
      randomBytes: () => new Uint8Array(32).fill(9),
    });
    expect(responseQr).not.toContain(fixture.mnemonic);
    expect(responseQr).not.toContain(fixture.sync_secret);
    expect(receiver.consumeResponse(responseQr, now + 2)).toEqual(fixture);
    expect(receiver.destroyed).toBe(true);
  });

  it("rejects request unknown fields and invalid public keys", () => {
    const request = JSON.parse(session().requestQrPayload());
    expect(() =>
      decodePairingRequestV0({ ...request, relay: "wss://x" })
    ).toThrow(/unknown/i);
    expect(() =>
      decodePairingRequestV0({ ...request, ephemeral_pubkey: "0".repeat(64) })
    ).toThrow(/public key/i);
    expect(() =>
      createPairingResponseV0(
        request,
        {
          ...fixture,
          relay_url: "wss://relay.example/tenant",
        },
        { now: () => now }
      )
    ).toThrow(/origin/i);
  });

  it("rejects expiry and destroys the session", () => {
    const receiver = session();
    const request = receiver.requestQrPayload();
    expect(() =>
      createPairingResponseV0(request, fixture, {
        now: () => now + 301,
        ephemeralSecret: () => responseSecret.slice(),
      })
    ).toThrow(/expired/i);

    const response = createPairingResponseV0(request, fixture, {
      now: () => now,
      ephemeralSecret: () => responseSecret.slice(),
    });
    expect(() => receiver.consumeResponse(response, now + 301)).toThrow(
      /expired/i
    );
    expect(receiver.destroyed).toBe(true);
  });

  it("rejects replay, challenge mismatch, and wrong request key", () => {
    const receiver = session();
    const request = receiver.requestQrPayload();
    const response = createPairingResponseV0(request, fixture, {
      now: () => now,
      ephemeralSecret: () => responseSecret.slice(),
    });
    expect(receiver.consumeResponse(response, now)).toEqual(fixture);
    expect(() => receiver.consumeResponse(response, now)).toThrow(/destroyed/i);

    const mismatchReceiver = session();
    const tampered = JSON.parse(
      createPairingResponseV0(mismatchReceiver.requestQrPayload(), fixture, {
        now: () => now,
        ephemeralSecret: () => responseSecret.slice(),
      })
    );
    tampered.challenge = tampered.challenge.startsWith("A")
      ? `B${tampered.challenge.slice(1)}`
      : `A${tampered.challenge.slice(1)}`;
    expect(() => mismatchReceiver.consumeResponse(tampered, now)).toThrow(
      /challenge/i
    );
    expect(mismatchReceiver.destroyed).toBe(true);

    const wrongKeyReceiver = session();
    const wrongRequest: PairingRequestV0 = {
      ...decodePairingRequestV0(wrongKeyReceiver.requestQrPayload()),
      ephemeral_pubkey: getPublicKey(hexToBytes("3".repeat(64))),
    };
    const wrongResponse = createPairingResponseV0(wrongRequest, fixture, {
      now: () => now,
      ephemeralSecret: () => responseSecret.slice(),
    });
    expect(() => wrongKeyReceiver.consumeResponse(wrongResponse, now)).toThrow(
      PairingError
    );
    expect(wrongKeyReceiver.destroyed).toBe(true);
  });

  it("rejects response key substitution, ciphertext tampering, and unknown fields", () => {
    const receiver = session();
    const response = JSON.parse(
      createPairingResponseV0(receiver.requestQrPayload(), fixture, {
        now: () => now,
        ephemeralSecret: () => responseSecret.slice(),
      })
    );
    expect(() =>
      receiver.consumeResponse({ ...response, extra: true }, now)
    ).toThrow(/unknown/i);
    expect(receiver.destroyed).toBe(true);

    const substituted = session();
    const keyChanged = JSON.parse(
      createPairingResponseV0(substituted.requestQrPayload(), fixture, {
        now: () => now,
        ephemeralSecret: () => responseSecret.slice(),
      })
    );
    keyChanged.response_pubkey = getPublicKey(hexToBytes("3".repeat(64)));
    expect(() => substituted.consumeResponse(keyChanged, now)).toThrow(
      /authentication/i
    );
    expect(substituted.destroyed).toBe(true);

    const second = session();
    const tampered = JSON.parse(
      createPairingResponseV0(second.requestQrPayload(), fixture, {
        now: () => now,
        ephemeralSecret: () => responseSecret.slice(),
      })
    );
    const last = tampered.ciphertext.at(-1);
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -1)}${
      last === "A" ? "B" : "A"
    }`;
    expect(() => second.consumeResponse(tampered, now)).toThrow(PairingError);
    expect(second.destroyed).toBe(true);
  });

  it("supports explicit cleanup before completion", () => {
    const receiver = session();
    receiver.destroy();
    receiver.destroy();
    expect(receiver.destroyed).toBe(true);
    expect(() => receiver.requestQrPayload()).toThrow(/destroyed/i);
  });
});
