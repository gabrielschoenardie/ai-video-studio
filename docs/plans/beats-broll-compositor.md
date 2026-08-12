# Plan — B-ROLL/TRILHA compositor no step BEATS (preview ao vivo)

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Spec de referência:** `docs/superpowers/specs/2026-08-12-beats-broll-compositor-design.md` (brainstorm aprovado pelo usuário — leia antes de executar, explica o *porquê* das decisões abaixo).

**Pré-requisito:** `docs/plans/beat-timeline-editor.md` já executado e commitado (`9ff7538`) — o step BEATS (tracks BEATS/ÁUDIO/LEGENDA, transport J/K/L, snap, undo/redo, persistência via `.beats.json`) já existe e funciona em `public/index.html`.

## Goal

Adicionar 2 tracks novas ao step BEATS — **B-ROLL** (cutaways visuais) e **TRILHA** (música de
fundo) — com clipes livremente posicionáveis/aparáveis na timeline absoluta do vídeo montado
(como numa NLE), e um **preview ao vivo real**: dar play faz o preview trocar pro B-ROLL certo
no tempo certo e voltar, sem travar, com a narração do vídeo principal e a música tocando juntas.

**Decisões de escopo (vêm da spec, não repita perguntas já respondidas):**
- Só preview + manifesto (`.beats.json` v2). **Nenhum passo de render/export real** é adicionado
  aqui — gerar o MP4 final com os cutaways embutidos fica pra um plano futuro de EXPORT.
- Clipes vêm só de upload manual (array `assets` já existente) — nenhuma integração com
  `clipper.js`, nenhum dado inventado/posicionado automaticamente.
- Preview funciona durante **playback contínuo real** (não só scrub), via `<canvas>` +
  `drawImage` de múltiplos `<video>`/`<audio>` tocando em paralelo — sem Web Audio API/
  `AudioContext`, o navegador já mixa elementos de mídia concorrentes sozinho.
- B-ROLL ativo troca só a imagem — o áudio do vídeo principal (narração) continua tocando por
  baixo. O `<video>` de cada clipe de B-ROLL toca sempre mudo.
- TRILHA suporta múltiplos clipes posicionáveis/aparáveis (não um único arquivo full-length),
  com volume por clipe.
- Isso entra como 2 tracks a mais no MESMO step BEATS (não um step novo na pipeline).

## Global constraints

- **Só `server.js` e `public/index.html`.** Não tocar `lib/assemble.js`, `lib/encode.js`,
  `lib/clipper.js`, `lib/color.js`, `lib/vmaf.js`, `remotion/`, `clipper/`.
- Zero deps novas — tudo vanilla JS/CSS/Canvas dentro do `public/index.html` existente. Não
  criar arquivo `.js` separado (mesma razão do plano anterior: não há rota estática genérica).
- Reaproveitar os design tokens já existentes (`--bg`, `--panel`, `--panel2`, `--line`,
  `--line-soft`, `--ink`, `--dim`, `--faint`, `--go`/`--go-dim`, `--warn`, `--mono`, `--sans`,
  `--radius-sm`). **Não introduzir paleta nova** (nada de cor "violeta"/"destaque" inventada).
- Não renumerar/alterar nada do `STEP_ORDER` — este plano não mexe em steps, só no conteúdo
  interno do step `beats` já existente.
- Não restart do servidor, não `npm install`, não commit — Orquestrador cuida disso depois.
- Preservar tudo que VISUALS, VOICE, ASSEMBLE, EXPORT, CLIPPER, DOWNLOAD, LIBRARY e o resto do
  BEATS (tracks BEATS/ÁUDIO/LEGENDA, transport, snap, undo/redo) já fazem.

## Files

- **Modify:** `server.js` (schema v2 do sidecar `.beats.json` — aceitar/devolver `broll[]` e
  `music[]`)
- **Modify:** `public/index.html` (CSS novo, scaffold HTML de 2 tracks em `buildDom()`, estado/
  render/persistência (`BROLL`, `MUSIC`), interações de drag/trim/delete, motor de compositing
  ao vivo)

---

## Task 1 — `server.js`: sidecar `.beats.json` schema v2

Localize o handler `POST /api/beats` (hoje, depois do commit `9ff7538`):

```js
    if (req.method === 'POST' && p === '/api/beats') {
      const b = await readJson(req);
      if (!b.video || !Array.isArray(b.beats))
        return send(res, 400, { error: 'missing video or beats[]' });
      const sidecar = beatsSidecar(b.video);
      const payload = { version: 1, video: b.video, duration: b.duration || null,
        beats: b.beats, updatedAt: new Date().toISOString() };
      fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: path.relative(ROOT, sidecar) });
    }
```

Substituir por:

```js
    if (req.method === 'POST' && p === '/api/beats') {
      const b = await readJson(req);
      if (!b.video || !Array.isArray(b.beats))
        return send(res, 400, { error: 'missing video or beats[]' });
      const sidecar = beatsSidecar(b.video);
      const payload = { version: 2, video: b.video, duration: b.duration || null,
        beats: b.beats, broll: Array.isArray(b.broll) ? b.broll : [],
        music: Array.isArray(b.music) ? b.music : [], updatedAt: new Date().toISOString() };
      fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: path.relative(ROOT, sidecar) });
    }
```

O handler `GET /api/beats` **não muda** — já devolve o JSON salvo por inteiro (`beats:
JSON.parse(fs.readFileSync(sidecar, 'utf8'))`), então `broll`/`music` chegam ao cliente de graça
assim que existirem no arquivo.

**Acceptance:**
- `node --check server.js` → exit 0.
- `curl -s -X POST localhost:4870/api/beats -H 'content-type: application/json' -d
  '{"video":"output/<algum-arquivo-real>.mp4","duration":8,"beats":[{"label":"CORTE","start":0,"dur":8}],"broll":[{"path":"jobs/uploads/x.mp4","name":"x.mp4","start":1,"dur":2}],"music":[{"path":"jobs/uploads/y.mp3","name":"y.mp3","start":0,"dur":8,"volume":0.5}]}'`
  → `{"ok":true,...}`, e o arquivo `.beats.json` gravado contém `"version":2` e os arrays
  `broll`/`music` intactos.
- Uma chamada `POST` **sem** `broll`/`music` (formato antigo, como o plano anterior gerava)
  continua funcionando — sidecar grava `"broll":[],"music":[]`.
