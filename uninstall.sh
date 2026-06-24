#!/usr/bin/env bash
# uninstall.sh — remove the VDO.Spacial.Comms systemd user service

set -euo pipefail

SERVICE="vdo-spacial-comms.service"
SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE"

echo ""
echo "VDO.Spacial.Comms — Uninstaller"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
  systemctl --user stop "$SERVICE"
  echo "Service stopped."
fi

if systemctl --user is-enabled --quiet "$SERVICE" 2>/dev/null; then
  systemctl --user disable "$SERVICE"
  echo "Service disabled."
fi

if [[ -f "$SERVICE_FILE" ]]; then
  rm -f "$SERVICE_FILE"
  echo "Removed unit file: $SERVICE_FILE"
fi

systemctl --user daemon-reload
systemctl --user reset-failed 2>/dev/null || true

echo ""
echo "Uninstall complete. Config at ~/.vdo-multichan/ was not removed."
echo ""
