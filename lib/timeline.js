// timeline.js — conform: the TIMELINE panel's edit decisions, flattened into a
// real file. Until this module existed nothing under lib/ read the `.beats.json`
// sidecar, so the VÍDEO segment cuts, the B-ROLL clips and the TRILHA music the
// user arranged in step 04 lived only in the browser's preview compositor and
// never reached the exported reel.
//
// Output is a visually-lossless 4:4:4 CRF-12 mezzanine — the same working-file
// contract as lib/assemble.js, not a delivery encode. The Export step takes it
// as `sourceKind: 'mezzanine'` and (because it is also the pre-compression
// truth for what the user arranged) as the VMAF reference.
//
// What the graph does, in the order the timeline reads:
//   VÍDEO   segments of the base media, trimmed by {srcIn,dur} and concatenated
//           — deleting a segment ripples, so the output is genuinely shorter
//   B-ROLL  each clip fitted to the same 1080×1920 frame and overlaid on the
//           base for its window only. Its audio is deliberately dropped: the
//           preview compositor draws B-ROLL frames but never plays B-ROLL
//           sound, and the export must match what the user heard.
//   TRILHA  each clip trimmed, gain-staged, delayed to its timeline position
//           and mixed under the base audio (normalize=0 — amix would otherwise
//           attenuate the base by 1/N and quietly duck the voice).
//
// Captions travel as words, not as a burned-in picture: a rippled timeline
// moves every word, so `remapWords()` reprojects the transcript through the
// same segment map and a fresh .ass is written for the Export to burn after
// the grade. Reusing the pre-conform .ass would desync by exactly the cut.
'use strict';
const fs = require('fs');
const path = require('path');
const { runFfmpeg, mediaInfo } = require('./ffmpeg');
const { buildFit } = require('./encode');
const { writeAss } = require('./captions');

const MEZZANINE_CRF = 12;   // matches assemble.js — visually lossless working file
const OUT_FPS = 30;
const MIN_CLIP = 0.02;      // shorter than a frame at 30fps: not a clip, a rounding artifact

