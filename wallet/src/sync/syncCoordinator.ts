import type { Event } from "nostr-tools";
import {
  createSyncEventV0,
  decryptSyncEventV0,
  type CreateSyncEventOptions,
} from "src/sync/syncCrypto";
import type {
  RelayPublishResult,
  RelayWatchStatus,
} from "src/sync/relayClient";
import type { SnapshotV0, SnapshotProofV0 } from "src/sync/types";
import { canonicalJson } from "src/sync/validation";

export interface SnapshotRelay {
  queryCurrent(): Promise<Event | null>;
  queryRecent(limit: number): Promise<Event[]>;
  publish(event: Event): Promise<RelayPublishResult>;
  watchCurrent?(onEvent: (event: Event) => void): () => void;
}

export interface SnapshotRepository {
  exportSnapshot(): Promise<SnapshotV0>;
  applySnapshot(snapshot: SnapshotV0, headEventId: string): Promise<void>;
}

export interface SnapshotCrypto {
  createEvent(snapshot: SnapshotV0): Event;
  decryptEvent(event: Event): SnapshotV0;
}

export type SnapshotSyncCoordinatorErrorCode =
  | "pending-local"
  | "invalid-local"
  | "invalid-remote"
  | "missing-head"
  | "rollback"
  | "revision-gap"
  | "branch"
  | "publish-rejected"
  | "local-apply";

export class SnapshotSyncCoordinatorError extends Error {
  readonly code: SnapshotSyncCoordinatorErrorCode;
  readonly category?: "auth" | "admission" | "relay";
  readonly acceptedEventId?: string;

  constructor(
    code: SnapshotSyncCoordinatorErrorCode,
    message: string,
    details: {
      category?: "auth" | "admission" | "relay";
      acceptedEventId?: string;
      cause?: unknown;
    } = {}
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause }
    );
    this.name = "SnapshotSyncCoordinatorError";
    this.code = code;
    this.category = details.category;
    this.acceptedEventId = details.acceptedEventId;
  }
}

export type PullOptions = { mode?: "normal" | "bootstrap" };
export type PublishCandidateOptions = { applyAccepted?: boolean };

export type PullOutcome =
  | { status: "empty" }
  | { status: "noop"; eventId: string; revision: number }
  | {
      status: "applied";
      mode: "genesis" | "child" | "bootstrap";
      eventId: string;
      revision: number;
    };

export type PublishOutcome =
  | {
      status: "accepted";
      resolution: "direct" | "confirmed";
      eventId: string;
      revision: number;
    }
  | {
      status: "conflict";
      currentEventId: string | null;
      currentRevision: number | null;
    }
  | {
      status: "needs-reconciliation";
      cause: "timeout" | "disconnected";
      candidateEventId: string;
      currentEventId: string | null;
    };

export type SnapshotSyncCoordinatorOptions = {
  relay: SnapshotRelay;
  repository: SnapshotRepository;
  syncSecret: Uint8Array;
  configuredMint: string;
  allowLoopbackHttp?: boolean;
  crypto?: SnapshotCrypto;
  reconcileProofs?: (proofs: SnapshotProofV0[]) => Promise<SnapshotProofV0[]>;
};

