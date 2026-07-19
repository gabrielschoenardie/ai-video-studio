// score.js — Step 6, "score & improve".
//
// Two tiers:
//  A) TRIBE v2 (brain-response model) — licensed NON-COMMERCIAL ONLY, so per
//     LICENSES.md it is never bundled. The app exposes install instructions;
//     the user downloads it themselves from the official source. If a local
//     TRIBE runner is present (STUDIO_TRIBE_CMD env), we call it.
//  B) Built-in attention PROXY — fully local heuristic curve from measurable
//     signals: audio energy (RMS per second), visual change (scene-diff per
//     second), and speech density. It is NOT the brain model — it's a
//     first-pass "where is this flat?" detector, honest about what it is.
'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { mediaInfo } = require('./ffmpeg');

function runCapture(cmd, args, maxBuffer = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout));
  });
}

// audio RMS per second via ffmpeg astats
async function audioEnergy(file, duration) {
  const out = await runCapture('ffmpeg', ['-hide_banner', '-i', file,
    '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-']).catch(() => '');
  const perSec = new Array(Math.ceil(duration)).fill(null);
  let t = 0;
  for (const line of out.split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = parseFloat(pts[1]);
    const rms = /RMS_level=(-?[\d.]+|-inf)/.exec(line);
    if (rms) {
      const sec = Math.min(Math.floor(t), perSec.length - 1);
      const db = rms[1] === '-inf' ? -90 : parseFloat(rms[1]);
      perSec[sec] = perSec[sec] === null ? db : Math.max(perSec[sec], db);
    }
  }
  return perSec.map(v => v === null ? -90 : v);
}

// visual change per second via scene-score sampling
async function visualChange(file, duration) {
  const out = await runCapture('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=pts_time', '-of', 'csv=p=0',
    '-f', 'lavfi', `movie='${file.replace(/'/g, "\\'")}',select=gt(scene\\,0.18)`])
    .catch(() => '');
  const perSec = new Array(Math.ceil(duration)).fill(0);
  for (const line of out.split('\n')) {
    const t = parseFloat(line);
    if (Number.isFinite(t) && t < perSec.length) perSec[Math.floor(t)]++;
  }
  return perSec;
}

function normalize(arr) {
  const min = Math.min(...arr), max = Math.max(...arr);
  return max - min < 1e-6 ? arr.map(() => 0.5) : arr.map(v => (v - min) / (max - min));
}

async function proxyCurve(file, { transcript = null } = {}) {
  const info = await mediaInfo(file);
  const dur = Math.ceil(info.duration);
  const [energy, cuts] = await Promise.all([
    audioEnergy(file, info.duration),
    visualChange(file, info.duration),
  ]);

  const speech = new Array(dur).fill(0);
  if (transcript && transcript.words) {
    for (const w of transcript.words) {
      const s = Math.min(Math.floor(w.start), dur - 1);
      if (s >= 0) speech[s]++;
    }
  }

  const nE = normalize(energy), nC = normalize(cuts.map(c => Math.min(c, 3))), nS = normalize(speech);
  const hasSpeech = speech.some(v => v > 0);
  const curve = nE.map((e, i) =>
    hasSpeech ? 0.45 * e + 0.30 * nC[i] + 0.25 * nS[i] : 0.6 * e + 0.4 * nC[i]);

  // 3s moving average + dip detection
  const smooth = curve.map((_, i) => {
    const win = curve.slice(Math.max(0, i - 1), i + 2);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length;
  const dips = [];
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] < mean - 0.18) {
      const last = dips[dips.length - 1];
      if (last && i - last.end <= 1) last.end = i;
      else dips.push({ start: i, end: i });
    }
  }

  return {
    kind: 'proxy',
    note: 'Built-in attention PROXY (audio energy + cut density + speech density). ' +
          'Not the brain model — install TRIBE v2 yourself for brain-response scoring.',
    duration: info.duration,
    curve: smooth.map((v, i) => ({ t: i, v: +v.toFixed(3) })),
    mean: +mean.toFixed(3),
    dips: dips.map(d => ({ ...d, advice: 'watch these exact seconds — tighten the cut, change the line, or add motion' })),
  };
}

// TRIBE v2 hook: never bundled (non-commercial license). If the user installed
// it and points STUDIO_TRIBE_CMD at a runner that prints JSON {curve:[...]},
// we use it; otherwise we return install guidance.
const TRIBE_INFO = {
  name: 'TRIBE v2 (brain-response model)',
  license: 'NON-COMMERCIAL research license — not sold, not bundled. Download it yourself from the official source and evaluate under its own terms. Read LICENSES.md before any commercial use.',
  install: [
    'Search for the official TRIBE v2 repository (Algonauts 2025 winner) and follow its README.',
    'pip install its requirements in a venv; download weights from the official release.',
    'Expose a runner and set:  STUDIO_TRIBE_CMD="python /path/to/tribe_runner.py"',
    'The runner must print JSON: {"curve":[{"t":0,"v":0.42},...]} for a given video path argument.',
  ],
};

async function tribeCurve(file) {
  const cmd = process.env.STUDIO_TRIBE_CMD;
  if (!cmd) return null;
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', `${cmd} ${JSON.stringify(file)}`]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', () => resolve(null));
    p.on('close', c => {
      if (c !== 0) return resolve(null);
      try { resolve({ kind: 'tribe', ...JSON.parse(out) }); } catch { resolve(null); }
    });
  });
}

async function score(file, opts = {}) {
  const tribe = await tribeCurve(file);
  if (tribe) return tribe;
  const proxy = await proxyCurve(file, opts);
  proxy.tribe = TRIBE_INFO;
  return proxy;
}

module.exports = { score, proxyCurve, TRIBE_INFO };
