<template>
  <q-header class="silent-link-header">
    <q-toolbar>
      <q-btn
        flat
        dense
        round
        icon="menu"
        color="dark"
        aria-label="Settings"
        @click="goToSettings"
        :disable="uiStore.globalMutexLock"
      />
      <q-toolbar-title class="silent-link-title">
        <img :src="silentLinkLogo" alt="Silent Link" class="silent-link-logo" />
      </q-toolbar-title>
      <q-badge v-if="g.offline" color="red" text-color="black" class="q-mr-sm">
        <span>{{ $t("MainHeader.offline.warning.text") }}</span>
      </q-badge>
      <q-badge
        v-if="isStaging()"
        color="yellow"
        text-color="black"
        class="q-mr-sm"
      >
        <span>{{ $t("MainHeader.staging.warning.text") }}</span>
      </q-badge>
      <!-- <q-badge color="yellow" text-color="black" class="q-mr-sm">
        <span v-if="!isStaging()">Beta</span>
        <span v-else>Staging – don't use with real funds!</span>
      </q-badge> -->
      <q-badge
        v-if="countdown > 0"
        color="negative"
        text-color="white"
        class="q-mr-sm"
        @click="reload"
      >
        {{ $t("MainHeader.reload.warning.text", { countdown }) }}
        <q-spinner
          v-if="countdown > 0"
          size="0.8em"
          :thickness="10"
          class="q-ml-sm"
          color="white"
        />
      </q-badge>
      <q-btn
        flat
        dense
        round
        size="0.8em"
        :icon="countdown > 0 ? 'close' : 'refresh'"
        :color="countdown > 0 ? 'negative' : 'dark'"
        aria-label="Refresh"
        @click="reload"
        :disable="uiStore.globalMutexLock && countdown === 0"
      >
      </q-btn>
    </q-toolbar>
  </q-header>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useRouter } from "vue-router";
import { useUiStore } from "src/stores/ui";
import silentLinkLogo from "src/assets/silent-link-logo.svg";

export default defineComponent({
  name: "MainHeader",
  mixins: [windowMixin],
  setup() {
    const uiStore = useUiStore();
    const router = useRouter();
    const countdown = ref(0);
    let countdownInterval;

    const goToSettings = () => {
      router.push("/settings");
    };

    const isStaging = () => {
      return location.host.includes("staging");
    };

    const reload = () => {
      if (countdown.value > 0) {
        uiStore.unlockMutex();
        clearInterval(countdownInterval);
        countdown.value = 0;
        return;
      }
      if (uiStore.globalMutexLock) return;
      uiStore.lockMutex();
      countdown.value = 3;
      countdownInterval = setInterval(() => {
        countdown.value--;
        if (countdown.value === 0) {
          clearInterval(countdownInterval);
          uiStore.unlockMutex();
          location.reload();
        }
      }, 1000);
    };

    return {
      goToSettings,
      isStaging,
      reload,
      countdown,
      uiStore,
      silentLinkLogo,
    };
  },
});
</script>
<style scoped>
.q-header {
  position: relative;
  z-index: auto;
  overflow-x: hidden;
  background: var(--sl-surface-muted);
  color: var(--sl-ink);
  border-bottom: 1px solid var(--sl-outline);
}

.q-toolbar {
  flex-wrap: nowrap;
  min-height: 60px;
}

.q-toolbar-title {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: 12px;
}

.silent-link-logo {
  display: block;
  width: 104px;
  height: 40px;
  object-fit: contain;
}

/* Make badges container handle overflow properly */
.q-toolbar > .q-badge {
  flex-shrink: 0;
}
</style>
