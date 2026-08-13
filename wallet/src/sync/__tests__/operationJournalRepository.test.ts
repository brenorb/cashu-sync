import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashuDexie } from "src/stores/dexie";
import {
  OperationJournalError,
  OperationJournalRepository,
} from "src/sync/operationJournalRepository";
import type {
  PendingMeltResponseV0,
  PendingMintResponseV0,
  SerializedMeltPreviewV0,
  SerializedMintPreviewV0,
  SnapshotProofV0,
} from "src/sync/types";

const MINT = "https://usd-mint.example";
const HEAD = "a".repeat(64);
const NEXT_HEAD = "b".repeat(64);
const MINT_OPERATION = "11111111-1111-4111-8111-111111111111";
const MELT_OPERATION = "22222222-2222-4222-8222-222222222222";
const NOW = 1_780_000_000;

const mintPreview: SerializedMintPreviewV0 = {
  method: "bolt11",
  keyset_id: "00c0ffee",
  quote: {
    quote: "mint-q",
    request: "lnbc1mint",
    amount: "30",
    unit: "usd",
    state: "PAID",
    expiry: NOW + 100,
  },
  request: {
    quote: "mint-q",
    outputs: [
      { amount: "10", B_: "02first", id: "00c0ffee" },
      { amount: "20", B_: "02second", id: "00c0ffee" },
    ],
  },
  output_data: [
    {
      blindedMessage: { amount: "10", B_: "02first", id: "00c0ffee" },
      blindingFactor: "1",
      secret: "01",
    },
    {
      blindedMessage: { amount: "20", B_: "02second", id: "00c0ffee" },
      blindingFactor: "2",
      secret: "02",
    },
  ],
};

const meltPreview: SerializedMeltPreviewV0 = {
  method: "bolt11",
  keyset_id: "00c0ffee",
  quote: {
    quote: "melt-q",
    request: "lnbc1melt",
    amount: "25",
    fee_reserve: "5",
    unit: "usd",
    state: "UNPAID",
    expiry: NOW + 100,
    payment_preimage: null,
  },
  request: {
    quote: "melt-q",
    inputs: [
      { id: "00c0ffee", amount: "10", secret: "first", C: "02aa" },
      { id: "00c0ffee", amount: "20", secret: "second", C: "02bb" },
    ],
    outputs: [{ amount: "0", B_: "02changeout", id: "00c0ffee" }],
    prefer_async: true,
  },
  output_data: [
    {
      blindedMessage: {
        amount: "0",
        B_: "02changeout",
        id: "00c0ffee",
      },
      blindingFactor: "3",
      secret: "03",
    },
  ],
};

const mintResponse: PendingMintResponseV0 = {
  proofs: [proof("01", 10, "02mintfirst"), proof("02", 20, "02mintsecond")],
};

function proof(secret: string, amount: number, C: string): SnapshotProofV0 {
  return { id: "00c0ffee", amount, secret, C, reserved: false };
}

let db: CashuDexie;
let dbName: string;
let repository: OperationJournalRepository;

beforeEach(async () => {
  dbName = `cashu-sync-journal-${crypto.randomUUID()}`;
  db = new CashuDexie(dbName);
  await db.open();
  await db.walletSyncState.update("wallet", {
    revision: 4,
    head_event_id: HEAD,
    counters: { "00c0ffee": 9 },
  });
  repository = new OperationJournalRepository(db, MINT);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
});

async function seedMintRows() {
  await db.mintQuotes.put({
    quote: "mint-q",
    method: "bolt11",
    request: "lnbc1mint",
    amount: 30,
    unit: "usd",
    state: "PAID",
    expiry: NOW + 100,
  });
  await db.paymentHistory.put({
    id: "mint:mint-q",
    direction: "mint",
    quote: "mint-q",
    method: "bolt11",
    paymentType: "bolt11",
    amount: 30,
    request: "lnbc1mint",
    memo: "",
    date: "2026-05-27T00:00:00.000Z",
    status: "pending",
    mint: MINT,
    unit: "usd",
  });
}

