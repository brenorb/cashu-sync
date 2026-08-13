import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walletHomeUrl } from "src/stores/welcome";

const require = createRequire(import.meta.url);
const walletRoot = process.cwd();
const repositoryRoot = resolve(walletRoot, "..");
const configFactory = require(resolve(walletRoot, "quasar.config.js"));
const originalPublicPath = process.env.PUBLIC_PATH;

afterEach(() => {
  if (originalPublicPath === undefined) delete process.env.PUBLIC_PATH;
  else process.env.PUBLIC_PATH = originalPublicPath;
});

describe("GitHub Pages packaging contract", () => {
  it("uses hash routing and a configurable normalized public path", () => {
    delete process.env.PUBLIC_PATH;
    const defaultConfig = configFactory({});
    expect(defaultConfig.build.vueRouterMode).toBe("hash");
    expect(defaultConfig.build.publicPath).toBe("/");

    process.env.PUBLIC_PATH = "/cashu-sync/";
    expect(configFactory({}).build.publicPath).toBe("/cashu-sync/");
    expect(walletHomeUrl("/cashu-sync/", "?lightning=lnbc1")).toBe(
      "/cashu-sync/?lightning=lnbc1#/"
    );
  });

  it("keeps the PWA manifest scope-relative and v0 payment-only", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(walletRoot, "src-pwa/manifest.json"), "utf8")
    );
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.protocol_handlers).toEqual([
      { protocol: "web+lightning", url: "./?lightning=%s#/" },
    ]);
    for (const entry of [...manifest.icons, ...manifest.screenshots]) {
      expect(entry.src.startsWith("/")).toBe(false);
    }
    expect(existsSync(resolve(walletRoot, "public/manifest.webmanifest"))).toBe(
      false
    );
  });

  it("does not force a service worker update into active wallet operations", () => {
    const { extendGenerateSWOptions } = configFactory({}).pwa;
    const generatedConfig = { skipWaiting: true, clientsClaim: true };
    extendGenerateSWOptions(generatedConfig);
    expect(generatedConfig.skipWaiting).toBe(false);
    expect(generatedConfig.clientsClaim).toBe(false);
  });

  it("deploys only the built wallet artifact", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/pages.yml"),
      "utf8"
    );
    expect(workflow).toContain("working-directory: wallet");
    expect(workflow).toContain("path: wallet/dist/pwa");
    expect(workflow).toContain("npm ci");
    expect(workflow).not.toMatch(/relay|mint/i);
  });
});
