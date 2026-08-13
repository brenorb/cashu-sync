# Cashu Sync v0 local tutorial

This tutorial exercises the complete v0 product path with one user controlling two paired PWA wallets: start a local USD Nutshell mint and the Silent Link relay, pair two isolated browser profiles with two QR payloads, mint, synchronize, melt, and recover the wallet into a third empty profile.

The local Nutshell profile uses FakeWallet. It is deterministic test infrastructure, not real USD or Lightning settlement. Do not reuse its mint key, database, relay open mode, or HTTP endpoints in production.

## Prerequisites

- Docker with the Compose plugin;
- Python 3;
- Go 1.26 or later;
- Node.js 22.4 or later and npm;
- two browser profiles for pairing, plus a third fresh profile for recovery.

Use separate browser profiles, not two tabs in one profile: tabs share localStorage and IndexedDB. Chrome profiles, a normal window plus an incognito window, and a third guest profile are sufficient for this manual check.

Run every command from the repository root unless a step says otherwise.

## 1. Start the local USD mint

In terminal 1:

```sh
./integration/nutshell/nutshell.sh up
./integration/nutshell/nutshell.sh ready
```

The helper starts the pinned Nutshell `0.20.3` and Redis images, waits for `http://127.0.0.1:3338/v1/info`, and verifies Bolt11/USD NUT-04 and NUT-05 support plus the recovery and caching features used by v0. See [the reference-mint profile](./research/nutshell-reference.md) for the exact images and checks.

## 2. Start the local Silent Link relay

In terminal 2:

```sh
manual_relay_dir=$(mktemp -d "${TMPDIR:-/tmp}/cashu-sync-relay.XXXXXX")
cd relay
CASHU_SYNC_ADMISSION_MODE=open \
  CASHU_SYNC_DB_PATH="$manual_relay_dir/cashu-sync.db" \
  go run ./cmd/cashu-sync-relay
```

Leave the process running. Its default listener is `127.0.0.1:3334`. In another terminal, readiness is:

```sh
curl -fsS http://127.0.0.1:3334/healthz
```

The expected body is `ok`. Open admission is intentionally restricted to loopback and is only for this local test. Production uses TLS/WSS and an allowlist.

## 3. Build and serve the configured wallet PWA

In terminal 3:

```sh
cd wallet
npm ci
PUBLIC_PATH=/ \
  CASHU_SYNC_MINT_URL=http://127.0.0.1:3338 \
  CASHU_SYNC_RELAY_URL=ws://127.0.0.1:3334 \
  CASHU_SYNC_ALLOW_INSECURE_LOOPBACK=true \
  npm run build:pwa
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist/pwa
```

Open `http://127.0.0.1:8080`. Serving the built PWA over loopback HTTP keeps the local mint and relay on the same security level and exercises the generated service worker. The insecure-loopback flag permits only local HTTP mint and relay origins; it does not relax the production HTTPS authority rule.

For hot reloading during UI development, the same three `CASHU_SYNC_*` variables can prefix `npm run dev`; Quasar's development server uses `https://localhost:8080`, so the browser may ask you to trust its local certificate. The built HTTP path above is the recommended manual acceptance path.

Open `http://127.0.0.1:8080` in browser profile A and browser profile B. Each fresh profile initially creates its own empty authority from the build-time mint and relay URLs. Profile B can safely replace that empty authority during pairing; a profile with proofs, quotes, history, counters, or a pending operation cannot be replaced.

## 4. Pair profile B to profile A

Pairing uses two QR payloads. The current desktop-friendly UI also renders each payload as text, so this test can copy and paste it between profiles without a camera.

1. In profile B, open **Settings → Sync devices** and select **Create pairing request**.
2. **QR 1** is the pairing request. It contains an ephemeral public key, challenge, and five-minute expiry, but no wallet secret. Copy the text from **Pairing request**.
3. In profile A, open **Settings → Sync devices**. Paste QR 1 into **Pairing request from new wallet**, then select **Create encrypted response**.
4. **QR 2** is the encrypted full-authority response bound to QR 1. Copy the text from **Encrypted pairing response**.
5. Return to profile B, paste QR 2 into **Encrypted response from existing wallet**, and select **Finish pairing**.
6. Confirm profile B says `Paired. This wallet now follows the shared relay head.`

If five minutes elapse, create a new QR 1. Pairing transfers full spend and sync authority, so only pair a wallet installation controlled by the same user.

## 5. Mint 10 USD and verify cross-device sync

In profile A:

1. Return to the wallet home page and select **Add funds**.
2. Enter `10` in **Amount in USD** and select **Create invoice**.
3. The local FakeWallet automatically settles its generated invoice. Select **Claim paid invoice**. If the quote has not changed to `PAID` yet, wait briefly and select it again.
4. Confirm `Funds added and synchronized.`, a higher **Available balance**, and a **Funds added** row in **Accounting**.

Bring profile B to the foreground and return to or reload the wallet home page. Startup and foreground resume pull the current encrypted head. Confirm profile B shows the same balance and accounting row. The wallets are not sending Cashu tokens to each other; both are displaying one synchronized wallet.

## 6. Melt a 1 USD test invoice