async function seedMeltRows() {
  await db.proofs.bulkPut([
    proof("first", 10, "02aa"),
    proof("second", 20, "02bb"),
  ]);
  await db.meltQuotes.put({
    quote: "melt-q",
    method: "bolt11",
    request: "lnbc1melt",
    amount: 25,
    fee_reserve: 5,
    unit: "usd",
    state: "UNPAID",
    expiry: NOW + 100,
    payment_preimage: null,
  });
  await db.paymentHistory.put({
    id: "melt:melt-q",
    direction: "melt",
    quote: "melt-q",
    method: "bolt11",
    paymentType: "bolt11",
    amount: -30,
    request: "lnbc1melt",
    memo: "",
    date: "2026-05-27T00:00:00.000Z",
    status: "pending",
    mint: MINT,
    unit: "usd",
  });
}

describe("OperationJournalRepository preparation", () => {
  it("enforces one slot and preserves durable counters for mint", async () => {
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    const state = await db.walletSyncState.get("wallet");
    expect(state).toMatchObject({
      counters: { "00c0ffee": 9 },
      pending_operation: {
        operation_id: MINT_OPERATION,
        type: "mint",
        phase: "prepared",
        created_at: NOW,
        updated_at: NOW,
        response: null,
      },
    });
    await expect(
      repository.prepareMint(
        "33333333-3333-4333-8333-333333333333",
        mintPreview,
        NOW + 1
      )
    ).rejects.toMatchObject({ code: "slot-occupied" });
  });

  it("rejects a mismatched or already reserved melt input without writes", async () => {
    await db.proofs.put(proof("first", 11, "02aa"));
    await db.proofs.put({ ...proof("second", 20, "02bb"), reserved: true });

    await expect(
      repository.prepareMelt(MELT_OPERATION, meltPreview, NOW)
    ).rejects.toMatchObject({ code: "proof-mismatch" });
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toBeNull();
    expect(await db.proofs.get("first")).toMatchObject({ reserved: false });
  });

  it("reserves every melt input with the quote atomically", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);

    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
    ]);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      type: "melt",
      phase: "prepared",
    });

    await db.walletSyncState.update("wallet", { pending_operation: null });
    await db.proofs.bulkPut([
      proof("first", 10, "02aa"),
      proof("second", 20, "02bb"),
    ]);
    vi.spyOn(db.walletSyncState, "put").mockRejectedValueOnce(
      new Error("injected state failure")
    );
    await expect(
      repository.prepareMelt(MELT_OPERATION, meltPreview, NOW)
    ).rejects.toThrow("injected state failure");
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      proof("first", 10, "02aa"),
      proof("second", 20, "02bb"),
    ]);
  });
});

describe("OperationJournalRepository transitions", () => {
  it("allows only exact prepared-to-submitted monotonic transitions", async () => {
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    await expect(
      repository.markSubmitted(MINT_OPERATION, "melt", NOW + 1)
    ).rejects.toMatchObject({ code: "operation-mismatch" });
    await expect(
      repository.markSubmitted(MINT_OPERATION, "mint", NOW - 1)
    ).rejects.toMatchObject({ code: "timestamp" });

    await repository.markSubmitted(MINT_OPERATION, "mint", NOW + 1);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "submitted",
      updated_at: NOW + 1,
    });
    await expect(
      repository.markSubmitted(MINT_OPERATION, "mint", NOW + 2)
    ).rejects.toMatchObject({ code: "invalid-transition" });
  });
});

