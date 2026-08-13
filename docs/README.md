# Cashu Sync v0 design documents

Status: implementation-ready v0 specification.

Cashu Sync lets one user operate the same Silent Link Cashu wallet from multiple paired clients. V0 is deliberately narrow: one USD Nutshell mint, mint and melt only, one encrypted whole-wallet snapshot, and one minimal Nostr-compatible relay that atomically advances the snapshot head.

## Normative v0 documents

- [V0 protocol specification](./spec.md)
- [C1 — System context](./architecture/c1-system-context.md)
- [C2 — Containers](./architecture/c2-containers.md)
- [C3 — Wallet synchronization components](./architecture/c3-wallet-sync-components.md)
- [C3 — Mint/melt safety components](./architecture/c3-operation-safety-components.md)
- [ADR-0002 — Revisioned encrypted snapshots](./decisions/0002-v0-revisioned-snapshot.md)
- [Wallet base evaluation](./research/wallet-base.md)
- [Nutshell reference mint](./research/nutshell-reference.md)

## V0 in one minute

1. The first Silent Link PWA creates or imports a Cashu master seed and a random dedicated sync secret.
2. An existing wallet pairs another wallet through an end-to-end encrypted QR/deeplink flow. Every paired wallet receives full seed and sync authority.
3. Wallets communicate directly with one configured USD [Nutshell](https://github.com/cashubtc/nutshell) mint for mint, melt, proof-state, and restore operations.
4. Wallets sign and NIP-44-encrypt a complete revisioned snapshot locally, then publish it to the Silent Link relay.
5. The relay stores opaque events and atomically accepts a new snapshot only when its `prev` tag names the current head.
6. Before contacting the mint, a wallet must first reserve the single pending-operation slot through a successful relay compare-and-swap. A losing concurrent wallet makes no mint call.
7. The user can export an encrypted full-recovery bundle. The twelve-word seed alone remains a funds-recovery fallback, but cannot recover a random sync secret or synchronized history.

## Explicit v0 exclusions

- peer-to-peer Cashu send or receive;
- user-visible proof swaps;
- more than one mint;
- snapshot merging or a multiwriter event graph;
- multi-relay replication;
- device roles or revocation;
- CLI implementation (the wire format must remain CLI-compatible);
- server-side decryption or balance calculation.

## Future work

Deferred ideas and their original rationale live in [the roadmap](./roadmap.md) and [the event-sourced multiwriter exploration](./explorations/event-sourced-multiwriter.md). [ADR-0001](./decisions/0001-event-sourced-state.md) is retained as a deferred design, not as v0 behavior.
