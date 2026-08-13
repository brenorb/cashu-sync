import { describe, expect, it, vi } from "vitest";
import {
  SyncOperationCoordinator,
  type CashuOperationGateway,
  type OperationJournalPort,
  type OperationStateReader,
  type SnapshotSyncPort,
} from "src/sync/syncOperationCoordinator";
import type {
  PendingMeltResponseV0,
  PendingMintResponseV0,
  PendingOperationV0,
  SerializedMeltPreviewV0,
  SerializedMintPreviewV0,
  SnapshotV0,
} from "src/sync/types";
import type { PublishOutcome, PullOutcome } from "src/sync/syncCoordinator";

const OPERATION = "11111111-1111-4111-8111-111111111111";
const HEAD = "a".repeat(64);
const PREPARED_HEAD = "b".repeat(64);
const FINAL_HEAD = "c".repeat(64);

const mintPreview: SerializedMintPreviewV0 = {
  method: "bolt11",
  keyset_id: "keyset",
  quote: {
    quote: "mint-q",
    request: "lnbc1mint",
    amount: "1",
    unit: "usd",
    state: "PAID",
    expiry: 1_800_000_000,
  },
  request: {
    quote: "mint-q",
    outputs: [{ amount: "1", B_: "02out", id: "keyset" }],
  },
  output_data: [
    {
      blindedMessage: { amount: "1", B_: "02out", id: "keyset" },
      blindingFactor: "1",
      secret: "01",
    },
  ],
};

const meltPreview: SerializedMeltPreviewV0 = {
  method: "bolt11",
  keyset_id: "keyset",
  quote: {
    quote: "melt-q",
    request: "lnbc1melt",
    amount: "1",
    fee_reserve: "0",
    unit: "usd",
    state: "UNPAID",
    expiry: 1_800_000_000,
    payment_preimage: null,
  },
  request: {
    quote: "melt-q",
    inputs: [{ id: "keyset", amount: "1", secret: "input", C: "02in" }],
    outputs: [],
    prefer_async: false,
  },
  output_data: [],
};

const mintResponse: PendingMintResponseV0 = {
  proofs: [
    {
      id: "keyset",
      amount: 1,
      secret: "01",
      C: "02proof",
      reserved: false,
    },
  ],
};

const meltResponse: PendingMeltResponseV0 = {
  state: "PAID",
  payment_preimage: "preimage",
  change: [],
};

function snapshot(pending: PendingOperationV0 | null = null): SnapshotV0 {
  return {
    schema: 0,
    revision: 4,
    previous_event_id: HEAD,
    mint: "https://mint.example",
    unit: "usd",
    proofs: [],
    counters: {},
    quotes: [],
    history: [],
    pending_operation: pending,
  };
}

function pendingMint(
  phase: PendingOperationV0["phase"],
  response: PendingMintResponseV0 | null = null
): PendingOperationV0 {
  return {
    type: "mint",
    operation_id: OPERATION,
    phase,
    created_at: 100,
    updated_at: 101,
    prepared_request: mintPreview,
    response,
  };
}

class FakeSync implements SnapshotSyncPort {
  pullResult: PullOutcome = {
    status: "noop",
    eventId: HEAD,
    revision: 4,
  };
  preparedResult: PublishOutcome = {
    status: "accepted",
    resolution: "direct",
    eventId: PREPARED_HEAD,
    revision: 5,
  };
  finalResult: PublishOutcome = {
    status: "accepted",
    resolution: "direct",
    eventId: FINAL_HEAD,
    revision: 6,
  };
  pull = vi.fn(async () => this.pullResult);
  publishCurrent = vi.fn(async () => this.preparedResult);
  publishCandidate = vi.fn(
    async (_candidate: SnapshotV0, _options: { applyAccepted: false }) =>
      this.finalResult
  );
}

