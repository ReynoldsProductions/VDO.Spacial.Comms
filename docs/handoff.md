# Agent Handoff — VDO.MultiCh.Comms

**Date:** 2026-06-01  
**Current build:** 0.0.1 build 22  
**Worktree:** `.claude/worktrees/trusting-dubinsky-2943fc`  
**Main branch:** `main`

---

## What this project is

A macOS Electron app for multi-channel IP intercom. It connects multiple "party lines" to VDO.ninja rooms so broadcast crew (e.g. at a Faire event) can communicate across audio channels independently.

**Architecture:**
```
Hardware (BlackHole 16ch) 
  → Rust shim (CPAL, captures per-channel PCM)
  → WebSocket ws://127.0.0.1:9696
  → Electron WebContentsView preload script (AudioWorklet bridge)
  → VDO.ninja getUserMedia override
  → WebRTC → remote participants (phone, web browser)
```

---

## Repo layout

```
app/              Electron app (Node.js main + HTML/JS renderer)
  main.js         Main process — shim lifecycle, IPC, WebContentsView setup
  preload.js      Renderer preload — exposes IPC to renderer
  renderer/
    app.js        UI logic
    index.html    UI shell + styles
  assets/
    icon.icns     App icon (built from icon-source.png via scripts/make-icns.sh)
  scripts/
    bump-build.js Auto-increments build-meta.json before each dist build
    make-icns.sh  PNG → ICNS conversion (macOS sips + iconutil)
  build-meta.json { "version": "0.0.1", "build": 22 } — source of truth for build number
  package.json    electron-builder config, targets mac arm64 DMG

shim/             Rust audio shim
  src/main.rs     WebSocket server, audio frame dispatch (binary protocol)
  src/audio.rs    CPAL device open, ring buffer capture/playback
```

---

## How to build

```bash
# Build shim first if audio.rs changed
cd shim && cargo build --release

# Build DMG (auto-bumps build number)
cd app && npm run build
# Output: app/dist/VDO.MultiCh.Comms-0.0.1-arm64.dmg

# Run dev (no DMG)
cd app && npx electron .
```

**Run from terminal to see logs:**
```bash
/path/to/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

If the previous DMG is still mounted, eject it first:
```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms 0.0.1" -force
```

---

## Current status

### Working
- First-run setup wizard (event name + line names → deterministic room keys)
- Session export/import (base64 code, Settings panel)
- Per-line QR codes and join links
- Director link per panel (opens in system browser via `shell.openExternal`)
- Device enumeration (CPAL channel count probe)
- VDO.ninja WebContentsView auto-joins rooms silently (`&webcam=1&vd=0&autostart=1`)
- **Inbound audio** (remote participant → Electron app speakers) ✅
- **Outbound audio with system default mic** ✅ (confirmed build 11)
- Shim binary bundled in packaged app via `extraResources` → `Contents/Resources/shim`
- Shim auto-starts on app launch, restarts when Settings device is changed
- macOS TCC microphone permission requested at startup
- Build number in footer (v0.0.1 build N)

### In progress / last known state (build 22)
- **Shim bridge for outbound audio** — the WebSocket connects (`Client connected` logged), binary frame protocol is in place, AudioWorklet is set up. Not yet confirmed audio reaches the phone via the shim path.
- **Device name matching** — bidirectional substring match between Web Audio API names (e.g. "BlackHole 2ch (Virtual)") and CPAL names (e.g. "BlackHole 2ch"). Output device falls back to system default if not found in CPAL enumeration (MacBook Pro Speakers don't appear in CPAL's output list).
- **Channel count** — shim probes actual device channel count via `max_input_channels` / `max_output_channels` (not hardcoded). MacBook Pro Mic probes as 4ch on this machine.

### Known issues / next steps
1. **Confirm shim bridge audio flows** — connect a line, open VDO.ninja DevTools (re-enable `openDevTools` in main.js temporarily), check for `[shim-bridge] ready — channel 0`. Then check director view for non-zero kbps. The device selection layer (per-line channel dropdowns) only works when the shim bridge is active.

2. **Device selection UI uses Web Audio names, not CPAL names** — Settings dropdowns show browser device names. CPAL can find most of them via bidirectional substring match, but edge cases exist. Long-term fix: populate Settings dropdowns from the shim's device list (sent as JSON on WebSocket connect) instead of Web Audio `enumerateDevices()`.

3. **Stutter when audio flows via shim** — observed with default device path. Two fixes already in build 22: (a) binary WebSocket frames instead of JSON (~8× smaller), (b) AudioWorklet 40ms startup buffer before outputting. May need further tuning if still present.

4. **Network service crash loop** — was caused by `lsof -ti tcp:9696` killing Chromium's client socket handles along with the shim. Fixed in build 22 with `-s tcp:LISTEN` flag. Confirm this is stable.

5. **STUN/TURN DNS failures** — cosmetic noise in logs (`errorcode: -105`). WebRTC falls back to host ICE candidates (direct LAN IP). Works on LAN; will not work across NAT without TURN. Not a blocker for controlled event use.

6. **`session.setPreloads` deprecation warning** — should migrate to `session.registerPreloadScript`. Low priority.

---

## Key implementation details

### Shim bridge (main.js `buildShimScript`)
Injected as a preload script (`session.setPreloads`) into each line's WebContentsView with `contextIsolation: false`. Runs before any VDO.ninja page script. Overrides `navigator.mediaDevices.getUserMedia` synchronously via a pending promise (`_streamPromise`). Async init connects to the shim WebSocket; if it fails within 10s, falls back to native `getUserMedia`.

Binary frame format from shim: `[channel_id: u32 LE][samples: f32[] LE]` — parsed in JS as `DataView` + `Float32Array`.

### Shim binary path
```js
app.isPackaged
  ? path.join(process.resourcesPath, 'shim')   // packaged app
  : path.join(__dirname, '..', 'shim', 'target', 'release', 'shim')  // dev
```

### VDO.ninja join URL
```
https://vdo.ninja/?room=ROOMKEY&webcam=1&vd=0&videodevice=0&autostart=1&label=NAME&monomic=1&proaudio=1&noisetgate=0&compressor=0&autoGain=0
```
`&webcam=1` is required for `&autostart=1` to bypass the device selection screen.

### Version / build numbering
- `app/build-meta.json` is the source of truth
- `npm run build` runs `scripts/bump-build.js` first (increments build number)
- Version is manually bumped: 0.0.1 → 0.1.0 for first beta release
- GitHub releases should always bump version

---

## User / environment notes
- Machine: Apple Silicon MacBook Pro (arm64)
- Audio devices: BlackHole 16ch, BlackHole 2ch, MacBook Pro Microphone, NDI Audio, Microsoft Teams Audio, ZoomAudioDevice
- MacBook Pro Speakers are NOT enumerated by CPAL — only accessible via `default_output_device()`; shim falls back to system default when this device name is configured
- App is unsigned — right-click → Open required on first launch on any machine
- macOS TCC microphone permission: granted (prompted on first launch of build 7)
