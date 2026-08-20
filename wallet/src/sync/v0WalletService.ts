import {
  Amount,
  MeltQuoteState,
  MintQuoteState,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Wallet,
} from "@cashu/cashu-ts";
import { cashuDb } from "src/stores/dexie";
import { useMintsStore } from "src/stores/mints";
import { useProofsStore } from "src/stores/proofs";
import type {
  MeltQuoteRow,
  PaymentHistoryRow,
} from "src/stores/paymentHistory";
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
  isOutputsAlreadySigned,
  type SyncOperationOutcome,
} from "src/sync/syncOperationCoordinator";
import type { RuntimeSession } from "src/sync/walletSyncRuntime";
import { parseV0Bolt11Request } from "src/v0/profile";
import type { SnapshotV0 } from "src/sync/types";
import type { RelayWatchStatus } from "src/sync/relayClient";

const MAX_CROSS_DEVICE_RETRIES = 3;

class WalletConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletConflictError";
  }
}

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

type MeltQuoteRowLike = Pick<
  MeltQuoteRow,
  "quote" | "request" | "amount" | "state"
>;

export class V0WalletService {
  private coordinator: SyncOperationCoordinator<
    MintOperationIntent,
    MeltOperationIntent
  > | null = null;
  private coordinatorSession: RuntimeSession | null = null;
  private wallet: Wallet | null = null;
  private queue: Promise<void> = Promise.resolve();
  private liveSyncStop: (() => void) | null = null;

