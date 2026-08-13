# C1 — System context

Status: **V0 implemented**

## Diagram

```mermaid
C4Context
  title C1 System Context - Cashu Sync v0

  Person(walletUser, "Silent Link Wallet User", "One user controlling paired PWA wallet installations")

  System(cashuSync, "Silent Link Cashu Sync", "Paired PWA wallets plus the Silent Link-operated encrypted CAS relay")
  System_Ext(nutshellMint, "USD Nutshell Mint", "Issues proofs, executes Bolt11 melts, and reports monetary state")

  Rel(walletUser, cashuSync, "Mints, melts, pairs wallet installations, and manages recovery", "PWA UI")
  Rel(cashuSync, nutshellMint, "Mints and melts value, checks and restores proofs", "Cashu NUT APIs over HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Scope

One user controls paired Silent Link PWA wallet installations. Silent Link owns and operates the purpose-built sync relay, so both the PWA and relay are inside the Cashu Sync system boundary. A future CLI is roadmap exploration rather than a v0 client.

The wallet has two network relationships:

- **USD Nutshell mint:** the monetary authority and only recipient of plaintext proof-bearing Bolt11 mint/melt requests.
- **Silent Link-operated relay:** the purpose-built synchronization coordinator, which sees signed encrypted Nostr envelopes but cannot decrypt wallet state.

V0 supports Bolt11 USD mint, melt, balance, and accounting only. It has no peer-to-peer Cashu or peer-payment relationship.

## Recovery

The wallet lets the user export a passphrase-encrypted full-recovery bundle containing the twelve-word BIP39 mnemonic, random sync secret, authority endpoints, schema, and remembered head. A fresh PWA uses that authority to fetch the latest encrypted snapshot from the relay; the bundle does not contain a second copy of the snapshot.

## Trust boundary

Wallet clients create, sign, encrypt, decrypt, validate, and apply snapshots locally. The relay controls the current encrypted head but cannot determine the balance or modify a valid snapshot. Nutshell remains authoritative for quotes and proof state.
