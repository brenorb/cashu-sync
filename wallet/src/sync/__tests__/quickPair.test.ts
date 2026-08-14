import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/authority-v0.json";
import { consumeQuickPairV0, createQuickPairV0 } from "../quickPair";

const deterministicRandom = (length: number) =>
  Uint8Array.from({ length }, (_, index) => (index + 11) & 0xff);

describe("one-scan quick pairing", () => {
  it("round-trips the encrypted authority", async () => {
    const payload = await createQuickPairV0(fixture, {
      randomBytes: deterministicRandom,
    });
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain(fixture.mnemonic);
    expect(
      await consumeQuickPairV0(payload, { allowLoopbackHttp: true })
    ).toEqual(fixture);
  });

  it("rejects malformed and expired handoffs", async () => {
    await expect(
      consumeQuickPairV0("not-json", { allowLoopbackHttp: true })
    ).rejects.toThrow(/invalid payload/i);

    const expired = btoa(
      JSON.stringify({
        schema: 0,
        type: "cashu-sync-quick-pair",
        expires_at: 1,
        passphrase: "A".repeat(24),
        bundle: "x",
      })
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expect(
      consumeQuickPairV0(expired, { allowLoopbackHttp: true })
    ).rejects.toThrow(/expired/i);
  });
});
