import { describe, expect, it } from "vitest";
import { wordlist } from "@scure/bip39/wordlists/english";
import { deriveWalletIdWords } from "../walletIdentity";

describe("wallet identity", () => {
  it("derives the same six-word fingerprint for paired wallets", async () => {
    const secret = "11".repeat(32);
    await expect(deriveWalletIdWords(secret)).resolves.toEqual(
      await deriveWalletIdWords(secret)
    );
  });

  it("changes when the sync authority changes", async () => {
    const first = await deriveWalletIdWords("11".repeat(32));
    const second = await deriveWalletIdWords("22".repeat(32));
    expect(second).not.toEqual(first);
  });

  it("uses six words from the BIP39 English list", async () => {
    const words = await deriveWalletIdWords("33".repeat(32));
    expect(words).toHaveLength(6);
    expect(words.every((word) => wordlist.includes(word))).toBe(true);
  });
});
