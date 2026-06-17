# Spatial Intercom — Project Plan

## Vision
A spatial intercom mix built directly on top of the existing `VDO.MultiCh.Comms` foundation. Each VDO-sourced party line gets rendered into a shared spatial mix instead of getting its own dedicated output channel; operators drag each line's position around a virtual "space" to place it left/right/front/back. The same spatial position data drives more than one render target over time: binaural stereo for personal headphone use first, with discrete multichannel HDMI output for fixed control-room/mixing-booth installs as a near-term follow-on (riding existing video-router infrastructure, de-embedded downstream via MADI into the room's actual audio domain). Talk-back is a first-class part of this, not an afterthought: operators select one or more lines and push-to-talk, the same way a real intercom beltpack works, with the control surface itself varying by who's using it — Stream Deck/Companion in a studio, a tablet or phone web GUI for mobile/remote use.

## Architecture Decision
Resolved: build this as an extension of `VDO.MultiCh.Comms` rather than a separate native engine. VDO ingestion — WebRTC decode, per-line IPC — stays exactly where it already lives. What's new is a spatial render stage, a talk-back/mic layer, and a control API, all sitting on top of that existing foundation.

## Compatibility with VDO.MultiCh.Comms
This needs to stay a mode, not a replacement — "normal" `VDO.MultiCh.Comms` users shouldn't lose anything they have today. Two places in this plan are genuine breaking changes if not handled carefully, both worth calling out explicitly rather than assuming they're purely additive:

