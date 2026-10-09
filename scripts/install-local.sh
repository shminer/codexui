#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
prefix=${PREFIX:-${CODEX_MOBILE_PREFIX:-"$HOME/.local"}}

cd "$root"
pnpm run build
npm install --global --prefix "$prefix" "$root"

printf 'Installed codexui and codexui-safe under %s/bin\n' "$prefix"
printf 'Ensure %s/bin is in PATH.\n' "$prefix"
