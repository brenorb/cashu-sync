# Cashu Sync roadmap

This file separates the implemented v0 boundary from later hardening and exploration. Deferred items are not v0 compatibility requirements.

## V0 — implemented boundary

- Cashu.me-derived phone PWA with Silent Link branding.
- Exactly one configured USD Nutshell authority mint.
- Bolt11 mint, melt, balance, and accounting only.
- Full-authority two-QR pairing: ephemeral request QR, then encrypted response QR.
- Random shared sync secret.
- NIP-44-encrypted whole-wallet snapshot.
- Purpose-built Silent Link-operated Nostr relay with SQLite compare-and-swap.
- One durable pending-operation journal slot that fences mint and melt requests.
- Passphrase-encrypted full-recovery bundle and fresh-wallet restore.
- Hash-routed GitHub Pages-compatible static PWA build.
- No peer-to-peer Cashu, alternate payment rails, multiple mints, MPP, or NUT-29 batch minting.

## V0.x — hardening after the first end-to-end version

- Remove or compile out inherited Cashu.me features outside product scope.
- Upgrade and triage inherited dependency vulnerabilities.
- Replace plaintext mnemonic browser storage with the strongest practical local protection.
- Strict CSP and controlled service-worker update flow.
- Automated backup/restore drills and production monitoring.
- Formal snapshot schema fixtures for a future CLI.
- Production Pages build-time endpoint configuration and an operator workflow for enrolling a newly generated sync pubkey in the relay allowlist.
- Optional NUT-17 notification handling; the v0 wallet now keeps a relay-head WebSocket subscription while open, with startup, reconnect, foreground, and pre-operation pulls as the correctness path.
- User-facing mnemonic-only NUT-13/NUT-09/NUT-07 recovery and a deliberate standalone mnemonic export.
- Camera scanning for the two displayed pairing QRs; the v0 PWA currently imports their canonical payloads through paste fields.

## Future exploration

- CLI client using the same snapshot schema.
- Per-device sync keys, authorization, revocation, and roles.
- Multiple or independently operated relays.
- PostgreSQL-backed relay replication.
- NIP-60 interoperability.
- Event-sourced or per-proof state for concurrent disjoint operations.
- Multiple mints.
- Peer-to-peer Cashu send/receive and user-visible swaps.
- Bolt12, on-chain, LNURL, Lightning-address, multi-part payments, and NUT-29 batch minting.
- Metadata obfuscation, batching, and separate network paths.
- Hardware-backed key storage and least-authority paired devices.

Any promotion requires a new ADR, security analysis, and tests.
