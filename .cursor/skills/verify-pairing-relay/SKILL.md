---
name: verify-pairing-relay
description: "Use when changing pairing relay gift-wrap retention, filtering, or subscription delivery in Cashu Sync v0."
---

# Verify PairingRelay

From the repository root, run `./verification/check.sh pairing-relay`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One gift wrap with a receiver, one competing query filter, two logical
ages, one in-flight query result. Pruning happens when saving/querying;
an already captured query may deliver after wall time advances. Crash
forgets the in-memory store. Real time and Khatru dispatch are abstracted.

All configured rules should pass.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `relay/internal/pairingrelay/server.go`: `New`, `memoryStore.save`,
  `prune`, `query`; receive-time TTL, duplicate ID and query snapshot.
- `wallet/src/sync/automaticPairing.ts`: `PairingRelayClient.publish` and
  `watch` wait for relay replies; client-side QR expiry is in Pairing.

Recheck real code: `cd relay && go test ./internal/pairingrelay`.

Mutation witness: remove pruning before query; the retention test must fail.

Scratch source guard check: `python3 verification/replays/run.py pairing-relay`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
