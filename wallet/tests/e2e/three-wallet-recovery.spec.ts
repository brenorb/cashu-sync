import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Amount, Wallet } from "@cashu/cashu-ts";
import { checkLiveV0Services } from "./helpers/live";
import { startBuiltPwaServer } from "./helpers/server";
import { inspectIndexedDb, readLocalStorage } from "./helpers/storage";
import { createPayableUsdBolt11Invoice } from "./helpers/cashu";

const mintUrl =
  process.env.CASHU_SYNC_NUTSHELL_URL || "https://cashu-sync-mint.fly.dev";
test.use({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  serviceWorkers: "block",
});

type StoredProof = {
  id: string;
  amount: number;
  secret: string;
  C: string;
  reserved: boolean;
};
async function stored(page: Page) {
  const databases = await inspectIndexedDb(page);
  const db = databases.find((value) => value.stores.walletSyncState)!;
  const sync = (db.stores.walletSyncState[0] ?? {
    revision: 0,
    pending_operation: null,
    counters: {},
  }) as {
    revision: number;
    pending_operation: unknown;
    counters: Record<string, number>;
  };
  const proofs = db.stores.proofs as StoredProof[];
  const history = db.stores.paymentHistory as {
    id: string;
    status: string;
    amount: number;
    direction: string;
  }[];
  return {
    proofs,
    history,
    sync,
    balance: proofs
      .filter((proof) => !proof.reserved)
      .reduce((total, proof) => total + proof.amount, 0),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify(
          proofs
            .map(({ secret, amount, C }) => ({ secret, amount, C }))
            .sort((left, right) => left.secret.localeCompare(right.secret))
        )
      )
      .digest("hex"),
  };
}

async function buy(page: Page, amount: string) {
  await page.getByRole("button", { name: "Buy credits", exact: true }).click();
  await page.locator('[data-v0-field="mint-amount"]').fill(amount);
  await page.locator('[data-v0-action="create-mint-quote"]').click();
  const claim = page.locator('[data-v0-action="claim-mint-quote"]');
  await Promise.race([
    claim.waitFor({ state: "visible", timeout: 90_000 }),
    page
      .locator('[data-v0-dialog="mint"]')
      .waitFor({ state: "hidden", timeout: 90_000 }),
  ]);
  if (await claim.isVisible()) await claim.click();
  await expect(page.locator('[data-v0-dialog="mint"]')).toBeHidden({
    timeout: 120_000,
  });
}
async function topup(page: Page, amount: string) {
  await page.getByRole("button", { name: "Top up eSIM", exact: true }).click();
  await page.locator('[data-v0-field="melt-amount"]').fill(amount);
  await page.locator('[data-v0-action="create-melt-quote"]').click();
  await page
    .locator('[data-v0-action="pay-melt-quote"]')
    .click({ timeout: 90_000 });
  await expect(page.locator('[data-v0-dialog="melt"]')).toBeHidden({
    timeout: 120_000,
  });
}