class FakeJournal implements OperationJournalPort, OperationStateReader {
  state = snapshot();
  readonly calls: string[] = [];
  exportSnapshot = vi.fn(async () => structuredClone(this.state));
  prepareMint = vi.fn(
    async (id: string, preview: SerializedMintPreviewV0, at: number) => {
      this.calls.push("prepareMint");
      this.state.pending_operation = {
        type: "mint",
        operation_id: id,
        phase: "prepared",
        created_at: at,
        updated_at: at,
        prepared_request: preview,
        response: null,
      };
    }
  );
  prepareMelt = vi.fn(
    async (id: string, preview: SerializedMeltPreviewV0, at: number) => {
      this.calls.push("prepareMelt");
      this.state.pending_operation = {
        type: "melt",
        operation_id: id,
        phase: "prepared",
        created_at: at,
        updated_at: at,
        prepared_request: preview,
        response: null,
      };
    }
  );
  markSubmitted = vi.fn(
    async (id: string, type: "mint" | "melt", at: number) => {
      this.calls.push("markSubmitted");
      const current = this.state.pending_operation!;
      this.state.pending_operation = {
        ...current,
        operation_id: id,
        type,
        phase: "submitted",
        updated_at: at,
      } as PendingOperationV0;
    }
  );
  recordMintResponse = vi.fn(
    async (_id: string, response: PendingMintResponseV0, at: number) => {
      this.calls.push("recordMintResponse");
      this.state.pending_operation = {
        ...(this.state.pending_operation as ReturnType<typeof pendingMint>),
        phase: "response_recorded",
        updated_at: at,
        response,
      };
    }
  );
  recordMeltResponse = vi.fn(
    async (_id: string, response: PendingMeltResponseV0, at: number) => {
      this.calls.push("recordMeltResponse");
      this.state.pending_operation = {
        ...(this.state.pending_operation as PendingOperationV0),
        type: "melt",
        phase: "response_recorded",
        updated_at: at,
        response,
      } as PendingOperationV0;
    }
  );
  abortPrepared = vi.fn(async () => {
    this.calls.push("abortPrepared");
    this.state.pending_operation = null;
  });
  candidateWithClearedOperation = vi.fn(async () => {
    this.calls.push("candidate");
    return {
      ...structuredClone(this.state),
      revision: this.state.revision + 1,
      pending_operation: null,
    };
  });
  finalizeAcceptedSnapshot = vi.fn(
    async (candidate: SnapshotV0, eventId: string) => {
      this.calls.push("finalize");
      this.state = {
        ...structuredClone(candidate),
        previous_event_id: eventId,
      };
    }
  );
}

class FakeGateway implements CashuOperationGateway<string, string> {
  readonly calls: string[] = [];
  createMintPreview = vi.fn(async () => {
    this.calls.push("createMintPreview");
    return mintPreview;
  });
  createMeltPreview = vi.fn(async () => {
    this.calls.push("createMeltPreview");
    return meltPreview;
  });
  submitMint = vi.fn(async () => {
    this.calls.push("submitMint");
    return mintResponse;
  });
  submitMelt = vi.fn(async () => {
    this.calls.push("submitMelt");
    return meltResponse;
  });
  reconcileMint = vi.fn(async () => null as PendingMintResponseV0 | null);
  reconcileMelt = vi.fn(async () => null as PendingMeltResponseV0 | null);
}

function fixture() {
  const sync = new FakeSync();
  const journal = new FakeJournal();
  const gateway = new FakeGateway();
  let timestamp = 100;
  const coordinator = new SyncOperationCoordinator<string, string>({
    sync,
    journal,
    state: journal,
    gateway,
    operationId: () => OPERATION,
    now: () => ++timestamp,
  });
  return { coordinator, sync, journal, gateway };
}

