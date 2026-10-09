<template>
  <WalletStatusPage
    :code="$t('ErrorNotFound.title')"
    :title="$t('ErrorNotFound.text')"
  >
    <q-btn
      rounded
      size="lg"
      color="white"
      text-color="black"
      unelevated
      to="/"
      :label="$t('ErrorNotFound.actions.home.label')"
    />
  </WalletStatusPage>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import WalletStatusPage from "src/components/WalletStatusPage.vue";

export default defineComponent({
  name: "ErrorNotFound",
  components: { WalletStatusPage },
});
</script>
