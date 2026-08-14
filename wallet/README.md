# Silent Link Wallet PWA

This Vue/Quasar PWA implements the Cashu Sync v0 client for one user controlling paired wallet installations.

The v0 product profile is intentionally fixed:

- exactly one configured authority mint;
- USD accounting;
- Bolt11 mint and melt only;
- one-QR automatic full-authority pairing through a separate pairing relay;
- encrypted snapshot synchronization through the Silent Link-operated relay;
- passphrase-encrypted full-recovery bundle;
- no peer-to-peer Cashu, token import/export, alternate payment rails, mint switching, or multi-mint behavior.

The complete product and safety contract is in [the v0 specification](../docs/spec.md). For the runnable Nutshell, relay, two-browser pairing, mint, synchronization, melt, and from-scratch recovery flow, follow [the local tutorial](../docs/tutorial.md).

## Install and run

Node.js 22.4 or later is required.

```sh
npm ci
CASHU_SYNC_MINT_URL=https://mint.example.com \
  CASHU_SYNC_RELAY_URL=wss://sync.example.com \
  CASHU_SYNC_PAIRING_RELAY_URL=wss://pairing.example.com \
  npm run dev
```

The mint and relay values are public client configuration, not secrets. Production mint authorities must be HTTPS origins and production relays must use WSS. The local tutorial documents the explicit loopback-only opt-in used with the integration fixture.

## Verify

```sh
npm run test:ci
npm run lint
npm run checkformat
npm run build:pwa:pages
npm run smoke:pwa:pages
```

The live browser test additionally requires the local Nutshell and relay services:

```sh
npm run test:e2e:live
```

## GitHub Pages

`npm run build:pwa:pages` builds under `/cashu-sync/` with hash routing. GitHub Pages serves only the static PWA; Nutshell and the stateful relay must be deployed separately behind HTTPS/WSS. The current Pages workflow does not inject production endpoints or provide relay-allowlist enrollment, so it is not yet a turnkey production bootstrap. See the [deployment caveats](../docs/tutorial.md#github-pages-caveats).
