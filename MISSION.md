# Mission: Understand Cashu Sync v0

## Why

Be able to explain, debug, and safely extend the repo-specific protocol that
turns one Cashu wallet into a synchronized set of paired PWAs.

## Success looks like

- Trace a mint or melt from the PWA through the pending journal, relay CAS, and Nutshell recovery path.
- Explain which NIPs and NUTs are part of the v0 contract and which inherited wallet features are out of scope.
- State exactly what the relay, mint, browser, and paired devices can and cannot learn or do.
- Identify whether a proposed change threatens money safety, synchronization safety, or metadata privacy.

## Constraints

- Teach from the implementation and normative v0 docs, not from generic Cashu or Nostr introductions.
- Prefer short, code-linked lessons with retrieval practice.

## Out of scope

- Cashu and Nostr basics.
- Peer-to-peer ecash, multiple mints, alternate Lightning rails, and the inherited Cashu.me feature surface unless a later lesson needs them.
