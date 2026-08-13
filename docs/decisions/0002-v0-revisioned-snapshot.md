# ADR-0002: Use a revisioned encrypted snapshot for v0

Status: **Accepted**

## Context

V0 needs safe synchronization between multiple fully authorized wallets, but supports only one Nutshell mint and mint/melt operations. The earlier UTXO-like event graph adds conflict projection, checkpoints, compaction, and multi-relay questions that do not help the first implementation enough to justify their risk.

An ordinary Nostr addressable event is also insufficient. NIP-01 replacement is timestamp-based last-write-wins; it cannot atomically assert that the writer built on the current event.

## Decision

Use a complete NIP-44-encrypted snapshot with:

- an integer revision inside the ciphertext;
- a public `prev` event-ID tag;
- one encrypted pending-operation journal slot;
- atomic head advancement enforced by the relay in SQLite.

All paired wallets share the Cashu master seed and a random dedicated sync signing/encryption secret. Exactly one child of a snapshot head is accepted.

There is no time-based lease. A pending operation remains until a wallet reconciles it with the mint.

## Consequences

- V0 state and recovery behavior are straightforward to test.
- Concurrent attempts are serialized before the mint is contacted.
- Whole snapshots are larger than granular events but acceptable for the v0 wallet size.
- The custom relay is not a completely generic Nostr relay; it adds one atomic CAS rule.
- Relay availability gates new operations.
- Snapshot merging, concurrent disjoint operations, per-device attribution, and replicated relays are deferred.

## Replaced v0 design

[ADR-0001](./0001-event-sourced-state.md) and the [event-sourced design](../explorations/event-sourced-multiwriter.md) remain research inputs for later versions, not normative v0 behavior.

