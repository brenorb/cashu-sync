<template>
  <SettingsPageShell title="Settings">
    <q-list
      v-for="group in visibleGroups"
      :key="group.name"
      class="settings-menu-group q-mb-lg"
    >
      <q-item
        v-for="entry in group.entries"
        :key="entry.path"
        clickable
        v-ripple
        :to="entry.path"
        class="settings-menu-item"
      >
        <q-item-section avatar>
          <div class="settings-menu-icon">
            <component :is="entry.icon" :size="20" aria-hidden="true" />
          </div>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-weight-medium">
            {{ entry.title }}
          </q-item-label>
          <q-item-label caption>{{ entry.caption }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <ChevronRightIcon
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
import SettingsPageShell from "./SettingsPageShell.vue";
import {
  RefreshCw as RefreshCwIcon,
  ArchiveRestore as ArchiveRestoreIcon,
  Palette as PaletteIcon,
  Globe as GlobeIcon,
  Info as InfoIcon,
  ChevronRight as ChevronRightIcon,
} from "lucide-vue-next";

export default defineComponent({
  name: "SettingsMenuPage",
  components: {
    SettingsPageShell,
    ChevronRightIcon,
  },
  computed: {
    visibleGroups() {
      return [
        {
          name: "wallet",
          entries: [
            {
              path: "/settings/sync",
              title: "Sync devices",
              caption: "Pair another wallet and view relay status.",
              icon: markRaw(RefreshCwIcon),
            },
            {
              path: "/settings/recovery",
              title: "Recovery & backup",
              caption: "Export or restore encrypted wallet authority.",
              icon: markRaw(ArchiveRestoreIcon),
            },
          ],
        },
        {
          name: "preferences",
          entries: [
            {
              path: "/settings/appearance",
              title: "Appearance",
              caption: "Theme and display preferences.",
              icon: markRaw(PaletteIcon),
            },
            {
              path: "/settings/language",
              title: "Language",
              caption: "Choose the wallet language.",
              icon: markRaw(GlobeIcon),
            },
          ],
        },
        {
          name: "about",
          entries: [
            {
              path: "/settings/about",
              title: "About",
              caption: "Version, terms, and project links.",
              icon: markRaw(InfoIcon),
            },
          ],
        },
      ];
    },
  },
});
</script>