describe("OperationJournalRepository responses", () => {
  it("records mint proofs, quote, history, and response in one commit", async () => {
    await seedMintRows();
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    await repository.markSubmitted(MINT_OPERATION, "mint", NOW + 1);
    await repository.recordMintResponse(MINT_OPERATION, mintResponse, NOW + 2);

    expect(await db.proofs.bulkGet(["01", "02"])).toEqual(mintResponse.proofs);
    expect(await db.mintQuotes.get("mint-q")).toMatchObject({
      state: "ISSUED",
    });
    expect(await db.paymentHistory.get("mint:mint-q")).toMatchObject({
      status: "paid",
      paidDate: new Date((NOW + 2) * 1000).toISOString(),
    });
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "response_recorded",
      response: mintResponse,
    });
    expect(await db.ecashHistory.count()).toBe(0);
  });

  it("rolls back mint response collisions and mid-transaction failures", async () => {
    await seedMintRows();
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    await db.proofs.put(proof("02", 99, "collision"));

    await expect(
      repository.recordMintResponse(MINT_OPERATION, mintResponse, NOW + 1)
    ).rejects.toMatchObject({ code: "proof-collision" });
    expect(await db.proofs.get("01")).toBeUndefined();
    expect(await db.mintQuotes.get("mint-q")).toMatchObject({ state: "PAID" });
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "prepared",
      response: null,
    });

    await db.proofs.delete("02");
    vi.spyOn(db.mintQuotes, "update").mockRejectedValueOnce(
      new Error("injected quote failure")
    );
    await expect(
      repository.recordMintResponse(MINT_OPERATION, mintResponse, NOW + 1)
    ).rejects.toThrow("injected quote failure");
    expect(await db.proofs.bulkGet(["01", "02"])).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "prepared",
    });
  });

  it("rejects mint proofs not bound to prepared output secrets before writing", async () => {
    await seedMintRows();
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    const before = await db.walletSyncState.get("wallet");

    await expect(
      repository.recordMintResponse(
        MINT_OPERATION,
        {
          proofs: [
            proof("attacker", 10, "02mintfirst"),
            proof("02", 20, "02mintsecond"),
          ],
        },
        NOW + 1
      )
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(await db.proofs.count()).toBe(0);
    expect(await db.walletSyncState.get("wallet")).toEqual(before);
  });

  it("durably records PAID change before consuming exact melt inputs", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    await repository.markSubmitted(MELT_OPERATION, "melt", NOW + 1);
    const response: PendingMeltResponseV0 = {
      state: "PAID",
      payment_preimage: "preimage",
      change: [proof("03", 4, "02change")],
    };
    await repository.recordMeltResponse(MELT_OPERATION, response, NOW + 2);

    expect(await db.proofs.bulkGet(["first", "second", "03"])).toEqual([
      undefined,
      undefined,
      response.change[0],
    ]);
    expect(await db.meltQuotes.get("melt-q")).toMatchObject({
      state: "PAID",
      payment_preimage: "preimage",
    });
    expect(await db.paymentHistory.get("melt:melt-q")).toMatchObject({
      status: "paid",
    });
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "response_recorded",
      response,
    });
    expect(await db.ecashHistory.count()).toBe(0);
  });

  it.each(["PENDING", "UNPAID"] as const)(
    "keeps inputs reserved and history pending for %s",
    async (state) => {
      await seedMeltRows();
      await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
      await repository.recordMeltResponse(
        MELT_OPERATION,
        { state, payment_preimage: null, change: [] },
        NOW + 1
      );

      expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
        expect.objectContaining({ reserved: true, quote: "melt-q" }),
        expect.objectContaining({ reserved: true, quote: "melt-q" }),
      ]);
      expect(await db.meltQuotes.get("melt-q")).toMatchObject({ state });
      expect(await db.paymentHistory.get("melt:melt-q")).toMatchObject({
        status: "pending",
      });
      expect(
        (await db.walletSyncState.get("wallet"))?.pending_operation
      ).toMatchObject({
        phase: "response_recorded",
        response: { state },
      });
    }
  );

  it("reconciles a recorded PENDING melt to PAID atomically", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    await repository.recordMeltResponse(
      MELT_OPERATION,
      { state: "PENDING", payment_preimage: null, change: [] },
      NOW + 1
    );
    await repository.recordMeltResponse(
      MELT_OPERATION,
      {
        state: "PAID",
        payment_preimage: "preimage",
        change: [proof("03", 4, "02change")],
      },
      NOW + 2
    );

    expect(await db.proofs.bulkGet(["first", "second", "03"])).toEqual([
      undefined,
      undefined,
      proof("03", 4, "02change"),
    ]);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "response_recorded",
      response: { state: "PAID" },
    });
  });

  it("rejects change not bound to the prepared output before any write", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    const before = await db.walletSyncState.get("wallet");

    await expect(
      repository.recordMeltResponse(
        MELT_OPERATION,
        {
          state: "PAID",
          payment_preimage: "preimage",
          change: [proof("attacker-secret", 4, "02change")],
        },
        NOW + 1
      )
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(await db.proofs.get("attacker-secret")).toBeUndefined();
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
    ]);
    expect(await db.walletSyncState.get("wallet")).toEqual(before);
  });

  it("rolls back change and response if exact input deletion fails", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    const response: PendingMeltResponseV0 = {
      state: "PAID",
      payment_preimage: "preimage",
      change: [proof("03", 4, "02change")],
    };
    vi.spyOn(db.proofs, "bulkDelete").mockRejectedValueOnce(
      new Error("injected delete failure")
    );

    await expect(
      repository.recordMeltResponse(MELT_OPERATION, response, NOW + 1)
    ).rejects.toThrow("injected delete failure");
    expect(await db.proofs.get("03")).toBeUndefined();
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      expect.objectContaining({ reserved: true }),
      expect.objectContaining({ reserved: true }),
    ]);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toMatchObject({
      phase: "prepared",
      response: null,
    });
  });
});

