import type {
  MeltQuoteRow,
  MintQuoteRow,
  PaymentHistoryRow,
} from "../stores/paymentHistory";
import {
  WALLET_SYNC_STATE_ID,
  initialWalletSyncState,
  type CashuDexie,
  type WalletSyncStateRow,
} from "../stores/dexie";
import { decodeSnapshotV0, type DecodeSnapshotOptions } from "./snapshotCodec";
import type {
  MeltQuoteSnapshotV0,
  MintQuoteSnapshotV0,
  PaymentHistoryV0,
  QuoteSnapshotV0,
  SnapshotV0,
} from "./types";

const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;

function requireBolt11Method(
  row: { method?: string; paymentType?: string },
  path: string
): void {
  if (row.method !== "bolt11") {
    throw new Error(`${path}.method must be bolt11 in snapshot v0`);
  }
  if (row.paymentType !== undefined && row.paymentType !== "bolt11") {
    throw new Error(`${path}.paymentType must be bolt11 in snapshot v0`);
  }
}

function validateHeadEventId(value: string): string {
  if (value !== "" && !EVENT_ID_PATTERN.test(value)) {
    throw new Error(
      "head event ID must be empty or 64 lowercase hex characters"
    );
  }
  return value;
}

function mintQuoteToSnapshot(row: MintQuoteRow): MintQuoteSnapshotV0 {
  requireBolt11Method(row, `mint quote ${row.quote}`);
  return {
    type: "mint",
    quote: row.quote,
    request: row.request,
    amount: row.amount as number,
    unit: row.unit as "usd",
    state: row.state as MintQuoteSnapshotV0["state"],
    expiry: row.expiry ?? null,
    ...(row.pubkey === undefined ? {} : { pubkey: row.pubkey }),
  };
}

function meltQuoteToSnapshot(row: MeltQuoteRow): MeltQuoteSnapshotV0 {
  requireBolt11Method(row, `melt quote ${row.quote}`);
  return {
    type: "melt",
    quote: row.quote,
    request: row.request as string,
    amount: row.amount as number,
    fee_reserve: row.fee_reserve as number,
    unit: row.unit as "usd",
    state: row.state as MeltQuoteSnapshotV0["state"],
    expiry: row.expiry as number,
    payment_preimage: row.payment_preimage ?? null,
  };
}

function historyToSnapshot(row: PaymentHistoryRow): PaymentHistoryV0 {
  requireBolt11Method(row, `payment history ${row.id}`);
  return {
    id: row.id,
    direction: row.direction,
    quote: row.quote,
    amount: row.amount,
    request: row.request,
    memo: row.memo,
    date: row.date,
    status: row.status,
    mint: row.mint,
    unit: row.unit as "usd",
    ...(row.paidDate === undefined ? {} : { paid_date: row.paidDate }),
    ...(row.label === undefined ? {} : { label: row.label }),
  };
}

function quoteToRow(quote: QuoteSnapshotV0): MintQuoteRow | MeltQuoteRow {
  if (quote.type === "mint") {
    return {
      quote: quote.quote,
      method: "bolt11",
      request: quote.request,
      amount: quote.amount,
      unit: quote.unit,
      state: quote.state,
      expiry: quote.expiry,
      ...(quote.pubkey === undefined ? {} : { pubkey: quote.pubkey }),
    } as MintQuoteRow;
  }
  return {
    quote: quote.quote,
    method: "bolt11",
    request: quote.request,
    amount: quote.amount,
    fee_reserve: quote.fee_reserve,
    unit: quote.unit,
    state: quote.state,
    expiry: quote.expiry,
    payment_preimage: quote.payment_preimage,
  } as MeltQuoteRow;
}

function historyToRow(entry: PaymentHistoryV0): PaymentHistoryRow {
  return {
    id: entry.id,
    direction: entry.direction,
    quote: entry.quote,
    method: "bolt11",
    paymentType: "bolt11",
    amount: entry.amount,
    request: entry.request,
    memo: entry.memo,
    date: entry.date,
    status: entry.status,
    mint: entry.mint,
    unit: entry.unit,
    ...(entry.paid_date === undefined ? {} : { paidDate: entry.paid_date }),
    ...(entry.label === undefined ? {} : { label: entry.label }),
  } as PaymentHistoryRow;
}

/** Atomic boundary between sync snapshots and Cashu.me's existing Dexie tables. */
export class LocalWalletRepository {
  private readonly decodeOptions: DecodeSnapshotOptions;

  constructor(
    private readonly db: CashuDexie,
    private readonly configuredMint: string,
    options: Omit<DecodeSnapshotOptions, "expectedMint"> = {}
  ) {
    this.decodeOptions = { ...options, expectedMint: configuredMint };
  }

  async exportSnapshot(): Promise<SnapshotV0> {
    return this.db.transaction(
      "r",
      [
        this.db.proofs,
        this.db.paymentHistory,
        this.db.mintQuotes,
        this.db.meltQuotes,
        this.db.walletSyncState,
      ],
      async () => {
        const [proofs, history, mintQuotes, meltQuotes, state] =
          await Promise.all([
            this.db.proofs.toArray(),
            this.db.paymentHistory.toArray(),
            this.db.mintQuotes.toArray(),
            this.db.meltQuotes.toArray(),
            this.db.walletSyncState.get(WALLET_SYNC_STATE_ID),
          ]);
        const syncState: WalletSyncStateRow = state ?? initialWalletSyncState();
        return decodeSnapshotV0(
          {
            schema: 0,
            revision: syncState.revision,
            previous_event_id: syncState.head_event_id,
            mint: this.configuredMint,
            unit: "usd",
            proofs,
            counters: syncState.counters,
            quotes: [
              ...mintQuotes.map(mintQuoteToSnapshot),
              ...meltQuotes.map(meltQuoteToSnapshot),
            ],
            history: history.map(historyToSnapshot),
            pending_operation: syncState.pending_operation,
          },
          this.decodeOptions
        );
      }
    );
  }

  async applySnapshot(
    snapshot: SnapshotV0,
    headEventId: string
  ): Promise<void> {
    const validated = decodeSnapshotV0(snapshot, this.decodeOptions);
    const head = validateHeadEventId(headEventId);
    const mintQuotes = validated.quotes
      .filter((quote): quote is MintQuoteSnapshotV0 => quote.type === "mint")
      .map(quoteToRow) as MintQuoteRow[];
    const meltQuotes = validated.quotes
      .filter((quote): quote is MeltQuoteSnapshotV0 => quote.type === "melt")
      .map(quoteToRow) as MeltQuoteRow[];

    await this.db.transaction(
      "rw",
      [
        this.db.proofs,
        this.db.paymentHistory,
        this.db.mintQuotes,
        this.db.meltQuotes,
        this.db.walletSyncState,
      ],
      async () => {
        await Promise.all([
          this.db.proofs.clear(),
          this.db.paymentHistory.clear(),
          this.db.mintQuotes.clear(),
          this.db.meltQuotes.clear(),
        ]);
        await this.db.proofs.bulkPut(validated.proofs);
        await this.db.mintQuotes.bulkPut(mintQuotes);
        await this.db.meltQuotes.bulkPut(meltQuotes);
        await this.db.paymentHistory.bulkPut(
          validated.history.map(historyToRow)
        );
        await this.db.walletSyncState.put({
          id: WALLET_SYNC_STATE_ID,
          revision: validated.revision,
          head_event_id: head,
          counters: { ...validated.counters },
          pending_operation: validated.pending_operation,
        });
      }
    );
  }
}
