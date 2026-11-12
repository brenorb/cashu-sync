---
name: verify-snapshot-sync
description: "Use when changing snapshot pull, CAS acknowledgement, retained history, or mint reconciliation in Cashu Sync v0."
---

# Verify SnapshotSync

From the repository root, run `./verification/check.sh snapshot-sync`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One local baseline, one incoming head and one local-only proof. The local
journal may contain unresolved evidence. Normal, bootstrap and pruned
paths have separate guards. One retryable publication is represented; CAS
storage and socket ordering are checked by separate skills.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/syncCoordinator.ts`: `pullUnlocked`,
  `verifyRetainedPath`, `applyIncoming`, `assertPendingResolved`,
  `recoverPrunedHistory`, `publishUnlocked`, `confirmCandidate`.
- `wallet/src/sync/proofReconciliation.ts`: `reconcileProofsWithMint`
  preserves journal-owned proofs, quarantines pending ones, removes only
  spent ones and fails closed on incomplete/unrecognized mint responses.
- `wallet/src/sync/localWalletRepository.ts`: `applySnapshot` commits
  validated tables and the head together; counters are merged by maximum.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/syncCoordinator.test.ts src/sync/__tests__/proofReconciliation.test.ts`.

Mutation witness: remove the journal-owned input exception in proof reconciliation; its preservation test must fail.

Scratch source guard check: `python3 verification/replays/run.py snapshot-sync`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
