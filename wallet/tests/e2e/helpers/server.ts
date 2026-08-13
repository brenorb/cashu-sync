import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export const DEFAULT_E2E_BASE_PATH = "/cashu-sync-e2e/";

export type BuiltPwaServer = {
  origin: string;
  basePath: string;
  baseUrl: string;
  walletUrl: string;
  close: () => Promise<void>;
};

function assertBasePath(value: string): string {
  if (!/^\/[A-Za-z0-9._~/-]*\/$/.test(value) || value.includes("..")) {
    throw new Error(
      `CASHU_SYNC_E2E_BASE_PATH must be a safe absolute directory path ending in '/': ${value}`
    );
  }
  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
}

export async function startBuiltPwaServer(options?: {
  outputRoot?: string;
  basePath?: string;
}): Promise<BuiltPwaServer> {
  const outputRoot = resolve(options?.outputRoot || "dist/pwa");
  const basePath = assertBasePath(
    options?.basePath ||
      process.env.CASHU_SYNC_E2E_BASE_PATH ||
      DEFAULT_E2E_BASE_PATH
  );
  const indexPath = resolve(outputRoot, "index.html");
  if (!(await fileExists(indexPath))) {
    throw new Error(
      `${indexPath} is missing; run 'npm run build:pwa:e2e' before Playwright`
    );
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }

      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      if (pathname === "/" || pathname === basePath.slice(0, -1)) {
        response.writeHead(302, { location: basePath }).end();
        return;
      }
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404).end();
        return;
      }

      const relativePath = decodeURIComponent(pathname.slice(basePath.length));
      let candidate = resolve(outputRoot, relativePath || "index.html");
      if (!candidate.startsWith(`${outputRoot}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      if (!(await fileExists(candidate))) {
        if (extname(relativePath)) {
          response.writeHead(404).end();
          return;
        }
        candidate = indexPath;
      } else if ((await stat(candidate)).isDirectory()) {
        candidate = resolve(candidate, "index.html");
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          MIME_TYPES[extname(candidate)] || "application/octet-stream",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(candidate).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("built PWA server did not obtain a TCP port");
  }

  const origin = `http://127.0.0.1:${address.port}`;
  const baseUrl = `${origin}${basePath}`;
  let closed = false;
  return {
    origin,
    basePath,
    baseUrl,
    walletUrl: `${baseUrl}#/wallet`,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
}
