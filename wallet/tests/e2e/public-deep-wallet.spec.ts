import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
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

function balanceLocator(page: Page) {
  return page.locator(
    'section[aria-labelledby="v0-balance-title"] [role="status"]'
  );
}

async function readBalance(page: Page): Promise<number> {
  const text = await balanceLocator(page).innerText();
  const values = text.match(/[\d.,]+/g);
  const raw = values?.at(-1) ?? "0";
  const normalized =
    raw.includes(",") && raw.includes(".")
      ? raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "")
      : raw.replace(",", ".");
  return Number(normalized);
}

async function waitForBalances(
  left: Page,
  right: Page,
  expected: number
): Promise<void> {
  await expect
    .poll(async () => readBalance(left), { timeout: 45_000 })
    .toBeCloseTo(expected, 2);
  await expect
    .poll(async () => readBalance(right), { timeout: 45_000 })
    .toBeCloseTo(expected, 2);
  await expect
    .poll(
      async () =>
        Math.abs((await readBalance(left)) - (await readBalance(right))),
      {
        timeout: 45_000,
      }
    )
    .toBeLessThan(0.001);
}

async function mint(page: Page, amount: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`deep: open mint ${amount} (attempt ${attempt})`);
      const open = page.getByRole("button", { name: "Buy credits" });
      await expect(open).toBeVisible({ timeout: 10_000 });
      await open.click({ timeout: 10_000 });
      const dialog = page.getByRole("dialog");
      const field = dialog.getByRole("textbox", { name: "Amount" });
      await expect(field).toBeVisible({ timeout: 10_000 });
      await field.fill(amount);
      console.log(`deep: request mint ${amount}`);
      const create = page.locator('[data-v0-action="create-mint-quote"]');
      await expect(create).toBeVisible({ timeout: 10_000 });
      await create.click({ timeout: 10_000 });
      await expect(
        page.locator('[data-v0-action="claim-mint-quote"]')
      ).toBeVisible({ timeout: 15_000 });

      for (let claimAttempt = 0; claimAttempt < 3; claimAttempt += 1) {
        await page.locator('[data-v0-action="claim-mint-quote"]').click();
        try {
          await expect(page.locator('[data-v0-dialog="mint"]')).toBeHidden({
            timeout: 10_000,
          });
          console.log(`deep: minted ${amount}`);
          return;
        } catch {
          // A submitted operation can remain recoverable after a race.
        }
      }
      throw new Error(`mint ${amount} did not settle`);
    } catch (error) {
      const alert = page.getByRole("alert");
      if (await alert.isVisible().catch(() => false)) {
        console.log(`deep: mint error: ${await alert.innerText()}`);
      }
      const close = page.getByRole("dialog").getByRole("button", {
        name: "Close",
      });
      if (await close.isVisible().catch(() => false)) await close.click();
      if (attempt === 3) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("Wallet synchronized.")).toBeVisible({
        timeout: 30_000,
      });
    }
  }
}

async function spend(page: Page, amount: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`deep: open spend ${amount} (attempt ${attempt})`);
      const open = page.getByRole("button", { name: "Top up eSIM" });
      await expect(open).toBeVisible({ timeout: 10_000 });
      await open.click({ timeout: 10_000 });
      const dialog = page.getByRole("dialog");
      const field = dialog.getByRole("textbox", { name: "Amount" });
      await expect(field).toBeVisible({ timeout: 10_000 });
      await field.fill(amount);
      const create = page.locator('[data-v0-action="create-melt-quote"]');
      await expect(create).toBeVisible({ timeout: 10_000 });
      await create.click({ timeout: 10_000 });
      await expect(
        page.locator('[data-v0-action="pay-melt-quote"]')
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-v0-action="pay-melt-quote"]').click();
      await expect(page.locator('[data-v0-dialog="melt"]')).toBeHidden({
        timeout: 20_000,
      });
      console.log(`deep: spent ${amount}`);
      return;
    } catch (error) {
      const alert = page.getByRole("alert");
      if (await alert.isVisible().catch(() => false)) {
        console.log(`deep: spend error: ${await alert.innerText()}`);
      }
      const close = page.getByRole("dialog").getByRole("button", {
        name: "Close",
      });
      if (await close.isVisible().catch(() => false)) await close.click();
      if (attempt === 3) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("Wallet synchronized.")).toBeVisible({
        timeout: 30_000,
      });
    }
  }
}

