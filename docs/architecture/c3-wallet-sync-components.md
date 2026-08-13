# C3 — Wallet synchronization components

Status: **V0 accepted**

## Diagram

```mermaid
C4Component
  title C3 Components - Wallet pairing and synchronization

  Container_Boundary(walletClient, "Silent Link PWA Wallet") {
    Component(pairingService, "Pairing Service", "Application service", "Transfers full wallet and sync authority E2E")
    Component(syncCoordinator, "Sync Coordinator", "Application service", "Gates operations on fetch, reconcile, and CAS")
    Component(snapshotCodec, "Snapshot Codec", "Versioned TypeScript", "Validates and serializes the minimal wallet state")
    Component(syncCrypto, "Sync Crypto", "nostr-tools / NIP-44 v2", "Encrypts, signs, verifies, and decrypts snapshots")
    Component(localRepository, "Local Repository", "Dexie transaction", "Atomically imports state and persists journals")
  }

  Container_Ext(syncRelay, "CAS Nostr Relay", "Go / Khatru", "Stores opaque snapshot revisions")
  ContainerDb_Ext(localStore, "Local Wallet Store", "IndexedDB", "Device-local state and crash journal")
  System_Ext(nutshellMint, "Nutshell Mint", "Cashu mint", "Authoritative quotes and proof states")

  Rel(pairingService, syncCrypto, "Encrypts and verifies pairing payloads", "Cryptographic API")
  Rel(pairingService, syncCoordinator, "Starts initial synchronization", "In-process call")
  Rel(syncCoordinator, syncRelay, "Fetches head and publishes conditional child", "Nostr over WSS")
  Rel(syncCoordinator, snapshotCodec, "Validates snapshot schema", "Typed API")
  Rel(snapshotCodec, syncCrypto, "Encrypts or decrypts content", "NIP-44 v2")
  Rel(syncCoordinator, localRepository, "Applies or journals state", "In-process call")
  Rel(localRepository, localStore, "Commits atomically", "Dexie / IndexedDB")
  Rel(syncCoordinator, nutshellMint, "Reconciles pending operation and proofs", "Cashu NUT APIs")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Responsibilities

### Pairing Service

Uses explicit user approval and ephemeral pairing keys to transfer the mnemonic, random sync secret, configured mint, relay URL, and current head. It never puts secrets in the deeplink or relay plaintext.

### Sync Coordinator

Runs on startup, foreground resume, pairing, recovery, relay notification, and before mint/melt. It enforces the critical rule: no mint call occurs until the relay accepts the prepared pending-operation snapshot.

### Snapshot Codec

Serializes only the v0 schema—proofs, counters, quotes, accounting history, and one pending operation. It does not dump arbitrary localStorage or browser database contents.

### Sync Crypto

Uses a dedicated shared sync key, independent of social Nostr identity and Cashu proof derivation. It verifies the event and the agreement between outer `prev` and encrypted `previous_event_id` before state is applied.

### Local Repository

Applies a validated remote snapshot and its remembered head in one Dexie transaction. A crash cannot expose half-imported wallet state.

