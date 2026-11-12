# BrowserLifecycle

TLC reached 132 states and 670 steps. The chart draws 7 states and 19 arrows.
The chart does not draw 56 steps that stay in one chart state.
The view hides 374 steps, so the chart does not draw them.

## SynchronizedMeansNoPendingJournal breaks
The shortest path has 2 steps:
0. Starting synchronized wallet
1. Find an unfinished payment: Recovering previous payment
2. Relay socket connects: Wallet says synchronized while payment is pending

## Rules that hold
NoDeadlock
