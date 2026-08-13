# ADR-0001: Prefer an event-sourced UTXO-like state model

Status: **Deferred beyond v0**

This decision is retained as future exploration. V0 instead uses a revisioned encrypted snapshot with atomic compare-and-swap, as recorded in [ADR-0002](./0002-v0-revisioned-snapshot.md).

## Context

Cashu Sync must support several authorized PWA and CLI wallet installations controlled by one user. User-initiated writes are expected to be sequential in normal use, but any installation may begin from stale state after being offline or after another wallet changes the shared state.

Two models were considered:

1. A Git-like linear log in which every commit names one global current head and storage performs compare-and-swap.
2. An event-sourced object graph in which transitions consume specific prior objects and create replacement objects, resembling UTXO state.

The mint is already the authority for proof spendability. The critical safety goal is not perfect agreement about history; it is ensuring that an unspent proof cannot disappear irrecoverably from every wallet projection.

## Decision

Use an encrypted event-sourced object graph with UTXO-like local dependencies. Do not require every operation to extend one global linear head.

Each operation still begins by synchronizing and validating the latest known event set. This is optimistic concurrency: devices act without a global lock, but stale assumptions are detected through consumed-object conflicts and mint reconciliation.

Periodic checkpoints compact the graph and provide a new reconstruction root.

## Important clarification

The event graph does **not** make forks impossible.

It changes the meaning and scope of a fork:

- Two events that consume disjoint objects are independent and both remain valid.
- Two events that consume the same object form a localized conflict set.
- A relay returning different subsets can still create incomplete projections.
- A malicious relay can still return an older, internally valid checkpoint.

The model avoids unnecessary wallet-wide forks. It resolves real conflicts rather than preventing them through a global sequencer.

## Options considered

### Option A: Global linear head with compare-and-swap

Every commit carries `expected_head`. Storage accepts it only when it matches the current head.

Advantages:

- Simple mental model and implementation.
- Lost updates are rejected immediately.
- Straightforward snapshotting and garbage collection.
- One canonical order makes projection deterministic.

Disadvantages:

- Independent operations conflict even when they touch disjoint proofs.
- Requires an online authoritative sequencer for progress.
- A stable wallet head or namespace makes activity easier to link.
- A mint-integrated compare-and-swap strongly associates sync and Cashu operations.
- Availability of the sequencer becomes availability of writes.

This remains a useful implementation model for a privacy-relaxed deployment, but is not the preferred protocol model.

### Option B: Event-sourced UTXO-like graph

Each transition consumes explicit state object IDs and creates new objects.

Advantages:

- Independent operations commute naturally.
- Conflicts are scoped to the proofs or objects actually reused.
- No mandatory global ordering service.
- Better fit with Cashu's bearer-proof model.
- Devices can rebuild state from retained encrypted history.
- Relay ordering is not trusted.

Disadvantages:

- More complex projection and reconciliation.
- Event history grows until checkpointed.
- Double-consumption conflicts are detected after publication rather than prevented globally.
- Correct object granularity is important.
- Completeness is harder to prove when a relay omits events.
- Garbage collection requires self-contained checkpoints.

### Option C: Replaceable encrypted snapshot only

Each device publishes the complete latest wallet snapshot.

Advantages:

- Lowest implementation complexity.
- Fast startup and recovery.
- Easy expiration.

Disadvantages:

- Last-writer-wins can silently remove proofs created by another device.
- Concurrent or stale snapshots are difficult to merge safely.
- No durable intent exists for recovering interrupted mint operations.
- Relay rollback is difficult to distinguish from legitimate old state.

This is rejected as the sole source of sync state. Snapshots remain useful as checkpoints over the event graph.

## Projection model

Let `Created(E)` be the state objects created by accepted events and `Consumed(E)` the object IDs consumed by accepted events.

The structural candidate set is:

```text
Candidates = Created(E) - Consumed(E)
```

The spendable set is not derived from events alone:

```text
Spendable = { p in Candidates | mint_state(p) == UNSPENT }
```

Clients do not need to query every proof before every UI read. They query proofs relevant to a mint or melt operation, unresolved conflict, pending intent, or recovery. Cached mint state is explicitly a projection, not final truth.

## Conflict resolution

When two transitions consume the same state object:

1. Validate both authors and payloads.
2. Locate their intents and exact mint requests.
3. Replay cached responses when NUT-19 is available.
4. Check the underlying proof states through NUT-07.
5. Restore deterministic outputs through NUT-09/NUT-13 when necessary.
6. Keep every unspent output recovered from either transition.
7. Mark losing or impossible transitions resolved in the next checkpoint.

Timestamp order is not a valid conflict resolver.

## Fault-tolerance consequence

Mint and relay writes do not need distributed atomicity. The recovery boundary is instead:

```text
durable intent → recoverable mint request → durable commit
```

An operation is safe if a future device can determine whether the mint consumed the inputs and can rediscover every corresponding unspent output.

## Privacy consequence

Avoiding a global compare-and-swap head removes one obvious stable serialization point, but does not provide full unlinkability. Stable device pubkeys, timing, relay access, checkpoints, and causal references still leak metadata.

Sync writes should remain decoupled from Cashu HTTP requests, and deployments may use batching, delay, or independent relays.

## Garbage collection

Every checkpoint is a self-contained projection plus unresolved intents and the event frontier it covers. After a checkpoint is replicated and validated:

- covered events may expire;
- the checkpoint becomes the reconstruction root for its epoch;
- new events refer to objects in the checkpoint or events after it;
- full mnemonic recovery remains available if all sync data expires.

## Consequences

- The protocol needs a deterministic projection algorithm.
- Event and object IDs must have canonical encodings.
- Counter reservations must be visible before mint execution or otherwise safely recoverable.
- Checkpoints need an explicit completeness/frontier representation.
- Tests must include omitted, duplicated, reordered, and conflicting events.
