import {
  MeltQuoteState,
  MintQuoteState,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Wallet,
} from "@cashu/cashu-ts";
import { cashuDb } from "src/stores/dexie";
import { useMintsStore } from "src/stores/mints";
import type { PaymentHistoryRow } from "src/stores/paymentHistory";
import { usePaymentHistoryStore } from "src/stores/paymentHistory";
import { useWalletStore } from "src/stores/wallet";
import { PaymentMethod } from "src/stores/walletTypes";
import {
  CashuTsOperationGateway,
  type MeltOperationIntent,
  type MintOperationIntent,
} from "src/sync/cashuOperationGateway";
import type { SyncRuntimeService } from "src/sync/syncRuntimeService";
import { useSyncRuntimeService } from "src/sync/syncRuntimeService";
import type { PublishOutcome } from "src/sync/syncCoordinator";
import {
  SyncOperationCoordinator,
  type SyncOperationOutcome,
} from "src/sync/syncOperationCoordinator";
import type { RuntimeSession } from "src/sync/walletSyncRuntime";
import { parseV0Bolt11Request } from "src/v0/profile";

export type MintQuoteView = {
  quote: string;
  request: string;
  amount: number;
  state: MintQuoteBolt11Response["state"];
};

export type MeltQuoteView = {
  quote: string;
  request: string;
  amount: number;
  feeReserve: number;
  state: MeltQuoteBolt11Response["state"];
};

type BrowserWalletPort = {
  activeWallet(updateKeysets?: boolean): Promise<Wallet>;
  getKeyset(mintUrl?: string | null, unit?: string | null): string;
};

export class V0WalletService {
  private coordinator: SyncOperationCoordinator<
    MintOperationIntent,
    MeltOperationIntent
  > | null = null;
  private coordinatorSession: RuntimeSession | null = null;
  private wallet: Wallet | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runtimeService: SyncRuntimeService,
    private readonly walletPort: BrowserWalletPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  syncNow(): Promise<void> {
    return this.serialize(() => this.syncNowUnlocked());
  }

  private async syncNowUnlocked(): Promise<void> {
    const pending = (await this.requireSession().repository.exportSnapshot())
      .pending_operation;
    if (pending !== null) {
      await (await this.ensureCoordinator()).resume();
      return;
    }
    await this.requireSession().sync.pull();
    await usePaymentHistoryStore().refreshFromDexie();
  }

  requestMintQuote(amount: number): Promise<MintQuoteView> {
    return this.serialize(() => this.requestMintQuoteUnlocked(amount));
  }

  private async requestMintQuoteUnlocked(
    amount: number
  ): Promise<MintQuoteView> {
    requirePositiveAmount(amount);
    const wallet = await this.ensureWallet();
    const quote = await wallet.createMintQuoteBolt11(amount);
    requireUsd(quote.unit);
    await this.persistMintQuote(quote);
    await this.publishQuoteOrRollback("mint", quote.quote);
    return {
      quote: quote.quote,
      request: quote.request,
      amount: quote.amount.toNumber(),
      state: quote.state,
    };
  }

  refreshMintQuote(quoteId: string): Promise<MintQuoteView> {
    return this.serialize(() => this.refreshMintQuoteUnlocked(quoteId));
  }

  private async refreshMintQuoteUnlocked(
    quoteId: string
  ): Promise<MintQuoteView> {
    const wallet = await this.ensureWallet();
    const stored = await this.requireStoredMintQuote(quoteId);
    const quote = await wallet.checkMintQuoteBolt11(quoteId);
    requireUsd(quote.unit);
    assertMintQuoteIdentity(stored, quote);
    await cashuDb.mintQuotes.update(quote.quote, {
      state: quote.state,
      expiry: quote.expiry,
    });
    await usePaymentHistoryStore().refreshFromDexie();
    return {
      quote: quote.quote,
      request: quote.request,
      amount: quote.amount.toNumber(),
      state: quote.state,
    };
  }

