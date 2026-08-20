<template>
  <SettingsPageShell
    :title="
      incomingPairing
        ? 'Pairing wallet'
        : creatingPairingScreen
        ? 'Create pairing QR'
        : 'Sync devices'
    "
    :caption="
      incomingPairing
        ? 'Connecting this wallet securely.'
        : creatingPairingScreen
        ? 'Create a one-time QR for another wallet.'
        : 'Keep every wallet you control aligned.'
    "
  >
    <section
      v-if="incomingPairing"
      class="pairing-incoming q-pa-xl"
      role="status"
      aria-live="polite"
    >
      <q-spinner-dots v-if="busy" color="primary" size="3rem" />
      <div v-else class="pairing-incoming__mark" aria-hidden="true">!</div>
      <p class="v0-eyebrow">
        {{ busy ? "PAIRING WALLET" : "PAIRING STOPPED" }}
      </p>
      <h2>{{ busy ? "Connecting this wallet" : "Pairing needs attention" }}</h2>
      <p class="sync-copy">
        {{
          busy
            ? "Importing the shared wallet and synchronizing its balance."
            : "The wallet was not changed. Return to the wallet and try again with a new QR."
        }}
      </p>
      <q-btn
        v-if="!busy"
        data-pairing-action="back-wallet"
        flat
        no-caps
        label="Back to wallet"
        @click="$router.replace('/wallet')"
      />
    </section>

    <template v-else>
      <SettingsSection title="Pairing status">
        <q-item class="column items-stretch q-pa-lg settings-card-content">
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

      <SettingsSection
        v-if="configured && !creatingPairingScreen"
        title="Pair another wallet"
      >
        <q-item class="column items-stretch q-pa-lg settings-card-content">
          <q-btn
            data-pairing-action="open-pairing-screen"
            color="primary"
            no-caps
            unelevated
            label="Open pairing screen"
            @click="$router.push('/settings/sync/pairing')"
          />
          <p class="sync-copy">
            Open a separate screen before generating a one-time pairing QR.
          </p>
        </q-item>
      </SettingsSection>

      <SettingsSection v-else-if="configured" title="Create pairing QR">
        <q-item class="column items-stretch q-pa-lg settings-card-content">
          <p class="sync-copy">
            Generate the QR only when the other phone is ready to scan it. It
            expires after three minutes and can be used once.
          </p>
          <q-btn
            data-pairing-action="create-pairing"
            color="primary"
            no-caps
            unelevated
            label="Generate one-time QR"
            :loading="busy"
            @click="createPairing"
          />
          <template v-if="pairingUrl">
            <button
              class="pairing-qr"
              type="button"
              aria-label="Enlarge pairing QR code"
              :data-pairing-url="pairingUrl"
              @click="showPairingQr = true"
            >
              <vue-qrcode
                :value="pairingUrl"
                :options="{ width: 280, errorCorrectionLevel: 'L', margin: 1 }"
              />
            </button>
            <small class="pairing-qr-hint">Tap the QR code to enlarge it</small>
            <p class="sync-copy">
              Scan this once with the other phone. The QR contains only a
              short-lived pairing session; the wallet authority is sent directly
              through the encrypted relay.
            </p>
          </template>
          <q-btn
            data-pairing-action="back-sync"
            flat
            no-caps
            label="Back to sync devices"
            @click="$router.replace('/settings/sync')"
          />
        </q-item>
      </SettingsSection>

      <SettingsSection v-else title="Pair this wallet">
        <q-item class="column items-stretch q-pa-lg settings-card-content">
          <q-btn
            data-pairing-action="scan-pairing"
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

      <q-btn
        data-pairing-action="back-wallet"
        flat
        no-caps
        :label="
          creatingPairingScreen ? 'Back to sync devices' : 'Back to wallet'
        "
        @click="
          $router.replace(creatingPairingScreen ? '/settings/sync' : '/wallet')
        "
      />
    </template>

    <p
      v-if="message"
      class="pairing-message"
      :class="{ error: failed }"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
    <q-dialog v-model="camera.show" backdrop-filter="blur(2px) brightness(60%)">
      <QrcodeReader @decode="decodePairing" />
    </q-dialog>
    <q-dialog v-model="showPairingQr">
      <q-card class="pairing-qr-dialog">
        <q-card-section class="pairing-qr-large">
          <vue-qrcode
            v-if="pairingUrl"
            :value="pairingUrl"
            :options="{ width: 960, errorCorrectionLevel: 'L', margin: 1 }"
            aria-label="Enlarged pairing QR code"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="showOverwriteDialog" persistent>
      <q-card class="overwrite-dialog">
        <q-card-section>
          <p class="v0-eyebrow">WALLET FOUND</p>
          <h2>Replace this wallet?</h2>
          <p class="sync-copy">
            This phone already has local wallet data. Pairing will replace it
            with the wallet from the other phone.
          </p>
        </q-card-section>
        <q-card-section class="overwrite-dialog__backup">
          <q-input
            v-model="backupPassphrase"
            data-pairing-field="backup-passphrase"
            dark
            outlined
            type="password"
            label="Backup passphrase"
            hint="Optional: save an encrypted copy before replacing"
          />
          <q-input
            v-if="backupPassphrase"
            v-model="backupConfirmation"
            data-pairing-field="backup-confirmation"
            dark
            outlined
            type="password"
            label="Confirm passphrase"
          />
          <q-btn
            data-pairing-action="save-local-backup"
            outline
            color="primary"
            no-caps
            :loading="backupBusy"
            label="Save encrypted backup"
            @click="saveLocalBackup"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            data-pairing-action="cancel-overwrite"
            flat
            no-caps
            label="Cancel"
            @click="cancelOverwrite"
          />
          <q-btn
            data-pairing-action="overwrite-and-pair"
            color="primary"
            no-caps
            unelevated
            :loading="busy"
            label="Replace and pair"
            @click="overwriteExistingWallet"
          />
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
import {
  AutoPairingHostSession,
  AutoPairingJoinSession,
  createAutoPairingUrl,
} from "src/sync/automaticPairing";
import { encryptRecoveryBundleV0 } from "src/sync/recoveryBundle";
import type { AuthorityPayloadV0 } from "src/sync/authorityPayload";
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
      incomingPairing: false,
      pairingPayload: "",
      showPairingQr: false,
      showOverwriteDialog: false,
      busy: false,
      backupBusy: false,
      backupPassphrase: "",
      backupConfirmation: "",
      pendingPairAuthority: null as AuthorityPayloadV0 | null,
      failed: false,
      message: "",
      pairingSuccess: false,
      walletIdWords: [] as string[],
      pairingWatchStop: null as (() => void) | null,
      pairingHost: null as AutoPairingHostSession | null,
      pairingJoin: null as AutoPairingJoinSession | null,
      pairingSuccessTimer: null as number | null,
    };
  },
  computed: {
    ...mapState(useCameraStore, ["camera"]),
    pairingUrl(): string {
      if (!this.pairingPayload) return "";
      return createAutoPairingUrl(
        JSON.parse(this.pairingPayload),
        window.location.href
      );
    },
    creatingPairingScreen(): boolean {
      return this.$route.path === "/settings/sync/pairing";
    },
  },
  created() {
    // Construct the store while Vue still owns the active component instance.
    useWalletStore();
    this.configured = useSyncRuntimeService().authority.load() !== null;
    if (this.configured) void this.loadWalletId();
    const pairing = this.$route.query.pairing;
    if (typeof pairing === "string") {
      this.incomingPairing = true;
      void this.finishPairing(pairing);
    }
    if (this.$route.query.auto === "1" && typeof pairing !== "string") {
      this.failed = true;
      this.message =
        "This pairing QR is outdated. Create a new pairing QR from the existing wallet.";
    }
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
      const trimmed = value.trim();
      try {
        const url = new URL(trimmed, window.location.href);
        const hashQuery = url.hash.includes("?")
          ? url.hash.slice(url.hash.indexOf("?") + 1)
          : "";
        const payload =
          new URLSearchParams(hashQuery).get("pairing") ||
          url.searchParams.get("pairing");
        void this.finishPairing(payload || trimmed);
      } catch {
        void this.finishPairing(trimmed);
      }
    },
    async createPairing() {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const session = runtime.runtime.currentSession();
        this.stopPairingWatcher();
        this.pairingHost?.destroy();
        this.pairingHost = AutoPairingHostSession.create({
          relayUrl: process.env.CASHU_SYNC_PAIRING_RELAY_URL,
          hooks: { allowLoopbackHttp: runtime.allowLoopbackHttp },
        });
        this.pairingPayload = JSON.stringify(this.pairingHost.qr);
        this.pairingHost.start(
          await runtime.exportAuthority(),
          () => {
            this.pairingHost?.destroy();
            this.pairingHost = null;
            this.showPairingQr = false;
            this.showPairingSuccess();
          },
          (error) => {
            this.pairingHost?.destroy();
            this.pairingHost = null;
            this.failed = true;
            this.message = error.message;
          }
        );
        if (session !== null) {
          const baseline = await session.repository.exportSnapshot();
          this.pairingWatchStop = session.sync.watchCurrent((event) => {
            if (event.id === baseline.previous_event_id) return;
            this.stopPairingWatcher();
            void useV0WalletService()
              .syncNow()
              .then(() => this.showPairingSuccess())
              .catch(() => undefined);
          });
        }
        this.message = "Pairing QR ready. It expires after three minutes.";
      });
    },
    async finishPairing(payload: string) {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        this.pairingJoin?.destroy();
        this.pairingJoin = AutoPairingJoinSession.fromQr(payload, {
          hooks: { allowLoopbackHttp: runtime.allowLoopbackHttp },
        });
        await new Promise<void>((resolve, reject) => {
          void this.pairingJoin!.start(
            async (authority) => {
              try {
                this.pendingPairAuthority = authority;
                await this.applyPairing(authority);
                resolve();
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message ===
                    "pairing or recovery requires an empty local wallet"
                ) {
                  this.showOverwriteDialog = true;
                  this.message =
                    "This phone already has a wallet. Choose whether to save it or replace it.";
                  resolve();
                  return;
                }
                reject(error);
              }
            },
            (error) => reject(error)
          );
        });
      });
    },
    async applyPairing(authority: AuthorityPayloadV0, overwrite = false) {
      const runtime = useSyncRuntimeService();
      await runtime.replaceEmptyAndStart(authority, { overwrite });
      resetV0WalletService();
      let recoveryPending = false;
      try {
        const result = await useV0WalletService().resume();
        recoveryPending = result.status === "needs-reconciliation";
      } catch {
        recoveryPending = true;
      }
      const session = runtime.runtime.currentSession();
      if (session === null) throw new Error("wallet sync did not start");
      try {
        await session.sync.publishCurrent();
      } catch {
        // Pairing already imported the authenticated remote snapshot.
      }
      this.configured = true;
      this.incomingPairing = false;
      await this.loadWalletId();
      this.message = recoveryPending
        ? "Paired. Recovery will continue automatically."
        : "Paired. This wallet is synchronized.";
      this.showPairingSuccess();
      await this.$router.replace({ path: "/settings/sync" });
    },
    cancelOverwrite() {
      this.showOverwriteDialog = false;
      this.pendingPairAuthority = null;
      this.incomingPairing = false;
      this.backupPassphrase = "";
      this.backupConfirmation = "";
      this.message = "Pairing cancelled. This wallet was not changed.";
    },
    async saveLocalBackup() {
      this.backupBusy = true;
      this.failed = false;
      try {
        if (this.backupPassphrase !== this.backupConfirmation) {
          throw new Error("backup passphrases do not match");
        }
        const runtime = useSyncRuntimeService();
        const bundle = await encryptRecoveryBundleV0(
          await runtime.exportAuthority(),
          this.backupPassphrase,
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
        this.message =
          "Encrypted backup downloaded. You can now replace this wallet.";
        this.backupPassphrase = "";
        this.backupConfirmation = "";
      } catch (error) {
        this.failed = true;
        this.message = error instanceof Error ? error.message : "Backup failed";
      } finally {
        this.backupBusy = false;
      }
    },
    async overwriteExistingWallet() {
      const authority = this.pendingPairAuthority;
      if (authority === null) return;
      await this.run(async () => {
        await this.applyPairing(authority, true);
        this.showOverwriteDialog = false;
        this.pendingPairAuthority = null;
      });
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
    stopPairingWatcher() {
      this.pairingWatchStop?.();
      this.pairingWatchStop = null;
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
    this.stopPairingWatcher();
    this.pairingHost?.destroy();
    this.pairingJoin?.destroy();
    if (this.pairingSuccessTimer !== null) {
      window.clearTimeout(this.pairingSuccessTimer);
    }
  },
});
</script>

<style scoped lang="scss">
.pairing-incoming {
  display: grid;
  justify-items: center;
  gap: 1rem;
  min-height: 18rem;
  text-align: center;
  align-content: center;
}

.pairing-incoming__mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border: 2px solid currentColor;
  border-radius: 50%;
  color: var(--sl-color-orange-500, #ff5c00);
  font-size: 1.5rem;
  font-weight: 700;
}

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