  constructor(
    private readonly runtimeService: SyncRuntimeService,
    private readonly walletPort: BrowserWalletPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  syncNow(): Promise<void> {
    return this.serialize(() => this.syncNowUnlocked());
  }

  startLiveSync(
    onSynced?: () => void,
    onStatus?: (status: RelayWatchStatus) => void
  ): void {
    this.stopLiveSync();
    const session = this.requireSession();
    this.liveSyncStop = session.sync.watchCurrent(() => {
      void this.syncNow()
        .then(() => onSynced?.())
        .catch(() => {
          // REST/visibility sync remains the fallback when the relay is busy.
        });
    }, onStatus);
  }

  stopLiveSync(): void {
    this.liveSyncStop?.();
    this.liveSyncStop = null;
  }

  private async syncNowUnlocked(): Promise<void> {
    const session = this.requireSession();
    const pending = (await session.repository.exportSnapshot())
      .pending_operation;
    if (pending !== null) {
      const outcome = await (await this.ensureCoordinator()).resume();
      if (outcome.status === "aborted-before-submit") {
        // Another paired wallet won the CAS while this device was resuming.
        // Pull its accepted snapshot instead of leaving the local journal stale.
        await this.refreshAfterRemoteChange();
      }
      return;
    }
    await this.refreshAfterRemoteChange();
  }

  requestMintQuote(amount: number): Promise<MintQuoteView> {
    return this.serialize(() => this.requestMintQuoteUnlocked(amount));
  }

  private async requestMintQuoteUnlocked(
    amount: number
  ): Promise<MintQuoteView> {
    requirePositiveAmount(amount);
    for (let attempt = 0; attempt < MAX_CROSS_DEVICE_RETRIES; attempt += 1) {
      const wallet = await this.ensureWallet();
      const quote = await wallet.createMintQuoteBolt11(amount);
      requireUsd(quote.unit);
      await this.persistMintQuote(quote);
      try {
        await this.publishQuoteOrRollback("mint", quote.quote);
        return {
          quote: quote.quote,
          request: quote.request,
          amount: quote.amount.toNumber(),
          state: quote.state,
        };
      } catch (error) {
        if (!(error instanceof WalletConflictError)) throw error;
        await this.refreshAfterRemoteChange();
      }
    }
    throw new WalletConflictError(
      "wallet changed repeatedly on another device; try again"
    );
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
    const resumed = await this.resumeIfPending("mint", quoteId);
    if (resumed !== null && resumed.status !== "aborted-before-submit") {
      return resumed;
    }
    if (resumed?.status === "aborted-before-submit") {
      await this.refreshAfterRemoteChange();
    }
    for (let attempt = 0; attempt < MAX_CROSS_DEVICE_RETRIES; attempt += 1) {
      const wallet = await this.ensureWallet();
      const stored = await this.requireStoredMintQuote(quoteId);
      const quote = await wallet.checkMintQuoteBolt11(quoteId);
      requireUsd(quote.unit);
      assertMintQuoteIdentity(stored, quote);
      if (quote.state === MintQuoteState.ISSUED) {
        // The mint may already have issued the outputs while the final relay
        // write completed elsewhere. With no local journal left, this is an
        // idempotent success, not a recovery error.
        return this.markAlreadyPaid("mint", quote.quote);
      }
      if (quote.state !== MintQuoteState.PAID) {
        throw new Error(`mint quote is ${quote.state}, not PAID`);
      }
      await cashuDb.mintQuotes.update(quote.quote, { state: quote.state });
      const result = await (await this.ensureCoordinator()).mint({
        amount: quote.amount.toNumber(),
        quote,
        keysetId: this.walletPort.getKeyset(null, "usd"),
      });
      if (result.status === "completed") return result;
      if (result.status !== "aborted-before-submit") {
        return this.resumeUntilSettled();
      }
      await this.refreshAfterRemoteChange();
    }
    throw new WalletConflictError(
      "wallet changed repeatedly on another device; try again"
    );
  }

  requestMeltQuote(request: string): Promise<MeltQuoteView> {
    return this.serialize(() => this.requestMeltQuoteUnlocked(request));
  }

  /** Demo-only local spend used when no Silent Link provider is configured. */
  requestInternalTopupQuote(amount: number): Promise<MeltQuoteView> {
    return this.serialize(() => this.requestInternalTopupQuoteUnlocked(amount));
  }

  private async requestInternalTopupQuoteUnlocked(
    amount: number
  ): Promise<MeltQuoteView> {
    requirePositiveAmount(amount);
    for (let attempt = 0; attempt < MAX_CROSS_DEVICE_RETRIES; attempt += 1) {
      const quote = `demo-melt-${crypto.randomUUID()}`;
      const request = `cashu-sync-demo:${quote}`;
      const now = this.now();
      await this.persistMeltQuote({
        quote,
        request,
        amount: Amount.from(amount),
        fee_reserve: Amount.from(0),
        unit: "usd",
        state: MeltQuoteState.UNPAID,
        expiry: Math.floor(now.getTime() / 1000) + 600,
        payment_preimage: undefined,
      });
      try {
        await this.publishQuoteOrRollback("melt", quote);
        return {
          quote,
          request,
          amount,
          feeReserve: 0,
          state: MeltQuoteState.UNPAID,
        };
      } catch (error) {
        if (!(error instanceof WalletConflictError)) throw error;
        await this.refreshAfterRemoteChange();
      }
    }
    throw new WalletConflictError(
      "wallet changed repeatedly on another device; try again"
    );
  }

  private async requestMeltQuoteUnlocked(
    request: string
  ): Promise<MeltQuoteView> {
    const bolt11 = parseV0Bolt11Request(request);
    for (let attempt = 0; attempt < MAX_CROSS_DEVICE_RETRIES; attempt += 1) {
      try {
        const wallet = await this.ensureWallet();
        return await this.requestMeltQuoteFromRequestUnlocked(wallet, bolt11);
      } catch (error) {
        if (!(error instanceof WalletConflictError)) throw error;
        await this.refreshAfterRemoteChange();
      }
    }
    throw new WalletConflictError(
      "wallet changed repeatedly on another device; try again"
    );
  }

  private async requestMeltQuoteFromRequestUnlocked(
    wallet: Wallet,
    request: string,
    expectedAmount?: number
  ): Promise<MeltQuoteView> {
    const quote = await wallet.createMeltQuoteBolt11(request);
    requireUsd(quote.unit);
    if (
      expectedAmount !== undefined &&
      quote.amount.toNumber() !== expectedAmount
    ) {
      throw new Error("Silent Link credit service returned the wrong amount");
    }
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
    const resumed = await this.resumeIfPending("melt", quoteId);
    if (resumed !== null && resumed.status !== "aborted-before-submit") {
      return resumed;
    }
    if (resumed?.status === "aborted-before-submit") {
      await this.refreshAfterRemoteChange();
    }
    for (let attempt = 0; attempt < MAX_CROSS_DEVICE_RETRIES; attempt += 1) {
      const stored = await this.requireStoredMeltQuote(quoteId);
      if (stored.request?.startsWith("cashu-sync-demo:")) {
        try {
          return await this.payInternalTopupUnlocked(stored);
        } catch (error) {
          if (!(error instanceof WalletConflictError)) throw error;
          await this.refreshAfterRemoteChange();
          continue;
        }
      }
      const wallet = await this.ensureWallet();
      const quote = await wallet.checkMeltQuoteBolt11(quoteId);
      requireUsd(quote.unit);
      assertMeltQuoteIdentity(stored, quote);
      if (quote.state === MeltQuoteState.PAID) {
        return this.markAlreadyPaid("melt", quote.quote);
      }
      if (quote.state !== MeltQuoteState.UNPAID) {
        throw new Error(`melt quote is ${quote.state}, not UNPAID`);
      }
      const result = await (await this.ensureCoordinator()).melt({
        quote,
        proofs: useMintsStore().activeProofs,
        keysetId: this.walletPort.getKeyset(null, "usd"),
        preferAsync: false,
      });
      if (result.status === "completed") return result;
      if (result.status !== "aborted-before-submit") {
        return this.resumeUntilSettled();
      }
      await this.refreshAfterRemoteChange();
    }
    throw new WalletConflictError(
      "wallet changed repeatedly on another device; try again"
    );
  }

  private async payInternalTopupUnlocked(
    stored: MeltQuoteRowLike
  ): Promise<SyncOperationOutcome> {
    const session = this.requireSession();
    const current = await session.repository.exportSnapshot();
    const wallet = await this.ensureWallet();
    const selected = wallet.selectProofsToSend(
      current.proofs.filter((proof) => !proof.reserved),
      Amount.from(stored.amount ?? 0),
      true,
      false
    ).send;
    if (selected.length === 0) throw new Error("not enough credits");
    const selectedSecrets = new Set(selected.map((proof) => proof.secret));
    // ponytail: the internal demo has no provider to receive change, so use
    // the mint's normal swap to split denominations and keep the change.
    let split;
    try {
      split = await wallet.send(Amount.from(stored.amount ?? 0), selected, {
        includeFees: true,
      });
    } catch (error) {
      if (isOutputsAlreadySigned(error)) {
        throw new WalletConflictError(
          "wallet outputs changed on another device; retry with fresh proofs"
        );
      }
      throw error;
    }
    const historyId = `melt:${stored.quote}`;
    const candidate: SnapshotV0 = {
      ...current,
      revision: current.revision + 1,
      previous_event_id: current.previous_event_id,
      proofs: [
        ...current.proofs.filter((proof) => !selectedSecrets.has(proof.secret)),
        ...split.keep.map(toSnapshotProof),
      ],
      quotes: current.quotes.map((quote) =>
        quote.type === "melt" && quote.quote === stored.quote
          ? { ...quote, state: "PAID" as const }
          : quote
      ),
      history: current.history.map((row) =>
        row.id === historyId
          ? {
              ...row,
              status: "paid" as const,
              paid_date: this.now().toISOString(),
            }
          : row
      ),
      pending_operation: null,
    };
    const outcome = await session.sync.publishCandidate(candidate, {
      applyAccepted: false,
    });
    if (outcome.status !== "accepted") {
      if (outcome.status === "conflict") {
        throw new WalletConflictError(
          "wallet changed on another device; try again"
        );
      }
      throw new Error("relay acknowledgement is ambiguous; sync before spending");
    }
    await session.repository.applySnapshot(candidate, outcome.eventId);
    await cashuDb.meltQuotes.update(stored.quote, {
      state: MeltQuoteState.PAID,
    });
    await usePaymentHistoryStore().refreshFromDexie();
    return {
      status: "completed",
      type: "melt",
      operationId: `demo:${stored.quote}`,
      eventId: outcome.eventId,
    };
  }

  resume(): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.resumeUnlocked());
  }

  private async resumeUnlocked(): Promise<SyncOperationOutcome> {
    return (await this.ensureCoordinator()).resume();
  }

  private async resumeIfPending(
    type: "mint" | "melt",
    quoteId: string
  ): Promise<SyncOperationOutcome | null> {
    const pending = (await this.requireSession().repository.exportSnapshot())
      .pending_operation;
    if (pending === null) return null;
    const pendingQuote = pending.prepared_request?.quote?.quote;
    const belongsToRequest =
      pending.type === type &&
      (pendingQuote === undefined || pendingQuote === quoteId);
    const result = await this.resumeUntilSettled();
    if (!belongsToRequest && result.status === "completed") {
      await this.refreshAfterRemoteChange();
      return null;
    }
    return result;
  }

  private async resumeUntilSettled(): Promise<SyncOperationOutcome> {
    let result = await (await this.ensureCoordinator()).resume();
    for (
      let attempt = 1;
      result.status === "needs-reconciliation" &&
      attempt < MAX_CROSS_DEVICE_RETRIES;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await (await this.ensureCoordinator()).resume();
    }
    return result;
  }

  private async markAlreadyPaid(
    direction: "mint" | "melt",
    quoteId: string
  ): Promise<SyncOperationOutcome> {
    const table =
      direction === "mint" ? cashuDb.mintQuotes : cashuDb.meltQuotes;
    await cashuDb.transaction(
      "rw",
      [table, cashuDb.paymentHistory],
      async () => {
        await table.update(quoteId, { state: "PAID" });
        await cashuDb.paymentHistory.update(`${direction}:${quoteId}`, {
          status: "paid",
          paidDate: this.now().toISOString(),
        });
      }
    );
    await usePaymentHistoryStore().refreshFromDexie();
    const eventId =
      (await this.requireSession().repository.exportSnapshot())
        .previous_event_id || "already-issued";
    return {
      status: "completed",
      type: direction,
      operationId: `${direction}:${quoteId}`,
      eventId,
    };
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

  private async refreshAfterRemoteChange(): Promise<void> {
    await this.requireSession().sync.pull();
    await usePaymentHistoryStore().refreshFromDexie();
    await useProofsStore().updateActiveProofs();
    this.wallet = null;
    this.coordinator = null;
    this.coordinatorSession = null;
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
    throw new WalletConflictError(
      "wallet changed on another device; quote was not saved"
    );
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

function toSnapshotProof(proof: {
  id: string;
  amount: { toNumber(): number };
  secret: string;
  C: string;
  dleq?: SnapshotProofV0["dleq"];
}): SnapshotProofV0 {
  return {
    id: proof.id,
    amount: proof.amount.toNumber(),
    secret: proof.secret,
    C: proof.C,
    reserved: false,
    ...(proof.dleq ? { dleq: proof.dleq } : {}),
  };
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
  browserWalletService?.stopLiveSync();
  browserWalletService = null;
}

export const resetV0WalletServiceForTests = resetV0WalletService;
