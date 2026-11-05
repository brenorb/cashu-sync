import { beforeEach, describe, expect, it, vi } from "vitest";

const recovery = vi.hoisted(() => ({
  resume: vi.fn(),
  currentSession: vi.fn(),
  boot: vi.fn(),
  mintGet: vi.fn(),
  meltGet: vi.fn(),
}));

vi.mock("src/components/V0BalanceCard.vue", () => ({ default: {} }));
vi.mock("src/components/V0AccountingHistory.vue", () => ({ default: {} }));
vi.mock("src/stores/wallet", () => ({
  useWalletStore: () => ({ mnemonic: "fixture-only-not-a-wallet-seed" }),
}));
vi.mock("src/stores/migrations", () => ({ useMigrationsStore: vi.fn() }));
vi.mock("src/stores/dexie", () => ({
  cashuDb: {
    mintQuotes: { get: recovery.mintGet },
    meltQuotes: { get: recovery.meltGet },
  },
  useDexieStore: vi.fn(),
}));
vi.mock("src/sync/syncRuntimeService", () => ({
  useSyncRuntimeService: () => ({
    runtime: { currentSession: recovery.currentSession },
    boot: recovery.boot,
  }),
}));
vi.mock("src/sync/topupService", () => ({
  requestSilentLinkTopupQuote: vi.fn(),
}));
vi.mock("src/sync/v0WalletService", () => ({
  useV0WalletService: () => ({ resume: recovery.resume }),
}));

// Import the actual SFC through the repository's existing Vue Vitest plugin.
// Calling its method directly avoids created() and any browser/network startup.
import V0WalletPage from "src/pages/V0WalletPage.vue";

type RecoveryState = Record<string, unknown> & {
  showMeltDialog: boolean;
  meltQuote: { quote: string } | null;
  showMintDialog: boolean;
  mintQuote: { quote: string } | null;
};

const pageOptions = V0WalletPage as unknown as {
  data(): RecoveryState;
  methods: { resumeAutomatically(this: RecoveryState): Promise<void> };
};

function pendingMeltState(): RecoveryState {
  return {
    ...pageOptions.data(),
    showMeltDialog: true,
    meltQuote: { quote: "fixture-current-melt" },
    meltAmount: "2.50",
    meltRequest: "fixture-invoice",
    meltInvoiceMode: true,
    dialogError: "Your spend is still being recovered.",
    recoveryNeeded: true,
    startWatchingWallet: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  recovery.currentSession.mockReturnValue({});
  recovery.resume.mockResolvedValue({ status: "idle" });
  recovery.mintGet.mockResolvedValue(undefined);
  recovery.meltGet.mockResolvedValue(undefined);
});

describe("V0 wallet automatic dialog recovery", () => {
  it.each(["completed", "idle"])(
    "closes and resets a durably paid melt after resume returns %s",
    async (status) => {
      const state = pendingMeltState();
      recovery.resume.mockResolvedValue({
        status,
        type: "melt",
        quoteId: "fixture-current-melt",
      });
      recovery.meltGet.mockImplementation(async (quote) =>
        quote === "fixture-current-melt" ? { state: "PAID" } : undefined
      );

      await pageOptions.methods.resumeAutomatically.call(state);

      expect(recovery.resume).toHaveBeenCalledOnce();
      expect(state).toMatchObject({
        showMeltDialog: false,
        meltQuote: null,
        meltAmount: "1",
        meltRequest: "",
        meltInvoiceMode: false,
        dialogError: "",
        automaticRecoveryBusy: false,
        syncMessage: "Credits spent and synchronized.",
      });
    }
  );

  it.each(["UNPAID", "PENDING"])(
    "keeps the current %s melt dialog open",
    async (quoteState) => {
      const state = pendingMeltState();
      recovery.meltGet.mockResolvedValue({ state: quoteState });

      await pageOptions.methods.resumeAutomatically.call(state);

      expect(state.showMeltDialog).toBe(true);
      expect(state.meltQuote).toEqual({ quote: "fixture-current-melt" });
      expect(state.meltAmount).toBe("2.50");
      expect(state.meltRequest).toBe("fixture-invoice");
      expect(state.meltInvoiceMode).toBe(true);
    }
  );

  it("does not close the current unpaid quote when a different melt completed", async () => {
    const state = pendingMeltState();
    recovery.resume.mockResolvedValue({
      status: "completed",
      type: "melt",
      quoteId: "fixture-other-melt",
    });
    recovery.meltGet.mockImplementation(async (quote) => ({
      state: quote === "fixture-other-melt" ? "PAID" : "UNPAID",
    }));

    await pageOptions.methods.resumeAutomatically.call(state);

    expect(state.showMeltDialog).toBe(true);
    expect(state.meltQuote).toEqual({ quote: "fixture-current-melt" });
  });

  it("does not close the melt while reconciliation is still pending", async () => {
    const state = pendingMeltState();
    recovery.resume.mockResolvedValue({ status: "needs-reconciliation" });
    recovery.meltGet.mockResolvedValue({ state: "PAID" });

    await pageOptions.methods.resumeAutomatically.call(state);

    expect(state.showMeltDialog).toBe(true);
    expect(state.meltQuote).toEqual({ quote: "fixture-current-melt" });
    expect(state.automaticRecoveryBusy).toBe(false);
  });

  it("preserves a newly selected melt when an older paid quote lookup finishes", async () => {
    const state = pendingMeltState();
    let resolveOldQuote!: (value: { state: string }) => void;
    let markLookupStarted!: () => void;
    const oldQuote = new Promise<{ state: string }>((resolve) => {
      resolveOldQuote = resolve;
    });
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    recovery.meltGet.mockImplementation((quote) => {
      if (quote === "fixture-current-melt") {
        markLookupStarted();
        return oldQuote;
      }
      return Promise.resolve({ state: "UNPAID" });
    });

    const resuming = pageOptions.methods.resumeAutomatically.call(state);
    // Existing code has no melt lookup and simply returns. Once that lookup
    // exists, pause precisely while its old-quote response remains unresolved.
    await Promise.race([lookupStarted, resuming]);
    Object.assign(state, {
      meltQuote: { quote: "fixture-new-melt" },
      meltAmount: "7",
      meltRequest: "fixture-new-invoice",
      meltInvoiceMode: false,
      dialogError: "",
    });
    resolveOldQuote({ state: "PAID" });
    await resuming;

    expect(state).toMatchObject({
      showMeltDialog: true,
      meltQuote: { quote: "fixture-new-melt" },
      meltAmount: "7",
      meltRequest: "fixture-new-invoice",
      meltInvoiceMode: false,
      dialogError: "",
    });
  });

  it("retains the existing automatic issued-mint dialog completion", async () => {
    const state = pendingMeltState();
    state.showMintDialog = true;
    state.mintQuote = { quote: "fixture-current-mint" };
    recovery.mintGet.mockResolvedValue({ state: "ISSUED" });
    recovery.meltGet.mockResolvedValue({ state: "UNPAID" });

    await pageOptions.methods.resumeAutomatically.call(state);

    expect(recovery.mintGet).toHaveBeenCalledWith("fixture-current-mint");
    expect(state.showMintDialog).toBe(false);
    expect(state.mintQuote).toBeNull();
    expect(state.syncMessage).toBe("Credits bought and synchronized.");
    expect(state.showMeltDialog).toBe(true);
  });
});
