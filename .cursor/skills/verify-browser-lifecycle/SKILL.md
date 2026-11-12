---
name: verify-browser-lifecycle
description: "Use when changing wallet startup, live readiness, QR scanner, or service worker lifecycle in Cashu Sync v0."
---

# Verify BrowserLifecycle

From the repository root, run `./verification/check.sh browser-lifecycle`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One page instance, a prior payment waiting to recover, one watcher,
and one service-worker update; scanner is a separate parallel region.
Local money persists across reload. The page's badge and wallet readiness
are separate; these are user signals, not server availability.

`SynchronizedMeansNoPendingJournal` fails: a connected socket can set the synchronized badge during operation recovery. It does not make the wallet ready.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/pages/V0WalletPage.vue`: `created`, `resumeAutomatically`,
  `startWatchingWallet`, `beforeUnmount`; onStatus connected updates the badge.
- `wallet/src/components/QrcodeReader.vue`: mount, permission error, scan,
  paste, unmount cleanup; `wallet/src/stores/camera.ts`: show/close.
- `wallet/src-pwa/register-service-worker.js`: registration update request
  and update-triggered reload; `wallet/quasar.config.js`: generated worker.
- `wallet/src/boot/base.js`, `wallet/src/stores/settings.ts`,
  `wallet/src/pages/settings/{AppearanceSettings,LanguageSettings}.vue`:
  local preferences only, not payment or authority state.

Recheck real code: `cd wallet && npm run test:ci -- test/vitest/__tests__/v0-ui-surface.test.js test/vitest/__tests__/pages-packaging.test.js`.

Mutation witness: treat a disconnected watcher as connected; the callback replay must fail.

Scratch source guard check: `python3 verification/replays/run.py browser-lifecycle`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
