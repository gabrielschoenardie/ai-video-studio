// clipper.js — the runnable auto-clipper from the kit README:
//   1. hears + transcribes (Whisper, word-timed)
//   2. picks the moments (LLM if LLM_BASE_URL is set, offline hook-detector otherwise)
//   3. reframes to 9:16 with a moving crop that follows the subject
//   4. cuts + burns word-by-word captions
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { transcribe } = require('./transcribe');
const { writeAss, subFilter } = require('./captions');
const { runFfmpeg, mediaInfo } = require('./ffmpeg');

function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let tail = '';
    const grab = b => { const s = b.toString(); tail = (tail + s).slice(-4000); if (onLog) onLog(s); };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    p.on('error', reject);
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}\n${tail}`)));
  });
}

// ---------------------------------------------------------------- download
async function resolveSource(input, workDir, onLog) {
  if (/^https?:\/\//i.test(input)) {
    const out = path.join(workDir, 'source.%(ext)s');
    await run('yt-dlp', ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4', '-o', out, input], onLog);
    const found = fs.readdirSync(workDir).find(f => f.startsWith('source.'));
    if (!found) throw new Error('yt-dlp finished but no file was produced');
    return path.join(workDir, found);
  }
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  return input;
}

// ------------------------------------------------- offline hook detector
// Scores each transcript segment for clip-worthiness. Pattern classes taken
// from EDITING-CRAFT hook taxonomy: curiosity gaps, contrarian claims,
// numbers/specifics, direct address, payoff markers, quotability.
const HOOK_PATTERNS = [
  { re: /\b(how|why|what)\b.*\?/i, w: 3.0, tag: 'question hook' },
  { re: /\b(secret|hidden|nobody|no one|never|always|stop|mistake|wrong|truth|lie)\b/i, w: 2.5, tag: 'contrarian/curiosity' },
  { re: /\b(\d+[\d,.]*)\s*(%|percent|x|times|dollars|reais|million|billion|k)\b/i, w: 2.2, tag: 'specific number' },
  { re: /\b(you|your)\b/i, w: 1.2, tag: 'direct address' },
  { re: /\b(here'?s|this is|the (key|trick|point|problem)|turns out|actually)\b/i, w: 1.8, tag: 'payoff marker' },
  { re: /\b(imagine|picture this|listen|look)\b/i, w: 1.5, tag: 'attention grab' },
  { re: /\b(free|instantly|in seconds|zero|without)\b/i, w: 1.4, tag: 'benefit claim' },
  { re: /\b(but|however|except|until)\b/i, w: 0.8, tag: 'tension turn' },
];

function scoreSegment(seg) {
  let score = 0; const tags = [];
  for (const p of HOOK_PATTERNS) {
    if (p.re.test(seg.text)) { score += p.w; tags.push(p.tag); }
  }
  const dur = Math.max(seg.end - seg.start, 0.5);
  const wps = seg.text.split(/\s+/).length / dur;         // energy: words/sec
  if (wps > 2.2) score += 1.0;
  const len = seg.text.length;
  if (len > 20 && len < 140) score += 0.8;                // quotable length
  return { score, tags };
}

function offlineMoments(segments, { count = 3, minLen = 15, maxLen = 45, total }) {
  const scored = segments.map((s, i) => ({ ...s, i, ...scoreSegment(s) }));
  const picked = [];
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;

  for (const seed of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= count) break;
    // grow a window around the seed to the target length, snapping to segments
    let start = seed.start, end = seed.end, j = seed.i, k = seed.i;
    while (end - start < minLen && (j > 0 || k < segments.length - 1)) {
      const before = j > 0 ? segments[j - 1] : null;
      const after = k < segments.length - 1 ? segments[k + 1] : null;
      // prefer extending forward (payoff after the hook)
      if (after && (end - start) + (after.end - end) <= maxLen) { end = after.end; k++; }
      else if (before) { start = before.start; j--; }
      else break;
    }
    end = Math.min(end, start + maxLen, total || end);
    const win = { start: Math.max(0, start), end, score: seed.score,
      reason: seed.tags.length ? `offline hook-detector: ${seed.tags.join(', ')}` : 'offline hook-detector: pacing/energy',
      hookText: seed.text.slice(0, 120) };
    if (win.end - win.start >= Math.min(minLen, 8) && !picked.some(p => overlaps(p, win))) {
      picked.push(win);
    }
  }
  return picked.sort((a, b) => a.start - b.start);
}

// --------------------------------------------------- LLM moment picking
function llmChat(messages) {
  return new Promise((resolve, reject) => {
    const base = process.env.LLM_BASE_URL.replace(/\/$/, '');
    const url = new URL(base + '/chat/completions');
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages, temperature: 0.3,
    });
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).choices[0].message.content); }
        catch (e) { reject(new Error('LLM response parse failed: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LLM timeout')));
    req.end(body);
  });
}

async function llmMoments(segments, opts) {
  const lines = segments.map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  const content = await llmChat([
    { role: 'system', content:
      'You select short-form clip moments from long-video transcripts. ' +
      'Return ONLY a JSON array, no prose, no markdown fences. Each item: ' +
      '{"start": <sec>, "end": <sec>, "reason": "<why this is genuinely clip-worthy>"}. ' +
      `Pick up to ${opts.count} non-overlapping moments of ${opts.minLen}-${opts.maxLen} seconds. ` +
      'Real hooks, payoffs, quotable lines only — quality over quantity.' },
    { role: 'user', content: lines.slice(0, 60000) },
  ]);
  const clean = content.replace(/```json|```/g, '').trim();
  const arr = JSON.parse(clean);
  return arr
    .filter(m => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start)
    .map(m => ({ start: m.start, end: Math.min(m.end, m.start + opts.maxLen),
      reason: 'AI: ' + (m.reason || 'selected'), score: 10 }))
    .slice(0, opts.count)
    .sort((a, b) => a.start - b.start);
}

// ----------------------------------------------- subject-follow reframe
// Face/motion tracking via python3+OpenCV when available; the tracker emits
// keyframed crop centers, smoothed (EMA), and we build a piecewise-linear
// ffmpeg crop x(t) expression. Fallback: static center crop.
const TRACKER_PY = `
import sys, json
import cv2
src, step = sys.argv[1], float(sys.argv[2])
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
face = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
pts, t, ema = [], 0.0, W / 2
prev = None
while True:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok: break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cx = None
    faces = face.detectMultiScale(gray, 1.2, 5, minSize=(int(H*0.08), int(H*0.08)))
    if len(faces):
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        cx = fx + fw / 2
    elif prev is not None:
        diff = cv2.absdiff(gray, prev)
        _, th = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        m = cv2.moments(th)
        if m['m00'] > 1e4: cx = m['m10'] / m['m00']
    if cx is None: cx = ema
    ema = 0.65 * ema + 0.35 * cx        # smooth — no jitter cuts
    pts.append([round(t, 2), round(ema, 1)])
    prev = gray; t += step
