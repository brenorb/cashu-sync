import "fake-indexeddb/auto";
import {
  Amount,
  MeltQuoteState,
  MintQuoteState,
  type Wallet,
} from "@cashu/cashu-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cashuDb, resetCashuDexie } from "src/stores/dexie";

const { refreshFromDexie, mintState } = vi.hoisted(() => ({
  refreshFromDexie: vi.fn(async () => undefined),
  mintState: {
    activeMintUrl: "http://127.0.0.1:3338",
    activeProofs: [],
    mints: [],
  },
}));

vi.mock("src/stores/mints", () => ({ useMintsStore: () => mintState }));
vi.mock("src/stores/paymentHistory", () => ({
  usePaymentHistoryStore: () => ({ refreshFromDexie }),
}));

import { V0WalletService } from "src/sync/v0WalletService";

const publishCurrent = vi.fn();
const publishCandidate = vi.fn();
const applySnapshot = vi.fn();
const pull = vi.fn();
const session = {
  repository: { exportSnapshot: vi.fn(), applySnapshot: vi.fn() },
  sync: { publishCurrent, publishCandidate, pull },
  journal: {},
};
const runtime = {
  currentSession: () => session,
};
const runtimeService = {
  runtime,
  runExclusive: (operation: () => Promise<unknown>) => operation(),
};

function walletMock(overrides: Record<string, unknown>): Wallet {
  return { ...overrides } as unknown as Wallet;
}

const mintQuote = {
  quote: "mint-q",
  request: "lnbc1mint",
  amount: Amount.from(25),
  unit: "usd",
  state: MintQuoteState.PAID,
  expiry: 1_800_000_000,
};

const meltQuote = {
  quote: "melt-q",
  request: "lnbc1melt",
  amount: Amount.from(20),
  fee_reserve: Amount.from(2),
  unit: "usd",
  state: MeltQuoteState.UNPAID,
  expiry: 1_800_000_000,
  payment_preimage: null,
};

beforeEach(async () => {
  await resetCashuDexie(cashuDb);
  vi.clearAllMocks();
  publishCurrent.mockResolvedValue({
    status: "accepted",
    eventId: "a".repeat(64),
    revision: 1,
  });
  publishCandidate.mockResolvedValue({
    status: "accepted",
    eventId: "b".repeat(64),
    revision: 1,
  });
  session.repository.applySnapshot = applySnapshot;
});

afterEach(async () => {
  await resetCashuDexie(cashuDb);
});

