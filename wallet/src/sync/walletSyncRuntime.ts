import { cashuDb, type CashuDexie } from "src/stores/dexie";
import {
  LocalAuthorityRepository,
  type AuthorityStorage,
} from "src/sync/authorityRepository";
import type {
  AuthorityPayloadV0,
  AuthorityValidationOptions,
} from "src/sync/authorityPayload";
import { LocalWalletRepository } from "src/sync/localWalletRepository";
import { OperationJournalRepository } from "src/sync/operationJournalRepository";
import { SyncRelayClient } from "src/sync/relayClient";
import {
  SnapshotSyncCoordinator,
  type PublishOutcome,
  type PullOptions,
  type PullOutcome,
} from "src/sync/syncCoordinator";
import { hexToBytes } from "src/sync/syncCrypto";
import type { SnapshotV0 } from "src/sync/types";

export interface RuntimeSession {
  repository: { exportSnapshot(): Promise<SnapshotV0> };
  sync: {
    pull(options?: PullOptions): Promise<PullOutcome>;
    publishCurrent(): Promise<PublishOutcome>;
  };
  journal?: OperationJournalRepository;
}

export type RuntimeSessionFactory = (
  authority: AuthorityPayloadV0
) => RuntimeSession;

export type WalletSyncStartOutcome =
  | { status: "unconfigured" }
  | {
      status: "ready";
      sync: "genesis-published" | "noop" | "applied";
      eventId: string;
      revision: number;
    };

export class WalletSyncRuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WalletSyncRuntimeError";
  }
}

export type WalletSyncRuntimeOptions = {
  authority: LocalAuthorityRepository;
  createSession: RuntimeSessionFactory;
};

/** Owns startup/bootstrap policy; monetary state transitions live elsewhere. */
export class WalletSyncRuntime {
  private session: RuntimeSession | null = null;
  private startInFlight: Promise<WalletSyncStartOutcome> | null = null;

  constructor(private readonly options: WalletSyncRuntimeOptions) {}

  start(): Promise<WalletSyncStartOutcome> {
    if (this.startInFlight !== null) return this.startInFlight;
    const operation = this.startUnlocked();
    this.startInFlight = operation.finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  currentSession(): RuntimeSession | null {
    return this.session;
  }

  async importForRecovery(value: unknown): Promise<AuthorityPayloadV0> {
    let candidate: AuthorityPayloadV0;
    try {
      candidate = this.options.authority.validate(value);
    } catch (cause) {
      throw new WalletSyncRuntimeError("invalid recovery authority", { cause });
    }
    const session = this.options.createSession(candidate);
    const local = await session.repository.exportSnapshot();
    if (!isPristine(local)) {
      throw new WalletSyncRuntimeError(
        "recovery import requires a pristine local wallet"
      );
    }
    this.options.authority.importAuthority(candidate);
    this.session = null;
    return candidate;
  }

  private async startUnlocked(): Promise<WalletSyncStartOutcome> {
    const authority = this.options.authority.loadAndRepairMnemonic();
    if (authority === null) return { status: "unconfigured" };

    const session = this.options.createSession(authority);
    this.session = session;
    const local = await session.repository.exportSnapshot();
    const mode =
      isPristine(local) && authority.head_event_id !== ""
        ? "bootstrap"
        : "normal";
    const pulled = await session.sync.pull({ mode });
    if (pulled.status === "empty") {
      const published = await session.sync.publishCurrent();
      if (published.status !== "accepted") {
        throw new WalletSyncRuntimeError(
          "could not establish the wallet genesis head"
        );
      }
      return {
        status: "ready",
        sync: "genesis-published",
        eventId: published.eventId,
        revision: published.revision,
      };
    }
    return {
      status: "ready",
      sync: pulled.status,
      eventId: pulled.eventId,
      revision: pulled.revision,
    };
  }
}

export function createBrowserWalletSyncRuntime(
  options: {
    db?: CashuDexie;
    storage?: AuthorityStorage;
    validation?: AuthorityValidationOptions;
  } = {}
): WalletSyncRuntime {
  const db = options.db ?? cashuDb;
  const validation = options.validation ?? {};
  const authority = new LocalAuthorityRepository(
    db,
    options.storage ?? localStorage,
    validation
  );
  return new WalletSyncRuntime({
    authority,
    createSession: (payload) => {
      const secret = hexToBytes(payload.sync_secret);
      const relay = new SyncRelayClient({
        relayUrl: payload.relay_url,
        syncSecret: secret,
        allowInsecureLoopback: validation.allowLoopbackHttp,
      });
      const repository = new LocalWalletRepository(
        db,
        payload.mint_url,
        validation
      );
      const sync = new SnapshotSyncCoordinator({
        relay,
        repository,
        syncSecret: secret,
        configuredMint: payload.mint_url,
        allowLoopbackHttp: validation.allowLoopbackHttp,
      });
      const journal = new OperationJournalRepository(
        db,
        payload.mint_url,
        validation
      );
      return { repository, sync, journal };
    },
  });
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
