# OperationJournal

TLC reached 140 states and 404 steps. The chart draws 13 states and 28 arrows.
The chart does not draw 102 steps that stay in one chart state.
The view hides 140 steps, so the chart does not draw them.

## OneInitialPostPerOperation breaks
The shortest path has 8 steps:
0. Wallet ready
1. Prepare payment: Payment prepared
2. Save payment intent to relay: First wallet can send payment
3. Second wallet loads the saved payment: First wallet can send payment
4. First wallet records that it will send: First wallet can send payment
5. Send payment request: One request sent to mint
6. Other wallet resumes and saves the same intent: One request sent to mint
7. Second wallet records that it will send: One request sent to mint
8. Send payment request: Both wallets sent the same request

## Rules that hold
DurableBeforeFirstPost, OnlyTerminalClears, NoDeadlock
