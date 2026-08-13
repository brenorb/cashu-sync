import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CashuDexie,
  initialWalletSyncState,
  resetCashuDexie,
} from "src/stores/dexie";
import {
  DexieCounterSource,
  migrateLegacyKeysetCounters,
} from "src/sync/durableCounterSource";
import { LocalWalletRepository } from "src/sync/localWalletRepository";
import type { SnapshotV0 } from "src/sync/types";
import snapshotFixture from "../__fixtures__/snapshot-v0.json";

const MINT = "https://usd-mint.example";
const snapshot = snapshotFixture as SnapshotV0;
let db: CashuDexie;
let dbName: string;

beforeEach(async () => {
  dbName = `cashu-sync-${crypto.randomUUID()}`;
  db = new CashuDexie(dbName);
  await db.open();
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
});

describe("durable CounterSource", () => {
  it("creates exactly one v4 wallet sync state row", async () => {
    expect(db.verno).toBe(4);
    expect(await db.walletSyncState.toArray()).toEqual([
      {
        id: "wallet",
        revision: 0,
        head_event_id: "",
        counters: {},
        pending_operation: null,
      },
    ]);
  });

  it("reserves disjoint ranges concurrently and persists across restart", async () => {
    const source = new DexieCounterSource(db);
    const secondConnection = new CashuDexie(dbName);
    await secondConnection.open();
    const secondSource = new DexieCounterSource(secondConnection);
    const ranges = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? source : secondSource).reserve("00c0ffee", 3)
      )
    );
    expect(ranges.map((range) => range.start).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index * 3)
    );
    expect(await source.snapshot()).toEqual({ "00c0ffee": 36 });
    expect(await source.reserve("00c0ffee", 0)).toEqual({
      start: 36,
      count: 0,
    });
    await source.advanceToAtLeast("00c0ffee", 20);
    expect(await source.snapshot()).toEqual({ "00c0ffee": 36 });

    secondConnection.close();
    db.close();
    db = new CashuDexie(dbName);
    await db.open();
    const restarted = new DexieCounterSource(db);
    expect(await restarted.reserve("00c0ffee", 2)).toEqual({
      start: 36,
      count: 2,
    });
  });

  it("migrates cashu.keysetCounters once and preserves the highest cursor", async () => {
    const values = new Map([
      [
        "cashu.keysetCounters",
        JSON.stringify([
          { id: "00c0ffee", counter: 9 },
          { id: "00decaf0", counter: 4 },
        ]),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    };
    const source = new DexieCounterSource(db);
    await source.advanceToAtLeast("00c0ffee", 12);

    await migrateLegacyKeysetCounters(db, storage);

    expect(await source.snapshot()).toEqual({
      "00c0ffee": 12,
      "00decaf0": 4,
    });
    expect(storage.getItem("cashu.keysetCounters")).toBeNull();

    await migrateLegacyKeysetCounters(db, storage);
    expect(await source.snapshot()).toEqual({
      "00c0ffee": 12,
      "00decaf0": 4,
    });
  });

  it("leaves malformed legacy counter JSON intact", async () => {
    const values = new Map([["cashu.keysetCounters", "{not-json"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    };

    await expect(migrateLegacyKeysetCounters(db, storage)).rejects.toThrow();
    expect(storage.getItem("cashu.keysetCounters")).toBe("{not-json");
    expect(await new DexieCounterSource(db).snapshot()).toEqual({});
  });

  it("rejects counter overflow without changing the cursor", async () => {
    await db.walletSyncState.update("wallet", {
      counters: { overflow: Number.MAX_SAFE_INTEGER },
    });
    const source = new DexieCounterSource(db);

    await expect(source.reserve("overflow", 1)).rejects.toThrow(/overflow/i);
    expect(await source.snapshot()).toEqual({
      overflow: Number.MAX_SAFE_INTEGER,
    });
  });

  it("awaits a full wallet reset while retaining the singleton", async () => {
    await db.proofs.put(snapshot.proofs[0]);
    await db.paymentHistory.put({ id: "history" });
    await db.walletSyncState.update("wallet", {
      revision: 9,
      counters: { "00c0ffee": 22 },
    });

    await resetCashuDexie(db);

    expect(await db.proofs.count()).toBe(0);
    expect(await db.paymentHistory.count()).toBe(0);
    expect(await db.walletSyncState.toArray()).toEqual([
      initialWalletSyncState(),
    ]);
  });
});

describe("LocalWalletRepository", () => {
  it("atomically applies and exports the complete SnapshotV0", async () => {
    const repository = new LocalWalletRepository(db, MINT);
    const head = "b".repeat(64);

    await repository.applySnapshot(snapshot, head);

    expect(await repository.exportSnapshot()).toEqual({
      ...snapshot,
      previous_event_id: head,
    });
    expect(await db.walletSyncState.get("wallet")).toMatchObject({
      id: "wallet",
      revision: snapshot.revision,
      head_event_id: head,
      counters: snapshot.counters,
      pending_operation: snapshot.pending_operation,
    });
  });

  it("rolls back every table and the head when a mid-apply write fails", async () => {
    const repository = new LocalWalletRepository(db, MINT);
    const oldHead = "b".repeat(64);
    await repository.applySnapshot(snapshot, oldHead);
    const before = await repository.exportSnapshot();
    const changed: SnapshotV0 = {
      ...snapshot,
      revision: 8,
      proofs: [{ ...snapshot.proofs[0], secret: "replacement-proof" }],
      history: [{ ...snapshot.history[0], id: "mint:replacement" }],
    };
    vi.spyOn(db.paymentHistory, "bulkPut").mockRejectedValueOnce(
      new Error("injected mid-apply failure")
    );

    await expect(
      repository.applySnapshot(changed, "c".repeat(64))
    ).rejects.toThrow("injected mid-apply failure");

    expect(await repository.exportSnapshot()).toEqual(before);
    expect((await db.walletSyncState.get("wallet"))?.head_event_id).toBe(
      oldHead
    );
  });

  it("keeps counter reservations made after an export monotonic", async () => {
    const repository = new LocalWalletRepository(db, MINT);
    await repository.applySnapshot(snapshot, "b".repeat(64));
    const source = new DexieCounterSource(db);

    expect(await source.reserve("00c0ffee", 2)).toEqual({
      start: 12,
      count: 2,
    });
    expect((await repository.exportSnapshot()).counters).toEqual({
      "00c0ffee": 14,
    });
  });

  it.each([
    [
      "mint quote",
      async () =>
        db.mintQuotes.put({
          quote: "legacy-bolt12-mint",
          method: "bolt12",
          request: "lno1legacy",
          unit: "usd",
        }),
    ],
    [
      "melt quote",
      async () =>
        db.meltQuotes.put({
          quote: "legacy-onchain-melt",
          method: "onchain",
          request: "bitcoin:legacy",
          unit: "usd",
        }),
    ],
    [
      "payment history",
      async () =>
        db.paymentHistory.put({
          id: "legacy-bolt12-history",
          direction: "melt",
          quote: "legacy-bolt12-melt",
          method: "bolt12",
          paymentType: "bolt12",
          amount: 1,
          request: "lno1legacy",
          memo: "legacy",
          date: "2026-08-13T00:00:00.000Z",
          status: "pending",
          mint: MINT,
          unit: "usd",
        }),
    ],
  ])(
    "rejects an incompatible legacy %s instead of relabeling it",
    async (_name, insert) => {
      const repository = new LocalWalletRepository(db, MINT);
      await insert();

      await expect(repository.exportSnapshot()).rejects.toThrow(/bolt11/i);
    }
  );

  it("rejects an invalid new head before touching any wallet table", async () => {
    const repository = new LocalWalletRepository(db, MINT);
    await repository.applySnapshot(snapshot, "b".repeat(64));
    const before = await repository.exportSnapshot();
    const clear = vi.spyOn(db.proofs, "clear");

    await expect(
      repository.applySnapshot(
        { ...snapshot, revision: snapshot.revision + 1 },
        "not-a-head"
      )
    ).rejects.toThrow(/head/i);
    expect(clear).not.toHaveBeenCalled();
    expect(await repository.exportSnapshot()).toEqual(before);
  });

  it.each([
    [
      "proof",
      () => ({
        ...snapshot,
        proofs: [
          { ...snapshot.proofs[0], amount: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
    ],
    [
      "quote",
      () => ({
        ...snapshot,
        quotes: [{ ...snapshot.quotes[0], unit: "sat" }],
      }),
    ],
  ])(
    "rejects an invalid %s before opening the write transaction",
    async (_name, make) => {
      const repository = new LocalWalletRepository(db, MINT);
      const clear = vi.spyOn(db.proofs, "clear");

      await expect(
        repository.applySnapshot(make() as SnapshotV0, "b".repeat(64))
      ).rejects.toThrow();
      expect(clear).not.toHaveBeenCalled();
    }
  );
});
