#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose_file="$repo_root/integration/nutshell/compose.yaml"
helper="$repo_root/integration/nutshell/nutshell.sh"
validator="$repo_root/integration/nutshell/assert_ready.py"

fail() {
  printf '%s\n' "nutshell reference contract: $*" >&2
  exit 1
}

contains() {
  grep -F "$2" "$1" >/dev/null || fail "$1 is missing: $2"
}

[ -f "$compose_file" ] || fail "missing $compose_file"
[ -x "$helper" ] || fail "missing executable $helper"
[ -f "$validator" ] || fail "missing $validator"

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
docker compose --project-name cashu-sync-contract --file "$compose_file" config --quiet

rendered_compose=$(CASHU_SYNC_NUTSHELL_PORT=43338 docker compose \
  --project-name cashu-sync-contract \
  --file "$compose_file" \
  config)
printf '%s\n' "$rendered_compose" | grep -F 'published: "43338"' >/dev/null || \
  fail "$compose_file did not render CASHU_SYNC_NUTSHELL_PORT=43338"

contains "$compose_file" 'cashubtc/nutshell:0.20.3@sha256:f039b0e61f64d67c7212f5472eb5d021c3703cd9e72170aa924906ce6bd1f2ed'
contains "$compose_file" 'redis:7.4.5-alpine@sha256:bb186d083732f669da90be8b0f975a37812b15e913465bb14d845db72a4e3e08'
contains "$compose_file" 'MINT_BACKEND_BOLT11_USD: FakeWallet'
contains "$compose_file" 'MINT_DERIVATION_PATH: "m/0'"'"'/2'"'"'/0'"'"'"'
if grep -F 'MINT_BACKEND_BOLT11_SAT' "$compose_file" >/dev/null; then
  fail "$compose_file must not configure a sat backend"
fi
contains "$compose_file" 'MINT_REDIS_CACHE_ENABLED: "TRUE"'
contains "$compose_file" 'MINT_REDIS_CACHE_URL: redis://redis:6379/0'
contains "$compose_file" 'MINT_PRIVATE_KEY: cashu-sync-integration-test-only'
contains "$compose_file" 'MINT_AUTH_DATABASE: /data/auth'
contains "$compose_file" 'http://127.0.0.1:3338/v1/info'
contains "$compose_file" '${CASHU_SYNC_NUTSHELL_PORT:-3338}'

if grep -Eq '^[[:space:]]*container_name:' "$compose_file"; then
  fail "$compose_file must not set container_name"
fi

contains "$helper" 'docker compose'
contains "$helper" 'down --volumes --remove-orphans'
contains "$helper" 'CASHU_SYNC_NUTSHELL_PORT'
contains "$validator" 'Nutshell/0.20.3'
contains "$validator" '"usd"'
contains "$validator" 'bolt11_mint_quote'
contains "$validator" 'bolt11_melt_quote'
contains "$validator" 'proof_state'

valid_info=$(mktemp "${TMPDIR:-/tmp}/cashu-sync-nutshell-info.XXXXXX")
invalid_info=$(mktemp "${TMPDIR:-/tmp}/cashu-sync-nutshell-info.XXXXXX")
trap 'rm -f "$valid_info" "$invalid_info"' EXIT HUP INT TERM
printf '%s\n' '{"version":"Nutshell/0.20.3","nuts":{"4":{"disabled":false,"methods":[{"method":"bolt11","unit":"usd"}]},"5":{"disabled":false,"methods":[{"method":"bolt11","unit":"usd"}]},"7":{"supported":true},"9":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"usd","commands":["bolt11_mint_quote","bolt11_melt_quote","proof_state"]}]},"19":{"ttl":3600,"cached_endpoints":[{"method":"POST","path":"/v1/mint/bolt11"},{"method":"POST","path":"/v1/melt/bolt11"}]}}}' >"$valid_info"
python3 -O "$validator" "file://$valid_info" >/dev/null
sed 's/"usd"/"sat"/g' "$valid_info" >"$invalid_info"
if python3 -O "$validator" "file://$invalid_info" >/dev/null 2>&1; then
  fail "$validator accepted a sat-only mint under python -O"
fi
if grep -Eq '^[[:space:]]*assert[[:space:]]' "$validator"; then
  fail "$validator uses optimization-sensitive assert statements"
fi

printf '%s\n' 'nutshell reference contract: ok'
