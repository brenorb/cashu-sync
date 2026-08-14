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
