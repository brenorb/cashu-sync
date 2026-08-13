<template>
  <section class="balance-card" aria-labelledby="v0-balance-title">
    <p id="v0-balance-title" class="balance-eyebrow">Available balance</p>
    <p class="balance-value" role="status" aria-live="polite">
      {{ formattedBalance }}
    </p>
    <div class="mint-status">
      <span class="mint-status__mark" aria-hidden="true"></span>
      {{ activeMintUrl ? "Configured mint" : "Configured mint unavailable" }}
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapState } from "pinia";
import { useMintsStore } from "src/stores/mints";
import { useUiStore } from "src/stores/ui";

export default defineComponent({
  name: "V0BalanceCard",
  computed: {
    ...mapState(useMintsStore, [
      "totalUnitBalance",
      "activeUnit",
      "activeMintUrl",
    ]),
    formattedBalance(): string {
      return useUiStore().formatCurrency(
        Number(this.totalUnitBalance) || 0,
        this.activeUnit || "usd"
      );
    },
  },
});
</script>

<style scoped lang="scss">
.balance-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #343434;
  border-radius: 8px;
  background: #111;
  padding: 28px 24px 24px;
}

.balance-card::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: var(--sl-color-orange-500, #ff5c00);
  content: "";
}

.balance-eyebrow {
  margin: 0;
  color: #929292;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.balance-value {
  margin: 12px 0 22px;
  color: #fff;
  font-size: clamp(2.5rem, 14vw, 4rem);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
}

.mint-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #b7b7b7;
  font-size: 0.8rem;
}

.mint-status__mark {
  width: 7px;
  height: 7px;
  background: var(--sl-color-orange-500, #ff5c00);
}
</style>
