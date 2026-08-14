# Cashu Sync v0

Status: implemented v0 product and protocol boundary.

Cashu Sync lets one user control the same Silent Link wallet from paired PWA installations. V0 is deliberately narrow: one configured USD Nutshell mint, Bolt11 mint and melt accounting only, one encrypted whole-wallet snapshot, and one purpose-built Silent Link-operated Nostr relay that atomically advances the snapshot head. There is no peer-to-peer payment path.

## Normative v0 documents

- [V0 protocol specification](./spec.md)
- [C1 — System context](./architecture/c1-system-context.md)
- [C2 — Containers](./architecture/c2-containers.md)
- [C3 — Wallet synchronization components](./architecture/c3-wallet-sync-components.md)
- [C3 — Mint/melt safety components](./architecture/c3-operation-safety-components.md)
- [ADR-0002 — Revisioned encrypted snapshots](./decisions/0002-v0-revisioned-snapshot.md)
- [Wallet base evaluation](./research/wallet-base.md)
- [Nutshell reference mint](./research/nutshell-reference.md)
- [Local two-wallet and recovery tutorial](./tutorial.md)

## V0 in one minute

1. A configured Silent Link PWA creates a twelve-word Cashu master seed and a random dedicated sync secret.
2. An existing PWA displays one QR containing only an ephemeral key, challenge, pairing ID, short expiry, and the separate pairing relay URL. The new PWA scans it once; NIP-17/NIP-59 messages exchange the encrypted authority and ACK automatically.
3. Paired wallets communicate directly with one configured USD [Nutshell](https://github.com/cashubtc/nutshell) mint through Bolt11 quote, mint, melt, proof-state, and operation-recovery APIs.
4. Wallets sign and NIP-44-encrypt a complete revisioned snapshot locally, then publish it to the Silent Link relay.
5. The relay stores opaque events and atomically accepts a new snapshot only when its `prev` tag names the current head.
6. Before contacting the mint, a wallet must first reserve the single pending-operation slot through a successful relay compare-and-swap. A losing concurrent wallet makes no mint call.
7. The user can export a passphrase-encrypted full-recovery bundle containing the mnemonic, sync secret, configured endpoints, schema, and remembered relay head. A fresh PWA imports it and then pulls the encrypted snapshot from the relay.

## Explicit v0 exclusions

- peer-to-peer Cashu send or receive;
- Cashu token import, export, redeem, P2PK, payment requests, or Nostr peer flows;
- Bolt12, on-chain, LNURL, Lightning-address, multi-part, or batch-mint flows;
- user-visible proof swaps;
- more than one mint;
- snapshot merging or a multiwriter event graph;
- multi-relay replication;
- device roles or revocation;
- CLI implementation (the wire format must remain CLI-compatible);
- server-side decryption or balance calculation.

## Future work

Deferred ideas and their original rationale live in [the roadmap](./roadmap.md) and [the event-sourced multiwriter exploration](./explorations/event-sourced-multiwriter.md). [ADR-0001](./decisions/0001-event-sourced-state.md) is retained as a deferred design, not as v0 behavior.
