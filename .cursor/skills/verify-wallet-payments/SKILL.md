---
name: verify-wallet-payments
description: "Use when changing buy credits, spend credits, invoice quotes, or payment UI in Cashu Sync v0."
---

# Verify WalletPayments

From the repository root, run `./verification/check.sh wallet-payments`.
It uses TLC 1.7.4 with Java 11+ and the checked-in config. Set
`TLA2TOOLS` to the pinned jar or let the runner download it. Use pstack
`/statechart` to read the result as a statechart and shortest paths.

One displayed quote, buy or spend; provider invoice, pasted Bolt11 and
internal demo swap share the spend confirmation surface. One abstract
ambiguous outcome or conflict can be retried. Models quote identity and
settlement truth, not amounts, parsing, key derivation, or retry wall time.

Quote durability should pass. `SuccessMeansPaid` is a product finding:
the journal can finalize an UNPAID spend, while the dialog treats
`completed` as paid and closes. This is not evidence that funds were lost.

Source correspondence (last compared at `a9b401ec6618c969b3d4e3aaeffac785d4aa0617`):

- `wallet/src/pages/V0WalletPage.vue`: `createMintQuote`, `claimMintQuote`,
  `resumeAutomatically`, `createMeltQuote`, `payMeltQuote`, `runDialog`.
- `wallet/src/sync/v0WalletService.ts`: quote request loops,
  `persistMintQuote`, `persistMeltQuote`, `publishQuoteOrRollback`,
  `recoverPaidMintQuotes`, `markAlreadyPaid`, `settleRequestedOperation`.
- `wallet/src/sync/topupService.ts`: provider quote; demo uses an internal
  quote and `CashuOperationGateway` journals its swap instead.
- `wallet/src/sync/operationJournalRepository.ts`: `buildClearedCandidate`
  accepts an UNPAID melt and releases its reserved inputs.

Recheck real code: `cd wallet && npm run test:ci -- src/sync/__tests__/v0WalletService.test.ts src/sync/__tests__/operationJournalRepository.test.ts`.

Mutation witness: discard the locally saved quote on an ambiguous publish; the service test for an ambiguous relay acknowledgement must fail.

Scratch source guard check: `python3 verification/replays/run.py wallet-payments`.

For an unexpected counterexample, read the earliest failing step, then map
the trace to the named source functions and replay it against the code. An
unmodeled guard or wrong atomic boundary is a model defect; a reproducible
source trace is a product finding. Update actions, bounds, rules and user
views together for an intended behavior change. Advance the source commit
only after checking the correspondence and rerunning both checks.
