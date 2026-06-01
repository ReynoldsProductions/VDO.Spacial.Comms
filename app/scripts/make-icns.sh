#!/bin/bash
# Usage: ./scripts/make-icns.sh assets/icon-source.png
# Requires macOS sips + iconutil (both built-in)
set -e
SRC="${1:-assets/icon-source.png}"
ICONSET="assets/icon.iconset"

mkdir -p "$ICONSET"

sips -z 16   16   "$SRC" --out "$ICONSET/icon_16x16.png"       >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_32x32.png"       >/dev/null
sips -z 64   64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
sips -z 128  128  "$SRC" --out "$ICONSET/icon_128x128.png"     >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_256x256.png"     >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_512x512.png"     >/dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png"  >/dev/null

iconutil -c icns "$ICONSET" -o assets/icon.icns
rm -rf "$ICONSET"
echo "Created assets/icon.icns"
