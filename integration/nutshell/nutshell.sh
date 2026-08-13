#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file="$script_dir/compose.yaml"
validator="$script_dir/assert_ready.py"
project_name=${CASHU_SYNC_NUTSHELL_PROJECT:-cashu-sync-it}
mint_port=${CASHU_SYNC_NUTSHELL_PORT:-3338}
mint_url=${CASHU_SYNC_NUTSHELL_URL:-http://127.0.0.1:$mint_port}

compose() {
  docker compose --project-name "$project_name" --file "$compose_file" "$@"
}

assert_ready() {
  python3 "$validator" "$mint_url/v1/info"
}

usage() {
  printf '%s\n' "usage: $0 {up|ready|logs|down}"
}

case "${1:-}" in
  up)
    compose up --detach --wait --wait-timeout 90
    assert_ready
    ;;
  ready)
    assert_ready
    ;;
  logs)
    compose logs "${2:-mint}"
    ;;
  down)
    compose down --volumes --remove-orphans
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
