# Three-wallet recovery — 2026-10-08

## Scope

Three isolated Chrome storage contexts share one wallet through the real pairing
UI. The test uses the public Fly demo mint, sync relay and pairing relay. The
mint uses Nutshell FakeWallet: all credits and Lightning invoices are disposable
simulation data. No real funds or Lightning settlement are involved.

The production PWA is built from this branch and served locally by the Node
server helper. Service workers are blocked so faults exercise the selected build;
PWA upgrade and phone deep-link behavior are separate coverage.

## Changes

- Re-pairing the same authority preserves proofs, counters, verified checkpoint
  and the exact pending operation. A different authority cannot overwrite a
  wallet with money or recovery material.
- Local removal is serialized with money operations. It requires a clear journal
  and relay acknowledgement before erasing local data. Other devices retain the
  shared authority; removal does not cryptographically revoke a device.
- The Cashu SDK reads the imported mnemonic rather than a stale in-memory copy.
- Quotes wait for an unresolved operation to settle. Conflict retries are paced
  and staggered across devices; exhaustion preserves recovery material.
- Background synchronization coalesces notifications and automatic recovery
  cannot enqueue overlapping attempts. Paid mint quotes are claimed using their
  existing quote identity after reopening or while the wallet is open.
- An ISSUED quote does not count as recovered money on its own. A retry settles
  newly pulled journals before changing accounting; exact restored outputs can
  complete a submitted journal even if another peer advanced the quote state.
  Preparing a new issuance from an ISSUED quote remains forbidden.
- Payment inputs are selected from the synchronized repository after the pull,
  rather than the UI's earlier copy of the proofs.
- A verified retained completion checkpoint can settle a local journal before
  advancing to a newer peer operation. Unrelated or unverified snapshots cannot
  discard a local monetary response.
- A secondary invoice option uses the normal journaled Bolt11 melt flow. Invoice
  links select this flow and display the quoted amount and fee reserve.
- Startup failure is retried automatically; local token export remains available.
- Relay reads retry up to three fresh connections on transport timeout or
  disconnect. Invalid events and authorization failures still fail immediately;
  monetary publications retain their existing ambiguity handling.

## Reproduction

From `wallet/`:

```sh
PUBLIC_PATH=/cashu-sync-e2e/ \
CASHU_SYNC_MINT_URL=https://cashu-sync-mint.fly.dev \
CASHU_SYNC_RELAY_URL=wss://cashu-sync-relay.fly.dev \
CASHU_SYNC_PAIRING_RELAY_URL=wss://cashu-sync-pairing-relay.fly.dev \
CASHU_SYNC_TOPUP_MODE=internal-demo npm run build:pwa

CASHU_SYNC_E2E_THREE_WALLETS=1 \
CASHU_SYNC_NUTSHELL_URL=https://cashu-sync-mint.fly.dev \
CASHU_SYNC_RELAY_URL=wss://cashu-sync-relay.fly.dev \
CASHU_SYNC_PAIRING_RELAY_URL=wss://cashu-sync-pairing-relay.fly.dev \
PLAYWRIGHT_CHANNEL=chrome \
node node_modules/@playwright/test/cli.js test \
tests/e2e/three-wallet-recovery.spec.ts --headed
```

The main test checks exact accounting, equal proof sets, clear journals, unique
history entries and mint-confirmed UNSPENT proofs after each checkpoint. It races
three buys, three topups and a mixed buy/topup group. It also tests a peer beyond
the eight retained revisions, lost successful mint and swap responses, reloads,
funded re-pairing and local removal followed by re-pairing.

Separate cases check automatic claiming after reload, a unique signed Lightning
invoice whose successful melt response is lost, and offline startup with local
token export followed by automatic reconnection.

