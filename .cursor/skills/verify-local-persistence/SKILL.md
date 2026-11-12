---
name: verify-local-persistence
description: "Use when changing IndexedDB transactions, counter reservations, or legacy migration in Cashu Sync v0."
---

# Verify LocalPersistence

From the repository root, run `./verification/check.sh local-persistence`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One keyset, two reservations of width one, bounded cursor 0–3,
one pending legacy value, one two-table snapshot apply. A transaction
commits both records or neither. Identity reset intentionally starts a new
namespace. Does not prove IndexedDB or cross-device output uniqueness.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/durableCounterSource.ts`: `reserve`,
  `advanceToAtLeast`, `replaceAll`, `migrateLegacyKeysetCounters`.
- `wallet/src/sync/localWalletRepository.ts`: `exportSnapshot`,
  `applySnapshot`; `wallet/src/stores/dexie.ts`: schema, `migrateToDexie`,
  `resetCashuDexie`; `wallet/src/stores/migrations.ts`: ordered migrations.
- `wallet/src/stores/paymentHistory.ts`, `proofs.ts`, `mints.ts`:
  database-to-display cache refresh after authoritative writes.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/localPersistence.test.ts`.

Mutation witness: omit the committed cursor increment from reserve; concurrent reservation and restart tests must fail.

Scratch source guard check: `python3 verification/replays/run.py local-persistence`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
