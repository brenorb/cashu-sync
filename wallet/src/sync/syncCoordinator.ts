import type { Event } from "nostr-tools";
import {
  createSyncEventV0,
  decryptSyncEventV0,
  type CreateSyncEventOptions,
} from "src/sync/syncCrypto";
import type { RelayPublishResult } from "src/sync/relayClient";
import type { SnapshotV0 } from "src/sync/types";
import { canonicalJson } from "src/sync/validation";

export interface SnapshotRelay {
  queryCurrent(): Promise<Event | null>;
  queryRecent(limit: number): Promise<Event[]>;
  publish(event: Event): Promise<RelayPublishResult>;
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
};

/** Coordinates opaque relay CAS with one atomic local snapshot repository. */
export class SnapshotSyncCoordinator {
  private static readonly RETAINED_HISTORY_LIMIT = 8;
  private readonly relay: SnapshotRelay;
  private readonly repository: SnapshotRepository;
  private readonly crypto: SnapshotCrypto;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SnapshotSyncCoordinatorOptions) {
    this.relay = options.relay;
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
        this.verifyRetainedPath(recent, local, current, incoming);
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
        // Normal mode never skips retained history: only an explicitly pristine
        // paired/recovered install may use bootstrap mode for a pruned chain.
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