- `curl -s "localhost:4870/api/beats?video=..."` devolve o mesmo JSON salvo, incluindo os
  arrays novos.

---

## Task 2 — `public/index.html`: CSS das tracks/clipes novos

Adicionar, logo antes do `</style>` (depois do bloco `.bt-pop .row2 button.primary{...}` já
existente):

```css
.bt-video-wrap{position:relative}
.bt-video-wrap canvas{position:absolute; inset:0; width:100%; height:100%}
.bt-clip{position:absolute; top:5px; bottom:5px; border-radius:5px; cursor:grab;
  display:flex; align-items:center; gap:6px; padding:0 8px; overflow:hidden;
  border:1px solid var(--line); background:var(--panel2)}
.bt-clip.broll{border-left:3px solid var(--go)}
.bt-clip.music{border-left:3px solid var(--warn)}
.bt-clip.selected{outline:2px solid var(--go); outline-offset:-2px}
.bt-clip.dragging{opacity:.45; cursor:grabbing}
.bt-clip .nm{font:600 9.5px var(--sans); color:var(--ink); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:1}
.bt-clip-vol{width:46px; flex:0 0 auto}
.bt-handle.left{left:-2px}
.bt-asset-list{display:flex; flex-direction:column; gap:3px; max-height:180px; overflow:auto;
  margin-bottom:8px}
.bt-asset-opt{all:unset; cursor:pointer; font:500 10px var(--sans); color:var(--dim);
  border:1px solid var(--line); border-radius:4px; padding:6px 8px; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis}
.bt-asset-opt:hover{color:var(--go); border-color:rgba(251,191,36,.5)}
```

Nota: `.bt-video-wrap` já existe com `width:220px; flex:0 0 auto; ...; overflow:hidden;
aspect-ratio:9/16` — a regra `.bt-video-wrap{position:relative}` acima é uma declaração
**adicional** que o CSS resolve por especificidade/ordem normalmente (não precisa editar a regra
original, só adicionar essa depois dela). `.bt-handle{...}` e `.bt-handle.right{right:-2px}` já
existem (usados pelos beats) — `.bt-handle.left` é só o complemento simétrico, novo.

**Acceptance:** nenhuma mudança visual em nenhum outro step/track existente (todas as classes
novas têm prefixo `bt-` e são aditivas). Abrir BEATS não deve gerar erro de CSS parsing.

---

## Task 3 — `public/index.html`: scaffold das 2 tracks novas em `buildDom()`

Dentro da função `buildDom()`, dois pontos mudam no template literal:

**3a. Canvas no preview.** Trocar:

```html
      <div class="bt-preview">
        <div class="bt-video-wrap"><video id="bt-video" src="/files/${encodeURIComponent(currentPath.replace(/\\/g, '/'))}"></video></div>
        <div class="bt-legend" id="bt-legend-list"></div>
      </div>
```

por:

```html
      <div class="bt-preview">
        <div class="bt-video-wrap"><video id="bt-video" src="/files/${encodeURIComponent(currentPath.replace(/\\/g, '/'))}"></video><canvas id="bt-canvas"></canvas></div>
        <div class="bt-legend" id="bt-legend-list"></div>
      </div>
```

**3b. Duas tracks novas.** Trocar o bloco `.bt-tracks` (a track LEGENDA já existe, fica igual —
só adiciona 2 rows depois dela, antes do `</div>` que fecha `.bt-tracks`):

```html
            <div class="bt-track-row" data-track="legend">
              <div class="bt-track-label"><span class="ic">T</span><span class="nm">LEGENDA</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-legend"></div>
            </div>
          </div>
```

por:

```html
            <div class="bt-track-row" data-track="legend">
              <div class="bt-track-label"><span class="ic">T</span><span class="nm">LEGENDA</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-legend"></div>
            </div>
            <div class="bt-track-row" data-track="broll">
              <div class="bt-track-label"><span class="ic">▭</span><span class="nm">B-ROLL</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe">+</button>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-broll"></div>
            </div>
            <div class="bt-track-row" data-track="music">
              <div class="bt-track-label"><span class="ic">♫</span><span class="nm">TRILHA</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe">+</button>
                <button class="bt-tctl" data-act="mute" title="mudo">M</button>
                <button class="bt-tctl" data-act="solo" title="solo">S</button>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-music"></div>
            </div>
          </div>
```

**Acceptance:** `grep -c 'data-track="broll"\|data-track="music"' public/index.html` → 2 (um de
cada, dentro do template). Abrir BEATS mostra as 5 tracks (BEATS/ÁUDIO/LEGENDA/B-ROLL/TRILHA),
as duas novas vazias, sem erro de console (ainda não há JS pra popular/interagir com elas — só a
estrutura DOM existe até aqui).

---

## Task 4 — `public/index.html`: estado, render, picker de assets e persistência

### 4a. Estado novo

Trocar (bloco de `let`s logo abaixo das constantes, no topo da IIFE):

```js
  let DURATION = 0;
  let BEATS = [];
  let selected = -1;
  let hist = [], histPos = -1;
  let hiddenTracks = {}, lockedTracks = {};
  let inPoint = null, outPoint = null;
  let currentPath = null;
```

por:

```js
  let DURATION = 0;
  let BEATS = [];
  let BROLL = []; // {path, name, start, dur}
  let MUSIC = []; // {path, name, start, dur, volume}
  let selected = -1;
  let selectedClip = null; // {track:'broll'|'music', index} | null
  let hist = [], histPos = -1;
  let hiddenTracks = {}, lockedTracks = {};
  let trilhaMuted = false, trilhaSolo = false;
  const mediaCache = new Map(); // path -> {video?, audio?} — elementos ocultos pro compositor
  let inPoint = null, outPoint = null;
  let currentPath = null;
```

### 4b. Undo/redo cobrindo os 3 arrays

Trocar:

```js
  /* ---------------- undo/redo (BEATS snapshots only) */
  function snapshot() {
    hist = hist.slice(0, histPos + 1);
    hist.push(JSON.parse(JSON.stringify(BEATS)));
    histPos = hist.length - 1;
  }
  function undo() {
    if (histPos <= 0) return;
    histPos--; BEATS = JSON.parse(JSON.stringify(hist[histPos]));
    if (selected >= BEATS.length) selected = BEATS.length - 1;
    renderTracks();
  }
  function redo() {
    if (histPos >= hist.length - 1) return;
    histPos++; BEATS = JSON.parse(JSON.stringify(hist[histPos]));
    if (selected >= BEATS.length) selected = BEATS.length - 1;
    renderTracks();
  }
```

