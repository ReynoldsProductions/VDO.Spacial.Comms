# VDO.Spacial.Comms

> **Early development.** Forked from [VDO.MultiCh.Comms](https://github.com/TomsFaire/VDO.MultiCh.Comms).

Spatial binaural intercom built on [VDO.ninja](https://vdo.ninja). Each party line is positioned in a virtual space — drag it left, right, front, back — and the mix renders binaurally through headphones via Web Audio HRTF. Push-to-talk on one or more lines from a Stream Deck, tablet, or phone. Runs on a Mac mini or Raspberry Pi.

**Interoperates** with VDO.MultiCh.Comms: both apps share the same VDO.ninja room and party lines. A classic hardware-routed operator and a spatial operator can be on the same lines simultaneously.

---

## Status

| Track | Status |
|---|---|
| Binaural PoC (static PannerNodes, HRTF verify) | 🔧 In progress |
| Render Layer (live VDO lines → PannerNodes) | ⏳ Planned |
| Radar UI (draggable spatial positions) | ⏳ Planned |
| Talk-back core (per-channel inputSource, PTT) | ⏳ Planned |
| Control API (HTTP/WebSocket, local) | ⏳ Planned |
| Companion module | ⏳ Planned |
| Presets | ⏳ Planned |
| Direct channels (1:1 private lines) | ⏳ Post-v1 |
| Mobile beltpack web client | ⏳ Post-v1 |
| Discrete multichannel HDMI/MADI backend | ⏳ Post-v1 |

Full architecture: [docs/spatial-architecture.md](docs/spatial-architecture.md)

---

## How it relates to VDO.MultiCh.Comms

VDO.MultiCh.Comms routes each party line to a dedicated hardware output channel via a CoreAudio N-API addon. This fork replaces that output model with a spatial binaural mix — all lines go through Web Audio `PannerNode`s into one stereo headphone output. There is no mode toggle; these are two separate products for different use cases.

The VDO ingestion layer (per-line `WebContentsView` + preload + IPC audio bridge) is inherited unchanged from VDO.MultiCh.Comms and is the shared transport contract. Session export codes (`comms_room` + group names) are compatible between both apps — an operator can share a session code and both clients join the same party lines.

---

## Architecture

```
VDO.ninja (WebRTC, per-line group)
  → WebContentsView + preload (IPC audio-frame, inherited from VDO.MultiCh.Comms)
  → Main process IPC relay
  → Spatial Mixer (main renderer, Web Audio)
      PannerNode[line0] ──┐
      PannerNode[line1] ──┼── AudioContext.destination → headphones
      PannerNode[lineN] ──┘

Operator mic (getUserMedia or dedicated CoreAudio input)
  → transmittingChannels gate (PTT / latch)
  → VDO.ninja push (per active line's group)

Control API (local HTTP/WebSocket, inside Electron)
  ← Bitfocus Companion module
  ← Tablet / phone browser (Companion web-buttons panel, Day 1)
```

Full detail: [docs/spatial-architecture.md](docs/spatial-architecture.md)

---

## For developers

### Prerequisites

- Node.js 18+
- macOS (Apple Silicon) or Raspberry Pi OS / Debian arm64 — both supported
- CoreAudio native addon is **optional** — the app starts without it on Linux; used only for dedicated-input channels on macOS

### Dev run

```bash
cd app
npm install
npm start
```

On macOS, if you want dedicated hardware input channels, build the native addon first:
```bash
cd app/native && npm install && npm run build
```

### Binaural PoC (no Electron needed)

Open `test/binaural-poc.html` in any browser with headphones. Confirms HRTF rendering works on the target platform before wiring into Electron.

### Config

`~/.vdo-multichan/config.json` — same format as VDO.MultiCh.Comms, with additional optional spatial fields:

```json
{
  "comms_room": "my-event",
  "lines": [
    {
      "id": 0, "name": "PL1", "group": "pl1",
      "azimuth": -45, "volume": 1.0, "listening": true,
      "inputSource": "sharedMic"
    }
  ]
}
```

New fields default gracefully — a config saved by VDO.MultiCh.Comms loads and works without migration.

---

### Documentation

| Doc | Contents |
|-----|----------|
| [docs/spatial-architecture.md](docs/spatial-architecture.md) | Full design: architecture, phases, data model, compatibility |
| [docs/usage.md](docs/usage.md) | End-user guide (inherited from VDO.MultiCh.Comms, will be updated) |
| [docs/development.md](docs/development.md) | Build from source, CI |
| [docs/self-hosting.md](docs/self-hosting.md) | VDO.ninja self-hosting, TURN |
