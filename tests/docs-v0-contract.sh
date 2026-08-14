#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
root_readme="$repo_root/README.md"
overview="$repo_root/docs/README.md"
spec="$repo_root/docs/spec.md"
roadmap="$repo_root/docs/roadmap.md"
tutorial="$repo_root/docs/tutorial.md"
wallet_readme="$repo_root/wallet/README.md"
relay_readme="$repo_root/relay/README.md"
wallet_package="$repo_root/wallet/package.json"
wallet_page="$repo_root/wallet/src/pages/V0WalletPage.vue"
sync_page="$repo_root/wallet/src/pages/settings/SyncSettings.vue"
recovery_page="$repo_root/wallet/src/pages/settings/RecoverySettings.vue"
architecture_files="$repo_root/docs/architecture/c1-system-context.md
$repo_root/docs/architecture/c2-containers.md
$repo_root/docs/architecture/c3-wallet-sync-components.md
$repo_root/docs/architecture/c3-operation-safety-components.md"

fail() {
  printf '%s\n' "docs v0 contract: $*" >&2
  exit 1
}

contains() {
  grep -Fi "$2" "$1" >/dev/null || fail "$1 is missing: $2"
}

for file in "$root_readme" "$overview" "$spec" "$roadmap" "$tutorial" "$wallet_readme" "$relay_readme" $architecture_files; do
  [ -f "$file" ] || fail "missing $file"
done

for file in "$root_readme" "$overview" "$spec" "$tutorial" $architecture_files; do
  contains "$file" "one user"
  contains "$file" "USD"
  contains "$file" "Bolt11"
done

contains "$overview" "one QR"
contains "$root_readme" "one-QR"
contains "$root_readme" "no peer-to-peer"
contains "$spec" "one-QR"
contains "$spec" "pairing relay"
contains "$spec" "full-recovery bundle"
contains "$spec" "compare-and-swap"
contains "$spec" "no peer-to-peer"
contains "$overview" "Silent Link-operated"
contains "$tutorial" "./integration/nutshell/nutshell.sh up"
contains "$tutorial" "go run ./cmd/cashu-sync-relay"
contains "$tutorial" "CASHU_SYNC_MINT_URL=http://127.0.0.1:3338"
contains "$tutorial" "CASHU_SYNC_RELAY_URL=ws://127.0.0.1:3334"
contains "$tutorial" "npm run dev"
contains "$tutorial" "npm run build:pwa"
contains "$tutorial" "./integration/nutshell/nutshell.sh down"
contains "$tutorial" "CASHU_SYNC_PAIRING_RELAY_URL=ws://127.0.0.1:3335"
contains "$tutorial" "data-v0-action=\"mint-bolt11\""
contains "$tutorial" "data-v0-action=\"melt-bolt11\""
contains "$tutorial" "data-recovery-action=\"restore\""
contains "$tutorial" "GitHub Pages"
contains "$wallet_readme" "one-QR"
contains "$wallet_readme" "no peer-to-peer"
contains "$relay_readme" "operated by Silent Link"
contains "$wallet_package" '"build:pwa": "quasar build -m pwa"'
contains "$wallet_package" '"dev": "quasar dev"'
contains "$sync_page" 'data-pairing-action="create-auto-pair"'
contains "$wallet_page" 'data-v0-action="mint-bolt11"'
contains "$wallet_page" 'data-v0-action="melt-bolt11"'
contains "$recovery_page" 'data-recovery-action="restore"'

if grep -EHi 'pairing[^.\n]*(QR/deeplink|deeplink/QR)' \
  "$overview" "$spec" $architecture_files >/dev/null; then
  fail "normative v0 docs still describe pairing as QR/deeplink"
fi

python3 - "$repo_root" "$root_readme" "$overview" "$spec" "$roadmap" "$tutorial" "$wallet_readme" "$relay_readme" $architecture_files <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1]).resolve()
files = [Path(value) for value in sys.argv[2:]]
link = re.compile(r"\[[^]]+\]\(([^)]+)\)")
missing: list[str] = []
for source in files:
    for target in link.findall(source.read_text()):
        target = target.split("#", 1)[0]
        if not target or "://" in target or target.startswith("mailto:"):
            continue
        resolved = (source.parent / target).resolve()
        if root not in resolved.parents and resolved != root:
            missing.append(f"{source}: link escapes repository: {target}")
        elif not resolved.exists():
            missing.append(f"{source}: missing local link: {target}")
if missing:
    raise SystemExit("\n".join(missing))
PY

printf '%s\n' "docs v0 contract: ok"
