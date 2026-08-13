import { describe, expect, it } from "vitest";
import {
  decryptRecoveryBundleV0,
  encryptRecoveryBundleV0,
  RecoveryBundleError,
} from "src/sync/recoveryBundle";
import fixture from "../__fixtures__/authority-v0.json";

const deterministicRandom = (length: number) =>
  Uint8Array.from({ length }, (_, index) => (index + 7) & 0xff);

describe("encrypted full-recovery bundle", () => {
  it("round-trips the normative authority fixture without plaintext secrets", async () => {
    const bundle = await encryptRecoveryBundleV0(fixture, "test passphrase", {
      randomBytes: deterministicRandom,
    });
    expect(bundle).not.toContain(fixture.mnemonic);
    expect(bundle).not.toContain(fixture.sync_secret);
    expect(await decryptRecoveryBundleV0(bundle, "test passphrase")).toEqual(
      fixture
    );
  });

  it("rejects wrong passphrase, tampering, and unknown fields", async () => {
    const bundle = await encryptRecoveryBundleV0(fixture, "right passphrase", {
      randomBytes: deterministicRandom,
    });
    await expect(
      decryptRecoveryBundleV0(bundle, "wrong passphrase")
    ).rejects.toThrow(RecoveryBundleError);

    const tampered = JSON.parse(bundle);
    const last = tampered.ciphertext.at(-1);
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -1)}${
      last === "A" ? "B" : "A"
    }`;
    await expect(
      decryptRecoveryBundleV0(tampered, "right passphrase")
    ).rejects.toThrow(RecoveryBundleError);

    await expect(
      decryptRecoveryBundleV0(
        { ...JSON.parse(bundle), mnemonic: fixture.mnemonic },
        "right passphrase"
      )
    ).rejects.toThrow(/unknown/i);

    await expect(
      encryptRecoveryBundleV0(
        { ...fixture, future_secret: "must be rejected" },
        "right passphrase",
        { randomBytes: deterministicRandom }
      )
    ).rejects.toThrow(/unknown/i);
  });

  it("validates mnemonic, sync key, head, and production endpoints", async () => {
    for (const invalid of [
      { ...fixture, mnemonic: "abandon ".repeat(12).trim() },
      { ...fixture, sync_secret: "00" },
      { ...fixture, head_event_id: "abc" },
      { ...fixture, mint_url: "http://public.example" },
      { ...fixture, relay_url: "ws://public.example" },
      { ...fixture, relay_url: "wss://relay.example/tenant" },
    ]) {
      await expect(
        encryptRecoveryBundleV0(invalid, "passphrase", {
          randomBytes: deterministicRandom,
        })
      ).rejects.toThrow();
    }
  });

  it("allows HTTP/WS only for explicitly enabled loopback tests", async () => {
    const local = {
      ...fixture,
      mint_url: "http://127.0.0.1:3338",
      relay_url: "ws://localhost:10547",
    };
    await expect(
      encryptRecoveryBundleV0(local, "passphrase", {
        randomBytes: deterministicRandom,
      })
    ).rejects.toThrow();
    const bundle = await encryptRecoveryBundleV0(local, "passphrase", {
      allowLoopbackHttp: true,
      randomBytes: deterministicRandom,
    });
    await expect(
      decryptRecoveryBundleV0(bundle, "passphrase")
    ).rejects.toThrow();
    expect(
      await decryptRecoveryBundleV0(bundle, "passphrase", {
        allowLoopbackHttp: true,
      })
    ).toEqual(local);
  });

  it("enforces an explicit passphrase length policy", async () => {
    for (const passphrase of ["", "too-short", "x".repeat(1025)]) {
      await expect(
        encryptRecoveryBundleV0(fixture, passphrase, {
          randomBytes: deterministicRandom,
        })
      ).rejects.toThrow(/passphrase.*length/i);
    }
  });
});
