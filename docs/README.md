# Cashu Sync design documents

Status: early design, not an implementation specification.

Cashu Sync is an encrypted, recoverable, multi-client state layer built into white-label Silent Link wallets. A user may control multiple PWA and CLI wallet installations that share one logical Cashu state. The design favors bearer-asset privacy and recoverability over strict coupling between sync writes and mint operations.

## Documents

- [Protocol specification](./spec.md): goals, invariants, state model, operation flows, recovery, privacy, and open questions.
- [C1 — System context](./architecture/c1-system-context.md): the user-controlled wallet clients, mint/melt accounting, sync-relay relationship, and recovery backup.
- [C2 — Containers](./architecture/c2-containers.md): representative PWA and CLI instances, their local stores, and the relay infrastructure.
- [C3 — Wallet synchronization components](./architecture/c3-wallet-sync-components.md): encrypted event retrieval, validation, projection, and publication.
- [C3 — Cashu operation safety components](./architecture/c3-operation-safety-components.md): proof reconciliation, durable intent, mint interaction, and recovery.
- [ADR-0001 — Event-sourced state model](./decisions/0001-event-sourced-state.md): comparison between a global linear head and a UTXO-like event graph.

## Current design position

The current proposal is:

1. Cashu Sync is **multiwriter with optimistic concurrency**.
2. Every authorized device may write, but every operation begins by fetching, reconstructing, and validating the latest known state.
3. The state is an encrypted event set with UTXO-like local dependencies, not a single mandatory global branch.
4. The mint is the source of truth for proof spendability.
5. A stale spent proof is recoverable inconsistency; omission of an unspent proof is the critical failure to prevent.
6. Mint operations and sync publication are not required to be atomic. Deterministic outputs, durable intents, replay, restore, and reconciliation provide fault tolerance.
7. Sync traffic should not be attached directly to Cashu HTTP requests. Privacy and obfuscation are preferred over perfect sync consistency.
8. Periodic encrypted checkpoints compact the event history. Sync records may expire after six months if devices republish a fresh checkpoint before expiry.
9. Pairing follows Nostr Wallet Connect ideas: dedicated per-device keys, no social identity, QR/deeplink transport, and E2E transfer of wallet capabilities.
10. Wallet clients encrypt and sign events locally; the relay and database retain only opaque events and never calculate wallet state.
11. The user can explicitly export or download the BIP39 master-seed backup through a wallet client and import it to restore the wallet after device loss.
12. The product supports mint and melt accounting only. Peer-to-peer Cashu send, receive, and swap flows are outside the first-version scope.

## Status vocabulary

- **Proposed**: current preferred design, still subject to experiments.
- **Required**: intended protocol invariant if the proposal is adopted.
- **Optional**: interoperable behavior that implementations may omit.
- **Open**: unresolved and deliberately not fixed by these documents.
