import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cashuDb, resetCashuDexie } from "src/stores/dexie";

const authorityLoad = vi.fn();
const authorityImport = vi.fn((value) => value);
const authorityExport = vi.fn();
const authorityClear = vi.fn();
const runtimeStart = vi.fn();
const runtimeImport = vi.fn();
const runtimeReset = vi.fn();
const bootstrapAuthorityMint = vi.fn();
const patchMintState = vi.fn((value) => Object.assign(mintStore, value));
const mintStore = {
  bootstrapAuthorityMint,
  mints: [] as Array<Record<string, unknown>>,
  activeMintUrl: "",
  activeUnit: "usd",
  authorityMintUrl: "",
  activeProofs: [] as Array<Record<string, unknown>>,
  $patch: patchMintState,
};

vi.mock("src/sync/authorityRepository", () => ({
  LocalAuthorityRepository: class {
    load = authorityLoad;
    loadAndRepairMnemonic = authorityLoad;
    importAuthority = authorityImport;
    exportCurrent = authorityExport;
    validate = authorityImport;
    clear = authorityClear;
  },
}));

vi.mock("src/sync/walletSyncRuntime", () => ({
  createBrowserWalletSyncRuntime: () => ({
    start: runtimeStart,
    importForRecovery: runtimeImport,
    resetSession: runtimeReset,
  }),
}));

vi.mock("src/stores/mints", () => ({
  useMintsStore: () => mintStore,
}));

import { SyncRuntimeService } from "src/sync/syncRuntimeService";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

beforeEach(async () => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  runtimeImport.mockReset();
  bootstrapAuthorityMint.mockReset().mockResolvedValue(undefined);
  authorityLoad.mockReturnValue(null);
  Object.assign(mintStore, {
    mints: [],
    activeMintUrl: "",
    activeUnit: "usd",
    authorityMintUrl: "",
    activeProofs: [],
  });
  await resetCashuDexie(cashuDb);
  runtimeStart.mockResolvedValue({ status: "ready", sync: "noop" });
});

