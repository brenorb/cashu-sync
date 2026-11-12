# Verification results

All 28 invariants pass across the 11 models. TLC 1.7.4 explored 1,469 distinct states. The models allow waiting, so the reports’ `NoDeadlock` result does not establish eventual recovery or retry timing.

| Model | Outcome | Distinct states | Rules checked |
|---|---|---:|---|
| [Authority and recovery](../../.cursor/skills/verify-authority-recovery/SKILL.md) | In sync | 63 | Preserve a funded wallet, require the remembered genesis head, and confirm backup before removal. |
| [Browser lifecycle](../../.cursor/skills/verify-browser-lifecycle/SKILL.md) | Updated | 144 | The synchronized badge requires a clear journal. |
| [Local persistence](../../.cursor/skills/verify-local-persistence/SKILL.md) | In sync | 47 | Disjoint counter reservations, a monotonic allocation cursor, and atomic head and row writes. |
| [Operation journal](../../.cursor/skills/verify-operation-journal/SKILL.md) | Updated | 750 | Durable acceptance before the first request, one initial submission per exact prepared request, and terminal evidence before clearing. |
| [Pairing](../../.cursor/skills/verify-pairing/SKILL.md) | Updated | 62 | Preserve a different funded wallet, acknowledge after import, and require the ACK for host success. |
| [Pairing relay](../../.cursor/skills/verify-pairing-relay/SKILL.md) | In sync | 10 | Deliver only a fresh matching capture. |
| [Relay transport](../../.cursor/skills/verify-relay-transport/SKILL.md) | In sync | 44 | Auth before publish and delivery, with automatic retries limited to reads or the watcher. |
| [Release and fixtures](../../.cursor/skills/verify-release-fixtures/SKILL.md) | In sync | 65 | PRs cannot deploy. Fixture readiness requires a capability check. |
| [Snapshot relay](../../.cursor/skills/verify-snapshot-relay/SKILL.md) | In sync | 12 | One winner per parent, head retention, authorized writes, and bounded quota. |
| [Snapshot sync](../../.cursor/skills/verify-snapshot-sync/SKILL.md) | In sync | 246 | Preserve journals and proofs during recovery. Confirm a corrected snapshot with the relay. |
| [Wallet payments](../../.cursor/skills/verify-wallet-payments/SKILL.md) | Updated | 26 | Show only a stored quote. A successful spend requires a paid quote. |

The original models reproduced all five source-backed findings. Each updated model preserves the safety property. The pairing head rule now requires a matching acknowledgement for any host success. The journal model covers both a new operation and a legacy prepared head, with either device able to win the relay write. Its chart uses one symmetric melt scenario to stay within pstack’s diagram size limit.

| Rule | Before | After | Regression witness |
|---|---|---|---|
| `AckMeansImported` | A funded joiner refused import but still sent an ACK. | A refused import returns false and sends no ACK. The joining screen waits for ACK publication before navigating after a successful import. | Force the ACK on refusal and observe the host’s completion callback. |
| `HeadSuccessMeansImported` | An unrelated relay update could show pairing success. | Only the bound pairing ACK can confirm host success. | Restore a snapshot watcher in the pairing screen and observe the unexpected subscription. |
| `SuccessMeansPaid` | An unpaid journal could finalize and close the dialog with a success message. | The wallet checks the requested quote in storage. Unpaid leaves the dialog open with a retry message. | Show success and close the dialog on an unpaid quote. |
| `SynchronizedMeansNoPendingJournal` | The relay socket could set the synchronized badge during recovery. | The socket reports a check in progress. Startup, retry and live checks read the journal before reporting synchronized. | Set the synchronized badge on connect while the journal is pending. |
| `OneInitialPostPerOperation` | A peer could advance an already published prepared journal and make another first request. | The relay accepts one submitted fence for the exact request. The direct winner records the fence locally before sending. Peers and lost acknowledgements use the recovery path. | Bypass the durable write or use a confirmed acknowledgement as permission to send. The source replays also cover a peer reading submitted state and two wallets racing from a legacy prepared head. |

The submission property covers the initial gateway call for an exact prepared request on updated clients. The gateway still supports exact-request recovery. For a Bolt11 melt, an unpaid lookup can race the first request. The gateway reuses the original quote and inputs under the pinned mint’s transactional quote and proof locks, and keeps the journal if the replay fails and the lookup is still unpaid. The model abstracts the mint locks, recovery retries, quote outcomes, and accounting amounts. It assumes compatible clients for new submissions and does not model a legacy client already in flight under the old protocol. [Nutshell’s transaction](https://github.com/cashubtc/nutshell/blob/18539020b4fa473ad8ad440e210720d2aaf8401a/cashu/mint/db/write.py#L450-L475)

Run a model, source replay, or scratch guard check from the repository root.

~~~sh
./verification/check.sh operation-journal
python3 verification/replays/run.py findings
python3 verification/replays/run.py operation-direct
~~~

The runner verifies the pinned TLC jar digest. Set `TLA2TOOLS` to a local copy and `JAVA` to Java 11+ if needed. Source replays use Python 3.12+, the committed source at `HEAD`, wallet dependencies installed with `npm ci`, and the Go toolchain in `relay/go.mod`. The [chart regeneration instructions](flows.md#regenerate) list the exact model and view files.

## Checked against the wallet

- The full wallet unit suite passed 392 tests with 16 skipped. All Go relay tests, the Pages PWA build and smoke check, and the documentation contract passed.
- All 10 source replays passed. All 15 scratch source mutations failed the expected check and passed after restoration. Each of the five model mutations violated its intended invariant.
- Six Playwright cases passed with the default relay budgets. The three-wallet stress case hit the default read quota during the mixed buy and spend race. It passed on a disposable relay set to 3,000 reads and 600 writes per minute, including recovery after pruned history, lost successful mint and swap responses, and re-pairing after device removal. The test captures frames from the configured snapshot relay URL, including loopback URLs.
- Docker was unavailable for the Compose wrapper. The browser run used the pinned Nutshell 0.20.3 FakeWallet source and Redis 7.4.5 on loopback. The temporary Python build omitted the unused Spark backend because its pinned wheel was unavailable on this host. The fixture passed the project's Nutshell version, USD Bolt11, proof-state, restore, subscription and cache capability check.
