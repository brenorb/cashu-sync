---
name: verify-operation-journal
description: "Use when changing mint, melt, the durable operation journal, or relay fencing in Cashu Sync v0."
---

# Verify OperationJournal

From the repository root, run `./verification/check.sh operation-journal`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

Two devices, one operation and one exact prepared request. The starting
relay head can be empty of operations or contain a legacy prepared request.
The accepted submitted snapshot fences the initial request. Only the direct
CAS winner can send it after saving the fence locally. A peer, lost
acknowledgement or interrupted caller uses the recovery path. Each durable
local write and remote acceptance is a separate step.

All three rules should pass. The initial submission rule applies to the exact
request under this client version. Gateway recovery abstracts exact retry,
quote locking at the mint, restore and proof checks. The model assumes those
mint rules and a shared terminal result. A regenerated mint preview after a
signed-output rejection is a different exact request.

Source correspondence (last compared at `b3527a383007a989a5d76cea7ca340c1ec7c5292`):

- `wallet/src/sync/syncOperationCoordinator.ts`: `startMint`, `startMelt`,
  `resumeUnlocked`, `resumePending`, `publishPreparedAndSubmit`,
  `recoverFromRelay`, `reconcileGateway`, `publishFinal`.
- `wallet/src/sync/operationJournalRepository.ts`: `prepareMint`,
  `prepareMelt`, `candidateForSubmission`, `acceptSubmission`, `reprepareMint`,
  `abortPrepared`, response recording and finalization. The acceptance
  transaction checks the operation, parent and revision, then saves the fence.
- `wallet/src/sync/cashuOperationGateway.ts`: `submitMint`, `submitMelt`,
  `reconcileMint`, `reconcileMelt`. An unpaid lookup alone preserves
  the inputs. Exact retry uses the pinned Nutshell quote and proof locks.
- `wallet/src/sync/syncCoordinator.ts`: `publishCandidate` distinguishes the
  direct acknowledgement from confirmation after an ambiguous publication.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/syncOperationCoordinator.test.ts src/sync/__tests__/operationJournalRepository.test.ts`.

Mutation witnesses bypass the local acceptance write or allow a confirmed
but non-direct acknowledgement to enter initial submission.

Scratch source checks use `python3 verification/replays/run.py operation-journal`
and `python3 verification/replays/run.py operation-direct`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