por:

```js
  /* ---------------- undo/redo (BEATS + BROLL + MUSIC snapshots) */
  function snapshot() {
    hist = hist.slice(0, histPos + 1);
    hist.push(JSON.parse(JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC })));
    histPos = hist.length - 1;
  }
  function applyHistEntry(entry) {
    BEATS = JSON.parse(JSON.stringify(entry.beats));
    BROLL = JSON.parse(JSON.stringify(entry.broll || []));
    MUSIC = JSON.parse(JSON.stringify(entry.music || []));
    if (selected >= BEATS.length) selected = BEATS.length - 1;
    selectedClip = null;
    pruneMediaCache();
  }
  function undo() {
    if (histPos <= 0) return;
    histPos--; applyHistEntry(hist[histPos]);
    renderTracks();
  }
  function redo() {
    if (histPos >= hist.length - 1) return;
    histPos++; applyHistEntry(hist[histPos]);
    renderTracks();
  }
  function pruneMediaCache() {
    for (const [path, entry] of mediaCache) {
      const stillBroll = BROLL.some(c => c.path === path);
      const stillMusic = MUSIC.some(c => c.path === path);
      if (!stillBroll && entry.video) { entry.video.pause(); entry.video.remove(); entry.video = null; }
      if (!stillMusic && entry.audio) { entry.audio.pause(); entry.audio.remove(); entry.audio = null; }
      if (!entry.video && !entry.audio) mediaCache.delete(path);
    }
  }
  function clearMediaCache() {
    for (const entry of mediaCache.values()) {
      if (entry.video) { entry.video.pause(); entry.video.remove(); }
      if (entry.audio) { entry.audio.pause(); entry.audio.remove(); }
    }
    mediaCache.clear();
  }
```

**Por que `pruneMediaCache`/`clearMediaCache` ficam aqui e não na Task 6 (compositing):** essas
duas funções só manipulam o `Map` e os elementos que a Task 6 vai criar (`getBrollVideoEl`/
`getMusicAudioEl`), sem depender de nenhuma função da Task 6 — ficam definidas de uma vez só,
evitando referência a algo que ainda não existe no arquivo até a Task 6 rodar. `mediaCache` foi
declarado no 4a acima; nesse ponto do arquivo (antes da Task 6 existir) essas funções são código
morto inofensivo (chamadas com um `Map` sempre vazio) — passam a fazer efeito assim que a Task 6
começar a popular `mediaCache`.

### 4c. Renderização das 2 tracks + picker de assets

Adicionar, logo depois da função `renderLegendList()` já existente (antes de `renderPlayhead()`):

```js
  /* ---------------- B-ROLL / TRILHA: dados + render ---------------- */
  function clipsFor(track) { return track === 'broll' ? BROLL : MUSIC; }
  function findGapAt(track, t, wantDur) {
    const arr = clipsFor(track).slice().sort((a, b) => a.start - b.start);
    let gapStart = 0, gapEnd = DURATION;
    for (const c of arr) {
      if (c.start >= t) { gapEnd = Math.min(gapEnd, c.start); break; }
      gapStart = Math.max(gapStart, c.start + c.dur);
    }
    const from = Math.max(gapStart, t);
    const avail = gapEnd - from;
    if (avail <= MIN_BEAT_DUR) return null;
    return { start: from, dur: Math.min(wantDur, avail) };
  }
  function addClipAt(track, asset) {
    const t = snapTime(video.currentTime);
    let start = t, dur;
    if (track === 'broll') {
      const gap = findGapAt('broll', t, 3);
      if (!gap) { stage('sem espaço livre no B-ROLL nesse ponto — mova o playhead', true); return; }
      start = gap.start; dur = gap.dur;
    } else {
      dur = Math.min(3, DURATION - t);
      if (dur <= MIN_BEAT_DUR) { stage('sem espaço até o fim da timeline', true); return; }
    }
    const clip = track === 'broll'
      ? { path: asset.path, name: asset.name, start, dur }
      : { path: asset.path, name: asset.name, start, dur, volume: 1 };
    clipsFor(track).push(clip);
    selectedClip = { track, index: clipsFor(track).length - 1 };
    snapshot();
    renderTracks();
  }
  function renderClipTrack(track, hostId) {
    const host = $q('#' + hostId);
    if (!host) return;
    host.style.width = contentWidth() + 'px';
    const arr = clipsFor(track);
    host.innerHTML = arr.map((c, i) => {
      const sel = selectedClip && selectedClip.track === track && selectedClip.index === i ? ' selected' : '';
      const vol = track === 'music'
        ? `<input type="range" class="bt-clip-vol" min="0" max="1" step="0.05" value="${c.volume}" data-idx="${i}">`
        : '';
      return `<div class="bt-clip ${track}${sel}" data-track="${track}" data-idx="${i}"
          style="left:${timeToX(c.start)}px;width:${Math.max(4, timeToX(c.dur))}px">
          <div class="bt-handle left" data-track="${track}" data-idx="${i}" data-side="left"></div>
          <span class="nm">${escapeHtml(c.name)}</span>${vol}
          <div class="bt-handle right" data-track="${track}" data-idx="${i}" data-side="right"></div>
        </div>`;
    }).join('');
    if (track === 'music') {
      host.querySelectorAll('.bt-clip-vol').forEach(inp => {
        inp.addEventListener('mousedown', e => e.stopPropagation());
        inp.addEventListener('input', () => { MUSIC[+inp.dataset.idx].volume = +inp.value; });
        inp.addEventListener('change', () => snapshot());
      });
    }
  }
  function renderBrollTrack() { renderClipTrack('broll', 'bt-track-broll'); }
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
  function openAddClipPopover(track, anchorEl) {
    closePopover();
    const kind = track === 'broll' ? 'video' : 'audio';
    const list = assets.filter(a => a.kind === kind && a.path !== currentPath);
    const rect = anchorEl.getBoundingClientRect();
    popEl = document.createElement('div');
    popEl.className = 'bt-pop';
    popEl.style.left = Math.max(6, Math.min(window.innerWidth - 226, rect.left)) + 'px';
    popEl.style.top = (rect.bottom + 6) + 'px';
    popEl.innerHTML = `<div class="t">ADICIONAR ${track === 'broll' ? 'B-ROLL' : 'TRILHA'}</div>
      <div class="bt-asset-list">${list.length
        ? list.map(a => `<button class="bt-asset-opt" data-path="${escapeHtml(a.path)}">${escapeHtml(a.name)}</button>`).join('')
        : '<div class="empty" style="padding:6px 0">Nenhum asset disponível — suba um arquivo em VISUALS ou VOICE.</div>'}</div>
      <div class="row2"><button id="bt-pop-cancel">FECHAR</button></div>`;
    document.body.appendChild(popEl);
    popEl.querySelectorAll('.bt-asset-opt').forEach(btn => {
      btn.onclick = () => {
        const asset = list.find(a => a.path === btn.dataset.path);
        if (asset) addClipAt(track, asset);
        closePopover();
      };
    });
    $q('#bt-pop-cancel', popEl).onclick = closePopover;
    setTimeout(() => document.addEventListener('mousedown', onDocClick, { capture: true }), 0);
    function onDocClick(ev) {
      if (popEl && !popEl.contains(ev.target) && !anchorEl.contains(ev.target)) {
        closePopover();
        document.removeEventListener('mousedown', onDocClick, { capture: true });
      }
    }
  }
```

