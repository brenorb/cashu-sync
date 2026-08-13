# Nutshell reference mint

Cashu Sync v0 tests against Nutshell `0.20.3`, source commit [`18539020b4fa473ad8ad440e210720d2aaf8401a`](https://github.com/cashubtc/nutshell/tree/18539020b4fa473ad8ad440e210720d2aaf8401a). The integration fixture pins the published multi-platform image by digest:

```text
cashubtc/nutshell:0.20.3@sha256:f039b0e61f64d67c7212f5472eb5d021c3703cd9e72170aa924906ce6bd1f2ed
```

It uses FakeWallet with a USD keyset and Redis-backed NUT-19. FakeWallet is deterministic test infrastructure, not a real USD funding backend or price oracle. A real Lightning regtest is reserved for testing Lightning-node behavior; it is not needed for wallet synchronization, replay, restoration, or relay concurrency tests.

## Run locally

Docker with the Compose plugin and Python 3 are required.

```sh
./integration/nutshell/nutshell.sh up
./integration/nutshell/nutshell.sh ready
```

The mint is available at `http://127.0.0.1:3338`. `up` waits for `GET /v1/info`, then verifies:

- version `Nutshell/0.20.3`;
- NUT-04 and NUT-05 for `bolt11`/`usd`;
- NUT-07 and NUT-09;
- NUT-17 mint quote, melt quote, and proof-state subscriptions for USD;
- NUT-19 mint and melt caching with a one-hour TTL;
- absence of NUT-13 from mint feature advertisement, because derivation is wallet-side.

Inspect logs and remove the isolated containers, network, Redis tmpfs, and mint database volume with:

```sh
./integration/nutshell/nutshell.sh logs
./integration/nutshell/nutshell.sh down
```

CI jobs on one host can isolate concurrent fixtures by setting `CASHU_SYNC_NUTSHELL_PROJECT` and `CASHU_SYNC_NUTSHELL_PORT` to unique values. Each job must run `down` in its exit trap.

## Recovery contract

Nutshell provides the mint-side NUT-09 restore endpoint and NUT-07 state checks. The wallet owns NUT-13 deterministic derivation. For current version `01` keysets it uses HMAC-SHA256; it retains legacy BIP32 for version `00` keysets. The v0 operation journal uses NUT-09 only for the exact blinded outputs prepared before an interrupted mint submission. A broad mnemonic-only counter scan is deferred roadmap work.

NUT-19 stores successful responses for an exact mint or melt request. The local one-hour TTL helps recover an interrupted response, but cache expiry is never evidence that an operation did not happen. The current journal reconciles through quote lookup and exact-output NUT-09 restoration; NUT-07 remains available for later broader proof recovery. The pending-operation journal therefore stores the complete ordered request, not only a hash.

NUT-17 is likewise an optimization. A subscription first reports current state and then changes, but clients reconcile over REST whenever notifications may have been missed.

## Primary sources

- [Nutshell release launch and configuration](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/README.md#L194-L225)
- [Feature advertisement for NUT-04, 05, 07, 09, 17, and 19](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/cashu/mint/features.py#L108-L247)
- [FakeWallet USD and settlement behavior](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/cashu/lightning/fake.py#L60-L256)
- [NUT-19 exact-request cache implementation](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/cashu/mint/cache.py#L39-L69)
- [Nutshell info, WebSocket, state, and restore routes](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/cashu/mint/router.py#L235-L668)
- [NUT-13 versioned derivation and recovery scan](https://github.com/cashubtc/nuts/blob/973ab09b532e415346a92a6dfb7339955887390d/13.md#L13-L334)
- [NUT-17 initial-state subscription rule](https://github.com/cashubtc/nuts/blob/973ab09b532e415346a92a6dfb7339955887390d/17.md#L92-L99)
- [NUT-19 cache contract](https://github.com/cashubtc/nuts/blob/973ab09b532e415346a92a6dfb7339955887390d/19.md#L7-L62)