/** Coordinates opaque relay CAS with one atomic local snapshot repository. */
export class SnapshotSyncCoordinator {
  private static readonly RETAINED_HISTORY_LIMIT = 8;
  private readonly relay: SnapshotRelay;
  private readonly repository: SnapshotRepository;
  private readonly crypto: SnapshotCrypto;
  private readonly reconcileProofs: SnapshotSyncCoordinatorOptions["reconcileProofs"];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SnapshotSyncCoordinatorOptions) {
    this.relay = options.relay;
    this.reconcileProofs = options.reconcileProofs;
    this.repository = options.repository;
    const cryptoOptions: CreateSyncEventOptions = {
      expectedMint: options.configuredMint,
      allowLoopbackHttp: options.allowLoopbackHttp,
    };
    this.crypto = options.crypto ?? {
      createEvent: (snapshot) =>
        createSyncEventV0(snapshot, options.syncSecret, cryptoOptions),
      decryptEvent: (event) =>
        decryptSyncEventV0(event, options.syncSecret, cryptoOptions),
    };
  }

  pull(options: PullOptions = {}): Promise<PullOutcome> {
    return this.serialize(() => this.pullUnlocked(options.mode ?? "normal"));
  }

  publishCurrent(): Promise<PublishOutcome> {
    return this.serialize(() => this.publishUnlocked());
  }

  publishCandidate(
    candidate: SnapshotV0,
    options: PublishCandidateOptions = {}
  ): Promise<PublishOutcome> {
    return this.serialize(() =>
      this.publishUnlocked(candidate, options.applyAccepted ?? true)
    );
  }

  watchCurrent(
    onEvent: (event: Event) => void,
    onStatus?: (status: RelayWatchStatus) => void
  ): () => void {
    return this.relay.watchCurrent?.(onEvent, onStatus) ?? (() => undefined);
  }

  /** Confirms a previously published exact candidate without republishing it. */
  confirmCandidate(candidate: SnapshotV0): Promise<PublishOutcome | null> {
    return this.serialize(async () => {
      const current = await this.relay.queryCurrent();
      if (current === null) return null;
      const snapshot = this.decryptRemote(current);
      if (!sameSnapshot(snapshot, candidate)) return null;
      return {
        status: "accepted",
        resolution: "confirmed",
        eventId: current.id,
        revision: candidate.revision,
      };
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async pullUnlocked(
    mode: "normal" | "bootstrap"
  ): Promise<PullOutcome> {
    const local = await this.repository.exportSnapshot();
    this.assertLocalBaseline(local);
    if (mode === "bootstrap" && !isPristine(local)) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "bootstrap requires a pristine local wallet"
      );
    }

    const recent = await this.relay.queryRecent(
      SnapshotSyncCoordinator.RETAINED_HISTORY_LIMIT
    );
    const current = recent[0] ?? null;
    if (current === null) {
      if (!isPristine(local)) {
        throw new SnapshotSyncCoordinatorError(
          "missing-head",
          "relay has no head for non-pristine local state"
        );
      }
      return { status: "empty" };
    }
    let decrypted: SnapshotV0 | undefined;
    if (mode === "normal" && !isPristine(local)) {
      const incoming = this.decryptRemote(current);
      decrypted = incoming;
      if (incoming.revision > local.revision + 1) {
        try {
          this.verifyRetainedPath(recent, local, current, incoming);
        } catch (error) {
          if (
            !(error instanceof SnapshotSyncCoordinatorError) ||
            error.code !== "revision-gap" ||
            !this.reconcileProofs
          )
            throw error;
          return this.recoverPrunedHistory(local, incoming, current.id);
        }
        assertPendingResolved(local, incoming);
        await this.applyLocal(incoming, current.id);
        return {
          status: "applied",
          mode: "child",
          eventId: current.id,
          revision: incoming.revision,
        };
      }
    }
    return this.applyIncoming(current, local, mode, decrypted);
  }

  private async recoverPrunedHistory(
    local: SnapshotV0,
    incoming: SnapshotV0,
    eventId: string
  ): Promise<PullOutcome> {
    assertPendingResolved(local, incoming);
    // The authenticated full snapshot survives pruning. Preserve local-only
    // tokens, and let the mint decide which tokens remain usable.
    const proofs = new Map(
      incoming.proofs.map((proof) => [proof.secret, proof])
    );
    for (const proof of local.proofs) {
      const remote = proofs.get(proof.secret);
      if (
        remote &&
        (remote.id !== proof.id ||
          remote.C !== proof.C ||
          remote.amount !== proof.amount)
      ) {
        throw new SnapshotSyncCoordinatorError(
          "invalid-remote",
          "conflicting token identity; local tokens preserved"
        );
      }
      if (!remote) proofs.set(proof.secret, proof);
    }
    const recovered: SnapshotV0 = {
      ...incoming,
      proofs: await this.reconcileProofs!([...proofs.values()]),
      counters: { ...incoming.counters },
      quotes: [
        ...new Map(
          [...local.quotes, ...incoming.quotes].map((q) => [
            `${q.type}:${q.quote}`,
            q,
          ])
        ).values(),
      ],
      history: [
        ...new Map(
          [...local.history, ...incoming.history].map((h) => [h.id, h])
        ).values(),
      ],
    };
    for (const [key, value] of Object.entries(local.counters)) {
      recovered.counters[key] = Math.max(value, recovered.counters[key] ?? 0);
    }
    await this.applyLocal(recovered, eventId);
    // Publish any preserved local tokens or mint corrections through normal CAS.
    // A conflict leaves the reconciled local material durable for the next pull.
    if (!sameSnapshot(recovered, incoming)) {
      const published = await this.publishUnlocked();
      if (published.status === "accepted") {
        return {
          status: "applied",
          mode: "child",
          eventId: published.eventId,
          revision: published.revision,
        };
      }
    }
    return {
      status: "applied",
      mode: "child",
      eventId,
      revision: incoming.revision,
    };
  }

  private verifyRetainedPath(
    recent: Event[],
    local: SnapshotV0,
    current: Event,
    incoming: SnapshotV0
  ): void {
    const byId = new Map(recent.map((event) => [event.id, event]));
    let event = current;
    let snapshot = incoming;

    while (snapshot.previous_event_id !== local.previous_event_id) {
      if (snapshot.revision <= local.revision + 1) {
        throw new SnapshotSyncCoordinatorError(
          "branch",
          "retained relay history does not extend the remembered local head"
        );
      }
      const predecessor = byId.get(snapshot.previous_event_id);
      if (predecessor === undefined) {
        throw new SnapshotSyncCoordinatorError(
          "revision-gap",
          "the remembered predecessor is no longer in retained relay history"
        );
      }
      const predecessorSnapshot = this.decryptRemote(predecessor);
      if (
        predecessor.id !== snapshot.previous_event_id ||
        predecessorSnapshot.revision !== snapshot.revision - 1
      ) {
        throw new SnapshotSyncCoordinatorError(
          "invalid-remote",
          "retained relay history has a broken revision chain"
        );
      }
      event = predecessor;
      snapshot = predecessorSnapshot;
    }

    if (
      snapshot.revision !== local.revision + 1 ||
      event.id === local.previous_event_id
    ) {
      throw new SnapshotSyncCoordinatorError(
        snapshot.revision > local.revision + 1
          ? "revision-gap"
          : "invalid-remote",
        "retained relay history does not advance exactly from local state"
      );
    }
  }

  private async applyIncoming(
    event: Event,
    local: SnapshotV0,
    mode: "normal" | "bootstrap",
    decrypted?: SnapshotV0
  ): Promise<PullOutcome> {
    const incoming = decrypted ?? this.decryptRemote(event);

    if (event.id === local.previous_event_id) {
      if (incoming.revision !== local.revision) {
        throw new SnapshotSyncCoordinatorError(
          "invalid-remote",
          "current relay head has a different inner revision"
        );
      }
      return { status: "noop", eventId: event.id, revision: incoming.revision };
    }

    let appliedMode: "genesis" | "child" | "bootstrap";
    if (mode === "bootstrap") {
      if (incoming.revision < 1) {
        throw new SnapshotSyncCoordinatorError(
          "rollback",
          "bootstrap relay head must have revision 1 or later"
        );
      }
      appliedMode = "bootstrap";
    } else if (isPristine(local)) {
      if (incoming.revision !== 1) {
        throw new SnapshotSyncCoordinatorError(
          incoming.revision < 1 ? "rollback" : "revision-gap",
          "relay genesis must have revision 1"
        );
      }
      if (incoming.previous_event_id !== "") {
        throw new SnapshotSyncCoordinatorError(
          "branch",
          "relay event is not a genesis child of the local baseline"
        );
      }
      appliedMode = "genesis";
    } else {
      if (incoming.revision <= local.revision) {
        throw new SnapshotSyncCoordinatorError(
          "rollback",
          "relay event would roll back the local revision"
        );
      }
      if (incoming.revision !== local.revision + 1) {
        // Non-pristine pruned histories are reconciled against the mint above;
        // pristine recovery installs use explicit bootstrap mode.
        throw new SnapshotSyncCoordinatorError(
          "revision-gap",
          "relay event skips retained history; normal pull cannot bootstrap an existing wallet"
        );
      }
      if (incoming.previous_event_id !== local.previous_event_id) {
        throw new SnapshotSyncCoordinatorError(
          "branch",
          "relay event does not extend the remembered local head"
        );
      }
      appliedMode = "child";
    }

    assertPendingResolved(local, incoming);
    await this.applyLocal(incoming, event.id);
    return {
      status: "applied",
      mode: appliedMode,
      eventId: event.id,
      revision: incoming.revision,
    };
  }

  private async publishUnlocked(
    suppliedCandidate?: SnapshotV0,
    applyAccepted = true
  ): Promise<PublishOutcome> {
    const local = await this.repository.exportSnapshot();
    this.assertLocalBaseline(local);
    if (local.revision >= Number.MAX_SAFE_INTEGER) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "local revision cannot be incremented safely"
      );
    }
    const candidate: SnapshotV0 = suppliedCandidate ?? {
      ...local,
      revision: local.revision + 1,
      previous_event_id: local.previous_event_id,
    };
    if (
      candidate.revision !== local.revision + 1 ||
      candidate.previous_event_id !== local.previous_event_id
    ) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "candidate must be the next revision extending the local head"
      );
    }

    let event: Event;
    try {
      event = this.crypto.createEvent(candidate);
    } catch (cause) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "could not create a valid local sync event",
        { cause }
      );
    }
    let createdSnapshot: SnapshotV0;
    try {
      createdSnapshot = this.crypto.decryptEvent(event);
    } catch (cause) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "created sync event failed local verification",
        { cause }
      );
    }
    if (!sameSnapshot(createdSnapshot, candidate)) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "created sync event does not contain the candidate snapshot"
      );
    }

    const result = await this.relay.publish(event);
    if (result.status === "accepted") {
      if (applyAccepted) {
        await this.applyLocal(candidate, event.id, event.id);
      }
      return {
        status: "accepted",
        resolution: "direct",
        eventId: event.id,
        revision: candidate.revision,
      };
    }
    if (result.status === "conflict") {
      // A prepared local operation may own counters and request material. Read
      // and authenticate the winning head, but leave reconciliation to the
      // operation layer without replacing local state.
      const current = await this.relay.queryCurrent();
      if (current === null) {
        return {
          status: "conflict",
          currentEventId: null,
          currentRevision: null,
        };
      }
      const currentSnapshot = this.decryptRemote(current);
      return {
        status: "conflict",
        currentEventId: current.id,
        currentRevision: currentSnapshot.revision,
      };
    }
    if (result.status === "rejected") {
      throw new SnapshotSyncCoordinatorError(
        "publish-rejected",
        result.reason || "relay rejected sync event",
        { category: result.category }
      );
    }

    let current: Event | null;
    try {
      current = await this.relay.queryCurrent();
    } catch {
      current = null;
    }
    const currentSnapshot =
      current === null ? null : this.decryptRemote(current);
    if (current?.id === event.id && currentSnapshot !== null) {
      const confirmed = currentSnapshot;
      if (!sameSnapshot(confirmed, candidate)) {
        throw new SnapshotSyncCoordinatorError(
          "invalid-remote",
          "confirmed event does not contain the published snapshot"
        );
      }
      if (applyAccepted) {
        await this.applyLocal(candidate, event.id, event.id);
      }
      return {
        status: "accepted",
        resolution: "confirmed",
        eventId: event.id,
        revision: candidate.revision,
      };
    }
    return {
      status: "needs-reconciliation",
      cause: result.cause,
      candidateEventId: event.id,
      currentEventId: current?.id ?? null,
    };
  }

  private decryptRemote(event: Event): SnapshotV0 {
    try {
      return this.crypto.decryptEvent(event);
    } catch (cause) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-remote",
        "relay event failed signature, key, mint, or decryption validation",
        { cause }
      );
    }
  }

  private async applyLocal(
    snapshot: SnapshotV0,
    headEventId: string,
    acceptedEventId?: string
  ): Promise<void> {
    try {
      await this.repository.applySnapshot(snapshot, headEventId);
    } catch (cause) {
      throw new SnapshotSyncCoordinatorError(
        "local-apply",
        acceptedEventId === undefined
          ? "could not atomically apply relay snapshot"
          : "relay accepted the event but local atomic apply failed",
        { cause, acceptedEventId }
      );
    }
  }

  private assertLocalBaseline(local: SnapshotV0): void {
    const hasHead = local.previous_event_id !== "";
    if ((local.revision === 0 && hasHead) || (local.revision > 0 && !hasHead)) {
      throw new SnapshotSyncCoordinatorError(
        "invalid-local",
        "local revision and remembered head are inconsistent"
      );
    }
  }
}

