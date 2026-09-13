# cashu-sync agent instructions

## Wallet recovery and availability

- Keep the wallet usable through failures. Blocking the user is the last resort, only after every safe recovery path is exhausted.
- Relay history is a fast synchronization aid. When it is missing, pruned, corrupt, or conflicting, automatically reconcile against the mint and preserve locally held tokens and durable operation results.
- Let users spend unaffected tokens they hold even when synchronization is degraded. The wallet can try to spend proofs whose spendability is uncertain, because the mint will tell if it worked or not; use this to correct the local view of spent, pending, and unspent proofs. Never treat a sync error as evidence that the entire balance is unusable.
- Use mint responses and failures to correct the local view of spent, pending, and unspent proofs. Retry with usable proofs when possible, without duplicating a payment or discarding recovery material.
- If automatic repair is impossible, provide an actionable recovery or re-pairing path that preserves local funds. Never leave the user at a raw protocol error.
- Test stale paired devices beyond relay retention, concurrent operations, reloads, and lost responses before claiming recovery is fixed.
