# C2 — Containers

Status: **V0 implemented**

## Diagram

```mermaid
C4Container
  title C2 Containers - Cashu Sync v0

  Person(walletUser, "Silent Link Wallet User", "One user controlling paired PWA wallet installations")

  System_Boundary(cashuSync, "Silent Link Cashu Sync") {
    Container(walletA, "Wallet A", "Cashu.me-derived Vue/Quasar PWA", "Runs Cashu, pairing, sync, and recovery")
    ContainerDb(storeA, "Wallet A Store", "Dexie / IndexedDB", "Stores local state and crash journal")
    Container(walletB, "Wallet B", "Cashu.me-derived Vue/Quasar PWA", "Equal-authority paired installation")
    ContainerDb(storeB, "Wallet B Store", "Dexie / IndexedDB", "Stores local state and crash journal")
    Container(nostrRelay, "Silent Link CAS Relay", "Go / Khatru", "Authenticates clients and atomically advances snapshot heads")
    ContainerDb(relayStore, "Relay Store", "SQLite", "Stores opaque events and current-head pointers")
  }

  System_Ext(nutshellMint, "USD Nutshell Mint", "Cashu authority for Bolt11 mint, melt, proof state, and restore")

  Rel(walletUser, walletA, "Operates and manages pairing or backup", "PWA UI")
  Rel(walletUser, walletB, "Operates and manages pairing or backup", "PWA UI")
  Rel(walletA, storeA, "Persists snapshots and operation journal", "IndexedDB API")
  Rel(walletB, storeB, "Persists snapshots and operation journal", "IndexedDB API")
  Rel(walletA, nostrRelay, "Fetches head and conditionally publishes child", "NIP-01/42/44/78 over WSS")
  Rel(walletB, nostrRelay, "Fetches head and conditionally publishes child", "NIP-01/42/44/78 over WSS")
  Rel(nostrRelay, relayStore, "Atomically stores event and advances head", "SQLite transaction")
  Rel(walletA, nutshellMint, "Mints, melts, checks, and restores", "Cashu NUT APIs over HTTPS")
  Rel(walletB, nutshellMint, "Mints, melts, checks, and restores", "Cashu NUT APIs over HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Wallet containers

Wallet A and Wallet B are representative deployed copies of the same PWA, controlled by one user. Both hold the Cashu seed and dedicated sync secret, so both have equal authority. There is no peer-to-peer transfer between them: they synchronize one wallet.

Before a mint or melt, a wallet:

1. fetches and atomically imports the current encrypted snapshot;
2. resumes any pending operation through Nutshell quote and exact-output recovery calls;
3. writes a prepared pending operation locally;
4. conditionally publishes it as a child of the relay head;
5. contacts Nutshell only after relay acceptance;
6. persists the response locally and publishes the completed snapshot.

The local IndexedDB store is a cache and crash journal, not the only backup.

## Relay containers

The purpose-built, Silent Link-operated Go relay reuses Nostr WebSocket, signature, subscription, and NIP-42 behavior. Its wallet-specific responsibilities are production admission from a startup-loaded sync-pubkey allowlist and atomic compare-and-swap: the incoming `prev` event ID must equal the SQLite head. Paired wallets share one admitted sync key. Open admission exists only for loopback-bound local end-to-end tests.

The relay does not decrypt snapshots, calculate balances, reconcile proofs, or call Nutshell. V0 runs one relay process with one persistent SQLite volume. GitHub Pages hosts only the static PWA, never this stateful service.

## Deployment note

A future CLI is another Wallet container using the same encrypted schema and relay protocol. It is not part of the first v0 implementation.
