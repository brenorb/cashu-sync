# Snapshot sync performance — 2026-08-20

## Result

Snapshot encoding is roughly 2x faster, and full encrypted/signed event creation is roughly 7% faster on the local benchmark workload. The change keeps validation and the 60 KB plaintext limit intact.

## Benchmark

Command:

```sh
cd wallet
npx vitest bench src/sync/__benchmarks__/snapshotCodec.bench.ts --run --no-color
```

Workload: an 80-proof, 20-counter, 40-history-entry USD snapshot. Results are one local Vitest benchmark run; the benchmark itself collected 1,024–2,019 samples per case.

| Operation | Before mean | After mean | Mean change | Throughput change |
| --- | ---: | ---: | ---: | ---: |
| Encode and validate snapshot | 0.4891 ms | 0.2477 ms | **−49.4%** | **+97.5%** |
| Create encrypted + signed event | 10.4244 ms | 9.7008 ms | **−6.9%** | **+7.5%** |

Before: 2,044.67 ops/s for encoding and 95.9292 ops/s for full event creation.

After: 4,037.67 ops/s for encoding and 103.08 ops/s for full event creation.

## Bottleneck and fix

`createSyncEventV0` validated the snapshot with `decodeSnapshotV0`, then called `encodeSnapshotV0`, which validated it again. The size check also canonicalized the snapshot before the final encoding.

`decodeAndEncodeSnapshotV0` now parses, validates, size-checks, and returns the canonical JSON in one pass. The public decode/encode APIs retain their existing behavior; event creation reuses that validated result.

## TDD and verification

- Added the codec regression test before implementation; it failed with the expected missing-function error.
- Focused snapshot and crypto tests: 27 passed.
- Full suite: **328 passed, 16 skipped** across 35 files.
- ESLint: passed.
- PWA production build: passed. The existing large-chunk and `eval` warnings remain; this codec change did not materially change shipped asset sizes.

Commits:

- `a371da8 perf(wallet): add snapshot sync benchmark`
- `20ea127 perf(wallet): avoid duplicate snapshot serialization`

The benchmark is [snapshotCodec.bench.ts](../../wallet/src/sync/__benchmarks__/snapshotCodec.bench.ts); the implementation is [snapshotCodec.ts](../../wallet/src/sync/snapshotCodec.ts) and [syncCrypto.ts](../../wallet/src/sync/syncCrypto.ts).
