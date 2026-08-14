/* eslint-env node */

/*
 * This file runs in a Node context (it's NOT transpiled by Babel), so use only
 * the ES6 features that are supported by your Node version. https://node.green/
 */

// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-js

const { configure } = require("quasar/wrappers");
const { execSync } = require("child_process");

function resolveGitCommit() {
  try {
    return execSync("git describe --always --dirty", {
      cwd: __dirname,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch (err) {
    console.warn("Unable to resolve git commit via `git describe`");
    return "unknown";
  }
}

function resolvePublicPath(value = process.env.PUBLIC_PATH) {
  if (!value) return "/";
  if (!value.startsWith("/") || !value.endsWith("/") || value.includes("..")) {
    throw new Error("PUBLIC_PATH must be an absolute path ending in '/'");
  }
  return value;
}

module.exports = configure(function (/* ctx */) {
  const publicPath = resolvePublicPath();
  return {
    eslint: {
      // fix: true,
      // include: [],
      // exclude: [],
      // rawOptions: {},
      warnings: true,
      errors: true,
    },

    // https://v2.quasar.dev/quasar-cli/prefetch-feature
    // preFetch: true,

    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://v2.quasar.dev/quasar-cli/boot-files
    boot: ["base", "global-components", "i18n"],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#css
    css: ["app.scss", "base.scss", "settings.scss"],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // 'ionicons-v4',
      // 'mdi-v5',
      // 'fontawesome-v6',
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!

      "material-icons", // optional, you are not bound to it
    ],

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#build
    build: {
      target: {
        browser: ["esnext"],
        node: "node16",
      },

      vueRouterMode: "hash", // GitHub Pages has no SPA fallback.
      publicPath,
      env: {
        CASHU_SYNC_MINT_URL: process.env.CASHU_SYNC_MINT_URL || "",
        CASHU_SYNC_RELAY_URL: process.env.CASHU_SYNC_RELAY_URL || "",
        CASHU_SYNC_ALLOW_INSECURE_LOOPBACK:
          process.env.CASHU_SYNC_ALLOW_INSECURE_LOOPBACK === "true",
      },
      // vueRouterBase,
      // vueDevtools,
      // vueOptionsAPI: false,

      // rebuildCache: true, // rebuilds Vite/linter/etc cache on startup

      // publicPath: '/',
      // analyze: true,
      // env: {},
      // rawDefine: {}
      // ignorePublicFolder: true,
      // minify: false,
      // polyfillModulePreload: true,
      // distDir

      extendViteConf(viteConf) {
        viteConf.define = viteConf.define || {};
        viteConf.define.GIT_COMMIT = JSON.stringify(resolveGitCommit());
        // cashu-ts v4 ships ESM with BigInt — Vite's dep optimizer can mangle it
        viteConf.optimizeDeps = viteConf.optimizeDeps || {};
        viteConf.optimizeDeps.exclude = [
          ...(viteConf.optimizeDeps.exclude || []),
          "@agicash/qr-scanner",
          "@cashu/cashu-ts",
        ];
        viteConf.plugins = viteConf.plugins || [];
        viteConf.plugins.push({
          name: "cashu:scope-favicon-links",
          enforce: "post",
          transformIndexHtml: {
            enforce: "post",
            transform(html) {
              return html.replace(
                /href=(["']?)\/icons\/(128x128|96x96|32x32|16x16)\.png\1/g,
                (_, quote, size) =>
                  `href=${quote}${publicPath}icons/favicon-${size}.png${quote}`
              );
            },
          },
        });
      },
      // viteVuePluginOptions: {},

      // vitePlugins: [
      //   [ 'package-name', { ..options.. } ]
      // ]
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#devServer
    devServer: {
      https: true,
      open: true, // opens browser window automatically
      port: 8080,
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#framework
    framework: {
      config: {},

      iconSet: "material-icons", // Quasar icon set
      // lang: 'en-US', // Quasar language pack

      // For special cases outside of where the auto-import strategy can have an impact
      // (like functional components as one of the examples),
      // you can manually specify Quasar components/directives to be available everywhere:
      //
      // components: [],
      // directives: [],

      // Quasar plugins
      plugins: ["LocalStorage", "Notify"],
    },

    animations: "all", // --- includes all animations
    // https://v2.quasar.dev/options/animations
    // animations: [],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#property-sourcefiles
    // sourceFiles: {
    //   rootComponent: 'src/App.vue',
    //   router: 'src/router/index',
    //   store: 'src/store/index',
    //   registerServiceWorker: 'src-pwa/register-service-worker',
    //   serviceWorker: 'src-pwa/custom-service-worker',
    //   pwaManifestFile: 'src-pwa/manifest.json',
    //   electronMain: 'src-electron/electron-main',
    //   electronPreload: 'src-electron/electron-preload'
    // },

    // https://v2.quasar.dev/quasar-cli/developing-ssr/configuring-ssr
    ssr: {
      // ssrPwaHtmlFilename: 'offline.html', // do NOT use index.html as name!
      // will mess up SSR

      // extendSSRWebserverConf (esbuildConf) {},
      // extendPackageJson (json) {},

      pwa: false,

      // manualStoreHydration: true,
      // manualPostHydrationTrigger: true,

      prodPort: 3000, // The default port that the production server should use
      // (gets superseded if process.env.PORT is specified at runtime)

      middlewares: [
        "render", // keep this as last one
      ],
    },

    // https://v2.quasar.dev/quasar-cli/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: "generateSW", // or 'injectManifest'
      injectPwaMetaTags: true,
      swFilename: "sw.js",
      manifestFilename: "manifest.json",
      useCredentialsForManifestTag: false,
      workboxOptions: {
        // Demo UX: a deployed wallet must update on the next reload.
        // ponytail: immediate activation trades graceful wallet-operation
        // handoff for a demo that never strands users on stale UI.
        skipWaiting: true,
        clientsClaim: true,
      },
      extendGenerateSWOptions(options) {
        options.skipWaiting = true;
        options.clientsClaim = true;
      },
      // useFilenameHashes: true,
      // extendGenerateSWOptions (cfg) {}
      // extendInjectManifestOptions (cfg) {},
      // extendManifestJson (json) {}
      // extendPWACustomSWConf (esbuildConf) {}
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-cordova-apps/configuring-cordova
    cordova: {
      // noIosLegacyBuildFlag: true, // uncomment only if you know what you are doing
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: false,
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli/developing-electron-apps/configuring-electron
    electron: {
      // extendElectronMainConf (esbuildConf)
      // extendElectronPreloadConf (esbuildConf)

      inspectPort: 5858,

      bundler: "packager", // 'packager' or 'builder'

      packager: {
        // https://github.com/electron-userland/electron-packager/blob/master/docs/api.md#options
        // OS X / Mac App Store
        // appBundleId: '',
        // appCategoryType: '',
        // osxSign: '',
        // protocol: 'myapp://path',
        // Windows only
        // win32metadata: { ... }
        asar: true,
        prune: true,
        ignore: [
          /(^|[\\/])node_modules([\\/]|$)/,
          /(^|[\\/])screenshots([\\/]|$)/,
          /(^|[\\/])package-lock\.json$/,
          /(^|[\\/])yarn\.lock$/,
          /(^|[\\/])pnpm-lock\.yaml$/,
          /(^|[\\/])vitest\.config\.js$/,
          /(^|[\\/])test([\\/]|$)/,
        ],
      },

      builder: {
        // https://www.electron.build/configuration/configuration

        appId: "me.cashu",
      },
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-browser-extensions/configuring-bex
    bex: {
      contentScripts: ["my-content-script"],

      // extendBexScriptsConf (esbuildConf) {}
      // extendBexManifestJson (json) {}
    },
  };
});
