import { describe, expect, it } from "vitest";
import {
  decodeSnapshotV0,
  encodeSnapshotV0,
  SnapshotValidationError,
} from "src/sync/snapshotCodec";
import type { PendingMintV0, SnapshotV0 } from "src/sync/types";
import snapshotFixture from "../__fixtures__/snapshot-v0.json";

const CONFIGURED_MINT = "https://usd-mint.example";
const fixture = snapshotFixture as SnapshotV0;
const fixtureText = JSON.stringify(fixture);

function decode(value: unknown) {
  return decodeSnapshotV0(value, { expectedMint: CONFIGURED_MINT });
}

function cloneFixture(): Record<string, any> {
  return JSON.parse(JSON.stringify(fixture));
}

function pendingMint(): PendingMintV0 {
  return {
    type: "mint",
    operation_id: "11111111-1111-4111-8111-111111111111",
    phase: "prepared",
    created_at: 1780000000,
    updated_at: 1780000001,
    prepared_request: {
      method: "bolt11",
      keyset_id: "00c0ffee",
      quote: {
        quote: "mint-quote-2",
        request: "lnbc1second",
        amount: "30",
        unit: "usd",
        state: "PAID",
        expiry: 1780000200,
      },
      request: {
        quote: "mint-quote-2",
        outputs: [
          { amount: "10", B_: "02first", id: "00c0ffee" },
          { amount: "20", B_: "02second", id: "00c0ffee" },
        ],
      },
      output_data: [
        {
          blindedMessage: { amount: "10", B_: "02first", id: "00c0ffee" },
          blindingFactor: "1",
          secret: "01",
        },
        {
          blindedMessage: { amount: "20", B_: "02second", id: "00c0ffee" },
          blindingFactor: "2",
          secret: "02",
        },
      ],
    },
    response: null,
  };
}

describe("SnapshotV0 codec", () => {
  it("round-trips the normative USD fixture", () => {
    const decoded = decode(fixtureText);
    expect(decoded).toEqual(fixture);
    expect(decode(encodeSnapshotV0(decoded))).toEqual(decoded);
  });

  it("produces stable JSON while preserving ordered Cashu request arrays", () => {
    const first = cloneFixture();
    first.counters = { z: 3, a: 1 };
    first.pending_operation = pendingMint();

    const second = cloneFixture();
    second.pending_operation = pendingMint();
    second.counters = { a: 1, z: 3 };

    const firstEncoded = encodeSnapshotV0(decode(first));
    const secondEncoded = encodeSnapshotV0(decode(second));
    expect(firstEncoded).toBe(secondEncoded);

    const pending = decode(firstEncoded).pending_operation as PendingMintV0;
    expect(pending.prepared_request.request.outputs.map((o) => o.B_)).toEqual([
      "02first",
      "02second",
    ]);
  });

  it.each([
    ["unknown schema", (v: any) => (v.schema = 1)],
    ["non-USD unit", (v: any) => (v.unit = "sat")],
    ["wrong configured mint", (v: any) => (v.mint = "https://other.example")],
    [
      "unknown top-level field",
      (v: any) => (v.mnemonic = "never serialize me"),
    ],
    [
      "unsafe amount",
      (v: any) => (v.proofs[0].amount = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["duplicate proof", (v: any) => v.proofs.push({ ...v.proofs[0] })],
    ["negative revision", (v: any) => (v.revision = -1)],
  ])("rejects %s", (_name, mutate) => {
    const value = cloneFixture();
    mutate(value);
    expect(() => decode(value)).toThrow(SnapshotValidationError);
  });

  it("allows HTTP only for an explicitly enabled loopback mint", () => {
    const value = cloneFixture();
    value.mint = "http://127.0.0.1:3338/";
    value.history[0].mint = "http://127.0.0.1:3338";

    expect(() => decodeSnapshotV0(value)).toThrow(/https/i);
    expect(
      decodeSnapshotV0(value, {
        expectedMint: "http://127.0.0.1:3338",
        allowLoopbackHttp: true,
      }).mint
    ).toBe("http://127.0.0.1:3338");

    value.mint = "http://usd-mint.example";
    value.history[0].mint = "http://usd-mint.example";
    expect(() => decodeSnapshotV0(value, { allowLoopbackHttp: true })).toThrow(
      /https/i
    );
  });

  it.each([
    ["prepared", null, true],
    ["submitted", null, true],
    ["needs_reconciliation", null, true],
    ["response_recorded", { proofs: [] }, true],
    ["prepared", { proofs: [] }, false],
    ["submitted", { proofs: [] }, false],
    ["needs_reconciliation", { proofs: [] }, false],
    ["response_recorded", null, false],
  ])(
    "enforces the %s pending-operation response invariant",
    (phase, response, valid) => {
      const value = cloneFixture();
      value.pending_operation = {
        ...pendingMint(),
        phase,
        response,
      };
      const action = () => decode(value);
      if (valid) expect(action).not.toThrow();
      else expect(action).toThrow(/response/i);
    }
  );

  it("never serializes mnemonic or sync secret in a normal snapshot", () => {
    const encoded = encodeSnapshotV0(decode(fixture));
    expect(encoded).not.toContain("mnemonic");
    expect(encoded).not.toContain("sync_secret");
  });

  it("rejects snapshots above the plaintext limit", () => {
    const value = cloneFixture();
    value.history = Array.from({ length: 9 }, (_, index) => ({
      ...value.history[0],
      id: `mint:oversized-${index}`,
      quote: `oversized-${index}`,
      memo: "x".repeat(8_000),
    }));
    expect(() => decode(value)).toThrow(/size/i);
  });
});
