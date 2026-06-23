'use strict';

let _ctx = null;

function getContext() {
  if (!_ctx) {
    _ctx = new AudioContext();
  }
  return _ctx;
}

// channelId → { pannerNode, gainNode, sourceNode }
const _nodes = new Map();

function _azimuthToPosition(azimuth) {
  const rad = (azimuth * Math.PI) / 180;
  return {
    x: Math.sin(rad),
    y: 0,
    z: -Math.cos(rad),
  };
}

function _makePanner(ctx, azimuth) {
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 10000;
  panner.rolloffFactor = 0;
  const pos = _azimuthToPosition(azimuth);
  panner.positionX.value = pos.x;
  panner.positionY.value = pos.y;
  panner.positionZ.value = pos.z;
  return panner;
}

function connect(channelId, mediaStream, channelState) {
  if (_nodes.has(channelId)) {
    disconnect(channelId);
  }
  const ctx = getContext();
  const azimuth = channelState.azimuth ?? 0;
  const volume = channelState.volume ?? 1;
  const listening = channelState.listening !== false;

  const sourceNode = ctx.createMediaStreamSource(mediaStream);
  const gainNode = ctx.createGain();
  gainNode.gain.value = listening ? volume : 0;
  const pannerNode = _makePanner(ctx, azimuth);

  sourceNode.connect(gainNode);
  gainNode.connect(pannerNode);
  pannerNode.connect(ctx.destination);

  _nodes.set(channelId, { sourceNode, gainNode, pannerNode });
}

function updatePosition(channelId, azimuth) {
  const entry = _nodes.get(channelId);
  if (!entry) return;
  const ctx = getContext();
  const pos = _azimuthToPosition(azimuth);
  const t = ctx.currentTime;
  entry.pannerNode.positionX.setTargetAtTime(pos.x, t, 0.01);
  entry.pannerNode.positionY.setTargetAtTime(pos.y, t, 0.01);
  entry.pannerNode.positionZ.setTargetAtTime(pos.z, t, 0.01);
}

function updateVolume(channelId, volume) {
  const entry = _nodes.get(channelId);
  if (!entry) return;
  const ctx = getContext();
  entry.gainNode.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
}

function setListening(channelId, listening) {
  const entry = _nodes.get(channelId);
  if (!entry) return;
  const ctx = getContext();
  entry.gainNode.gain.setTargetAtTime(listening ? 1 : 0, ctx.currentTime, 0.01);
}

function disconnect(channelId) {
  const entry = _nodes.get(channelId);
  if (!entry) return;
  try {
    entry.sourceNode.disconnect();
    entry.gainNode.disconnect();
    entry.pannerNode.disconnect();
  } catch (_) {}
  _nodes.delete(channelId);
}

function teardown() {
  for (const id of _nodes.keys()) {
    disconnect(id);
  }
  if (_ctx) {
    _ctx.close();
    _ctx = null;
  }
}

const spatialMixer = { connect, updatePosition, updateVolume, setListening, disconnect, teardown };

if (typeof module !== 'undefined') {
  module.exports = spatialMixer;
} else {
  window.spatialMixer = spatialMixer;
}
