# Cashu Sync v0 local tutorial

This tutorial exercises the complete v0 product path with one user controlling two paired web wallets: start a local USD Nutshell mint and the Silent Link relay, open the wallet directly, fund it, pair another browser with one QR scan, synchronize, melt for an eSIM top-up, and recover after deleting the local wallet.

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

In terminal 2, start the separate pairing relay and leave it running:

```sh
cd relay
CASHU_SYNC_PAIRING_LISTEN_ADDR=127.0.0.1:3335 \
  go run ./cmd/cashu-sync-pairing-relay
```

It stores only short-lived encrypted kind-1059 gift wraps and has no sync-key authentication.

## 3. Build and serve the configured wallet PWA

In terminal 3:

```sh
cd wallet
npm ci
PUBLIC_PATH=/ \
  CASHU_SYNC_MINT_URL=http://127.0.0.1:3338 \
  CASHU_SYNC_RELAY_URL=ws://127.0.0.1:3334 \
  CASHU_SYNC_PAIRING_RELAY_URL=ws://127.0.0.1:3335 \
  CASHU_SYNC_ALLOW_INSECURE_LOOPBACK=true \
  npm run build:pwa
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist/pwa
```

Open `http://127.0.0.1:8080`. The wallet opens directly. Serving the built PWA over loopback HTTP keeps the local mint and relay on the same security level and exercises the generated service worker. The insecure-loopback flag permits only local HTTP mint and relay origins; it does not relax the production HTTPS authority rule.

For hot reloading during UI development, the same three `CASHU_SYNC_*` variables can prefix `npm run dev`; Quasar's development server uses `https://localhost:8080`, so the browser may ask you to trust its local certificate. The built HTTP path above is the recommended manual acceptance path.

Open `http://127.0.0.1:8080` in browser profile A and browser profile B. Each fresh profile initially creates its own empty authority from the build-time mint and relay URLs. Profile B can safely replace that empty authority during pairing; a profile with proofs, quotes, history, counters, or a pending operation cannot be replaced.

## 4. Pair profile B to profile A

The normal path is one QR scan from the funded wallet. The QR is public rendezvous metadata only; authority transfer happens automatically through the separate pairing relay.

1. In profile A, open **Settings → Sync devices** and select **Pair another phone**.
2. Scan the single QR with profile B's camera. The wallet opens, exchanges encrypted messages, imports, syncs, and ACKs automatically.
3. Confirm profile B says `Wallet pareada e sincronizada.`

If three minutes elapse, create a new QR. Pairing transfers full spend and sync authority, so only pair a wallet installation controlled by the same user.

## 5. Fund the wallet and verify cross-device sync

In profile A:

1. Return to the wallet home page and select **Add balance**.
2. Enter `10` in **Amount in USD** and select **Show payment invoice**.
3. The local FakeWallet automatically settles its generated invoice. Select **Update balance**. If the quote has not changed to `PAID` yet, wait briefly and select it again.
4. Confirm `Funds added and synchronized.`, a higher **Available balance**, and a **Funds added** row in **Accounting**. Open **Settings → Sync devices → Pair another phone** to create the one-scan QR; it contains no seed, funds, or ciphertext.

Bring profile B to the foreground and return to or reload the wallet home page. Startup and foreground resume pull the current encrypted head. Confirm profile B shows the same balance and accounting row. The wallets are not sending Cashu tokens to each other; both are displaying one synchronized wallet.

## 6. Spend credits on an eSIM top-up

For the Fly demo, select **Top up eSIM**, enter an amount that matches the
available denominations, and select **Confirm top up**. The demo consumes the
selected credits locally and publishes the result through the relay; it does
not create or display an invoice. A production deployment must configure
`CASHU_SYNC_TOPUP_URL` so the same flow pays a real Silent Link provider
invoice. Do not use a mint quote as a melt invoice: FakeWallet auto-settles
mint quotes, so Nutshell rejects them as already paid.

For the provider-backed test flow, use one of the valid unpaid Bolt11/USD test
invoices shipped with the live flow. Print a fresh fixture with:

```sh
python3 - <<'PY'
import re, secrets
from pathlib import Path

invoices = re.findall(r'"(lnbc[^"\\]+)"', Path("wallet/tests/e2e/helpers/cashu.ts").read_text())
print(secrets.choice(invoices))
PY
```

In profile B:

1. Select **Top up eSIM**.
2. Paste the printed payment request into **Payment invoice** and select **Continue**.
3. Confirm the quote summary says `1 USD`, then select **Confirm top up**.
4. Confirm `eSIM top-up paid and synchronized.`, the reduced balance, and an **Invoice paid** accounting row.

Bring profile A to the foreground and return to or reload the home page. Confirm its balance and two accounting rows match profile B.

The relay compare-and-swap and encrypted operation journal fence the state-changing mint call. If another device wins the head or a network result is ambiguous, the wallet keeps or reconciles the pending operation instead of starting a second one.

## 7. Delete and recover from scratch

In profile A:

1. Open **Settings → Recovery & backup**.
2. Enter the same strong passphrase in **Backup passphrase** and **Confirm passphrase**. The implementation requires at least 10 UTF-8 bytes.
3. Select **Download encrypted backup** and keep the downloaded JSON file.

The encrypted full-recovery bundle contains the mnemonic, shared sync secret, configured mint and relay, schema, and last remembered head. It does not contain the current snapshot itself, so leave the relay running for this test.

To demonstrate deletion, open **Settings → Recovery & backup** on profile B and select **Delete wallet from this device**. Confirm the prompt. The encrypted relay snapshot remains intact.

In a new, otherwise empty browser profile C (or the deleted profile B):

1. Open `http://127.0.0.1:8080/#/settings/recovery`.
2. Choose the downloaded file under **Encrypted backup file**. The encrypted JSON also appears in the paste field.
3. Enter the backup passphrase and select **Restore synchronized wallet**.
4. Confirm `Wallet restored and synchronized.`
5. Return to the home page and confirm the final balance plus both **Funds added** and **Invoice paid** accounting rows.

## Phone demo without a VPS

No VPS is required. The computer can run Nutshell, the relay, and the PWA. A phone cannot, however, reach the computer's `127.0.0.1`, and camera/WebCrypto flows require HTTPS/WSS outside loopback. For a phone test, expose the three local services through a private HTTPS/WSS path (for example Tailscale Serve or a local TLS reverse proxy), then build with the resulting mint and relay origins. Do not expose the loopback-only `open` relay publicly; production/mobile deployment uses the relay's HTTPS/WSS canonical origin and pubkey allowlist. If you do not have that private path yet, use the three isolated desktop profiles—the wallet behavior is identical.

A wrong passphrase, modified bundle, nonempty destination wallet, or unavailable relay must fail rather than partially import state.

## Stable UI selectors

These are the selectors used by the live browser acceptance test and are useful when diagnosing the manual flow:

- pairing: `data-pairing-action="create-auto-pair"` and `scan-auto-pair`;
- mint: `data-v0-action="mint-bolt11"`, `create-mint-quote`, and `claim-mint-quote`;
- melt: `data-v0-action="melt-bolt11"`, `create-melt-quote`, and `pay-melt-quote`;
- recovery: `data-recovery-action="download"` and `data-recovery-action="restore"`.

The corresponding fields use `data-pairing-field`, `data-v0-field`, and `data-recovery-field`. The one-QR pairing acceptance test is `wallet/tests/e2e/auto-pairing.spec.ts`.

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

The demo service worker activates the newest build on reload so a deployed UI does not remain stranded in an old cache. Do not deploy this update policy unchanged for a production wallet with long-running operations; production should coordinate updates around operation state.
