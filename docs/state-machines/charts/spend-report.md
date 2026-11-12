# WalletPayments

TLC reached 12 states and 29 steps. The chart draws 12 states and 17 arrows.
The view hides 12 steps, so the chart does not draw them.

## SuccessMeansPaid breaks
The shortest path has 7 steps:
0. Wallet
1. Tap Top up or Pay invoice: Enter amount or paste invoice
2. Get spend quote: Requesting spend quote
3. Quote received: Saving spend quote
4. Quote ready: Review amount and fee
5. Confirm spend: Paying
6. Mint says unpaid and inputs are released: Unpaid, journal cleared
7. Wallet closes the spend dialog: Credits spent shown for unpaid invoice

## Rules that hold
QuoteBackedByLocalRecord, NoDeadlock
