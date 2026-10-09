#!/bin/sh
set -eu

unit_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
unit_file=$unit_dir/codexui-safe.service

systemctl --user disable --now codexui-safe.service 2>/dev/null || true
rm -f "$unit_file"
systemctl --user daemon-reload
systemctl --user reset-failed codexui-safe.service 2>/dev/null || true
printf '%s\n' 'Removed codexui-safe user service. Password and Tailscale Serve configuration were preserved.'