Create an internal FakeWallet Bolt11/USD invoice from terminal 1 or another shell and copy the printed invoice:

```sh
curl -fsS -X POST http://127.0.0.1:3338/v1/mint/quote/bolt11 \
  -H 'content-type: application/json' \
  -d '{"amount":100,"unit":"usd"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["request"])'
```

In profile B:

1. Select **Pay invoice**.
2. Paste the printed invoice into **Bolt11 invoice** and select **Review payment**.
3. Confirm the quote summary says `1 USD`, then select **Pay invoice**.
4. Confirm `Invoice paid and synchronized.`, the reduced balance, and an **Invoice paid** accounting row.

Bring profile A to the foreground and return to or reload the home page. Confirm its balance and two accounting rows match profile B.

The relay compare-and-swap and encrypted operation journal fence the state-changing mint call. If another device wins the head or a network result is ambiguous, the wallet keeps or reconciles the pending operation instead of starting a second one.

## 7. Export and recover from scratch

In profile A:

1. Open **Settings → Recovery & backup**.
2. Enter the same strong passphrase in **Backup passphrase** and **Confirm passphrase**. The implementation requires at least 10 UTF-8 bytes.
3. Select **Download encrypted backup** and keep the downloaded JSON file.

The encrypted full-recovery bundle contains the mnemonic, shared sync secret, configured mint and relay, schema, and last remembered head. It does not contain the current snapshot itself, so leave the relay running for this test.

In a new, otherwise empty browser profile C:

1. Open `http://127.0.0.1:8080/#/settings/recovery`.
2. Choose the downloaded file under **Encrypted backup file**. The encrypted JSON also appears in the paste field.
3. Enter the backup passphrase and select **Restore synchronized wallet**.
4. Confirm `Wallet restored and synchronized.`
5. Return to the home page and confirm the final balance plus both **Funds added** and **Invoice paid** accounting rows.

A wrong passphrase, modified bundle, nonempty destination wallet, or unavailable relay must fail rather than partially import state.

## Stable UI selectors

These are the selectors used by the live browser acceptance test and are useful when diagnosing the manual flow:

- pairing: `data-pairing-action="create-request"`, `create-response`, and `finish`;
- mint: `data-v0-action="mint-bolt11"`, `create-mint-quote`, and `claim-mint-quote`;
- melt: `data-v0-action="melt-bolt11"`, `create-melt-quote`, and `pay-melt-quote`;
- recovery: `data-recovery-action="download"` and `data-recovery-action="restore"`.

The corresponding fields use `data-pairing-field`, `data-v0-field`, and `data-recovery-field`. The automated implementation of this tutorial is `wallet/tests/e2e/v0-live-wallet-flow.spec.ts`.

## Automated equivalent

With Nutshell and the relay already running, execute from `wallet/`:

```sh
CASHU_SYNC_MINT_URL=http://127.0.0.1:3338 \
  CASHU_SYNC_NUTSHELL_URL=http://127.0.0.1:3338 \
  CASHU_SYNC_RELAY_URL=ws://127.0.0.1:3334 \
  CASHU_SYNC_ALLOW_INSECURE_LOOPBACK=true \
  npm run test:e2e:live
```

The test builds the PWA, launches three isolated persistent browser contexts, and runs pairing, mint, cross-device synchronization, melt, and full-bundle recovery. Without `CASHU_SYNC_E2E_REQUIRE_LIVE=1` (set by that npm script), unavailable services cause the live case to skip; with it, readiness failure fails the run.

## Clean up

Stop the wallet and relay processes with `Ctrl-C`. From the repository root, remove the isolated Nutshell containers, network, Redis tmpfs, and mint database volume:

```sh
./integration/nutshell/nutshell.sh down
```

In terminal 2, after the relay process has stopped, move its temporary SQLite directory to the macOS Trash:

```sh
trash "$manual_relay_dir"
```

Delete the disposable browser profiles through the browser's profile manager. Do not delete a profile containing funds or a recovery artifact you intend to keep.

## GitHub Pages caveats

The repository workflow builds the PWA under `/cashu-sync/` with hash routing because GitHub Pages has no SPA fallback. GitHub Pages hosts only static files; it cannot run Nutshell or the stateful WebSocket relay.

An HTTPS Pages deployment needs an HTTPS authority mint and a WSS Silent Link relay. It cannot use this tutorial's `http://127.0.0.1:3338` and `ws://127.0.0.1:3334` values. `CASHU_SYNC_MINT_URL` and `CASHU_SYNC_RELAY_URL` are public build configuration, never secrets. Do not enable `CASHU_SYNC_ALLOW_INSECURE_LOOPBACK` in a production build.

The current `.github/workflows/pages.yml` does not set mint or relay build variables. Its artifact can pair or restore an existing authority, but it cannot bootstrap a newly configured production wallet. Production bootstrap also requires a supported operator path to enroll the generated sync pubkey in the relay allowlist. Those deployment tasks are explicitly tracked in [the roadmap](./roadmap.md); the current Pages workflow is not a turnkey production release.

The generated service worker does not take control immediately during an update. That protects in-progress wallet operations, but testers may need to close all installed-PWA tabs and reopen them before judging a newly deployed build.
