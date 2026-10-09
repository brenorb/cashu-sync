<template>
  <WalletStatusPage
    :title="$t('AlreadyRunning.title')"
    :caption="$t('AlreadyRunning.text')"
  >
    <q-btn
      rounded
      color="white"
      text-color="black"
      unelevated
      to="/"
      :label="$t('AlreadyRunning.actions.retry.label')"
    />
  </WalletStatusPage>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import WalletStatusPage from "src/components/WalletStatusPage.vue";

export default defineComponent({
  name: "AlreadyRunning",
  components: { WalletStatusPage },
});
</script>
