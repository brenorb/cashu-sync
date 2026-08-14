import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import routes from "src/router/routes";

const walletRoot = process.cwd();
const source = (path) => readFileSync(resolve(walletRoot, path), "utf8");
const template = (path) => source(path).split("<script")[0];

function routePaths(entries, parent = "") {
  return entries.flatMap((entry) => {
    const path = entry.path.startsWith("/")
      ? entry.path
      : `${parent.replace(/\/$/, "")}/${entry.path}`;
    return [path, ...routePaths(entry.children || [], path)];
  });
}

describe("v0 visible UI contract", () => {
  it("routes only to the v0 wallet, sync, recovery, and safe settings", () => {
    const paths = routePaths(routes);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/wallet",
        "/settings",
        "/settings/sync",
        "/settings/recovery",
      ])
    );
    for (const forbidden of [
      "/restore",
      "/welcome",
      "/mintdetails",
      "/discoverMints",
      "/mintratings",
      "/createreview",
      "/settings/backup",
      "/settings/lightning-address",
      "/settings/nostr",
      "/settings/payment-requests",
      "/settings/nwc",
      "/settings/hardware",
      "/settings/p2pk",
      "/settings/privacy",
      "/settings/experimental",
      "/settings/advanced",
    ]) {
      expect(paths).not.toContain(forbidden);
    }
    expect(source("src/router/routes.js")).toContain("V0WalletPage.vue");
    expect(source("src/router/routes.js")).toContain("V0WalletPage.vue");
  });

  it("exposes only Bolt11 mint and melt actions on the wallet", () => {
    const wallet = template("src/pages/V0WalletPage.vue");
    expect(wallet).toContain('data-v0-action="mint-bolt11"');
    expect(wallet).toContain('data-v0-action="melt-bolt11"');
    expect(wallet).toContain('to="/settings/sync"');
    expect(wallet).not.toMatch(
      /send token|receive token|ecash|on-chain|bolt12|lnurl|choose mint/i
    );
  });

  it("opens the wallet directly with a quiet brand header", () => {
    const wallet = template("src/pages/V0WalletPage.vue");
    expect(wallet).toContain("SILENT LINK WALLET");
    expect(wallet).not.toContain("Your money, in sync.");
    expect(wallet).not.toContain("One mint. USD accounting");
    expect(wallet).not.toContain("this.showMintDialog = true;");
  });

  it("removes mint and unit switching from reachable payment dialogs", () => {
    for (const component of [
      "src/components/CreateInvoiceDialog.vue",
      "src/components/PayInvoiceDialog.vue",
    ]) {
      const visible = template(component);
      expect(visible).not.toContain("<ChooseMint");
      expect(visible).not.toContain("toggleUnit");
    }
    expect(template("src/components/PayInvoiceDialog.vue")).not.toContain(
      "@scan"
    );
  });

  it("keeps forbidden connections out of settings navigation", () => {
    const settings = source("src/pages/settings/SettingsPage.vue");
    expect(settings).toContain("/settings/sync");
    expect(settings).toContain("/settings/recovery");
    expect(settings).not.toMatch(
      /lightning-address|nostr|payment-requests|\/settings\/nwc|hardware|p2pk|privacy|experimental|advanced/i
    );
  });

  it("wires accessible pairing and encrypted recovery actions", () => {
    const sync = template("src/pages/settings/SyncSettings.vue");
    const recovery = template("src/pages/settings/RecoverySettings.vue");
    expect(sync).toMatch(/Create pairing QR/i);
    expect(sync).toMatch(/Scan pairing QR/i);
    expect(sync).not.toMatch(
      /Advanced pairing|two-step|Create encrypted response/i
    );
    expect(sync).toContain('data-pairing-action="create-quick-pair"');
    expect(sync).toContain('data-pairing-action="scan-quick-pair"');
    expect(sync).toContain('data-pairing-action="back-wallet"');
    expect(recovery).toMatch(/encrypted recovery bundle/i);
    expect(recovery).toMatch(/Restore this wallet/i);
    expect(recovery).toContain('data-recovery-action="download"');
    expect(recovery).toContain('data-recovery-action="restore"');
    expect(recovery).toContain('data-recovery-action="delete"');
    expect(`${sync}${recovery}`).toContain("aria-live");
    expect(source("src/pages/settings/SyncSettings.vue")).toMatch(
      /created\(\)[\s\S]*useWalletStore\(\)/
    );
    expect(source("src/pages/settings/RecoverySettings.vue")).toMatch(
      /created\(\)[\s\S]*useWalletStore\(\)/
    );
  });
});
