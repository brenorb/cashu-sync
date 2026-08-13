<template>
  <main class="v0-wallet">
    <header class="v0-intro">
      <p class="v0-eyebrow">Silent Link Wallet</p>
      <h1>Your money, in sync.</h1>
      <p>One mint. USD accounting across every wallet you control.</p>
    </header>

    <V0BalanceCard />

    <section class="v0-actions" aria-labelledby="v0-actions-title">
      <h2 id="v0-actions-title">Wallet actions</h2>
      <q-btn
        data-v0-action="mint-bolt11"
        class="full-width"
        color="primary"
        no-caps
        unelevated
        :disable="!activeMintUrl"
        aria-label="Add funds with a Lightning invoice"
        label="Add funds"
        @click="openMint"
      />
      <q-btn
        data-v0-action="melt-bolt11"
        class="full-width"
        color="primary"
        no-caps
        outline
        :disable="!activeMintUrl"
        aria-label="Pay a Lightning invoice"
        label="Pay invoice"
        @click="openMelt()"
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

    <CreateInvoiceDialog />
    <PayInvoiceDialog />
    <InvoiceDetailDialog />
  </main>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapState, mapWritableState } from "pinia";
import { ChevronRight as ChevronRightIcon } from "lucide-vue-next";
import V0BalanceCard from "src/components/V0BalanceCard.vue";
import V0AccountingHistory from "src/components/V0AccountingHistory.vue";
import CreateInvoiceDialog from "src/components/CreateInvoiceDialog.vue";
import PayInvoiceDialog from "src/components/PayInvoiceDialog.vue";
import InvoiceDetailDialog from "src/components/InvoiceDetailDialog.vue";
import { useMintsStore } from "src/stores/mints";
import { useUiStore } from "src/stores/ui";
import { useWalletStore } from "src/stores/wallet";
import { useMigrationsStore } from "src/stores/migrations";
import { PaymentMethod } from "src/stores/walletTypes";

export default defineComponent({
  name: "V0WalletPage",
  components: {
    V0BalanceCard,
    V0AccountingHistory,
    CreateInvoiceDialog,
    PayInvoiceDialog,
    InvoiceDetailDialog,
    ChevronRightIcon,
  },
  computed: {
    ...mapState(useMintsStore, ["activeMintUrl", "activeUnit"]),
    ...mapWritableState(useUiStore, [
      "showCreateInvoiceDialog",
      "showInvoiceDetails",
    ]),
    ...mapWritableState(useWalletStore, ["invoiceData", "payInvoiceData"]),
  },
  methods: {
    openMint() {
      this.invoiceData = {
        amount: 0,
        request: "",
        quote: "",
        memo: "",
        date: "",
        status: "pending",
        mint: this.activeMintUrl,
        unit: this.activeUnit,
        type: PaymentMethod.Bolt11,
      };
      this.showCreateInvoiceDialog = true;
    },
    async openMelt(request = "") {
      this.payInvoiceData.show = true;
      this.payInvoiceData.invoice = null;
      this.payInvoiceData.input.amount = undefined;
      this.payInvoiceData.input.quote = "";
      this.payInvoiceData.input.request = request;
      this.payInvoiceData.meltQuote.error = "";
      if (request) {
        await useWalletStore().decodeRequest(request);
      }
    },
  },
  async created() {
    const migrations = useMigrationsStore();
    migrations.initMigrations();
    await migrations.runMigrations();

    const wallet = useWalletStore();
    wallet.initializeMnemonic();
    await wallet.initPaymentHistory();

    const request = new URL(document.location.href).searchParams.get(
      "lightning"
    );
    if (request) await this.openMelt(request);
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

@media (min-width: 600px) {
  .v0-wallet {
    padding-inline: 24px;
  }
}
</style>
