import { expect, test } from "@playwright/test";
import {
  createIsolatedWalletDevices,
  type IsolatedWalletDevices,
} from "./helpers/devices";
import { checkLiveV0Services, type LiveServiceStatus } from "./helpers/live";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

test.describe("automatic one-QR pairing", () => {
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

  test("scans one public QR and completes encrypted pairing without a second QR", async () => {
    test.skip(!services.ok, services.message);
    server = await startBuiltPwaServer();
    devices = await createIsolatedWalletDevices();
    const existing = devices.devices.deviceA.page;
    const joining = devices.devices.deviceB.page;

    await existing.goto(`${server.walletUrl}#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    await expect(existing.getByText("Wallet synchronized.")).toBeVisible({
      timeout: 20_000,
    });
    await existing.goto(`${server.baseUrl}#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    await expect(existing.getByText("Sync devices")).toBeVisible();
    await existing
      .locator('[data-pairing-action="open-pairing-screen"]')
      .click();
    await existing.locator('[data-pairing-action="create-pairing"]').click();
    const qr = existing.locator("[data-pairing-url]");
    await expect(qr).toBeVisible();
    const pairingUrl = await qr.getAttribute("data-pairing-url");
    expect(pairingUrl).toMatch(/pairing=/);
    expect(pairingUrl).not.toMatch(
      /mnemonic|sync_secret|ciphertext|passphrase/i
    );

    await joining.goto(pairingUrl!, { waitUntil: "domcontentloaded" });
    await expect(joining.getByText("Wallets paired")).toBeVisible({
      timeout: 20_000,
    });
    await expect(joining.getByText("PAIRING COMPLETE")).toBeVisible();

    await joining.goto(`${server.baseUrl}#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    await existing.goto(`${server.baseUrl}#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    const joiningBalance = joining.locator(
      'section[aria-labelledby="v0-balance-title"] [role="status"]'
    );
    const existingBalance = existing.locator(
      'section[aria-labelledby="v0-balance-title"] [role="status"]'
    );
    await expect(joiningBalance).toBeVisible({ timeout: 20_000 });
    await expect(existingBalance).toHaveText(await joiningBalance.innerText());

    await existing.getByRole("button", { name: "Buy credits" }).click();
    await existing.locator('[data-v0-action="create-mint-quote"]').click();
    await expect(
      existing.locator('[data-v0-action="claim-mint-quote"]')
    ).toBeVisible({ timeout: 20_000 });
    await existing.locator('[data-v0-action="claim-mint-quote"]').click();
    await expect(existingBalance).toContainText("1", { timeout: 20_000 });
    await expect(joiningBalance).toContainText("1", { timeout: 20_000 });

    await existing.goto(`${server.baseUrl}#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    await existing
      .locator('[data-pairing-action="open-pairing-screen"]')
      .click();
    await existing.locator('[data-pairing-action="create-pairing"]').click();
    const replacementUrl = await existing
      .locator("[data-pairing-url]")
      .getAttribute("data-pairing-url");
    await joining.goto(replacementUrl!, { waitUntil: "domcontentloaded" });
    await expect(joining.getByText("Replace this wallet?")).toBeVisible({
      timeout: 20_000,
    });
    await joining.locator('[data-pairing-action="cancel-overwrite"]').click();
    await expect(
      joining.getByText("Pairing cancelled. This wallet was not changed.")
    ).toBeVisible();
    await joining.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(joiningBalance).toContainText("1");

    await joining.getByRole("button", { name: "Top up eSIM" }).click();
    await joining.locator('[data-v0-action="create-melt-quote"]').click();
    await expect(
      joining.locator('[data-v0-action="pay-melt-quote"]')
    ).toBeVisible({ timeout: 20_000 });
    await joining.locator('[data-v0-action="pay-melt-quote"]').click();
    await expect(joiningBalance).toContainText("0", { timeout: 20_000 });
    await existing.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(existingBalance).toContainText("0", { timeout: 20_000 });
  });
});
