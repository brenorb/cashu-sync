import { bench, describe } from "vitest";
import { createSyncEventV0 } from "src/sync/syncCrypto";
import { encodeSnapshotV0 } from "src/sync/snapshotCodec";
import type { SnapshotV0 } from "src/sync/types";
import snapshotFixture from "../__fixtures__/snapshot-v0.json";

const CONFIGURED_MINT = "https://usd-mint.example";
const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

const snapshot: SnapshotV0 = {
  ...(JSON.parse(JSON.stringify(snapshotFixture)) as SnapshotV0),
  proofs: Array.from({ length: 80 }, (_, index) => ({
    id: "00c0ffee",
    amount: index + 1,
    secret: `proof-secret-${index}`,
    C: `02${"b".repeat(64)}`,
    reserved: false,
  })),
  counters: Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`keyset-${index}`, index + 1])
  ),
  history: Array.from({ length: 40 }, (_, index) => ({
    id: `mint:quote-${index}`,
    direction: "mint" as const,
    quote: `quote-${index}`,
    amount: index + 1,
    request: `lnbc1request${index}`,
    memo: "benchmark entry",
    date: "2026-08-13T10:00:00.000Z",
    status: "paid" as const,
    mint: CONFIGURED_MINT,
    unit: "usd" as const,
    paid_date: "2026-08-13T10:01:00.000Z",
  })),
};

describe("snapshot sync performance", () => {
  bench("encode and validate a realistic snapshot", () => {
    encodeSnapshotV0(snapshot, { expectedMint: CONFIGURED_MINT });
  });

  bench("create an encrypted and signed sync event", () => {
    createSyncEventV0(snapshot, SECRET, {
      expectedMint: CONFIGURED_MINT,
      createdAt: 1780000000,
    });
  });
});