`assets` é o array global já existente (declarado fora desta IIFE, em escopo — mesmo padrão que
`api()`/`addAsset()`/`stage()` já usados dentro do módulo BEATS). `closePopover`/`popEl` são os
mesmos já usados pelo popover de rename dos beats — só um popover fica aberto por vez.

### 4d. `renderTracks()` chama as 2 funções novas

Trocar:

```js
  function renderTracks() {
    renderRuler();
    renderBeatsTrack();
    drawWaveform();
    renderLegendTrack();
    renderLegendList();
    renderPlayhead();
    renderInOut();
    updateTimeDisplay();
    highlightActiveWord();
    applyTrackVisibility();
  }
```

por:

```js
  function renderTracks() {
    renderRuler();
    renderBeatsTrack();
    drawWaveform();
    renderLegendTrack();
    renderLegendList();
    renderBrollTrack();
    renderMusicTrack();
    renderPlayhead();
    renderInOut();
    updateTimeDisplay();
    highlightActiveWord();
    applyTrackVisibility();
  }
```

### 4e. Persistência — `saveBeats()`, `applySavedBeats()`, `loadVideo()`

Trocar:

```js
  async function saveBeats() {
    if (!currentPath) return;
    try {
      const r = await api('/api/beats', {
        video: currentPath, duration: DURATION,
        beats: BEATS.map((b, i) => ({ label: b.label, start: beatStart(i), dur: b.dur })),
      });
      stage('beats salvos: ' + r.path);
    } catch (e) { stage(e.message, true); }
  }
  function applySavedBeats(saved) {
    if (!saved || !Array.isArray(saved.beats) || !saved.beats.length) return false;
    BEATS = saved.beats.map((b, i) => ({ label: b.label, dur: b.dur, color: colorFor(i) }));
    selected = -1;
    snapshot();
    renderTracks();
    return true;
  }
```

por:

```js
  async function saveBeats() {
    if (!currentPath) return;
    try {
      const r = await api('/api/beats', {
        video: currentPath, duration: DURATION,
        beats: BEATS.map((b, i) => ({ label: b.label, start: beatStart(i), dur: b.dur })),
        broll: BROLL.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })),
        music: MUSIC.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume })),
      });
      stage('beats salvos: ' + r.path);
    } catch (e) { stage(e.message, true); }
  }
  function applySavedBeats(saved) {
    if (!saved || !Array.isArray(saved.beats) || !saved.beats.length) return false;
    BEATS = saved.beats.map((b, i) => ({ label: b.label, dur: b.dur, color: colorFor(i) }));
    BROLL = Array.isArray(saved.broll) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })) : [];
    MUSIC = Array.isArray(saved.music) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1 })) : [];
    selected = -1; selectedClip = null;
    pruneMediaCache();
    snapshot();
    renderTracks();
    return true;
  }
```

Em `loadVideo(path)`, trocar:

```js
    DURATION = info.duration || 0;
    selected = -1; inPoint = null; outPoint = null; hiddenTracks = {}; lockedTracks = {};
    const saved = await fetchBeats(path);
    if (saved && Array.isArray(saved.beats) && saved.beats.length) {
      BEATS = saved.beats.map((b, i) => ({ label: b.label, dur: b.dur, color: colorFor(i) }));
    } else {
      BEATS = [{ label: 'CORTE', dur: DURATION, color: colorFor(0) }];
    }
    hist = []; histPos = -1; snapshot();
```

por:

```js
    DURATION = info.duration || 0;
    selected = -1; selectedClip = null; inPoint = null; outPoint = null;
    hiddenTracks = {}; lockedTracks = {}; trilhaMuted = false; trilhaSolo = false;
    clearMediaCache();
    const saved = await fetchBeats(path);
    if (saved && Array.isArray(saved.beats) && saved.beats.length) {
      BEATS = saved.beats.map((b, i) => ({ label: b.label, dur: b.dur, color: colorFor(i) }));
    } else {
      BEATS = [{ label: 'CORTE', dur: DURATION, color: colorFor(0) }];
    }
    BROLL = (saved && Array.isArray(saved.broll)) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })) : [];
    MUSIC = (saved && Array.isArray(saved.music)) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1 })) : [];
    hist = []; histPos = -1; snapshot();
```

(o resto de `loadVideo` — `buildDom(); built = true; await loadWaveform(path); await
loadLegend(); renderTracks();` — não muda.)

**Acceptance (Task 4):**
- `node --check` via extração do `<script>` (mesma técnica das duas execuções anteriores:
  `node -e "new Function(fs.readFileSync('public/index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1])"`)
  → sem `SyntaxError`.
- `grep -c "function renderClipTrack\|function addClipAt\|function openAddClipPopover\|function pruneMediaCache\|function clearMediaCache" public/index.html` → 5.
- Sidecar salvo por uma sessão desta Task, recarregado (`GET /api/beats?video=...`), contém
  `broll`/`music` idênticos ao que foi enviado (round-trip, testável via curl como na Task 1).

