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
        <div v-if="walletIdWords.length" class="wallet-id" data-wallet-id>
          <span class="wallet-id__label">Wallet ID</span>
          <strong>{{ walletIdWords.join(" ") }}</strong>
          <small
            >Compare these six words on both phones. They are not recovery
            words.</small
          >
        </div>
      </q-item>
    </SettingsSection>

    <SettingsSection v-if="configured" title="Pair another wallet">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-btn
          data-pairing-action="create-auto-pair"
          color="primary"
          no-caps
          unelevated
          label="Pair another phone"
          :loading="busy"
          @click="createAutoPairing"
        />
        <template v-if="autoPairUrl">
          <button
            class="pairing-qr"
            type="button"
            data-auto-pairing-qr
            :data-auto-pairing-url="autoPairUrl"
            aria-label="Enlarge pairing QR code"
            @click="showPairingQr = true"
          >
            <vue-qrcode
              :value="autoPairUrl"
              :options="{ width: 280, errorCorrectionLevel: 'L', margin: 1 }"
            />
          </button>
          <small class="pairing-qr-hint">Tap the QR code to enlarge it</small>
          <p class="sync-copy">
            Scan this once with the other phone. It opens the wallet and pairs
            automatically. The QR expires after three minutes.
          </p>
        </template>
      </q-item>
    </SettingsSection>

    <SettingsSection v-else title="Pair this wallet">
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-btn
          data-pairing-action="scan-auto-pair"
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
            v-if="autoPairUrl"
            :value="autoPairUrl"
            :options="{ width: 960, errorCorrectionLevel: 'L', margin: 1 }"
            aria-label="Enlarged pairing QR code"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <transition name="pairing-success">
      <section
        v-if="pairingSuccess"
        class="pairing-success"
        role="status"
        aria-live="assertive"
        aria-label="Wallets paired successfully"
      >
        <div class="pairing-success__signal" aria-hidden="true">
          <span
            class="pairing-success__ring pairing-success__ring--outer"
          ></span>
          <span
            class="pairing-success__ring pairing-success__ring--inner"
          ></span>
          <span class="pairing-success__check">✓</span>
        </div>
        <p class="pairing-success__eyebrow">PAIRING COMPLETE</p>
        <h2>Wallets paired</h2>
        <p>Both phones now share the same balance.</p>
        <div v-if="walletIdWords.length" class="pairing-success__id">
          <span>Wallet ID</span>
          <strong>{{ walletIdWords.join(" ") }}</strong>
        </div>
      </section>
    </transition>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapState } from "pinia";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";
