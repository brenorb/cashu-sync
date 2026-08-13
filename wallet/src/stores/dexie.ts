import { defineStore } from "pinia";
import Dexie, { Table } from "dexie";
import { useLocalStorage } from "@vueuse/core";
import type { WalletProof } from "./mints";
import type { PendingOperationV0 } from "../sync/types";

export const WALLET_SYNC_STATE_ID = "wallet" as const;

export type WalletSyncStateRow = {
  id: typeof WALLET_SYNC_STATE_ID;
  revision: number;
  head_event_id: string;
  counters: Record<string, number>;
  pending_operation: PendingOperationV0 | null;
};

export function initialWalletSyncState(): WalletSyncStateRow {
  return {
    id: WALLET_SYNC_STATE_ID,
    revision: 0,
    head_event_id: "",
    counters: {},
    pending_operation: null,
  };
}

// export interface Proof {
//   id: string
//   C: string
//   amount: number
//   reserved: boolean
//   secret: string
//   quote?: string
// }

export class CashuDexie extends Dexie {
  proofs!: Table<WalletProof>;
  paymentHistory!: Table<any>;
  mintQuotes!: Table<any>;
  meltQuotes!: Table<any>;
  ecashHistory!: Table<any>;
  walletSyncState!: Table<WalletSyncStateRow, typeof WALLET_SYNC_STATE_ID>;

  constructor(name = "db") {
    super(name);
    this.version(1).stores({
      proofs: "secret, id, C, amount, reserved, quote",
    });
    this.version(2).stores({
      proofs: "secret, id, C, amount, reserved, quote",
      paymentHistory:
        "id, direction, quote, parentQuote, method, status, mint, unit, date, paidDate, [direction+quote], [direction+status], [method+status]",
      mintQuotes: "quote, method, request, unit, state, expiry, pubkey",
      meltQuotes: "quote, method, request, unit, state, expiry",
    });
    this.version(3).stores({
      proofs: "secret, id, C, amount, reserved, quote",
      paymentHistory:
        "id, direction, quote, parentQuote, method, status, mint, unit, date, paidDate, [direction+quote], [direction+status], [method+status]",
      mintQuotes: "quote, method, request, unit, state, expiry, pubkey",
      meltQuotes: "quote, method, request, unit, state, expiry",
      ecashHistory:
        "id, status, token, mint, unit, date, paidDate, paymentRequestId, [status+date], [mint+unit]",
    });
    this.version(4)
      .stores({
        proofs: "secret, id, C, amount, reserved, quote",
        paymentHistory:
          "id, direction, quote, parentQuote, method, status, mint, unit, date, paidDate, [direction+quote], [direction+status], [method+status]",
        mintQuotes: "quote, method, request, unit, state, expiry, pubkey",
        meltQuotes: "quote, method, request, unit, state, expiry",
        ecashHistory:
          "id, status, token, mint, unit, date, paidDate, paymentRequestId, [status+date], [mint+unit]",
        walletSyncState: "id",
      })
      .upgrade((transaction) =>
        transaction.table("walletSyncState").put(initialWalletSyncState())
      );
    this.on("populate", (transaction) =>
      transaction.table("walletSyncState").put(initialWalletSyncState())
    );
  }
}

export const cashuDb = new CashuDexie();

export async function resetCashuDexie(db: CashuDexie): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.proofs,
      db.paymentHistory,
      db.mintQuotes,
      db.meltQuotes,
      db.ecashHistory,
      db.walletSyncState,
    ],
    async () => {
      await Promise.all([
        db.proofs.clear(),
        db.paymentHistory.clear(),
        db.mintQuotes.clear(),
        db.meltQuotes.clear(),
        db.ecashHistory.clear(),
      ]);
      await db.walletSyncState.put(initialWalletSyncState());
    }
  );
}

export const useDexieStore = defineStore("dexie", {
  state: () => ({
    migratedToDexie: useLocalStorage<boolean>("cashu.dexie.migrated", false),
  }),
  getters: {},
  actions: {
    migrateToDexie: async function () {
      const { useProofsStore } = await import("./proofs");
      const proofsStore = useProofsStore();
      if (this.migratedToDexie) {
        return;
      }
      console.log("Migrating to Dexie");
      const proofs = localStorage.getItem("cashu.proofs");
      let parsedProofs: WalletProof[] = [];
      if (!proofs) {
        console.log("No cashu.proofs in localStorage to migrate");
        this.migratedToDexie = true;
        return;
      }
      parsedProofs = JSON.parse(proofs) as WalletProof[];
      if (!parsedProofs.length) {
        console.log("No proofs to migrate");
        this.migratedToDexie = true;
        return;
      }
      // start migration
      const { useStorageStore } = await import("./storage");
      await useStorageStore().exportWalletState();
      parsedProofs.forEach((proof) => {
        cashuDb.proofs.add(proof);
      });
      console.log(
        `Migrated ${cashuDb.proofs.count()} proofs. Before: ${
          parsedProofs.length
        } proofs, After: ${(await proofsStore.getProofs()).length} proofs`
      );
      console.log(
        `Proofs sum before: ${proofsStore.sumProofs(
          parsedProofs
        )}, after: ${proofsStore.sumProofs(await proofsStore.getProofs())}`
      );
      this.migratedToDexie = true;
      // remove proofs from localstorage
      localStorage.removeItem("cashu.proofs");
    },
    deleteAllTables: async function () {
      await resetCashuDexie(cashuDb);
    },
  },
});