test("an old offline wallet with every local token spent recovers beyond retained history", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.CASHU_SYNC_E2E_THREE_WALLETS !== "1",
    "Requires disposable FakeWallet services"
  );
  test.setTimeout(6 * 60_000);
  const server = await startBuiltPwaServer();
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({ serviceWorkers: "block", locale: "en-US" })
    )
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [a, b, c] = pages;
  async function home(page: Page) {
    await page.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 60_000 });
  }
  async function pair(source: Page, target: Page) {
    await source.goto(`${server.baseUrl}#/settings/sync`);
    await source.locator('[data-pairing-action="open-pairing-screen"]').click();
    const qr = source.locator("[data-pairing-url]");
    await expect(qr).toBeVisible();
    await target.goto((await qr.getAttribute("data-pairing-url"))!);
    await expect(
      target.getByText("PAIRING COMPLETE", { exact: true })
    ).toBeVisible({ timeout: 45_000 });
    await Promise.all([home(source), home(target)]);
  }
  async function converged(balance: number, paid: number) {
    for (const page of pages) {
      await expect
        .poll(async () => (await stored(page)).balance, { timeout: 60_000 })
        .toBe(balance);
      await expect
        .poll(async () => (await stored(page)).sync.pending_operation, {
          timeout: 60_000,
        })
        .toBeNull();
      await expect
        .poll(
          async () =>
            (
              await stored(page)
            ).history.filter((entry) => entry.status === "paid").length,
          { timeout: 60_000 }
        )
        .toBe(paid);
    }
    const states = await Promise.all(pages.map(stored));
    expect(new Set(states.map((state) => state.fingerprint)).size).toBe(1);
    return states;
  }
  try {
    await Promise.all(pages.map(home));
    await buy(a, "20");
    await pair(a, b);
    await pair(b, c);
    await converged(2000, 1);
    const old = await stored(c);
    expect(old.proofs.length).toBeGreaterThan(0);
    const authorityBefore = (await readLocalStorage(c))[
      "cashu-sync.authority.v0"
    ];
    await c.goto("about:blank");
    await contexts[2].setOffline(true);

    await topup(a, "20");
    const mint = new Wallet(mintUrl, { unit: "usd" });
    const spent = await mint.checkProofsStates(
      old.proofs.map((proof) => ({
        ...proof,
        amount: Amount.from(proof.amount),
      }))
    );
    expect(spent).toHaveLength(old.proofs.length);
    expect(spent.every((proof) => proof.state === "SPENT")).toBe(true);
    console.log("old-wallet: mint confirms every old proof is spent");
    await buy(b, "10");
    for (let i = 0; i < 4; i++) await topup(a, "1");
    const revisionGap = (await stored(a)).sync.revision - old.sync.revision;
    expect(revisionGap).toBeGreaterThan(8);
    console.log(`old-wallet: offline revision gap=${revisionGap}`);

    await contexts[2].setOffline(false);
    await home(c);
    await converged(600, 7);
    console.log("old-wallet: automatically recovered current balance=600");
    const recovered = await stored(c);
    const oldSecrets = new Set(old.proofs.map((proof) => proof.secret));
    expect(recovered.proofs.some((proof) => oldSecrets.has(proof.secret))).toBe(
      false
    );
    expect((await readLocalStorage(c))["cashu-sync.authority.v0"]).toBe(
      authorityBefore
    );
    // The recovered device must be able to spend its current coins immediately.
    await topup(c, "1");
    const final = await converged(500, 8);
    console.log("old-wallet: recovered device paid; all three balances=500");
    const unspent = await mint.checkProofsStates(
      final[2].proofs.map((proof) => ({
        ...proof,
        amount: Amount.from(proof.amount),
      }))
    );
    expect(unspent).toHaveLength(final[2].proofs.length);
    expect(unspent.every((proof) => proof.state === "UNSPENT")).toBe(true);
    await testInfo.attach("old-spent-wallet-recovery", {
      body: JSON.stringify(
        {
          oldBalance: old.balance,
          oldProofCount: old.proofs.length,
          everyOldProofSpent: true,
          revisionGap,
          recoveredBalance: recovered.balance,
          finalBalance: 500,
          paidOperations: 8,
          authorityPreserved: true,
          rePairRequired: false,
        },
        null,
        2
      ),
      contentType: "application/json",
    });
    await c.screenshot({
      path: testInfo.outputPath("old-wallet-recovered.png"),
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
  }
});