- **Output routing.** Today, each party line routes 1:1 to its own dedicated hardware output channel — that's the core of what the existing app does. The Spatial Mix Bus design replaces that with everything summing into one shared output (binaural now, discrete multichannel HDMI later). These are mutually exclusive models. **Required change:** add an explicit Output Mode setting — *Classic* (today's per-line dedicated routing, byte-for-byte unchanged) vs. *Spatial* (shared mix bus) — rather than removing the existing behavior.
- **Input/talk routing — correction from earlier framing.** This isn't actually a global mode split the way output is. Whether a channel's audio comes from a dedicated hardware input (today's existing per-line model, untouched) or from the shared operator mic gated by talk-press depends on the channel and the use case, and both can coexist in the same running app: a sound op might wire their program mix straight into a "PGM" channel as a continuous dedicated feed for everyone to monitor, while using the shared mic for ordinary back-and-forth on other channels. **Required change:** add a per-channel `inputSource` property (`dedicated` | `sharedMic`) rather than a global toggle — `dedicated` channels reuse today's existing per-line input config exactly as-is, no talk button at all since they're always live; `sharedMic` channels use the new `transmittingChannels` gating. Mobile/touchscreen users only ever have `sharedMic` channels, since a phone has exactly one mic.
- **`config.json` schema.** Gains new optional fields (an `outputMode` flag; per-line `type`, `positionMode`, `azimuth`, `volume`, `listening`). These need sensible defaults so a config saved by today's normal app still loads and behaves identically — no forced migration, no breaking change to the existing schema.
- **Settings UI.** Gains a mode toggle. The existing per-line In/Out device and channel fields stay exactly as they are today and remain the active configuration surface specifically when Classic mode is selected; Spatial-mode-specific fields (azimuth, volume, listening) only appear when that mode is active.
- **Native CoreAudio addon — likely untouched for v1.** Spatial mode's binaural output goes through standard Web Audio (`AudioContext.destination`), bypassing the custom native addon entirely rather than modifying it; Classic mode continues using it exactly as today. Worth confirming this holds once implementation starts, but it's the current expectation and keeps the blast radius small.
- **Process note:** keep Classic-mode code paths as close to upstream as practical (minimize intertwining with new Spatial-mode logic) so future fixes/improvements to "normal" `VDO.MultiCh.Comms` stay easy to pull in, whether this lives as a real git fork or a clearly separated branch.

## Use Cases
- **Personal/mobile binaural** — operator wearing headphones, no installed infrastructure. The fastest path to prove out, and the v1 render target.
- **Fixed control room / mixing booth** — the same spatial mix embedded as discrete multichannel audio into HDMI, riding the room's existing video router/matrix instead of needing its own cable run, then de-embedded downstream (often via MADI) into whatever the room's actual audio domain is — a console, a Dante network, etc. Also the natural seam for splitting channels out to other hardware later.
- **Studio talk control** — a Stream Deck driven by Bitfocus Companion, one button per channel. Press-and-hold a channel's button to talk on it, the same muscle memory as a real beltpack key panel; hold several at once to talk on multiple lines simultaneously.
- **Mixing-room touchscreen control** — a tablet or phone kept within arm's reach, controlling the *same* session that's actually doing audio I/O on a separate machine (the Pi/Mac mini). Day 1 is Companion's own browser-based panel, already covering this for free; a dedicated custom control web UI is a Day 2 follow-on.
- **Mobile beltpack replacement (other participants)** — a separate self-contained mobile web client for *other* people — crew, talent, anyone who'd otherwise wear a hardware beltpack — joining directly from their own phone, not necessarily on the same network as anyone else. Distinct audience and architecture from the touchscreen control surface above; see the dedicated section below.

## Known Limitations
- **Scaling is bound by participants, not party lines.** VDO.ninja's groups (our party lines) are just a lightweight label — no inherent cap on how many you define. The real ceiling is total participants/peers in the room: Chrome caps WebRTC connections around 128 peers, but CPU/bandwidth on the host and guests' machines becomes the practical bottleneck well before that — roughly 30 people comfortably, more or less depending on hardware and connection quality. Plan capacity around expected participant count, not party line count. PoC target is 4–5 participants; the real-world use case target is 10–12 — both comfortably inside that ~30-person ceiling, no special mitigations (`&broadcast`, disabled previews, `roombitrate=0`) needed at either size.
- **Spatial granularity is per-party-line, not per-individual-participant — for now.** If three people are talking in "Main PL," all three are heard from wherever "Main PL" is positioned; there's currently no way to place two people in the same PL on opposite sides. This is a choice in how our own capture shim works today (it sums every peer in a group into one stream before tapping it), not a VDO.ninja protocol limit — group members are actually separate peer connections under the hood. Tapping per-peer instead of per-group would unlock true per-person positioning later without any upstream change needed; not in scope for v1, but a real future option rather than a dead end.

## Goals (v1)
- Source: VDO.ninja party lines only, via the existing `VDO.MultiCh.Comms` pipeline. Analog hardware, SIP, and Dante are later phases — see Roadmap.
- Listen: a single binaural stereo mix via Web Audio `PannerNode`s, one per active line, sharing one spatial position model that's designed to support additional render backends (HDMI/discrete multichannel) without rearchitecting later.
- Talk: push-to-talk to one or more selected lines, controllable from a Stream Deck (via Companion) or a tablet/mobile web GUI, both talking to one local Control API.
- Initial hardware: Raspberry Pi or Mac mini for the binaural render; standard headphone/line-out, no AVR or HDMI multichannel requirement yet.

## Non-Goals (v1)
- Analog hardware capture, SIP, Dante/AES67 sourcing (deferred — see Roadmap).
- Actually shipping the discrete multichannel HDMI render backend (deferred — but the Render Layer must be built pluggable from day one so this doesn't require a rewrite when it's added).
- A custom/measured HRTF dataset — Chromium's built-in HRTF panner is the v1 bar.
- Elevation — azimuth only for v1; a Day 2 follow-on (see Roadmap).
- Any custom mobile/touchscreen web UI — v1's touchscreen control need is met by Companion's existing panel; both a dedicated control UI and the Mobile Beltpack rendering client are Day 2/roadmap items.
- Breaking Classic mode — existing per-line dedicated input/output routing must keep working unchanged; see Compatibility with VDO.MultiCh.Comms.

## Tech Stack
- Electron (the existing `VDO.MultiCh.Comms` app) — extend rather than replace.
- Web Audio API's `PannerNode` (`panningModel: 'HRTF'`) for binaural rendering — real 3D placement via Chromium's built-in HRTF convolution, no custom DSP needed for v1.
- A lightweight local Control API (HTTP/WebSocket server inside the Electron app) for talk-back, consumed by both a Companion module and the tablet/mobile web GUI — one talk engine, multiple control surfaces.
- Native audio I/O: existing CoreAudio N-API addon continues handling capture and the operator's mic as today. A discrete multichannel output backend (ALSA/PipeWire on Pi, CoreAudio multichannel on Mac) is real future native work, not needed for v1's stereo-only output.

## Architecture

### 1. Source Layer (unchanged from `VDO.MultiCh.Comms`)
- Per-line VDO.ninja group, WebRTC decode, AudioWorklet capture — exactly as it works today. Capture is at the group level (everyone in a PL summed into one stream); see Known Limitations for what that does and doesn't allow.

### 2. Render Layer (pluggable, shared spatial model)
- **Binaural backend (v1):** each active line feeds its own `PannerNode` (HRTF mode) positioned by its azimuth/elevation; all connect to one `AudioContext.destination`. Output is plain stereo to whatever default device the OS provides.
- **Discrete multichannel HDMI backend (near-term follow-on, not v1):** the same per-line azimuth data drives a speaker-panning law (ITU 5.1 or VBAP) into a shared N-channel buffer, pushed to a native multichannel output device routed over HDMI. Built once the binaural path is proven; the Render Layer's interface should be designed now so this slots in without touching the spatial data model or UI.

### 3. Spatial Data Model
- Each channel (party line or Direct): id, label, type, positionMode, azimuth, elevation (Day 2, not v1 — see Roadmap), volume (gain, default unity), listening (boolean, default true — whether this channel's audio is currently included in the mix at all, independent of volume), inputSource (`dedicated` | `sharedMic` — see Talk-Back layer below).

### 4. Talk-Back / Mic Capture Layer (new)
- Per-channel `inputSource`, not a global setting:
  - **`dedicated`** — exactly today's existing per-line hardware input (its own device/channel config), continuously live, no talk button at all. Example: a sound op routes their program mix straight into a "PGM" channel as a standing feed everyone else can monitor — that's a `dedicated` channel from the sound op's side, an ordinary listenable channel for everyone else.
  - **`sharedMic`** — one shared operator mic, dynamically gated by talk-press. The same sound op uses this for ordinary back-and-forth on other channels, separate from their PGM feed. Mobile/touchscreen users only ever have `sharedMic` channels, since a phone has exactly one mic.
- Core primitive for `sharedMic` channels: `transmittingChannels` — the live set of channels currently receiving the operator's mic audio. The actual mic-routing logic is simple regardless of control surface: publish live mic frames into the VDO.ninja group for every channel currently in `transmittingChannels`, mute otherwise.
- Two control-surface mappings onto that one primitive:
  - **Studio (Stream Deck/Companion):** each channel button supports both latch and momentary PTT from the same physical button, split by press duration — short press (released before 500ms) toggles a persistent `latched` flag for that channel; holding past 500ms starts momentary PTT (`longPressActive`) for as long as it's held, independent of the latch state, reverting to whatever the latch state was on release. A channel is in `transmittingChannels` whenever `latched OR longPressActive` is true. This timing logic lives in the Control API itself, not in Companion — Companion's job is just to relay raw button-down/button-up per channel; the 500ms classification happens once, centrally, so the same logic would work unchanged for any other future studio control surface (footswitch, MIDI controller, etc.).
  - **Touchscreen control surface (tablet/phone in the mixing room):** the same per-channel short/long-press model as Studio above, driving the same `transmittingChannels` primitive — one consistent gesture across every control surface rather than a separate "arm then global PTT" pattern.

### 5. Control API (new)
- Local HTTP/WebSocket server inside the app exposing, per channel (party line or Direct): talk PTT down/up, listen enable/disable, set volume, set/adjust azimuth (and elevation later) — plus live status for whether you're transmitting, whether you're listening, and whether the channel is currently active (someone else talking on it).
- Also exposes preset operations: list saved presets, save the current layout as a named preset, recall a named preset.
- That last one needs a small new piece: a lightweight level/VAD tap per channel (reusing the level-metering approach already in `VDO.MultiCh.Comms` today) crossing a threshold to produce a simple "is this channel active right now" boolean — the actual signal a Companion light reflects.
- Consumed by a custom Bitfocus Companion module and the tablet/mobile web GUI — one API, multiple control surfaces.

### 6. Control Surfaces (Companion + Touchscreen)
One action/feedback spec, expressed through Companion — including the touchscreen need for Day 1. Companion already ships its own browser-based virtual panel ("web buttons") mirroring whatever the module defines, live feedback colors included, reachable from any tablet or phone browser pointed at the Companion host. That covers "control buttons near my hands in a mixing room" with zero additional engineering once the module exists — no separate custom touchscreen page needed for Day 1.
- **Actions**, per channel (party line or Direct): Talk (PTT down/up, using the existing short/long-press latch logic), Listen on/off, Set Volume, Pan as an incremental nudge (step left/right by a fixed amount, with continuous adjustment via a rotary encoder as a nicer option on Stream Deck+), and Recall Preset (a dropdown of saved preset names, applying that preset's full layout in one step).
- **Feedbacks**, per channel: lit when the channel is currently active (someone talking on it), a distinct state for when *you* are transmitting on it, a distinct state for whether you're currently listening to it, and optionally which preset (if any) matches the currently active layout.
- **Companion module:** custom from the start, not generic HTTP actions — this surface is more than a couple of generic calls can express cleanly.
- **Day 1 touchscreen:** Companion's own web-buttons panel, as above — this resolves the earlier open question about whether the touchscreen surface needs a read-only spatial view; for Day 1 it doesn't, since it's just mirroring the same button grid Companion already provides.
- **Day 2 (see Roadmap):** a dedicated, purpose-built control web UI beyond Companion's generic panel — the natural place to revisit a read-only spatial layout view, larger touch targets, or anything else Companion's panel can't express.

### 7. UI Layer
- Radar (or sphere, once elevation is added) view, listener at center, each party line draggable by position; dragging updates that line's `PannerNode` live, no apply step.
- Also needs to surface live talk state — which lines are currently receiving mic audio — visually, not just position.
- Party lines and Direct channels need clearly distinct icon treatment, not just "draggable vs. not": e.g. PLs as a round, freely-draggable marker; Direct channels as a smaller pinned/person-style marker fixed to its slot, so a stationary PL can't be mistaken for a Direct channel at a glance. Worth treating as a starting point to refine once it's actually on screen, not a final spec.

### 8. Persistence
- Named presets, each a snapshot of every channel's azimuth, volume, and listening state (talk/PTT state isn't part of a preset — that's session-level, not layout).
- Stored locally inside the app (a JSON file alongside the existing `~/.vdo-multichan/config.json`-style local config, not synced anywhere).
- Recallable two ways: from the radar UI directly, and from Companion via a dedicated action (see Companion Module).

## Platform Notes
- **Mac mini & Raspberry Pi:** both trivially support standard stereo audio out for the v1 binaural render — no platform-specific output work needed yet.
- **Pi target:** Pi 4 or Pi 5, running Raspberry Pi OS — not locked to one specific model. This matters once the discrete multichannel HDMI backend gets built: Pi 4 and Pi 5 use different HDMI/audio hardware paths (Pi 5's RP1 I/O chip vs. Pi 4's VC4-based path), so the HDMI multichannel de-risking test needs to run on both rather than assuming one result generalizes to the other.
- **Debian-based SBC, generally:** the eventual native Linux work (ALSA/PipeWire output backend, packaging) should follow standard Debian/ALSA conventions rather than Pi-specific tooling where possible, so it isn't locked to Raspberry Pi specifically. That said, the lowest-level HDMI/audio quirks (`config.txt`, board-specific drivers) are inherently hardware-specific — porting to a different Debian SBC later would still need its own from-scratch verification, not just a recompile.
- **Mobile, later:** keeping the Render Layer's logic platform-agnostic now (not leaning on anything Electron-specific in the `PannerNode`/`AudioContext` code) keeps the door open for the Mobile Beltpack UX, which renders its own binaural mix independently of the desktop app.

## Phased Build Plan
1. **Phase 0 — Binaural proof of concept.** Two or three static `PannerNode`s at different azimuths, confirm by ear (real headphones, both target platforms) that left/right/front/back are actually distinguishable.
2. **Phase 1 — Wire it to live VDO lines.** Add the Output Mode setting first (Classic vs. Spatial), then replace per-line dedicated output routing with the `PannerNode` render layer *only* when Spatial mode is active — Classic mode's existing routing stays untouched. Static azimuths to start.
3. **Phase 2 — Radar UI.** Add the draggable position UI, wire live azimuth changes into each line's `PannerNode`.
4. **Phase 3 — Talk-back core.** The per-channel `inputSource` model (`dedicated` reusing today's existing input config, `sharedMic` for the new gated model), the `transmittingChannels` primitive, and the Control API — testable via raw HTTP calls before any control surface exists.
5. **Phase 4 — Control surfaces.** The custom Companion module (Talk/Listen/Volume/Pan/Recall-Preset actions, activity/transmitting/listening feedbacks) against the Control API — Companion's own web-buttons panel covers the touchscreen need for free, no separate build required here.
6. **Phase 5 — Presets and polish**, including live talk-state indicators in the UI and Companion Feedbacks.
7. **Later — Roadmap items** (below): discrete multichannel HDMI/MADI backend, analog hardware input, SIP, Dante/AES67, full mobile rendering app, other hardware platforms.

## Execution Strategy: Branching, Parallel Agents & Models
**Branch, not a fork.** Work on a branch within the existing `VDO.MultiCh.Comms` repo (e.g. `spatial-intercom`) rather than a separate repo — the Compatibility design above only holds together if Spatial mode can realistically merge back as an option alongside Classic. A hard fork is worth revisiting later if this ever needs to be distributed as a fully separate project, but isn't the starting assumption.

**One sync point before splitting up:** agree the shared channel data model (id, label, type, positionMode, azimuth, volume, listening, inputSource) first — every track below builds on it, so getting it stable before parallel work starts avoids rework.

**Parallel tracks**, each independent enough to run on its own agent/branch with a defined merge point:
- **Track A — Core Listen Pipeline** (sequential within itself): Output Mode setting → binaural proof of concept → Render Layer → Radar UI.
- **Track B — Core Talk Pipeline** (independent of A until final integration, since talk and listen are mostly orthogonal subsystems): the `inputSource`/`transmittingChannels` model → Control API → Companion module.
- **Track C — Presets:** light dependency on the shared data model only, otherwise standalone.
- **Track D — Mobile Beltpack:** fully independent, separate codebase entirely, can start day one alongside everything else.
- **Track E — Direct Channels:** depends on A and B reaching a stable v1, since it reuses both the render and talk primitives.
- **Track F — Roadmap items**, each independent of the others, all gated on v1 (A+B+C) shipping: HDMI/MADI backend, SIP, Dante/AES67, Elevation, dedicated touchscreen UI, analog hardware input — good candidates to fan out across several agents simultaneously once v1 is done.

**Model per piece** — defaulting to the cheapest tier the risk profile allows, reserving the most capable model for the places mistakes are genuinely hard to debug or compatibility-sensitive:
- Output Mode setting (config schema + settings toggle): mid-tier — mechanical, but touches existing config loading that must stay backward-compatible, so care matters more than raw difficulty.
- Binaural proof of concept: cheapest tier — small, disposable test, easy to verify by ear regardless of code quality.
- Render Layer (wiring `PannerNode` into the existing real-time audio/IPC pipeline): most capable tier — real-time audio thread safety is the most failure-prone area flagged repeatedly in this plan; bugs here are quiet and hard to debug.
- Radar UI: cheapest tier — visual/frontend work, low blast radius, easy to iterate.
- Talk-Back layer (`inputSource` branching, short/long-press classification): mid-tier — compatibility-sensitive (must not disturb existing dedicated-input behavior) plus real timing logic.
- Control API: cheapest tier — once the primitives it wraps exist, this is mostly mechanical REST/WebSocket plumbing.
- Companion module: cheapest-to-mid tier — glue code against a documented Companion SDK and our own API contract.
- Presets: cheapest tier — simple JSON read/write/recall.
- Direct Channels (provisioning, on-demand WebRTC spin-up/tear-down, signaling): most capable tier — the trickiest new subsystem in this plan, genuine connection-lifecycle/state-machine risk.
- Mobile Beltpack: mid-tier overall (fresh codebase reimplementing Render+Talk concepts independently); its simpler UI pieces could drop to the cheapest tier.
- HDMI/MADI native backend (ALSA/CoreAudio multichannel): most capable tier — low-level, hardware-specific, hard to iterate without real hardware in the loop.
- SIP and Dante/AES67 integrations: mid-tier — real protocol complexity, but well-trodden ground with mature libraries.
- Elevation, dedicated touchscreen UI (Day 2 items): cheapest tier — mechanical extensions of already-proven patterns.
- Analog hardware input: mid-tier — native audio device handling, moderate risk.

## Open Questions
- Where should the Mobile Beltpack static page actually be hosted — alongside a self-hosted VDO.ninja instance, or separately?
- Should Mobile Beltpack users also get the roster/Direct-line-request flow, or is requesting a Direct line desktop-only for now?

## Risks
- Control-surface-to-mic-gate latency (Stream Deck → Companion → Control API → mic gate) is a new round trip worth measuring early — PTT responsiveness matters for usability even if the absolute delay is small.
- Chromium's built-in HRTF is generic, not personalized per listener — front-back confusion is a known general limitation of any non-personalized binaural system. Fine for distinguishing simultaneous talkers, not guaranteed for every listener's localization.
- Real-time position updates (dragging) need to update `PannerNode` parameters smoothly (e.g. `setTargetAtTime`) to avoid clicks/jumps.
- Need to confirm exactly how decoded VDO audio currently reaches the renderer process in `VDO.MultiCh.Comms` (today tapped from muted media elements via IPC) — both the binaural render layer and the talk-back mic layer need to hook into that same pipeline cleanly.

## Direct Channels (User-to-User)
A Direct channel is a private 1:1 audio path between two specific operators, alongside (not instead of) party lines — e.g. a director's dedicated line to the TD, or an A2's dedicated line to the sound mixer.

- **Concept:** the channel model generalizes to `type: 'partyline' | 'direct'` and `positionMode: 'free' | 'fixed'`. A Direct channel is, under the hood, the same VDO.ninja group mechanism as a PL — just scoped to exactly two members — with a pinned position instead of a draggable one.
- **Listen/render:** identical pipeline to PLs — same capture, same `PannerNode` feeding the same `AudioContext.destination`. The only difference is the radar UI doesn't let a Direct channel be dragged, and should render it with a distinct (pinned) visual treatment so it isn't mistaken for an un-moved PL.
- **Talk:** same `transmittingChannels` primitive as PLs — a Direct channel just gets its own button on whichever control surface (Stream Deck/Companion or mobile), sharing the same button budget as party lines.
- **Identity:** each operator sets a display name at first launch (extending the existing setup wizard), editable later from a Settings page. For the actual deterministic group-name derivation, generate a separate, immutable ID behind the scenes at first launch too — the hash should be based on that hidden stable ID, not the editable display name, so renaming later doesn't orphan existing Direct-channel pairings.
- **Roster/discovery:** a browse UI showing who's currently online, fed by the same lightweight signaling/presence layer used for the request itself — pick a target from that list rather than needing to pre-know an identifier.
- **Provisioning flow:** request and acceptance travel over the signaling connection each operator's instance already maintains (no new server needed); once requested, both sides derive the same private group name deterministically from both operators' stable IDs rather than transmitting one. No explicit accept step on the receiving end — a request just establishes the line directly, the same way the "ring" itself works.
- **Connection model — on-demand, not standing.** The lightweight VDO.ninja signaling connection is what stays "always on" (it's already required for presence regardless); the actual WebRTC audio peer connection for a Direct channel only spins up when someone presses their direct-talk button: a small "ring" message goes out over signaling, both sides establish the real connection, audio starts once it's up, and after an idle-grace window post-release it tears back down — defaulting to 30 seconds, exposed as a user-configurable setting. This avoids the CPU/bandwidth cost of standing connections, which matters on Pi-class hardware — traded against a real, if small, connection-setup delay on first press (more noticeable over WAN/NAT than on a local network).

## Mobile Beltpack UX (Remote Participants)
A self-contained mobile web client replacing today's stock VDO.ninja `/comms` page — small, ambiguously-gestured tiles, a tiny "listen" eye icon, no activity feedback, no spatial positioning — with something purpose-built for whoever would otherwise be wearing a hardware beltpack: talent, crew, anyone joining from their own phone.

- **Per channel (PL or Direct) the user has access to:**
  - A clear, separate Listen toggle (on/off), independent of talk.
  - Talk using the same short/long-press model as every other surface in this plan: short press toggles latch, holding past 500ms is momentary PTT. One consistent gesture everywhere rather than a phone-specific pattern.
  - A "someone's talking on this channel" indicator — the same activity/level-detection concept as the Companion feedback.
  - Retained panning — each user drags their own channels around their own binaural mix, same `PannerNode`-per-channel model as the desktop app, rendered locally for that one phone's hearing, not the operator's.
- **Architecture — separate from the Control API, not routed through it.** This client connects directly to VDO.ninja the same way the stock comms page does today: its own WebRTC connections, its own local Web Audio graph for binaural rendering, its own local talk/activity state. It has no reason to talk to the Electron app's Control API — that API is specifically for controlling the operator's own session, a different audience entirely.
- **Audio I/O:** standard browser input/output — wired headset or Bluetooth, whatever the phone currently has selected. No native code needed; this is exactly the case Web Audio + WebRTC already handle natively on mobile browsers.
- **Delivery:** a small standalone static web app, PWA-installable for an app-like home-screen icon, no app store involved. `VDO.MultiCh.Comms` already generates a join link/QR pointing at the stock comms page for exactly this purpose — same mechanism, just retargeted at this purpose-built page instead.

## Roadmap Beyond v1
- **Direct channels (user-to-user)** — see dedicated section above; private, pinned-position lines between two specific operators, on-demand connection.
- **Discrete multichannel HDMI/MADI render backend** — the control-room/mixing-booth target described above; second renderer off the same spatial model.
- **Analog hardware input** — direct multichannel capture from a hardware audio interface, feeding the same render layer as another source type.
- **Day 2 — Elevation** — add elevation on top of azimuth in the spatial data model, render layer, and UI (a sphere/dome instead of a flat ring).
- **Day 2 — SIP** — register as a SIP extension against RTS, Clear-Com, or Riedel's SIP bridges (PJSIP/drachtio/sip.js), feeding the same render layer.
- **Day 2 — Dedicated touchscreen control UI** — a purpose-built control web page beyond Companion's generic web-buttons panel; candidate place for a read-only spatial layout view, larger touch targets, anything Companion's panel can't express.
- **Later — Dante/AES67** — Dante Virtual Soundcard (or AES67) as another input device option; the highest-fidelity, most universal way to tap real intercom systems.
- **Mobile beltpack UX** — see dedicated section above; a separate self-contained client for other participants, full design already specified, build sequencing still post-v1.
- **Later — other hardware platforms** — once the Pi/Mac mini software path is proven.