import type { AuthorityPayloadV0 } from "src/sync/authorityPayload";
import {
  AutoPairingHostSession,
  AutoPairingJoinSession,
  createAutoPairingUrl,
} from "src/sync/automaticPairing";
import { deriveWalletIdWords } from "src/sync/walletIdentity";
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
      autoPairUrl: "",
      showPairingQr: false,
      busy: false,
      failed: false,
      message: "",
      pairingSuccess: false,
      walletIdWords: [] as string[],
      pairingSession: null as
        | AutoPairingHostSession
        | AutoPairingJoinSession
        | null,
      pairingSuccessTimer: null as number | null,
    };
  },
  computed: {
    ...mapState(useCameraStore, ["camera"]),
  },
  created() {
    // Construct the store while Vue still owns the active component instance.
    useWalletStore();
    this.configured = useSyncRuntimeService().authority.load() !== null;
    if (this.configured) void this.loadWalletId();
    const pairing = this.$route.query.pairing;
    if (typeof pairing === "string") void this.finishAutoPairing(pairing);
  },
  methods: {
    async loadWalletId() {
      try {
        const authority = await useSyncRuntimeService().exportAuthority();
        this.walletIdWords = await deriveWalletIdWords(authority.sync_secret);
      } catch {
        this.walletIdWords = [];
      }
    },
    openScanner() {
      useCameraStore().showCamera();
    },
    decodePairing(value: string) {
      useCameraStore().closeCamera();
      void this.finishAutoPairing(value.trim());
    },
    async createAutoPairing() {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const relayUrl = process.env.CASHU_SYNC_PAIRING_RELAY_URL;
        if (!relayUrl) throw new Error("pairing relay is not configured");
        this.stopPairingSession();
        const session = AutoPairingHostSession.create({
          relayUrl,
          hooks: { allowLoopbackHttp: runtime.allowLoopbackHttp },
        });
        this.pairingSession = session;
        this.autoPairUrl = createAutoPairingUrl(session.qr);
        session.start(
          await runtime.exportAuthority(),
          () => {
            this.stopPairingSession();
            this.message = "Wallet pareada e sincronizada.";
            this.showPairingSuccess();
          },
          (error) => {
            this.failed = true;
            this.message = error.message;
            this.stopPairingSession();
          }
        );
        this.message =
          "Scan this QR with the other phone. Pairing finishes automatically.";
      });
    },
    async finishAutoPairing(payload: string) {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const session = AutoPairingJoinSession.fromQr(payload, {
          hooks: { allowLoopbackHttp: runtime.allowLoopbackHttp },
        });
        this.stopPairingSession();
        this.pairingSession = session;
        this.message = "Pairing this wallet automatically…";
        await session.start(
          async (authority) => {
            await this.applyPairing(authority);
          },
          (error) => {
            this.failed = true;
            this.message = error.message;
          }
        );
      });
    },
    async applyPairing(authority: AuthorityPayloadV0) {
      const runtime = useSyncRuntimeService();
      await runtime.replaceEmptyAndStart(authority);
      resetV0WalletService();
      const result = await useV0WalletService().resume();
      if (result.status !== "idle" && result.status !== "completed") {
        throw new Error(`Pairing requires recovery: ${result.status}`);
      }
      const session = runtime.runtime.currentSession();
      if (session === null) throw new Error("wallet sync did not start");
      const acknowledgement = await session.sync.publishCurrent();
      if (acknowledgement.status !== "accepted") {
        throw new Error("pairing confirmation could not be synchronized");
      }
      this.configured = true;
      await this.loadWalletId();
      this.message = "Wallet pareada e sincronizada.";
      this.showPairingSuccess();
      await this.$router.replace({ path: "/settings/sync" });
    },
    showPairingSuccess() {
      if (this.walletIdWords.length === 0) void this.loadWalletId();
      if (this.pairingSuccessTimer !== null) {
        window.clearTimeout(this.pairingSuccessTimer);
      }
      this.pairingSuccess = true;
      this.pairingSuccessTimer = window.setTimeout(() => {
        this.pairingSuccess = false;
        this.pairingSuccessTimer = null;
        if (this.$route.path === "/settings/sync") {
          void this.$router.replace("/wallet");
        }
      }, 2800);
    },
    stopPairingSession() {
      this.pairingSession?.destroy();
      this.pairingSession = null;
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
  beforeUnmount() {
    this.stopPairingSession();
    if (this.pairingSuccessTimer !== null) {
      window.clearTimeout(this.pairingSuccessTimer);
    }
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

.wallet-id {
  display: grid;
  gap: 6px;
  border-left: 3px solid var(--sl-color-orange-500, #ff5c00);
  padding: 10px 12px;
  background: rgba(255, 157, 32, 0.06);
}

.wallet-id__label,
.pairing-success__id > span {
  color: #ff9d20;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.wallet-id strong,
.pairing-success__id strong {
  color: #fff;
  font-size: 1rem;
  letter-spacing: 0.04em;
  overflow-wrap: anywhere;
}

.wallet-id small {
  color: #a9a9a9;
  line-height: 1.4;
}

.overwrite-dialog {
  width: min(92vw, 500px);
  overflow: hidden;
  border: 1px solid #4a321d;
  border-radius: 16px;
  background: #171717;
  color: #fff;
}

.overwrite-dialog h2 {
  margin: 0 0 10px;
  font-size: 1.55rem;
  letter-spacing: -0.02em;
}

.overwrite-dialog__backup {
  display: grid;
  gap: 12px;
  border-top: 1px solid #2d2d2d;
}

.overwrite-dialog :deep(.q-card__actions) {
  gap: 8px;
  border-top: 1px solid #2d2d2d;
  padding: 14px 24px 20px;
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

.pairing-success {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 32px;
  color: #fff;
  text-align: center;
  background: radial-gradient(
      circle at 50% 42%,
      rgba(255, 146, 0, 0.18),
      transparent 32%
    ),
    rgba(9, 9, 9, 0.97);
}

.pairing-success__signal {
  position: relative;
  width: 132px;
  height: 132px;
  margin-bottom: 16px;
}

.pairing-success__ring,
.pairing-success__check {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
}

.pairing-success__ring {
  border: 1px solid rgba(255, 157, 32, 0.7);
  border-radius: 50%;
  animation: pairing-pulse 2.2s ease-out both;
}

.pairing-success__ring--outer {
  width: 132px;
  height: 132px;
}

.pairing-success__ring--inner {
  width: 92px;
  height: 92px;
  border-color: rgba(255, 255, 255, 0.35);
  animation-delay: 120ms;
}

.pairing-success__check {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  color: #090909;
  font-size: 2rem;
  font-weight: 700;
  background: #ff9d20;
  border-radius: 50%;
  box-shadow: 0 0 0 8px rgba(255, 157, 32, 0.12);
  animation: pairing-check 500ms 260ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.pairing-success__eyebrow {
  margin: 0;
  color: #ff9d20;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.pairing-success h2 {
  margin: 0;
  font-size: clamp(2rem, 9vw, 3rem);
  line-height: 1;
}

.pairing-success > p:last-child {
  margin: 0;
  color: #b5b5b5;
}

.pairing-success__id {
  display: grid;
  gap: 6px;
  max-width: 32rem;
  margin-top: 8px;
  padding: 12px 16px;
  border: 1px solid rgba(255, 157, 32, 0.45);
  background: rgba(255, 157, 32, 0.08);
}

.pairing-success-enter-active,
.pairing-success-leave-active {
  transition: opacity 240ms ease;
}

.pairing-success-enter,
.pairing-success-leave-to {
  opacity: 0;
}

@keyframes pairing-pulse {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.56);
  }
  28% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes pairing-check {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.3) rotate(-12deg);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pairing-success__ring,
  .pairing-success__check {
    animation: none;
  }
}
</style>
