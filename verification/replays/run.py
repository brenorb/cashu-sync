#!/usr/bin/env python3
"""Replay the audit or check a deliberately broken source guard in a temp checkout."""
import argparse
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SYNC = "wallet/src/sync/"
V0 = "wallet/src/pages/V0WalletPage.vue"
AUDIT = ("automaticPairing", "syncOperationCoordinator")

def vitest(stem, case):
    file = stem if "/" in stem else f"src/sync/__tests__/{stem}.test.ts"
    return "wallet", ["npm", "run", "test:ci", "--", "--no-cache", file, "-t", case]

def go(package, case):
    return "relay", [os.environ.get("GO", "go"), "test", "./internal/" + package, "-run", "^" + case + "$", "-count=1"]

CASES = {
    "authority-recovery": (
        SYNC + "walletSyncRuntime.ts", 'authority.head_event_id !== ""',
        'false && authority.head_event_id !== ""',
        vitest("walletSyncRuntime", "fails closed when a remembered recovery head is absent"),
    ),
    "browser-lifecycle": (
        V0, 'status === "disconnected" || status === "connecting"',
        'false && (status === "disconnected" || status === "connecting")',
        vitest("automaticPairing", "audit: a disconnected watcher reports reconnecting"),
    ),
    "local-persistence": (
        SYNC + "durableCounterSource.ts", "counters: { ...state.counters, [id]: next }",
        "counters: { ...state.counters, [id]: start }",
        vitest("localPersistence", "reserves disjoint ranges concurrently and persists across restart"),
    ),
    "operation-journal": (
        SYNC + "syncOperationCoordinator.ts", 'await this.journal.acceptSubmission(candidate, published.eventId);',
        '// Deliberately bypass the local submission write in this scratch copy.',
        vitest("syncOperationCoordinator", "never submits if the accepted fence is not durable locally"),
    ),
    "pairing": (
        SYNC + "syncRuntimeService.ts", "if (hasLocalWalletData) {",
        "if (false && hasLocalWalletData) {",
        vitest("syncRuntimeService", "refuses to replace a different funded wallet"),
    ),
    "pairing-relay": (
        "relay/internal/pairingrelay/server.go", "s.prune(time.Now())",
        "// Deliberately retain expired entries in this scratch query.",
        go("pairingrelay", "TestMemoryStoreFiltersAndPrunesGiftWraps"),
    ),
    "relay-transport": (
        SYNC + "relayClient.ts", "eventId === operation.event.id",
        'typeof eventId === "string"',
        vitest("relayClient", "publishes only its own valid event and waits for the matching OK"),
    ),
    "release-fixtures": (
        ".github/workflows/pages.yml", "deploy:\n    if: github.event_name != 'pull_request'",
        "deploy:\n    if: always()",
        vitest("test/vitest/__tests__/pages-packaging.test.js", "deploys only the built wallet artifact"),
    ),
    "snapshot-relay": (
        "relay/internal/store/store.go", "if previous != current {",
        "if previous != current && false {",
        go("store", "TestAdvanceRejectsStaleChild"),
    ),
    "snapshot-sync": (
        SYNC + "proofReconciliation.ts", "if (proof.reserved && proof.quote)",
        "if (false && proof.reserved && proof.quote)",
        vitest("proofReconciliation", "preserves journal-owned inputs until their operation is reconciled"),
    ),
    "wallet-payments": (
        SYNC + "v0WalletService.ts", 'throw new Error("relay acknowledgement is ambiguous; sync before paying");',
        'await this.rollbackQuote(direction, quoteId);\n      throw new Error("relay acknowledgement is ambiguous; sync before paying");',
        vitest("v0WalletService", "keeps a quote after an ambiguous relay acknowledgement"),
    ),
}

def run(root, spec):
    cwd, args = spec
    return subprocess.run(args, cwd=root / cwd, capture_output=True, text=True, timeout=180)

def add_replays(root):
    for case, filename in zip(AUDIT, ("ui.inc.ts", "coordinator.inc.ts")):
        path = root / SYNC / "__tests__" / f"{case}.test.ts"
        with path.open("a") as target:
            target.write((HERE / filename).read_text())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["findings", *sorted(CASES)])
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="cashu-source-replay-") as d:
        root = Path(d)
        with (root / "source.tar").open("wb") as archive:
            subprocess.run(["git", "archive", "HEAD"], cwd=REPO, stdout=archive, check=True)
        with tarfile.open(root / "source.tar") as archive:
            archive.extractall(root, filter="data")
        if args.mode == "findings" or CASES[args.mode][3][0] == "wallet":
            deps = REPO / "wallet/node_modules"
            if not deps.is_dir():
                parser.error("Install wallet dependencies with npm ci first.")
            (root / "wallet/node_modules").symlink_to(deps, target_is_directory=True)
        add_replays(root)
        if args.mode == "findings":
            cwd, cmd = vitest(AUDIT[0], "audit:")
            result = run(root, (cwd, [*cmd, f"src/sync/__tests__/{AUDIT[1]}.test.ts"]))
            print(result.stdout, end="")
            print(result.stderr, end="")
            return result.returncode

        file, before, after, spec = CASES[args.mode]
        path = root / file
        original = path.read_text()
        if original.count(before) != 1:
            parser.error(f"Mutation anchor drifted in {file}; review source correspondence.")
        first = run(root, spec)
        if first.returncode:
            raise SystemExit("Baseline failed:\n" + first.stdout + first.stderr)
        path.write_text(original.replace(before, after, 1))
        broken = run(root, spec)
        output = broken.stdout + broken.stderr
        expected_failure = "AssertionError" if spec[0] == "wallet" else "--- FAIL: "
        if broken.returncode != 1 or expected_failure not in output:
            raise SystemExit("Expected a test assertion failure on the mutation:\n" + output)
        path.write_text(original)
        restored = run(root, spec)
        if restored.returncode:
            raise SystemExit("Restored source failed:\n" + restored.stdout + restored.stderr)
        print(f"{args.mode}: original passed, mutated guard failed, restored source passed")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
