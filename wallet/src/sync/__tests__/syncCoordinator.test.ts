import { describe, expect, it, vi } from "vitest";
import { finalizeEvent, type Event } from "nostr-tools";
import {
  createSyncEventV0,
  decryptSyncEventV0,
  hexToBytes,
} from "src/sync/syncCrypto";
import {
  SnapshotSyncCoordinator,
  SnapshotSyncCoordinatorError,
  type SnapshotCrypto,
  type SnapshotRepository,
  type SnapshotRelay,
} from "src/sync/syncCoordinator";
import type { RelayPublishResult } from "src/sync/relayClient";
import type { SnapshotV0 } from "src/sync/types";

const MINT = "https://usd-mint.example";
const SECRET = hexToBytes(
  "1111111111111111111111111111111111111111111111111111111111111111"
);
const HEAD_A = "a".repeat(64);
const HEAD_B = "b".repeat(64);
const HEAD_C = "c".repeat(64);

function snapshot(revision = 0, head = ""): SnapshotV0 {
  return {
    schema: 0,
    revision,
    previous_event_id: head,
    mint: MINT,
    unit: "usd",
    proofs: [],
    counters: {},
    quotes: [],
    history: [],
    pending_operation: null,
  };
}

function event(id: string, previous = ""): Event {
  return {
    id,
    pubkey: "1".repeat(64),
    created_at: 1_780_000_400,
    kind: 30078,
    tags: [
      ["d", "com.silentlink.cashu-sync.wallet.v0"],
      ["prev", previous],
      ["schema", "0"],
    ],
    content: "ciphertext",
    sig: "2".repeat(128),
  };
}

class FakeRepository implements SnapshotRepository {
  state: SnapshotV0;
  readonly applied: Array<{ snapshot: SnapshotV0; headEventId: string }> = [];

  constructor(initial = snapshot()) {
    this.state = initial;
  }

  async exportSnapshot(): Promise<SnapshotV0> {
    return structuredClone(this.state);
  }

  async applySnapshot(next: SnapshotV0, headEventId: string): Promise<void> {
    this.applied.push({ snapshot: structuredClone(next), headEventId });
    this.state = { ...structuredClone(next), previous_event_id: headEventId };
  }
}

class FakeRelay implements SnapshotRelay {
  current: Event | null = null;
  recent: Event[] | null = null;
  publishResult: RelayPublishResult = { status: "accepted", reason: "stored" };
  readonly published: Event[] = [];
  queryCurrent = vi.fn(async (): Promise<Event | null> => this.current);
  queryRecent = vi.fn(
    async (): Promise<Event[]> =>
      this.recent ?? (this.current === null ? [] : [this.current])
  );
  publish = vi.fn(async (next: Event): Promise<RelayPublishResult> => {
    this.published.push(next);
    return this.publishResult;
  });
}

class FakeCrypto implements SnapshotCrypto {
  readonly decrypted = new Map<string, SnapshotV0>();
  created: Event | null = null;
  createEvent = vi.fn((candidate: SnapshotV0): Event => {
    this.created = event(HEAD_C, candidate.previous_event_id);
    this.decrypted.set(this.created.id, structuredClone(candidate));
    return this.created;
  });
  decryptEvent = vi.fn((incoming: Event): SnapshotV0 => {
    const value = this.decrypted.get(incoming.id);
    if (!value) throw new Error("could not decrypt");
    return structuredClone(value);
  });
}

function fixture(initial = snapshot()) {
  const repository = new FakeRepository(initial);
  const relay = new FakeRelay();
  const crypto = new FakeCrypto();
  const coordinator = new SnapshotSyncCoordinator({
    relay,
    repository,
    syncSecret: SECRET,
    configuredMint: MINT,
    crypto,
  });
  return { coordinator, repository, relay, crypto };
}

