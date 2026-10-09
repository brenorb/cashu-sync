# Fly demo deployment

This repository includes a disposable public demo deployment profile for Fly.io:

- wallet: `https://cashu-sync-wallet.fly.dev`
- mint: `https://cashu-sync-mint.fly.dev`
- relay: `wss://cashu-sync-relay.fly.dev`

The mint uses Nutshell FakeWallet and the relay uses explicitly enabled public
open admission. This is test infrastructure only; do not put real funds or
private wallet data through it.

Deploy after authenticating with `flyctl auth login`:

```sh
cd integration/nutshell
flyctl deploy --app cashu-sync-mint --config fly.toml . --remote-only --yes

cd ../../relay
flyctl deploy --app cashu-sync-relay --config fly.toml . --remote-only --yes

cd ../wallet
flyctl deploy --app cashu-sync-wallet --config fly.toml . --remote-only --yes
```

The mint and relay use one Fly volume each. Keep their app names and regions
stable unless you also update `wallet/fly.toml` build arguments.

## Deployment verification — 2026-09-06

Published wallet source commit `4b53a16` (recovery fix `a3180fc` included)
using the existing remote-build profile. Fly image:
`registry.fly.io/cashu-sync-wallet:deployment-01M1WSHR25MNSN84RJWW2D9607`.
Both Amsterdam machines reached version 44 and passed Fly deployment checks.

A fresh visible Chrome session loaded the public URL with HTTP 200, displayed
`Wallet synchronized.` and `$0.00`, and reported no uncaught page errors.
The loaded JavaScript contained the new relay recovery validation. Mint
(Nutshell 0.20.3), sync relay, and pairing relay health endpoints returned 200.
This was a deployment smoke check; interrupted-operation E2E evidence is in
[the recovery report](qa/relay-first-recovery-2026-09-06.md).

## Recovery fix deployment — 2026-09-07

Published source `1681512` using the existing wallet-only deployment profile.
Image: `registry.fly.io/cashu-sync-wallet:deployment-01M1WY3GRRPQJFCWGZGXXDBKP4`.
Manifest digest: `sha256:9d23a957379ebd2f5ae581e5e21823e34a232cfb81fcfc163447533bb7940ac3`.
Both Amsterdam machines (`7846572b9530e8`, `801555b6e33528`) reached version 45,
started, and passed Fly deployment checks.

A fresh visible Chrome session returned HTTP 200, displayed `Wallet synchronized.`,
and had no uncaught page errors. Its loaded JavaScript contained both pruned-history
reconciliation and completed-quote matching. The live-backend pre-deployment E2E
passed stale history, lost swap response, concurrent Top Ups, and offline token
access: [recovery evidence](qa/pruned-history-recovery-2026-09-06.md).
Existing clients should reload to load the updated application.

## Three-wallet recovery deployment — 2026-10-08

Published merged source `8af073f94df8cf37d4cf36b98402e54f90e84713` from a clean
Git archive with the existing wallet-only remote-build profile.
Image: `registry.fly.io/cashu-sync-wallet:deployment-01M4F3G1GW4TNDSBZ8J2E2B1KD`.
Manifest digest: `sha256:897fa521ec6f308bc27f4a600395eb41e1ee86a4db58e5285201a84bfe875e12`.
Both Amsterdam machines (`7846572b9530e8`, `801555b6e33528`) are started on this
image and passed Fly deployment smoke, machine and health checks. The mint and
relays retain their existing deployments.

The public wallet returned HTTP 200. Two new isolated Chrome contexts with mobile
viewports completed pairing through a QR whose origin is the public wallet domain;
both displayed `Wallet synchronized.` and equal `$0.00` balances, with no uncaught
page errors. Loaded JavaScript included the new funded-wallet protection text.
Service workers were allowed. The already-open wallet also loaded the update and
displayed synchronized status. Physical-phone and installed-PWA upgrade behavior
are not fully covered by this smoke check.

GitHub Actions run [37867598005](https://github.com/brenorb/cashu-sync/actions/runs/37867598005)
passed. Full recovery evidence and remaining coverage limits are in
[the three-wallet report](qa/three-wallet-recovery-2026-10-08.md).
Existing clients should reload to load the updated application.
