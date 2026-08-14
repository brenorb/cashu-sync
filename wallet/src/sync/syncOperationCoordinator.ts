import type { PublishOutcome, PullOutcome } from "src/sync/syncCoordinator";
import type {
  PendingMeltResponseV0,
  PendingMeltV0,
  PendingMintResponseV0,
  PendingMintV0,
  PendingOperationV0,
  SerializedMeltPreviewV0,
  SerializedMintPreviewV0,
  SnapshotV0,
} from "src/sync/types";

export interface SnapshotSyncPort {
  pull(): Promise<PullOutcome>;
  publishCurrent(): Promise<PublishOutcome>;
  publishCandidate(
    candidate: SnapshotV0,
    options: { applyAccepted: false }
  ): Promise<PublishOutcome>;
  confirmCandidate(candidate: SnapshotV0): Promise<PublishOutcome | null>;
}

export interface OperationJournalPort {
  prepareMint(
    operationId: string,
    preview: SerializedMintPreviewV0,
    timestamp: number
  ): Promise<void>;
  prepareMelt(
    operationId: string,
    preview: SerializedMeltPreviewV0,
    timestamp: number
  ): Promise<void>;
  markSubmitted(
    operationId: string,
    type: "mint" | "melt",
    timestamp: number
  ): Promise<void>;
  recordMintResponse(
    operationId: string,
    response: PendingMintResponseV0,
    timestamp: number
  ): Promise<void>;
  recordMeltResponse(
    operationId: string,
    response: PendingMeltResponseV0,
    timestamp: number
  ): Promise<void>;
  abortPrepared(operationId: string, type: "mint" | "melt"): Promise<void>;
  candidateWithClearedOperation(operationId: string): Promise<SnapshotV0>;
  finalizeAcceptedSnapshot(
    candidate: SnapshotV0,
    eventId: string
  ): Promise<void>;
}

export interface OperationStateReader {
  exportSnapshot(): Promise<SnapshotV0>;
}

/**
 * The gateway owns Cashu protocol details. Submit methods MUST use the exact
 * serialized preview and MUST NOT silently swap or regenerate signed outputs.
 */
export interface CashuOperationGateway<MintIntent, MeltIntent> {
  createMintPreview(intent: MintIntent): Promise<SerializedMintPreviewV0>;
  createMeltPreview(intent: MeltIntent): Promise<SerializedMeltPreviewV0>;
  submitMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0>;
  submitMelt(
    exactPreview: SerializedMeltPreviewV0
  ): Promise<PendingMeltResponseV0>;
  /** Read-only quote/proof recovery; it must never submit the operation. */
  reconcileMint(
    exactPreview: SerializedMintPreviewV0
  ): Promise<PendingMintResponseV0 | null>;
  /** Read-only quote/proof recovery; it must never submit the operation. */
  reconcileMelt(
    exactPreview: SerializedMeltPreviewV0
  ): Promise<PendingMeltResponseV0 | null>;
}

export type SyncOperationOutcome =
  | {
      status: "completed";
      type: "mint" | "melt";
      operationId: string;
      eventId: string;
    }
  | {
      status: "aborted-before-submit";
      type: "mint" | "melt";
      operationId: string;
      reason: "conflict" | "rejected";
    }
  | {
      status: "needs-reconciliation";
      type: "mint" | "melt";
      operationId: string;
      stage:
        | "prepared-publish"
        | "gateway-submit"
        | "gateway-reconcile"
        | "final-publish";
      reason:
        | "ambiguous"
        | "conflict"
        | "rejected"
        | "gateway-unknown"
        | "gateway-unresolved";
    }
  | { status: "idle" };

export type SyncOperationCoordinatorOptions<MintIntent, MeltIntent> = {
  sync: SnapshotSyncPort;
  journal: OperationJournalPort;
  state: OperationStateReader;
  gateway: CashuOperationGateway<MintIntent, MeltIntent>;
  operationId?: () => string;
  now?: () => number;
};

