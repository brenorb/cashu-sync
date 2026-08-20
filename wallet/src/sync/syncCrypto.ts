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
  SYNC_EVENT_D_TAG_V0,
  SYNC_EVENT_KIND_V0,
  type SnapshotV0,
} from "./types";
import {
  decodeAndEncodeSnapshotV0,
  decodeSnapshotV0,
  type DecodeSnapshotOptions,
} from "./snapshotCodec";

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const MAX_CIPHERTEXT_CHARS_V0 = 100_000;

export class SyncCryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SyncCryptoError";
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw new SyncCryptoError("invalid even-length hex string");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16))
  );
}

function assertSecret(secret: Uint8Array): Uint8Array {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) {
    throw new SyncCryptoError("sync secret must contain exactly 32 bytes");
  }
  return secret;
}

export function createSyncSecret(): Uint8Array {
  return generateSecretKey();
}

export function getSyncPublicKey(secret: Uint8Array): string {
  return getPublicKey(assertSecret(secret));
}

/** Rebuild the event without nostr-tools' cached verified Symbol. */
export function verifyEventFresh(event: Event): boolean {
  try {
    return verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      sig: event.sig,
    });
  } catch {
    return false;
  }
}

function conversationKey(secret: Uint8Array): Uint8Array {
  const publicKey = getSyncPublicKey(secret);
  return nip44.v2.utils.getConversationKey(bytesToHex(secret), publicKey);
}

export type CreateSyncEventOptions = DecodeSnapshotOptions & {
  createdAt?: number;
};

export function createSyncEventV0(
  snapshot: SnapshotV0,
  secret: Uint8Array,
  options: CreateSyncEventOptions = {}
): VerifiedEvent {
  const { snapshot: validated, encoded: plaintext } =
    decodeAndEncodeSnapshotV0(snapshot, options);
  let content: string;
  try {
    content = nip44.v2.encrypt(plaintext, conversationKey(secret));
  } catch (error) {
    throw new SyncCryptoError("could not encrypt snapshot", { cause: error });
  }
  return finalizeEvent(
    {
      kind: SYNC_EVENT_KIND_V0,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
      tags: [
        ["d", SYNC_EVENT_D_TAG_V0],
        ["prev", validated.previous_event_id],
        ["schema", "0"],
      ],
      content,
    },
    assertSecret(secret)
  );
}

function assertEnvelope(event: Event, expectedPublicKey: string): string {
  if (!verifyEventFresh(event)) {
    throw new SyncCryptoError("invalid event signature or event id");
  }
  if (event.kind !== SYNC_EVENT_KIND_V0) {
    throw new SyncCryptoError("wrong sync event kind");
  }
  if (event.pubkey !== expectedPublicKey) {
    throw new SyncCryptoError("wrong sync pubkey");
  }
  const expectedTags = [
    ["d", SYNC_EVENT_D_TAG_V0],
    ["prev", event.tags[1]?.[1] ?? ""],
    ["schema", "0"],
  ];
  if (
    event.tags.length !== 3 ||
    JSON.stringify(event.tags) !== JSON.stringify(expectedTags)
  ) {
    throw new SyncCryptoError("invalid sync event tags");
  }
  const previousEventId = event.tags[1][1];
  if (
    previousEventId !== "" &&
    (!HEX_32_BYTES.test(previousEventId) || previousEventId === event.id)
  ) {
    throw new SyncCryptoError("invalid prev event id");
  }
  if (
    typeof event.content !== "string" ||
    event.content.length === 0 ||
    event.content.length > MAX_CIPHERTEXT_CHARS_V0
  ) {
    throw new SyncCryptoError("invalid ciphertext size");
  }
  return previousEventId;
}

export function decryptSyncEventV0(
  event: Event,
  secret: Uint8Array,
  options: DecodeSnapshotOptions = {}
): SnapshotV0 {
  const expectedPublicKey = getSyncPublicKey(secret);
  const outerPreviousEventId = assertEnvelope(event, expectedPublicKey);
  let plaintext: string;
  try {
    plaintext = nip44.v2.decrypt(event.content, conversationKey(secret));
  } catch (error) {
    throw new SyncCryptoError("could not authenticate or decrypt snapshot", {
      cause: error,
    });
  }
  const snapshot = decodeSnapshotV0(plaintext, options);
  if (snapshot.previous_event_id !== outerPreviousEventId) {
    throw new SyncCryptoError(
      "encrypted previous_event_id does not match outer prev tag"
    );
  }
  return snapshot;
}
