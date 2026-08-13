<template>
  <section class="accounting" aria-labelledby="v0-accounting-title">
    <div class="accounting-header">
      <div>
        <p class="accounting-eyebrow">Ledger</p>
        <h2 id="v0-accounting-title">Accounting</h2>
      </div>
      <span class="accounting-count">{{ rows.length }}</span>
    </div>

    <ol
      v-if="rows.length"
      class="accounting-list"
      aria-label="Recent Bolt11 accounting entries"
    >
      <li v-for="row in rows" :key="row.id" class="accounting-row">
        <div class="accounting-row__body">
          <strong>{{
            row.direction === "mint" ? "Funds added" : "Invoice paid"
          }}</strong>
          <span>{{ row.status }}</span>
          <time :datetime="row.date">{{ formatDate(row.date) }}</time>
        </div>
        <span
          class="accounting-amount"
          :class="`accounting-amount--${row.direction}`"
        >
          {{ formatAmount(row) }}
        </span>
      </li>
    </ol>
    <p v-else class="accounting-empty">
      Mint and melt entries will appear here.
    </p>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapState } from "pinia";
import {
  usePaymentHistoryStore,
  type PaymentHistoryRow,
} from "src/stores/paymentHistory";
import { useUiStore } from "src/stores/ui";
import { PaymentMethod } from "src/stores/walletTypes";

export default defineComponent({
  name: "V0AccountingHistory",
  computed: {
    ...mapState(usePaymentHistoryStore, ["paymentHistory"]),
    rows(): PaymentHistoryRow[] {
      return this.paymentHistory
        .filter((row) => row.method === PaymentMethod.Bolt11)
        .slice(0, 20);
    },
  },
  methods: {
    formatAmount(row: PaymentHistoryRow): string {
      const sign = row.direction === "mint" ? "+" : "−";
      return `${sign}${useUiStore().formatCurrency(
        Math.abs(Number(row.amount) || 0),
        row.unit || "usd",
        true
      )}`;
    },
    formatDate(date: string): string {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.valueOf())) return date;
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(parsed);
    },
  },
});
</script>

<style scoped lang="scss">
.accounting {
  border: 1px solid #2c2c2c;
  border-radius: 8px;
  background: #111;
}

.accounting-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #292929;
  padding: 18px 20px;
}

.accounting-eyebrow {
  margin: 0 0 2px;
  color: var(--sl-color-orange-500, #ff5c00);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: #fff;
  font-size: 1.15rem;
  font-weight: 700;
}

.accounting-count {
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 2px 7px;
  color: #aaa;
  font-size: 0.72rem;
}

.accounting-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.accounting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  border-bottom: 1px solid #262626;
  padding: 12px 20px;
}

.accounting-row:last-child {
  border-bottom: 0;
}

.accounting-row__body {
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 8px;
  min-width: 0;
}

.accounting-row__body strong {
  grid-column: 1 / -1;
  color: #f6f6f6;
}

.accounting-row__body span,
.accounting-row__body time {
  color: #898989;
  font-size: 0.75rem;
  text-transform: capitalize;
}

.accounting-amount {
  flex: none;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
}

.accounting-amount--mint {
  color: var(--sl-color-orange-500, #ff5c00);
}

.accounting-empty {
  margin: 0;
  padding: 30px 20px;
  color: #898989;
  text-align: center;
}
</style>