// ffmpeg filter values must never come out in exponent notation ("1e-7"), and
// trailing garbage precision makes the logged graph unreadable.
function ts(n) { return (Math.round(n * 1e6) / 1e6).toFixed(6); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// ------------------------------------------------------------- normalization
// The sidecar is written by the browser and is therefore untrusted input:
// clamp everything into the source media before it reaches a filter string.
function normalizeSegments(segments, mediaDuration) {
  const out = [];
  for (const s of segments || []) {
    const srcIn = Math.max(0, num(s.srcIn, 0));
    const dur = Math.min(num(s.dur, 0), Math.max(0, mediaDuration - srcIn));
    if (dur > MIN_CLIP) out.push({ srcIn, dur });
  }
  // No VÍDEO edits saved (a v2 sidecar, or an untouched track) — the whole
  // media is one segment, which makes conform a pure b-roll/music pass.
  if (!out.length && mediaDuration > 0) out.push({ srcIn: 0, dur: mediaDuration });
  return out;
}

function timelineDuration(segments) {
  return segments.reduce((s, g) => s + g.dur, 0);
}

function normalizeClips(clips, duration, { withVolume = false } = {}) {
  const out = [];
  for (const c of clips || []) {
    if (!c || !c.path) continue;
    const start = Math.max(0, num(c.start, 0));
    const dur = Math.min(num(c.dur, 0), Math.max(0, duration - start));
    if (dur <= MIN_CLIP) continue;      // starts at or past the end of the timeline
    const clip = { path: c.path, name: c.name || path.basename(String(c.path)),
      start, dur, srcIn: Math.max(0, num(c.srcIn, 0)) };
    if (withVolume) clip.volume = Math.max(0, Math.min(1, num(c.volume, 1)));
    out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}

// --------------------------------------------------------- caption remapping
// Source-time words → timeline-time words, through the VÍDEO segment map.
// A word is emitted once per segment that covers any part of it, clipped to
// that segment: a word inside a deleted stretch disappears, and a word inside a
// duplicated segment is spoken (and captioned) twice. Both are correct.
function remapWords(words, segments) {
  const out = [];
  let tlStart = 0;
  for (const seg of segments) {
    const srcEnd = seg.srcIn + seg.dur;
    for (const w of words || []) {
      const ws = num(w.start, 0), we = num(w.end, 0);
      const a = Math.max(ws, seg.srcIn), b = Math.min(we, srcEnd);
      if (b - a <= MIN_CLIP) continue;
      // `hl` (destaque semântico) precisa atravessar o corte: sem isto a
      // marca é descartada em silêncio e o vídeo conformado sai sem destaque.
      const mapped = { word: w.word, start: tlStart + (a - seg.srcIn), end: tlStart + (b - seg.srcIn) };
      if (w.hl) mapped.hl = true;
      out.push(mapped);
    }
    tlStart += seg.dur;
  }
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------ graph builder
// Pure: no fs, no child_process. Inputs are positional and the caller must
// pass them to ffmpeg in exactly this order — base, then B-ROLL, then TRILHA.
function buildConformGraph({ segments, broll = [], music = [], hasAudio = true,
  fit = 'blur', duration }) {
  if (!segments.length) throw new Error('conform: nenhum segmento de vídeo');
  const sopt = ':flags=lanczos';
  const g = [];

  // 1 — VÍDEO: trim each segment out of the base and concatenate. Segment
  // starts are implicit in the array order, which is what makes a delete
  // ripple: the surviving segments simply close the gap.
  segments.forEach((s, i) => {
    const end = s.srcIn + s.dur;
    g.push(`[0:v]trim=start=${ts(s.srcIn)}:end=${ts(end)},setpts=PTS-STARTPTS[sv${i}]`);
    if (hasAudio) g.push(`[0:a]atrim=start=${ts(s.srcIn)}:end=${ts(end)},asetpts=PTS-STARTPTS[sa${i}]`);
  });
  const pairs = segments.map((_, i) => hasAudio ? `[sv${i}][sa${i}]` : `[sv${i}]`).join('');
  g.push(`${pairs}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? '[ca]' : ''}`);
  // A silent source still has to produce an audio stream: the TRILHA mixes
  // into it, and Instagram delivery validation requires an AAC track.
  if (!hasAudio) g.push(`anullsrc=r=44100:cl=stereo,atrim=end=${ts(duration)},asetpts=PTS-STARTPTS[ca]`);

  g.push(`[cv]${buildFit(fit, sopt, 'base')},fps=${OUT_FPS},setpts=PTS-STARTPTS,format=yuv444p[v0]`);

  // 2 — B-ROLL: fit to the same frame, shift to its timeline position, and
  // overlay for its window only. `eof_action=pass` keeps the base visible if
  // the b-roll source runs out early instead of freezing on its last frame.
  broll.forEach((c, k) => {
    const idx = 1 + k;
    const end = c.start + c.dur;
    g.push(`[${idx}:v]trim=start=${ts(c.srcIn)}:end=${ts(c.srcIn + c.dur)},setpts=PTS-STARTPTS,` +
      `${buildFit(fit, sopt, 'b' + k)},fps=${OUT_FPS},setpts=PTS-STARTPTS+${ts(c.start)}/TB,format=yuv444p[ov${k}]`);
    g.push(`[v${k}][ov${k}]overlay=x=0:y=0:eof_action=pass:format=yuv444:` +
      `enable='between(t,${ts(c.start)},${ts(end)})'[v${k + 1}]`);
  });
  const vlabel = `[v${broll.length}]`;

  // 3 — TRILHA under the base audio. normalize=0 is load-bearing: amix's
  // default normalization divides every input by the input count, so adding
  // one music bed would halve the voiceover.
  g.push('[ca]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[ab]');
  music.forEach((c, k) => {
    const idx = 1 + broll.length + k;
    const ms = Math.round(c.start * 1000);
    g.push(`[${idx}:a]atrim=start=${ts(c.srcIn)}:end=${ts(c.srcIn + c.dur)},asetpts=PTS-STARTPTS,` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
      `volume=${c.volume.toFixed(3)},adelay=${ms}|${ms}[m${k}]`);
  });
  if (music.length) {
    g.push(`[ab]${music.map((_, k) => `[m${k}]`).join('')}` +
      `amix=inputs=${1 + music.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    g.push('[ab]anull[aout]');
  }

  return { filter: g.join(';'), vlabel, alabel: '[aout]' };
}

function buildConformArgs({ base, broll, music, graph, output, duration }) {
  const args = ['-i', base];
  for (const c of broll) args.push('-i', c.path);
  for (const c of music) args.push('-i', c.path);
  args.push(
    '-filter_complex', graph.filter,
    '-map', graph.vlabel, '-map', graph.alabel,
    '-t', ts(duration),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
    '-pix_fmt', 'yuv444p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', output);
  return args;
}

// ----------------------------------------------------------------- pipeline
// A clip whose file is missing, unreadable, or carries no usable stream is
// skipped with a log line and reported back — the same fail-soft contract the
// engine integrations use. Aborting the whole conform because one b-roll file
// was moved would be the worse trade.
async function probeClips(clips, kind, onLog) {
  const usable = [], skipped = [];
  for (const c of clips) {
    try {
      const info = await mediaInfo(c.path);
      const ok = kind === 'video' ? !!info.vcodec : !!info.acodec;
      if (!ok) throw new Error(`sem faixa de ${kind === 'video' ? 'vídeo' : 'áudio'}`);
      usable.push(c);
    } catch (e) {
      const why = String(e.message || e).split('\n')[0];
      skipped.push({ name: c.name, path: c.path, reason: why });
      onLog(`[conform] ignorando ${c.name} — ${why}\n`);
    }
  }
  return { usable, skipped };
}

async function conform({ base, segments = [], broll = [], music = [], output, workDir,
  fit = 'blur', words = null, captionStyle = 'impact',
  onLog = () => {}, onStage = () => {}, onProgress = () => {} }) {

  fs.mkdirSync(workDir, { recursive: true });

  onStage('probe', 'Medindo a mídia base');
  const info = await mediaInfo(base);
  if (!info.duration) throw new Error('não deu para medir a duração da mídia base');

  const segs = normalizeSegments(segments, info.duration);
  const duration = timelineDuration(segs);
  if (duration <= MIN_CLIP) throw new Error('timeline vazia — todos os segmentos de VÍDEO foram removidos');

  const brollAll = normalizeClips(broll, duration);
  const musicAll = normalizeClips(music, duration, { withVolume: true });
  onStage('probe', 'Checando os clipes da timeline');
  const b = await probeClips(brollAll, 'video', onLog);
  const m = await probeClips(musicAll, 'audio', onLog);

  onLog(`[conform] ${segs.length} segmento(s) de VÍDEO → ${duration.toFixed(2)}s ` +
    `(fonte ${info.duration.toFixed(2)}s) · ${b.usable.length} B-ROLL · ${m.usable.length} TRILHA\n`);

  const graph = buildConformGraph({
    segments: segs, broll: b.usable, music: m.usable,
    hasAudio: !!info.acodec, fit, duration,
  });
  const args = buildConformArgs({ base, broll: b.usable, music: m.usable, graph, output, duration });

  onStage('conform', 'Conformando a timeline num mezanino');
  await runFfmpeg(args, {
    onLog,
    onProgress: p => onProgress({ ...p, pct: Math.min(99, (p.time / duration) * 100) }),
  });

  // Reproject the transcript through the same cut map and write a fresh .ass.
  let assPath = null, remapped = null;
  if (words && words.length) {
    remapped = remapWords(words, segs);
    if (remapped.length) {
      assPath = writeAss(remapped, workDir, { style: captionStyle });
      onLog(`[conform] legenda reprojetada: ${words.length} → ${remapped.length} palavras\n`);
    } else {
      onLog('[conform] nenhuma palavra sobreviveu aos cortes — sem .ass\n');
    }
  }

  return {
    output, duration,
    segments: segs,
    broll: b.usable.length, music: m.usable.length,
    skipped: [...b.skipped, ...m.skipped],
    sourceDuration: info.duration,
    ass: assPath,
    captionedWords: remapped ? remapped.length : 0,
    command: 'ffmpeg -hide_banner -y ' +
      args.map(a => /[\s'"]/.test(a) ? JSON.stringify(a) : a).join(' '),
  };
}

module.exports = {
  conform, buildConformGraph, buildConformArgs,
  normalizeSegments, normalizeClips, timelineDuration, remapWords,
};
