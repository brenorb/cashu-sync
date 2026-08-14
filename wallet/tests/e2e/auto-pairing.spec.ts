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

    await existing.goto(`${server.walletUrl}#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    await expect(existing.getByText("Sync devices")).toBeVisible();
    await existing.locator('[data-pairing-action="create-auto-pair"]').click();
    const qr = existing.locator("[data-auto-pairing-qr]");
    await expect(qr).toBeVisible();
    const pairingUrl = await qr.getAttribute("data-auto-pairing-url");
    expect(pairingUrl).toMatch(/pairing=/);
    expect(pairingUrl).not.toMatch(
      /mnemonic|sync_secret|ciphertext|passphrase/i
    );

    await joining.goto(pairingUrl!, { waitUntil: "domcontentloaded" });
    await expect(
      joining.getByText("Wallet pareada e sincronizada.")
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      existing.getByText("Wallet pareada e sincronizada.")
    ).toBeVisible({ timeout: 20_000 });
    await expect(joining.getByText("PAIRING COMPLETE")).toBeVisible();

    await joining.goto(`${server.walletUrl}#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    await existing.goto(`${server.walletUrl}#/wallet`, {
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
  });
});
