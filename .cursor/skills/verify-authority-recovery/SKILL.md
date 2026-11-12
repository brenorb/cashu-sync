---
name: verify-authority-recovery
description: "Use when changing wallet creation, authority import, backup restore, or device removal in Cashu Sync v0."
---

# Verify AuthorityRecovery

From the repository root, run `./verification/check.sh authority-recovery`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One device, one current and one candidate identity, two local-data classes,
a remembered checkpoint bit and an unresolved journal bit. Encryption is
represented by decrypt success/failure. Each await across LocalStorage and
Dexie is a potential crash boundary; this model checks guards and caught
failure rollback, and marks the interruption window separately.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/syncRuntimeService.ts`: `bootUnlocked`,
  `replaceEmptyAndStartUnlocked`, `importAndStartUnlocked`, `bootstrapMint`.
- `wallet/src/sync/walletSyncRuntime.ts`: `importForRecovery`,
  `startUnlocked`, `resetSession`; existing pending bypasses initial pull.
- `wallet/src/sync/authorityRepository.ts`: `loadAndRepairMnemonic`,
  `importAuthority`, `clear`; `recoveryBundle.ts` encrypts and decrypts.
- `wallet/src/pages/settings/RecoverySettings.vue`: `downloadBackup`,
  `restoreBackup`, `deleteWallet`; `v0WalletService.ts`: `removeFromDevice`.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/syncRuntimeService.test.ts src/sync/__tests__/walletSyncRuntime.test.ts src/sync/__tests__/recoveryBundle.test.ts src/sync/__tests__/v0WalletService.test.ts`.

Mutation witness: allow a fresh genesis when a remembered head is absent; the runtime’s missing-head test must fail.

Scratch source guard check: `python3 verification/replays/run.py authority-recovery`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
