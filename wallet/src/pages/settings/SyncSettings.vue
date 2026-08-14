<template>
  <SettingsPageShell
    title="Sync devices"
    caption="Keep every wallet you control aligned."
  >
    <SettingsSection title="Pairing status">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <div class="sync-status" role="status" aria-live="polite">
          <span class="sync-status__mark" aria-hidden="true"></span>
          {{ configured ? "Sync ready" : "Not paired" }}
        </div>
        <p class="sync-copy">
          {{
            configured
              ? "Create one QR code for another wallet you control."
              : "Scan the QR code from a wallet you already use."
          }}
        </p>
      </q-item>
    </SettingsSection>

    <SettingsSection v-if="configured" title="Pair another wallet">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-btn
          data-pairing-action="create-quick-pair"
          color="primary"
          no-caps
          unelevated
          label="Create pairing QR"
          :loading="busy"
          @click="createQuickPair"
        />
        <template v-if="quickPairUrl">
          <button
            class="pairing-qr"
            type="button"
            aria-label="Enlarge pairing QR code"
            @click="showPairingQr = true"
          >
            <vue-qrcode
              :value="quickPairUrl"
              :options="{ width: 280, errorCorrectionLevel: 'L', margin: 1 }"
            />
          </button>
          <small class="pairing-qr-hint">Tap the QR code to enlarge it</small>
          <p class="sync-copy">
            Scan this once with the other phone. It opens the wallet and imports
            the same balance. The QR expires after ten minutes.
          </p>
        </template>
      </q-item>
    </SettingsSection>

    <SettingsSection v-else title="Pair this wallet">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-btn
          data-pairing-action="scan-quick-pair"
          color="primary"
          no-caps
          unelevated
          label="Scan pairing QR"
          @click="openScanner"
        />
        <p class="sync-copy">
          Point the camera at the QR shown by your existing wallet. Pairing
          finishes automatically.
        </p>
      </q-item>
    </SettingsSection>

    <p
      v-if="message"
      class="pairing-message"
      :class="{ error: failed }"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
    <q-btn
      data-pairing-action="back-wallet"
      flat
      no-caps
      label="Back to wallet"
      @click="$router.replace('/wallet')"
    />
    <q-dialog v-model="camera.show" backdrop-filter="blur(2px) brightness(60%)">
      <QrcodeReader @decode="decodePairing" />
    </q-dialog>
    <q-dialog v-model="showPairingQr">
      <q-card class="pairing-qr-dialog">
        <q-card-section class="pairing-qr-large">
          <vue-qrcode
            v-if="quickPairUrl"
            :value="quickPairUrl"
            :options="{ width: 960, errorCorrectionLevel: 'L', margin: 1 }"
            aria-label="Enlarged pairing QR code"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapState } from "pinia";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";
import { consumeQuickPairV0, createQuickPairV0 } from "src/sync/quickPair";
import { useSyncRuntimeService } from "src/sync/syncRuntimeService";
import {
  resetV0WalletService,
  useV0WalletService,
} from "src/sync/v0WalletService";
import { useWalletStore } from "src/stores/wallet";
import { useCameraStore } from "src/stores/camera";
import QrcodeReader from "src/components/QrcodeReader.vue";
import VueQrcode from "@chenfengyuan/vue-qrcode";

export default defineComponent({
  name: "SyncSettingsPage",
  components: {
    SettingsPageShell,
    SettingsSection,
    QrcodeReader,
    VueQrcode,
  },
  data() {
    return {
      configured: false,
      quickPairPayload: "",
      showPairingQr: false,
      busy: false,
      failed: false,
      message: "",
    };
  },
  computed: {
    ...mapState(useCameraStore, ["camera"]),
    quickPairUrl(): string {
      if (!this.quickPairPayload) return "";
      return new URL(
        this.$router.resolve({
          path: "/settings/sync",
          query: { quick_pair: this.quickPairPayload },
        }).href,
        window.location.href
      ).href;
    },
  },
  created() {
    // Construct the store while Vue still owns the active component instance.
    useWalletStore();
    this.configured = useSyncRuntimeService().authority.load() !== null;
    const quickPair = this.$route.query.quick_pair;
    if (typeof quickPair === "string") void this.finishQuickPair(quickPair);
    if (this.$route.query.auto === "1" && typeof quickPair !== "string") {
      this.failed = true;
      this.message =
        "This pairing QR is outdated. Create a new pairing QR from the existing wallet.";
    }
  },
  methods: {
    openScanner() {
      useCameraStore().showCamera();
    },
    decodePairing(value: string) {
      useCameraStore().closeCamera();
      const trimmed = value.trim();
      try {
        const url = new URL(trimmed, window.location.href);
        const hashQuery = url.hash.includes("?")
          ? url.hash.slice(url.hash.indexOf("?") + 1)
          : "";
        const payload =
          new URLSearchParams(hashQuery).get("quick_pair") ||
          url.searchParams.get("quick_pair");
        void this.finishQuickPair(payload || trimmed);
      } catch {
        void this.finishQuickPair(trimmed);
      }
    },
    async createQuickPair() {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        this.quickPairPayload = await createQuickPairV0(
          await runtime.exportAuthority(),
          { allowLoopbackHttp: runtime.allowLoopbackHttp }
        );
        this.message = "Pairing QR ready. It expires after ten minutes.";
      });
    },
    async finishQuickPair(payload: string) {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const authority = await consumeQuickPairV0(payload, {
          allowLoopbackHttp: runtime.allowLoopbackHttp,
        });
        await runtime.replaceEmptyAndStart(authority);
        resetV0WalletService();
        await useV0WalletService().resume();
        this.configured = true;
        this.message = "Paired. This wallet is synchronized.";
        await this.$router.replace({ path: "/settings/sync" });
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
          error instanceof Error ? error.message : "Pairing failed";
      } finally {
        this.busy = false;
      }
    },
  },
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

.sync-copy {
  width: 100%;
  max-width: 100%;
  margin: 0;
  color: #a9a9a9;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.pairing-qr {
  display: block;
  align-self: center;
  width: min(100%, 280px);
  max-width: 100%;
  overflow: hidden;
  padding: 8px;
  background: #fff;
  border: 0;
  cursor: zoom-in;
  line-height: 0;
}

.pairing-qr :deep(canvas) {
  display: block;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
}

.pairing-qr-hint {
  align-self: center;
  color: #a9a9a9;
}

.pairing-qr-dialog {
  max-width: calc(100vw - 24px);
  background: #fff;
}

.pairing-qr-large {
  max-width: calc(100vw - 24px);
  padding: 12px;
  line-height: 0;
}

.pairing-qr-large :deep(canvas) {
  display: block;
  width: min(calc(100vw - 56px), 960px) !important;
  max-width: 100% !important;
  height: auto !important;
}

.pairing-message {
  margin: 20px 4px;
  border-left: 3px solid var(--sl-color-orange-500, #ff5c00);
  padding: 10px 12px;
  color: #b9b9b9;
}

.pairing-message.error {
  border-color: #ff8068;
  color: #ff8068;
}
</style>
