import { expect, test } from "@playwright/test";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

test.use({ viewport: { width: 390, height: 844 } });

test("keeps sync card copy inside its box on a phone", async ({ page }) => {
  let server: BuiltPwaServer | undefined;
  try {
    server = await startBuiltPwaServer();
    await page.goto(`${server.baseUrl}#/settings/sync`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator(".settings-card").nth(1);
    await expect(card.getByRole("button", { name: "Scan pairing QR" })).toBeVisible();

    const geometry = await card.evaluate((element) => {
      const button = element.querySelector(".q-btn")!.getBoundingClientRect();
      const copy = element.querySelector(".sync-copy")!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        gap: copy.top - button.bottom,
        copyBottom: copy.bottom,
        boxBottom: box.bottom,
      };
    });

    expect(geometry.gap).toBeGreaterThanOrEqual(12);
    expect(geometry.copyBottom).toBeLessThanOrEqual(geometry.boxBottom);
  } finally {
    await server?.close();
  }
});
