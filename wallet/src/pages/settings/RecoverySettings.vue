<template>
  <SettingsPageShell
    title="Recovery & backup"
    caption="Download or restore the complete synchronized-wallet authority."
  >
    <SettingsSection
      title="Encrypted recovery bundle"
      caption="Includes the twelve-word master seed, sync secret, mint, relay, and latest known head."
    >
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <p class="recovery-copy">
          Choose a strong passphrase and store the downloaded file separately
          from this device. The bundle is encrypted before download.
        </p>
        <q-input
          v-model="exportPassphrase"
          data-recovery-field="export-passphrase"
          dark
          outlined
          type="password"
          label="Backup passphrase"
        />
        <q-input
          v-model="exportConfirmation"
          data-recovery-field="export-confirmation"
          dark
          outlined
          type="password"
          label="Confirm passphrase"
        />
        <q-btn
          data-recovery-action="download"
          color="primary"
          no-caps
          unelevated
          :loading="busy"
          label="Download encrypted backup"
          @click="downloadBackup"
        />
      </q-item>
    </SettingsSection>

    <SettingsSection title="Delete this device">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <p class="recovery-copy">
          Remove the local wallet, proofs, history, and authority from this
          device. The encrypted relay snapshot remains available for recovery.
        </p>
        <q-btn
          data-recovery-action="delete"
          outline
          color="negative"
          no-caps
          label="Delete wallet from this device"
          @click="deleteWallet"
        />
      </q-item>
    </SettingsSection>

    <SettingsSection title="Restore this wallet">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <p class="recovery-copy">
          Restore only on a new or empty wallet. This reconnects to the shared
          relay and restores the latest encrypted snapshot.
        </p>
        <q-file
          v-model="bundleFile"
          data-recovery-field="bundle-file"
          dark
          outlined
          accept="application/json,.json"
          label="Encrypted backup file"
          @update:model-value="readBundleFile"
        />
        <q-input
          v-model="bundleInput"
          data-recovery-field="bundle-input"
          dark
          outlined
          autogrow
          label="Or paste encrypted bundle"
        />
        <q-input
          v-model="importPassphrase"
          data-recovery-field="import-passphrase"
          dark
          outlined
          type="password"
          label="Backup passphrase"
        />
        <q-btn
          data-recovery-action="restore"
          outline
          color="primary"
          no-caps
          :loading="busy"
          label="Restore synchronized wallet"
          @click="restoreBackup"
        />
      </q-item>
    </SettingsSection>

    <div
      v-if="message"
      class="recovery-status"
      :class="{ error: failed }"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </div>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";
import {
  decryptRecoveryBundleV0,
  encryptRecoveryBundleV0,
} from "src/sync/recoveryBundle";
import { useSyncRuntimeService } from "src/sync/syncRuntimeService";
import {
  resetV0WalletService,
  useV0WalletService,
} from "src/sync/v0WalletService";
import { useWalletStore } from "src/stores/wallet";
import { cashuDb, resetCashuDexie } from "src/stores/dexie";

export default defineComponent({
  name: "RecoverySettingsPage",
  components: { SettingsPageShell, SettingsSection },
  data() {
    return {
      exportPassphrase: "",
      exportConfirmation: "",
      importPassphrase: "",
      bundleInput: "",
      bundleFile: null as File | null,
      busy: false,
      failed: false,
      message: "",
    };
  },
  created() {
    // Restore eventually builds the Cashu gateway after asynchronous crypto.
    // Capture vue-i18n while this component still has an active Vue instance.
    useWalletStore();
  },
  methods: {
    async downloadBackup() {
      await this.run(async () => {
        if (this.exportPassphrase !== this.exportConfirmation) {
          throw new Error("backup passphrases do not match");
        }
        const runtime = useSyncRuntimeService();
        const bundle = await encryptRecoveryBundleV0(
          await runtime.exportAuthority(),
          this.exportPassphrase,
          { allowLoopbackHttp: runtime.allowLoopbackHttp }
        );
        const url = URL.createObjectURL(
          new Blob([bundle], { type: "application/json" })
        );
        try {
          const link = document.createElement("a");
          link.href = url;
          link.download = `silent-link-wallet-backup-${new Date()
            .toISOString()
            .slice(0, 10)}.json`;
          link.click();
        } finally {
          URL.revokeObjectURL(url);
        }
        this.message = "Encrypted backup downloaded.";
        this.exportPassphrase = "";
        this.exportConfirmation = "";
      });
    },
    async readBundleFile(file: File | null) {
      if (file) this.bundleInput = await file.text();
    },
    async restoreBackup() {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const authority = await decryptRecoveryBundleV0(
          this.bundleInput,
          this.importPassphrase,
          { allowLoopbackHttp: runtime.allowLoopbackHttp }
        );
        await runtime.replaceEmptyAndStart(authority);
        resetV0WalletService();
        await useV0WalletService().resume();
        this.message = "Wallet restored and synchronized.";
        this.importPassphrase = "";
        this.bundleInput = "";
        this.bundleFile = null;
      });
    },
    async deleteWallet() {
      if (
        !window.confirm(
          "Delete this wallet from this device? The relay backup will remain."
        )
      )
        return;
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        await runtime.runtime.resetSession();
        runtime.authority.clear();
        await resetCashuDexie(cashuDb);
        resetV0WalletService();
        this.message =
          "Wallet deleted from this device. The relay backup remains.";
      });
    },
    async run(operation: () => Promise<void>) {
      this.busy = true;
      this.failed = false;
      this.message = "";
      try {
        await operation();
      } catch (error) {
        this.failed = true;
        this.message =
          error instanceof Error ? error.message : "Recovery failed";
      } finally {
        this.busy = false;
      }
    },
  },
});
</script>

<style scoped lang="scss">
.recovery-status {
  margin: 20px 4px;
  border-left: 3px solid var(--sl-color-orange-500, #ff5c00);
  padding: 10px 12px;
  color: #b9b9b9;
  font-size: 0.85rem;
}

.recovery-status.error {
  border-color: #ff8068;
  color: #ff8068;
}

.recovery-copy {
  margin: 0;
  color: #a9a9a9;
  line-height: 1.5;
}
</style>
