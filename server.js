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
const { score } = require('./lib/score');
const { download } = require('./lib/download');
const { writeAss } = require('./lib/captions');
const { conform } = require('./lib/timeline');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '4870', 10);
const JOBS_DIR = path.join(ROOT, 'jobs');
const OUT_DIR = path.join(ROOT, 'output');
const UP_DIR = path.join(JOBS_DIR, 'uploads');
const LUTS_DIR = path.join(ROOT, 'luts'); // persistent 3D .cube library, picked at export
// Build artifacts committed to the repo (the Player bundle). Not a media dir —
// deliberately outside insideRoot(), which gates client-supplied media paths.
const VENDOR_DIR = path.join(ROOT, 'public', 'vendor');
for (const d of [JOBS_DIR, OUT_DIR, UP_DIR, LUTS_DIR]) fs.mkdirSync(d, { recursive: true });

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
  return r.startsWith(JOBS_DIR + path.sep) || r.startsWith(OUT_DIR + path.sep)
    || r.startsWith(LUTS_DIR + path.sep);
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

// Parse a single-range `Range: bytes=A-B` header against a known file size.
// Returns null when there is no range to honour (absent/!bytes/multi-range —
// serving the whole file is always a valid answer to those), or {start,end}
// clamped into the file, or 'unsatisfiable' when the range falls outside it.
// Suffix form (`bytes=-500` = last 500 bytes) and open-ended form
// (`bytes=500-`) both appear in real players, so both are handled.
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;                              // multi-range or malformed
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  let start, end;
  if (rawStart === '') {                            // bytes=-N → last N bytes
    const n = parseInt(rawEnd, 10);
    if (n <= 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
    if (start >= size) return 'unsatisfiable';
    end = Math.min(end, size - 1);
    if (end < start) return 'unsatisfiable';
  }
  return { start, end };
}

