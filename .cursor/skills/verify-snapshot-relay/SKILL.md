---
name: verify-snapshot-relay
description: "Use when changing snapshot relay CAS, admission, rate budgets, or retention in Cashu Sync v0."
---

# Verify SnapshotRelay

From the repository root, run `./verification/check.sh snapshot-relay`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

Two writers from the same parent, one accepted child, one later child,
retention of two events, one abstract two-request quota window. The Go
transaction is one action; Khatru signature checks, HTTP setup, timestamps,
and encrypted payload contents are outside the model.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `relay/internal/store/store.go`: `Advance`, `Head`, `Query`; CAS,
  duplicate detection and pruning share one transaction.
- `relay/internal/relay/policy.go`: `OnEvent`, `OnRequest`, `isAdmitted`,
  `ValidateEvent`, `ValidateFilter`, `fixedWindowLimiter.Allow`.
- `relay/internal/relay/server.go`: policy hooks, repository and health;
  `relay/internal/appconfig/config.go`: open, allowlist, demo binding gates.

Recheck real code: `cd relay && go test ./internal/store ./internal/relay ./internal/appconfig`.

Mutation witness: ignore the stale parent check in Advance; the stale-child and concurrent-children tests must fail.

Scratch source guard check: `python3 verification/replays/run.py snapshot-relay`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
