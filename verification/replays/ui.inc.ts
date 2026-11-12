
import SyncSettings from "../../pages/settings/SyncSettings.vue";
import WalletPage from "../../pages/V0WalletPage.vue";
import { vi } from "vitest";
import * as runtime from "../syncRuntimeService";
import * as service from "../v0WalletService";
vi.mock("../../components/QrcodeReader.vue", () => ({ default: {} }));


it("audit: the receiving screen preserves its wallet and withholds the ACK", async () => {
  const relay = new MemoryPairingRelay();
  const host = AutoPairingHostSession.create({
    relayUrl: "ws://127.0.0.1:3335", relay, hooks,
  });
  const done = vi.fn();
  const onError = vi.fn();
  host.start(fixture, done, onError);
  const join = AutoPairingJoinSession.fromQr(encodeAutoPairingQrV0(host.qr), {
    relay, hooks,
  });
  const fromQr = vi.spyOn(AutoPairingJoinSession, "fromQr").mockReturnValue(join);
  const useRuntime = vi.spyOn(runtime, "useSyncRuntimeService").mockReturnValue({
    allowLoopbackHttp: true,
    replaceEmptyAndStart: async () => {
      throw new Error("pairing or recovery requires an empty local wallet");
    },
  } as never);
  const context = {
    applyPairing: SyncSettings.methods!.applyPairing,
    run: async (fn: () => Promise<void>) => fn(),
    showOverwriteDialog: false,
    message: "",
  };
  try {
    await SyncSettings.methods!.finishPairing.call(context as never, "fixture");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.showOverwriteDialog).toBe(true);
    expect(context.message).toContain("preserved");
    expect(done).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    host.destroy();
    join.destroy();
    fromQr.mockRestore();
    useRuntime.mockRestore();
  }
});

it("audit: a changed head alone makes the host screen show pairing success", async () => {
  const host = AutoPairingHostSession.create({
    relayUrl: "ws://127.0.0.1:3335", relay: new MemoryPairingRelay(), hooks,
  });
  const create = vi.spyOn(AutoPairingHostSession, "create").mockReturnValue(host);
  let changed: ((event: { id: string }) => void) | undefined;
  const useRuntime = vi.spyOn(runtime, "useSyncRuntimeService").mockReturnValue({
    runtime: { currentSession: () => ({
      repository: { exportSnapshot: async () => ({ previous_event_id: "before" }) },
      sync: { watchCurrent: (callback: typeof changed) => { changed = callback; return () => {}; } },
    }) },
    exportAuthority: async () => fixture,
  } as never);
  const useService = vi.spyOn(service, "useV0WalletService").mockReturnValue({
    syncNow: async () => {},
  } as never);
  const context = {
    run: async (fn: () => Promise<void>) => fn(),
    pairingScreenActive: true,
    stopPairingWatcher: vi.fn(),
    showPairingSuccess: vi.fn(),
  };
  try {
    await SyncSettings.methods!.createPairing.call(context as never);
    expect(context.showPairingSuccess).not.toHaveBeenCalled();
    changed!({ id: "before" });
    expect(context.showPairingSuccess).not.toHaveBeenCalled();
    changed!({ id: "unrelated-head" });
    await Promise.resolve();
    expect(context.showPairingSuccess).toHaveBeenCalledOnce();
  } finally {
    host.destroy();
    create.mockRestore();
    useRuntime.mockRestore();
    useService.mockRestore();
  }
});

it("audit: the spend dialog reports success for a completed UNPAID journal", async () => {
  const useService = vi.spyOn(service, "useV0WalletService").mockReturnValue({
    payMeltQuote: async () => ({ status: "completed", quoteId: "melt-q" }),
  } as never);
  const context = { runDialog: async (fn: () => Promise<void>) => fn(),
    meltQuote: { quote: "melt-q" }, showMeltDialog: true, syncMessage: "" };
  try {
    await WalletPage.methods!.payMeltQuote.call(context as never);
    expect(context.syncMessage).toBe("Credits spent and synchronized.");
    expect(context.showMeltDialog).toBe(false);
  } finally {
    useService.mockRestore();
  }
});

it("audit: watch connection says synchronized while wallet recovery is unresolved", () => {
  const useService = vi.spyOn(service, "useV0WalletService").mockReturnValue({
    startLiveSync: (_synced: () => void, status: (value: string) => void) => status("connected"),
  } as never);
  const context = { walletReady: false, recoveryNeeded: true, syncPending: true, syncMessage: "" };
  try {
    WalletPage.methods!.startWatchingWallet.call(context as never);
    expect(context.recoveryNeeded).toBe(true);
    expect(context.walletReady).toBe(false);
    expect(context.syncMessage).toBe("Wallet synchronized.");
  } finally {
    useService.mockRestore();
  }
});

it("audit: a disconnected watcher reports reconnecting", () => {
  const useService = vi.spyOn(service, "useV0WalletService").mockReturnValue({
    startLiveSync: (_synced: () => void, status: (value: string) => void) => status("disconnected"),
  } as never);
  const context = { syncPending: false, syncMessage: "" };
  try {
    WalletPage.methods!.startWatchingWallet.call(context as never);
    expect(context.syncPending).toBe(true);
    expect(context.syncMessage).toBe("Reconnecting wallet…");
  } finally {
    useService.mockRestore();
  }
});
