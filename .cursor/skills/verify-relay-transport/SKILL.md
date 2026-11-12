---
name: verify-relay-transport
description: "Use when changing NIP-42 relay requests, subscriptions, reconnect, and cleanup in Cashu Sync v0."
---

# Verify RelayTransport

From the repository root, run `./verification/check.sh relay-transport`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One request (query, publish or watch), up to two transient retry intervals
and one connection at a time. Matching IDs and valid event scope are
predicates; crypto and the relay server are abstracted. Wrong envelopes
are stuttering; a publish ambiguity belongs to the caller.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/relayClient.ts`: `run`, `queryWithRetry`,
  `watchCurrent`, `nextSubscriptionId`, `isExactSyncEvent`.
- `wallet/src/sync/v0WalletService.ts`: `startLiveSync`, `stopLiveSync`,
  `syncNow` coalesces concurrent notifications.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/relayClient.test.ts`.

Mutation witness: remove the matching event-ID condition on publish OK; the test that waits for the matching OK must fail.

Scratch source guard check: `python3 verification/replays/run.py relay-transport`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
