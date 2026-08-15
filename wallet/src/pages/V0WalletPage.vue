<template>
  <main class="v0-wallet">
    <header class="v0-intro">
      <p class="v0-eyebrow">SILENT LINK WALLET</p>
    </header>

    <V0BalanceCard />

    <section class="v0-actions" aria-labelledby="v0-actions-title">
      <h2 id="v0-actions-title">Credits</h2>
      <q-btn
        data-v0-action="mint-bolt11"
        class="full-width"
        color="primary"
        no-caps
        unelevated
        aria-label="Buy credits"
        label="Buy credits"
        @click="showMintDialog = true"
      />
      <q-btn
        data-v0-action="melt-bolt11"
        class="full-width"
        color="primary"
        no-caps
        outline
        aria-label="Top up eSIM"
        label="Top up eSIM"
        @click="showMeltDialog = true"
      />
      <router-link to="/settings/sync" class="v0-sync-link">
        <span>
          <strong>Sync devices</strong>
          <small>Pair another wallet you control</small>
        </span>
        <ChevronRightIcon :size="18" aria-hidden="true" />
      </router-link>
    </section>

    <V0AccountingHistory />

    <p
      v-if="syncMessage"
      class="v0-runtime-status"
      role="status"
      aria-live="polite"
    >
      <q-spinner-dots
        v-if="syncPending"
        size="1.1em"
        color="primary"
        aria-label="Synchronizing wallet"
      />
      <span>{{ syncMessage }}</span>
    </p>

    <q-dialog v-model="showMintDialog">
      <q-card class="v0-dialog" data-v0-dialog="mint">
        <q-card-section class="v0-dialog__intro">
          <p class="v0-eyebrow">BUY CREDITS</p>
          <h2>Buy credits</h2>
          <p>Choose how much to add to your wallet.</p>
        </q-card-section>
        <q-card-section v-if="!mintQuote" class="v0-dialog__body">
          <q-input
            v-model="mintAmount"
            data-v0-field="mint-amount"
            class="v0-amount-input"
            dark
            outlined
            inputmode="decimal"
            prefix="$"
            label="Amount"
            hint="USD credits"
          />
        </q-card-section>
        <q-card-section v-else class="v0-dialog__body">
          <q-input
            :model-value="mintQuote.request"
            data-v0-field="mint-invoice"
            dark
            outlined
            readonly
            autogrow
            label="Payment invoice"
            @click="claimMintQuote"
          />
          <q-btn
            data-v0-action="simulate-mint-payment"
            class="full-width"
            color="primary"
            no-caps
            unelevated
            :loading="dialogBusy"
            label="I've paid — update balance"
            @click="claimMintQuote"
          />
        </q-card-section>
        <q-card-section v-if="dialogError" class="v0-dialog-error" role="alert">
          {{ dialogError }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Close" v-close-popup />
          <q-btn
            v-if="!mintQuote"
            data-v0-action="create-mint-quote"
            color="primary"
            no-caps
            unelevated
            :loading="dialogBusy"
            label="Show payment invoice"
            @click="createMintQuote"
          />
          <q-btn
            v-else
            data-v0-action="claim-mint-quote"
            color="primary"
            no-caps
            unelevated
            :loading="dialogBusy"
            label="Update balance"
            @click="claimMintQuote"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showMeltDialog">
      <q-card class="v0-dialog" data-v0-dialog="melt">
        <q-card-section class="v0-dialog__intro">
          <p class="v0-eyebrow">TOP UP ESIM</p>
          <h2>Pay for mobile data</h2>
          <p>Use your balance to pay for your eSIM top-up.</p>
        </q-card-section>
        <q-card-section v-if="!meltQuote" class="v0-dialog__body">
          <q-input
            v-model="meltAmount"
            data-v0-field="melt-amount"
            class="v0-amount-input"
            dark
            outlined
            inputmode="decimal"
            prefix="$"
            label="Amount"
            hint="USD credits"
          />
        </q-card-section>
        <q-card-section v-else class="v0-dialog__body">
          <div class="v0-quote-summary">
            <span>Amount to spend</span>
            <strong>{{ formatUsd(meltQuote.amount) }}</strong>
          </div>
          <p class="v0-dialog__note">
            This amount will be used for your eSIM top-up.
          </p>
        </q-card-section>
        <q-card-section v-if="dialogError" class="v0-dialog-error" role="alert">
          {{ dialogError }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Close" v-close-popup />
          <q-btn
            v-if="!meltQuote"
            data-v0-action="create-melt-quote"
            color="primary"
            no-caps
            unelevated
            :loading="dialogBusy"
            label="Continue"
            @click="createMeltQuote"
          />
          <q-btn
            v-else
            data-v0-action="pay-melt-quote"
            color="primary"
            no-caps
            unelevated
            :loading="dialogBusy"
            label="Confirm top up"
            @click="payMeltQuote"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </main>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { ChevronRight as ChevronRightIcon } from "lucide-vue-next";
import V0BalanceCard from "src/components/V0BalanceCard.vue";
import V0AccountingHistory from "src/components/V0AccountingHistory.vue";
import { useWalletStore } from "src/stores/wallet";
import { useMigrationsStore } from "src/stores/migrations";
import { useDexieStore } from "src/stores/dexie";
import { useSyncRuntimeService } from "src/sync/syncRuntimeService";
import { requestSilentLinkTopupQuote } from "src/sync/topupService";
import {
  useV0WalletService,
  type MeltQuoteView,
  type MintQuoteView,
} from "src/sync/v0WalletService";

export default defineComponent({
  name: "V0WalletPage",
  components: {
    V0BalanceCard,
    V0AccountingHistory,
    ChevronRightIcon,
  },
  data() {
    return {
      showMintDialog: false,
      showMeltDialog: false,
      mintAmount: "1",
      mintQuote: null as MintQuoteView | null,
      meltAmount: "1",
      meltRequest: "",
      meltQuote: null as MeltQuoteView | null,
      dialogBusy: false,
      dialogError: "",
      syncMessage: "Starting synchronized wallet…",
      syncPending: true,
      walletReady: false,
      visibilityHandler: null as (() => void) | null,
    };
  },
  methods: {
    async runDialog(operation: () => Promise<void>) {
      this.dialogBusy = true;
      this.dialogError = "";
      try {
        await operation();
      } catch (error) {
        this.dialogError =
          error instanceof Error ? error.message : "Wallet operation failed";
      } finally {
        this.dialogBusy = false;
      }
    },
    async createMintQuote() {
      await this.runDialog(async () => {
        this.mintQuote = await useV0WalletService().requestMintQuote(
          this.parseUsdCents(this.mintAmount)
        );
      });
    },
    async claimMintQuote() {
      if (!this.mintQuote) return;
      await this.runDialog(async () => {
        const result = await useV0WalletService().mintPaidQuote(
          this.mintQuote!.quote
        );
        if (result.status !== "completed") {
          throw new Error(
            "Your payment is still being recovered. Keep this window open and try Update balance again shortly."
          );
        }
        this.syncMessage = "Credits bought and synchronized.";
        this.showMintDialog = false;
        this.mintQuote = null;
      });
    },
    async createMeltQuote() {
      await this.runDialog(async () => {
        const amount = this.parseUsdCents(this.meltAmount);
        if (process.env.CASHU_SYNC_TOPUP_MODE === "internal-demo") {
          this.meltQuote = await useV0WalletService().requestInternalTopupQuote(
            amount
          );
          return;
        }
        const topup = await requestSilentLinkTopupQuote(amount);
        this.meltRequest = topup.invoice;
        this.meltQuote = await useV0WalletService().requestMeltQuote(
          topup.invoice
        );
      });
    },
    async payMeltQuote() {
      if (!this.meltQuote) return;
      await this.runDialog(async () => {
        const result = await useV0WalletService().payMeltQuote(
          this.meltQuote!.quote
        );
        if (result.status !== "completed") {
          throw new Error(
            "Your spend is still being recovered. Keep this window open and try again shortly."
          );
        }
        this.syncMessage = "Credits spent and synchronized.";
        this.showMeltDialog = false;
        this.meltQuote = null;
        this.meltAmount = "1";
        this.meltRequest = "";
      });
    },
    parseUsdCents(value: string): number {
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
      if (!match)
        throw new Error("enter a valid USD amount with up to two decimals");
      const cents =
        Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new Error("amount must be greater than zero");
      }
      return cents;
    },
    formatUsd(cents: number): string {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
    },
  },
  async created() {
    // Construct composition-backed Pinia stores while Vue still owns the
    // active component instance; later awaits must not be the first call.
    const wallet = useWalletStore();
    const migrations = useMigrationsStore();
    migrations.initMigrations();
    await migrations.runMigrations();
    await useDexieStore().migrateToDexie();

    wallet.initializeMnemonic();
    await wallet.initPaymentHistory();

    try {
      const boot = await useSyncRuntimeService().boot(wallet.mnemonic);
      if (boot.sync.status === "unconfigured") {
        this.syncPending = false;
        this.syncMessage = "Pair or restore this wallet to enable sync.";
        return;
      }
      const resumed = await useV0WalletService().resume();
      this.syncPending = false;
      this.syncMessage =
        resumed.status === "idle"
          ? "Wallet synchronized."
          : `Recovery status: ${resumed.status}`;
      this.walletReady =
        resumed.status === "idle" || resumed.status === "completed";
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          void useV0WalletService()
            .syncNow()
            .catch((error) => {
              this.syncMessage =
                error instanceof Error ? error.message : "Sync failed";
            });
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
      useV0WalletService().startLiveSync(() => {
        this.syncMessage = "Wallet synchronized.";
      });
    } catch (error) {
      this.syncPending = false;
      this.walletReady = false;
      this.syncMessage =
        error instanceof Error ? error.message : "Wallet startup failed";
    }

    const request = new URL(document.location.href).searchParams.get(
      "lightning"
    );
    if (request) {
      this.meltRequest = request;
      this.showMeltDialog = true;
    }
  },
  beforeUnmount() {
    useV0WalletService().stopLiveSync();
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  },
});
</script>

<style scoped lang="scss">
.v0-wallet {
  display: grid;
  gap: 20px;
  width: min(100%, 640px);
  margin: 0 auto;
  padding: 24px 16px 96px;
  color: #fff;
}

.v0-intro {
  padding: 12px 4px 2px;
}

.v0-eyebrow {
  margin: 0 0 7px;
  color: var(--sl-color-orange-500, #ff5c00);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.v0-intro h1 {
  margin: 0;
  font-size: clamp(2rem, 10vw, 3.25rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
}

.v0-intro > p:last-child {
  max-width: 34ch;
  margin: 12px 0 0;
  color: #9c9c9c;
  font-size: 0.95rem;
  line-height: 1.45;
}

.v0-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.v0-actions h2 {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.v0-actions :deep(.q-btn) {
  min-height: 52px;
  border-radius: 4px;
  font-weight: 700;
}

.v0-sync-link {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  min-height: 68px;
  border: 1px solid #303030;
  border-radius: 4px;
  padding: 12px 16px;
  color: #fff;
  text-decoration: none;
}

.v0-sync-link:focus-visible {
  outline: 2px solid var(--sl-color-blue-500, #3282ff);
  outline-offset: 2px;
}

.v0-sync-link span {
  display: grid;
  gap: 2px;
}

.v0-sync-link small {
  color: #8f8f8f;
}

.v0-runtime-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  border-left: 3px solid var(--sl-color-orange-500, #ff5c00);
  padding: 10px 12px;
  color: #b9b9b9;
  font-size: 0.85rem;
}

.v0-dialog {
  width: min(92vw, 520px);
  overflow: hidden;
  border: 1px solid #383838;
  border-radius: 16px;
  background: #111;
  color: #fff;
}

.v0-dialog__intro {
  border-bottom: 1px solid #2d2d2d;
  background: linear-gradient(145deg, #1b1b1b, #111 72%);
}

.v0-dialog__intro .v0-eyebrow {
  margin-bottom: 10px;
}

.v0-dialog h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

.v0-dialog p {
  margin: 0;
  color: #aaa;
  line-height: 1.45;
}

.v0-dialog__body {
  display: grid;
  gap: 14px;
}

.v0-amount-input :deep(.q-field__control) {
  min-height: 76px;
  border-radius: 12px;
}

.v0-amount-input :deep(.q-field__prefix),
.v0-amount-input :deep(.q-field__native) {
  font-size: 1.5rem;
  font-weight: 600;
}

.v0-amount-input :deep(.q-field__prefix) {
  color: var(--sl-color-orange-500, #ff5c00);
}

.v0-dialog__note {
  color: #888 !important;
  font-size: 0.85rem;
}

.v0-dialog-error {
  color: #ff8068;
}

.v0-quote-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  color: #999;
}

.v0-quote-summary strong {
  color: #fff;
  font-size: 1.75rem;
  letter-spacing: -0.02em;
}

.v0-dialog :deep(.q-card__actions) {
  gap: 8px;
  border-top: 1px solid #2d2d2d;
  padding: 14px 24px 20px;
}

.v0-dialog :deep(.q-card__actions .q-btn:last-child) {
  min-width: 148px;
}

@media (min-width: 600px) {
  .v0-wallet {
    padding-inline: 24px;
  }
}
</style>
