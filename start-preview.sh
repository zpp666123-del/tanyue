#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
[ -f dist/index.html ] || npm run build
node tools/dev-server.mjs --port 4173 --dir dist --open
