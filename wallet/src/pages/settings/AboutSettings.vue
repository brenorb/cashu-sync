<template>
  <SettingsPageShell
    title="About Silent Link"
    caption="Wallet, help and contact."
  >
    <section class="about-brand" aria-label="Silent Link Wallet">
      <img :src="silentLinkLogo" alt="Silent Link" />
      <h1>Silent Link Wallet</h1>
      <p>Buy credits, pay for mobile data, and keep your wallets in sync.</p>
    </section>
    <q-list class="settings-menu-group">
      <q-item
        v-for="link in links"
        :key="link.href"
        clickable
        v-ripple
        tag="a"
        target="_blank"
        rel="noopener noreferrer"
        :href="link.href"
        class="settings-menu-item"
      >
        <q-item-section avatar>
          <div class="settings-menu-icon">
            <component :is="link.icon" :size="20" aria-hidden="true" />
          </div>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-weight-medium">{{
            link.title
          }}</q-item-label>
          <q-item-label caption>{{ link.caption }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <ExternalLinkIcon
            :size="18"
            class="settings-menu-chevron"
            aria-hidden="true"
          />
        </q-item-section>
      </q-item>
    </q-list>
  </SettingsPageShell>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import SettingsPageShell from "src/pages/settings/SettingsPageShell.vue";
import silentLinkLogo from "src/assets/silent-link-logo.svg";
import {
  Globe as GlobeIcon,
  CircleHelp as HelpIcon,
  Mail as MailIcon,
  Code as CodeIcon,
  ExternalLink as ExternalLinkIcon,
} from "lucide-vue-next";

export default defineComponent({
  name: "AboutSettings",
  components: { SettingsPageShell, ExternalLinkIcon },
  data() {
    return { silentLinkLogo };
  },
  computed: {
    links() {
      return [
        {
          title: "Silent Link",
          caption: "silent.link",
          icon: markRaw(GlobeIcon),
          href: "https://silent.link/",
        },
        {
          title: "Help & FAQ",
          caption: "silent.link/faq",
          icon: markRaw(HelpIcon),
          href: "https://silent.link/faq",
        },
        {
          title: "Contact support",
          caption: "support@silent.link",
          icon: markRaw(MailIcon),
          href: "mailto:support@silent.link",
        },
        {
          title: "Wallet source code",
          caption: "github.com/brenorb/cashu-sync",
          icon: markRaw(CodeIcon),
          href: "https://github.com/brenorb/cashu-sync",
        },
      ];
    },
  },
});
</script>

<style scoped>
.about-brand {
  margin: 0 0 24px;
  padding: 20px;
  border: 1px solid var(--sl-outline);
  border-radius: 8px;
}
.about-brand img {
  display: block;
  width: 130px;
  height: 50px;
  padding: 4px;
  background: var(--sl-surface);
}
.about-brand h1 {
  margin: 16px 0 8px;
  font-size: 1.4rem;
  line-height: 1.3;
}
.about-brand p {
  margin: 0;
  color: #a9a9a9;
  line-height: 1.5;
}
</style>