---

## Task 5 — `public/index.html`: interações de clipe (mover/aparar/apagar) e controles de track

### 5a. Mover, aparar, apagar clipe

Adicionar, logo depois de `startBeatDrag(...)` (antes de `onTracksMouseDown`):

```js
  function startClipMove(clipEl, e) {
    const track = clipEl.dataset.track, i = +clipEl.dataset.idx;
    if (lockedTracks[track]) return;
    const arr = clipsFor(track);
    selectedClip = { track, index: i };
    renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    const startX = e.clientX;
    const origStart = arr[i].start, dur = arr[i].dur;
    const el = $q(`.bt-clip[data-track="${track}"][data-idx="${i}"]`);
    if (el) el.classList.add('dragging');
    let lo = 0, hi = DURATION - dur;
    if (track === 'broll') {
      arr.forEach((c, j) => {
        if (j === i) return;
        if (c.start + c.dur <= origStart) lo = Math.max(lo, c.start + c.dur);
        else if (c.start >= origStart + dur) hi = Math.min(hi, c.start - dur);
      });
    }
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      arr[i].start = Math.max(lo, Math.min(hi, snapTime(origStart + dx)));
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function startClipTrim(handleEl, e) {
    const track = handleEl.dataset.track, i = +handleEl.dataset.idx, side = handleEl.dataset.side;
    if (lockedTracks[track]) return;
    e.stopPropagation();
    const arr = clipsFor(track);
    const c = arr[i];
    const startX = e.clientX;
    const origStart = c.start, origEnd = c.start + c.dur;
    let lo = 0, hi = DURATION;
    if (track === 'broll') {
      arr.forEach((o, j) => {
        if (j === i) return;
        if (side === 'left' && o.start + o.dur <= origStart) lo = Math.max(lo, o.start + o.dur);
        if (side === 'right' && o.start >= origEnd) hi = Math.min(hi, o.start);
      });
    }
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      if (side === 'right') {
        const t = Math.max(origStart + MIN_BEAT_DUR, Math.min(hi, snapTime(origEnd + dx)));
        c.dur = t - origStart;
      } else {
        const t = Math.max(lo, Math.min(origEnd - MIN_BEAT_DUR, snapTime(origStart + dx)));
        c.start = t; c.dur = origEnd - t;
      }
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function deleteSelectedClip() {
    if (!selectedClip) return;
    clipsFor(selectedClip.track).splice(selectedClip.index, 1);
    selectedClip = null;
    pruneMediaCache();
    snapshot();
    renderTracks();
  }
```

### 5b. Roteamento no `onTracksMouseDown`

Trocar:

```js
  function onTracksMouseDown(e) {
    const handle = e.target.closest('.bt-handle');
    const beatEl = e.target.closest('.bt-beat');
    if (handle) { startTrim(handle, e); return; }
    if (beatEl) { startBeatDrag(beatEl, e); return; }
    const t = snapTime(pageXToTime(e.clientX));
    seekTo(t);
  }
```

por:

```js
  function onTracksMouseDown(e) {
    const handle = e.target.closest('.bt-handle');
    const clipEl = e.target.closest('.bt-clip');
    const beatEl = e.target.closest('.bt-beat');
    if (handle && handle.dataset.side) { startClipTrim(handle, e); return; }
    if (handle) { startTrim(handle, e); return; }
    if (clipEl) { startClipMove(clipEl, e); return; }
    if (beatEl) { startBeatDrag(beatEl, e); return; }
    const t = snapTime(pageXToTime(e.clientX));
    seekTo(t);
  }
```

(`.bt-handle` dos beats não tem `data-side` — só os de clipe têm — por isso o `if (handle &&
handle.dataset.side)` decide qual dos dois handlers chamar antes do fallback antigo.)

### 5c. Tecla Delete/Backspace apaga o clipe selecionado

No handler `document.addEventListener('keydown', (e) => { ... })`, dentro do `switch (e.key)`,
adicionar um `case` novo (em qualquer posição do switch, por exemplo logo depois do `case 'r':
case 'R': ...` existente):

```js
      case 'Delete': case 'Backspace':
        if (selectedClip) { e.preventDefault(); deleteSelectedClip(); }
        break;
```

### 5d. Controles de track — `add`, `mute`, `solo`

Trocar `wireTracks()`:

```js
  function wireTracks() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.querySelectorAll('.bt-tctl').forEach(btn => {
        btn.onclick = () => {
          const act = btn.dataset.act;
          if (act === 'hide') hiddenTracks[track] = !hiddenTracks[track];
          if (act === 'lock') lockedTracks[track] = !lockedTracks[track];
          applyTrackVisibility();
        };
      });
    });
    $q('#bt-tracks').addEventListener('mousedown', onTracksMouseDown);
    $q('#bt-tracks').addEventListener('dblclick', onTracksDblClick);
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
    $q('.bt-playhead-flag').addEventListener('mousedown', onFlagMouseDown);
  }
```

por:

```js
  function wireTracks() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.querySelectorAll('.bt-tctl').forEach(btn => {
        btn.onclick = () => {
          const act = btn.dataset.act;
          if (act === 'hide') hiddenTracks[track] = !hiddenTracks[track];
          if (act === 'lock') lockedTracks[track] = !lockedTracks[track];
          if (act === 'add') { openAddClipPopover(track, btn); return; }
          if (act === 'mute') trilhaMuted = !trilhaMuted;
          if (act === 'solo') { trilhaSolo = !trilhaSolo; if (video) video.muted = trilhaSolo; }
          applyTrackVisibility();
        };
      });
    });
    $q('#bt-tracks').addEventListener('mousedown', onTracksMouseDown);
    $q('#bt-tracks').addEventListener('dblclick', onTracksDblClick);
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
    $q('.bt-playhead-flag').addEventListener('mousedown', onFlagMouseDown);
  }
```

`solo` na TRILHA muda `video.muted` (silencia a narração pra ouvir só a música); `mute` na
TRILHA silencia só os clipes de música (`el.muted` deles, aplicado na Task 6). B-ROLL e as 3
tracks originais (BEATS/ÁUDIO/LEGENDA) não ganham botão `mute`/`solo` — não têm áudio próprio
alternável (mesma razão já documentada no plano anterior).

### 5e. `applyTrackVisibility()` reflete `mute`/`solo`

