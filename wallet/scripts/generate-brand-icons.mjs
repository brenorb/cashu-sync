// Render the existing Silent Link vector wordmark into browser/PWA assets.
// Run from wallet/ with npm run brand:icons. Requires installed Chrome.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const logo = await readFile("src/assets/silent-link-logo.svg");
const source = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const files = (await readdir("public/icons"))
    .filter((file) => file.endsWith(".png"))
    .map((file) => `public/icons/${file}`);
  files.push("public/icon.png", "public/icon-round.png");
  for (const file of files) {
    const page = await browser.newPage();
    const old = await readFile(file);
    const width = old.readUInt32BE(16);
    const height = old.readUInt32BE(20);
    const splash = file.includes("apple-launch");
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${
        splash ? "#090909" : "#fff"
      }"><img src="${source}" style="display:block;width:${
        splash ? Math.min(width * 0.7, 420) : width * 0.7
      }px;background:#fff;${splash ? "padding:16px" : ""}"></body></html>`
    );
    await page.locator("img").evaluate((image) => image.decode());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await page.screenshot({ path: file, type: "png" });
    await page.close();
  }
  // ICO may contain a PNG image; preserve PNG pixels without re-encoding.
  const png = await readFile("public/icons/favicon-32x32.png");
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile("public/favicon.ico", Buffer.concat([header, png]));
  await writeFile("public/icons/safari-pinned-tab.svg", logo);
  console.log(
    `Rendered ${files.length} PNG assets, favicon and Safari vector from the Silent Link wordmark.`
  );
} finally {
  await browser.close();
}
