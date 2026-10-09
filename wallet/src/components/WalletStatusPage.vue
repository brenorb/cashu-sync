<template>
  <main class="wallet-status-page">
    <div class="wallet-status-content">
      <p v-if="code" class="wallet-status-code" aria-hidden="true">
        {{ code }}
      </p>
      <h1>{{ title }}</h1>
      <p class="wallet-status-caption">{{ caption }}</p>
      <slot />
    </div>
  </main>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "WalletStatusPage",
  props: {
    title: { type: String, required: true },
    caption: { type: String, default: "" },
    code: { type: String, default: "" },
  },
});
</script>

<style scoped lang="scss">
.wallet-status-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: safe center;
  justify-items: center;
  min-height: 100vh;
  min-height: 100svh;
  padding: clamp(16px, 4vw, 32px);
  background: var(--sl-ink);
  color: var(--sl-on-ink);
  text-align: center;
  overflow-wrap: anywhere;
}

.wallet-status-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  gap: 20px;
  width: min(100%, 32rem);
}

.wallet-status-content > * {
  min-width: 0;
  max-width: 100%;
  margin: 0;
}

.wallet-status-code {
  font-size: clamp(3rem, 24vw, 8rem);
  font-weight: 700;
  line-height: 1;
}

h1 {
  font-size: clamp(1.5rem, 7vw, 2rem);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.wallet-status-caption {
  color: #a9a9a9;
  line-height: 1.5;
}

.wallet-status-content :deep(.q-btn__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
