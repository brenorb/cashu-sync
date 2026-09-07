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
