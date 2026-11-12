---
name: verify-pairing
description: "Use when changing automatic pairing, QR sessions, or success feedback in Cashu Sync v0."
---

# Verify Pairing

From the repository root, run `./verification/check.sh pairing`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One host, one joiner, one QR, two authority identities; one unrelated head
advance. The model distinguishes a matching ACK, an unrelated relay head
change, a real import, and a preserved local wallet. TTL is a timeout
transition; cryptography, camera transport, and clock skew are abstracted.

All three rules should pass. A joiner sends its ACK after the authority
import succeeds. An unrelated relay head can change while the host waits.
Host success requires the ACK for that QR session.

Source correspondence (last compared at `b3527a383007a989a5d76cea7ca340c1ec7c5292`):

- `wallet/src/sync/automaticPairing.ts`: `AutoPairingHostSession.start`,
  `AutoPairingJoinSession.start`, `destroy`. The import callback returns
  true for a successful import and false when it preserves an existing wallet.
- `wallet/src/pages/settings/SyncSettings.vue`: `createPairing` waits for the
  pairing ACK. `finishPairing` waits for ACK publication before navigating
  away. `applyPairing` imports and starts the wallet.
- `wallet/src/sync/syncRuntimeService.ts`: `replaceEmptyAndStartUnlocked`
  refuses different authority when monetary records or counters exist.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/automaticPairing.test.ts src/sync/__tests__/syncRuntimeService.test.ts`.

Mutation witness: bypass the funded-wallet check; the runtime test for a different funded authority must fail.

Scratch source checks use `python3 verification/replays/run.py pairing`,
`python3 verification/replays/run.py pairing-ack` and
`python3 verification/replays/run.py pairing-head`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
