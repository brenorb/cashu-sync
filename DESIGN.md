---
version: alpha
name: Silent Link Wallet
description: A phone-first wallet adaptation of the visual primitives observed on silent.link.
colors:
  primary: "#ff9900"
  primary-hover: "#ffab45"
  secondary: "#0066ff"
  secondary-hover: "#0043ca"
  ink: "#090909"
  on-ink: "#ffffff"
  surface: "#ffffff"
  surface-muted: "#f7f7f7"
  outline: "#f7931a4d"
typography:
  display:
    fontFamily: Karla
    fontSize: 60px
    fontWeight: 500
    lineHeight: 1.2
  display-mobile:
    fontFamily: Karla
    fontSize: 40px
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: Karla
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.5
  navigation:
    fontFamily: Karla
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.2
  action:
    fontFamily: Karla
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.5
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 13px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  header-y: 15px
  lg: 20px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.ink}"
  link:
    textColor: "{colors.secondary}"
    typography: "{typography.body}"
  link-hover:
    textColor: "{colors.secondary-hover}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
  settings-card:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    padding: "{spacing.header-y}"
---

# Silent Link Wallet Design System

## Overview

This file is the normative visual source of truth for the wallet. The intended
character is the one visible on Silent Link itself: direct, utilitarian privacy
tooling with high-contrast type, compact controls, and orange and blue accents.
It is not permission to add a new aesthetic.

### Observed on silent.link

The observations below were made on 2026-08-13 from the live desktop and
390-by-844 mobile layouts, the public stylesheet, and the public wordmark:

- [Home page](https://silent.link/)
- [Public stylesheet](https://silent.link/static/css/public-page-CjlsrgRU.css)
- [Public SVG wordmark](https://silent.link/static/img/logo.svg)
- Public Karla files: [Regular](https://silent.link/static/assets/Karla-Regular-DqhmGr4Z.woff2), [Medium](https://silent.link/static/assets/Karla-Medium-qfdih27n.woff2), and [Bold](https://silent.link/static/assets/Karla-Bold-BTZV2Ddz.woff2)

Vendored SHA-256 checksums anchor the observed 2026-08-13 assets:

- `silent-link-logo.svg`: `89bafac522124c287c9284eb38845b98fe51142efdbf72eb7d4614d4fe2e0309`
- `karla-regular.woff2`: `ab2065cccc500eec877d8324662d806c785ee67cd3cc6d964eb855bb766e3527`
- `karla-medium.woff2`: `4353718fa05dc37393f73adaec6e24745e29cbd0bcd0d0b671ec339cf0f89487`
- `karla-bold.woff2`: `02952a40c7bf3eeb6700c3c179297c3b5be734db7368bbccecbf1be00536e465`

The live header is light and compact, with the wordmark on the left, dark
navigation, and an orange active link. Desktop content becomes a single
column on mobile; the wordmark remains left-aligned and navigation collapses
to a dark three-line control. Hero content is white over a near-black image,
with orange links and small rectangular calls to action.

### Wallet implementation mapping

Quasar `primary` maps to observed orange `#ff9900`; `secondary` and visible
keyboard focus map to observed blue `#0066ff`; dark surfaces map to observed
ink `#090909`. The live CTA also uses `#e2a03c` with white text. The wallet
uses black text on `#ff9900` instead because that pairing has stronger text
contrast while remaining entirely inside the observed palette. Existing
legacy wallet themes may remain available, but `silent` is the default.
Quasar success, error, and warning roles are application semantics rather than
Silent Link brand tokens; their framework-compatible values are not normative
brand colors in this file.

### License and trademark caveat

Silent Link publicly serves the copied logo and font files, but public access
is not an explicit trademark, copyright, or redistribution license. Confirm
permission before distributing a public build. Do not copy photography or
other decorative site assets; the wallet only vendors the public wordmark and
Karla font files listed above.

## Colors

Use ink and white for the dominant surfaces. Orange identifies the primary
action; blue identifies links, secondary action, and keyboard focus. Muted
surface and content colors are observed site neutrals. Do not introduce
additional brand colors or gradients.

## Typography

Karla is the only product typeface. The live site uses regular body copy,
medium navigation/actions, and restrained display type: 60px on desktop and
40px at its narrow breakpoint. In the wallet, preserve these weight roles and
let compact Quasar controls scale down without substituting another family.

## Layout

Start with one phone-width content column, full-width primary actions, and
safe-area-aware padding. Use the observed 4px-derived spacing values. Allow
settings content to gain a constrained maximum width on larger displays; do
not turn the mobile flow into a multi-column dashboard.

## Elevation & Depth

Prefer flat tonal separation, thin borders, and contrasting surfaces. The live
site uses an orange-tinted one-pixel border on cards and a light header over
dark content. Avoid decorative shadows; reserve overlays for actual dialogs.

## Shapes

Controls and cards use small rectangular corners. The observed core radii are
4px and 8px, with 13px used by larger FAQ/form containers. Do not turn primary
actions, cards, or navigation into pills.

## Components

- The app header uses the light muted surface, the exact public wordmark, and
  dark icon controls with orange interactive state.
- Primary buttons are orange with ink text, a 4px radius, and no lift effect.
- Links and focus indicators use blue. Focus must remain visible on dark and
  light surfaces.
- As a wallet-specific mapping, settings combine the observed ink and white
  pairing with the observed orange-tinted border and an 8px radius.
- Onboarding uses the wordmark directly, one clear action per screen, and no
  decorative logo animation.

## Do's and Don'ts

- Do preserve phone readability, touch targets, safe areas, and visible focus.
- Do honor `prefers-reduced-motion` for existing Quasar transitions.
- Do use the exact vendored wordmark without recoloring or redrawing it.
- Don't add gradients, glass effects, invented illustrations, or new colors.
- Don't imitate the live hero photography inside the wallet.
- Don't treat public asset URLs as a grant of redistribution rights.
