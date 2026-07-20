#!/usr/bin/env node
// AI Video Studio — one-window local app server.
// Zero npm dependencies: plain Node http. Run:  node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

require('./lib/loadEnv').loadEnv();

const deps = require('./lib/deps');
const { mediaInfo } = require('./lib/ffmpeg');
const voiceover = require('./lib/voiceover');
const { assemble } = require('./lib/assemble');
const { clip } = require('./lib/clipper');
const { encodeReel } = require('./lib/encode');
const { score, TRIBE_INFO } = require('./lib/score');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '4870', 10);
const JOBS_DIR = path.join(ROOT, 'jobs');
const OUT_DIR = path.join(ROOT, 'output');
const UP_DIR = path.join(JOBS_DIR, 'uploads');
for (const d of [JOBS_DIR, OUT_DIR, UP_DIR]) fs.mkdirSync(d, { recursive: true });

// ------------------------------------------------------------- job bus
const jobs = new Map(); // id → {id, kind, state, stage, log[], result, error, listeners:Set}

function newJob(kind) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, kind, state: 'running', stage: 'starting', log: [],
    result: null, error: null, listeners: new Set(), started: Date.now() };
  jobs.set(id, job);
  return job;
}
function emit(job, ev, data) {
  const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.listeners) res.write(msg);
}
function jlog(job, s) {
  job.log.push(s);
  if (job.log.length > 800) job.log.splice(0, job.log.length - 800);
  emit(job, 'log', { s });
}
function jstage(job, stage, label) {
  job.stage = label || stage;
  emit(job, 'stage', { stage, label: job.stage });
}
function finish(job, result) {
  job.state = 'done'; job.result = result;
  emit(job, 'done', { result });
  for (const res of job.listeners) res.end();
}
function fail(job, err) {
  job.state = 'error'; job.error = String(err && err.message || err);
  emit(job, 'error', { error: job.error });
  for (const res of job.listeners) res.end();
}
function runJob(kind, fn) {
  const job = newJob(kind);
  fn(job).then(r => finish(job, r)).catch(e => { console.error(e); fail(job, e); });
  return job;
}

