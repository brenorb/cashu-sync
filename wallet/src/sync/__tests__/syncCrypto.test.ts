import { describe, expect, it } from "vitest";
import { getPublicKey, nip44 } from "nostr-tools";
import {
  createSyncEventV0,
  decryptSyncEventV0,
  getSyncPublicKey,
  hexToBytes,
} from "src/sync/syncCrypto";
import type { SnapshotV0 } from "src/sync/types";
import snapshotFixture from "../__fixtures__/snapshot-v0.json";
import vectorFixture from "../__fixtures__/nip44-v2.json";

const snapshot = snapshotFixture as SnapshotV0;
const vector = vectorFixture;
const secret = hexToBytes(
  "1111111111111111111111111111111111111111111111111111111111111111"
);

describe("dedicated snapshot crypto", () => {
  it("matches the official NIP-44 v2 vector", () => {
    const conversationKey = nip44.v2.utils.getConversationKey(
      vector.sec1,
      getPublicKey(hexToBytes(vector.sec2))
    );
    expect(Buffer.from(conversationKey).toString("hex")).toBe(
      vector.conversation_key
    );
    expect(
      nip44.v2.encrypt(
        vector.plaintext,
        conversationKey,
        hexToBytes(vector.nonce)
      )
    ).toBe(vector.payload);
    expect(nip44.v2.decrypt(vector.payload, conversationKey)).toBe(
      vector.plaintext
    );
  });

  it("signs, self-encrypts, verifies, and decrypts a snapshot", () => {
    const event = createSyncEventV0(snapshot, secret, {
      expectedMint: snapshot.mint,
      createdAt: 1780000400,
    });
    expect(event.kind).toBe(30078);
    expect(event.pubkey).toBe(getSyncPublicKey(secret));
    expect(event.tags).toEqual([
      ["d", "com.silentlink.cashu-sync.wallet.v0"],
      ["prev", snapshot.previous_event_id],
      ["schema", "0"],
    ]);
    expect(event.content).not.toContain(snapshot.proofs[0].secret);
    expect(
      decryptSyncEventV0(event, secret, { expectedMint: snapshot.mint })
    ).toEqual(snapshot);
  });

  it("rejects ciphertext tampering", () => {
    const event = createSyncEventV0(snapshot, secret, {
      expectedMint: snapshot.mint,
      createdAt: 1780000400,
    });
    const tampered = { ...event, content: `${event.content.slice(0, -1)}A` };
    expect(() =>
      decryptSyncEventV0(tampered, secret, { expectedMint: snapshot.mint })
    ).toThrow();
  });

  it("rejects a wrong key and a mismatched prev tag", () => {
    const event = createSyncEventV0(snapshot, secret, {
      expectedMint: snapshot.mint,
      createdAt: 1780000400,
    });
    const wrongSecret = hexToBytes(
      "2222222222222222222222222222222222222222222222222222222222222222"
    );
    expect(() =>
      decryptSyncEventV0(event, wrongSecret, { expectedMint: snapshot.mint })
    ).toThrow(/pubkey/i);

    const mismatched = createSyncEventV0(
      { ...snapshot, previous_event_id: "" },
      secret,
      { expectedMint: snapshot.mint, createdAt: 1780000400 }
    );
    mismatched.tags[1] = ["prev", "b".repeat(64)];
    expect(() =>
      decryptSyncEventV0(mismatched, secret, { expectedMint: snapshot.mint })
    ).toThrow();
  });

  it("preserves the explicit loopback-mint policy through encryption", () => {
    const loopbackSnapshot: SnapshotV0 = {
      ...snapshot,
      mint: "http://127.0.0.1:3338",
      history: snapshot.history.map((entry) => ({
        ...entry,
        mint: "http://127.0.0.1:3338",
      })),
    };
    const options = {
      expectedMint: loopbackSnapshot.mint,
      allowLoopbackHttp: true,
      createdAt: 1780000400,
    };
    const event = createSyncEventV0(loopbackSnapshot, secret, options);
    expect(decryptSyncEventV0(event, secret, options)).toEqual(
      loopbackSnapshot
    );
  });
});