  mintPaidQuote(quoteId: string): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.mintPaidQuoteUnlocked(quoteId));
  }

  private async mintPaidQuoteUnlocked(
    quoteId: string
  ): Promise<SyncOperationOutcome> {
    const wallet = await this.ensureWallet();
    const stored = await this.requireStoredMintQuote(quoteId);
    const quote = await wallet.checkMintQuoteBolt11(quoteId);
    requireUsd(quote.unit);
    assertMintQuoteIdentity(stored, quote);
    if (quote.state === MintQuoteState.ISSUED) {
      // A previous claim may have reached the mint before the relay final
      // write. Resume the durable journal instead of submitting again.
      return (await this.ensureCoordinator()).resume();
    }
    if (quote.state !== MintQuoteState.PAID) {
      throw new Error(`mint quote is ${quote.state}, not PAID`);
    }
    await cashuDb.mintQuotes.update(quote.quote, { state: quote.state });
    return (await this.ensureCoordinator()).mint({
      amount: quote.amount.toNumber(),
      quote,
      keysetId: this.walletPort.getKeyset(null, "usd"),
    });
  }

  requestMeltQuote(request: string): Promise<MeltQuoteView> {
    return this.serialize(() => this.requestMeltQuoteUnlocked(request));
  }

  private async requestMeltQuoteUnlocked(
    request: string
  ): Promise<MeltQuoteView> {
    const bolt11 = parseV0Bolt11Request(request);
    const wallet = await this.ensureWallet();
    const quote = await wallet.createMeltQuoteBolt11(bolt11);
    requireUsd(quote.unit);
    if (quote.state !== MeltQuoteState.UNPAID) {
      throw new Error(`new melt quote is unexpectedly ${quote.state}`);
    }
    await this.persistMeltQuote(quote);
    await this.publishQuoteOrRollback("melt", quote.quote);
    return {
      quote: quote.quote,
      request: quote.request,
      amount: quote.amount.toNumber(),
      feeReserve: quote.fee_reserve.toNumber(),
      state: quote.state,
    };
  }

  payMeltQuote(quoteId: string): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.payMeltQuoteUnlocked(quoteId));
  }

  private async payMeltQuoteUnlocked(
    quoteId: string
  ): Promise<SyncOperationOutcome> {
    const wallet = await this.ensureWallet();
    const stored = await this.requireStoredMeltQuote(quoteId);
    const quote = await wallet.checkMeltQuoteBolt11(quoteId);
    requireUsd(quote.unit);
    assertMeltQuoteIdentity(stored, quote);
    if (quote.state !== MeltQuoteState.UNPAID) {
      throw new Error(`melt quote is ${quote.state}, not UNPAID`);
    }
    return (await this.ensureCoordinator()).melt({
      quote,
      proofs: useMintsStore().activeProofs,
      keysetId: this.walletPort.getKeyset(null, "usd"),
      preferAsync: false,
    });
  }

  resume(): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.resumeUnlocked());
  }

  private async resumeUnlocked(): Promise<SyncOperationOutcome> {
    return (await this.ensureCoordinator()).resume();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = () => this.runtimeService.runExclusive(operation);
    const result = this.queue.then(guarded, guarded);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private requireSession(): RuntimeSession {
    const session = this.runtimeService.runtime.currentSession();
    if (session === null) throw new Error("wallet sync is not configured");
    return session;
  }

  private async ensureWallet(): Promise<Wallet> {
    const session = this.requireSession();
    if (this.wallet === null || this.coordinatorSession !== session) {
      this.wallet = await this.walletPort.activeWallet(true);
    }
    return this.wallet;
  }

  private async ensureCoordinator(): Promise<
    SyncOperationCoordinator<MintOperationIntent, MeltOperationIntent>
  > {
    const session = this.requireSession();
    if (this.coordinator === null || this.coordinatorSession !== session) {
      const wallet = await this.ensureWallet();
      this.coordinator = new SyncOperationCoordinator({
        sync: session.sync,
        journal: session.journal,
        state: session.repository,
        gateway: new CashuTsOperationGateway(wallet),
      });
      this.coordinatorSession = session;
    }
    return this.coordinator;
  }

  private async persistMintQuote(
    quote: MintQuoteBolt11Response
  ): Promise<void> {
    const amount = quote.amount.toNumber();
    const payment = this.payment("mint", quote.quote, quote.request, amount);
    await cashuDb.transaction(
      "rw",
      [cashuDb.mintQuotes, cashuDb.paymentHistory],
      async () => {
        await cashuDb.mintQuotes.add({
          quote: quote.quote,
          method: PaymentMethod.Bolt11,
          request: quote.request,
          unit: "usd",
          amount,
          state: quote.state,
          expiry: quote.expiry,
          ...(quote.pubkey ? { pubkey: quote.pubkey } : {}),
        });
        await cashuDb.paymentHistory.add(payment);
      }
    );
    await usePaymentHistoryStore().refreshFromDexie();
  }

  private async persistMeltQuote(
    quote: MeltQuoteBolt11Response
  ): Promise<void> {
    const amount = quote.amount.toNumber();
    const payment = this.payment("melt", quote.quote, quote.request, amount);
    await cashuDb.transaction(
      "rw",
      [cashuDb.meltQuotes, cashuDb.paymentHistory],
      async () => {
        await cashuDb.meltQuotes.add({
          quote: quote.quote,
          method: PaymentMethod.Bolt11,
          request: quote.request,
          unit: "usd",
          amount,
          fee_reserve: quote.fee_reserve.toNumber(),
          state: quote.state,
          expiry: quote.expiry,
          payment_preimage: quote.payment_preimage,
        });
        await cashuDb.paymentHistory.add(payment);
      }
    );
    await usePaymentHistoryStore().refreshFromDexie();
  }

  private payment(
    direction: "mint" | "melt",
    quote: string,
    request: string,
    amount: number
  ): PaymentHistoryRow {
    return {
      id: `${direction}:${quote}`,
      direction,
      quote,
      method: PaymentMethod.Bolt11,
      paymentType: PaymentMethod.Bolt11,
      amount,
      request,
      memo: "",
      date: this.now().toISOString(),
      status: "pending",
      mint: useMintsStore().activeMintUrl,
      unit: "usd",
    };
  }

  private async publishQuoteOrRollback(
    direction: "mint" | "melt",
    quoteId: string
  ): Promise<void> {
    let outcome: PublishOutcome;
    try {
      outcome = await this.requireSession().sync.publishCurrent();
    } catch (error) {
      await this.rollbackQuote(direction, quoteId);
      throw error;
    }
    if (outcome.status === "accepted") return;
    if (outcome.status === "needs-reconciliation") {
      // The relay may have accepted this exact snapshot. Keep it locally until
      // a later pull proves which head won.
      throw new Error("relay acknowledgement is ambiguous; sync before paying");
    }
    await this.rollbackQuote(direction, quoteId);
    throw new Error("wallet changed on another device; quote was not saved");
  }

  private async rollbackQuote(
    direction: "mint" | "melt",
    quoteId: string
  ): Promise<void> {
    await cashuDb.transaction(
      "rw",
      [cashuDb.mintQuotes, cashuDb.meltQuotes, cashuDb.paymentHistory],
      async () => {
        if (direction === "mint") await cashuDb.mintQuotes.delete(quoteId);
        else await cashuDb.meltQuotes.delete(quoteId);
        await cashuDb.paymentHistory.delete(`${direction}:${quoteId}`);
      }
    );
    await usePaymentHistoryStore().refreshFromDexie();
  }

  private async requireStoredMintQuote(quoteId: string) {
    const quote = await cashuDb.mintQuotes.get(quoteId);
    if (!quote) throw new Error("mint quote is not stored in this wallet");
    return quote;
  }

  private async requireStoredMeltQuote(quoteId: string) {
    const quote = await cashuDb.meltQuotes.get(quoteId);
    if (!quote) throw new Error("melt quote is not stored in this wallet");
    return quote;
  }
}

function requirePositiveAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("amount must be a positive whole USD unit");
  }
}

function requireUsd(unit: string): void {
  if (unit !== "usd") throw new Error("v0 requires USD quotes");
}

function assertMintQuoteIdentity(
  stored: Record<string, unknown>,
  quote: MintQuoteBolt11Response
): void {
  if (
    stored.quote !== quote.quote ||
    stored.request !== quote.request ||
    stored.unit !== quote.unit ||
    stored.amount !== quote.amount.toNumber()
  ) {
    throw new Error("mint quote response does not match the stored quote");
  }
}

function assertMeltQuoteIdentity(
  stored: Record<string, unknown>,
  quote: MeltQuoteBolt11Response
): void {
  if (
    stored.quote !== quote.quote ||
    stored.request !== quote.request ||
    stored.unit !== quote.unit ||
    stored.amount !== quote.amount.toNumber() ||
    stored.fee_reserve !== quote.fee_reserve.toNumber()
  ) {
    throw new Error("melt quote response does not match the stored quote");
  }
}

let browserWalletService: V0WalletService | null = null;

export function useV0WalletService(): V0WalletService {
  if (browserWalletService === null) {
    browserWalletService = new V0WalletService(
      useSyncRuntimeService(),
      useWalletStore()
    );
  }
  return browserWalletService;
}

export function resetV0WalletService(): void {
  browserWalletService = null;
}

export const resetV0WalletServiceForTests = resetV0WalletService;
