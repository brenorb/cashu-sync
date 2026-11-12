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

The funded-wallet guard should pass. The two success rules have independent
failure paths: the protected-wallet branch still acknowledges, and a changed
snapshot head alone can show success. See the audit for replay details.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/sync/automaticPairing.ts`: `AutoPairingHostSession.start`,
  `AutoPairingJoinSession.start`, `destroy`; completed callback ACKs after
  the supplied authority callback fulfills, even if it did not import.
- `wallet/src/pages/settings/SyncSettings.vue`: `createPairing` watches
  for any changed head, `finishPairing` returns normally on the funded-wallet
  refusal, `applyPairing` imports and attempts a publish, `showPairingSuccess`.
- `wallet/src/sync/syncRuntimeService.ts`: `replaceEmptyAndStartUnlocked`
  refuses different authority when monetary records or counters exist.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/automaticPairing.test.ts src/sync/__tests__/syncRuntimeService.test.ts`.

Mutation witness: bypass the funded-wallet check; the runtime test for a different funded authority must fail.

Scratch source guard check: `python3 verification/replays/run.py pairing`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
