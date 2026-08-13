import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createPayableUsdBolt11Invoice,
} from "./helpers/cashu";
import {
  createIsolatedWalletDevices,
  type IsolatedWalletDevices,
  type WalletDevice,
} from "./helpers/devices";
import { checkLiveV0Services, type LiveServiceStatus } from "./helpers/live";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

const BACKUP_PASSPHRASE = "correct horse battery staple";

function field(page: Page, name: string) {
  return page
    .locator(
      `textarea[data-pairing-field="${name}"], input[data-pairing-field="${name}"], textarea[data-recovery-field="${name}"], input[data-recovery-field="${name}"]`
    )
    .first();
}

function balance(page: Page) {
  return page.locator(
    'section[aria-labelledby="v0-balance-title"] [role="status"]'
  );
}

function accounting(page: Page) {
  return page.locator('section[aria-labelledby="v0-accounting-title"]');
}

function v0Input(page: Page, name: string) {
  return page
    .locator(
      `input[data-v0-field="${name}"], textarea[data-v0-field="${name}"], [data-v0-field="${name}"] input, [data-v0-field="${name}"] textarea`
    )
    .first();
}

async function openWallet(device: WalletDevice, server: BuiltPwaServer) {
  const { page } = device;
  await page.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your money, in sync."
  );
  try {
    await expect(page.getByText("Starting synchronized wallet…")).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.locator(".v0-runtime-status")).toContainText(
      /Wallet synchronized|Pair or restore|Funds added and synchronized|eSIM top-up paid and synchronized|Wallet restored and synchronized/
    );
  } catch (cause) {
    throw new Error(
      `${device.name} did not complete fresh-wallet startup. Console errors: ${
        device.consoleErrors.join(" | ") || "none"
      }`,
      { cause }
    );
  }
}

async function pairWallets(
  existing: Page,
  joining: Page,
  server: BuiltPwaServer
) {
  await joining.goto(`${server.baseUrl}#/settings/sync`);
  await joining.locator('[data-pairing-action="create-request"]').click();
  const request = await field(joining, "request-output").inputValue();
  expect(request).toContain('"type":"cashu-sync-pairing-request"');

  await existing.goto(`${server.baseUrl}#/settings/sync`);
  await expect(existing.getByText("Sync authority configured")).toBeVisible();
  await field(existing, "request-input").fill(request);
  await existing.locator('[data-pairing-action="create-response"]').click();
  await expect(
    existing.getByText("Encrypted response ready. Return it to the new wallet.")
  ).toBeVisible();
  const response = await field(existing, "response-output").inputValue();
  expect(response).toContain('"type":"cashu-sync-pairing-response"');

  await field(joining, "response-input").fill(response);
  await joining.locator('[data-pairing-action="finish"]').click();
  await expect(
    joining.getByText("Paired. This wallet now follows the shared relay head.")
  ).toBeVisible();
}

