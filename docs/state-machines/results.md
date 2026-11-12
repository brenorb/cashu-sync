# Verification results

TLC 1.7.4 (release artifact, checker banner TLC2 2.19) explored the configured finite models with one worker. The count in each row is for the complete state graph. These are safety checks. The models admit stuttering while waiting, so a generated report's `NoDeadlock` label is not a liveness, fairness, retry-timing or eventual recovery result.

| Model / skill | Distinct states | Rules that held | Rules with a shortest counterexample |
|---|---:|---|---|
| [Authority and recovery](../../.cursor/skills/verify-authority-recovery/SKILL.md) | 63 | Never replace a funded wallet; never invent a remembered genesis; erase only after a confirmed backup. | — |
| [Browser lifecycle](../../.cursor/skills/verify-browser-lifecycle/SKILL.md) | 132 | — | [SynchronizedMeansNoPendingJournal](charts/browser-lifecycle-report.md) |
| [Local persistence](../../.cursor/skills/verify-local-persistence/SKILL.md) | 47 | Disjoint local counter reservations; allocated counters remain below cursor; head and rows commit together. | — |
| [Operation journal](../../.cursor/skills/verify-operation-journal/SKILL.md) | 140 | Durable marker before each first request; only a terminal response can clear the journal. | [OneInitialPostPerOperation](charts/operation-journal-report.md) |
| [Pairing](../../.cursor/skills/verify-pairing/SKILL.md) | 40 | Different funded authority is preserved. | [AckMeansImported and HeadSuccessMeansImported](charts/pairing-report.md) |
| [Pairing relay](../../.cursor/skills/verify-pairing-relay/SKILL.md) | 10 | The query sends only a fresh matching capture. | — |
| [Relay transport](../../.cursor/skills/verify-relay-transport/SKILL.md) | 44 | Publish follows auth; delivery requires active auth; publish does not automatically retry. | — |
| [Release and fixtures](../../.cursor/skills/verify-release-fixtures/SKILL.md) | 65 | A PR cannot deploy; a ready fixture passed the capability check. | — |
| [Snapshot relay](../../.cursor/skills/verify-snapshot-relay/SKILL.md) | 12 | One winner for the same parent; head retained; unadmitted writer cannot advance it; quota bounded. | — |
| [Snapshot sync](../../.cursor/skills/verify-snapshot-sync/SKILL.md) | 246 | Pending journal needs resolution evidence; a pruned-history recovery drops a proof only with a spent verdict and no journal ownership; corrected state needs relay acceptance to be marked confirmed in the model. | — |
| [Wallet payments](../../.cursor/skills/verify-wallet-payments/SKILL.md) | 23 (buy: 11, spend: 12) | Shown quote has a local record. | [SuccessMeansPaid](charts/spend-report.md) |

Across the 11 models, TLC explored 822 distinct states and checked 28 invariants: 23 held and 5 failed.

## Findings replayed against source

| Rule | Shortest path and effect | What the source replay checked |
|---|---|---|
| `AckMeansImported` | Show QR → join scans → encrypted authority arrives → funded joiner refuses replacement → host sees ACK and reports success. | Ran the real host/join handshake over an in-memory relay and the real `finishPairing`/ `applyPairing` component methods with the runtime's funded-wallet refusal. The original wallet was reported as preserved and the host got its completion callback. The existing runtime test separately checks preservation. |
| `HeadSuccessMeansImported` | Show QR → an unrelated snapshot arrives → host says paired. | Ran the real `createPairing` method with a simulated head watcher. The baseline head did nothing; a different head fired success with no joiner or ACK. |
| `OneInitialPostPerOperation` | A prepares and publishes → B pulls that prepared state → A durably marks and sends → B publishes a child of A's prepared head, marks and sends the same request. | Ran two real coordinators with separate in-memory journals and one compare-and-swap relay fake. Both invoked the gateway once with the same exact preview. Both simulated responses were lost. This establishes duplicate calls at the gateway boundary; it does not establish duplicate mint issuance or Lightning settlement. |
| `SuccessMeansPaid` | Request spend quote → confirm → mint returns UNPAID → journal clears → dialog says “Credits spent and synchronized.” | Passed UNPAID through the real coordinator and checked that it finalizes and returns `completed`. Passed that completion shape to the real spend dialog method and checked the success copy and closure. The real journal's existing tests cover releasing exact reserved inputs when finalizing an UNPAID result. |
| `SynchronizedMeansNoPendingJournal` | Boot with unfinished payment → relay socket connects → badge says synchronized while the page is still in recovery. | Ran the real `startWatchingWallet` callback with recovery set and the watcher reporting connected. Copy changed while `recoveryNeeded` remained true and `walletReady` remained false. |

The replays use test fixtures and fake external interfaces. They do not use a deployed wallet, live mint, real funds or real recovery data. No runtime code was changed.

## Run the checks

From the repository root:

~~~sh
./verification/check.sh pairing
python3 verification/replays/run.py findings
python3 verification/replays/run.py pairing
~~~

The first command downloads the pinned TLC jar into a temporary directory, verifies its digest and runs the model. Use `TLA2TOOLS=/absolute/path/to/tla2tools.jar` to reuse a pinned jar and `JAVA=/absolute/path/to/java` if Java 11+ is not on PATH. Known violations still produce a nonzero result; compare the rule names and shortest paths to this report. Use the [diagram instructions](flows.md#regenerate) to rerun pstack with a fresh output directory.

Source replays use Python 3.12+, the committed source from `HEAD` and the existing wallet dependencies installed with `npm ci`. For the Go guards, use the toolchain in `relay/go.mod` (`GO` can name its executable). All eleven guard runs passed on the original code, failed with one deliberately broken source guard, and passed after restoring that source in the temporary checkout. That exercises the link between the model and selected source guards; the checker does not run TypeScript or Go. For future model drift use pstack `/maintain-formal-verification-skill`.

The full wallet unit suite ran 396 passing tests with 16 skipped, and the Go relay suite passed. All seven audit replay checks passed, including a reconnecting-state control.

The existing docs contract script fails at the baseline on the missing `create-auto-pair` UI marker. The Docker-dependent Nutshell reference contract was not run past its Docker prerequisite. The models do not cover cross-store crash atomicity, the external mint's monetary semantics, or the legacy feature implementations inventoried separately.
