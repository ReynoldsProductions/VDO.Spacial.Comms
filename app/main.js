const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');

function buildShimScript(channelId) {
  return `
(function() {
  const CHANNEL_ID = ${channelId};
  const SAMPLE_RATE = 48000;

  // Promise that resolves to the shim MediaStream, or null if unavailable.
  // Created synchronously so the getUserMedia override can await it even if
  // VDO.ninja calls getUserMedia before async init finishes.
  let _resolveStream;
  const _streamPromise = new Promise(r => { _resolveStream = r; });

  // Override installed synchronously — guaranteed to be in place before any
  // VDO.ninja script runs because this is a preload.
  const _origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.audio) {
      const stream = await _streamPromise;
      if (stream) return stream;
    }
    return _origGUM(constraints);
  };

  // Async init — resolves _streamPromise when ready (or null on failure).
  (async function() {
    try {
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await audioCtx.resume();

      const processorSrc = \`
        class ShimProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._q = [];
            this._ready = false; // hold until we have 2 frames buffered (40ms)
            this.port.onmessage = (e) => {
              for (let i = 0; i < e.data.length; i++) this._q.push(e.data[i]);
              if (!this._ready && this._q.length >= 960) this._ready = true;
            };
          }
          process(inputs, outputs) {
            const out = outputs[0][0];
            if (!this._ready) { out.fill(0); return true; }
            for (let i = 0; i < out.length; i++) out[i] = this._q.length ? this._q.shift() : 0;
            return true;
          }
        }
        registerProcessor('shim-proc', ShimProcessor);
      \`;
      const blobUrl = URL.createObjectURL(new Blob([processorSrc], { type: 'application/javascript' }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const node = new AudioWorkletNode(audioCtx, 'shim-proc', { outputChannelCount: [1] });
      const dest = audioCtx.createMediaStreamDestination();
      node.connect(dest);

      // Connect to shim — 10s timeout then fall back to native mic
      const ws = new WebSocket('ws://127.0.0.1:9696');
      const ok = await new Promise(resolve => {
        const t = setTimeout(() => { ws.close(); resolve(false); }, 10000);
        ws.addEventListener('open', () => { clearTimeout(t); resolve(true); });
        ws.addEventListener('error', () => { clearTimeout(t); resolve(false); });
      });

      if (!ok) {
        console.warn('[shim-bridge] unavailable — falling back to native mic (channel ${channelId})');
        _resolveStream(null);
        return;
      }

      ws.binaryType = 'arraybuffer';
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          const view = new DataView(e.data);
          const channelId = view.getUint32(0, true);
          if (channelId === CHANNEL_ID) {
            const samples = new Float32Array(e.data, 4);
            node.port.postMessage(samples);
          }
        } else {
          // text frames are JSON control messages (device list etc.) — ignore for audio
        }
      };

      console.log('[shim-bridge] ready — channel', CHANNEL_ID);
      _resolveStream(dest.stream);
    } catch (err) {
      console.error('[shim-bridge] init failed:', err.message);
      _resolveStream(null);
    }
  })();
})();
`;
}
// In a packaged app the shim lands in Contents/Resources/shim (via extraResources).
// In dev it lives at ../shim/target/release/shim relative to app/.
const SHIM_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'shim')
  : path.join(__dirname, '..', 'shim', 'target', 'release', 'shim');

const DEFAULT_CONFIG = {
  instance_name: 'default',
  vdo_base_url: 'https://vdo.ninja',
  input_device: '',
  output_device: '',
  sample_rate: 48000,
  lines: [
    { id: 0, name: 'PL1', room_key: nameKey('PL1'), input_channel: 0, output_channel: 0, gain_in: 1.0, gain_out: 1.0 },
    { id: 1, name: 'PL2', room_key: nameKey('PL2'), input_channel: 1, output_channel: 1, gain_in: 1.0, gain_out: 1.0 },
    { id: 2, name: 'PL3', room_key: nameKey('PL3'), input_channel: 2, output_channel: 2, gain_in: 1.0, gain_out: 1.0 },
    { id: 3, name: 'PL4', room_key: nameKey('PL4'), input_channel: 3, output_channel: 3, gain_in: 1.0, gain_out: 1.0 },
  ],
};

function randomKey() {
  return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 4);
}