describe("SnapshotSyncCoordinator pull", () => {
  it("accepts an empty relay only for a pristine local baseline", async () => {
    const pristine = fixture();
    await expect(pristine.coordinator.pull()).resolves.toEqual({
      status: "empty",
    });
    expect(pristine.repository.applied).toHaveLength(0);

    const localState = snapshot();
    localState.proofs.push({
      id: "keyset",
      amount: 1,
      secret: "proof",
      C: "02" + "1".repeat(64),
      reserved: false,
    });
    const nonPristine = fixture(localState);
    await expect(nonPristine.coordinator.pull()).rejects.toMatchObject({
      code: "missing-head",
    });
    expect(nonPristine.repository.applied).toHaveLength(0);
  });

  it("applies revision-one genesis and a direct child", async () => {
    const value = fixture();
    value.relay.current = event(HEAD_A);
    value.crypto.decrypted.set(HEAD_A, snapshot(1, ""));
    await expect(value.coordinator.pull()).resolves.toMatchObject({
      status: "applied",
      mode: "genesis",
      eventId: HEAD_A,
    });

    value.relay.current = event(HEAD_B, HEAD_A);
    value.crypto.decrypted.set(HEAD_B, snapshot(2, HEAD_A));
    await expect(value.coordinator.pull()).resolves.toMatchObject({
      status: "applied",
      mode: "child",
      eventId: HEAD_B,
    });
    expect(value.repository.state).toMatchObject({
      revision: 2,
      previous_event_id: HEAD_B,
    });
  });

  it("verifies a retained chain before applying a head several revisions ahead", async () => {
    const value = fixture(snapshot(1, HEAD_A));
    const middle = event(HEAD_B, HEAD_A);
    const current = event(HEAD_C, HEAD_B);
    value.relay.current = current;
    value.relay.recent = [current, middle];
    value.crypto.decrypted.set(HEAD_B, snapshot(2, HEAD_A));
    value.crypto.decrypted.set(HEAD_C, snapshot(3, HEAD_B));

    await expect(value.coordinator.pull()).resolves.toEqual({
      status: "applied",
      mode: "child",
      eventId: HEAD_C,
      revision: 3,
    });
    expect(value.relay.queryRecent).toHaveBeenCalledWith(8);
    expect(value.crypto.decryptEvent).toHaveBeenCalledTimes(2);
    expect(value.repository.applied).toHaveLength(1);
    expect(value.repository.state).toMatchObject({
      revision: 3,
      previous_event_id: HEAD_C,
    });
  });

  it("rejects a gap when the remembered predecessor is no longer retained", async () => {
    const value = fixture(snapshot(1, HEAD_A));
    const current = event(HEAD_C, HEAD_B);
    value.relay.current = current;
    value.relay.recent = [current];
    value.crypto.decrypted.set(HEAD_C, snapshot(3, HEAD_B));

    await expect(value.coordinator.pull()).rejects.toMatchObject({
      code: "revision-gap",
    });
    expect(value.repository.applied).toHaveLength(0);
  });

  it("treats the exact validated head as an idempotent no-op", async () => {
    const value = fixture(snapshot(2, HEAD_B));
    value.relay.current = event(HEAD_B, HEAD_A);
    value.crypto.decrypted.set(HEAD_B, snapshot(2, HEAD_A));

    await expect(value.coordinator.pull()).resolves.toEqual({
      status: "noop",
      eventId: HEAD_B,
      revision: 2,
    });
    expect(value.crypto.decryptEvent).toHaveBeenCalledOnce();
    expect(value.repository.applied).toHaveLength(0);
  });

  it.each([
    ["rollback", snapshot(3, HEAD_C), event(HEAD_A, ""), snapshot(1, "")],
    [
      "revision-gap",
      snapshot(1, HEAD_A),
      event(HEAD_B, HEAD_A),
      snapshot(3, HEAD_A),
    ],
    ["branch", snapshot(1, HEAD_A), event(HEAD_C, HEAD_B), snapshot(2, HEAD_B)],
  ] as const)(
    "rejects %s without a write",
    async (code, local, remote, decrypted) => {
      const value = fixture(local);
      value.relay.current = remote;
      value.crypto.decrypted.set(remote.id, decrypted);

      await expect(value.coordinator.pull()).rejects.toMatchObject({ code });
      expect(value.repository.applied).toHaveLength(0);
    }
  );

  it("rejects invalid decrypt before writing", async () => {
    const value = fixture();
    value.relay.current = event(HEAD_A);

    await expect(value.coordinator.pull()).rejects.toMatchObject({
      code: "invalid-remote",
    });
    expect(value.repository.applied).toHaveLength(0);
  });

  it.each(["wrong-key", "wrong-mint", "invalid-ciphertext"] as const)(
    "wraps %s crypto failures and never writes",
    async (failure) => {
      const repository = new FakeRepository();
      const wrongSecret = hexToBytes(
        "2222222222222222222222222222222222222222222222222222222222222222"
      );
      let remote: Event;
      if (failure === "wrong-key") {
        remote = createSyncEventV0(snapshot(1, ""), wrongSecret, {
          expectedMint: MINT,
        });
      } else if (failure === "wrong-mint") {
        remote = createSyncEventV0(
          { ...snapshot(1, ""), mint: "https://other-mint.example" },
          SECRET,
          { expectedMint: "https://other-mint.example" }
        );
      } else {
        const valid = createSyncEventV0(snapshot(1, ""), SECRET, {
          expectedMint: MINT,
        });
        remote = finalizeEvent(
          {
            kind: valid.kind,
            created_at: valid.created_at,
            tags: valid.tags,
            content: "not-a-nip44-payload",
          },
          SECRET
        );
      }
      const relay: SnapshotRelay = {
        queryCurrent: async () => remote,
        queryRecent: async () => [remote],
        publish: async () => ({ status: "accepted", reason: "unused" }),
      };
      const coordinator = new SnapshotSyncCoordinator({
        relay,
        repository,
        syncSecret: SECRET,
        configuredMint: MINT,
      });

      await expect(coordinator.pull()).rejects.toMatchObject({
        code: "invalid-remote",
      });
      expect(repository.applied).toHaveLength(0);
    }
  );

  it("allows an explicit pristine bootstrap to accept a pruned predecessor", async () => {
    const value = fixture();
    value.relay.current = event(HEAD_C, HEAD_B);
    value.crypto.decrypted.set(HEAD_C, snapshot(9, HEAD_B));

    await expect(
      value.coordinator.pull({ mode: "bootstrap" })
    ).resolves.toMatchObject({
      status: "applied",
      mode: "bootstrap",
      eventId: HEAD_C,
      revision: 9,
    });
    expect(value.repository.state.previous_event_id).toBe(HEAD_C);

    const notFresh = fixture(snapshot(2, HEAD_A));
    notFresh.relay.current = event(HEAD_C, HEAD_B);
    notFresh.crypto.decrypted.set(HEAD_C, snapshot(9, HEAD_B));
    await expect(
      notFresh.coordinator.pull({ mode: "bootstrap" })
    ).rejects.toMatchObject({ code: "invalid-local" });
  });

  it("does not trust nostr-tools cached verification on a mutated event", async () => {
    const repository = new FakeRepository();
    const remote = createSyncEventV0(snapshot(1, ""), SECRET, {
      expectedMint: MINT,
      createdAt: 1_780_000_400,
    });
    remote.created_at += 1;
    const relay: SnapshotRelay = {
      queryCurrent: async () => remote,
      queryRecent: async () => [remote],
      publish: async () => ({ status: "accepted", reason: "unused" }),
    };
    const coordinator = new SnapshotSyncCoordinator({
      relay,
      repository,
      syncSecret: SECRET,
      configuredMint: MINT,
    });

    await expect(coordinator.pull()).rejects.toMatchObject({
      code: "invalid-remote",
    });
    expect(repository.applied).toHaveLength(0);
  });
});

