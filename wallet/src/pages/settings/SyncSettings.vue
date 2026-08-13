<template>
  <SettingsPageShell
    title="Sync devices"
    caption="Keep every wallet you control aligned through your relay."
  >
    <SettingsSection title="Pairing">
      <q-item class="column items-stretch q-pa-lg">
        <div class="sync-status" role="status" aria-live="polite">
          <span class="sync-status__mark" aria-hidden="true"></span>
          Not paired
        </div>
        <h2 class="sync-heading">Relay sync is not connected</h2>
        <p class="sync-copy">
          Pair another wallet you control by exchanging two QR codes. No wallet
          authority is placed in a link or sent in plaintext.
        </p>
        <q-btn
          class="full-width q-mt-md"
          color="primary"
          no-caps
          unelevated
          disable
          aria-label="Pair another wallet; coming soon"
          label="Pair another wallet"
        />
      </q-item>
    </SettingsSection>

    <SettingsSection title="How pairing works">
      <q-item class="pairing-step q-pa-md">
        <q-item-section side
          ><span class="step-number">01</span></q-item-section
        >
        <q-item-section>
          <q-item-label>New wallet shows a pairing request</q-item-label>
          <q-item-label caption>
            The request expires and contains no recovery secret.
          </q-item-label>
        </q-item-section>
      </q-item>
      <q-separator />
      <q-item class="pairing-step q-pa-md">
        <q-item-section side
          ><span class="step-number">02</span></q-item-section
        >
        <q-item-section>
          <q-item-label
            >Existing wallet returns encrypted authority</q-item-label
          >
          <q-item-label caption>
            The new wallet can then restore state and join relay sync.
          </q-item-label>
        </q-item-section>
      </q-item>
    </SettingsSection>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";

export default defineComponent({
  name: "SyncSettingsPage",
  components: { SettingsPageShell, SettingsSection },
});
</script>

<style scoped lang="scss">
.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sl-color-orange-500, #ff5c00);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sync-status__mark {
  width: 8px;
  height: 8px;
  background: currentColor;
}

.sync-heading {
  margin: 16px 0 8px;
  color: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1.25;
}

.sync-copy {
  margin: 0;
  color: #a9a9a9;
  line-height: 1.5;
}

.pairing-step {
  min-height: 80px;
}

.step-number {
  color: var(--sl-color-orange-500, #ff5c00);
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 700;
}
</style>
