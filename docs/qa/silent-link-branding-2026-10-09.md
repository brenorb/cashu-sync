# Silent Link branding — 2026-10-09

## Changes

- `3776971`: About identifies Silent Link Wallet, displays the existing Silent
  Link wordmark, and links to the verified official website, FAQ and support email.
  The source-code entry points to this wallet's actual repository. Inherited
  Cashu community/social/donation links were removed from this product page.
- The inherited Terms entry was removed, and `/terms` redirects to About. Its
  copied static text was archived at `docs/upstream/cashu-me-legacy-terms.txt`,
  outside the published wallet. No Silent Link legal terms were invented or
  substituted into that text. The existing software license remains intact.
- `24ad27d`: browser title, product description, PWA name and short name now use
  Silent Link. Existing legacy install screenshots are no longer advertised in
  the manifest. Browser/PWA icons, Apple launch images and Safari pinned-tab SVG
  use the existing Silent Link vector wordmark. `npm run brand:icons` reproduces
  the 31 PNG assets and favicon/vector using installed Chrome.

The active wallet, settings navigation, appearance/language pages, shared header,
fallback pages, packaging metadata and installation assets were checked. Cashu
protocol dependencies and persisted storage keys remain technical identifiers;
the branding work does not migrate wallet data or change monetary operations.

## Link sources

Verified on 2026-10-09 against the official [Silent Link website](https://silent.link/)
and [FAQ](https://silent.link/faq). The website publishes `support@silent.link`.
The actual wallet repository is [brenorb/cashu-sync](https://github.com/brenorb/cashu-sync).

## Validation and publication

- Changed-file lint, formatting, `git diff --check`, and production PWA build passed.
- Wallet units: 390 passed, 16 skipped, 36 passing files.
- [GitHub Actions run 37879297266](https://github.com/brenorb/cashu-sync/actions/runs/37879297266)
  passed wallet/relay tests, PWA build, Pages-path smoke and deployment.
- The fixes were merged into `main` as `d01e6465a110808fdae48a755fb4a9b04c0aa301`
  and deployed from a clean Git archive using the existing Fly wallet profile.
- Both Amsterdam machines are started on image
  `registry.fly.io/cashu-sync-wallet:deployment-01M4FB63AQXN7VRV17ZTE8XHA3`, digest
  `sha256:956c0ebaf50874f17e5297aecf44acff18fdfdb754cdc49960202c3ba0471325`.
  Fly deployment checks passed.
- A fresh mobile-sized Chrome context returned HTTP 200, displayed the Silent
  Link heading/logo and expected links, and loaded the correct browser title and
  PWA name. Manifest icon URLs returned 200; legacy screenshots were absent from
  the manifest; `/terms` redirected correctly. No uncaught page errors. Exit 0.
- The existing in-app browser initially retained the old PWA view after navigation
  and reload. A fresh tab in the same browser visibly loaded the new About page;
  the stale tab was replaced without clearing origin storage. Installed-phone
  shortcut/icon refresh behavior is not established by this browser smoke.

Published page: [About Silent Link](https://cashu-sync-wallet.fly.dev/#/settings/about).
