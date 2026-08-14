# C3 — Wallet synchronization components

Status: **V0 implemented**

## Diagram

```mermaid
C4Component
  title C3 Components - One-user wallet pairing and synchronization

  Container_Boundary(walletClient, "Silent Link PWA Wallet") {
    Component(pairingService, "Automatic Pairing Service", "Application service", "Transfers wallet authority after one public QR scan")
    Component(syncCoordinator, "Sync Coordinator", "Application service", "Gates operations on fetch, reconcile, and CAS")
    Component(snapshotCodec, "Snapshot Codec", "Versioned TypeScript", "Validates and serializes the minimal wallet state")
    Component(syncCrypto, "Sync Crypto", "nostr-tools / NIP-44 v2", "Encrypts, signs, verifies, and decrypts snapshots")
    Component(localRepository, "Local Repository", "Dexie transaction", "Atomically imports state and persists journals")
  }

  Container_Ext(syncRelay, "Silent Link-operated CAS Nostr Relay", "Go / Khatru", "Stores opaque snapshot revisions")
  Container_Ext(pairingRelay, "Separate Pairing Nostr Relay", "Go / Khatru", "Stores short-lived gift-wrap messages")
  ContainerDb_Ext(localStore, "Local Wallet Store", "IndexedDB", "Device-local state and crash journal")
  System_Ext(nutshellMint, "USD Nutshell Mint", "Cashu mint", "Authoritative Bolt11 quotes and proof states")

  Rel(pairingService, syncCrypto, "Encrypts and verifies pairing payloads", "Cryptographic API")
  Rel(pairingService, pairingRelay, "Exchanges NIP-17/NIP-59 gift wraps", "Nostr over WSS")
  Rel(pairingService, syncCoordinator, "Starts initial synchronization", "In-process call")
  Rel(syncCoordinator, syncRelay, "Fetches head and publishes conditional child", "Nostr over WSS")
  Rel(syncCoordinator, syncCrypto, "Creates or decrypts signed snapshot events", "Typed API")
  Rel(syncCrypto, snapshotCodec, "Validates and canonically serializes state", "Typed API")
  Rel(syncCoordinator, localRepository, "Applies or journals state", "In-process call")
  Rel(localRepository, localStore, "Commits atomically", "Dexie / IndexedDB")
  Rel(syncCoordinator, nutshellMint, "Reconciles pending operation and proofs", "Cashu NUT APIs")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Responsibilities

### Pairing Service

For one user controlling paired PWA wallets, one QR carries only an ephemeral request key, pairing ID, challenge, three-minute expiry, and separate pairing-relay URL. The new wallet automatically sends a NIP-17/NIP-59 request; the authority travels only inside a NIP-44 encrypted response and the new wallet ACKs after import and sync. V0 has no peer-to-peer payment path.

### Sync Coordinator

Runs on startup, foreground resume, pairing, recovery, and before Bolt11 mint/melt. It enforces the critical rule: no state-changing mint call occurs until the relay accepts the prepared pending-operation snapshot.

### Snapshot Codec

Serializes only the v0 schema—proofs, counters, quotes, accounting history, and one pending operation. It does not dump arbitrary localStorage or browser database contents.

### Sync Crypto

Uses a dedicated shared sync key, independent of social Nostr identity and Cashu proof derivation. It verifies the event and the agreement between outer `prev` and encrypted `previous_event_id` before state is applied.

### Local Repository

Applies a validated remote snapshot and its remembered head in one Dexie transaction. A crash cannot expose half-imported wallet state.
