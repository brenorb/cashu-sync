import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

export type WalletDeviceName = "deviceA" | "deviceB" | "recovery";

export type WalletDevice = {
  name: WalletDeviceName;
  profileDir: string;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
};

export type IsolatedWalletDevices = {
  rootDir: string;
  devices: Record<WalletDeviceName, WalletDevice>;
  close: () => Promise<void>;
};

const DEVICE_DIRECTORIES: Record<WalletDeviceName, string> = {
  deviceA: "device-a",
  deviceB: "device-b",
  recovery: "recovery",
};

type PersistentContextOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

function launchOptions(): PersistentContextOptions {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const explicitChannel = process.env.PLAYWRIGHT_CHANNEL;
  const installedChrome =
    process.platform === "darwin" &&
    existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

  return {
    baseURL: undefined,
    channel:
      executablePath || explicitChannel === "none"
        ? undefined
        : explicitChannel || (installedChrome ? "chrome" : undefined),
    executablePath: executablePath || undefined,
    headless: process.env.PWDEBUG !== "1",
    locale: "en-US",
    viewport: { width: 390, height: 844 },
  };
}

export async function createIsolatedWalletDevices(): Promise<IsolatedWalletDevices> {
  const rootDir = await mkdtemp(join(tmpdir(), "cashu-sync-e2e-"));
  const opened: WalletDevice[] = [];
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    for (const device of opened) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          device.context.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${device.name} context close timed out`)),
              5_000
            );
          }),
        ]);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    await rm(rootDir, { recursive: true, force: true });
  };

  try {
    for (const name of Object.keys(DEVICE_DIRECTORIES) as WalletDeviceName[]) {
      const profileDir = join(rootDir, DEVICE_DIRECTORIES[name]);
      await mkdir(profileDir, { recursive: false });
      const context = await chromium.launchPersistentContext(
        profileDir,
        launchOptions()
      );
      const page = context.pages()[0] || (await context.newPage());
      const consoleErrors: string[] = [];
      page.on("pageerror", (error) => {
        consoleErrors.push(`page error: ${error.message}`);
        console.error(`[${name}] page error: ${error.message}`);
      });
      page.on("requestfailed", (request) =>
        console.error(
          `[${name}] request failed: ${request.method()} ${request.url()} ${
            request.failure()?.errorText || "unknown"
          }`
        )
      );
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
        if (
          process.env.CASHU_SYNC_E2E_DEBUG === "1" ||
          message.type() === "error" ||
          message.type() === "warning"
        ) {
          console.log(`[${name}] console.${message.type()}: ${message.text()}`);
        }
      });
      opened.push({ name, profileDir, context, page, consoleErrors });
    }

    return {
      rootDir,
      devices: Object.fromEntries(
        opened.map((device) => [device.name, device])
      ) as Record<WalletDeviceName, WalletDevice>,
      close,
    };
  } catch (error) {
    await close();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to launch three isolated persistent wallet contexts. Install Chrome, set PLAYWRIGHT_CHANNEL, or run 'npx playwright install chromium'. ${detail}`,
      { cause: error }
    );
  }
}