describe("SyncRuntimeService", () => {
  it("re-pairs the same funded authority without deleting local proofs or its checkpoint", async () => {
    const authority = {
      schema: 0,
      mnemonic: MNEMONIC,
      sync_secret: "1".repeat(64),
      mint_url: "http://127.0.0.1:3338",
      relay_url: "ws://127.0.0.1:3344",
      head_event_id: "a".repeat(64),
    };
    authorityLoad.mockReturnValue(authority);
    await cashuDb.proofs.put({
      id: "00c0ffee",
      amount: 100,
      secret: "local-proof",
      C: "02aa",
      reserved: false,
    });
    const state = {
      id: "wallet" as const,
      revision: 4,
      head_event_id: authority.head_event_id,
      counters: { "00c0ffee": 8 },
      pending_operation: null,
    };
    await cashuDb.walletSyncState.put(state);
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      allowLoopbackHttp: true,
    });

    await expect(
      service.replaceEmptyAndStart({
        ...authority,
        head_event_id: "b".repeat(64),
      })
    ).resolves.toMatchObject({ sync: { status: "ready" } });

    expect(await cashuDb.proofs.get("local-proof")).toMatchObject({
      amount: 100,
    });
    expect(await cashuDb.walletSyncState.get("wallet")).toEqual(state);
    expect(authorityClear).not.toHaveBeenCalled();
    expect(runtimeImport).not.toHaveBeenCalled();
    expect(runtimeStart).toHaveBeenCalledOnce();
  });

  it("never erases a funded wallet when a different authority cannot be imported", async () => {
    const authority = {
      schema: 0,
      mnemonic: MNEMONIC,
      sync_secret: "1".repeat(64),
      mint_url: "http://127.0.0.1:3338",
      relay_url: "ws://127.0.0.1:3344",
      head_event_id: "a".repeat(64),
    };
    authorityLoad.mockReturnValue(authority);
    await cashuDb.proofs.put({
      id: "00c0ffee",
      amount: 100,
      secret: "local-proof",
      C: "02aa",
      reserved: false,
    });
    runtimeImport.mockRejectedValueOnce(new Error("relay unavailable"));
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      allowLoopbackHttp: true,
    });
    await expect(
      service.replaceEmptyAndStart({
        ...authority,
        sync_secret: "2".repeat(64),
      })
    ).rejects.toThrow();
    expect(await cashuDb.proofs.get("local-proof")).toMatchObject({
      amount: 100,
    });
    expect(authorityClear).not.toHaveBeenCalled();
  });

  it("boots an already configured cached USD mint without a network bootstrap", async () => {
    const mintUrl = "http://127.0.0.1:3338";
    authorityLoad.mockReturnValue({
      schema: 0,
      mnemonic: MNEMONIC,
      sync_secret: "1".repeat(64),
      mint_url: mintUrl,
      relay_url: "ws://127.0.0.1:3344",
      head_event_id: "a".repeat(64),
    });
    Object.assign(mintStore, {
      activeMintUrl: mintUrl,
      authorityMintUrl: "",
      activeUnit: "usd",
      mints: [
        {
          url: mintUrl,
          info: { version: "Nutshell/0.20.3" },
          keys: [{ id: "key", unit: "usd" }],
          keysets: [{ id: "key", unit: "usd" }],
        },
      ],
    });
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      allowLoopbackHttp: true,
    });
    await expect(service.boot(MNEMONIC)).resolves.toMatchObject({
      sync: { status: "ready" },
    });
    expect(bootstrapAuthorityMint).not.toHaveBeenCalled();
    expect(mintStore.authorityMintUrl).toBe(mintUrl);
    expect(runtimeStart).toHaveBeenCalledOnce();
  });

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

  it("replaces only an empty local genesis during pairing", async () => {
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

    await expect(service.replaceEmptyAndStart(imported)).resolves.toMatchObject(
      {
        authority: imported,
        sync: { status: "ready" },
      }
    );
    expect(authorityClear).toHaveBeenCalledOnce();

    await cashuDb.proofs.put({
      id: "00c0ffee",
      amount: 1,
      secret: "owned-proof",
      C: "02aa",
      reserved: false,
    });
    await expect(service.replaceEmptyAndStart(imported)).rejects.toThrow(
      /empty local wallet/
    );
  });

  it("refuses to replace a different funded wallet", async () => {
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
    await cashuDb.proofs.put({
      id: "00c0ffee",
      amount: 1,
      secret: "owned-proof",
      C: "02aa",
      reserved: false,
    });

    await expect(service.replaceEmptyAndStart(imported)).rejects.toThrow(
      /empty local wallet/
    );
    expect(await cashuDb.proofs.count()).toBe(1);
    expect(runtimeImport).not.toHaveBeenCalled();
  });

  it("restores the exact mint state when first-time recovery fails", async () => {
    const imported = {
      schema: 0,
      mnemonic: MNEMONIC,
      sync_secret: "1".repeat(64),
      mint_url: "http://127.0.0.1:3338",
      relay_url: "ws://127.0.0.1:3344",
      head_event_id: "a".repeat(64),
    };
    const previousMintState = {
      mints: [{ url: "https://previous.example", keys: [], keysets: [] }],
      activeMintUrl: "https://previous.example",
      activeUnit: "usd",
      authorityMintUrl: "",
      activeProofs: [],
    };
    Object.assign(mintStore, {
      ...previousMintState,
      mints: reactive(previousMintState.mints),
      activeProofs: reactive(previousMintState.activeProofs),
    });
    bootstrapAuthorityMint.mockImplementation(async () => {
      Object.assign(mintStore, {
        mints: [{ url: imported.mint_url, keys: [], keysets: [] }],
        activeMintUrl: imported.mint_url,
        authorityMintUrl: imported.mint_url,
        activeProofs: [],
      });
    });
    runtimeImport.mockResolvedValue(imported);
    runtimeStart.mockRejectedValue(new Error("relay unavailable"));
    const service = new SyncRuntimeService({
      storage: new MapStorage(),
      allowLoopbackHttp: true,
    });

    await expect(service.replaceEmptyAndStart(imported)).rejects.toThrow(
      /relay unavailable/
    );

    expect(mintStore).toMatchObject(previousMintState);
    expect(patchMintState).toHaveBeenCalledWith(previousMintState);
    expect(runtimeReset).toHaveBeenCalledTimes(2);
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
