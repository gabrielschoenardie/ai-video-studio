// vmaf.js — measures VMAF of the delivery encode against the mezzanine
// that fed it. Uses the standard (non-NEG) `vmaf_v0.6.1` model by deliberate
// project decision (see docs/plans/vmaf-harness.md) — the non-NEG model can
// reward sharpness/contrast gain introduced by the encode instead of
// treating it purely as deviation from the reference, so comparisons are
// only meaningful when the two runs share the same LUT/denoise pipeline.
// Degrades soft: any missing engine or failure returns an `available`/
// `skipped` object, never throws, never rejects — the Export must never
// fail because of this metric.
//
// `refFilter` (see docs/plans/color-pipeline-order-and-dither.md): the
// reference branch can receive the same creative transformations (grade +
// captions) the distorted output already has, applied in high precision and
// without compression. This is what keeps the metric isolating compression
// damage only — without it, the LUT and burned-in captions would register
// as distortion (or, with the non-NEG model, could inflate the score via
// the LUT's sharpness/contrast gain) even though nothing actually got worse.
'use strict';
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mediaInfo } = require('./ffmpeg');

const VMAF_MODEL = 'vmaf_v0.6.1';   // modelo padrão — NÃO trocar para *neg (ver plano)
const VMAF_TIMEOUT_MS = 15 * 60 * 1000;
const VMAF_LOW_PERCENTILE = 1;      // p1 — o pior 1% dos frames

async function hasLibvmaf() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-hide_banner', '-filters'],
      { timeout: 8000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(false);
        resolve((stdout || '').includes('libvmaf'));
      });
  });
}

// Same escape recipe as lib/encode.js (buildArgs, LUT path) and
// lib/captions.js (subFilter) — the ffmpeg filtergraph parser breaks on
// backslashes and on the drive-letter colon on Windows.
function escPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function measure(distorted, reference, { target = null, refFilter = null, onLog } = {}) {
  if (!(await hasLibvmaf())) {
    return { available: false, reason: 'ffmpeg sem libvmaf compilado', install: 'instale um build do ffmpeg com --enable-libvmaf' };
  }
  if (!reference || !fs.existsSync(reference)) {
    return { available: true, skipped: true, reason: 'sem arquivo de referência' };
  }

  let distInfo, refInfo;
  try {
    [distInfo, refInfo] = await Promise.all([mediaInfo(distorted), mediaInfo(reference)]);
  } catch (e) {
    return { available: true, skipped: true, reason: `falha lendo mídia — ${e.message.split('\n')[0]}` };
  }
  // Geometry check is only meaningful when nothing resizes the reference
  // for us. With `refFilter` present it's the filtergraph's job (its
  // buildFit) to bring the reference to 1080×1920, so a mezzanine of a
  // different source resolution is expected and not a mismatch.
  if (!refFilter && (distInfo.width !== refInfo.width || distInfo.height !== refInfo.height)) {
    return {
      available: true, skipped: true,
      reason: `geometria divergente — VMAF exige mesma resolução (distorted ${distInfo.width}x${distInfo.height} vs reference ${refInfo.width}x${refInfo.height})`,
    };
  }

  const logPath = path.join(os.tmpdir(), `vmaf-${Date.now()}.json`);
  const threads = Math.max(1, os.cpus().length - 1);
  const refChain = refFilter ? `,${refFilter}` : '';
  const filter =
    '[0:v]settb=AVTB,setpts=PTS-STARTPTS[dist];' +
    `[1:v]settb=AVTB,setpts=PTS-STARTPTS${refChain}[ref];` +
    `[dist][ref]libvmaf=model='version=${VMAF_MODEL}'` +
    `:n_threads=${threads}:log_fmt=json:log_path='${escPath(logPath)}'`;

  const run = () => new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', distorted, '-i', reference, '-lavfi', filter, '-f', 'null', '-']);
    let tail = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      p.kill();
      resolve({ available: true, skipped: true, reason: 'timeout' });
    }, VMAF_TIMEOUT_MS);
    p.stderr.on('data', (buf) => {
      const s = buf.toString();
      tail = (tail + s).slice(-4000);
      if (onLog) onLog(s);
    });
    p.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ available: true, skipped: true, reason: e.message.split('\n')[0] });
    });
    p.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({ available: true, skipped: true, reason: `ffmpeg exit ${code}`, detail: tail.slice(-400) });
      }
      resolve(null); // signal success, caller reads logPath
    });
  });

  const early = await run();
  if (early) return early;

  let j;
  try {
    j = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (e) {
    return { available: true, skipped: true, reason: `falha lendo log do libvmaf — ${e.message.split('\n')[0]}` };
  } finally {
    try { fs.unlinkSync(logPath); } catch { /* best effort */ }
  }

  const pooled = j.pooled_metrics?.vmaf || {};
  const per = (j.frames || [])
    .map(f => f.metrics?.vmaf)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const p1 = per.length ? per[Math.floor((VMAF_LOW_PERCENTILE / 100) * (per.length - 1))] : null;

  const round2 = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  const mean = round2(pooled.mean);
  const harmonicMean = round2(pooled.harmonic_mean);

  return {
    available: true,
    skipped: false,
    model: VMAF_MODEL,
    neg: false,
    frames: per.length,
    mean,
    harmonicMean,
    min: round2(pooled.min),
    p1: round2(p1),
    target: target ?? null,
    passed: target == null ? null : harmonicMean >= target,
    refFiltered: !!refFilter,
  };
}

module.exports = { measure, hasLibvmaf, VMAF_MODEL };