test("three wallets preserve money through races, lost responses, stale history and re-pairing", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.CASHU_SYNC_E2E_THREE_WALLETS !== "1",
    "Set CASHU_SYNC_E2E_THREE_WALLETS=1 with a disposable FakeWallet build"
  );
  test.setTimeout(12 * 60_000);
  const services = await checkLiveV0Services();
  expect(services.ok, services.message).toBe(true);
  const server = await startBuiltPwaServer();
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({
        serviceWorkers: "block",
        viewport: { width: 390, height: 844 },
        locale: "en-US",
      })
    )
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [a, b, c] = pages;
  const frames: string[] = [];
  const seenProofSecrets = new Set<string>();
  const unexpectedDestinations = new Set<string>();
  const pageErrors: string[] = [];
  const checkpoints: {
    stage: string;
    balance: number;
    paid: number;
    revisions: number[];
  }[] = [];
  for (const page of pages) {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      if (
        ![new URL(server.baseUrl).origin, new URL(mintUrl).origin].includes(
          url.origin
        )
      ) {
        unexpectedDestinations.add(url.origin);
      }
    });
    page.on("websocket", (socket) => {
      const allowed = [
        process.env.CASHU_SYNC_RELAY_URL || "wss://cashu-sync-relay.fly.dev",
        process.env.CASHU_SYNC_PAIRING_RELAY_URL ||
          "wss://cashu-sync-pairing-relay.fly.dev",
      ];
      if (!allowed.includes(socket.url().replace(/\/$/, "")))
        unexpectedDestinations.add(new URL(socket.url()).origin);
      if (!socket.url().includes("relay")) return;
      socket.on("framesent", ({ payload }) => frames.push(String(payload)));
    });
    page.setDefaultTimeout(30_000);
  }
  async function home(page: Page) {
    await page.goto(server.walletUrl, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 45_000 });
  }
  async function pair(source: Page, target: Page) {
    await source.goto(`${server.baseUrl}#/settings/sync`);
    await source.locator('[data-pairing-action="open-pairing-screen"]').click();
    const qr = source.locator("[data-pairing-url]");
    await expect(qr).toBeVisible();
    const link = (await qr.getAttribute("data-pairing-url"))!;
    expect(/mnemonic|sync_secret|ciphertext|passphrase/.test(link)).toBe(false);
    await target.goto(link);
    await expect(
      target.getByText("PAIRING COMPLETE", { exact: true })
    ).toBeVisible({ timeout: 45_000 });
    await Promise.all([home(source), home(target)]);
  }
  async function check(
    stage: string,
    balance: number,
    paid: number,
    wallets = pages
  ) {
    for (const page of wallets) {
      await expect
        .poll(async () => (await stored(page)).balance, { timeout: 60_000 })
        .toBe(balance);
      await expect
        .poll(async () => (await stored(page)).sync.pending_operation, {
          timeout: 60_000,
        })
        .toBeNull();
      await expect
        .poll(
          async () =>
            (
              await stored(page)
            ).history.filter((entry) => entry.status === "paid").length,
          { timeout: 60_000 }
        )
        .toBe(paid);
    }
    const states = await Promise.all(wallets.map(stored));
    for (const state of states)
      for (const proof of state.proofs) seenProofSecrets.add(proof.secret);
    expect(new Set(states.map((state) => state.fingerprint)).size).toBe(1);
    for (const state of states) {
      expect(new Set(state.history.map((entry) => entry.id)).size).toBe(
        state.history.length
      );
      expect(
        state.history
          .filter((entry) => entry.status === "paid")
          .reduce(
            (total, entry) =>
              total +
              (entry.direction === "mint" ? entry.amount : -entry.amount),
            0
          )
      ).toBe(balance);
    }
    const mintStates = await new Wallet(mintUrl, {
      unit: "usd",
    }).checkProofsStates(
      states[0].proofs.map((proof) => ({
        ...proof,
        amount: Amount.from(proof.amount),
      }))
    );
    expect(mintStates.every((proof) => proof.state === "UNSPENT")).toBe(true);
    checkpoints.push({
      stage,
      balance,
      paid,
      revisions: states.map((state) => state.sync.revision),
    });
    console.log(`three-wallet: ${stage}; balance=${balance}; paid=${paid}`);
  }
  try {
    await Promise.all(pages.map(home));
    await buy(a, "20");
    await pair(a, b);
    await pair(b, c);
    const authorities = await Promise.all(
      pages.map(async (page) =>
        JSON.parse((await readLocalStorage(page))["cashu-sync.authority.v0"])
      )
    );
    expect(
      new Set(authorities.map((authority) => authority.sync_secret)).size
    ).toBe(1);
    expect(
      new Set(authorities.map((authority) => authority.mnemonic)).size
    ).toBe(1);
    await check("three paired wallets", 2000, 1);
    await buy(b, "1.25");
    await buy(c, "0.50");
    await topup(b, "0.75");
    await topup(c, "2.50");
    await check("varied buys and topups", 1850, 5);
    await pair(a, c);
    await check("funded same-wallet re-pair", 1850, 5);

    await Promise.all([buy(a, "2"), buy(b, "3"), buy(c, "4")]);
    await check("three simultaneous buys", 2750, 8);
    await Promise.all([topup(a, "1"), topup(b, "2"), topup(c, "3")]);
    await check("three simultaneous topups", 2150, 11);
    await Promise.all([buy(a, "1"), topup(b, "2"), topup(c, "0.50")]);
    await check("mixed buy and topup race", 2000, 14);

    const staleRevision = (await stored(c)).sync.revision;
    await c.goto("about:blank");
    for (let i = 0; i < 3; i++) await topup(a, "0.50");
    expect((await stored(a)).sync.revision - staleRevision).toBeGreaterThan(8);
    await home(c);
    await check("stale peer beyond relay retention", 1850, 17);

    let mintForwarded = 0;
    for (const page of pages)
      await page.route(`${mintUrl}/v1/mint/bolt11`, async (route) => {
        if (mintForwarded === 0) {
          mintForwarded++;
          expect((await route.fetch()).status()).toBe(200);
        }
        await route.abort();
      });
    await buy(a, "2");
    for (const page of pages) await page.unroute(`${mintUrl}/v1/mint/bolt11`);
    expect(mintForwarded).toBe(1);
    await check("lost successful mint response", 2050, 18);

    let swapForwarded = 0;
    for (const page of pages)
      await page.route(`${mintUrl}/v1/swap`, async (route) => {
        if (swapForwarded === 0) {
          swapForwarded++;
          expect((await route.fetch()).status()).toBe(200);
        }
        await route.abort();
      });
    await topup(b, "1");
    for (const page of pages) await page.unroute(`${mintUrl}/v1/swap`);
    expect(swapForwarded).toBe(1);
    await Promise.all(pages.map((page) => page.reload()));
    await check("lost successful swap response and reload", 1950, 19);

    await c.goto(`${server.baseUrl}#/settings/recovery`);
    c.once("dialog", (dialog) => dialog.accept());
    await c.locator('[data-recovery-action="delete"]').click();
    await expect(
      c.getByText(
        "Wallet deleted from this device. The relay backup remains.",
        { exact: true }
      )
    ).toBeVisible({ timeout: 60_000 });
    expect(
      (await readLocalStorage(c))["cashu-sync.authority.v0"]
    ).toBeUndefined();
    expect((await stored(c)).proofs.length).toBe(0);
    await check("unpair preserves remaining wallets", 1950, 19, [a, b]);
    await topup(a, "0.50");
    await home(c);
    await pair(b, c);
    await check("re-pair after local removal and peer spend", 1900, 20);

    const privateValues = [
      authorities[0].mnemonic,
      authorities[0].sync_secret,
      ...seenProofSecrets,
    ];
    expect(frames.length).toBeGreaterThan(0);
    expect(
      frames.some((frame) =>
        privateValues.some((value) => frame.includes(value))
      )
    ).toBe(false);
    expect(
      frames.some((frame) =>
        /"(?:amount|mnemonic|sync_secret|prepared_request)"\s*:/.test(frame)
      )
    ).toBe(false);
    expect(pageErrors).toEqual([]);
    expect([...unexpectedDestinations]).toEqual([]);
    for (let i = 0; i < pages.length; i++)
      await pages[i].screenshot({
        path: testInfo.outputPath(`wallet-${i + 1}.png`),
        fullPage: true,
      });
  } finally {
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].isClosed() || !pages[i].url().startsWith(server.baseUrl))
        continue;
      const state = await stored(pages[i]);
      const pending = state.sync.pending_operation as {
        type?: string;
        phase?: string;
        operation_id?: string;
      } | null;
      await testInfo.attach(`wallet-${i + 1}-final-accounting`, {
        body: JSON.stringify(
          {
            balance: state.balance,
            revision: state.sync.revision,
            pending: pending && {
              type: pending.type,
              phase: pending.phase,
              operation_id: pending.operation_id,
            },
            history: state.history,
            alert: await pages[i].locator('[role="alert"]').allTextContents(),
          },
          null,
          2
        ),
        contentType: "application/json",
      });
    }
    await testInfo.attach("monetary-checkpoints", {
      body: JSON.stringify(checkpoints, null, 2),
      contentType: "application/json",
    });
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
  }
});