Trocar:

```js
  function applyTrackVisibility() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.classList.toggle('hidden', !!hiddenTracks[track]);
      row.classList.toggle('locked', !!lockedTracks[track]);
      row.querySelectorAll('.bt-tctl').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.act === 'hide' ? !!hiddenTracks[track] : !!lockedTracks[track]);
      });
    });
  }
```

por:

```js
  function applyTrackVisibility() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.classList.toggle('hidden', !!hiddenTracks[track]);
      row.classList.toggle('locked', !!lockedTracks[track]);
      row.querySelectorAll('.bt-tctl').forEach(btn => {
        const act = btn.dataset.act;
        let on = false;
        if (act === 'hide') on = !!hiddenTracks[track];
        else if (act === 'lock') on = !!lockedTracks[track];
        else if (act === 'mute') on = trilhaMuted;
        else if (act === 'solo') on = trilhaSolo;
        btn.classList.toggle('on', on);
      });
    });
  }
```

**Acceptance (Task 5):**
- `grep -c "function startClipMove\|function startClipTrim\|function deleteSelectedClip" public/index.html` → 3.
- Sintaxe (`new Function` sobre o `<script>` extraído) sem erro.
- Comportamento (testado na Task 6/verificação final, não isoladamente aqui): arrastar um clipe
  de B-ROLL até tocar outro para — não sobrepõe; arrastar um clipe de TRILHA por cima de outro é
  permitido.

---

## Task 6 — `public/index.html`: motor de compositing ao vivo (canvas + mídia paralela)

Adicionar, logo depois de `renderMusicTrack()` (fim do bloco da Task 4c) ou em qualquer ponto
antes de `buildDom()` — a ordem de definição de função não importa em JS por hoisting, mas
manter perto das outras funções de B-ROLL/TRILHA ajuda a leitura:

```js
  /* ---------------- compositing ao vivo (canvas + vídeos/áudios nativos em paralelo) ---------------- */
  function getBrollVideoEl(path) {
    let entry = mediaCache.get(path);
    if (!entry) { entry = {}; mediaCache.set(path, entry); }
    if (!entry.video) {
      const v = document.createElement('video');
      v.src = '/files/' + encodeURIComponent(path.replace(/\\/g, '/'));
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed; left:-9999px; top:0; width:2px; height:2px;';
      document.body.appendChild(v);
      entry.video = v;
    }
    return entry.video;
  }
  function getMusicAudioEl(path) {
    let entry = mediaCache.get(path);
    if (!entry) { entry = {}; mediaCache.set(path, entry); }
    if (!entry.audio) {
      const a = document.createElement('audio');
      a.src = '/files/' + encodeURIComponent(path.replace(/\\/g, '/'));
      a.preload = 'auto';
      document.body.appendChild(a);
      entry.audio = a;
    }
    return entry.audio;
  }
  function activeBroll(t) {
    if (hiddenTracks.broll) return null;
    return BROLL.find(c => t >= c.start && t < c.start + c.dur) || null;
  }
  function drawFrame(canvas, sourceEl) {
    if (!canvas || !sourceEl || sourceEl.readyState < 2) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const vw = sourceEl.videoWidth, vh = sourceEl.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(cw / vw, ch / vh);
    const dw = vw * scale, dh = vh * scale;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(sourceEl, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }
  function compositeTick() {
    if (!built || !video) return;
    const canvas = $q('#bt-canvas');
    const t = video.currentTime;
    const active = activeBroll(t);
    for (const [path, entry] of mediaCache) {
      if (entry.video && (!active || active.path !== path) && !entry.video.paused) entry.video.pause();
    }
    if (active) {
      const bv = getBrollVideoEl(active.path);
      const target = t - active.start;
      if (Math.abs(bv.currentTime - target) > 0.15) bv.currentTime = target;
      if (video.paused) { if (!bv.paused) bv.pause(); }
      else if (bv.paused) bv.play().catch(() => {});
      // fonte de B-ROLL ainda sem frame decodificado (ou arquivo ausente/erro de load,
      // readyState nunca sai de 0) — cai pro vídeo principal em vez de deixar o canvas parado
      if (bv.readyState >= 2) drawFrame(canvas, bv);
      else drawFrame(canvas, video);
    } else {
      drawFrame(canvas, video);
    }
    MUSIC.forEach(c => {
      const el = getMusicAudioEl(c.path);
      const onWindow = t >= c.start && t < c.start + c.dur;
      const shouldPlay = onWindow && !video.paused && !hiddenTracks.music;
      el.volume = Math.max(0, Math.min(1, c.volume));
      el.muted = trilhaMuted;
      if (shouldPlay) {
        const target = t - c.start;
        if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    });
    requestAnimationFrame(compositeTick);
  }
```

E em `buildDom()`, trocar a última linha:

```js
    video = $q('#bt-video');
    wireTransport();
    wireTracks();
  }
```

por:

```js
    video = $q('#bt-video');
    wireTransport();
    wireTracks();
    requestAnimationFrame(compositeTick);
  }
```

**Por que o loop se auto-encerra sem precisar de `cancelAnimationFrame`:** `compositeTick()`
verifica `if (!built || !video) return;` logo no início — quando `loadVideo()` troca de vídeo,
ele zera `built = false` antes de reconstruir o DOM; a cadeia de `requestAnimationFrame` antiga
simplesmente para de se re-agendar no próximo tick. `buildDom()` sempre termina disparando uma
cadeia nova.

**Acceptance (Task 6):**
- `grep -c "function compositeTick\|function getBrollVideoEl\|function getMusicAudioEl\|function drawFrame" public/index.html` → 4.
- Sintaxe (`new Function` sobre o `<script>` extraído) sem erro.
- Verificação funcional fica pro critério geral abaixo (precisa servidor + navegador reais).

---

## Overall acceptance criteria

1. `node --check server.js` → exit 0.
2. `git diff --stat` mostra só `server.js` e `public/index.html` — nenhum arquivo em `lib/`,
   `remotion/`, `clipper/` tocado.
3. Todos os outros steps/tools (VISUALS, VOICE, ASSEMBLE, EXPORT, CLIPPER, DOWNLOAD, LIBRARY) e
   as 3 tracks originais do BEATS (BEATS/ÁUDIO/LEGENDA — split/merge/rename/undo/redo/snap/
   transport J-K-L) continuam funcionando exatamente como antes.
