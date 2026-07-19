// encode.js — Instagram Reels delivery encode, "Metodologia Gabriel".
// H.264 8-bit 1080×1920, VBV rate control (never bare CRF for delivery),
// premium x264 stack, BT.709 tags, keyint ≤ 60, +faststart. Profile is
// selected from measured duration — never guessed.
'use strict';
const { execFile } = require('child_process');
const { mediaInfo, runFfmpeg, ffprobeJson } = require('./ffmpeg');

// ------------------------------------------------ VBV profiles (mandatory)
function selectProfile(duration) {
  if (duration <= 30) {
    return { name: 'Maximum Quality (≤30s)', target: 10000, maxrate: 11200, bufsize: 15000, vbvInit: 0.90, vmafTarget: 93 };
  }
  if (duration < 40) {
    // transition zone 30–40s: Safe Premium geometry with target=9000
    return { name: 'Safe Premium — transition 30–40s', target: 9000, maxrate: 9000, bufsize: 12500, vbvInit: 0.90, vmafTarget: 90 };
  }
  return { name: 'Safe Premium (≥40s)', target: 8000, maxrate: 9000, bufsize: 12500, vbvInit: 0.90, vmafTarget: 90 };
}

// -------------------------------------------- recompression risk score
function riskScore(info) {
  const rows = [];
  const add = (cond, pts, label) => { if (cond) rows.push({ pts, label }); };
  add(info.bitDepth >= 10, 4, `source ${info.bitDepth}-bit (needs 8-bit conversion)`);
  add(/hevc|h265/.test(info.vcodec || ''), 2, 'source HEVC/H.265');
  add(info.chroma !== '4:2:0', 3, `source ${info.chroma} chroma`);
  add(info.bitrateKbps > 15000, 2, `source bitrate ${info.bitrateKbps} kbps (>15000)`);
  add(info.bitrateKbps > 0 && info.bitrateKbps < 5000, 1, `source bitrate ${info.bitrateKbps} kbps (<5000, up-encode)`);
  add(info.colorPrimaries && info.colorPrimaries !== 'bt709', 2, `source color primaries ${info.colorPrimaries} (non-BT.709)`);
  add(info.fps > 50, 1, `source ${info.fps.toFixed(1)} fps (60p needs conversion)`);
  add(!(info.width === 1080 && info.height === 1920), 1, `source ${info.width}×${info.height} (needs scale)`);
  add(info.acodec && info.acodec !== 'aac', 1, `source audio ${info.acodec} (non-AAC)`);
  const total = rows.reduce((s, r) => s + r.pts, 0);
  const level = total <= 2 ? 'minimal' : total <= 4 ? 'moderate' : total <= 7 ? 'high' : 'guaranteed';
  return { total, level, rows };
}

// ------------------------------------------------------ command builder
// x264-params rule: ':' separates params; only deblock/psy-rd/zones carry
// commas inside values. vbv-init lives INSIDE -x264-params.
function buildX264Params(profile, { keyint = 60, scenecut = 40, psyRd = null, deblock = null } = {}) {
  const kv = [
    'ref=4', 'bframes=2', 'b-adapt=2', 'trellis=2', 'mixed-refs=1',
    'aq-mode=3', 'aq-strength=0.8', 'me=umh', 'subme=8', 'rc-lookahead=60',
    `keyint=${Math.min(keyint, 60)}`, 'min-keyint=1', `scenecut=${scenecut}`,
    `vbv-init=${profile.vbvInit.toFixed(2)}`,
  ];
  if (psyRd) kv.push(`psy-rd=${psyRd}`);       // e.g. "1.0,0.0" — comma, never colon
  if (deblock) kv.push(`deblock=${deblock}`);  // e.g. "-1,-1"  — comma, never colon
  return kv.join(':');
}

function buildArgs(input, output, profile, { lut = null, denoise = null, x264 = {} } = {}) {
  const vf = [];
  if (denoise) vf.push(denoise);                       // derived upstream, never frei0r=bm3d
  if (lut) vf.push(`lut3d='${lut.replace(/'/g, "\\'")}'`);
  vf.push('scale=1080:1920:flags=lanczos', 'fps=30');

  return [
    '-i', input,
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0',
    '-pix_fmt', 'yuv420p',
    '-vf', vf.join(','),
    '-b:v', `${profile.target}k`,
    '-maxrate', `${profile.maxrate}k`,
    '-bufsize', `${profile.bufsize}k`,
    '-x264-params', buildX264Params(profile, x264),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    output,
  ];
}

// -------------------------------------------- post-encode validation
// JS port of validate_encode.sh checks — never assume compliance.
async function validate(output) {
  const j = await ffprobeJson(output);
  const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
  const a = (j.streams || []).find(s => s.codec_type === 'audio') || {};
  const checks = [];
  const chk = (label, ok, got) => checks.push({ label, ok, got });

  chk('codec h264', v.codec_name === 'h264', v.codec_name);
  chk('profile High', v.profile === 'High', v.profile);
  chk('level 4.0', v.level === 40, String(v.level));
  chk('pix_fmt yuv420p', v.pix_fmt === 'yuv420p', v.pix_fmt);
  chk('resolution 1080×1920', v.width === 1080 && v.height === 1920, `${v.width}×${v.height}`);
  chk('BT.709 primaries', v.color_primaries === 'bt709', v.color_primaries || 'untagged');
  chk('BT.709 trc', v.color_transfer === 'bt709', v.color_transfer || 'untagged');
  chk('BT.709 matrix', v.color_space === 'bt709', v.color_space || 'untagged');
  const kbps = Math.round(parseInt(j.format?.bit_rate || 0, 10) / 1000);
  chk('bitrate ≤ 11200 kbps ceiling', kbps <= 11400, `${kbps} kbps`);
  chk('audio aac', a.codec_name === 'aac', a.codec_name);
  chk('audio 44.1 kHz', a.sample_rate === '44100', a.sample_rate);

  // keyframe spacing ≤ 60 frames (Instagram GOP rule) + faststart
  const [gopOk, maxGop] = await new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', output],
      { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([true, 'n/a']);
        const keys = stdout.split('\n')
          .filter(l => l.includes('K'))
          .map(l => parseFloat(l.split(',')[0]))
          .filter(Number.isFinite);
        let max = 0;
        for (let i = 1; i < keys.length; i++) max = Math.max(max, keys[i] - keys[i - 1]);
        resolve([max <= 2.05, `${max.toFixed(2)}s max I-frame gap`]);
      });
  });
  chk('GOP ≤ 60 frames (2.0s @30fps)', gopOk, maxGop);

  const passed = checks.every(c => c.ok);
  return { passed, checks, bitrateKbps: kbps };
}

// ------------------------------------------------------------- pipeline
async function encodeReel(input, output, { lut = null, denoise = null, x264 = {}, onProgress, onLog } = {}) {
  const info = await mediaInfo(input);
  if (!info.duration) throw new Error('Could not measure duration — profile selection requires it');
  const profile = selectProfile(info.duration);
  const risk = riskScore(info);
  const args = buildArgs(input, output, profile, { lut, denoise, x264 });

  await runFfmpeg(args, {
    onLog,
    onProgress: p => onProgress && onProgress({ ...p, pct: Math.min(99, (p.time / info.duration) * 100) }),
  });

  const validation = await validate(output);
  return {
    profile, risk, validation,
    command: 'ffmpeg -hide_banner -y ' + args.map(a => /[\s'"]/g.test(a) ? JSON.stringify(a) : a).join(' '),
    sourceInfo: info,
  };
}

module.exports = { selectProfile, riskScore, buildArgs, buildX264Params, validate, encodeReel };