test("a paid invoice is claimed automatically after closing and reopening the wallet", async ({
  browser,
}) => {
  test.skip(
    process.env.CASHU_SYNC_E2E_THREE_WALLETS !== "1",
    "Requires disposable FakeWallet services"
  );
  test.setTimeout(90_000);
  const server = await startBuiltPwaServer();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let mintSubmissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url() === `${mintUrl}/v1/mint/bolt11`
    )
      mintSubmissions++;
  });
  try {
    await page.goto(server.walletUrl);
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Buy credits", exact: true })
      .click();
    await page.locator('[data-v0-field="mint-amount"]').fill("3");
    await page.locator('[data-v0-action="create-mint-quote"]').click();
    await expect(page.locator('[data-v0-field="mint-invoice"]')).toBeVisible();
    await page.reload();
    await expect
      .poll(async () => (await stored(page)).balance, { timeout: 45_000 })
      .toBe(300);
    await expect
      .poll(async () => (await stored(page)).sync.pending_operation)
      .toBeNull();
    expect(
      (await stored(page)).history.filter((row) => row.status === "paid").length
    ).toBe(1);
    expect(mintSubmissions).toBe(1);
    await page.reload();
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    expect((await stored(page)).balance).toBe(300);
    expect(mintSubmissions).toBe(1);
  } finally {
    await context.close();
    await server.close();
  }
});