print(json.dumps({"w": W, "h": H, "pts": pts}))
`;

async function trackCenters(input, workDir, onLog) {
  const py = path.join(workDir, 'track.py');
  fs.writeFileSync(py, TRACKER_PY);
  return new Promise((resolve) => {
    const p = spawn('python3', [py, input, '0.5']);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', () => resolve(null));
    p.on('close', c => {
      if (c !== 0) { if (onLog) onLog('[reframe] tracker unavailable, center crop: ' + err.split('\n')[0] + '\n'); return resolve(null); }
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

function cropExpr(track, cropW, srcW) {
  // piecewise-linear x(t) via nested if(lt(t,...)) + lerp — clamped to frame
  if (!track || track.pts.length < 2) return null;
  const pts = track.pts.map(([t, cx]) =>
    [t, Math.max(0, Math.min(srcW - cropW, cx - cropW / 2))]);
  let expr = pts[pts.length - 1][1].toFixed(1);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [t0, x0] = pts[i], [t1, x1] = pts[i + 1];
    const dt = Math.max(t1 - t0, 0.001);
    expr = `if(lt(t,${t1.toFixed(2)}),${x0.toFixed(1)}+(t-${t0.toFixed(2)})*${((x1 - x0) / dt).toFixed(3)},${expr})`;
  }
  return expr;
}

// -------------------------------------------------------------- clip job
async function clip(input, {
  workDir, outDir, mode = 'auto', reframe = true, count = 3,
  minLen = 15, maxLen = 45, whisperModel = 'base', language = null,
  captions = true, onLog = () => {}, onStage = () => {},
} = {}) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  onStage('download', 'Resolving source');
  const src = await resolveSource(input, workDir, onLog);
  const info = await mediaInfo(src);

  onStage('transcribe', 'Transcribing (Whisper, word-timed)');
  const tx = await transcribe(src, { model: whisperModel, language, workDir, onLog });
  fs.writeFileSync(path.join(outDir, 'transcript.json'), JSON.stringify(tx, null, 2));

  onStage('moments', 'Picking moments');
  let moments;
  const wantAI = mode === 'ai' || (mode === 'auto' && process.env.LLM_BASE_URL);
  if (wantAI && process.env.LLM_BASE_URL) {
    try {
      moments = await llmMoments(tx.segments, { count, minLen, maxLen });
      onLog(`[moments] AI selected ${moments.length}\n`);
    } catch (e) {
      onLog(`[moments] LLM failed (${e.message.split('\n')[0]}), falling back to offline detector\n`);
    }
  }
  if (!moments || !moments.length) {
    moments = offlineMoments(tx.segments, { count, minLen, maxLen, total: info.duration });
  }
  if (!moments.length) throw new Error('No clip-worthy moments found (transcript too short?)');

  // reframe geometry: 9:16 crop from source
  let track = null, cropW = null;
  const wantsReframe = reframe && info.width / info.height > 0.7; // already vertical? skip
  if (wantsReframe) {
    cropW = Math.round(info.height * 9 / 16 / 2) * 2;
    onStage('reframe', 'Tracking subject for 9:16 moving crop');
    track = await trackCenters(src, workDir, onLog);
  }

  const results = [];
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    onStage('cut', `Cutting clip ${i + 1}/${moments.length}`);
    const out = path.join(outDir, `clip-${String(i + 1).padStart(2, '0')}.mp4`);

    const vf = [];
    if (wantsReframe) {
      // shift track to clip-local time
      const local = track ? { ...track, pts: track.pts
        .filter(([t]) => t >= m.start - 1 && t <= m.end + 1)
        .map(([t, cx]) => [Math.max(0, t - m.start), cx]) } : null;
      const xe = cropExpr(local, cropW, info.width);
      vf.push(xe
        ? `crop=${cropW}:${info.height}:x='${xe}':y=0`
        : `crop=${cropW}:${info.height}:(iw-ow)/2:0`);
    }
    vf.push('scale=1080:1920:flags=lanczos', 'fps=30');

    if (captions) {
      const words = tx.words
        .filter(w => w.start >= m.start && w.end <= m.end + 0.3)
        .map(w => ({ ...w, start: Math.max(0, w.start - m.start), end: w.end - m.start }));
      if (words.length) {
        const clipDir = path.join(workDir, `clip-${i + 1}`);
        fs.mkdirSync(clipDir, { recursive: true });
        vf.push(subFilter(writeAss(words, clipDir)));
      }
    }

    await runFfmpeg([
      '-ss', m.start.toFixed(3), '-to', m.end.toFixed(3), '-i', src,
      '-vf', vf.join(','),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', out,
    ], { onLog });
    // NOTE: clips are working cuts (CRF 18 mezzanine). Final Instagram delivery
    // goes through the Export step (VBV profiles — Metodologia Gabriel).

    results.push({ file: out, start: m.start, end: m.end, reason: m.reason,
      hookText: m.hookText || null });
  }

  return { source: src, info, moments: results,
    picker: (wantAI && process.env.LLM_BASE_URL) ? 'llm' : 'offline-hook-detector',
    reframed: wantsReframe, tracked: !!track };
}

module.exports = { clip, offlineMoments, scoreSegment };