4. `POST`/`GET /api/beats` aceitam e devolvem `broll[]`/`music[]` (schema v2), com
   retrocompatibilidade: um `.beats.json` v1 salvo pelo plano anterior (sem esses campos)
   continua carregando sem erro, como se `broll`/`music` fossem `[]`.
5. Em navegador real (servidor rodando): subir um vídeo principal + 1 clipe de vídeo curto (pro
   B-ROLL) + 1 clipe de áudio (pra TRILHA) via VISUALS/VOICE, montar em ASSEMBLE, abrir BEATS,
   usar os botões "+" de B-ROLL e TRILHA pra adicionar um clipe de cada, posicionar/aparar
   arrastando, dar play contínuo e confirmar visualmente que o preview troca pro B-ROLL na janela
   certa e volta pro vídeo principal sem travar, com a música audível por cima da narração.
6. Arrastar um clipe de B-ROLL até colidir com outro clipe de B-ROLL para no ponto de colisão
   (não sobrepõe); dois clipes de TRILHA podem se sobrepor livremente.
7. Selecionar um clipe de B-ROLL ou TRILHA e apertar Delete/Backspace remove ele; Ctrl+Z desfaz
   (beats, B-ROLL e TRILHA voltam juntos ao estado anterior).
8. `SALVAR BEATS` grava os 3 arrays; recarregar a página, voltar pro mesmo vídeo, `CARREGAR`
   (ou o autoload já existente) traz beats + B-ROLL + TRILHA de volta idênticos.
9. Zero erros de console em qualquer um dos steps/tools depois da mudança.

## Status

_(propriedade do Executor)_

**Execução em 2026-08-12 — Tasks 1-6 aplicadas integralmente, verificação estrutural apenas (servidor não reiniciado, conforme instrução).**

Todos os blocos "trocar X por Y" do plano bateram literalmente contra o estado atual dos arquivos
(nenhuma reconferência de âncora foi necessária — confirmado pelo Orquestrador antes do handoff).
Nenhum desvio de escopo foi necessário; nenhuma lacuna de especificação foi encontrada que
exigisse parar e devolver ao Orquestrador.

**Task 1 (`server.js`)** — `POST /api/beats` agora grava `version: 2` com `broll`/`music`
(fallback `[]` se ausentes no body). `GET /api/beats` não mudou (plano previu isso — devolve o
JSON salvo por inteiro). Verificado: `node --check server.js` → exit 0. Não rodei os `curl` de
round-trip do critério de aceite da Task 1 porque exigiriam servidor rodando (instrução explícita
de não reiniciar o servidor) — fica para a verificação em navegador/servidor real do Orquestrador.

**Task 2 (`public/index.html`)** — CSS novo (`.bt-video-wrap{position:relative}`, `.bt-clip`,
`.bt-clip.broll`/`.bt-clip.music`/`.bt-clip.selected`/`.bt-clip.dragging`, `.bt-clip-vol`,
`.bt-handle.left`, `.bt-asset-list`, `.bt-asset-opt`) inserido antes de `</style>`, logo depois de
`.bt-pop .row2 button.primary{...}`. Só tokens de design já existentes reutilizados
(`--go`/`--warn`/`--line`/`--panel2`/`--ink`/`--dim`/`--sans`).

**Task 3 (`public/index.html`)** — canvas `#bt-canvas` adicionado dentro de `.bt-video-wrap`
(depois do `<video id="bt-video">`); 2 `.bt-track-row` novas (`data-track="broll"` com botão `+`,
`data-track="music"` com botões `+`/`M`/`S`) inseridas depois da track `legend`, dentro de
`.bt-tracks`. `grep -c 'data-track="broll"\|data-track="music"'` → 2 (confirmado).

**Task 4 (`public/index.html`)** — estado novo (`BROLL`, `MUSIC`, `selectedClip`, `mediaCache`,
`trilhaMuted`, `trilhaSolo`); undo/redo estendido para os 3 arrays (`snapshot`/`applyHistEntry`/
`undo`/`redo`) + `pruneMediaCache`/`clearMediaCache`; bloco novo de render/picker
(`clipsFor`/`findGapAt`/`addClipAt`/`renderClipTrack`/`renderBrollTrack`/`renderMusicTrack`/
`openAddClipPopover`) inserido entre `renderLegendList()` e `renderPlayhead()`; `renderTracks()`
chamando as 2 funções novas; `saveBeats()`/`applySavedBeats()`/`loadVideo()` atualizados para o
schema v2 com retrocompatibilidade v1 (arrays vazios se `saved.broll`/`saved.music` ausentes).
Verificado: grep de 5 nomes de função → 5; sintaxe do `<script>` via `new Function()` → OK.

**Task 5 (`public/index.html`)** — `startClipMove`/`startClipTrim`/`deleteSelectedClip` inseridos
depois de `startBeatDrag(...)`, antes de `onTracksMouseDown`; `onTracksMouseDown` roteando pra
`startClipTrim`/`startClipMove` antes do fallback de beats; `case 'Delete': case 'Backspace':`
adicionado ao switch de `keydown` (depois do `case 'r': case 'R':`); `wireTracks()` tratando
`add`/`mute`/`solo`; `applyTrackVisibility()` refletindo `trilhaMuted`/`trilhaSolo` nos botões
`M`/`S`. Verificado: grep de 3 nomes de função → 3; sintaxe OK.

**Task 6 (`public/index.html`)** — `getBrollVideoEl`/`getMusicAudioEl`/`activeBroll`/`drawFrame`/
`compositeTick` inseridos depois de `openAddClipPopover` (fim do bloco 4c), antes de
`renderPlayhead()`; `buildDom()` disparando `requestAnimationFrame(compositeTick)` na última
linha. Verificado: grep de 4 nomes de função → 4; sintaxe OK;
`requestAnimationFrame(compositeTick)` aparece 2x no arquivo (chamada inicial em `buildDom()` +
reagendamento recursivo dentro da própria `compositeTick()`), como esperado.