describe("V0WalletService quote fencing", () => {
  it("persists a USD Bolt11 mint quote before publishing the snapshot", async () => {
    const createMintQuoteBolt11 = vi.fn(async () => mintQuote);
    const service = new V0WalletService(
      runtimeService as never,
      {
        activeWallet: vi.fn(async () => walletMock({ createMintQuoteBolt11 })),
        getKeyset: () => "00c0ffee",
      },
      () => new Date("2026-08-13T10:00:00.000Z")
    );

    await expect(service.requestMintQuote(25)).resolves.toEqual({
      quote: "mint-q",
      request: "lnbc1mint",
      amount: 25,
      state: MintQuoteState.PAID,
    });

    expect(publishCurrent).toHaveBeenCalledOnce();
    expect(await cashuDb.mintQuotes.get("mint-q")).toMatchObject({
      method: "bolt11",
      unit: "usd",
      amount: 25,
      state: "PAID",
    });
    expect(await cashuDb.paymentHistory.get("mint:mint-q")).toMatchObject({
      direction: "mint",
      quote: "mint-q",
      amount: 25,
      status: "pending",
    });
  });

  it("rolls back a quote when relay CAS proves a conflict", async () => {
    publishCurrent.mockResolvedValue({
      status: "conflict",
      currentEventId: "b".repeat(64),
      currentRevision: 2,
    });
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () =>
        walletMock({ createMintQuoteBolt11: vi.fn(async () => mintQuote) })
      ),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMintQuote(25)).rejects.toThrow(
      /another device/
    );
    expect(await cashuDb.mintQuotes.count()).toBe(0);
    expect(await cashuDb.paymentHistory.count()).toBe(0);
  });

  it("keeps a quote after an ambiguous relay acknowledgement", async () => {
    publishCurrent.mockResolvedValue({
      status: "needs-reconciliation",
      candidateEventId: "c".repeat(64),
      candidateRevision: 1,
    });
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () =>
        walletMock({ createMintQuoteBolt11: vi.fn(async () => mintQuote) })
      ),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMintQuote(25)).rejects.toThrow(/ambiguous/);
    expect(await cashuDb.mintQuotes.count()).toBe(1);
    expect(await cashuDb.paymentHistory.count()).toBe(1);
  });

  it("persists and publishes the one allowed melt quote", async () => {
    const createMeltQuoteBolt11 = vi.fn(async () => meltQuote);
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () => walletMock({ createMeltQuoteBolt11 })),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMeltQuote("lnbc1melt")).resolves.toEqual({
      quote: "melt-q",
      request: "lnbc1melt",
      amount: 20,
      feeReserve: 2,
      state: MeltQuoteState.UNPAID,
    });
    expect(await cashuDb.meltQuotes.get("melt-q")).toMatchObject({
      method: "bolt11",
      amount: 20,
      fee_reserve: 2,
      state: "UNPAID",
    });
    expect(await cashuDb.paymentHistory.get("melt:melt-q")).toMatchObject({
      direction: "melt",
      amount: 20,
    });
  });

  it("creates a local demo spend quote without reusing a paid mint invoice", async () => {
    const createMintQuoteBolt11 = vi.fn();
    const createMeltQuoteBolt11 = vi.fn();
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () =>
        walletMock({ createMintQuoteBolt11, createMeltQuoteBolt11 })
      ),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestInternalTopupQuote(25)).resolves.toMatchObject({
      amount: 25,
      request: expect.stringMatching(/^cashu-sync-demo:/),
    });
    expect(createMintQuoteBolt11).not.toHaveBeenCalled();
    expect(createMeltQuoteBolt11).not.toHaveBeenCalled();
  });

  it("selects only enough credits for a local demo spend", async () => {
    const quoteId = "demo-melt-test";
    const current = {
      schema: 0,
      revision: 0,
      previous_event_id: "",
      mint: "http://127.0.0.1:3338",
      unit: "usd",
      proofs: [
        { id: "k", amount: 800, secret: "secret-8", C: "C8", reserved: false },
        { id: "k", amount: 400, secret: "secret-4", C: "C4", reserved: false },
      ],
      counters: {},
      quotes: [
        {
          type: "melt",
          quote: quoteId,
          request: `cashu-sync-demo:${quoteId}`,
          amount: 800,
          fee_reserve: 0,
          unit: "usd",
          state: "UNPAID",
          expiry: 1_800_000_000,
          payment_preimage: null,
        },
      ],
      history: [
        {
          id: `melt:${quoteId}`,
          direction: "melt",
          quote: quoteId,
          amount: 800,
          request: `cashu-sync-demo:${quoteId}`,
          memo: "",
          date: "2026-08-13T10:00:00.000Z",
          status: "pending",
          mint: "http://127.0.0.1:3338",
          unit: "usd",
        },
      ],
      pending_operation: null,
    } as const;
    session.repository.exportSnapshot.mockResolvedValue(current);
    const selectProofsToSend = vi.fn(() => ({
      send: [current.proofs[0]],
      keep: [current.proofs[1]],
    }));
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () => walletMock({ selectProofsToSend })),
      getKeyset: () => "00c0ffee",
    });
    await cashuDb.meltQuotes.put({
      quote: quoteId,
      request: `cashu-sync-demo:${quoteId}`,
      amount: 800,
      fee_reserve: 0,
      unit: "usd",
      state: "UNPAID",
    });

    await expect(service.payMeltQuote(quoteId)).resolves.toMatchObject({
      status: "completed",
      type: "melt",
    });
    expect(selectProofsToSend).toHaveBeenCalledWith(
      current.proofs,
      Amount.from(800),
      true,
      false
    );
    expect(applySnapshot).toHaveBeenCalledOnce();
    expect(applySnapshot.mock.calls[0][0].proofs).toEqual([current.proofs[1]]);
  });

  it("rejects non-Bolt11 payment ingress before touching wallet or relay", async () => {
    const activeWallet = vi.fn();
    const service = new V0WalletService(runtimeService as never, {
      activeWallet,
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMeltQuote("cashuA-token")).rejects.toThrow(
      /not available/
    );
    expect(activeWallet).not.toHaveBeenCalled();
    expect(publishCurrent).not.toHaveBeenCalled();
  });

  it("preserves existing accounting when a mint repeats a quote id", async () => {
    const existing = {
      quote: "mint-q",
      method: "bolt11",
      request: "lnbc1original",
      unit: "usd",
      amount: 10,
      state: "PAID",
    };
    await cashuDb.mintQuotes.add(existing);
    await cashuDb.paymentHistory.add({
      id: "mint:mint-q",
      direction: "mint",
      quote: "mint-q",
      method: "bolt11",
      amount: 10,
      request: "lnbc1original",
      memo: "original",
      date: "2026-01-01T00:00:00.000Z",
      status: "pending",
      mint: mintState.activeMintUrl,
      unit: "usd",
    });
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () =>
        walletMock({ createMintQuoteBolt11: vi.fn(async () => mintQuote) })
      ),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMintQuote(25)).rejects.toThrow();
    expect(await cashuDb.mintQuotes.get("mint-q")).toEqual(existing);
    expect(await cashuDb.paymentHistory.get("mint:mint-q")).toMatchObject({
      request: "lnbc1original",
      memo: "original",
    });
    expect(publishCurrent).not.toHaveBeenCalled();
  });

  it("preserves existing accounting when a melt repeats a quote id", async () => {
    const existing = {
      quote: "melt-q",
      method: "bolt11",
      request: "lnbc1original",
      unit: "usd",
      amount: 10,
      fee_reserve: 1,
      state: "UNPAID",
    };
    await cashuDb.meltQuotes.add(existing);
    await cashuDb.paymentHistory.add({
      id: "melt:melt-q",
      direction: "melt",
      quote: "melt-q",
      method: "bolt11",
      amount: 10,
      request: "lnbc1original",
      memo: "original",
      date: "2026-01-01T00:00:00.000Z",
      status: "pending",
      mint: mintState.activeMintUrl,
      unit: "usd",
    });
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () =>
        walletMock({ createMeltQuoteBolt11: vi.fn(async () => meltQuote) })
      ),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.requestMeltQuote("lnbc1melt")).rejects.toThrow();
    expect(await cashuDb.meltQuotes.get("melt-q")).toEqual(existing);
    expect(await cashuDb.paymentHistory.get("melt:melt-q")).toMatchObject({
      request: "lnbc1original",
      memo: "original",
    });
    expect(publishCurrent).not.toHaveBeenCalled();
  });

  it("rejects a checked quote that does not match stored accounting", async () => {
    await cashuDb.mintQuotes.add({
      quote: "mint-q",
      method: "bolt11",
      request: "lnbc1mint",
      unit: "usd",
      amount: 25,
      state: "PAID",
    });
    const checkMintQuoteBolt11 = vi.fn(async () => ({
      ...mintQuote,
      amount: Amount.from(26),
    }));
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () => walletMock({ checkMintQuoteBolt11 })),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.mintPaidQuote("mint-q")).rejects.toThrow(
      /does not match/
    );
    expect(session.journal).toEqual({});
    expect(publishCurrent).not.toHaveBeenCalled();
  });

  it("rejects a checked melt quote that does not match stored accounting", async () => {
    await cashuDb.meltQuotes.add({
      quote: "melt-q",
      method: "bolt11",
      request: "lnbc1melt",
      unit: "usd",
      amount: 20,
      fee_reserve: 2,
      state: "UNPAID",
    });
    const checkMeltQuoteBolt11 = vi.fn(async () => ({
      ...meltQuote,
      fee_reserve: Amount.from(3),
    }));
    const service = new V0WalletService(runtimeService as never, {
      activeWallet: vi.fn(async () => walletMock({ checkMeltQuoteBolt11 })),
      getKeyset: () => "00c0ffee",
    });

    await expect(service.payMeltQuote("melt-q")).rejects.toThrow(
      /does not match/
    );
    expect(session.journal).toEqual({});
    expect(publishCurrent).not.toHaveBeenCalled();
  });
});
