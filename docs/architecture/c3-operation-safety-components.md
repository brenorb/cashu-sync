# C3 — Mint/melt safety components

Status: **V0 implemented**

## Diagram

```mermaid
C4Component
  title C3 Components - One-user recoverable USD Bolt11 mint and melt operations

  Container_Boundary(walletClient, "Silent Link PWA Wallet") {
    Component(operationCoordinator, "Operation Coordinator", "Application service", "Runs prepare, reserve, execute, and finalize phases")
    Component(operationJournal, "Pending Operation Journal", "State machine", "Stores one durable recoverable operation")
    Component(relayGateway, "Relay Gateway", "Nostr client", "Reserves or finalizes the operation slot with CAS")
    Component(mintGateway, "Nutshell Gateway", "cashu-ts", "Executes mint/melt and reconciles uncertain results")
  }

  ContainerDb_Ext(localStore, "Local Wallet Store", "IndexedDB", "Persists requests, responses, proofs, and counters")
  Container_Ext(syncRelay, "Silent Link-operated CAS Nostr Relay", "Go / Khatru", "Rejects stale snapshot children")
  System_Ext(nutshellMint, "USD Nutshell Mint", "Cashu mint", "Executes Bolt11 operations and decides monetary state")

  Rel(operationCoordinator, operationJournal, "Creates and advances operation state", "In-process call")
  Rel(operationJournal, localStore, "Persists before network boundaries", "Dexie transaction")
  Rel(operationCoordinator, relayGateway, "Reserves or clears operation slot", "In-process call")
  Rel(relayGateway, syncRelay, "Conditionally advances snapshot head", "Nostr EVENT/OK over WSS")
  Rel(operationCoordinator, mintGateway, "Executes only after reservation succeeds", "In-process call")
  Rel(mintGateway, nutshellMint, "Mints, melts, queries, and restores", "Cashu NUT APIs over HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Safety boundary

The relay and Nutshell do not participate in a distributed transaction. Safety comes from order and recoverability:

```text
local prepared journal
  → accepted pending-operation snapshot
  → exact Nutshell request
  → local durable response/outputs
  → accepted completed snapshot
```

A relay conflict before the Nutshell request is a clean retry. A crash or conflict after the request requires reconciliation; the wallet preserves all request, counter, response, and proof material until the result is known.

An unresolved operation does not expire automatically and blocks a new operation across paired wallets. The next wallet uses quote state, plus the already journaled wallet-side NUT-13 material and mint-side NUT-09 restoration for exact prepared mint outputs, to finish or safely clear it. The reference profile's one-hour NUT-19 cache permits exact-request replay but is not a durable source of truth after expiry.

Both PWA installations belong to one user and operate one wallet. The journal coordinates those installations; it is not a peer-to-peer send or receive protocol.
