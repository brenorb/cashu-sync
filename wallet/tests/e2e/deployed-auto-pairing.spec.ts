import { expect, test } from "@playwright/test";
import {
  createIsolatedWalletDevices,
  type IsolatedWalletDevices,
} from "./helpers/devices";
import { checkLiveV0Services, type LiveServiceStatus } from "./helpers/live";

const appUrl = (
  process.env.CASHU_SYNC_E2E_APP_URL || "https://silentlink.fly.dev"
).replace(/\/+$/, "");
const mintUrl =
  process.env.CASHU_SYNC_NUTSHELL_URL || "https://cashu-sync-mint.fly.dev";
const relayUrl =
  process.env.CASHU_SYNC_RELAY_URL || "wss://cashu-sync-relay.fly.dev";
const pairingRelayUrl =
  process.env.CASHU_SYNC_PAIRING_RELAY_URL ||
  "wss://cashu-sync-pairing-relay.fly.dev";

test.describe("deployed automatic one-QR pairing", () => {
  test.skip(
    process.env.CASHU_SYNC_E2E_DEPLOYED !== "1",
    "set CASHU_SYNC_E2E_DEPLOYED=1 to run against the deployed wallet"
  );

  let devices: IsolatedWalletDevices | undefined;
  let services: LiveServiceStatus;

  test.beforeAll(async () => {
    services = await checkLiveV0Services({
      mintUrl,
      relayUrl,
      pairingRelayUrl,
    });
    if (!services.ok && process.env.CASHU_SYNC_E2E_REQUIRE_LIVE === "1") {
      throw new Error(services.message);
    }
  });

  test.afterAll(async () => {
    await devices?.close();
  });

  test("pairs two isolated wallets through the deployed public QR flow", async () => {
    test.skip(!services.ok, services.message);
    devices = await createIsolatedWalletDevices();
    const existing = devices.devices.deviceA.page;
    const joining = devices.devices.deviceB.page;

    await existing.goto(`${appUrl}/#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    await expect(existing.getByText("Wallet synchronized.")).toBeVisible({
      timeout: 30_000,
    });
    await existing.goto(`${appUrl}/#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    await expect(existing.getByText("Sync devices")).toBeVisible();
    await existing
      .locator('[data-pairing-action="open-pairing-screen"]')
      .click();
    await expect(
      existing.locator('[data-pairing-action="create-pairing"]')
    ).toBeVisible();
    await existing.locator('[data-pairing-action="create-pairing"]').click();

    const qr = existing.locator("[data-pairing-url]");
    await expect(qr).toBeVisible();
    const pairingUrl = await qr.getAttribute("data-pairing-url");
    console.log(`pairing URL: ${pairingUrl}`);
    expect(pairingUrl).toMatch(/pairing=/);
    expect(pairingUrl).not.toMatch(
      /mnemonic|sync_secret|ciphertext|passphrase/i
    );

    await joining.goto(pairingUrl!, { waitUntil: "domcontentloaded" });
    console.log(
      await joining.evaluate(() => ({
        href: window.location.href,
        hash: window.location.hash,
        pairingLength: new URLSearchParams(
          window.location.hash.slice(window.location.hash.indexOf("?") + 1)
        ).get("pairing")?.length,
      }))
    );
    await expect(joining.getByText("Wallets paired")).toBeVisible({
      timeout: 30_000,
    });
    await expect(existing.getByText("Wallets paired")).toBeVisible({
      timeout: 30_000,
    });
    await expect(joining.getByText("PAIRING COMPLETE")).toBeVisible();

    await joining.goto(`${appUrl}/#/wallet`, { waitUntil: "domcontentloaded" });
    await existing.goto(`${appUrl}/#/wallet`, {
      waitUntil: "domcontentloaded",
    });
    const joiningBalance = joining.locator(
      'section[aria-labelledby="v0-balance-title"] [role="status"]'
    );
    const existingBalance = existing.locator(
      'section[aria-labelledby="v0-balance-title"] [role="status"]'
    );
    await expect(joiningBalance).toBeVisible({ timeout: 30_000 });
    await expect(existingBalance).toHaveText(await joiningBalance.innerText());
  });
});
