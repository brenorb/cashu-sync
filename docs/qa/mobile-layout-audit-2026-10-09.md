# Mobile layout audit — 2026-10-09

## Scope and changes

Reviewed deployed routes, their layouts and reachable components: wallet,
credit/eSIM/invoice-entry dialogs, settings menu, recovery/backup, appearance,
language, About, already-running and missing-page screens. The sync/pairing
layout was corrected in the preceding change. Legacy pages/components absent
from the active router were inspected for patterns but were not restyled.

- `ae6585f`: shrinking grid tracks, wrapping buttons/copy, bounded dialog
  actions, explicit dialog heading line height, responsive quote summaries,
  and wrapping for the wallet balance and accounting rows. The old dialog H2
  line height was 2.5 times its font size; accounting headings exceeded 3 times.
- `1bd632a`: shared responsive status-page shell for missing-page and
  already-running screens. Replace the viewport-height-based 404 size with
  sizing based on width, use bounded text, and allow the page to scroll.
- `6a68cdd`: wrap settings headings/captions/status text, remove horizontal
  content clipping, and let header badges wrap while preserving controls/logo.
- `9d162f5`: use a smaller responsive balance font when its formatted text is
  long; stack accounting rows below 480 px so amounts and dates remain readable.

Currency formatting, operation handlers and persisted monetary data are
unchanged. The balance class depends only on formatted display-string length.

## Review evidence

- Earlier deployed code (`0543e0e`) produced 34 geometry/
  typography flags over 71 review cases. These are
  repeated viewport/state observations, not that many separate defects.
- Final local build and Fly deployment each passed 71
  review cases with no geometry/typography flags or uncaught page errors.
- Widths: 320, 360 and 390 px, normal text and enlarged root/body font at 24 px.
  Includes tall 320 × 844 and landscape 568 × 320 fallback screens, plus
  Portuguese appearance text. Navigation animations/fonts were settled before
  measurement. Element/text bounds, horizontal scrolling and heading line-height
  ratios were checked. The home link remained reachable in short/landscape view.
- Credit and eSIM dialogs were opened, including invoice entry; no payment,
  quote submission, restore or wallet deletion was performed. Wallet contexts
  were isolated from the existing user wallet. Large balance/history values
  were display-only DOM fixtures (including the same long-value class condition),
  not real funds, minted credits or persisted ledger entries.
- ESLint/Prettier on changed files, diff checks and production PWA build passed.
- [GitHub Actions](https://github.com/brenorb/cashu-sync/actions/runs/37881747127) passed wallet/relay tests, build, Pages path
  smoke and deployment for merge `e8937ae495995db882de4568af38b72b80293772`.

## Fly publication

Wallet-only deployment from a clean Git archive completed successfully. Both
Amsterdam machines are started on `registry.fly.io/cashu-sync-wallet:deployment-01M4FD19XAHPQ9H3NPZW6745RH`.
Digest: `sha256:aa2fb30078d467451ecb41d0aca5f3db881fd2acd31fdb88baa595e655a4abcb`.

The existing in-app browser loaded the versioned wallet screen. This review uses
desktop Chrome with phone viewports; it does not establish physical Android
font scaling, installed-PWA update behavior, or all translated languages.

Published wallet: [Silent Link Wallet](https://cashu-sync-wallet.fly.dev/?v=e8937ae#/wallet).