**Verificações estruturais gerais (Overall acceptance criteria 1-4):**
1. `node --check server.js` → exit 0. Confirmado.
2. `git diff --stat` → só `public/index.html` (358 linhas, +351/-12 aprox.) e `server.js` (+5/-2)
   tocados. Nenhum arquivo em `lib/`, `remotion/`, `clipper/` tocado. `git status --porcelain`
   confirma que só esses 2 arquivos estão modificados (`M`); os demais itens untracked
   (`docs/plans/beats-broll-compositor.md`, `docs/plans/timeline-editor.html`,
   `docs/superpowers/specs/2026-08-12-beats-broll-compositor-design.md`) já existiam antes desta
   execução e não foram tocados por ela.
3. Greps de nome de função de cada task: Task 3 → 2, Task 4 → 5, Task 5 → 3, Task 6 → 4 — todos
   batendo com o esperado.
4. Sintaxe do `<script>` inteiro extraído via `new Function(...)` → sem `SyntaxError`, checado
   depois de cada task e de novo no final.

**Não exercitado nesta execução (critérios 5-9 do "Overall acceptance criteria" — exigem servidor
rodando + navegador real, e a instrução foi explicitamente não reiniciar o servidor):**
- upload de B-ROLL/TRILHA via VISUALS/VOICE e aparecimento no picker do `+`;
- arrastar/aparar clipes de B-ROLL e TRILHA na timeline (colisão em B-ROLL, sobreposição livre em
  TRILHA);
- play contínuo real com o preview trocando pro `<canvas>`/B-ROLL na janela certa e voltando pro
  vídeo principal sem travar, com narração + música tocando juntas;
- Delete/Backspace removendo o clipe selecionado e Ctrl+Z desfazendo os 3 arrays juntos;
- round-trip completo de `SALVAR BEATS` → reload de página → `CARREGAR` trazendo
  beats+B-ROLL+TRILHA idênticos;
- zero erros de console em qualquer step depois da mudança.

Fica para o Orquestrador verificar esses itens em navegador real, como fez nos dois planos
anteriores.

**Lacunas/desvios de especificação encontrados:** nenhum. Todos os blocos do plano foram
suficientes para aplicar literalmente, sem necessidade de decisão de design não especificada.

### Verificação real em navegador (Orquestrador, pós-execução)

Reiniciei o servidor (necessário — `server.js` mudou nesta execução) e rodei o fluxo completo
pela UI real (Chrome via claude-in-chrome): vídeo principal (`Highend_cinematic_commercial.mov`,
8s) + clipe de B-ROLL (`clip-01.mp4`, vídeo diferente) + clipe de TRILHA (`audio-16k.wav`).

**Bug real encontrado e corrigido:** clicar em **qualquer** botão da coluna de rótulo de uma
track (`H`, `L`, `M`, `S`, e o `+` novo desta rodada) fazia o evento `mousedown` borbulhar sem
barreira até o listener delegado de `#bt-tracks` (`onTracksMouseDown`), que — não reconhecendo o
clique como beat/handle/clip — caía no fallback `seekTo(snapTime(pageXToTime(e.clientX)))` com um
`clientX` dentro da coluna de rótulo (à esquerda do início da régua), que `pageXToTime` clampa pra
`t=0`. Resultado: qualquer clique num desses botões resetava o playhead pra `0` antes do próprio
handler do botão rodar. Isso já existia desde `beat-timeline-editor.md` (H/L), mas nunca tinha
consequência visível; ficou crítico agora porque **"adicionar B-ROLL/TRILHA no playhead" depende
da posição real do playhead** — na prática, quase todo clique em "+" inseria o clipe em `t≈0` em
vez de onde o usuário estava. Corrigido com uma guarda no topo de `onTracksMouseDown`
(`public/index.html`, dentro da função, antes de checar `.bt-handle`):
```js
if (e.target.closest('.bt-track-label')) return; // H/L/M/S/+ controls — never seek the playhead
```
Sintaxe revalidada via `new Function()` depois do fix.

**Confirmado funcionando, com dado real (não sintético), depois do fix:**
- Picker de assets (`+`) lista corretamente só `kind==='video'` (B-ROLL, excluindo o vídeo
  principal) / `kind==='audio'` (TRILHA).
- Clipe inserido no playhead exato (confirmado com `currentTime` inspecionado via JS antes/depois
  do clique em `+` — permaneceu estável, não resetou mais pra 0).
- `findGapAt` corretamente recusa inserir em cima de um clipe já ocupando aquele ponto exato
  (mensagem "sem espaço livre... mova o playhead") e corretamente acha o próximo espaço livre
  quando o playhead está fora de qualquer clipe existente.
- **Compositing ao vivo real**: em t≈0.7s durante playback contínuo (não pausado), inspeção direta
  dos elementos `<video>`/`<audio>` ocultos via JS mostrou os 3 tocando **simultaneamente e
  sincronizados** — vídeo principal (`paused:false`), B-ROLL (`paused:false`, `muted:true`,
  `currentTime` acompanhando o relógio mestre), TRILHA (`paused:false`, `muted:false`, `volume:1`,
  `currentTime` acompanhando). Seek determinístico pra dentro (`t=1.5`) e fora (`t=4`) da janela do
  B-ROLL confirmou visualmente a troca de camada nos dois sentidos (frame do B-ROLL real, depois
  fallback pro vídeo principal).
- Colisão em B-ROLL: arrastar um clipe até o limite do outro clampa exatamente na borda (`180px`/
  `180px`, zero sobreposição, confirmado via `el.style.left`/`width`).
- Delete remove o clipe selecionado; Ctrl+Z desfaz (beats+B-ROLL+TRILHA voltam juntos).
- `SALVAR BEATS` grava sidecar `version:2` real no disco com `broll[]`/`music[]` corretos
  (inspecionado o arquivo `.json` direto); recarregar a página + reselecionar o vídeo autocarrega
  os 3 arrays idênticos (posições em pixel conferidas antes/depois do reload).
- Zero erros de console em BEATS e nos outros 6 steps/tools navegados em sequência.

**Não testado nesta verificação:** upload real de B-ROLL/TRILHA via drag-and-drop (usei o mecanismo
de upload por seleção de arquivo, equivalente); troca de layer durante um `play()` real ininterrupto
por vários segundos seguidos (testado via seeks determinísticos + uma janela curta de playback real
de ~0.8s, não um play longo contínuo observado visualmente do início ao fim); mute/solo da TRILHA em
uso (`M`/`S` clicados, mas não validei audível/inaudível de fato — só o estado dos elementos).

Servidor deixado rodando em `localhost:4870`. Nenhum commit feito.
