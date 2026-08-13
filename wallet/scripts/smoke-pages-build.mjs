import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const outputRoot = resolve("dist/pwa");
const publicPath = process.env.PUBLIC_PATH || "/cashu-sync/";

if (!/^\/[A-Za-z0-9._~/-]*\/$/.test(publicPath) || publicPath.includes("..")) {
  throw new Error("PUBLIC_PATH must be a safe absolute directory path");
}
if (!existsSync(resolve(outputRoot, "index.html"))) {
  throw new Error("dist/pwa is missing; run the Pages PWA build first");
}

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (!pathname.startsWith(publicPath)) {
    response.writeHead(404).end();
    return;
  }
  const relativePath = decodeURIComponent(pathname.slice(publicPath.length));
  const candidate = resolve(outputRoot, relativePath || "index.html");
  if (!candidate.startsWith(`${outputRoot}${sep}`) || !existsSync(candidate)) {
    response.writeHead(404).end();
    return;
  }
  const file = statSync(candidate).isDirectory()
    ? resolve(candidate, "index.html")
    : candidate;
  response.writeHead(200, {
    "content-type": mimeTypes[extname(file)] || "application/octet-stream",
  });
  createReadStream(file).pipe(response);
});

await new Promise((resolveListening) => server.listen(0, resolveListening));

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const appUrl = new URL(publicPath, origin);

  const fetchOk = async (value) => {
    const url = value instanceof URL ? value : new URL(value, appUrl);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`${url.pathname} returned ${response.status}`);
    return response;
  };

  const index = await (await fetchOk(appUrl)).text();
  const manifestHref = index.match(
    /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)/i
  )?.[1];
  if (!manifestHref) throw new Error("index.html has no manifest link");
  const manifestUrl = new URL(manifestHref, appUrl);
  const manifest = await (await fetchOk(manifestUrl)).json();

  for (const field of ["start_url", "scope"]) {
    const resolvedUrl = new URL(manifest[field], manifestUrl);
    if (!resolvedUrl.pathname.startsWith(publicPath)) {
      throw new Error(`manifest ${field} escaped ${publicPath}`);
    }
  }
  for (const entry of [...manifest.icons, ...manifest.screenshots]) {
    await fetchOk(new URL(entry.src, manifestUrl));
  }

  const allReferences = [
    ...index.matchAll(/(?:src|href)=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g),
  ].map((match) => match[1] || match[2] || match[3]);
  const escapedRootReference = allReferences.find(
    (reference) =>
      reference.startsWith("/") && !reference.startsWith(publicPath)
  );
  if (escapedRootReference) {
    throw new Error(
      `index asset escaped ${publicPath}: ${escapedRootReference}`
    );
  }
  const assetReferences = allReferences.filter((reference) =>
    reference.startsWith(publicPath)
  );
  if (!assetReferences.some((reference) => reference.includes("/assets/"))) {
    throw new Error("index.html has no base-prefixed application asset");
  }
  await Promise.all(assetReferences.map((reference) => fetchOk(reference)));

  const serviceWorker = await (await fetchOk("sw.js")).text();
  if (/clientsClaim\(\)/.test(serviceWorker)) {
    throw new Error("service worker claims existing clients automatically");
  }

  console.log(`Pages smoke passed at ${appUrl.href}`);
} finally {
  await new Promise((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed()))
  );
}
