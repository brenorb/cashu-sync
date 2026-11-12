# Cashu Sync user flows

These seven diagrams come from the finite model state graphs, projected to what users can do or see. Red means an invariant fails; blue borders mark a shortest route to it. See [results](results.md) for source replays and [the audit](README.md) for the scope.

## Pair a second device

A changed head can show success without a joiner, and an ACK can show success when the joiner kept its existing wallet.

[Open full-size SVG](charts/pairing.svg) · [Mermaid source](charts/pairing.mmd) · [TLC statechart report](charts/pairing-report.md)

![Pair a second device statechart](charts/pairing.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Pair a second device"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks AckMeansImported or HeadSuccessMeansImported
    lg1: Path to the AckMeansImported or HeadSuccessMeansImported bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Sync devices
  s1: Pairing needs attention
  s2: Pairing QR ready
  s3: Host closed the pairing screen
  s4: Joining wallet waits for a response
  s5: Host reports success after unrelated activity
  s6: Joining wallet checks the authority
  s7: Joining wallet imported
  s8: Existing wallet preserved
  s9: Both wallets paired
  s10: Host reports success after import refused
  s11: Pairing cancelled on joining wallet
  [*] --> s0
  s0 --> s1: Link is invalid or expired
  s0 --> s2: Show pairing QR
  s2 --> s3: Leave pairing screen
  s2 --> s1: Link is invalid or expired
  s2 --> s4: Scan or open the pairing link
  s2 --> s5: Relay head changes
  s1 --> s3: Leave pairing screen
  s4 --> s1: No response before deadline
  s4 --> s6: Host sends encrypted wallet authority
  s6 --> s7: Joining wallet starts with that authority
  s6 --> s8: Different wallet contains local data
  s5 --> s9: Joining wallet starts with that authority
  s7 --> s9: Relay head changes or Host receives acknowledgement
  s8 --> s10: Host receives acknowledgement
  s8 --> s11: Keep current wallet
  s11 --> s10: Host receives acknowledgement
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s2 bugPath
  class s4 bugPath
  class s5 breaks
  class s5 bugPath
  class s6 bugPath
  class s8 bugPath
  class s10 breaks
  class s10 bugPath
~~~

</details>

## Buy credits

The invoice has to be paid and credits recorded before the success state. Payment and mint confirmation are external events.

[Open full-size SVG](charts/buy.svg) · [Mermaid source](charts/buy.mmd) · [TLC statechart report](charts/buy-report.md)

![Buy credits statechart](charts/buy.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Buy credits"
---
stateDiagram-v2
  s0: Wallet
  s1: Enter amount
  s2: Requesting invoice
  s3: Saving invoice
  s4: Lightning invoice
  s5: Check sync before paying
  s6: Invoice paid, ready to claim
  s7: Claiming credits
  s8: Credits recorded
  s9: Recovering your purchase
  s10: Credits bought and synchronized
  [*] --> s0
  s0 --> s1: Tap Buy credits
  s1 --> s2: Request invoice
  s2 --> s1: Could not request invoice
  s2 --> s3: Invoice received
  s3 --> s1: Wallet changed elsewhere
  s3 --> s4: Invoice ready
  s3 --> s5: Relay did not confirm the invoice
  s4 --> s6: Pay the Lightning invoice
  s6 --> s7: Claim credits or automatic claim
  s7 --> s6: Another payment settled first
  s7 --> s8: Mint confirms credit
  s7 --> s9: Payment status still unknown
  s8 --> s10: Balance and history updated
  s9 --> s6: Another payment settled first
  s9 --> s8: Mint confirms credit
~~~

</details>

## Spend credits or top up an eSIM

The red path ends in the same success message after the mint returned UNPAID. The journal was cleared and the inputs released.

[Open full-size SVG](charts/spend.svg) · [Mermaid source](charts/spend.mmd) · [TLC statechart report](charts/spend-report.md)

![Spend credits or top up an eSIM statechart](charts/spend.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Spend credits or top up an eSIM"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks SuccessMeansPaid
    lg1: Path to the SuccessMeansPaid bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Wallet
  s1: Enter amount or paste invoice
  s2: Requesting spend quote
  s3: Saving spend quote
  s4: Review amount and fee
  s5: Check sync before paying
  s6: Paying
  s7: Payment confirmed
  s8: Unpaid, journal cleared
  s9: Recovering your spend
  s10: Credits spent and synchronized
  s11: Credits spent shown for unpaid invoice
  [*] --> s0
  s0 --> s1: Tap Top up or Pay invoice
  s1 --> s2: Get spend quote
  s2 --> s1: Invalid amount, invoice or quote unavailable
  s2 --> s3: Quote received
  s3 --> s1: Wallet changed elsewhere
  s3 --> s4: Quote ready
  s3 --> s5: Relay did not confirm the quote
  s4 --> s6: Confirm spend
  s6 --> s4: Another payment settled first
  s6 --> s7: Mint confirms payment
  s6 --> s8: Mint says unpaid and inputs are released
  s6 --> s9: Payment status still unknown
  s7 --> s10: Wallet closes the spend dialog
  s8 --> s11: Wallet closes the spend dialog
  s9 --> s4: Another payment settled first
  s9 --> s7: Mint confirms payment
  s9 --> s8: Mint says unpaid and inputs are released
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s1 bugPath
  class s2 bugPath
  class s3 bugPath
  class s4 bugPath
  class s6 bugPath
  class s8 bugPath
  class s11 breaks
  class s11 bugPath
~~~

</details>

## Reconnect after missing updates

When history is pruned, the wallet asks the mint which tokens remain usable. An unconfirmed relay save can leave the correction on the local device.

[Open full-size SVG](charts/snapshot-sync.svg) · [Mermaid source](charts/snapshot-sync.mmd) · [TLC statechart report](charts/snapshot-sync-report.md)

![Reconnect after missing updates statechart](charts/snapshot-sync.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Reconnect a wallet after missing updates"
---
stateDiagram-v2
  s0: Local wallet opens
  s1: Looking for changes from other devices
  s2: Wallet synchronized
  s3: Local wallet preserved
  s4: Old relay history gone, checking tokens
  s5: Mint confirms spendable tokens
  s6: Saving reconciled wallet
  s7: Correction retained on this device
  [*] --> s0
  s0 --> s1: Open, reconnect or switch back to wallet
  s1 --> s2: Apply verified wallet state or No newer wallet state
  s1 --> s3: Cannot safely verify newer state
  s1 --> s4: Relay no longer retains the full history
  s3 --> s1: Retry synchronization
  s4 --> s3: Cannot safely verify newer state
  s4 --> s5: Keep usable tokens and quarantine pending ones
  s5 --> s6: Send correction to relay
  s6 --> s7: Relay could not confirm correction
  s6 --> s2: Relay confirms correction
~~~

</details>

## Back up, restore or remove a wallet

Restore refuses to overwrite a different funded wallet or create an empty replacement for a remembered backup. Removal waits for a confirmed relay save.

[Open full-size SVG](charts/authority-recovery.svg) · [Mermaid source](charts/authority-recovery.mmd) · [TLC statechart report](charts/authority-recovery-report.md)

![Back up, restore or remove a wallet statechart](charts/authority-recovery.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Back up, restore or remove this wallet"
---
stateDiagram-v2
  s0: Recovery settings
  s1: Reading backup
  s2: Encrypted backup downloaded
  s3: Checking wallet before removal
  s4: Checking the configured mint
  s5: Wallet preserved, action needs attention
  s6: Fetching wallet state
  s7: Relay backup confirmed
  s8: Wallet restored
  s9: Preparing empty local wallet
  s10: Wallet removed from this device
  s11: Resuming the previous payment
  [*] --> s0
  s0 --> s1: Choose backup and enter passphrase
  s0 --> s2: Download with matching passphrases
  s0 --> s3: Confirm removal from device
  s1 --> s4: Device is empty
  s1 --> s5: Cannot decrypt backup or Device already has a different wallet
  s1 --> s6: Backup belongs to this wallet
  s2 --> s1: Choose backup and enter passphrase
  s3 --> s5: Payment pending or backup unconfirmed
  s3 --> s7: Relay confirms saved wallet
  s4 --> s5: Mint unavailable or incompatible
  s4 --> s9: Mint passed the check
  s5 --> s1: Choose backup and enter passphrase
  s6 --> s5: Relay restore failed, retry possible
  s6 --> s8: Start wallet with no remembered backup or Relay snapshot loaded
  s7 --> s10: Clear device data
  s6 --> s11: Local payment still needs recovery
  s9 --> s6: Open wallet from backup
~~~

</details>

## Open the wallet and recover a payment

The badge can say synchronized as soon as the relay socket connects, even though the wallet is recovering a payment.

[Open full-size SVG](charts/browser-lifecycle.svg) · [Mermaid source](charts/browser-lifecycle.mmd) · [TLC statechart report](charts/browser-lifecycle-report.md)

![Open the wallet and recover a payment statechart](charts/browser-lifecycle.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "Open the wallet and recover a payment"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks SynchronizedMeansNoPendingJournal
    lg1: Path to the SynchronizedMeansNoPendingJournal bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Starting synchronized wallet
  s1: Wallet ready
  s2: Startup needs attention
  s3: Recovering previous payment
  s4: Pair or restore this wallet
  s5: Reconnecting wallet
  s6: Wallet says synchronized while payment is pending
  [*] --> s0
  s0 --> s1: Wallet state is ready
  s0 --> s2: Wallet startup failed
  s0 --> s4: No wallet profile
  s0 --> s3: Find an unfinished payment
  s1 --> s5: Relay connection drops
  s2 --> s1: Previous payment resolved
  s3 --> s1: Previous payment resolved
  s3 --> s5: Relay connection drops
  s3 --> s6: Relay socket connects
  s5 --> s1: Relay socket connects or Previous payment resolved
  s1 --> s0: App update reloads the page
  s2 --> s0: App update reloads the page
  s5 --> s6: Relay socket connects
  s3 --> s0: App update reloads the page
  s6 --> s1: Previous payment resolved
  s6 --> s5: Relay connection drops
  s4 --> s0: App update reloads the page
  s5 --> s0: App update reloads the page
  s6 --> s0: App update reloads the page
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s3 bugPath
  class s6 breaks
  class s6 bugPath
~~~

</details>

## Two wallets resume the same payment

The red path is two gateway calls for the same prepared request. The replay ends at the gateway boundary.

[Open full-size SVG](charts/operation-journal.svg) · [Mermaid source](charts/operation-journal.mmd) · [TLC statechart report](charts/operation-journal-report.md)

![Two wallets resume the same payment statechart](charts/operation-journal.svg)

<details>
<summary>Mermaid text</summary>

~~~mermaid
---
title: "What two devices can do with the same pending payment"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks OneInitialPostPerOperation
    lg1: Path to the OneInitialPostPerOperation bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Wallet ready
  s1: Payment prepared
  s2: Stopped before sending
  s3: First wallet can send payment
  s4: Waiting to confirm relay save
  s5: Second wallet also allowed to send
  s6: One request sent to mint
  s7: Recovering the payment
  s8: Mint result saved
  s9: Relay saved the result
  s10: Mint reports payment pending
  s11: Result recorded on device
  s12: Both wallets sent the same request
  [*] --> s0
  s0 --> s1: Prepare payment
  s1 --> s2: Intent rejected or superseded
  s1 --> s3: Save payment intent to relay
  s1 --> s4: Save payment intent to relay
  s3 --> s3: Second wallet loads the saved payment or First wallet records that it will send
  s4 --> s3: Confirm previous save
  s3 --> s5: Other wallet resumes and saves the same intent
  s4 --> s5: Other wallet resumes and saves the same intent
  s3 --> s6: Send payment request
  s3 --> s7: Payment result unknown after interruption
  s6 --> s8: Record mint result
  s6 --> s7: Payment result unknown after interruption
  s7 --> s8: Record mint result
  s5 --> s6: Send payment request
  s6 --> s6: Other wallet resumes and saves the same intent or Second wallet records that it will send
  s8 --> s9: Save final result to relay
  s8 --> s10: Wait for settlement
  s7 --> s5: Other wallet resumes and saves the same intent
  s9 --> s11: Update device from saved result
  s6 --> s5: Record mint result or Payment result unknown after interruption
  s10 --> s8: Record mint result
  s8 --> s5: Other wallet resumes and saves the same intent
  s6 --> s12: Send payment request
  s10 --> s5: Other wallet resumes and saves the same intent
  s5 --> s7: Send payment request
  s5 --> s12: Send payment request
  s5 --> s8: Send payment request
  s5 --> s10: Send payment request
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s1 bugPath
  class s3 bugPath
  class s6 bugPath
  class s12 breaks
  class s12 bugPath
~~~

</details>

## Regenerate

Use the current pstack `/statechart` entry point. Work in a temporary directory and copy in the relevant subsystem folder. Set `STATECHART` to the installed `scripts/statechart` executable, or use the equivalent command in the skill. To reuse local TLC, set `TLA2TOOLS` and `JAVA` as described in [results](results.md).

| Flow | Module | Config | View |
|---|---|---|---|
| Pair a second device | [Pairing.tla](../../verification/pairing/Pairing.tla) | [Pairing.cfg](../../verification/pairing/Pairing.cfg) | [view.mjs](../../verification/pairing/view.mjs) |
| Buy credits | [WalletPayments.tla](../../verification/wallet-payments/WalletPayments.tla) | [Buy.cfg](../../verification/wallet-payments/Buy.cfg) | [buy.mjs](../../verification/wallet-payments/buy.mjs) |
| Spend credits or top up an eSIM | [WalletPayments.tla](../../verification/wallet-payments/WalletPayments.tla) | [Spend.cfg](../../verification/wallet-payments/Spend.cfg) | [spend.mjs](../../verification/wallet-payments/spend.mjs) |
| Reconnect after missing updates | [SnapshotSync.tla](../../verification/snapshot-sync/SnapshotSync.tla) | [SnapshotSync.cfg](../../verification/snapshot-sync/SnapshotSync.cfg) | [view.mjs](../../verification/snapshot-sync/view.mjs) |
| Back up, restore or remove a wallet | [AuthorityRecovery.tla](../../verification/authority-recovery/AuthorityRecovery.tla) | [AuthorityRecovery.cfg](../../verification/authority-recovery/AuthorityRecovery.cfg) | [view.mjs](../../verification/authority-recovery/view.mjs) |
| Open the wallet and recover a payment | [BrowserLifecycle.tla](../../verification/browser-lifecycle/BrowserLifecycle.tla) | [BrowserLifecycle.cfg](../../verification/browser-lifecycle/BrowserLifecycle.cfg) | [view.mjs](../../verification/browser-lifecycle/view.mjs) |
| Two wallets resume the same payment | [OperationJournal.tla](../../verification/operation-journal/OperationJournal.tla) | [OperationJournal.cfg](../../verification/operation-journal/OperationJournal.cfg) | [view.mjs](../../verification/operation-journal/view.mjs) |

For example, from the repository root:

~~~sh
scratch=$(mktemp -d)
cp verification/pairing/Pairing.tla verification/pairing/Pairing.cfg verification/pairing/view.mjs "$scratch/"
cd "$scratch"
"$STATECHART" Pairing.tla --config Pairing.cfg --view view.mjs --out "$scratch/output"
~~~

A counterexample run may exit nonzero and still emit the diagram and report. The figures use Pele 1.9.0. The views collapse steps that do not change a displayed label and suppress wait stutters. The pairing view suppresses repeated close-screen and unrelated-head arrows while retaining both shortest failure paths. The browser view also suppresses camera and service-worker installation, and the journal view collapses redundant writes where the user sees no change; the numbered reports retain intermediate steps needed to follow a counterexample. No timing or eventual progress is inferred from these charts.
