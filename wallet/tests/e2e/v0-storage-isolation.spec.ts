import { expect, test } from "@playwright/test";
import {
  createIsolatedWalletDevices,
  type IsolatedWalletDevices,
} from "./helpers/devices";
import { checkLiveV0Services, type LiveServiceStatus } from "./helpers/live";
import {
  readIndexedDbRecord,
  readLocalStorage,
  writeIndexedDbRecord,
} from "./helpers/storage";
import { startBuiltPwaServer, type BuiltPwaServer } from "./helpers/server";

test.describe("v0 live browser infrastructure", () => {
  let server: BuiltPwaServer | undefined;
  let devices: IsolatedWalletDevices | undefined;
  let services: LiveServiceStatus;

  test.beforeAll(async () => {
    services = await checkLiveV0Services();
    if (!services.ok && process.env.CASHU_SYNC_E2E_REQUIRE_LIVE === "1") {
      throw new Error(services.message);
    }
    if (!services.ok) console.warn(services.message);
  });

  test.afterAll(async () => {
    await devices?.close();
    await server?.close();
  });

  test("boots Device A, Device B, and Recovery with isolated browser storage", async () => {
    test.skip(!services.ok, services.message);

    server = await startBuiltPwaServer();
    devices = await createIsolatedWalletDevices();
    const entries = Object.values(devices.devices);

    await Promise.all(
      entries.map(async (device) => {
        await device.page.goto(server!.walletUrl, {
          waitUntil: "domcontentloaded",
        });
        await expect(device.page.getByRole("heading", { level: 1 })).toHaveText(
          "Your money, in sync."
        );
      })
    );

    expect(new Set(entries.map((device) => device.profileDir)).size).toBe(3);

    const markerKey = "cashu-sync.e2e.device-marker";
    await devices.devices.deviceA.page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [markerKey, "device-a"]
    );
    await writeIndexedDbRecord(devices.devices.deviceA.page, {
      database: "cashu-sync-e2e-probe",
      store: "markers",
      key: "owner",
      value: "device-a",
    });

    const [localA, localB, localRecovery] = await Promise.all([
      readLocalStorage(devices.devices.deviceA.page),
      readLocalStorage(devices.devices.deviceB.page),
      readLocalStorage(devices.devices.recovery.page),
    ]);
    expect(localA[markerKey]).toBe("device-a");
    expect(localB[markerKey]).toBeUndefined();
    expect(localRecovery[markerKey]).toBeUndefined();

    await expect(
      readIndexedDbRecord(devices.devices.deviceA.page, {
        database: "cashu-sync-e2e-probe",
        store: "markers",
        key: "owner",
      })
    ).resolves.toBe("device-a");
    await expect(
      readIndexedDbRecord(devices.devices.deviceB.page, {
        database: "cashu-sync-e2e-probe",
        store: "markers",
        key: "owner",
      })
    ).resolves.toBeUndefined();
    await expect(
      readIndexedDbRecord(devices.devices.recovery.page, {
        database: "cashu-sync-e2e-probe",
        store: "markers",
        key: "owner",
      })
    ).resolves.toBeUndefined();
  });
});
