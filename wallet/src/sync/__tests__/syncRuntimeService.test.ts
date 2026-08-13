import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorityLoad = vi.fn();
const authorityImport = vi.fn((value) => value);
const authorityExport = vi.fn();
const runtimeStart = vi.fn();
const runtimeImport = vi.fn();
const bootstrapAuthorityMint = vi.fn();

vi.mock("src/sync/authorityRepository", () => ({
  LocalAuthorityRepository: class {
    loadAndRepairMnemonic = authorityLoad;
    importAuthority = authorityImport;
    exportCurrent = authorityExport;
  },
}));

vi.mock("src/sync/walletSyncRuntime", () => ({
  createBrowserWalletSyncRuntime: () => ({
    start: runtimeStart,
    importForRecovery: runtimeImport,
  }),
}));

vi.mock("src/stores/mints", () => ({
  useMintsStore: () => ({ bootstrapAuthorityMint }),
}));

import { SyncRuntimeService } from "src/sync/syncRuntimeService";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  runtimeStart.mockResolvedValue({ status: "ready", sync: "noop" });
});

describe("SyncRuntimeService", () => {
  it("does not silently create authority without explicit build endpoints", async () => {
    authorityLoad.mockReturnValue(null);
    const service = new SyncRuntimeService({ storage: new MapStorage() });
    await expect(service.boot(MNEMONIC)).resolves.toEqual({
      authority: null,
      sync: { status: "unconfigured" },
    });
    expect(authorityImport).not.toHaveBeenCalled();
    expect(bootstrapAuthorityMint).not.toHaveBeenCalled();
  });

  it("creates one local authority, bootstraps its mint, and starts sync", async () => {
    authorityLoad.mockReturnValue(null);
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      mintUrl: "http://127.0.0.1:3338",
      relayUrl: "ws://127.0.0.1:3344",
      allowLoopbackHttp: true,
    });
    const result = await service.boot(MNEMONIC);
    expect(authorityImport).toHaveBeenCalledWith(
      expect.objectContaining({
        mnemonic: MNEMONIC,
        mint_url: "http://127.0.0.1:3338",
        relay_url: "ws://127.0.0.1:3344",
        sync_secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(bootstrapAuthorityMint).toHaveBeenCalledOnce();
    expect(runtimeStart).toHaveBeenCalledOnce();
    expect(result.sync).toMatchObject({ status: "ready" });
  });

  it("imports recovery authority before mint bootstrap and sync", async () => {
    const imported = {
      schema: 0,
      mnemonic: MNEMONIC,
      sync_secret: "1".repeat(64),
      mint_url: "http://127.0.0.1:3338",
      relay_url: "ws://127.0.0.1:3344",
      head_event_id: "a".repeat(64),
    };
    runtimeImport.mockResolvedValue(imported);
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      allowLoopbackHttp: true,
    });
    await expect(service.importAndStart(imported)).resolves.toMatchObject({
      authority: imported,
      sync: { status: "ready" },
    });
    expect(runtimeImport).toHaveBeenCalledWith(imported);
    expect(bootstrapAuthorityMint).toHaveBeenCalledOnce();
  });
});

class MapStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