function nameKey(name) {
  const sanitised = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sanitised + randomKey();
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let shimProcess = null;
// Map of line id → WebContentsView for active VDO.ninja connections
const lineViews = new Map();
let mainWin = null;

// Capture first-run state before loadConfig() creates the file
const FIRST_RUN = !fs.existsSync(CONFIG_PATH);

function killPortAndStartShim() {
  if (!fs.existsSync(SHIM_BIN)) {
    console.warn('Shim binary not found at', SHIM_BIN, '— audio I/O disabled');
    return;
  }
  // Ensure executable bit is set — macOS may strip it when copying from DMG
  try { fs.chmodSync(SHIM_BIN, 0o755); } catch (_) {}
  // Kill only the LISTENING process on 9696 (the old shim server).
  // Without -s tcp:LISTEN this also matches Chromium's client sockets to port
  // 9696, killing the network service and causing a crash loop.
  if (shimProcess) { try { shimProcess.kill('SIGTERM'); } catch (_) {} shimProcess = null; }
  const killer = spawn('lsof', ['-ti', 'tcp:9696', '-s', 'tcp:LISTEN']);
  let pids = '';
  killer.stdout.on('data', d => { pids += d.toString(); });
  killer.on('close', () => {
    pids.trim().split('\n').filter(Boolean).forEach(pid => {
      try { process.kill(parseInt(pid), 'SIGTERM'); } catch (_) {}
    });
    // Small delay to let the port release
    setTimeout(() => {
      shimProcess = spawn(SHIM_BIN, [], { stdio: ['ignore', 'pipe', 'pipe'] });
      shimProcess.stdout.on('data', d => process.stdout.write('[shim] ' + d));
      shimProcess.stderr.on('data', d => process.stderr.write('[shim] ' + d));
      shimProcess.on('error', err => console.error('[shim] spawn error:', err.message));
      shimProcess.on('exit', (code, sig) => console.log(`[shim] exited code=${code} sig=${sig}`));
    }, 300);
  });
}

app.whenReady().then(() => {
  // Grant mic + camera permission for all web contents (renderer + VDO.ninja views)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'camera');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'microphone' || permission === 'camera';
  });

  // FIRST_RUN was captured at module load, before loadConfig() created the file
  ipcMain.handle('is-first-run', () => FIRST_RUN);

  const buildMeta = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-meta.json'), 'utf8')); }
    catch { return { version: '0.0.1', build: 0 }; }
  })();
  ipcMain.handle('get-build-meta', () => buildMeta);

  // Request macOS TCC microphone permission — without this getUserMedia returns
  // a muted track on macOS even when Electron's own permission handler says yes.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      console.log('Microphone TCC permission:', granted ? 'granted' : 'denied');
    });
  }

  const config = loadConfig();
  killPortAndStartShim();

  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'VDO.MultiCh.Comms',
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open all target="_blank" links (director pages, join links) in the system browser
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Connect a line: create a WebContentsView that loads VDO.ninja as a real browser tab
  ipcMain.handle('connect-line', (_, { id, url, channelId }) => {
    if (lineViews.has(id)) return; // already connected

    // Write a per-line preload script so the getUserMedia override is installed
    // before ANY page script runs (preloads execute before the renderer's JS).
    // contextIsolation must be false so the preload shares the page's JS context.
    const preloadPath = path.join(app.getPath('temp'), `shim-preload-${id}.js`);
    fs.writeFileSync(preloadPath, buildShimScript(channelId ?? 0));

    // Give each line its own session so the preload is scoped to this view only.
    const lineSes = session.fromPartition(`persist:line-${id}`);
    lineSes.setPreloads([preloadPath]);
    lineSes.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media' || permission === 'microphone');
    });
    lineSes.setPermissionCheckHandler((wc, permission) => {
      return permission === 'media' || permission === 'microphone';
    });

    const view = new WebContentsView({
      webPreferences: {
        session: lineSes,
        contextIsolation: false,          // preload must share page context to override getUserMedia
        autoplayPolicy: 'no-user-gesture-required',
      },
    });

    // Ensure audio is not muted in this view
    view.webContents.setAudioMuted(false);

    // Off-screen but large enough for Chromium to run audio + WebRTC at full rate
    mainWin.contentView.addChildView(view);
    view.setBounds({ x: -400, y: -400, width: 320, height: 240 });

    view.webContents.loadURL(url);
    lineViews.set(id, view);
    console.log(`Line ${id} ch${channelId} connected: ${url}`);
  });

  // Disconnect a line: destroy the WebContentsView and clean up temp preload
  ipcMain.handle('disconnect-line', (_, id) => {
    const view = lineViews.get(id);
    if (!view) return;
    mainWin.contentView.removeChildView(view);
    try { fs.unlinkSync(path.join(app.getPath('temp'), `shim-preload-${id}.js`)); } catch (_) {}
    view.webContents.close();
    lineViews.delete(id);
    console.log(`Line ${id} disconnected`);
  });

  // IPC handlers
  ipcMain.handle('generate-qr', async (_, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 120, margin: 1 });
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
  ipcMain.handle('restart-shim', () => killPortAndStartShim());
  ipcMain.handle('test-vdo-url', async (_, url) => {
    try {
      const { net } = require('electron');
      const req = net.request(url);
      return await new Promise((resolve) => {
        req.on('response', (res) => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.end();
      });
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
});

app.on('window-all-closed', () => {
  if (shimProcess) shimProcess.kill();
  app.quit();
});