// ----------------------------------------------------------- utilities
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); return reject(new Error('body too large')); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function safeName(n) { return (n || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120); }
// only serve/consume files inside the project tree
function insideRoot(p) {
  const r = path.resolve(p);
  return r.startsWith(JOBS_DIR + path.sep) || r.startsWith(OUT_DIR + path.sep);
}
function resolveInput(p) {
  if (!p) throw new Error('missing input');
  if (/^https?:\/\//i.test(p)) return p;                 // URLs go to yt-dlp (clipper only)
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!insideRoot(abs) && !fs.existsSync(abs)) throw new Error('input not found');
  return abs;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveFile(res, file, download = false) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Accept-Ranges': 'bytes',
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

// -------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // static
    if (req.method === 'GET' && (p === '/' || p === '/index.html'))
      return serveFile(res, path.join(ROOT, 'public', 'index.html'));
    if (req.method === 'GET' && p.startsWith('/files/')) {
      const rel = decodeURIComponent(p.slice(7));
      const abs = path.resolve(ROOT, rel);
      if (!insideRoot(abs)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(res, abs, url.searchParams.has('dl'));
    }

    // engines
    if (req.method === 'GET' && p === '/api/deps')
      return send(res, 200, await deps.detect());

    // upload (raw body, filename in query — no multipart needed)
    if (req.method === 'POST' && p === '/api/upload') {
      const name = safeName(url.searchParams.get('name'));
      const dest = path.join(UP_DIR, Date.now() + '-' + name);
      const ws = fs.createWriteStream(dest);
      req.pipe(ws);
      await new Promise((ok, bad) => { ws.on('finish', ok); ws.on('error', bad); req.on('error', bad); });
      let info = null;
      try { info = await mediaInfo(dest); } catch { /* non-media upload (e.g. .cube LUT) */ }
      return send(res, 200, { path: path.relative(ROOT, dest), info });
    }

    // probe an already-uploaded file
    if (req.method === 'POST' && p === '/api/probe') {
      const { input } = await readJson(req);
      return send(res, 200, await mediaInfo(resolveInput(input)));
    }

    // voice picker — the pt-BR presets Voicebox ships with
    if (req.method === 'GET' && p === '/api/voices')
      return send(res, 200, { voices: voiceover.VOICEBOX_PT_VOICES });

    // Step 4 — voiceover
    if (req.method === 'POST' && p === '/api/voiceover') {
      const { script, refVoice, voice } = await readJson(req);
      if (!script || !script.trim()) return send(res, 400, { error: 'empty script' });
      const job = runJob('voiceover', async (job) => {
        const dir = path.join(JOBS_DIR, job.id); fs.mkdirSync(dir, { recursive: true });
        jstage(job, 'tts', 'Generating narration locally');
        const r = await voiceover.generate(script, dir, {
          refVoice: refVoice ? resolveInput(refVoice) : null, voice: voice || null, onLog: s => jlog(job, s) });
        return { engine: r.engine, file: path.relative(ROOT, r.file) };
      });
      return send(res, 200, { job: job.id });
    }

    // Step 5 — assemble
    if (req.method === 'POST' && p === '/api/assemble') {
      const b = await readJson(req);
      const job = runJob('assemble', async (job) => {
        const dir = path.join(JOBS_DIR, job.id); fs.mkdirSync(dir, { recursive: true });
        const out = path.join(OUT_DIR, `assembled-${job.id}.mp4`);
        const r = await assemble({
          visual: resolveInput(b.visual),
          voiceover: b.voiceover ? resolveInput(b.voiceover) : null,
          workDir: dir, output: out,
          captions: b.captions !== false, captionStyle: b.captionStyle || 'impact',
          whisperModel: b.whisperModel || 'base', language: b.language || null,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
        });
        return { ...r, output: path.relative(ROOT, r.output) };
      });
      return send(res, 200, { job: job.id });
    }

    // Clipper
    if (req.method === 'POST' && p === '/api/clip') {
      const b = await readJson(req);
      const job = runJob('clip', async (job) => {
        const dir = path.join(JOBS_DIR, job.id); fs.mkdirSync(dir, { recursive: true });
        const outDir = path.join(OUT_DIR, `clips-${job.id}`);
        const r = await clip(resolveInput(b.input), {
          workDir: dir, outDir,
          mode: b.mode || 'auto', reframe: b.reframe !== false,
          count: Math.min(parseInt(b.count || 3, 10), 8),
          minLen: b.minLen || 15, maxLen: b.maxLen || 45,
          whisperModel: b.whisperModel || 'base', language: b.language || null,
          captions: b.captions !== false,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
        });
        r.moments = r.moments.map(m => ({ ...m, file: path.relative(ROOT, m.file) }));
        delete r.source;
        return r;
      });
      return send(res, 200, { job: job.id });
    }

    // Step 6 — score
    if (req.method === 'POST' && p === '/api/score') {
      const b = await readJson(req);
      const job = runJob('score', async (job) => {
        jstage(job, 'score', 'Building attention curve');
        return await score(resolveInput(b.input));
      });
      return send(res, 200, { job: job.id });
    }
    if (req.method === 'GET' && p === '/api/tribe-info')
      return send(res, 200, TRIBE_INFO);

    // Step 7 — export (Instagram delivery, Metodologia Gabriel)
    if (req.method === 'POST' && p === '/api/export') {
      const b = await readJson(req);
      const job = runJob('export', async (job) => {
        const input = resolveInput(b.input);
        const out = path.join(OUT_DIR, `reel-${job.id}.mp4`);
        jstage(job, 'encode', 'Delivery encode — VBV profile by duration');
        const r = await encodeReel(input, out, {
          lut: b.lut ? resolveInput(b.lut) : null,
          denoise: b.denoise || null,
          x264: b.x264 || {},
          onLog: s => jlog(job, s),
          onProgress: pr => emit(job, 'progress', pr),
        });
        return { ...r, output: path.relative(ROOT, out) };
      });
      return send(res, 200, { job: job.id });
    }

    // Remotion render (Step 3 — visuals), if the remotion project is installed
    if (req.method === 'POST' && p === '/api/remotion/render') {
      const { composition = 'AutoKillReel' } = await readJson(req);
      if (!/^[\w-]+$/.test(composition)) return send(res, 400, { error: 'bad composition id' });
      const projDir = path.join(ROOT, 'remotion');
      if (!fs.existsSync(path.join(projDir, 'node_modules'))) {
        return send(res, 409, { error: 'Remotion project not installed. Run: cd remotion && npm install' });
      }
      const job = runJob('remotion', async (job) => {
        const out = path.join(OUT_DIR, `visual-${composition}-${job.id}.mp4`);
        jstage(job, 'render', `Rendering composition ${composition}`);
        await new Promise((ok, bad) => {
          const pr = spawn('npx', ['remotion', 'render', composition, out], { cwd: projDir });
          pr.stdout.on('data', d => jlog(job, d.toString()));
          pr.stderr.on('data', d => jlog(job, d.toString()));
          pr.on('error', bad);
          pr.on('close', c => c === 0 ? ok() : bad(new Error('remotion exit ' + c)));
        });
        return { output: path.relative(ROOT, out) };
      });
      return send(res, 200, { job: job.id });
    }

    // job state + SSE
    const mJob = /^\/api\/jobs\/([a-f0-9]+)(\/events)?$/.exec(p);
    if (req.method === 'GET' && mJob) {
      const job = jobs.get(mJob[1]);
      if (!job) return send(res, 404, { error: 'no such job' });
      if (!mJob[2]) {
        return send(res, 200, { id: job.id, kind: job.kind, state: job.state,
          stage: job.stage, error: job.error, result: job.result,
          log: job.log.slice(-60).join('') });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: stage\ndata: ${JSON.stringify({ stage: job.stage, label: job.stage })}\n\n`);
      if (job.state !== 'running') {
        res.write(`event: ${job.state === 'done' ? 'done' : 'error'}\ndata: ${
          JSON.stringify(job.state === 'done' ? { result: job.result } : { error: job.error })}\n\n`);
        return res.end();
      }
      job.listeners.add(res);
      req.on('close', () => job.listeners.delete(res));
      return;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │   AI VIDEO STUDIO — one window, all local   │');
  console.log(`  │   open →  http://localhost:${PORT}             │`);
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
});