test.describe("v0 live paired wallet acceptance", () => {
  let server: BuiltPwaServer | undefined;
  let devices: IsolatedWalletDevices | undefined;
  let services: LiveServiceStatus;

  test.beforeAll(async () => {
    services = await checkLiveV0Services();
    if (!services.ok && process.env.CASHU_SYNC_E2E_REQUIRE_LIVE === "1") {
      throw new Error(services.message);
    }
    if (!services.ok) console.warn(services.message);
  });

  test.afterAll(async () => {
    await devices?.close();
    await server?.close();
  });

  test("pairs, mints, melts, synchronizes, and fully recovers", async () => {
    test.setTimeout(300_000);
    test.skip(!services.ok, services.message);

    server = await startBuiltPwaServer();
    devices = await createIsolatedWalletDevices();
    const deviceAEntry = devices.devices.deviceA;
    const deviceBEntry = devices.devices.deviceB;
    const recoveryEntry = devices.devices.recovery;
    const deviceA = deviceAEntry.page;
    const deviceB = deviceBEntry.page;
    const recovery = recoveryEntry.page;

    await openWallet(deviceAEntry, server);
    await pairWallets(deviceA, deviceB, server);

    await openWallet(deviceAEntry, server);
    const initialBalance = await balance(deviceA).innerText();
    await deviceA.locator('[data-v0-action="mint-bolt11"]').click();
    await v0Input(deviceA, "mint-amount").fill("10");
    await deviceA.locator('[data-v0-action="create-mint-quote"]').click();
    await expect(
      v0Input(deviceA, "mint-invoice")
    ).toHaveValue(/^lnbc/i);
    await expect(async () => {
      await deviceA.locator('[data-v0-action="claim-mint-quote"]').click();
      await expect(
        deviceA.getByText("Funds added and synchronized.")
      ).toBeVisible();
    }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });

    await expect(balance(deviceA)).not.toHaveText(initialBalance);
    const fundedBalance = await balance(deviceA).innerText();
    await expect(accounting(deviceA)).toContainText("Funds added");
    await expect(accounting(deviceA)).toContainText("paid");

    await openWallet(deviceBEntry, server);
    await expect(balance(deviceB)).toHaveText(fundedBalance);
    await expect(accounting(deviceB)).toContainText("Funds added");
    await expect(accounting(deviceB)).toContainText("paid");

    const external = await createPayableUsdBolt11Invoice(100);
    await deviceB.locator('[data-v0-action="melt-bolt11"]').click();
    await v0Input(deviceB, "melt-invoice").fill(external.request);
    await deviceB.locator('[data-v0-action="create-melt-quote"]').click();
    await expect(deviceB.locator(".v0-quote-summary")).toContainText("$1.00");
    await deviceB.locator('[data-v0-action="pay-melt-quote"]').click();
    await expect(
      deviceB.getByText("eSIM top-up paid and synchronized.")
    ).toBeVisible({
      timeout: 20_000,
    });

    await expect(balance(deviceB)).not.toHaveText(fundedBalance);
    const finalBalance = await balance(deviceB).innerText();
    await expect(accounting(deviceB)).toContainText("Invoice paid");
    await expect(accounting(deviceB).getByRole("listitem")).toHaveCount(2);

    await openWallet(deviceAEntry, server);
    await expect(balance(deviceA)).toHaveText(finalBalance);
    await expect(accounting(deviceA)).toContainText("Invoice paid");
    await expect(accounting(deviceA).getByRole("listitem")).toHaveCount(2);

    await deviceA.goto(`${server.baseUrl}#/settings/recovery`);
    await field(deviceA, "export-passphrase").fill(BACKUP_PASSPHRASE);
    await field(deviceA, "export-confirmation").fill(BACKUP_PASSPHRASE);
    const downloadPromise = deviceA.waitForEvent("download");
    await deviceA.locator('[data-recovery-action="download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^silent-link-wallet-backup-\d{4}-\d{2}-\d{2}\.json$/
    );
    const backupPath = join(devices.rootDir, "wallet-recovery.json");
    await download.saveAs(backupPath);
    const serializedBundle = await readFile(backupPath, "utf8");
    expect(serializedBundle).toContain('"type":"cashu-sync-full-recovery"');
    expect(serializedBundle).not.toContain(BACKUP_PASSPHRASE);
    await expect(
      deviceA.getByText("Encrypted backup downloaded.")
    ).toBeVisible();

    await deviceA.goto(`${server.baseUrl}#/settings/recovery`);
    deviceA.once("dialog", (dialog) => void dialog.accept());
    await deviceA.locator('[data-recovery-action="delete"]').click();
    await expect(
      deviceA.getByText("Wallet deleted from this device. The relay backup remains.")
    ).toBeVisible();

    await recovery.goto(`${server.baseUrl}#/settings/recovery`);
    await recovery.locator('input[type="file"]').setInputFiles(backupPath);
    await expect(field(recovery, "bundle-input")).toHaveValue(
      /cashu-sync-full-recovery/
    );
    await field(recovery, "import-passphrase").fill(BACKUP_PASSPHRASE);
    await recovery.locator('[data-recovery-action="restore"]').click();
    await expect(
      recovery.getByText("Wallet restored and synchronized.")
    ).toBeVisible({ timeout: 20_000 });

    await openWallet(recoveryEntry, server);
    await expect(balance(recovery)).toHaveText(finalBalance);
    await expect(accounting(recovery)).toContainText("Funds added");
    await expect(accounting(recovery)).toContainText("Invoice paid");
    await expect(accounting(recovery).getByRole("listitem")).toHaveCount(2);
  });
});
