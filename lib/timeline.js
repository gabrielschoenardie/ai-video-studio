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
//   SFX     the TRILHA chain again, one input per clip: the same whoosh used
//           five times is five inputs, with no state shared between them.
//   MASTER  a true-peak safety limiter on the sum, ceiling -2 dBTP: three AAC
//           encodes stand between this file and a phone (this mezzanine, the
//           Export, the platform), and each one can push a peak up.
//
// The mix follows the preview (export = preview): a track the user muted, or
// that another track's solo silences, never becomes an input. `mix` comes from
// the sidecar, so normalizeMix() drops anything unexpected before it is read.
// The limiter is the one declared exception: the preview cannot run it, so
// above the ceiling the export sounds more contained than what the user heard
// (the timeline meter shows where). `limiter: false` leaves the sum untouched.
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
// Master limiter ceiling. -2, not -1: measured, this file's AAC 192k plus the
// Export's AAC 128k pushed a -1 dBTP ceiling to +0.3 dBTP; -2 held at -1.3.
const MASTER_CEIL_DB = -2;
const MASTER_LIMIT = '0.794328';   // 10^(-2/20): alimiter takes the ceiling as linear gain
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

// ------------------------------------------------------------------- mixing
// M/S of the step-04 audio tracks. `audible` is the same rule, word for word,
// as the one in public/index.html: mute wins over solo, and a solo leaves only
// its own track audible. 'audio' is the plate's own sound (the VÍDEO segments).
const MIX_TRACKS = ['audio', 'music', 'sfx'];
function normalizeMix(mix) {
  const m = mix && typeof mix === 'object' ? mix : {};
  const mute = Array.isArray(m.mute) ? MIX_TRACKS.filter(t => m.mute.includes(t)) : [];
  const solo = MIX_TRACKS.includes(m.solo) ? m.solo : null;
  return { mute, solo };
}
function audible(mix, track) {
  const m = normalizeMix(mix);
  return !m.mute.includes(track) && (m.solo === null || m.solo === track);
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
// pass them to ffmpeg in exactly this order — base, B-ROLL, TRILHA, then SFX.
function buildConformGraph({ segments, broll = [], music = [], sfx = [], hasAudio = true,
  fit = 'blur', duration, limiter = true }) {
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
  // TRILHA [m*] and SFX [x*] share one chain: trim, gain, delay to position.
  // A mono file is copied to both channels first: left to aformat, ffmpeg would
  // upmix it at -3 dB (center_mix_level), while the browser plays mono at full
  // level on both speakers — the export would sound 3 dB quieter than the
  // preview. `channels` comes from probeClips; unknown means "leave it alone".
  const bed = (c, idx, label) => {
    const ms = Math.round(c.start * 1000);
    const up = c.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : '';
    g.push(`[${idx}:a]atrim=start=${ts(c.srcIn)}:end=${ts(c.srcIn + c.dur)},asetpts=PTS-STARTPTS,${up}` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
      `volume=${c.volume.toFixed(3)},adelay=${ms}|${ms}[${label}]`);
  };
  music.forEach((c, k) => bed(c, 1 + broll.length + k, 'm' + k));
  sfx.forEach((c, k) => bed(c, 1 + broll.length + music.length + k, 'x' + k));
  const beds = [...music.map((_, k) => `[m${k}]`), ...sfx.map((_, k) => `[x${k}]`)];
  if (beds.length) {
    g.push(`[ab]${beds.join('')}` +
      `amix=inputs=${1 + beds.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    g.push('[ab]anull[aout]');
  }
  if (!limiter) return { filter: g.join(';'), vlabel, alabel: '[aout]' };

  // 4 — MASTER: the sum splits in two. One branch only measures the peak
  // before the limiter (astats is float, so it reads above 0 dBFS; conform()
  // parses it from the log). The other is the limiter: alimiter limits sample
  // peaks, so it runs 4× oversampled to hold the ceiling as a true peak;
  // level=disabled turns off its automatic make-up gain; latency=1 removes the
  // lookahead delay, keeping the sound on the picture. The atrim bounds the sum:
  // the measuring branch ends only when its input does, and an endless input
  // would hang ffmpeg past -t.
  g.push(`[aout]atrim=end=${ts(duration)},asplit=2[mpre][mlim]`);
  g.push('[mpre]astats=measure_perchannel=none:measure_overall=Peak_level,anullsink');
  g.push(`[mlim]aresample=176400,alimiter=limit=${MASTER_LIMIT}:attack=5:release=50:` +
    'level=disabled:latency=1,aresample=44100[amaster]');
  return { filter: g.join(';'), vlabel, alabel: '[amaster]' };
}

function buildConformArgs({ base, broll, music, sfx = [], graph, output, duration }) {
  const args = ['-i', base];
  for (const c of broll) args.push('-i', c.path);
  for (const c of music) args.push('-i', c.path);
  for (const c of sfx) args.push('-i', c.path);
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
      // the graph needs the channel count to upmix mono without the -3 dB
      usable.push(kind === 'audio' ? { ...c, channels: info.channels } : c);
    } catch (e) {
      const why = String(e.message || e).split('\n')[0];
      skipped.push({ name: c.name, path: c.path, reason: why });
      onLog(`[conform] ignorando ${c.name} — ${why}\n`);
    }
  }
  return { usable, skipped };
}

// Nothing checked the mix before this: a Reel is mixed for -14..-16 LUFS
// integrated, a loudness range a phone speaker can carry, and a true peak of
// -1..-2 dBTP after encoding. Two readings, both never fatal (a failed run or
// unexpected output gives nulls):
//   - the sum before the limiter: the master chain's astats branch prints it at
//     the end of the conform's own log. Same sample peak as the timeline meter,
//     read before any AAC.
//   - the finished file (what the Export reads): one ebur128 pass gives the
//     integrated loudness, the LRA and the true peak. Digital silence (I at the
//     -70 LUFS gate floor, peak -inf; JSON has no -Infinity) gives nulls.
const num1 = v => (/inf/.test(v) ? null : Math.round(parseFloat(v) * 10) / 10);
function parseMixPeak(stderr) {
  const all = [...String(stderr || '').matchAll(/Peak level dB:\s*(-?(?:inf|[\d.]+))/g)];
  return all.length ? num1(all[all.length - 1][1]) : null;
}
function parseLoudness(stderr) {
  const none = { lufs: null, lra: null, truePeakDb: null };
  const s = String(stderr || '');
  const at = s.lastIndexOf('Summary:');
  if (at < 0) return none;
  const sum = s.slice(at);
  const i = /\bI:\s*(-?(?:inf|[\d.]+))\s*LUFS/.exec(sum);
  const lufs = i ? num1(i[1]) : null;
  if (lufs == null || lufs <= -70) return none;
  const l = /\bLRA:\s*(-?(?:inf|[\d.]+))\s*LU\b/.exec(sum);
  const p = /True peak:\s*Peak:\s*(-?(?:inf|[\d.]+))\s*dBFS/.exec(sum);
  return { lufs, lra: l ? num1(l[1]) : null, truePeakDb: p ? num1(p[1]) : null };
}
async function measureLoudness(file, onLog = () => {}) {
  let log = '';
  try {
    await runFfmpeg(['-nostats', '-i', file, '-map', '0:a:0',
      '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { onLog: s => { log += s; } });
  } catch (e) {
    onLog(`[conform] loudness não medida — ${String(e.message || e).split('\n')[0]}\n`);
    return { lufs: null, lra: null, truePeakDb: null };
  }
  return parseLoudness(log);
}
// Target for a Reel: -14..-16 LUFS integrated. Reported, never applied to the mix.
function loudWarnOf(lufs) {
  if (lufs == null) return null;
  if (lufs < -16) return 'low';
  return lufs > -14 ? 'high' : null;
}
// True peak above -1 dBTP: the AAC pushed the file out of the delivery range.
function tpWarnOf(truePeakDb) {
  return truePeakDb != null && truePeakDb > -1 ? 'over' : null;
}
// LRA above 9 LU swings too wide for a phone speaker. Below 4 is not flagged:
// nearly every voice-led reel measures 1-4.
function lraWarnOf(lra) {
  return lra != null && lra > 9 ? 'high' : null;
}

async function conform({ base, segments = [], broll = [], music = [], sfx = [], mix = null,
  limiter = true, output, workDir, fit = 'blur', words = null, captionStyle = 'impact',
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
  const sfxAll = normalizeClips(sfx, duration, { withVolume: true });
  // Export = preview: what the mix silences is left out before the graph, and
  // reported back when it had something to leave out.
  const mixN = normalizeMix(mix);
  const excluded = [];
  if (info.acodec && !audible(mixN, 'audio')) excluded.push('audio');
  if (musicAll.length && !audible(mixN, 'music')) excluded.push('music');
  if (sfxAll.length && !audible(mixN, 'sfx')) excluded.push('sfx');
  onStage('probe', 'Checando os clipes da timeline');
  const b = await probeClips(brollAll, 'video', onLog);
  const m = await probeClips(audible(mixN, 'music') ? musicAll : [], 'audio', onLog);
  const x = await probeClips(audible(mixN, 'sfx') ? sfxAll : [], 'audio', onLog);

  onLog(`[conform] ${segs.length} segmento(s) de VÍDEO → ${duration.toFixed(2)}s ` +
    `(fonte ${info.duration.toFixed(2)}s) · ${b.usable.length} B-ROLL · ${m.usable.length} TRILHA · ` +
    `${x.usable.length} SFX${excluded.length ? ' · fora do export: ' + excluded.join(', ') : ''}\n`);

  const graph = buildConformGraph({
    segments: segs, broll: b.usable, music: m.usable, sfx: x.usable,
    hasAudio: !!info.acodec && audible(mixN, 'audio'), fit, duration, limiter,
  });
  const args = buildConformArgs({ base, broll: b.usable, music: m.usable, sfx: x.usable,
    graph, output, duration });

  onStage('conform', 'Conformando a timeline num mezanino');
  // the tail of this run's log carries the master chain's pre-limiter peak
  let runLog = '';
  await runFfmpeg(args, {
    onLog: s => { runLog = (runLog + s).slice(-16000); onLog(s); },
    onProgress: p => onProgress({ ...p, pct: Math.min(99, (p.time / duration) * 100) }),
  });
  const mixPeakDb = limiter ? parseMixPeak(runLog) : null;
  // how far the loudest peak went over the ceiling (approximate: the limiter
  // acts on the true peak, mixPeakDb is a sample peak)
  const cutDb = mixPeakDb == null ? null
    : Math.max(0, Math.round((mixPeakDb - MASTER_CEIL_DB) * 10) / 10);

  onStage('loudness', 'Medindo pico real, loudness e LRA');
  const { lufs, lra, truePeakDb } = await measureLoudness(output, onLog);
  const f1 = (v, unit) => (v == null ? 'n/d' : v.toFixed(1) + unit);
  onLog('[conform] ' + (limiter ? `mix antes do limitador: ${f1(mixPeakDb, ' dBFS')}` +
      (cutDb == null ? '' : ` (corte ${cutDb.toFixed(1)} dB)`) + ' · ' : '') +
    `pico real: ${f1(truePeakDb, ' dBTP')} · loudness: ${f1(lufs, ' LUFS')} · LRA: ${f1(lra, ' LU')}\n`);

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
    broll: b.usable.length, music: m.usable.length, sfx: x.usable.length,
    skipped: [...b.skipped, ...m.skipped, ...x.skipped],
    mix: mixN, excluded,
    mixPeakDb, limiter: limiter ? { ceilingDb: MASTER_CEIL_DB, cutDb } : null,
    truePeakDb, tpWarn: tpWarnOf(truePeakDb),
    lufs, loudWarn: loudWarnOf(lufs), lra, lraWarn: lraWarnOf(lra),
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
  normalizeMix, audible, measureLoudness, parseLoudness, parseMixPeak,
  loudWarnOf, tpWarnOf, lraWarnOf, MASTER_CEIL_DB,
};