test("Lightning invoice payment survives a lost successful melt response", async ({
  browser,
}) => {
  test.skip(
    process.env.CASHU_SYNC_E2E_THREE_WALLETS !== "1",
    "Requires disposable FakeWallet services"
  );
  test.setTimeout(150_000);
  const server = await startBuiltPwaServer();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await page.goto(server.walletUrl);
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await buy(page, "5");
    const invoice = await createPayableUsdBolt11Invoice(100);
    await page
      .getByRole("button", { name: "Top up eSIM", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pay a Lightning invoice", exact: true })
      .click();
    await page.locator('[data-v0-field="melt-invoice"]').fill(invoice.request);
    await page.locator('[data-v0-action="create-melt-quote"]').click();
    await expect(
      page.getByRole("button", { name: "Pay invoice", exact: true })
    ).toBeVisible();
    const before = await stored(page);
    const data = await inspectIndexedDb(page);
    const db = data.find((value) => value.stores.meltQuotes)!;
    const quote = db.stores.meltQuotes[0] as {
      amount: number;
      fee_reserve: number;
    };
    expect(quote.amount).toBe(100);
    let forwarded = 0;
    await page.route(`${mintUrl}/v1/melt/bolt11`, async (route) => {
      if (forwarded === 0) {
        forwarded++;
        expect((await route.fetch()).status()).toBe(200);
      }
      await route.abort();
    });
    await page
      .getByRole("button", { name: "Pay invoice", exact: true })
      .click();
    await expect(page.locator('[data-v0-dialog="melt"]')).toBeHidden({
      timeout: 90_000,
    });
    await page.unroute(`${mintUrl}/v1/melt/bolt11`);
    expect(forwarded).toBe(1);
    await page.reload();
    await expect
      .poll(async () => (await stored(page)).sync.pending_operation, {
        timeout: 30_000,
      })
      .toBeNull();
    const after = await stored(page);
    const spent = before.balance - after.balance;
    expect(spent).toBeGreaterThanOrEqual(quote.amount);
    expect(spent).toBeLessThanOrEqual(quote.amount + quote.fee_reserve);
    expect(
      after.history.filter((entry) => entry.status === "paid")
    ).toHaveLength(2);
    const states = await new Wallet(mintUrl, { unit: "usd" }).checkProofsStates(
      after.proofs.map((proof) => ({
        ...proof,
        amount: Amount.from(proof.amount),
      }))
    );
    expect(states.every((state) => state.state === "UNSPENT")).toBe(true);
  } finally {
    await context.close();
    await server.close();
  }
});

test("offline startup preserves exportable tokens and recovers without a reload or click", async ({
  browser,
}) => {
  test.skip(
    process.env.CASHU_SYNC_E2E_THREE_WALLETS !== "1",
    "Requires disposable FakeWallet services"
  );
  test.setTimeout(120_000);
  const server = await startBuiltPwaServer();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let offline = false;
  await page.routeWebSocket("**/*", (route) => {
    if (offline) route.close();
    else route.connectToServer();
  });
  await page.route(`${mintUrl}/**`, async (route) => {
    if (offline) await route.abort();
    else await route.continue();
  });
  try {
    await page.goto(server.walletUrl);
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await buy(page, "5");
    const before = await stored(page);
    offline = true;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Use local tokens", exact: true })
    ).toBeVisible({ timeout: 45_000 });
    await page
      .getByRole("button", { name: "Use local tokens", exact: true })
      .click();
    await expect(page.locator('[data-v0-field="recovery-token"]')).toBeVisible({
      timeout: 30_000,
    });
    expect((await stored(page)).fingerprint).toBe(before.fingerprint);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    offline = false;
    await expect(
      page.getByText("Wallet synchronized.", { exact: true })
    ).toBeVisible({ timeout: 45_000 });
    expect((await stored(page)).fingerprint).toBe(before.fingerprint);
    await topup(page, "1");
    expect((await stored(page)).balance).toBe(400);
  } finally {
    await context.close();
    await server.close();
  }
});
