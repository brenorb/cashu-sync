import type { SnapshotProofV0 } from "src/sync/types";

/** Correct spendability without discarding material owned by an unfinished journal. */
export async function reconcileProofsWithMint(
  proofs: SnapshotProofV0[],
  check: (proofs: SnapshotProofV0[]) => Promise<{ state: string }[]>
): Promise<SnapshotProofV0[]> {
  if (proofs.length === 0) return [];
  const states = await check(proofs);
  if (
    states.length !== proofs.length ||
    states.some((s) => !["UNSPENT", "PENDING", "SPENT"].includes(s.state))
  ) {
    throw new Error(
      "Mint could not confirm token states. Your local tokens are preserved; retry or pair with your other wallet."
    );
  }
  return proofs.flatMap((proof, index) => {
    if (proof.reserved && proof.quote) return [proof];
    if (states[index].state === "SPENT") return [];
    return [{ ...proof, reserved: states[index].state === "PENDING" }];
  });
}
