import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const walletRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(walletRoot, path), "utf8");

describe("Silent Link visual contract", () => {
  it("documents observed values separately from wallet mappings", () => {
    const design = read("../DESIGN.md");

    expect(design).toContain("Observed on silent.link");
    expect(design).toContain("Wallet implementation mapping");
    expect(design).toContain("https://silent.link/static/css/");
    expect(design).toContain("License and trademark caveat");
  });

  it("passes the DESIGN.md specification with no errors or warnings", () => {
    const result = JSON.parse(
      execFileSync(
        resolve(walletRoot, "node_modules/.bin/designmd"),
        ["lint", resolve(walletRoot, "../DESIGN.md")],
        { encoding: "utf8" }
      )
    );

    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(0);
  });

  it("pins the public brand palette and Karla typography", () => {
    const quasarVariables = read("src/css/quasar.variables.scss");
    const appCss = read("src/css/app.scss");

    expect(quasarVariables).toContain("$primary: #ff9900");
    expect(quasarVariables).toContain("$secondary: #0066ff");
    expect(quasarVariables).toContain("$dark: #090909");
    expect(appCss).toContain('font-family: "Karla"');
    expect(appCss).not.toContain("fonts.googleapis.com");
  });

  it("makes the Silent Link mapping the default without deleting legacy themes", () => {
    const baseCss = read("src/css/base.scss");
    const boot = read("src/boot/base.js");

    expect(baseCss).toMatch(/"silent":\s*\([\s\S]*primary: #ff9900/);
    expect(boot).toContain('this.changeColor("silent")');
  });

  it("ships the public wordmark and locally served font files", () => {
    const assets = {
      "src/assets/silent-link-logo.svg":
        "89bafac522124c287c9284eb38845b98fe51142efdbf72eb7d4614d4fe2e0309",
      "src/fonts/karla-regular.woff2":
        "ab2065cccc500eec877d8324662d806c785ee67cd3cc6d964eb855bb766e3527",
      "src/fonts/karla-medium.woff2":
        "4353718fa05dc37393f73adaec6e24745e29cbd0bcd0d0b671ec339cf0f89487",
      "src/fonts/karla-bold.woff2":
        "02952a40c7bf3eeb6700c3c179297c3b5be734db7368bbccecbf1be00536e465",
    };

    for (const [asset, checksum] of Object.entries(assets)) {
      expect(existsSync(resolve(walletRoot, asset)), asset).toBe(true);
      const bytes = readFileSync(resolve(walletRoot, asset));
      expect(createHash("sha256").update(bytes).digest("hex"), asset).toBe(
        checksum
      );
    }
  });

  it("uses the wordmark in the shell and onboarding", () => {
    const header = read("src/components/MainHeader.vue");
    const welcome = read("src/pages/welcome/WelcomeSlide1.vue");

    expect(header).toContain('alt="Silent Link"');
    expect(header).toContain("silent-link-logo.svg");
    expect(welcome).toContain('alt="Silent Link"');
    expect(welcome).toContain("silent-link-logo.svg");
    expect(welcome).not.toContain("/clean.png");
  });

  it("provides visible keyboard focus and reduced-motion fallbacks", () => {
    const appCss = read("src/css/app.scss");

    expect(appCss).toContain(":focus-visible");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