async function openWallet(page: Page): Promise<void> {
  await page.goto(`${appUrl}/#/wallet`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Wallet synchronized.")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("public deep wallet workflow", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test.skip(
    process.env.CASHU_SYNC_E2E_DEPLOYED !== "1",
    "set CASHU_SYNC_E2E_DEPLOYED=1 to run against the public deployment"
  );

  let devices: IsolatedWalletDevices | undefined;
  let services: LiveServiceStatus;

  test.beforeAll(async () => {
    services = await checkLiveV0Services({
      mintUrl,
      relayUrl,
      pairingRelayUrl,
    });
    if (!services.ok) throw new Error(services.message);
  });

  test.afterAll(async () => {
    await devices?.close();
  });

  test("handles varied values, paired spend, recovery, reload, and races", async () => {
    test.setTimeout(10 * 60_000);
    devices = await createIsolatedWalletDevices();
    const existing = devices.devices.deviceA.page;
    const joining = devices.devices.deviceB.page;
    const recovery = devices.devices.recovery.page;
    for (const [name, page] of [
      ["deviceA", existing],
      ["deviceB", joining],
    ] as const) {
      page.on("response", (response) => {
        if (response.status() >= 400) {
          console.log(
            `deep: ${name} HTTP ${response.status()} ${response.url()}`
          );
        }
      });
    }

    await Promise.all([openWallet(existing), openWallet(joining)]);
    await existing.goto(`${appUrl}/#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    await existing
      .locator('[data-pairing-action="open-pairing-screen"]')
      .click();
    await existing.locator('[data-pairing-action="create-pairing"]').click();
    const pairingUrl = await existing
      .locator("[data-pairing-url]")
      .getAttribute("data-pairing-url");
    expect(pairingUrl).toMatch(/pairing=/);
    await joining.goto(pairingUrl!, { waitUntil: "domcontentloaded" });
    await expect(joining.getByText("Wallets paired")).toBeVisible({
      timeout: 30_000,
    });
    await Promise.all([openWallet(existing), openWallet(joining)]);
    console.log("deep: paired and at zero");
    await waitForBalances(existing, joining, 0);

    for (const [amount, total] of [
      ["0.50", 0.5],
      ["1.25", 1.75],
      ["3", 4.75],
      ["10", 14.75],
    ] as const) {
      console.log(`deep: mint ${amount}`);
      await mint(existing, amount);
      await waitForBalances(existing, joining, total);
    }

    console.log("deep: spend 0.75 and 2.50");
    await spend(joining, "0.75");
    await waitForBalances(existing, joining, 14);
    await spend(existing, "2.50");
    await waitForBalances(existing, joining, 11.5);

    console.log("deep: reload");
    await Promise.all([existing.reload(), joining.reload()]);
    await Promise.all([
      expect(existing.getByText("Wallet synchronized.")).toBeVisible({
        timeout: 30_000,
      }),
      expect(joining.getByText("Wallet synchronized.")).toBeVisible({
        timeout: 30_000,
      }),
    ]);
    await waitForBalances(existing, joining, 11.5);
    await expect
      .poll(() => existing.locator(".accounting-row").count(), {
        timeout: 30_000,
      })
      .toBe(6);

    console.log("deep: export recovery bundle");
    await existing.goto(`${appUrl}/#/settings/recovery`, {
      waitUntil: "domcontentloaded",
    });
    const passphrase = "public-recovery-passphrase";
    await existing
      .locator('[data-recovery-field="export-passphrase"]')
      .fill(passphrase);
    await existing
      .locator('[data-recovery-field="export-confirmation"]')
      .fill(passphrase);
    const downloadPromise = existing.waitForEvent("download");
    await existing.locator('[data-recovery-action="download"]').click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();
    const backup = await readFile(backupPath!);

    console.log("deep: restore recovery bundle");
    await recovery.goto(`${appUrl}/#/settings/recovery`, {
      waitUntil: "domcontentloaded",
    });
    await recovery
      .getByLabel("Or paste encrypted bundle")
      .fill(backup.toString());
    await recovery
      .locator('[data-recovery-field="import-passphrase"]')
      .fill("wrong-passphrase");
    await recovery.locator('[data-recovery-action="restore"]').click();
    await expect(recovery.getByRole("status")).toContainText(
      /failed|decrypt|operation|passphrase/i,
      { timeout: 30_000 }
    );

    await recovery
      .locator('[data-recovery-field="import-passphrase"]')
      .fill(passphrase);
    await recovery.locator('[data-recovery-action="restore"]').click();
    await expect(recovery.getByRole("status")).toContainText(
      "Wallet restored and synchronized.",
      { timeout: 45_000 }
    );
    await Promise.all([openWallet(existing), openWallet(recovery)]);
    await waitForBalances(existing, recovery, 11.5);
    await expect
      .poll(() => recovery.locator(".accounting-row").count(), {
        timeout: 30_000,
      })
      .toBe(6);

    const raceFailures: string[] = [];
    console.log("deep: concurrent mint 2 and 4");
    const mintRace = await Promise.allSettled([
      mint(existing, "2"),
      mint(joining, "4"),
    ]);
    mintRace.forEach((result, index) => {
      if (result.status === "rejected") {
        raceFailures.push(`mint ${index + 1}: ${String(result.reason)}`);
      }
    });

    console.log("deep: concurrent spend 1 and 2");
    const spendRace = await Promise.allSettled([
      spend(existing, "1"),
      spend(joining, "2"),
    ]);
    spendRace.forEach((result, index) => {
      if (result.status === "rejected") {
        raceFailures.push(`spend ${index + 1}: ${String(result.reason)}`);
      }
    });
    expect(raceFailures, raceFailures.join("\n")).toEqual([]);
  });
});
