import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createIsolatedWalletDevices,
  type IsolatedWalletDevices,
} from "./helpers/devices";
import { checkLiveV0Services, type LiveServiceStatus } from "./helpers/live";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

test.describe("Cashu Recovery Kit smoke path", () => {
  let server: BuiltPwaServer | undefined;
  let devices: IsolatedWalletDevices | undefined;
  let services: LiveServiceStatus;

  test.beforeAll(async () => {
    services = await checkLiveV0Services();
    if (!services.ok && process.env.CASHU_SYNC_E2E_REQUIRE_LIVE === "1") {
      throw new Error(services.message);
    }
  });

  test.afterAll(async () => {
    await devices?.close();
    await server?.close();
  });

  test("replays encrypted relay state into a fresh profile without destroying the source", async () => {
    test.skip(!services.ok, services.message);
    server = await startBuiltPwaServer();
    devices = await createIsolatedWalletDevices();

    const source = devices.devices.deviceA.page;
    const recovery = devices.devices.recovery.page;
    await source.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(source.getByText("Wallet synchronized.")).toBeVisible({
      timeout: 20_000,
    });

    await source.locator('[data-v0-action="mint-bolt11"]').click();
    await source.locator('[data-v0-field="mint-amount"] input').fill("1");
    await source.locator('[data-v0-action="create-mint-quote"]').click();
    await source.locator('[data-v0-action="claim-mint-quote"]').click();
    await expect(source.getByText("Credits bought and synchronized.")).toBeVisible({
      timeout: 20_000,
    });

    const sourceBalance = await source
      .locator('section[aria-labelledby="v0-balance-title"] [role="status"]')
      .innerText();
    await source.goto(`${server.baseUrl}#/settings/recovery`, {
      waitUntil: "domcontentloaded",
    });
    const passphrase = "recovery kit smoke passphrase";
    await source
      .locator('[data-recovery-field="export-passphrase"] input')
      .fill(passphrase);
    await source
      .locator('[data-recovery-field="export-confirmation"] input')
      .fill(passphrase);
    const downloadPromise = source.waitForEvent("download");
    await source.locator('[data-recovery-action="download"]').click();
    const bundlePath = await (await downloadPromise).path();
    expect(bundlePath).toBeTruthy();
    const bundle = await readFile(bundlePath!, "utf8");
    const encoded = JSON.parse(bundle) as Record<string, unknown>;
    expect(encoded).toMatchObject({
      schema: 0,
      type: "cashu-sync-full-recovery",
      kdf: { name: "PBKDF2-HMAC-SHA256" },
      cipher: { name: "AES-256-GCM" },
    });
    expect(bundle).not.toMatch(/mnemonic|sync_secret/);

    await recovery.goto(`${server.baseUrl}#/settings/recovery`, {
      waitUntil: "domcontentloaded",
    });
    await recovery
      .locator('[data-recovery-field="bundle-input"] textarea')
      .fill(bundle);
    await recovery
      .locator('[data-recovery-field="import-passphrase"] input')
      .fill(passphrase);
    await recovery.locator('[data-recovery-action="restore"]').click();
    await expect(
      recovery.getByText("Wallet restored and synchronized.")
    ).toBeVisible({ timeout: 20_000 });
    await expect(recovery.getByText("Configured mint", { exact: true })).toBeVisible();

    await recovery.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(recovery.getByText("Wallet synchronized.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      recovery.locator('section[aria-labelledby="v0-balance-title"] [role="status"]')
    ).toHaveText(sourceBalance);
    await expect(recovery.getByText("Funds added", { exact: true })).toBeVisible();
  });
});
