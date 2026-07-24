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

const DEADAIR_ENERGY = 0.2;   // normalized-energy threshold below which a silent second counts as dead air
const DEADAIR_FACTOR = 0.5;   // multiplier applied to dead-air seconds
const HOOK_SECONDS = 3;       // opening window that carries extra weight (used in Task 3)

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

// continuous motion magnitude per second: diff between consecutive frames
// (downscaled 64x64 for speed/robustness), averaged per second via signalstats YAVG.
async function motionMagnitude(file, duration) {
  const out = await runCapture('ffmpeg', ['-hide_banner', '-i', file,
    '-vf', 'scale=64:64,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-']).catch(() => '');
  const sum = new Array(Math.ceil(duration)).fill(0);
  const cnt = new Array(Math.ceil(duration)).fill(0);
  let t = 0;
  for (const line of out.split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = parseFloat(pts[1]);
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (y) {
      const sec = Math.min(Math.floor(t), sum.length - 1);
      sum[sec] += parseFloat(y[1]);
      cnt[sec]++;
    }
  }
  return sum.map((s, i) => cnt[i] ? s / cnt[i] : 0);
}

// p in [0,100]; sorted ascending. Linear interpolation between ranks.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Robust normalize: clamp to the 5th–95th percentile band, then scale to [0,1].
// A single spike no longer flattens the rest of the curve. Flat input -> 0.5.
function normalize(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const lo = percentile(sorted, 5), hi = percentile(sorted, 95);
  if (hi - lo < 1e-6) return arr.map(() => 0.5);
  return arr.map(v => Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}

async function proxyCurve(file, { transcript = null } = {}) {
  const info = await mediaInfo(file);
  const dur = Math.ceil(info.duration);
  const [energy, cuts, motion] = await Promise.all([
    audioEnergy(file, info.duration),
    visualChange(file, info.duration),
    motionMagnitude(file, info.duration),
  ]);

  const speech = new Array(dur).fill(0);
  if (transcript && transcript.words) {
    for (const w of transcript.words) {
      const s = Math.min(Math.floor(w.start), dur - 1);
      if (s >= 0) speech[s]++;
    }
  }

  const nE = normalize(energy);
  const nC = normalize(cuts.map(c => Math.min(c, 3)));
  const nM = normalize(motion);
  const nS = normalize(speech);
  const hasSpeech = speech.some(v => v > 0);
  const visual = nC.map((c, i) => 0.5 * c + 0.5 * nM[i]);
  const curve = nE.map((e, i) => {
    const base = hasSpeech
      ? 0.40 * e + 0.35 * visual[i] + 0.25 * nS[i]
      : 0.55 * e + 0.45 * visual[i];
    const deadAir = speech[i] === 0 && e < DEADAIR_ENERGY;
    return deadAir ? base * DEADAIR_FACTOR : base;
  });

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

  // thermometer summary: weighted mean of the smoothed curve, opening 3s counts 2x
  let sw = 0, ww = 0;
  for (let i = 0; i < smooth.length; i++) {
    const w = i < HOOK_SECONDS ? 2 : 1;
    sw += smooth[i] * w; ww += w;
  }
  const score = Math.round(100 * (ww ? sw / ww : 0));

  const hookWin = smooth.slice(0, Math.min(HOOK_SECONDS, smooth.length));
  const hookVal = hookWin.length ? hookWin.reduce((a, b) => a + b, 0) / hookWin.length : 0;
  const weak = hookVal < 0.5 || hookVal < mean * 0.9;
  const hook = {
    value: +hookVal.toFixed(3),
    weak,
    advice: weak
      ? 'hook fraco — reforce os primeiros 3s (corte mais forte, primeira fala mais direta, movimento)'
      : 'hook forte — a abertura segura a atenção',
  };

  return {
    kind: 'proxy',
    note: 'Built-in attention PROXY (audio energy + cut density + speech density). ' +
          'Not the brain model — install TRIBE v2 yourself for brain-response scoring.',
    duration: info.duration,
    curve: smooth.map((v, i) => ({ t: i, v: +v.toFixed(3) })),
    mean: +mean.toFixed(3),
    score,
    hook,
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