A further case takes a third device offline with a US$20 balance, spends every
one of its six local proofs on another device, and confirms all six as SPENT at
the mint. Other devices buy new credits and spend them while the third device
remains offline. After a gap of 19 revisions (beyond the eight retained), the old
device returns online and automatically converges to US$6 without re-pairing.
Its old proofs are gone and its authority is unchanged. It then pays US$1 itself;
all three devices converge to US$5 with eight paid operations and mint-confirmed
UNSPENT remaining proofs. The test models a long absence through pruned history
and spent proofs; it does not wait for days of wall-clock time.

Relay-frame assertions cover mnemonic, sync secret and proof secrets observed
at every monetary checkpoint, plus absence of plaintext accounting fields.
Connection assertions restrict destinations to the configured services and local
PWA. These are bounded leak checks, not a proof of network anonymity: relays and
mints still observe connection metadata and timing, and paired devices hold the
same spending authority.

## Verification status

Wallet units: **390 passed, 16 skipped**, across 36 passing files. Production PWA
build, changed-file lint, formatting checks and `git diff --check` passed.

All five live scenarios passed on the final build in two isolated runs:

| Scenario                                                                                                                                                       | Result                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Three paired wallets, varied operations, three simultaneous buys/payments, mixed race, stale history, lost mint/swap responses, reload, removal and re-pairing | Passed, 9.5 minutes; 20 paid operations; final US$19 on all three devices |
| Every old token spent, 19-revision gap, automatic recovery and subsequent spend                                                                                | Passed, 3.4 minutes; US$20 stale → US$6 current → US$5 after spending     |
| Paid invoice automatically claimed after reopening                                                                                                             | Passed                                                                    |
| Lightning payment with lost successful melt response                                                                                                           | Passed                                                                    |
| Offline startup, local export and automatic reconnection                                                                                                       | Passed                                                                    |

The main run also passed its checks for equal proof sets, mint-confirmed UNSPENT
remaining proofs, exact accounting, clear journals, unique history entries,
allowed network destinations, no page errors, and the relay plaintext checks
described above. No Playwright retry was needed in either final run.

Earlier runs exposed quote waits, a fault fixture that missed an automatic peer
claim, a short removal wait, an interleaving that advanced quote accounting before
restoring outputs, and a relay head-read timeout during the mixed race. These
have regression coverage. One earlier final pairing expired after the host slept;
final runs used an idle sleep inhibitor scoped to the test process.

The old-token case starts with a settled journal. This does not validate an old
unresolved response whose completion checkpoint and subsequently spent outputs
have both disappeared from retained history. The safeguards preserve that local
journal; that combination may still require manual export/reconciliation.

## Publication

Seven atomic implementation/test commits were merged into `main` as
`8af073f94df8cf37d4cf36b98402e54f90e84713` and pushed to GitHub.
The tested tree is unchanged by the merge. GitHub Actions run
[37867598005](https://github.com/brenorb/cashu-sync/actions/runs/37867598005)
passed its unit, relay, PWA, subpath-smoke and Pages deployment jobs.

The Fly wallet was deployed from a clean archive of that merge, using the existing
wallet-only remote-build configuration. Both Amsterdam machines passed Fly's
deployment checks and are started on the new image. See
[the deployment record](../fly-demo.md#three-wallet-recovery-deployment--2026-10-08)
for the image digest.

The public URL returned HTTP 200 and a fresh browser loaded the new build marker,
displayed `Wallet synchronized.`, and reported no uncaught page errors. Two fresh,
isolated Chrome contexts at 390 × 844 pixels completed pairing using the public
QR URL, then displayed equal zero balances and synchronized status. The QR's
origin was `https://cashu-sync-wallet.fly.dev`, with no localhost address.
Service workers were allowed in this deployment smoke check. It does not replace
physical-phone testing or a full installed-PWA upgrade test.

Public wallet: [cashu-sync-wallet.fly.dev](https://cashu-sync-wallet.fly.dev/#/wallet).
Existing clients should reload to load the update. The known unresolved-journal
coverage limitation described above remains applicable.
