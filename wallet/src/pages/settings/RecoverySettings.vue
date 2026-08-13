<template>
  <SettingsPageShell
    title="Recovery & backup"
    caption="Restore this wallet from an encrypted backup."
  >
    <div class="recovery-status" role="status" aria-live="polite">
      Recovery tools are not connected yet.
    </div>

    <SettingsSection
      title="Encrypted recovery bundle"
      caption="Protects the recovery phrase, sync secret, mint, relay, and latest known state with a passphrase."
    >
      <q-item class="column items-stretch q-pa-lg">
        <p class="recovery-copy">
          Save the bundle somewhere separate from this phone. The file is
          encrypted before it leaves the wallet.
        </p>
        <q-btn
          class="full-width q-mt-sm"
          color="primary"
          no-caps
          unelevated
          disable
          aria-label="Create encrypted backup; coming soon"
          label="Create encrypted backup"
        />
      </q-item>
    </SettingsSection>

    <SettingsSection title="Restore this wallet">
      <q-item class="column items-stretch q-pa-lg">
        <p class="recovery-copy">
          Restore from an encrypted recovery bundle after replacing or losing
          every paired device.
        </p>
        <q-btn
          class="full-width q-mt-sm"
          outline
          color="primary"
          no-caps
          disable
          aria-label="Choose recovery bundle; coming soon"
          label="Choose recovery bundle"
        />
      </q-item>
    </SettingsSection>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";

export default defineComponent({
  name: "RecoverySettingsPage",
  components: { SettingsPageShell, SettingsSection },
});
</script>

<style scoped lang="scss">
.recovery-status {
  margin: 0 4px 20px;
  border-left: 3px solid var(--sl-color-orange-500, #ff5c00);
  padding: 10px 12px;
  color: #b9b9b9;
  font-size: 0.85rem;
}

.recovery-copy {
  margin: 0;
  color: #a9a9a9;
  line-height: 1.5;
}
</style>
