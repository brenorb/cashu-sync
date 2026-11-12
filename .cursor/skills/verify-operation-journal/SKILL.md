---
name: verify-operation-journal
description: "Use when changing mint, melt, the durable operation journal, or relay fencing in Cashu Sync v0."
---

# Verify OperationJournal

From the repository root, run `./verification/check.sh operation-journal`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

Two devices, one operation ID, one initial relay head, at most one initial
POST per device. The second device can import a published prepared snapshot
and advance it before the first POST. Each durable write or remote acceptance
is a separate step. Gateway recovery abstracts exact mint replay, restore,
melt status and demo swap proof checks as a separate recovery path. This
checks initial submissions, not mint idempotence or accounting amounts.

The durability and terminal rules should pass. `OneInitialPostPerOperation`
is a product finding: another wallet can pick up the published prepared
operation and both clients can call the gateway. A second call is not evidence
that the mint pays twice. See the replay and shortest path in the audit.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/syncOperationCoordinator.ts`: `startMint`, `startMelt`,
  `resumeUnlocked`, `resumePending`, `publishPreparedAndSubmit`,
  `recoverFromRelay`, `reconcileGateway`, `publishFinal`.
- `wallet/src/sync/operationJournalRepository.ts`: `prepareMint`,
  `prepareMelt`, `markSubmitted`, `reprepareMint`, `abortPrepared`,
  `recordMintResponse`, `recordMeltResponse`, `finalizeAcceptedSnapshot`.
- `wallet/src/sync/cashuOperationGateway.ts`: `submitMint`, `submitMelt`,
  `reconcileMint`, `reconcileMelt`; remote money semantics are assumed.
- `wallet/src/sync/syncCoordinator.ts`: `publishCurrent` applies the accepted
  prepared checkpoint before the local mark; the remote phase is still prepared.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/syncOperationCoordinator.test.ts src/sync/__tests__/operationJournalRepository.test.ts`.

Mutation witness: remove the local mark before the first POST; the coordinator's durable order and persistence-failure tests must fail.

Scratch source guard check: `python3 verification/replays/run.py operation-journal`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
