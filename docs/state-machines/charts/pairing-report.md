# Pairing

TLC reached 40 states and 97 steps. The chart draws 12 states and 16 arrows.
The chart does not draw 16 steps that stay in one chart state.
The view hides 55 steps, so the chart does not draw them.

## HeadSuccessMeansImported breaks
The shortest path has 2 steps:
0. Sync devices
1. Show pairing QR: Pairing QR ready
2. Relay head changes: Host reports success after unrelated activity

## AckMeansImported breaks
The shortest path has 5 steps:
0. Sync devices
1. Show pairing QR: Pairing QR ready
2. Scan or open the pairing link: Joining wallet waits for a response
3. Host sends encrypted wallet authority: Joining wallet checks the authority
4. Different wallet contains local data: Existing wallet preserved
5. Host receives acknowledgement: Host reports success after import refused

## Rules that hold
FundedWalletPreserved, NoDeadlock