describe("SnapshotSyncCoordinator publish", () => {
  it("publishes revision+1 and advances only after accepted OK", async () => {
    const value = fixture(snapshot(4, HEAD_A));
    const apply = vi.spyOn(value.repository, "applySnapshot");
    const outcome = await value.coordinator.publishCurrent();

    expect(value.crypto.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 5, previous_event_id: HEAD_A })
    );
    expect(value.relay.publish).toHaveBeenCalledWith(value.crypto.created);
    expect(value.relay.publish.mock.invocationCallOrder[0]).toBeLessThan(
      apply.mock.invocationCallOrder[0]
    );
    expect(value.repository.applied).toEqual([
      {
        snapshot: expect.objectContaining({
          revision: 5,
          previous_event_id: HEAD_A,
        }),
        headEventId: HEAD_C,
      },
    ]);
    expect(outcome).toEqual({
      status: "accepted",
      resolution: "direct",
      eventId: HEAD_C,
      revision: 5,
    });
  });

  it("publishes an exact caller-built final candidate without rebuilding its state", async () => {
    const value = fixture(snapshot(4, HEAD_A));
    const candidate = snapshot(5, HEAD_A);
    candidate.history.push({
      id: "mint:quote-1",
      direction: "mint",
      quote: "quote-1",
      amount: 25,
      request: "lnbc1invoice",
      memo: "",
      date: "2026-08-13T00:00:00.000Z",
      status: "paid",
      mint: MINT,
      unit: "usd",
    });

    await expect(
      value.coordinator.publishCandidate(candidate)
    ).resolves.toEqual({
      status: "accepted",
      resolution: "direct",
      eventId: HEAD_C,
      revision: 5,
    });
    expect(value.crypto.createEvent).toHaveBeenCalledWith(candidate);
    expect(value.repository.applied[0]?.snapshot).toEqual(candidate);
  });

  it("can confirm an exact candidate without applying it for journal-owned finalization", async () => {
    const value = fixture(snapshot(4, HEAD_A));
    const candidate = snapshot(5, HEAD_A);

    await expect(
      value.coordinator.publishCandidate(candidate, { applyAccepted: false })
    ).resolves.toEqual({
      status: "accepted",
      resolution: "direct",
      eventId: HEAD_C,
      revision: 5,
    });
    expect(value.relay.publish).toHaveBeenCalledOnce();
    expect(value.repository.applied).toHaveLength(0);
    expect(value.repository.state).toEqual(snapshot(4, HEAD_A));
  });

  it("rejects a stale caller-built candidate before relay publication", async () => {
    const value = fixture(snapshot(4, HEAD_A));
    await expect(
      value.coordinator.publishCandidate(snapshot(6, HEAD_A))
    ).rejects.toMatchObject({ code: "invalid-local" });
    await expect(
      value.coordinator.publishCandidate(snapshot(5, HEAD_B))
    ).rejects.toMatchObject({ code: "invalid-local" });
    expect(value.relay.publish).not.toHaveBeenCalled();
    expect(value.repository.applied).toHaveLength(0);
  });

  it("validates the winner once on conflict without republishing or replacing local operation state", async () => {
    const local = snapshot(1, HEAD_A);
    local.counters = { "00c0ffee": 12 };
    local.proofs = [
      {
        id: "00c0ffee",
        amount: 5,
        secret: "reserved-input",
        C: "02" + "1".repeat(64),
        reserved: true,
        quote: "melt-quote-1",
      },
    ];
    local.pending_operation = {
      type: "melt",
      operation_id: "11111111-1111-4111-8111-111111111111",
      phase: "prepared",
      created_at: 1_780_000_000,
      updated_at: 1_780_000_001,
      prepared_request: {
        method: "bolt11",
        keyset_id: "00c0ffee",
        quote: {
          quote: "melt-quote-1",
          request: "lnbc1invoice",
          amount: "5",
          fee_reserve: "1",
          unit: "usd",
          state: "UNPAID",
          expiry: 1_780_001_000,
          payment_preimage: null,
        },
        request: {
          quote: "melt-quote-1",
          inputs: [
            {
              id: "00c0ffee",
              amount: "5",
              secret: "reserved-input",
              C: "02" + "1".repeat(64),
            },
          ],
          outputs: [],
          prefer_async: false,
        },
        output_data: [],
      },
      response: null,
    };
    const value = fixture(local);
    const before = JSON.stringify(value.repository.state);
    value.relay.publishResult = {
      status: "conflict",
      reason: "conflict: stale previous event",
    };
    value.relay.current = event(HEAD_B, HEAD_A);
    value.crypto.decrypted.set(HEAD_B, snapshot(2, HEAD_A));

    await expect(value.coordinator.publishCurrent()).resolves.toEqual({
      status: "conflict",
      currentEventId: HEAD_B,
      currentRevision: 2,
    });
    expect(value.relay.publish).toHaveBeenCalledOnce();
    expect(value.relay.queryCurrent).toHaveBeenCalledOnce();
    expect(value.crypto.decryptEvent).toHaveBeenCalledWith(value.relay.current);
    expect(value.repository.applied).toHaveLength(0);
    expect(JSON.stringify(value.repository.state)).toBe(before);
  });

  it("throws a typed relay rejection without applying", async () => {
    const value = fixture();
    value.relay.publishResult = {
      status: "rejected",
      category: "admission",
      reason: "restricted: not admitted",
    };

    await expect(value.coordinator.publishCurrent()).rejects.toMatchObject({
      code: "publish-rejected",
      category: "admission",
    });
    expect(value.repository.applied).toHaveLength(0);
  });

  it("confirms an ambiguous accepted candidate or leaves local untouched", async () => {
    const confirmed = fixture(snapshot(2, HEAD_A));
    confirmed.relay.publishResult = {
      status: "ambiguous",
      cause: "timeout",
    };
    confirmed.relay.current = event(HEAD_C, HEAD_A);
    await expect(confirmed.coordinator.publishCurrent()).resolves.toEqual({
      status: "accepted",
      resolution: "confirmed",
      eventId: HEAD_C,
      revision: 3,
    });
    expect(confirmed.repository.state.previous_event_id).toBe(HEAD_C);

    const unresolved = fixture(snapshot(2, HEAD_A));
    unresolved.relay.publishResult = {
      status: "ambiguous",
      cause: "disconnected",
    };
    unresolved.relay.current = event(HEAD_B, HEAD_A);
    unresolved.crypto.decrypted.set(HEAD_B, snapshot(3, HEAD_A));
    await expect(unresolved.coordinator.publishCurrent()).resolves.toEqual({
      status: "needs-reconciliation",
      cause: "disconnected",
      candidateEventId: HEAD_C,
      currentEventId: HEAD_B,
    });
    expect(unresolved.repository.applied).toHaveLength(0);
  });

  it("does not report success when the atomic local apply fails", async () => {
    const value = fixture();
    value.repository.applySnapshot = vi
      .fn()
      .mockRejectedValue(new Error("transaction rolled back"));

    await expect(value.coordinator.publishCurrent()).rejects.toMatchObject({
      code: "local-apply",
      acceptedEventId: HEAD_C,
    });
  });

  it("serializes concurrent calls on one coordinator", async () => {
    const value = fixture();
    let release!: (events: Event[]) => void;
    value.relay.queryRecent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const pull = value.coordinator.pull();
    const publish = value.coordinator.publishCurrent();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(value.relay.publish).not.toHaveBeenCalled();

    release([]);
    await pull;
    await publish;
    expect(value.relay.queryRecent.mock.invocationCallOrder[0]).toBeLessThan(
      value.relay.publish.mock.invocationCallOrder[0]
    );
  });
});

it("exports a stable typed error class", () => {
  const error = new SnapshotSyncCoordinatorError("rollback", "old event");
  expect(error).toMatchObject({
    name: "SnapshotSyncCoordinatorError",
    code: "rollback",
  });
});
