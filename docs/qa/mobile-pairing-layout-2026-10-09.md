# Mobile pairing layout — 2026-10-09

## Changes

- `492388c`: remove the incoming screen's fixed 48 px padding and inherited
  Quasar H2 size. Use responsive padding, explicit heading size/line height,
  wrapping and a grid track that can shrink to the phone's width.
- Separate the Wallet ID label, six words and caption with block children and
  explicit row spacing. Wrap long text without extending its card.
- Apply the same heading/wrapping rules to the stopped-pairing state, success
  overlay, protection dialog buttons/title, and long error messages. The success
  overlay scrolls on short screens.
- `abb0f7f`: serve HTML and the service worker with `no-store`, revalidate the
  manifest, cache fingerprinted assets, and return 404 for missing asset chunks.

## Publication and evidence

- Merged and pushed to `main`: `0543e0edcb1767d16442cbdf4294157fa2dc4517`.
- Changed-file ESLint, Prettier, diff checks, and production PWA build passed.
- [GitHub Actions](https://github.com/brenorb/cashu-sync/actions/runs/37880367793) passed wallet/relay tests, Pages build, path smoke
  and deployment for this exact merge.
- Fly wallet-only deploy from a clean Git archive completed successfully. Both
  Amsterdam machines are started on `registry.fly.io/cashu-sync-wallet:deployment-01M4FC01D06QHP0JEERQ984SJ4`.
- Image digest: `sha256:0953f1e37a7b12b25227c68cd0cb5df517a342367acd9c1f8744d1781f36cdab`.
- Before deployment and on the public Fly URL, isolated Chrome contexts passed
  10 layout measurements: overview and incoming pairing at 320, 360 and 390 px;
  incoming pairing at 320 px with enlarged root font; QR, error and completion.
  Measurements checked element/text bounds and horizontal scroll widths after
  navigation transitions finished. Wallet ID row gaps were at least 9 px.
- Two disposable demo wallets completed real pairing and the receiver reached
  synchronized status. No uncaught page errors. Existing user wallet data was
  not reset or replaced. This does not test monetary recovery or real settlement.
- Public HTTP checks confirmed HTML/worker `no-store`, manifest `no-cache`,
  HTTP 200 for the entry files and 404 for a missing JavaScript chunk.
- The existing in-app browser loaded the versioned sync page with separated
  Wallet ID content. Physical-phone/installed-PWA update behavior remains outside
  this desktop browser check; headers do not invalidate an already-active older
  worker's offline cache. Close and reopen the wallet to load its new worker.

Published screen: [Sync devices](https://cashu-sync-wallet.fly.dev/?v=0543e0e#/settings/sync).
