# Cashu Sync roadmap

This file separates agreed v0 scope from ideas that need later validation.

## V0 — implement now

- Cashu.me-derived phone PWA with Silent Link branding.
- One configured Nutshell mint.
- Mint and melt only.
- Full-authority QR/deeplink pairing.
- Random shared sync secret.
- NIP-44-encrypted whole-wallet snapshot.
- Minimal Nostr-compatible relay with SQLite CAS.
- One durable pending-operation slot.
- Seed and encrypted full-recovery exports.
- GitHub Pages-compatible static PWA build when security and routing constraints permit.

## V0.x — hardening after the first end-to-end version

- Remove or compile out inherited Cashu.me features outside product scope.
- Upgrade and triage inherited dependency vulnerabilities.
- Replace plaintext mnemonic browser storage with the strongest practical local protection.
- Strict CSP and controlled service-worker update flow.
- Automated backup/restore drills and production monitoring.
- Formal snapshot schema fixtures for a future CLI.

## Future exploration

- CLI client using the same snapshot schema.
- Per-device sync keys, authorization, revocation, and roles.
- Multiple or independently operated relays.
- PostgreSQL-backed relay replication.
- NIP-60 interoperability.
- Event-sourced or per-proof state for concurrent disjoint operations.
- Multiple mints.
- Peer-to-peer Cashu send/receive and user-visible swaps.
- Metadata obfuscation, batching, and separate network paths.
- Hardware-backed key storage and least-authority paired devices.

These are not v0 compatibility requirements. Any promotion requires a new ADR, security analysis, and tests.

