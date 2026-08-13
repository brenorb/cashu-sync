import type { CounterRange, CounterSource } from "@cashu/cashu-ts";
import {
  WALLET_SYNC_STATE_ID,
  initialWalletSyncState,
  type CashuDexie,
  type WalletSyncStateRow,
} from "../stores/dexie";

const LEGACY_COUNTERS_KEY = "cashu.keysetCounters";

type LegacyCounterStorage = Pick<Storage, "getItem" | "removeItem">;

export interface DurableCounterSource extends CounterSource {
  snapshot(): Promise<Record<string, number>>;
  replaceAll(counters: Record<string, number>): Promise<void>;
}

function assertCursor(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function assertKeysetId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${path} must be a non-empty keyset ID`);
  }
  return value;
}

async function readState(db: CashuDexie): Promise<WalletSyncStateRow> {
  return (
    (await db.walletSyncState.get(WALLET_SYNC_STATE_ID)) ??
    initialWalletSyncState()
  );
}

/** A transaction-backed cashu-ts CounterSource shared by every wallet instance. */
export class DexieCounterSource implements DurableCounterSource {
  constructor(private readonly db: CashuDexie) {}

  async reserve(keysetId: string, n: number): Promise<CounterRange> {
    const id = assertKeysetId(keysetId, "keysetId");
    const count = assertCursor(n, "count");
    return this.db.transaction("rw", this.db.walletSyncState, async () => {
      const state = await readState(this.db);
      const start = assertCursor(state.counters[id] ?? 0, `counter.${id}`);
      if (count === 0) return { start, count };
      const next = start + count;
      if (!Number.isSafeInteger(next)) throw new Error("counter overflow");
      await this.db.walletSyncState.put({
        ...state,
        counters: { ...state.counters, [id]: next },
      });
      return { start, count };
    });
  }

  async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
    const id = assertKeysetId(keysetId, "keysetId");
    const minimum = assertCursor(minNext, "minNext");
    await this.db.transaction("rw", this.db.walletSyncState, async () => {
      const state = await readState(this.db);
      const current = assertCursor(state.counters[id] ?? 0, `counter.${id}`);
      if (current >= minimum) return;
      await this.db.walletSyncState.put({
        ...state,
        counters: { ...state.counters, [id]: minimum },
      });
    });
  }

  async snapshot(): Promise<Record<string, number>> {
    return { ...(await readState(this.db)).counters };
  }

  /** Replace the cursor namespace when the wallet switches to a new seed. */
  async replaceAll(counters: Record<string, number>): Promise<void> {
    const validated: Record<string, number> = {};
    for (const [keysetId, next] of Object.entries(counters)) {
      validated[assertKeysetId(keysetId, "keysetId")] = assertCursor(
        next,
        `counter.${keysetId}`
      );
    }
    await this.db.transaction("rw", this.db.walletSyncState, async () => {
      const state = await readState(this.db);
      await this.db.walletSyncState.put({ ...state, counters: validated });
    });
  }
}

export async function migrateLegacyKeysetCounters(
  db: CashuDexie,
  storage: LegacyCounterStorage = localStorage
): Promise<void> {
  const raw = storage.getItem(LEGACY_COUNTERS_KEY);
  if (raw === null) return;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${LEGACY_COUNTERS_KEY} must contain an array`);
  }
  const legacy: Record<string, number> = {};
  parsed.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${LEGACY_COUNTERS_KEY}[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const id = assertKeysetId(row.id, `${LEGACY_COUNTERS_KEY}[${index}].id`);
    const counter = assertCursor(
      row.counter,
      `${LEGACY_COUNTERS_KEY}[${index}].counter`
    );
    legacy[id] = Math.max(legacy[id] ?? 0, counter);
  });
  await db.transaction("rw", db.walletSyncState, async () => {
    const state = await readState(db);
    const counters = { ...state.counters };
    for (const [id, counter] of Object.entries(legacy)) {
      counters[id] = Math.max(counters[id] ?? 0, counter);
    }
    await db.walletSyncState.put({ ...state, counters });
  });
  storage.removeItem(LEGACY_COUNTERS_KEY);
}
