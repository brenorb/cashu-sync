---
name: verify-release-fixtures
description: "Use when changing Pages release gates or the reference mint fixture lifecycle in Cashu Sync v0."
---

# Verify ReleaseFixtures

From the repository root, run `./verification/check.sh release-fixtures`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One workflow event and one fixture launch. The individual CI checks
must all succeed for the artifact to become deployable. Docker readiness
and Nutshell contract validation are separate; no live deploy is modeled.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `.github/workflows/pages.yml`: trigger, test/build/smoke gate, PR
  conditions on upload and deploy, and deploy's dependency on build.
- `integration/nutshell/nutshell.sh`: `up`, `ready`, `logs`, `down`;
  `integration/nutshell/compose.yaml`: fixture health.
- `integration/nutshell/assert_ready.py`: `validate` verifies version,
  USD Bolt11, proof state, restore, subscriptions and mint/melt cache.

Recheck real code: `sh tests/nutshell-reference-contract.sh` and `cd wallet && npm run test:ci -- test/vitest/__tests__/pages-packaging.test.js`.

Mutation witness: allow the deploy job on a PR; the Pages packaging test must fail.

Scratch source guard check: `python3 verification/replays/run.py release-fixtures`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
