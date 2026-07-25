# Plan — URL Video Downloader (best resolution) tool

**Owner (Orquestrador):** this file's non-Status sections. **Executor:** the `## Status` section only.

## Goal

Add a standalone "download a video from a URL at the best available resolution"
tool to the app: a new backend module `lib/download.js`, a `POST /api/download`
route in `server.js`, and a **DOWNLOAD** panel in the TOOLS nav group in
`public/index.html`. The download lands as a reusable video asset (usable by
every step + the Library).

## Global constraints (apply to every task)

- **Zero npm dependencies** in the backend — plain Node, `child_process` only.
- **Do NOT restart the server or run `node server.js`** — the Orquestrador
  handles restart + browser verification.
- **Do NOT commit** — git is handled separately by the git-workflow subagent.
- Match surrounding code style (2-space indent, `'use strict'`, single quotes,
  the existing `run()`/callback idioms).
- Do not touch any file not listed below. Do not add a `.gitignore` rule.

## Files to create / modify

- **Create:** `lib/download.js`
- **Modify:** `server.js` (add require + one route)
- **Modify:** `public/index.html` (nav button, section, `addAsset` branch, two JS handlers)

---

## Task 1 — Create `lib/download.js`

**File:** `lib/download.js` (new)

Write exactly this content:

```js
// download.js — fetch a video from a URL at the best available resolution
// via yt-dlp. Standalone source-acquisition tool (the auto-clipper caps at
// 1080p and always cuts; this keeps the full-resolution file as an asset).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Same spawn helper shape as lib/clipper.js: streams stdout+stderr to onLog,
// keeps a 4000-char tail for the error message, resolves only on exit 0.
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

// yt-dlp format selector per requested quality. 'best' is uncapped (true best
// available); the caps are convenience escape hatches for large 4K/8K sources.
const FORMATS = {
  best: 'bv*+ba/b',
  '1080': 'bv*[height<=1080]+ba/b[height<=1080]/b',
  '720': 'bv*[height<=720]+ba/b[height<=720]/b',
};

// download(url, opts) -> { file }  (absolute path to the produced .mp4)
//   opts: { outDir, quality='best', onLog, onProgress }
//   onProgress receives { pct:Number, speed:String|null } scraped from yt-dlp.
async function download(url, { outDir, quality = 'best', onLog, onProgress } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('download() needs an http(s) URL');
  fs.mkdirSync(outDir, { recursive: true });
  const fmt = FORMATS[quality] || FORMATS.best;
  const base = 'dl-' + path.basename(outDir);          // deterministic, ASCII-safe
  const out = path.join(outDir, base + '.%(ext)s');

  // Wrap onLog so it forwards raw text AND scrapes [download] NN% progress.
  const rx = /\[download\]\s+([\d.]+)%(?:.*?at\s+(\S+))?/;
  const tap = s => {
    if (onLog) onLog(s);
    if (onProgress) {
      const m = rx.exec(s);
      if (m) onProgress({ pct: parseFloat(m[1]), speed: m[2] || null });
    }
  };

  await run('yt-dlp', ['-f', fmt, '--merge-output-format', 'mp4', '-o', out, url], tap);

  const found = fs.readdirSync(outDir).find(f => f.startsWith(base + '.'));
  if (!found) throw new Error('yt-dlp finished but no file was produced');
  return { file: path.join(outDir, found) };
}

module.exports = { download };
```

**Acceptance:**
- `node -e "console.log(typeof require('./lib/download').download)"` prints `function`.
- `node -e "require('./lib/download').download('not-a-url',{outDir:'jobs/_t'}).catch(e=>console.log(e.message))"`
  prints `download() needs an http(s) URL`.

---

## Task 2 — Add the `/api/download` route in `server.js`

**File:** `server.js`

**2a.** Add the require. After line 18 (`const { encodeReel } = require('./lib/encode');`)
— or adjacent to the other `lib` requires (lines 13–19) — add:

```js
const { download } = require('./lib/download');
```

