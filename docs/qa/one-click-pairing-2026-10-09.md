# Pairing and duplicate-action review — 2026-10-09

## Changes and search scope

Reviewed the active wallet page, its purchase/payment dialogs, the sync/pairing
pages, recovery, settings navigation, appearance/language pages, route setup and
shared fullscreen layout. Also searched page/component handlers and existing E2E
flows for repeated screen-opening, generation and confirmation steps.

- `26d67ce`: “Show pairing QR” opens a page that creates and displays the QR
  automatically. Direct entry and reload also create it. The large status card is
  shown on the overview, keeping the QR in the first mobile viewport. Regeneration
  and retry remain available. Async setup stops when the screen is left; a busy
  guard prevents overlapping actions. Existing E2E flows now use the single click.
- `ae8db19`: removed the second identical “Back to sync devices” button from the
  page body. In the purchase dialog, removed the second button calling the same
  balance-update method, and removed the invoice field's click handler that
  triggered an update instead of allowing normal selection. Busy dialog actions
  are serialized. Recovery copy describes the existing automatic balance update.

The payment review displays the quoted amount and maximum fee before spending.
Backup passphrase confirmation validates the entered password, and device deletion
confirmation covers local removal. These steps serve distinct user decisions.
Appearance and language selections already apply on a single click.

## Validation

- Production PWA build passed. Changed-source ESLint, formatting and
  `git diff --check` passed.
- Existing wallet unit suite: 390 passed, 16 skipped, 36 passing files.
- The existing live automatic-pairing case passed its assertions in 45 seconds:
  one-click QR, encrypted joining, shared balances, purchase, funded re-pairing
  and payment. Persistent-context teardown reported three close timeouts; the
  runner was interrupted during cleanup and exited 130 after reporting one passed
  case. This run is not presented as a clean runner exit.
- [GitHub Actions run 37877845162](https://github.com/brenorb/cashu-sync/actions/runs/37877845162)
  completed successfully for merge `aa7d1b2418d46de56d76ef22f2ca7949c793fc90`,
  including wallet/relay tests, PWA build, subpath smoke and Pages deployment.
- A separate deployed smoke exited 0 using two fresh Chrome contexts at 390 × 844:
  HTTP 200, QR after one click, QR within the first viewport, one page-body back
  button, regeneration, QR on direct-entry reload, encrypted pairing, equal zero
  balances, synchronized status and no uncaught page errors. Service workers were
  allowed. The QR origin was the public wallet domain, with no localhost address.
- The user's existing browser tab initially retained the old PWA view after a
  reload. A versioned navigation loaded the new screen, which visibly showed the
  automatically generated QR. No wallet storage was cleared. This check does not
  establish physical-phone or installed-PWA upgrade behavior for every client.

## Publication

The two fixes were committed separately, merged into `main` as `aa7d1b2`, and pushed.
Fly deployed a clean archive of the merge with the existing wallet-only profile.
Both Amsterdam machines are started on the new image and passed deployment checks.
Image: `registry.fly.io/cashu-sync-wallet:deployment-01M4FA3RMXRM7JB3Z5SHCA4B3G`.
Digest: `sha256:fbd23178a76e3d9d51805b2eac24da0dc28c8b22ef9c0d5a25adb4971f0b0b25`.

Public wallet: [cashu-sync-wallet.fly.dev](https://cashu-sync-wallet.fly.dev/#/wallet).
