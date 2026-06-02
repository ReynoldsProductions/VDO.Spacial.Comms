# Known Issues & Status

**Last updated:** 2026-06-02 — build 28

---

## Resolved (build 28)

### Shim → VDO.ninja AudioWorklet bridge
**Fixed.** The bridge is working and stable as of build 28.

Root causes found and fixed during debugging:
- **Shared ring buffer contention** — the renderer's device-enumeration WebSocket connection and the per-line preload's audio WebSocket both connected to port 9696 and competed for the same `HeapConsumer`. The preload was starved of audio frames. Fix: renderer closes its WS immediately after receiving the device list (code 1000).
- **Timer-driven dispatch jitter** — the tokio 10ms interval missed ticks under load, causing burst/drain cycles visible as 3s audio / 3s silence. Fix: replaced with CPAL-event-driven broadcast dispatch. The CPAL callback packs frames and broadcasts directly; no software timer.
- **JS ring buffer too small** — 80ms ring was exhausted by tokio scheduler jitter. Increased to 2s (96000 samples) with 500ms startup hold.
- **DevTools flood** — underrun counter was per-sample (375 messages/sec when empty). Fixed to per-`process()` call.
- **`Fixed(480)` CPAL buffer size** — broke on MacBook Pro Microphone (CoreAudio doesn't honour arbitrary buffer sizes on all devices). Reverted to `Default`; the accumulator + broadcast design makes buffer size irrelevant.

### Network service crash loop
**Fixed (build 22).** `lsof -ti tcp:9696` without `-s tcp:LISTEN` matched Chromium's outbound client connections to port 9696 along with the shim's listen socket, killing the network service. Fixed with `lsof -ti tcp:9696 -s tcp:LISTEN`.

### Mic change not taking effect
**Fixed (build 28).** When the shim restarts after a device change, active lines now automatically reconnect — getting a fresh WebSocket and preload to the new shim instance.

---

## Open

### STUN/TURN DNS failures in logs
`errorcode: -105` from `services/network/p2p/socket_manager.cc` — cosmetic. WebRTC falls back to host ICE candidates (direct LAN IP). Works on LAN without TURN. Will not traverse NAT without a TURN server.

**Workaround for cross-NAT use:** self-host Coturn and configure it in VDO.ninja. See [docs/self-hosting.md](self-hosting.md).

### `session.setPreloads` deprecation warning
Should migrate to `session.registerPreloadScript`. Low priority — `setPreloads` still works in current Electron version.

### App is unsigned
Right-click → Open required on first launch on any macOS machine that hasn't run it before. Gatekeeper will block a normal double-click until the user explicitly allows it.

### Outbound audio path only (shim → VDO.ninja)
The reverse path — inbound audio from remote participants into the shim's playback ring for hardware output — is implemented in the Rust side (`playback_producers`) but not yet wired from the VDO.ninja WebContentsView back to the shim. Remote audio currently plays through Electron's default audio output device.

---

## Working

- First-run setup wizard (event name + line names → permanent room keys)
- Session export / import (base64 code, Settings panel)
- Per-line QR codes and join links (audio-only, `&webcam=1&vd=0&autostart=1`)
- Director link per panel (`&director=ROOMKEY`, opens in system browser)
- Device enumeration (CPAL channel count probe — handles BlackHole-style virtual devices)
- Settings dropdowns populated from shim device list (accurate channel counts)
- Shim auto-starts on app launch, restarts on device change
- Active lines reconnect after shim restart (mic change takes effect without manual reconnect)
- Port 9696 cleanup — only the shim's LISTEN socket is killed, not Chromium client connections
- AudioWorklet bridge: shim audio flows into VDO.ninja without hardware mic
- 2s ring buffer + 500ms startup hold — stable under normal scheduler jitter
- Build number in footer (v0.0.1 build N), auto-incremented on each DMG build