describe("SyncOperationCoordinator new operations", () => {
  it("runs mint in durable order and finalizes exact accepted candidate", async () => {
    const value = fixture();
    await expect(value.coordinator.mint("intent")).resolves.toEqual({
      status: "completed",
      type: "mint",
      operationId: OPERATION,
      eventId: FINAL_HEAD,
    });
    const order = [
      value.sync.pull,
      value.gateway.createMintPreview,
      value.journal.prepareMint,
      value.sync.publishCurrent,
      value.journal.markSubmitted,
      value.gateway.submitMint,
      value.journal.recordMintResponse,
      value.journal.candidateWithClearedOperation,
      value.sync.publishCandidate,
      value.journal.finalizeAcceptedSnapshot,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(value.gateway.submitMint).toHaveBeenCalledWith(mintPreview);
    expect(value.sync.publishCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ pending_operation: null }),
      { applyAccepted: false }
    );
  });

  it("aborts a proven prepared conflict and never submits", async () => {
    const value = fixture();
    value.sync.preparedResult = {
      status: "conflict",
      currentEventId: HEAD,
      currentRevision: 4,
    };

    await expect(value.coordinator.melt("intent")).resolves.toMatchObject({
      status: "aborted-before-submit",
      reason: "conflict",
    });
    expect(value.journal.abortPrepared).toHaveBeenCalledWith(OPERATION, "melt");
    expect(value.gateway.submitMelt).not.toHaveBeenCalled();
  });

  it("runs melt using the exact prepared request with no implicit swap", async () => {
    const value = fixture();

    await expect(value.coordinator.melt("intent")).resolves.toMatchObject({
      status: "completed",
      type: "melt",
    });
    expect(value.gateway.submitMelt).toHaveBeenCalledOnce();
    expect(value.gateway.submitMelt).toHaveBeenCalledWith(meltPreview);
    expect(value.gateway.createMeltPreview).toHaveBeenCalledOnce();
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
  });

  it("aborts explicit prepared relay rejection before submit", async () => {
    const value = fixture();
    value.sync.publishCurrent.mockRejectedValueOnce(
      Object.assign(new Error("not admitted"), { code: "publish-rejected" })
    );

    await expect(value.coordinator.mint("intent")).resolves.toMatchObject({
      status: "aborted-before-submit",
      reason: "rejected",
    });
    expect(value.journal.abortPrepared).toHaveBeenCalledOnce();
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
  });

  it("keeps prepared journal on ambiguous publish and makes zero mint calls", async () => {
    const value = fixture();
    value.sync.preparedResult = {
      status: "needs-reconciliation",
      cause: "timeout",
      candidateEventId: PREPARED_HEAD,
      currentEventId: HEAD,
    };

    await expect(value.coordinator.mint("intent")).resolves.toMatchObject({
      status: "needs-reconciliation",
      stage: "prepared-publish",
      reason: "ambiguous",
    });
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
    expect(value.journal.abortPrepared).not.toHaveBeenCalled();
    expect(value.journal.state.pending_operation).toMatchObject({
      phase: "prepared",
    });
  });

  it("keeps submitted journal when gateway result is unknown", async () => {
    const value = fixture();
    value.gateway.submitMint.mockRejectedValueOnce(new Error("disconnect"));

    await expect(value.coordinator.mint("intent")).resolves.toMatchObject({
      status: "needs-reconciliation",
      stage: "gateway-submit",
      reason: "gateway-unknown",
    });
    expect(value.journal.state.pending_operation).toMatchObject({
      phase: "submitted",
    });
    expect(value.sync.publishCandidate).not.toHaveBeenCalled();
  });

  it("never submits if marking submitted is not durable", async () => {
    const value = fixture();
    value.journal.markSubmitted.mockRejectedValueOnce(
      new Error("submitted phase write failed")
    );

    await expect(value.coordinator.mint("intent")).rejects.toThrow(
      "submitted phase write failed"
    );
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
  });

  it("propagates response persistence failure instead of mislabeling it as gateway ambiguity", async () => {
    const value = fixture();
    value.journal.recordMintResponse.mockRejectedValueOnce(
      new Error("indexeddb transaction failed")
    );

    await expect(value.coordinator.mint("intent")).rejects.toThrow(
      "indexeddb transaction failed"
    );
    expect(value.gateway.submitMint).toHaveBeenCalledOnce();
    expect(value.sync.publishCandidate).not.toHaveBeenCalled();
  });

  it("keeps response_recorded proofs on final conflict", async () => {
    const value = fixture();
    value.sync.finalResult = {
      status: "conflict",
      currentEventId: "d".repeat(64),
      currentRevision: 6,
    };

    await expect(value.coordinator.mint("intent")).resolves.toMatchObject({
      status: "needs-reconciliation",
      stage: "final-publish",
      reason: "conflict",
    });
    expect(value.journal.finalizeAcceptedSnapshot).not.toHaveBeenCalled();
    expect(value.journal.state.pending_operation).toMatchObject({
      phase: "response_recorded",
      response: mintResponse,
    });
  });

  it("keeps response_recorded proofs on ambiguous final publication", async () => {
    const value = fixture();
    value.sync.finalResult = {
      status: "needs-reconciliation",
      cause: "timeout",
      candidateEventId: FINAL_HEAD,
      currentEventId: PREPARED_HEAD,
    };

    await expect(value.coordinator.mint("intent")).resolves.toMatchObject({
      status: "needs-reconciliation",
      stage: "final-publish",
      reason: "ambiguous",
    });
    expect(value.journal.finalizeAcceptedSnapshot).not.toHaveBeenCalled();
    expect(value.journal.state.pending_operation).toMatchObject({
      phase: "response_recorded",
      response: mintResponse,
    });
  });
});

