import { describe, it, expect, vi } from "vitest";
import { reconcileProofsWithMint } from "src/sync/proofReconciliation";
const proof = (secret: string) => ({
  id: "k",
  secret,
  C: "c",
  amount: 5,
  reserved: false,
});
describe("mint proof reconciliation", () => {
  it("removes spent tokens, reserves pending ones and releases unspent quarantine", async () => {
    const check = vi.fn(async () => [
      { state: "SPENT" },
      { state: "PENDING" },
      { state: "UNSPENT" },
    ]);
    await expect(
      reconcileProofsWithMint(
        [
          proof("spent"),
          proof("pending"),
          { ...proof("free"), reserved: true },
        ],
        check
      )
    ).resolves.toEqual([
      { ...proof("pending"), reserved: true },
      proof("free"),
    ]);
  });
  it("preserves journal-owned inputs until their operation is reconciled", async () => {
    const input = { ...proof("input"), reserved: true, quote: "q" };
    await expect(
      reconcileProofsWithMint([input], async () => [{ state: "SPENT" }])
    ).resolves.toEqual([input]);
  });
  it.each([[], [{ state: "UNKNOWN" }]])(
    "rejects incomplete or unknown mint results without treating proofs as spent",
    async (states) => {
      await expect(
        reconcileProofsWithMint([proof("local")], async () => states)
      ).rejects.toThrow();
    }
  );
});
