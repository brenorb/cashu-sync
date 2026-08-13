<template>
  <SettingsPageShell
    title="Sync devices"
    caption="Keep every wallet you control aligned through your relay."
  >
    <SettingsSection title="Pairing status">
      <q-item class="column items-stretch q-pa-lg">
        <div class="sync-status" role="status" aria-live="polite">
          <span class="sync-status__mark" aria-hidden="true"></span>
          {{ configured ? "Sync authority configured" : "Not paired" }}
        </div>
        <h2 class="sync-heading">
          {{
            configured
              ? "This wallet can pair another device"
              : "Join an existing wallet"
          }}
        </h2>
        <p class="sync-copy">
          Pair another wallet you control by exchanging two QR codes. The
          request contains no secret; the response is encrypted for that one
          request and expires after five minutes.
        </p>
      </q-item>
    </SettingsSection>

    <SettingsSection
      title="New device"
      caption="Do these steps on the wallet that should join."
    >
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-btn
          data-pairing-action="create-request"
          color="primary"
          no-caps
          unelevated
          label="Create pairing request"
          @click="createRequest"
        />
        <template v-if="pairingRequest">
          <div class="pairing-qr" aria-label="Pairing request QR code">
            <vue-qrcode :value="pairingRequest" :options="{ width: 220 }" />
          </div>
          <q-input
            :model-value="pairingRequest"
            data-pairing-field="request-output"
            dark
            outlined
            readonly
            autogrow
            label="Pairing request"
          />
          <q-input
            v-model="pairingResponseInput"
            data-pairing-field="response-input"
            dark
            outlined
            autogrow
            label="Encrypted response from existing wallet"
          />
          <q-btn
            data-pairing-action="finish"
            color="primary"
            no-caps
            outline
            :loading="busy"
            label="Finish pairing"
            @click="finishPairing"
          />
        </template>
      </q-item>
    </SettingsSection>

    <SettingsSection
      v-if="configured"
      title="Existing device"
      caption="Scan or paste the new device request here."
    >
      <q-item class="column items-stretch q-pa-lg q-gutter-md">
        <q-input
          v-model="pairingRequestInput"
          data-pairing-field="request-input"
          dark
          outlined
          autogrow
          label="Pairing request from new wallet"
        />
        <q-btn
          data-pairing-action="create-response"
          color="primary"
          no-caps
          unelevated
          :loading="busy"
          label="Create encrypted response"
          @click="createResponse"
        />
        <template v-if="pairingResponse">
          <div
            class="pairing-qr"
            aria-label="Encrypted pairing response QR code"
          >
            <vue-qrcode :value="pairingResponse" :options="{ width: 220 }" />
          </div>
          <q-input
            :model-value="pairingResponse"
            data-pairing-field="response-output"
            dark
            outlined
            readonly
            autogrow
            label="Encrypted pairing response"
          />
        </template>
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
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SettingsPageShell from "./SettingsPageShell.vue";
import SettingsSection from "./SettingsSection.vue";
import {
  PairingSessionV0,
  createPairingResponseV0,
} from "src/sync/pairingCrypto";
import { useSyncRuntimeService } from "src/sync/syncRuntimeService";
import {
  resetV0WalletService,
  useV0WalletService,
} from "src/sync/v0WalletService";
import { useWalletStore } from "src/stores/wallet";

export default defineComponent({
  name: "SyncSettingsPage",
  components: { SettingsPageShell, SettingsSection },
  data() {
    return {
      configured: false,
      session: null as PairingSessionV0 | null,
      pairingRequest: "",
      pairingRequestInput: "",
      pairingResponse: "",
      pairingResponseInput: "",
      busy: false,
      failed: false,
      message: "",
    };
  },
  created() {
    // The wallet store captures vue-i18n during construction. Create it while
    // this page still owns the active Vue instance, before pairing awaits.
    useWalletStore();
    this.configured = useSyncRuntimeService().authority.load() !== null;
  },
  beforeUnmount() {
    this.session?.destroy();
  },
  methods: {
    createRequest() {
      this.session?.destroy();
      const runtime = useSyncRuntimeService();
      this.session = PairingSessionV0.create({
        allowLoopbackHttp: runtime.allowLoopbackHttp,
      });
      this.pairingRequest = this.session.requestQrPayload();
      this.pairingResponseInput = "";
      this.message = "Pairing request ready. Show it to an existing wallet.";
      this.failed = false;
    },
    async createResponse() {
      await this.run(async () => {
        const runtime = useSyncRuntimeService();
        const authority = await runtime.exportAuthority();
        this.pairingResponse = createPairingResponseV0(
          this.pairingRequestInput,
          authority,
          { allowLoopbackHttp: runtime.allowLoopbackHttp }
        );
        this.message = "Encrypted response ready. Return it to the new wallet.";
      });
    },
    async finishPairing() {
      await this.run(async () => {
        if (!this.session) throw new Error("create a pairing request first");
        const authority = this.session.consumeResponse(
          this.pairingResponseInput
        );
        await useSyncRuntimeService().replaceEmptyAndStart(authority);
        resetV0WalletService();
        await useV0WalletService().resume();
        this.configured = true;
        this.message = "Paired. This wallet now follows the shared relay head.";
        this.pairingRequest = "";
        this.pairingResponseInput = "";
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

.pairing-qr {
  align-self: center;
  overflow: hidden;
  padding: 8px;
  background: #fff;
  line-height: 0;
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
