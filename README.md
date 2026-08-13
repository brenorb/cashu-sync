# Cashu Sync

Cashu Sync is a phone-first Silent Link wallet for one user controlling paired PWA installations. V0 keeps one wallet synchronized through a purpose-built Silent Link-operated Nostr relay while Nutshell remains authoritative for money.

The implemented product boundary is intentionally small:

- exactly one configured USD Nutshell authority mint;
- Bolt11 mint, melt, balance, and accounting only;
- two-QR full-authority pairing between the user's own PWA wallets;
- NIP-44-encrypted full snapshots with SQLite compare-and-swap at the relay;
- one durable pending-operation journal that fences mint and melt submission;
- passphrase-encrypted full recovery into a fresh wallet;
- no peer-to-peer Cashu, token import/export, alternate payment rails, mint switching, or multi-mint behavior.

Start with the [v0 documentation index](./docs/README.md), read the [normative specification](./docs/spec.md), or follow the [complete local tutorial](./docs/tutorial.md) to run Nutshell and the relay, pair two browser profiles, mint, synchronize, melt, and recover from scratch.

The three code areas are:

- [`wallet/`](./wallet/README.md): Vue/Quasar PWA;
- [`relay/`](./relay/README.md): Go/Khatru/SQLite CAS relay;
- [`integration/nutshell/`](./docs/research/nutshell-reference.md): pinned local Nutshell `0.20.3` USD fixture.

Future product ideas and deployment gaps belong in the [roadmap](./docs/roadmap.md), not in the v0 compatibility contract.