export class SyncOperationCoordinator<MintIntent, MeltIntent> {
  private readonly sync: SnapshotSyncPort;
  private readonly journal: OperationJournalPort;
  private readonly state: OperationStateReader;
  private readonly gateway: CashuOperationGateway<MintIntent, MeltIntent>;
  private readonly operationId: () => string;
  private readonly now: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    options: SyncOperationCoordinatorOptions<MintIntent, MeltIntent>
  ) {
    this.sync = options.sync;
    this.journal = options.journal;
    this.state = options.state;
    this.gateway = options.gateway;
    this.operationId = options.operationId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  mint(intent: MintIntent): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.startMint(intent));
  }

  melt(intent: MeltIntent): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.startMelt(intent));
  }

  resume(): Promise<SyncOperationOutcome> {
    return this.serialize(() => this.resumeUnlocked());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async startMint(intent: MintIntent): Promise<SyncOperationOutcome> {
    const existing = await this.pullForNewOperation();
    if (existing !== null) return this.resumePending(existing);
    const operationId = this.operationId();
    const preview = await this.gateway.createMintPreview(intent);
    await this.journal.prepareMint(operationId, preview, this.now());
    return this.publishPreparedAndSubmit({
      type: "mint",
      operation_id: operationId,
      phase: "prepared",
      created_at: 0,
      updated_at: 0,
      prepared_request: preview,
      response: null,
    });
  }

  private async startMelt(intent: MeltIntent): Promise<SyncOperationOutcome> {
    const existing = await this.pullForNewOperation();
    if (existing !== null) return this.resumePending(existing);
    const operationId = this.operationId();
    const preview = await this.gateway.createMeltPreview(intent);
    await this.journal.prepareMelt(operationId, preview, this.now());
    return this.publishPreparedAndSubmit({
      type: "melt",
      operation_id: operationId,
      phase: "prepared",
      created_at: 0,
      updated_at: 0,
      prepared_request: preview,
      response: null,
    });
  }

  private async resumeUnlocked(): Promise<SyncOperationOutcome> {
    // Inspect local crash state before any pull. A normal pull may only replace
    // state after the journal has been reconciled or finalized safely.
    const localPending = (await this.state.exportSnapshot()).pending_operation;
    if (localPending !== null && localPending.phase !== "prepared") {
      return this.resumePending(localPending);
    }
    if (localPending !== null) {
      return this.publishPreparedAndSubmit(localPending);
    }
    await this.sync.pull();
    const pending = (await this.state.exportSnapshot()).pending_operation;
    if (pending === null) return { status: "idle" };
    return this.resumePending(pending);
  }

  private resumePending(
    pending: PendingOperationV0
  ): Promise<SyncOperationOutcome> {
    switch (pending.phase) {
      case "prepared":
        // Republishing is safe even if an earlier prepared publication won: it
        // creates another journaled revision and still precedes any Cashu call.
        return this.publishPreparedAndSubmit(pending);
      case "submitted":
      case "needs_reconciliation":
        return this.reconcileGateway(pending);
      case "response_recorded":
        if (pending.type === "melt" && pending.response?.state === "PENDING") {
          return this.reconcileGateway(pending);
        }
        return this.publishFinal(pending);
    }
  }

  private async pullForNewOperation(): Promise<PendingOperationV0 | null> {
    const local = (await this.state.exportSnapshot()).pending_operation;
    if (local !== null) return local;
    await this.sync.pull();
    return (await this.state.exportSnapshot()).pending_operation;
  }

  private async publishPreparedAndSubmit(
    pending: PendingMintV0 | PendingMeltV0
  ): Promise<SyncOperationOutcome> {
    let published: PublishOutcome;
    try {
      published = await this.sync.publishCurrent();
    } catch (error) {
      if (!isPublishRejection(error)) throw error;
      await this.journal.abortPrepared(pending.operation_id, pending.type);
      return {
        status: "aborted-before-submit",
        type: pending.type,
        operationId: pending.operation_id,
        reason: "rejected",
      };
    }
    if (published.status === "conflict") {
      await this.journal.abortPrepared(pending.operation_id, pending.type);
      return {
        status: "aborted-before-submit",
        type: pending.type,
        operationId: pending.operation_id,
        reason: "conflict",
      };
    }
    if (published.status === "needs-reconciliation") {
      return needs(pending, "prepared-publish", "ambiguous");
    }

    if (pending.phase === "prepared") {
      await this.journal.markSubmitted(
        pending.operation_id,
        pending.type,
        this.now()
      );
    }
    if (pending.type === "mint") {
      let response: PendingMintResponseV0;
      try {
        response = await this.gateway.submitMint(pending.prepared_request);
      } catch {
        return needs(pending, "gateway-submit", "gateway-unknown");
      }
      await this.journal.recordMintResponse(
        pending.operation_id,
        response,
        this.now()
      );
      return this.publishFinal({
        ...pending,
        phase: "response_recorded",
        response,
      });
    }
    let response: PendingMeltResponseV0;
    try {
      response = await this.gateway.submitMelt(pending.prepared_request);
    } catch {
      return needs(pending, "gateway-submit", "gateway-unknown");
    }
    await this.journal.recordMeltResponse(
      pending.operation_id,
      response,
      this.now()
    );
    if (response.state === "PENDING") {
      return needs(pending, "gateway-reconcile", "gateway-unresolved");
    }
    return this.publishFinal({
      ...pending,
      phase: "response_recorded",
      response,
    });
  }

  private async reconcileGateway(
    pending: PendingMintV0 | PendingMeltV0
  ): Promise<SyncOperationOutcome> {
    if (pending.type === "mint") {
      let response: PendingMintResponseV0 | null;
      try {
        response = await this.gateway.reconcileMint(pending.prepared_request);
      } catch {
        return needs(pending, "gateway-reconcile", "gateway-unresolved");
      }
      if (response === null) {
        return needs(pending, "gateway-reconcile", "gateway-unresolved");
      }
      await this.journal.recordMintResponse(
        pending.operation_id,
        response,
        this.now()
      );
      return this.publishFinal({
        ...pending,
        phase: "response_recorded",
        response,
      });
    }
    let response: PendingMeltResponseV0 | null;
    try {
      response = await this.gateway.reconcileMelt(pending.prepared_request);
    } catch {
      return needs(pending, "gateway-reconcile", "gateway-unresolved");
    }
    if (response === null || response.state === "PENDING") {
      if (response !== null) {
        await this.journal.recordMeltResponse(
          pending.operation_id,
          response,
          this.now()
        );
      }
      return needs(pending, "gateway-reconcile", "gateway-unresolved");
    }
    await this.journal.recordMeltResponse(
      pending.operation_id,
      response,
      this.now()
    );
    return this.publishFinal({
      ...pending,
      phase: "response_recorded",
      response,
    });
  }

  private async publishFinal(
    pending: PendingMintV0 | PendingMeltV0
  ): Promise<SyncOperationOutcome> {
    const candidate = await this.journal.candidateWithClearedOperation(
      pending.operation_id
    );
    const previouslyAccepted = await this.sync.confirmCandidate(candidate);
    if (previouslyAccepted?.status === "accepted") {
      await this.journal.finalizeAcceptedSnapshot(
        candidate,
        previouslyAccepted.eventId
      );
      return {
        status: "completed",
        type: pending.type,
        operationId: pending.operation_id,
        eventId: previouslyAccepted.eventId,
      };
    }
    let published: PublishOutcome;
    try {
      published = await this.sync.publishCandidate(candidate, {
        applyAccepted: false,
      });
    } catch (error) {
      if (!isPublishRejection(error)) throw error;
      return needs(pending, "final-publish", "rejected");
    }
    if (published.status === "conflict") {
      return needs(pending, "final-publish", "conflict");
    }
    if (published.status === "needs-reconciliation") {
      return needs(pending, "final-publish", "ambiguous");
    }
    await this.journal.finalizeAcceptedSnapshot(candidate, published.eventId);
    return {
      status: "completed",
      type: pending.type,
      operationId: pending.operation_id,
      eventId: published.eventId,
    };
  }
}

function needs(
  pending: PendingOperationV0,
  stage: Extract<
    SyncOperationOutcome,
    { status: "needs-reconciliation" }
  >["stage"],
  reason: Extract<
    SyncOperationOutcome,
    { status: "needs-reconciliation" }
  >["reason"]
): SyncOperationOutcome {
  return {
    status: "needs-reconciliation",
    type: pending.type,
    operationId: pending.operation_id,
    stage,
    reason,
  };
}

function isPublishRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "publish-rejected"
  );
}