**2b.** Add the route. Immediately AFTER the closing `}` of the `/api/clip`
block (currently `server.js:214`), insert:

```js

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
```

Use the existing in-scope helpers `readJson`, `runJob`, `jstage`, `jlog`,
`emit`, `send`, `mediaInfo`, and the constants `JOBS_DIR`, `ROOT` — all already
present in `server.js`. Do not redefine them.

**Acceptance:**
- `node -e "require('./server.js')"` starts without a syntax/throw at load (it
  will begin listening — Ctrl-C to stop; the Orquestrador does the real restart).
  Alternatively `node --check server.js` exits 0.
- Grep confirms exactly one occurrence of `p === '/api/download'`.

---

## Task 3 — Add the DOWNLOAD panel + JS in `public/index.html`

**File:** `public/index.html`

**3a. Nav button.** In the TOOLS group, insert a new button BETWEEN the
`AUTO-CLIPPER` button (ends line 264 with `AUTO-CLIPPER</button>`) and the
`library` button (starts line 265 `<button data-step="library">`):

```html
  <button data-step="download">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
    DOWNLOAD</button>
```

**3b. Section.** Insert a new `<section>` BETWEEN the end of the clipper section
(`</section>` at line 426) and the `<!-- LIBRARY -->` comment (line 428):

```html

  <!-- DOWNLOAD -->
  <section class="step" id="step-download">
    <h2>⬇ / <em>DOWNLOAD</em></h2>
    <p class="sub">Paste a video URL and pull it down at the best available resolution (uncapped — unlike the auto-clipper's 1080p). The file lands in your Library, ready for any step.</p>
    <div class="card">
      <label for="dl-url">SOURCE — URL</label>
      <input type="text" id="dl-url" placeholder="https://…  (yt-dlp)">
      <div class="row">
        <div><label for="dl-quality">QUALITY</label><select id="dl-quality">
          <option value="best" selected>best available</option>
          <option value="1080">cap 1080p</option>
          <option value="720">cap 720p</option></select></div>
      </div>
      <button class="btn" onclick="doDownload()">RUN DOWNLOAD</button>
      <div id="dl-out"></div>
    </div>
  </section>
```

**3c. `addAsset` branch.** In `addAsset` (lines 481–488), add a `download`
branch. Change:

```js
  else if (a.source === 'clipper') markDone('clipper');
}
```
to:
```js
  else if (a.source === 'clipper') markDone('clipper');
  else if (a.source === 'download') markDone('download');
}
```

**3d. Handlers.** At the very end of the `<script>`, immediately AFTER the
`window.sendToExport` block (lines 748–751, right before `</script>` at line 752),
add:

```js
/* ---------------- downloader */
window.doDownload = async () => {
  try {
    const url = $('#dl-url').value.trim();
    if (!url) { stage('paste a URL to download', true); return; }
    const { job } = await api('/api/download', { url, quality: $('#dl-quality').value });
    const r = await watchJob(job);
    // Windows job paths come back with backslashes; normalize to '/' so the
    // filename split, the /files/ URL, and the onclick string literal are all safe.
    const out = r.output.replace(/\\/g, '/');
    const name = out.split('/').pop();
    $('#dl-out').innerHTML =
      `<div class="card" style="margin-top:12px">
         <h3>${name}${r.info ? ' — ' + r.info.width + '×' + r.info.height : ''}</h3>
         <video controls src="/files/${encodeURIComponent(out)}"></video>
         <button class="btn ghost" onclick="sendToClipper('${out}')">SEND TO CLIPPER →</button>
       </div>`;
    addAsset({ path: out, name, kind: 'video', info: r.info, source: 'download' });
  } catch (e) { stage(e.message, true); }
};
window.sendToClipper = (p) => {
  goStep('clipper');
  $('#clip-file').value = p;
};
```