describe("SyncOperationCoordinator resume", () => {
  it("re-publishes prepared state before first submit", async () => {
    const value = fixture();
    value.journal.state.pending_operation = pendingMint("prepared");

    await expect(value.coordinator.resume()).resolves.toMatchObject({
      status: "completed",
      type: "mint",
    });
    expect(value.gateway.createMintPreview).not.toHaveBeenCalled();
    expect(value.sync.publishCurrent).toHaveBeenCalledOnce();
    expect(value.gateway.submitMint).toHaveBeenCalledWith(mintPreview);
  });

  it("does not pull over a locally prepared crash journal before publishing it", async () => {
    const value = fixture();
    value.journal.state.pending_operation = pendingMint("prepared");

    await value.coordinator.resume();
    expect(value.sync.pull).not.toHaveBeenCalled();
    expect(value.sync.publishCurrent).toHaveBeenCalledOnce();
  });

  it.each(["submitted", "needs_reconciliation"] as const)(
    "uses read-only reconciliation for %s and never resubmits",
    async (phase) => {
      const value = fixture();
      value.journal.state.pending_operation = pendingMint(phase);
      value.gateway.reconcileMint.mockResolvedValueOnce(mintResponse);

      await expect(value.coordinator.resume()).resolves.toMatchObject({
        status: "completed",
        type: "mint",
      });
      expect(value.gateway.submitMint).not.toHaveBeenCalled();
      expect(value.gateway.reconcileMint).toHaveBeenCalledWith(mintPreview);
      expect(value.sync.pull).not.toHaveBeenCalled();
    }
  );

  it("returns unresolved when read-only reconciliation has no answer", async () => {
    const value = fixture();
    value.journal.state.pending_operation = pendingMint("submitted");

    await expect(value.coordinator.resume()).resolves.toMatchObject({
      status: "needs-reconciliation",
      stage: "gateway-reconcile",
      reason: "gateway-unresolved",
    });
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
  });

  it("resumes response_recorded at final CAS without another gateway call", async () => {
    const value = fixture();
    value.journal.state.pending_operation = pendingMint(
      "response_recorded",
      mintResponse
    );

    await expect(value.coordinator.resume()).resolves.toMatchObject({
      status: "completed",
      type: "mint",
    });
    expect(value.gateway.submitMint).not.toHaveBeenCalled();
    expect(value.gateway.reconcileMint).not.toHaveBeenCalled();
    expect(value.sync.publishCandidate).toHaveBeenCalledOnce();
  });

  it("serializes operations in one process", async () => {
    const value = fixture();
    let release!: () => void;
    value.sync.pull.mockImplementationOnce(
      () =>
        new Promise(
          (resolve) => (release = () => resolve(value.sync.pullResult))
        )
    );

    const first = value.coordinator.mint("first");
    const second = value.coordinator.mint("second");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(value.gateway.createMintPreview).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toMatchObject({ status: "completed" });
    await expect(second).resolves.toMatchObject({ status: "completed" });
    expect(value.sync.pull.mock.invocationCallOrder[1]).toBeGreaterThan(
      value.journal.finalizeAcceptedSnapshot.mock.invocationCallOrder[0]
    );
    expect(value.gateway.createMintPreview).toHaveBeenCalledTimes(2);
  });
});
