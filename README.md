# VDO.MultiCh.Comms

> **Alpha — v0.0.1 build 28.** Not production-ready. Expect rough edges.

Multi-channel IP intercom built on [VDO.ninja](https://vdo.ninja) (WebRTC) and CPAL hardware audio I/O. Designed for live production environments where you need independent party lines routed to a multi-channel audio interface — without managing a custom UDP transport stack.

4 independent party lines. Remote participants join from any mobile browser via a QR code — no app install required.

---

## How it works

```
Hardware mic / BlackHole
  → Rust shim (CPAL, per-channel capture)
  → WebSocket ws://127.0.0.1:9696
  → Electron WebContentsView preload (AudioWorklet bridge)
  → VDO.ninja getUserMedia override
  → WebRTC → remote participants (phone, web browser)
```

The **Rust shim** handles hardware audio I/O. It captures from a physical or virtual audio interface, accumulates per-channel PCM frames, and broadcasts them over a local WebSocket the moment each frame is ready — clocked by the hardware audio callback, not a software timer.

The **Electron app** embeds one VDO.ninja room per party line in a hidden `WebContentsView`. A per-line preload script intercepts `getUserMedia` and feeds the shim's audio stream into VDO.ninja instead of the hardware mic. VDO.ninja handles WebRTC, NAT traversal, codec negotiation, and mixing.

Remote participants scan a QR code and join from any device — no install required.

---

## Status

| Feature | Status |
|---|---|
| First-run setup wizard (event name + line naming) | ✅ Done |
| Session export / import (base64 code) | ✅ Done |
| Per-line QR codes and join links | ✅ Done |
| Director link per panel | ✅ Done |
| VDO.ninja WebContentsView auto-join (silent, audio-only) | ✅ Done |
| Rust shim — CPAL capture + playback | ✅ Done |
| Shim → VDO.ninja AudioWorklet bridge | ✅ Working (build 28) |
| Hardware-clocked broadcast dispatch (no timer drift) | ✅ Done (build 28) |
| Mic change reconnects active lines automatically | ✅ Done (build 28) |
| Port 9696 crash-loop fix (`lsof -s tcp:LISTEN`) | ✅ Fixed (build 22) |
| Device enumeration from shim (CPAL channel counts) | ✅ Done |
| Build number auto-bump + DMG packaging | ✅ Done |
| macOS TCC microphone permission | ✅ Done |
| Inbound audio (remote → local speakers) | ✅ Done |
| Outbound audio via shim bridge | ✅ Stable (build 28) |
| STUN/TURN (cross-NAT) | ⏳ LAN only for now |
| Code signing | ⏳ Post-alpha |
| `session.setPreloads` → `registerPreloadScript` | ⏳ Low priority |

---

## Prerequisites

- macOS (Apple Silicon — arm64 DMG)
- [Rust](https://rustup.rs) (stable) — to build the shim from source
- Node.js 18+ — to build the Electron app
- A multi-channel audio interface (e.g. BlackHole, Focusrite), or use the Mac's built-in mic

---

## Getting started

### 1. Build the Rust audio shim

```bash
cd shim
cargo build --release
```

### 2. Install and launch the Electron app (dev)

```bash
cd app
npm install
npm start
```

The app spawns the shim automatically on startup. Config lives at `~/.vdo-multichan/config.json` and is created on first run.

### 3. Build a distributable DMG

```bash
cd shim && cargo build --release
cd ../app && npm run build
# Output: app/dist/VDO.MultiCh.Comms-0.0.1-arm64.dmg
```

The app is unsigned — right-click → Open on first launch on any machine.

---

## Configuration

`~/.vdo-multichan/config.json` — written by the app UI, editable manually.

```json
{
  "instance_name": "faire-2026",
  "vdo_base_url": "https://vdo.ninja",
  "input_device": "BlackHole 2ch",
  "output_device": "",
  "sample_rate": 48000,
  "lines": [
    { "id": 0, "name": "PL1", "room_key": "pl1abc123", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 1, "name": "PL2", "room_key": "pl2def456", "input_channel": 1, "output_channel": 1, "gain_in": 1.0, "gain_out": 1.0 }
  ]
}
```

Room keys are permanent — derived from line names at first-run setup. Renaming a line in settings does not change its room key.

---

## Joining a party line

Each line panel shows a QR code and a copy-link button. Remote participants:

1. Scan the QR code or open the link on any device
2. Allow microphone access when prompted
3. They're in — no install, no account

---

## Architecture notes

### Shim broadcast dispatch

The CPAL input callback accumulates interleaved samples into pre-allocated per-channel buffers. When a full `FRAME_SIZE` (480 samples = 10ms @ 48kHz) is ready, it packs a multi-channel binary packet and sends via `tokio::sync::broadcast`. Each WebSocket client has its own independent receiver — no shared consumer contention.

Packet format: `[ch: u32 LE][n_samples: u32 LE][samples: f32[] LE]` × N channels.

### AudioWorklet bridge

Each VDO.ninja `WebContentsView` gets a per-line preload script loaded via `session.setPreloads`. The preload overrides `navigator.mediaDevices.getUserMedia` synchronously before any VDO.ninja JS runs. On async init it opens `ws://127.0.0.1:9696`, feeds matching-channel frames into an `AudioWorkletNode` ring buffer (2s capacity, 500ms startup hold), and resolves `getUserMedia` with the `MediaStreamDestinationNode` stream. Falls back to native mic if the shim is unavailable within 10s.

### Mic change reconnect

When the user saves a new input device, the shim restarts. The app tracks `lineConfigs` (url + channelId per active line) and reconnects all open lines 1s after the new shim starts, giving each preload a fresh WebSocket to the new shim instance.

---

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md) for running your own VDO.ninja instance and TURN server.

---

## Known issues

See [docs/known-issues.md](docs/known-issues.md).

---

## Contributing

Alpha-stage project. Issues and PRs welcome.