// Honouring Range is not a nicety here: the TIMELINE preview seeks
// frame-accurately, and a 200-only server makes every seek refetch the file
// from byte 0. Without a Range header the 200 path is byte-identical to before.
function serveFile(req, res, file, download = false) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const disposition = download
      ? { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` } : {};
    const range = parseRange(req && req.headers && req.headers.range, st.size);

    if (range === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Accept-Ranges': 'bytes' });
      return res.end();
    }
    if (range) {
      const { start, end } = range;
      res.writeHead(206, {
        'Content-Type': type, 'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes', ...disposition,
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': st.size,
      'Accept-Ranges': 'bytes', ...disposition,
    });
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
      return serveFile(req, res, path.join(ROOT, 'public', 'index.html'));
    if (req.method === 'GET' && p.startsWith('/files/')) {
      const rel = decodeURIComponent(p.slice(7));
      const abs = path.resolve(ROOT, rel);
      if (!insideRoot(abs)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(req, res, abs, url.searchParams.has('dl'));
    }

    // Bundle do Player (artefato buildado em remotion/, commitado em public/vendor/).
    // Allowlist por regex — não passa por resolveInput()/insideRoot(), que valem
    // para mídia vinda do cliente. O nome casado não pode conter '/', então '..'
    // nunca forma um segmento de traversal; o startsWith é cinto e suspensório.
    const mVendor = /^\/vendor\/([A-Za-z0-9._-]+\.js)$/.exec(p);
    if (req.method === 'GET' && mVendor) {
      const abs = path.resolve(VENDOR_DIR, mVendor[1]);
      if (!abs.startsWith(VENDOR_DIR + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(req, res, abs);
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

    // LUT library — .cube files the user drops in luts/, picked at export
    if (req.method === 'GET' && p === '/api/luts') {
      const files = fs.readdirSync(LUTS_DIR)
        .filter(f => /\.cube$/i.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map(f => ({ name: f, path: path.relative(ROOT, path.join(LUTS_DIR, f)) }));
      return send(res, 200, { luts: files });
    }

    // Presets de legenda — espelha /api/luts: lê o arquivo de config e devolve
    // o que existe. A UI monta o select a partir disto, então acrescentar um
    // preset ao JSON o faz aparecer sem tocar código.
    if (req.method === 'GET' && p === '/api/caption-styles') {
      const mod = require('./lib/captions');
      const styles = mod.styleNames().map(name => ({ name }));
      // ?full=1 devolve os tokens inteiros — o overlay do preview precisa de
      // cor, itálico e posição, não só dos nomes.
      if (url.searchParams.get('full')) {
        const byName = {};
        for (const n of mod.styleNames()) byName[n] = mod.resolveStyle(n);
        return send(res, 200, { styles, byName });
      }
      return send(res, 200, { styles });
    }

    // Beats sidecar — rótulo manual de segmentos narrativos ao lado do vídeo.
    // Não usa o job bus: leitura/escrita síncrona de um JSON pequeno.
    function beatsSidecar(videoPath) {
      const abs = resolveInput(videoPath);
      const sidecar = path.join(path.dirname(abs),
        path.basename(abs, path.extname(abs)) + '.beats.json');
      if (!insideRoot(sidecar)) throw new Error('invalid beats path');
      return sidecar;
    }
    if (req.method === 'GET' && p === '/api/beats') {
      try {
        const video = url.searchParams.get('video');
        if (!video) return send(res, 400, { error: 'missing video' });
        const sidecar = beatsSidecar(video);
        if (!fs.existsSync(sidecar)) return send(res, 200, { beats: null });
        return send(res, 200, { beats: JSON.parse(fs.readFileSync(sidecar, 'utf8')) });
      } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && p === '/api/beats') {
      const b = await readJson(req);
      if (!b.video || !Array.isArray(b.beats))
        return send(res, 400, { error: 'missing video or beats[]' });
      const sidecar = beatsSidecar(b.video);
      // v3 adds `segments`: the VÍDEO track's own cuts, as {srcIn,dur} in
      // timeline order. Their position is implicit in the order — that is what
      // makes a delete ripple. An absent or empty array means "the whole
      // media, untouched", which is exactly how a v2 sidecar reads.
      const payload = { version: 3, video: b.video, duration: b.duration || null,
        beats: b.beats, segments: Array.isArray(b.segments) ? b.segments : [],
        broll: Array.isArray(b.broll) ? b.broll : [],
        music: Array.isArray(b.music) ? b.music : [], updatedAt: new Date().toISOString() };
      fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: path.relative(ROOT, sidecar) });
    }

    // Captions — resolve o job dir de um vídeo montado (mesma convenção
    // de nome já usada por /api/assemble: output/assembled-<id>.mp4 ↔
    // jobs/<id>/). Usado pra ler/corrigir o transcript.json que alimenta
    // o .ass, sem depender de estado de sessão no cliente.
    function jobDirForVideo(videoRelPath) {
      const m = path.basename(String(videoRelPath || '')).match(/^assembled-([a-f0-9]+)\.mp4$/);
      if (!m) return null;
      const dir = path.join(JOBS_DIR, m[1]);
      return fs.existsSync(path.join(dir, 'transcript.json')) ? dir : null;
    }
    function captionStyleOf(dir) {
      try {
        const assText = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
        // Marca explícita, gravada por buildAss — exata.
        const m = /^;\s*studio-style:\s*(\S+)\s*$/m.exec(assText);
        if (m) return m[1];
        // Fallback para .ass gerados antes da marca existir. Heurístico por
        // construção; não estenda para presets novos.
        if (/Arial Black/.test(assText)) return 'impact';
        if (/Style:\s*Word,Arial,/.test(assText)) return 'clean';
      } catch (e) { /* fall through */ }
      return 'impact';
    }
    if (req.method === 'GET' && p === '/api/captions') {
      const video = url.searchParams.get('video') || '';
      const dir = jobDirForVideo(video);
      if (!dir) return send(res, 200, { words: [], style: null });
      const words = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8')).words;
      return send(res, 200, { words, style: captionStyleOf(dir) });
    }
    if (req.method === 'POST' && p === '/api/captions/word') {
      const b = await readJson(req);
      const dir = jobDirForVideo(b.video);
      if (!dir) return send(res, 404, { error: 'sem legenda para este vídeo' });
      const txPath = path.join(dir, 'transcript.json');
      const tx = JSON.parse(fs.readFileSync(txPath, 'utf8'));
      const w = tx.words[b.index];
      if (!w || Math.abs(w.start - b.start) > 0.01) {
        return send(res, 409, { error: 'legenda mudou desde que a página carregou — recarregue' });
      }
      // Texto e destaque são edições independentes: o corpo pode trazer uma,
      // outra, ou as duas. `newText` ausente mantém a palavra como está.
      if (typeof b.newText === 'string') {
        const newWord = b.newText.trim();
        if (!newWord) return send(res, 400, { error: 'palavra não pode ficar vazia' });
        w.word = newWord;
      }
      if (typeof b.hl === 'boolean') {
        if (b.hl) w.hl = true; else delete w.hl;
      }
      // "uma, outra, ou as duas" — nenhuma não está previsto. Sem isto, um corpo
      // vazio virava no-op com I/O: 200 e reescrita do .ass sem nada ter mudado.
      if (typeof b.newText !== 'string' && typeof b.hl !== 'boolean') {
        return send(res, 400, { error: 'nada para atualizar — informe newText e/ou hl' });
      }
      fs.writeFileSync(txPath, JSON.stringify(tx, null, 2));
      writeAss(tx.words, dir, { style: captionStyleOf(dir) });
      return send(res, 200, { words: tx.words });
    }

    // Timeline conform — flattens the step-04 sidecar (VÍDEO segment cuts,
    // B-ROLL, TRILHA) into a real 4:4:4 CRF-12 mezzanine. This is the only
    // path by which the timeline reaches the exported file: the browser's
    // preview compositor is a preview, not a render. The output is meant to be
    // fed to /api/export as `sourceKind: 'mezzanine'`.
    if (req.method === 'POST' && p === '/api/timeline/conform') {
      const b = await readJson(req);
      if (!b.video) return send(res, 400, { error: 'missing video' });
      let base, tl;
      try {
        base = resolveInput(b.video);
        const sidecar = beatsSidecar(b.video);
        if (!fs.existsSync(sidecar))
          return send(res, 409, { error: 'sem timeline salva para este vídeo — clique SALVAR BEATS primeiro' });
        tl = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
      } catch (e) { return send(res, 400, { error: String(e.message || e) }); }

      // Every clip path in the sidecar goes back through resolveInput: the
      // file is client-written, so it is exactly as untrusted as a request body.
      let broll, music;
      try {
        const resolveClips = (arr) => (Array.isArray(arr) ? arr : []).map(c =>
          ({ ...c, path: resolveInput(c.path) }));
        broll = resolveClips(tl.broll);
        music = resolveClips(tl.music);
      } catch (e) { return send(res, 400, { error: 'clipe fora do diretório permitido: ' + String(e.message || e) }); }

      // Caption words follow the cuts — lib/timeline reprojects them and
      // writes a fresh .ass, because the pre-conform one desyncs by the cut.
      const capDir = jobDirForVideo(b.video);
      let words = null, captionStyle = 'impact';
      if (capDir) {
        try {
          words = JSON.parse(fs.readFileSync(path.join(capDir, 'transcript.json'), 'utf8')).words;
          captionStyle = captionStyleOf(capDir);
        } catch (e) { words = null; }
      }

      const job = runJob('conform', async (job) => {
        const dir = path.join(JOBS_DIR, job.id); fs.mkdirSync(dir, { recursive: true });
        const out = path.join(OUT_DIR, `conformed-${job.id}.mp4`);
        const r = await conform({
          base, segments: tl.segments || [], broll, music,
          output: out, workDir: dir, fit: b.fit || 'blur',
          words, captionStyle,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
          onProgress: pr => emit(job, 'progress', pr),
        });
        return { ...r, output: path.relative(ROOT, out),
                 ass: r.ass ? path.relative(ROOT, path.resolve(r.ass)) : null };
      });
      return send(res, 200, { job: job.id });
    }

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
          burnCaptions: b.burnCaptions === true,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
        });
        return { ...r, output: path.relative(ROOT, r.output),
                 ass: r.ass ? path.relative(ROOT, path.resolve(r.ass)) : null };
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

    // URL downloader — best-resolution source fetch (yt-dlp)
    if (req.method === 'POST' && p === '/api/download') {
      const b = await readJson(req);
      if (!b.url || !/^https?:\/\//i.test(b.url))
        return send(res, 400, { error: 'give a http(s) URL' });
      const job = runJob('download', async (job) => {
        const dir = path.join(JOBS_DIR, job.id); fs.mkdirSync(dir, { recursive: true });
        jstage(job, 'download', 'Fetching best-resolution source');
        const r = await download(b.url, {
          outDir: dir, quality: b.quality || 'best',
          onLog: s => jlog(job, s),
          onProgress: pr => emit(job, 'progress', pr),
        });
        let info = null; try { info = await mediaInfo(r.file); } catch {}
        return { output: path.relative(ROOT, r.file), info };
      });
      return send(res, 200, { job: job.id });
    }

    // Score — curva de atenção (sem UI; chamável por curl)
    if (req.method === 'POST' && p === '/api/score') {
      const b = await readJson(req);
      const job = runJob('score', async (job) => {
        jstage(job, 'score', 'Building attention curve');
        return await score(resolveInput(b.input));
      });
      return send(res, 200, { job: job.id });
    }

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
          fit: b.fit || 'blur',
          captions: b.captions ? resolveInput(b.captions) : null,
          grade: b.grade === 'none' ? 'none' : 'plate',
          dither: typeof b.dither === 'string' ? b.dither : 'random',
          sourceKind: b.sourceKind === 'mezzanine' ? 'mezzanine' : 'external',
          reference: b.reference ? resolveInput(b.reference) : null,
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
        const out = path.join(OUT_DIR, `visual-${composition}-${job.id}.mov`);
        jstage(job, 'render', `Rendering composition ${composition}`);
        await new Promise((ok, bad) => {
          // Windows: npx is npx.cmd, and spawning .cmd requires a shell
          // (plain spawn('npx') throws ENOENT / EINVAL). Args are safe to
          // join for the shell: composition is ^[\w-]+$-validated and out
          // is quoted in case the install path contains spaces.
          // ProRes HQ output (no codec flags = Remotion's default H.264,
          // the first of three lossy generations before the Export encode).
          const win = process.platform === 'win32';
          const args = ['remotion', 'render', composition, win ? `"${out}"` : out,
            '--codec=prores', '--prores-profile=hq'];
          const pr = spawn(win ? 'npx.cmd' : 'npx', args, { cwd: projDir, shell: win });
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
