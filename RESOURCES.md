# Cashu Sync v0 Resources

## Knowledge

- [Cashu Sync v0 specification](./docs/spec.md)
  Normative local contract: trust boundaries, snapshot schema, CAS, operation journal, recovery, and explicit exclusions.
- [C3 wallet synchronization components](./docs/architecture/c3-wallet-sync-components.md)
  Best local map of pairing, sync coordination, snapshot validation, crypto, and atomic IndexedDB application.
- [C3 mint/melt safety components](./docs/architecture/c3-operation-safety-components.md)
  Best local explanation of the durable-intent → mint request → durable-commit boundary.
- [NIP-01 — Basic protocol flow](https://github.com/nostr-protocol/nips/blob/master/01.md)
  Event IDs, signatures, tags, and relay messages used by the custom relay.
- [NIP-42 — Authentication of clients to relays](https://github.com/nostr-protocol/nips/blob/master/42.md)
  The challenge/event handshake used to authenticate the dedicated sync key.
- [NIP-44 — Encrypted payloads](https://github.com/nostr-protocol/nips/blob/master/44.md)
  The v2 authenticated encryption format used for snapshots and the formal pairing response.
- [NIP-78 — Arbitrary custom app data](https://github.com/nostr-protocol/nips/blob/master/78.md)
  Why kind `30078` plus a `d` tag is a reasonable Nostr envelope for opaque app state, while the CAS rule remains custom.
- [Cashu NUT-04 — Minting](https://github.com/cashubtc/nuts/blob/main/04.md) and [NUT-05 — Melting](https://github.com/cashubtc/nuts/blob/main/05.md)
  The only state-changing monetary rails enabled by v0: Bolt11/USD mint and melt.
- [Cashu NUT-07 — Checking proof states](https://github.com/cashubtc/nuts/blob/main/07.md)
  Mint-side truth used for reconciliation and recovery checks.
- [Cashu NUT-09 — Restore signatures](https://github.com/cashubtc/nuts/blob/main/09.md)
  Exact-output recovery for a mint request whose response was lost.
- [Cashu NUT-13 — Deterministic secrets](https://github.com/cashubtc/nuts/blob/main/13.md)
  Wallet-side derivation and persistent keyset counters; the mint does not advertise this as a mint feature.
- [Cashu NUT-17 — WebSocket subscriptions](https://github.com/cashubtc/nuts/blob/main/17.md)
  Optional quote/proof notifications; REST reconciliation remains the correctness path in v0.
- [Cashu NUT-19 — Cached responses](https://github.com/cashubtc/nuts/blob/main/19.md)
  Exact-request replay assistance with a one-hour reference-mint TTL; cache expiry is not proof of failure.
- [Nutshell reference mint](./docs/research/nutshell-reference.md)
  Pinned `0.20.3` integration profile and the exact recovery/caching assumptions tested by the repo.

## Wisdom

- [Cashu NUTs repository](https://github.com/cashubtc/nuts)
  The primary place to inspect protocol changes before changing the wallet adapter.
- [Nostr NIPs repository](https://github.com/nostr-protocol/nips)
  The primary place to verify NIP status and wire-level behavior.

## Gaps

- The repo has strong v0 design documentation, but no independent external security review of the complete pairing, browser-storage, relay, and deployment composition.
- The current product path needs a documented threat-model decision for one-scan pairing URLs before treating pairing as a high-privacy handoff.
