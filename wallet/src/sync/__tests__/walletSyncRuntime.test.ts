import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashuDexie } from "src/stores/dexie";
import { LocalAuthorityRepository } from "src/sync/authorityRepository";
import type { AuthorityPayloadV0 } from "src/sync/authorityPayload";
import type { PullOutcome, PublishOutcome } from "src/sync/syncCoordinator";
import type { SnapshotV0 } from "src/sync/types";
import {
  WalletSyncRuntime,
  WalletSyncRuntimeError,
  type RuntimeSession,
} from "src/sync/walletSyncRuntime";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECRET = "1".repeat(64);
const HEAD = "a".repeat(64);

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

function authority(head = ""): AuthorityPayloadV0 {
  return {
    schema: 0,
    mnemonic: MNEMONIC,
    sync_secret: SECRET,
    mint_url: "http://127.0.0.1:3338",
    relay_url: "ws://127.0.0.1:3344",
    head_event_id: head,
  };
}

function snapshot(overrides: Partial<SnapshotV0> = {}): SnapshotV0 {
  return {
    schema: 0,
    revision: 0,
    previous_event_id: "",
    mint: "http://127.0.0.1:3338",
    unit: "usd",
    proofs: [],
    counters: {},
    quotes: [],
    history: [],
    pending_operation: null,
    ...overrides,
  };
}

function fakeSession(local = snapshot()): RuntimeSession {
  return {
    repository: { exportSnapshot: vi.fn(async () => structuredClone(local)) },
    sync: {
      pull: vi.fn(async (): Promise<PullOutcome> => ({ status: "empty" })),
      publishCurrent: vi.fn(
        async (): Promise<PublishOutcome> => ({
          status: "accepted",
          resolution: "direct",
          eventId: HEAD,
          revision: 1,
        })
      ),
    },
  };
}

let db: CashuDexie;
let dbName: string;
let storage: MemoryStorage;
let authorityRepository: LocalAuthorityRepository;

beforeEach(async () => {
  dbName = `cashu-sync-runtime-${crypto.randomUUID()}`;
  db = new CashuDexie(dbName);
  await db.open();
  storage = new MemoryStorage();
  authorityRepository = new LocalAuthorityRepository(db, storage, {
    allowLoopbackHttp: true,
  });
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
});

describe("WalletSyncRuntime", () => {
  it("reports an unconfigured wallet without inventing authority", async () => {
    const factory = vi.fn();
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: factory,
    });
    await expect(runtime.start()).resolves.toEqual({ status: "unconfigured" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("publishes genesis when a new configured wallet finds an empty relay", async () => {
    authorityRepository.importAuthority(authority());
    const session = fakeSession();
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(runtime.start()).resolves.toEqual({
      status: "ready",
      sync: "genesis-published",
      eventId: HEAD,
      revision: 1,
    });
    expect(session.sync.pull).toHaveBeenCalledWith({ mode: "normal" });
    expect(session.sync.publishCurrent).toHaveBeenCalledOnce();
    expect(storage.getItem("cashu.mnemonic")).toBe(MNEMONIC);
  });

  it("bootstraps a pristine paired install from its remembered remote head", async () => {
    authorityRepository.importAuthority(authority(HEAD));
    const session = fakeSession();
    vi.mocked(session.sync.pull).mockResolvedValue({
      status: "applied",
      mode: "bootstrap",
      eventId: HEAD,
      revision: 7,
    });
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: "ready",
      sync: "applied",
      eventId: HEAD,
      revision: 7,
    });
    expect(session.sync.pull).toHaveBeenCalledWith({ mode: "bootstrap" });
    expect(session.sync.publishCurrent).not.toHaveBeenCalled();
  });

  it("fails closed when a remembered recovery head is absent", async () => {
    authorityRepository.importAuthority(authority(HEAD));
    const session = fakeSession();
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(runtime.start()).rejects.toThrow(/head is unavailable/);
    expect(session.sync.publishCurrent).not.toHaveBeenCalled();
    expect(runtime.currentSession()).toBeNull();
  });

  it("does not expose a session when initial pull fails", async () => {
    authorityRepository.importAuthority(authority());
    const session = fakeSession();
    vi.mocked(session.sync.pull).mockRejectedValue(new Error("relay offline"));
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(runtime.start()).rejects.toThrow("relay offline");
    expect(runtime.currentSession()).toBeNull();
  });

  it("uses normal pull for established local state and never republishes a no-op", async () => {
    authorityRepository.importAuthority(authority(HEAD));
    const session = fakeSession(
      snapshot({ revision: 3, previous_event_id: HEAD })
    );
    vi.mocked(session.sync.pull).mockResolvedValue({
      status: "noop",
      eventId: HEAD,
      revision: 3,
    });
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: "ready",
      sync: "noop",
    });
    expect(session.sync.pull).toHaveBeenCalledWith({ mode: "normal" });
    expect(session.sync.publishCurrent).not.toHaveBeenCalled();
  });

  it("refuses recovery authority import over non-pristine local money", async () => {
    const session = fakeSession(
      snapshot({
        proofs: [
          {
            id: "keyset",
            amount: 1,
            secret: "proof",
            C: "02proof",
            reserved: false,
          },
        ],
      })
    );
    const runtime = new WalletSyncRuntime({
      authority: authorityRepository,
      createSession: () => session,
    });

    await expect(
      runtime.importForRecovery(authority(HEAD))
    ).rejects.toBeInstanceOf(WalletSyncRuntimeError);
    expect(authorityRepository.load()).toBeNull();
  });
});
