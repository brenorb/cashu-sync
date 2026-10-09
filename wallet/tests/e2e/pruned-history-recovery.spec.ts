import { test, expect, type Page } from "@playwright/test";
import { inspectIndexedDb } from "./helpers/storage";

// Run against a freshly built wallet configured with the disposable demo services.
const url = process.env.CASHU_SYNC_E2E_WALLET_URL;
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL, serviceWorkers: "block" });
async function state(page: Page) {
  const db = (await inspectIndexedDb(page)).find(
    (db) => db.stores.walletSyncState
  )!;
  const sync = db.stores.walletSyncState[0] as any;
  const proofs = db.stores.proofs as any[];
  return {
    revision: sync.revision,
    pending: sync.pending_operation?.phase ?? null,
    balance: proofs
      .filter((p) => !p.reserved)
      .reduce((sum, p) => sum + p.amount, 0),
  };
}
async function buy(page: Page, amount: string) {
  await page.getByRole("button", { name: "Buy credits", exact: true }).click();
  await page.locator('[data-v0-field="mint-amount"]').fill(amount);
  await page.locator('[data-v0-action="create-mint-quote"]').click();
  await page.locator('[data-v0-action="claim-mint-quote"]').click();
  await expect(page.locator('[data-v0-dialog="mint"]')).toBeHidden({
    timeout: 30000,
  });
}
async function topup(page: Page, waitForDialog = true) {
  await page.getByRole("button", { name: "Top up eSIM", exact: true }).click();
  await page.locator('[data-v0-field="melt-amount"]').fill("5");
  await page.locator('[data-v0-action="create-melt-quote"]').click();
  await page.locator('[data-v0-action="pay-melt-quote"]').click();
  if (!waitForDialog) return;
  await page.bringToFront();
  await expect(page.locator('[data-v0-dialog="melt"]')).toBeHidden({
    timeout: 30000,
  });
}

test("stale history, lost swap response and concurrent topups recover; offline tokens stay accessible", async ({
  browser,
}, testInfo) => {
  test.skip(!url, "Set CASHU_SYNC_E2E_WALLET_URL to a demo-configured build");
  test.setTimeout(360000);
  const ctxA = await browser.newContext({ serviceWorkers: "block" });
  const ctxB = await browser.newContext({ serviceWorkers: "block" });
  const a = await ctxA.newPage(),
    b = await ctxB.newPage();
  a.setDefaultTimeout(20000);
  b.setDefaultTimeout(20000);
  try {
    await a.goto(url!);
    await expect(
      a.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 30000 });
    console.log("A initialized");
    await buy(a, "100");
    console.log("A funded");
    await expect.poll(async () => (await state(a)).balance).toBe(10000);
    await a.goto(`${url!.split("#")[0]}#/settings/sync`);
    await a.locator('[data-pairing-action="open-pairing-screen"]').click();
    const qr = a.locator("[data-pairing-url]");
    await expect(qr).toBeVisible();
    await b.goto((await qr.getAttribute("data-pairing-url"))!);
    await expect(b.getByText("PAIRING COMPLETE")).toBeVisible({
      timeout: 30000,
    });
    await b.goto(url!);
    await expect.poll(async () => (await state(b)).balance).toBe(10000);
    const stale = await state(a);
    await a.goto("about:blank");
    console.log("B paired", await state(b));
    for (let i = 0; i < 5; i++) {
      await topup(b);
      console.log("B topup", i, await state(b));
    }
    const active = await state(b);
    expect(active.balance).toBe(7500);
    expect(active.revision - stale.revision).toBeGreaterThan(8);
    let stateChecks = 0;
    a.on("request", (r) => {
      if (r.url().includes("/v1/checkstate")) stateChecks++;
    });
    await a.goto(url!);
    await expect
      .poll(async () => (await state(a)).balance, { timeout: 30000 })
      .toBe(7500);
    expect(stateChecks).toBeGreaterThan(0);
    await topup(a);
    await expect.poll(async () => (await state(a)).balance).toBe(7000);
    await expect
      .poll(async () => (await state(b)).balance, { timeout: 30000 })
      .toBe(7000);
    await a.reload();
    await expect.poll(async () => (await state(a)).balance).toBe(7000);
    expect((await state(a)).pending).toBeNull();
    console.log({ stale, active, recovered: await state(a), stateChecks });
    // Lose the successful swap response, then recover the exact change with NUT-09.
    await b.goto("about:blank");
    let forwarded = 0,
      restores = 0;
    a.on("request", (request) => {
      if (request.url().includes("/v1/restore")) restores++;
    });
    await a.route("https://cashu-sync-mint.fly.dev/v1/swap", async (route) => {
      if (forwarded === 0) {
        forwarded++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
      }
      await route.abort();
    });
    await topup(a);
    expect(forwarded).toBe(1);
    expect(restores).toBeGreaterThan(0);
    expect((await state(a)).balance).toBe(6500);
    await a.unrouteAll();
    await b.goto(url!);
    await expect.poll(async () => (await state(b)).balance).toBe(6500);
    await Promise.all([topup(a, false), topup(b, false)]);
    await expect
      .poll(async () => (await state(a)).balance, { timeout: 30000 })
      .toBe(5500);
    await expect
      .poll(async () => (await state(b)).balance, { timeout: 30000 })
      .toBe(5500);
    await expect
      .poll(async () => (await state(a)).pending, { timeout: 30000 })
      .toBeNull();
    await expect
      .poll(async () => (await state(b)).pending, { timeout: 30000 })
      .toBeNull();
    // Finish each visible browser window’s closing animation in the foreground.
    for (const page of [b, a]) {
      await page.bringToFront();
      await expect(page.locator('[data-v0-dialog="melt"]')).toBeHidden();
    }
    console.log({
      lostSwapResponseRestores: restores,
      simultaneousA: await state(a),
      simultaneousB: await state(b),
    });
    await a.screenshot({
      path: testInfo.outputPath("recovered.png"),
      fullPage: true,
    });
    await a.routeWebSocket(/cashu-sync-relay\.fly\.dev/, (ws) => ws.close());
    await a.route("https://cashu-sync-mint.fly.dev/**", (route) =>
      route.abort()
    );
    await a.reload();
    await a
      .getByRole("button", { name: "Use local tokens", exact: true })
      .click({ timeout: 30000 });
    const token = a.locator('[data-v0-field="recovery-token"]');
    await expect(token).toHaveValue(/^cashu/);
    expect((await state(a)).balance).toBe(5500);
  } finally {
    await Promise.race([
      Promise.all([ctxA.close(), ctxB.close()]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
});
