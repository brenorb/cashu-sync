const routes = [
  {
    path: "/",
    component: () => import("layouts/MainLayout.vue"),
    children: [
      {
        path: "",
        component: () => import("src/pages/SilentLinkLandingPage.vue"),
      },
      { path: "wallet", component: () => import("src/pages/V0WalletPage.vue") },
    ],
  },
  {
    path: "/settings",
    component: () => import("layouts/FullscreenLayout.vue"),
    children: [
      {
        path: "",
        component: () => import("src/pages/settings/SettingsPage.vue"),
      },
      {
        path: "sync",
        component: () => import("src/pages/settings/SyncSettings.vue"),
      },
      {
        path: "recovery",
        component: () => import("src/pages/settings/RecoverySettings.vue"),
      },
      {
        path: "appearance",
        component: () => import("src/pages/settings/AppearanceSettings.vue"),
      },
      {
        path: "language",
        component: () => import("src/pages/settings/LanguageSettings.vue"),
      },
      {
        path: "about",
        component: () => import("src/pages/settings/AboutSettings.vue"),
      },
    ],
  },
  {
    path: "/already-running",
    component: () => import("layouts/BlankLayout.vue"),
    children: [
      { path: "", component: () => import("src/pages/AlreadyRunning.vue") },
    ],
  },
  {
    path: "/terms",
    component: () => import("layouts/FullscreenLayout.vue"),
    children: [
      { path: "", component: () => import("src/pages/TermsPage.vue") },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    component: () => import("src/pages/ErrorNotFound.vue"),
  },
];

export default routes;
