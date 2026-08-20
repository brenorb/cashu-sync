import { expect, test } from "@playwright/test";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

test("caches immutable PWA assets while keeping the document fresh", async ({
  request,
}) => {
  let server: BuiltPwaServer | undefined;
  try {
    server = await startBuiltPwaServer();
    const document = await request.get(server.baseUrl);
    const html = await document.text();
    const assetPath = /src="([^"]+\.js)"/.exec(html)?.[1];

    expect(document.headers()["cache-control"]).toBe("no-store");
    expect(assetPath).toBeTruthy();

    const asset = await request.get(new URL(assetPath!, server.baseUrl).href);
    expect(asset.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    );
  } finally {
    await server?.close();
  }
});