describe("OperationJournalRepository CAS finalization", () => {
  it("aborts only the exact prepared operation and never decrements counters", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    await expect(
      repository.abortPrepared(MINT_OPERATION, "melt")
    ).rejects.toMatchObject({ code: "operation-mismatch" });
    expect(await db.proofs.get("first")).toMatchObject({ reserved: true });

    await repository.abortPrepared(MELT_OPERATION, "melt");
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      proof("first", 10, "02aa"),
      proof("second", 20, "02bb"),
    ]);
    expect(await db.walletSyncState.get("wallet")).toMatchObject({
      counters: { "00c0ffee": 9 },
      pending_operation: null,
    });

    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW + 1);
    await repository.markSubmitted(MINT_OPERATION, "mint", NOW + 2);
    await expect(
      repository.abortPrepared(MINT_OPERATION, "mint")
    ).rejects.toMatchObject({ code: "invalid-transition" });
  });

  it("builds a cleared final CAS candidate without mutating, then finalizes exactly it", async () => {
    await seedMintRows();
    await repository.prepareMint(MINT_OPERATION, mintPreview, NOW);
    await repository.recordMintResponse(MINT_OPERATION, mintResponse, NOW + 1);
    const before = await db.walletSyncState.get("wallet");

    const candidate = await repository.candidateWithClearedOperation(
      MINT_OPERATION
    );
    expect(candidate).toMatchObject({
      revision: 5,
      previous_event_id: HEAD,
      pending_operation: null,
    });
    expect(await db.walletSyncState.get("wallet")).toEqual(before);

    await repository.finalizeAcceptedSnapshot(candidate, NEXT_HEAD);
    expect(await db.walletSyncState.get("wallet")).toMatchObject({
      revision: 5,
      head_event_id: NEXT_HEAD,
      pending_operation: null,
    });
    await expect(
      repository.finalizeAcceptedSnapshot(candidate, "c".repeat(64))
    ).rejects.toMatchObject({ code: "stale-candidate" });
  });

  it("keeps PENDING journaled and releases UNPAID melt inputs only in the accepted candidate", async () => {
    await seedMeltRows();
    await repository.prepareMelt(MELT_OPERATION, meltPreview, NOW);
    await repository.recordMeltResponse(
      MELT_OPERATION,
      { state: "PENDING", payment_preimage: null, change: [] },
      NOW + 1
    );
    await expect(
      repository.candidateWithClearedOperation(MELT_OPERATION)
    ).rejects.toMatchObject({ code: "invalid-transition" });

    await repository.recordMeltResponse(
      MELT_OPERATION,
      { state: "UNPAID", payment_preimage: null, change: [] },
      NOW + 2
    );
    const candidate = await repository.candidateWithClearedOperation(
      MELT_OPERATION
    );
    expect(candidate.proofs).toEqual([
      proof("first", 10, "02aa"),
      proof("second", 20, "02bb"),
    ]);
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
      expect.objectContaining({ reserved: true, quote: "melt-q" }),
    ]);

    await repository.finalizeAcceptedSnapshot(candidate, NEXT_HEAD);
    expect(await db.proofs.bulkGet(["first", "second"])).toEqual([
      proof("first", 10, "02aa"),
      proof("second", 20, "02bb"),
    ]);
    expect(
      (await db.walletSyncState.get("wallet"))?.pending_operation
    ).toBeNull();
  });
});

it("exports a typed journal error", () => {
  expect(new OperationJournalError("slot-occupied", "busy")).toMatchObject({
    name: "OperationJournalError",
    code: "slot-occupied",
  });
});
