const { app, BrowserWindow, WebContentsView, webContents, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const nativeAddonPath = app.isPackaged
  ? path.join(process.resourcesPath, 'coreaudio.node')
  : path.join(__dirname, 'native/build/Release/coreaudio.node');
const coreAudio = require(nativeAddonPath);

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');

function buildShimScript(channelId) {
  return `
(function() {
  const CHANNEL_ID = ${channelId};
  const SAMPLE_RATE = 48000;

  let _resolveStream;
  const _streamPromise = new Promise(r => { _resolveStream = r; });

  const _origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.audio) {
      const stream = await _streamPromise;
      if (stream) return stream;
    }
    return _origGUM(constraints);
  };

  (async function() {
    try {
      const { ipcRenderer } = require('electron');
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await audioCtx.resume();

      const processorSrc = \`
        class ShimProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            const CAP = 96000;
            this._buf = new Float32Array(CAP);
            this._head = 0;
            this._tail = 0;
            this._size = 0;
            this._cap = CAP;
            this._ready = false;
            this._underruns = 0;
            this.port.onmessage = (e) => {
              const data = e.data;
              for (let i = 0; i < data.length; i++) {
                if (this._size < this._cap) {
                  this._buf[this._tail] = data[i];
                  this._tail = (this._tail + 1) % this._cap;
                  this._size++;
                }
              }
              if (!this._ready && this._size >= 24000) this._ready = true;
            };
          }
          process(inputs, outputs) {
            const out = outputs[0][0];
            if (!this._ready) { out.fill(0); return true; }
            let hadUnderrun = false;
            for (let i = 0; i < out.length; i++) {
              if (this._size > 0) {
                out[i] = this._buf[this._head];
                this._head = (this._head + 1) % this._cap;
                this._size--;
              } else {
                out[i] = 0;
                hadUnderrun = true;
              }
            }
            if (hadUnderrun) {
              this._underruns++;
              if (this._underruns % 50 === 1) {
                this.port.postMessage({ underrun: true, count: this._underruns });
              }
            }
            return true;
          }
        }
        registerProcessor('shim-proc', ShimProcessor);
      \`;
      const blobUrl = URL.createObjectURL(new Blob([processorSrc], { type: 'application/javascript' }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const node = new AudioWorkletNode(audioCtx, 'shim-proc', { outputChannelCount: [1] });

      node.port.onmessage = (e) => {
        if (e.data && e.data.underrun) {
          console.warn('[shim-bridge] audio underrun #' + e.data.count + ' on channel ' + CHANNEL_ID);
        }
      };

      const dest = audioCtx.createMediaStreamDestination();
      node.connect(dest);

      ipcRenderer.on('audio-frame', (_e, ch, samples) => {
        if (ch === CHANNEL_ID) {
          node.port.postMessage(samples);
        }
      });

      await audioCtx.resume();
      console.log('[shim-bridge] ready — channel', CHANNEL_ID, '— AudioContext state:', audioCtx.state);
      _resolveStream(dest.stream);
    } catch (err) {
      console.error('[shim-bridge] init failed:', err.message);
      _resolveStream(null);
    }
  })();
})();
`;
}

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

// Map of line id → WebContentsView for active VDO.ninja connections
const lineViews = new Map();
// Track connect args so lines can be reconnected if needed
const lineConfigs = new Map(); // id → { url, channelId }
const channelViews = new Map(); // channelId -> WebContents ID
let mainWin = null;

// Capture first-run state before loadConfig() creates the file
const FIRST_RUN = !fs.existsSync(CONFIG_PATH);

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

  loadConfig();

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
    lineConfigs.set(id, { url, channelId: channelId ?? 0 });
    channelViews.set(channelId ?? 0, view.webContents.id);
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
    lineConfigs.delete(id);
    for (const [ch, wcId] of channelViews) {
      if (wcId === view.webContents.id) channelViews.delete(ch);
    }
    console.log(`Line ${id} disconnected`);
  });

  // CoreAudio IPC handlers
  ipcMain.handle('list-audio-devices', () => coreAudio.listDevices());

  ipcMain.handle('start-audio-capture', (_e, deviceUID, nChannels) => {
    if (coreAudio.isRunning?.()) coreAudio.stopCapture();
    coreAudio.startCapture(deviceUID, nChannels, (ch, samples) => {
      const wcId = channelViews.get(ch);
      if (wcId == null) return;
      const wc = webContents.fromId(wcId);
      if (wc && !wc.isDestroyed()) {
        wc.send('audio-frame', ch, samples);
      }
    });
  });

  ipcMain.handle('stop-audio-capture', () => coreAudio.stopCapture());

  // IPC handlers
  ipcMain.handle('generate-qr', async (_, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 120, margin: 1 });
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
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
  app.quit();
});
