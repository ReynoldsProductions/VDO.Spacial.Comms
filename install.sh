#!/usr/bin/env bash
# install.sh — CLI installer for VDO.Spacial.Comms headless/server mode
# Installs a systemd user service that runs the app via xvfb-run on login.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
CONFIG_DIR="$HOME/.vdo-multichan"
CONFIG_FILE="$CONFIG_DIR/config.json"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/vdo-spacial-comms.service"

# ── helpers ──────────────────────────────────────────────────────────────────

echo ""
echo "VDO.Spacial.Comms — Headless Server Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for required tools
for cmd in xvfb-run electron node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "WARNING: '$cmd' not found on PATH. Install it before starting the service."
    echo "  xvfb-run: sudo apt install xvfb"
    echo "  electron:  npm install -g electron   (or use the bundled binary in dist/)"
  fi
done
echo ""

# ── port prompt ───────────────────────────────────────────────────────────────

DEFAULT_PORT=8080
read -rp "Control API port [${DEFAULT_PORT}]: " INPUT_PORT
PORT="${INPUT_PORT:-$DEFAULT_PORT}"

# Validate port is numeric and in range
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid port '$PORT'. Aborting."
  exit 1
fi

# ── write port to config ──────────────────────────────────────────────────────

mkdir -p "$CONFIG_DIR"

if [[ -f "$CONFIG_FILE" ]]; then
  # Patch existing config: update or insert controlApiPort
  TMPFILE="$(mktemp)"
  if command -v node &>/dev/null; then
    node - "$CONFIG_FILE" "$PORT" >"$TMPFILE" <<'NODEEOF'
const fs = require('fs');
const [,, cfgPath, portArg] = process.argv;
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.controlApiPort = parseInt(portArg, 10);
process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
NODEEOF
    mv "$TMPFILE" "$CONFIG_FILE"
    echo "Updated existing config: controlApiPort = $PORT"
  else
    # Fallback: sed-based patch (handles the common JSON layout produced by the app)
    if grep -q '"controlApiPort"' "$CONFIG_FILE"; then
      sed -i "s/\"controlApiPort\"[[:space:]]*:[[:space:]]*[0-9]*/\"controlApiPort\": $PORT/" "$CONFIG_FILE"
    else
      sed -i "s/}$/,\n  \"controlApiPort\": $PORT\n}/" "$CONFIG_FILE"
    fi
    rm -f "$TMPFILE"
    echo "Updated existing config (sed fallback): controlApiPort = $PORT"
  fi
else
  # Write a minimal config seeding only the port; the app merges defaults on first load
  cat >"$CONFIG_FILE" <<JSEOF
{
  "instance_name": "default",
  "comms_room": "default",
  "comms_password": "",
  "vdo_base_url": "https://vdo.whatadickmove.com",
  "input_device": "",
  "output_device": "",
  "input_device_uid": "",
  "output_device_uid": "",
  "sample_rate": 48000,
  "outputMode": "classic",
  "webrtc_turn_off": false,
  "webrtc_stun_only": false,
  "webrtc_lan_mode": false,
  "room_locked": false,
  "lock_password": "",
  "controlApiPort": $PORT,
  "lines": [
    { "id": 0, "name": "PL1", "group": "1", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0, "input_device_uid": null, "output_device_uid": null },
    { "id": 1, "name": "PL2", "group": "2", "input_channel": 1, "output_channel": 1, "gain_in": 1.0, "gain_out": 1.0, "input_device_uid": null, "output_device_uid": null },
    { "id": 2, "name": "PL3", "group": "3", "input_channel": 2, "output_channel": 2, "gain_in": 1.0, "gain_out": 1.0, "input_device_uid": null, "output_device_uid": null },
    { "id": 3, "name": "PL4", "group": "4", "input_channel": 3, "output_channel": 3, "gain_in": 1.0, "gain_out": 1.0, "input_device_uid": null, "output_device_uid": null }
  ]
}
JSEOF
  echo "Created new config: controlApiPort = $PORT"
fi

# ── resolve electron binary ───────────────────────────────────────────────────

ELECTRON_BIN="$(command -v electron 2>/dev/null || true)"
# Check for a locally bundled binary (produced by electron-builder)
LOCAL_ELECTRON="$SCRIPT_DIR/dist/linux-unpacked/vdo-spacial-comms"
if [[ -z "$ELECTRON_BIN" && -x "$LOCAL_ELECTRON" ]]; then
  ELECTRON_BIN="$LOCAL_ELECTRON"
fi
if [[ -z "$ELECTRON_BIN" ]]; then
  ELECTRON_BIN="electron"  # let the service fail loudly if not found
  echo "WARNING: electron binary not found. Install it or build a dist first."
fi

# ── write systemd unit ────────────────────────────────────────────────────────

mkdir -p "$SERVICE_DIR"

cat >"$SERVICE_FILE" <<UNITEOF
[Unit]
Description=VDO.Spacial.Comms Spatial Intercom
After=network.target

[Service]
ExecStart=/usr/bin/xvfb-run -a ${ELECTRON_BIN} ${APP_DIR}
Environment=HOME=${HOME}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNITEOF

echo "Wrote systemd unit: $SERVICE_FILE"

# ── enable + start service ────────────────────────────────────────────────────

systemctl --user daemon-reload
systemctl --user enable --now vdo-spacial-comms.service

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Installation complete."
echo ""
echo "  Spatial Control UI:  http://localhost:${PORT}"
echo ""
echo "  Check status:  systemctl --user status vdo-spacial-comms"
echo "  View logs:     journalctl --user -u vdo-spacial-comms -f"
echo "  Uninstall:     ./uninstall.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
