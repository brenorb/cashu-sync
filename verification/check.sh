#!/bin/sh
# Run a single checked-in model from a clean temporary directory.
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
case "${1:-}" in
  authority-recovery|browser-lifecycle|local-persistence|operation-journal|pairing|pairing-relay|relay-transport|release-fixtures|snapshot-relay|snapshot-sync|wallet-payments)
    subsystem=$1 ;;
  *)
    echo "usage: $0 {authority-recovery|browser-lifecycle|local-persistence|operation-journal|pairing|pairing-relay|relay-transport|release-fixtures|snapshot-relay|snapshot-sync|wallet-payments}" >&2
    exit 2 ;;
esac
set -- "$here/$subsystem/"*.tla
module=$(basename "$1" .tla)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/cashu-tlc.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "${TLA2TOOLS:-}" ]; then
  jar=$TLA2TOOLS
else
  jar=$scratch/tla2tools.jar
  curl -fLsS --retry 2 -o "$jar" https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
fi
sha=$(shasum -a 256 "$jar")
case "$sha" in
  '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88 '*) ;;
  *) echo "Expected the pinned TLA+ tools v1.7.4 jar" >&2; exit 2 ;;
esac
cp "$jar" "$scratch/verified.jar"
cp "$here/$subsystem/$module.tla" "$here/$subsystem/$module.cfg" "$scratch/"
cd "$scratch"
status=0
"${JAVA:-java}" -Xmx512m -XX:+UseParallelGC -cp verified.jar tlc2.TLC -workers 1 -continue -config "$module.cfg" "$module.tla" > tlc.out 2>&1 || status=$?
cat tlc.out
if [ "$status" -eq 0 ] && grep -q "^Error: Invariant " tlc.out; then
  exit 12
fi
exit "$status"
