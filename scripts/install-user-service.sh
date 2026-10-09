#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
prefix=${PREFIX:-${CODEX_MOBILE_PREFIX:-"$HOME/.local"}}
unit_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
unit_file=$unit_dir/codexui-safe.service
password_file=$HOME/.codex/codex-mobile-safe-password
test_mode=${CODEX_MOBILE_SERVICE_INSTALL_TEST_MODE:-0}

if [ "$test_mode" != 1 ]; then
  PREFIX=$prefix sh "$root/scripts/install-local.sh"
fi

mkdir -p "$unit_dir" "$(dirname -- "$password_file")"
if [ ! -f "$password_file" ]; then
  umask 077
  node -e 'const c=require("node:crypto");process.stdout.write(c.randomBytes(18).toString("base64url")+"\n")' > "$password_file"
fi
chmod 600 "$password_file"

escape_sed() {
  printf '%s' "$1" | sed 's/[\\&|]/\\&/g'
}

project_escaped=$(escape_sed "$root")
prefix_escaped=$(escape_sed "$prefix")
sed \
  -e "s|@PROJECT_DIR@|$project_escaped|g" \
  -e "s|@PREFIX@|$prefix_escaped|g" \
  "$root/packaging/systemd/codexui-safe.service.in" > "$unit_file"
chmod 600 "$unit_file"

if [ "$test_mode" = 1 ]; then
  exit 0
fi

systemd-analyze --user verify "$unit_file"
systemctl --user daemon-reload
systemctl --user enable codexui-safe.service
systemctl --user restart codexui-safe.service

linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)
if [ "$linger" != yes ]; then
  printf '%s\n' 'Service is enabled for user sessions.'
  printf '%s\n' 'For boot-before-login operation, an administrator may run:'
  printf '  sudo loginctl enable-linger %s\n' "$USER"
fi

systemctl --user --no-pager --full status codexui-safe.service