> **Post-validation fix (Orquestrador, 2026-07-24):** the original snippet used
> `r.output` verbatim. On Windows `r.output` is `jobs\<id>\dl-<id>.mp4` — the
> backslashes (a) made `split('/').pop()` return the whole path as the display
> name and (b) corrupted the `onclick="sendToClipper('…')"` string literal
> (`\3`, `\d` parsed as JS escapes), breaking the SEND TO CLIPPER button. Fixed
> by normalizing to forward slashes once (`out`); `/files/` serving accepts both
> (verified: HTTP 200). This is the version now in the file.

**Acceptance:**
- Grep confirms one each of `id="step-download"`, `data-step="download"`,
  `window.doDownload`, `window.sendToClipper`, and the `a.source === 'download'`
  branch.
- The nav button HTML sits between `AUTO-CLIPPER</button>` and
  `<button data-step="library">`; the section sits between the clipper's
  `</section>` and `<!-- LIBRARY -->`.

---

## Overall acceptance criteria (verifiable)

1. `node --check server.js` exits 0; `lib/download.js` exports a `download`
   function (Task 1 acceptance commands pass).
2. Exactly one `POST` handler for `/api/download` in `server.js`, validating the
   URL with `/^https?:\/\//i` and returning `{ job: job.id }`.
3. `download()` uses `-f 'bv*+ba/b'` for `quality:'best'` (uncapped) and the
   `height<=1080` / `height<=720` selectors for the caps.
4. `public/index.html` has the nav button, `#step-download` section, the
   `download` `addAsset` branch, and `doDownload`/`sendToClipper` handlers,
   matching the existing `.card`/`.btn`/`.chip` conventions.
5. No new npm dependency added; no other files touched; nothing committed.

## Status

_(propriedade do Executor — updates incrementais durante a implementação)_

**2026-07-24 — Executor: implementação concluída.**

Arquivos tocados (exatamente os 3 previstos):
- `lib/download.js` — criado, conteúdo idêntico ao especificado na Task 1.
- `server.js` — require `const { download } = require('./lib/download');` adicionado
  logo após o require de `lib/score.js`; rota `POST /api/download` inserida
  imediatamente após o bloco `/api/clip`, antes do comentário `// Step 6 — score`.
- `public/index.html` — botão de nav `data-step="download"` inserido entre
  `AUTO-CLIPPER</button>` e `<button data-step="library">`; `<section id="step-download">`
  inserida entre o `</section>` do clipper e `<!-- LIBRARY -->`; branch
  `else if (a.source === 'download') markDone('download');` adicionado em `addAsset`;
  handlers `window.doDownload` e `window.sendToClipper` adicionados ao final do `<script>`,
  logo após o bloco `window.sendToExport`.

Comandos de aceite executados e resultados:
- `node -e "console.log(typeof require('./lib/download').download)"` → `function` (OK)
- `node -e "require('./lib/download').download('not-a-url',{outDir:'jobs/_t'}).catch(e=>console.log(e.message))"` → `download() needs an http(s) URL` (OK)
- `node --check server.js` → exit 0 (`SERVER_CHECK_OK` impresso) (OK)
- Grep `p === '/api/download'` em `server.js` → 1 ocorrência (OK, rota única)
- Grep `id="step-download"|data-step="download"|window\.doDownload|window\.sendToClipper|a\.source === 'download'`
  em `public/index.html` → 5 ocorrências totais (uma de cada padrão) (OK)

Desvios do plano: nenhum. Conteúdo de `lib/download.js` copiado literalmente do plano;
edits em `server.js` e `public/index.html` aplicados exatamente como especificado nas
âncoras de linha (que bateram com o estado atual dos arquivos antes da edição).

Não commitado (git fora de escopo do Executor). Servidor não foi reiniciado/executado
além dos comandos `node --check` e `node -e` de aceite, conforme restrição do plano.
`git status --porcelain` confirma que apenas `public/index.html`, `server.js` (modificados)
e `lib/download.js` (novo) foram tocados por esta tarefa; demais arquivos untracked
(`.mov`, `.cube`, `.mp4`, `docs/plans/url-video-downloader.md`) são pré-existentes/artefatos
de sessão do usuário, não produzidos por esta execução.