function isPristine(snapshot: SnapshotV0): boolean {
  return (
    snapshot.revision === 0 &&
    snapshot.previous_event_id === "" &&
    snapshot.proofs.length === 0 &&
    Object.keys(snapshot.counters).length === 0 &&
    snapshot.quotes.length === 0 &&
    snapshot.history.length === 0 &&
    snapshot.pending_operation === null
  );
}

function sameSnapshot(left: SnapshotV0, right: SnapshotV0): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** A newer relay revision alone does not prove that local money was resolved. */
function assertPendingResolved(local: SnapshotV0, incoming: SnapshotV0): void {
  const pending = local.pending_operation;
  if (pending === null) return;
  const expected = pending.prepared_request.quote;
  const quote = incoming.quotes.find(
    (quote) => quote.type === pending.type && quote.quote === expected.quote
  );
  const unpaid =
    pending.type === "melt" &&
    quote?.state === "UNPAID" &&
    pending.prepared_request.request.inputs.every((input) =>
      incoming.proofs.some(
        (proof) =>
          proof.secret === input.secret &&
          proof.id === input.id &&
          proof.C === input.C &&
          proof.amount === Number(input.amount) &&
          !proof.reserved &&
          proof.quote === undefined
      )
    );
  const terminal =
    pending.type === "mint"
      ? quote?.state === "ISSUED"
      : quote?.state === "PAID" || unpaid;
  const original = local.history.find(
    (entry) =>
      entry.direction === pending.type &&
      entry.quote === expected.quote &&
      entry.request === expected.request
  );
  const recorded = incoming.history.some(
    (entry) =>
      entry.direction === pending.type &&
      entry.quote === expected.quote &&
      entry.request === expected.request &&
      entry.amount === original?.amount &&
      entry.mint === local.mint &&
      entry.unit === local.unit &&
      entry.status === (unpaid ? "pending" : "paid")
  );
  const contains = (proof: SnapshotProofV0) =>
    incoming.proofs.some(
      (remote) =>
        remote.secret === proof.secret &&
        remote.id === proof.id &&
        remote.C === proof.C &&
        remote.amount === proof.amount
    );
  const sameRecordedResult =
    pending.phase === "response_recorded" &&
    pending.response !== null &&
    (pending.type === "mint"
      ? pending.response.proofs.every(contains)
      : pending.response.state === "UNPAID"
      ? unpaid
      : pending.response.state === "PAID" &&
        pending.response.change.every(contains) &&
        pending.prepared_request.request.inputs.every(
          (input) =>
            !incoming.proofs.some((proof) => proof.secret === input.secret)
        ));
  if (
    (pending.phase !== "submitted" &&
      !sameRecordedResult &&
      pending.phase !== "needs_reconciliation" &&
      !(
        pending.type === "melt" &&
        pending.phase === "response_recorded" &&
        pending.response?.state === "PENDING"
      )) ||
    incoming.pending_operation !== null ||
    !terminal ||
    !recorded ||
    quote?.request !== expected.request ||
    quote?.amount !== Number(expected.amount) ||
    quote?.unit !== local.unit ||
    Object.entries(local.counters).some(
      ([key, value]) => (incoming.counters[key] ?? -1) < value
    )
  ) {
    throw new SnapshotSyncCoordinatorError(
      "pending-local",
      "relay snapshot does not safely resolve the local operation"
    );
  }
}
