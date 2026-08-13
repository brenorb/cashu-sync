import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CashuDexie } from "src/stores/dexie";
import {
  AUTHORITY_STORAGE_KEY_V0,
  LocalAuthorityRepository,
  type AuthorityStorage,
} from "src/sync/authorityRepository";
import type { AuthorityPayloadV0 } from "src/sync/authorityPayload";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECRET = "1".repeat(64);
const HEAD = "a".repeat(64);

class MemoryStorage implements AuthorityStorage {
  readonly values = new Map<string, string>();
  failOnSet: string | null = null;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failOnSet === key) throw new Error(`failed ${key}`);
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function authority(head = HEAD): AuthorityPayloadV0 {
  return {
    schema: 0,
    mnemonic: MNEMONIC,
    sync_secret: SECRET,
    mint_url: "http://127.0.0.1:3338",
    relay_url: "ws://127.0.0.1:3344",
    head_event_id: head,
  };
}

let db: CashuDexie;
let dbName: string;
let storage: MemoryStorage;
let repository: LocalAuthorityRepository;

beforeEach(async () => {
  dbName = `cashu-sync-authority-${crypto.randomUUID()}`;
  db = new CashuDexie(dbName);
  await db.open();
  storage = new MemoryStorage();
  repository = new LocalAuthorityRepository(db, storage, {
    allowLoopbackHttp: true,
  });
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
});

describe("LocalAuthorityRepository", () => {
  it("stores one strict authority record and repairs the wallet mnemonic from it", () => {
    repository.importAuthority(authority());
    expect(JSON.parse(storage.getItem(AUTHORITY_STORAGE_KEY_V0)!)).toEqual(
      authority()
    );
    expect(storage.getItem("cashu.mnemonic")).toBe(MNEMONIC);

    storage.setItem("cashu.mnemonic", "incomplete-write");
    expect(repository.loadAndRepairMnemonic()).toEqual(authority());
    expect(storage.getItem("cashu.mnemonic")).toBe(MNEMONIC);
  });

  it("keeps the authority record recoverable if the legacy mnemonic mirror fails", () => {
    storage.failOnSet = "cashu.mnemonic";
    expect(() => repository.importAuthority(authority())).toThrow(
      /failed cashu.mnemonic/
    );
    expect(repository.load()).toEqual(authority());

    storage.failOnSet = null;
    expect(repository.loadAndRepairMnemonic()).toEqual(authority());
    expect(storage.getItem("cashu.mnemonic")).toBe(MNEMONIC);
  });

  it("exports the current atomic wallet head instead of a stale pairing hint", async () => {
    repository.importAuthority(authority(HEAD));
    await db.walletSyncState.update("wallet", {
      revision: 9,
      head_event_id: "b".repeat(64),
    });

    await expect(repository.exportCurrent()).resolves.toEqual({
      ...authority(),
      head_event_id: "b".repeat(64),
    });
    expect(repository.load()?.head_event_id).toBe(HEAD);
  });

  it("rejects malformed storage and never silently creates credentials", async () => {
    expect(repository.load()).toBeNull();
    await expect(repository.exportCurrent()).rejects.toThrow(/not configured/i);

    storage.setItem(AUTHORITY_STORAGE_KEY_V0, "not-json");
    expect(() => repository.load()).toThrow(/invalid/i);
    expect(storage.getItem("cashu.mnemonic")).toBeNull();
  });

  it("removes both authority and mnemonic mirrors deliberately", () => {
    repository.importAuthority(authority());
    repository.clear();
    expect(repository.load()).toBeNull();
    expect(storage.getItem("cashu.mnemonic")).toBeNull();
  });
});
