# Wallet base evaluation

Status: **Decision recorded for v0**

## Decision

Fork [cashubtc/cashu.me](https://github.com/cashubtc/cashu.me) at commit [`f4a3f3221be0b7b818c71ece23d9cb472f03f4ad`](https://github.com/cashubtc/cashu.me/commit/f4a3f3221be0b7b818c71ece23d9cb472f03f4ad).

It is MIT-licensed, actively maintained, phone-first, and already supplies the most failure-prone Cashu and browser-wallet foundations:

- Vue 3, Quasar, Pinia, Dexie/IndexedDB, and an installable PWA build;
- BIP39 and NUT-13 deterministic counters;
- NUT-09 restoration and NUT-07 proof reconciliation;
- NUT-17 quote subscriptions and NUT-19 support through cashu-ts;
- recoverable melt state;
- Nostr, NDK, NIP-44 self-encryption, and kind-30078 backup code;
- an existing automated test suite.

The evaluated upstream commit passed its 108 tests and produced a PWA build.

## Required adaptation

- lock the product to one configured Nutshell mint;
- remove or disable send, receive, user-visible swap, multi-mint, discovery, NWC, Nostr DM, and unrelated advanced UI;
- add a typed, minimal sync serializer rather than synchronizing arbitrary browser storage;
- add pairing and the v0 revision/CAS protocol;
- apply remote state in one Dexie transaction;
- gate mint/melt on successful pending-operation CAS;
- make routing, manifest, service-worker scope, and asset paths work on GitHub Pages;
- apply the Silent Link design system.

## Security work before production

- Upstream stores the mnemonic in plaintext localStorage; replace or explicitly mitigate this.
- The inspected dependency tree reported five high and two moderate production audit findings; upgrade and determine browser reachability.
- Replace immediate service-worker activation with a controlled update prompt so code cannot change mid-operation.
- Remove broad unused features to reduce attack surface.
- Ensure pairing secrets never enter URLs, telemetry, logs, or implicit clipboard flows.
- Add restoration and crash-boundary integration tests against Nutshell.

## Hosting

The wallet is a static PWA and can be hosted with GitHub Pages after switching from unsupported direct history-route assumptions or adding a Pages-compatible fallback. A custom root domain is preferable. The relay requires a stateful WSS service and cannot run on GitHub Pages.

## Alternatives rejected

- Nutstash: GPL-3.0, older dependency base, very limited tests.
- Zappi: no license and substantially larger surface.
- Satoshi Pay: no license, old Cashu library, limited tests.
- EndFiat: less mature and coupled to Supabase.
- Official Cashu native wallet: strong base but Swift/Kotlin rather than a hostable PWA.

