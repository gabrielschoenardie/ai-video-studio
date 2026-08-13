# Plan — BEATS timeline: multi-seleção de clipes + thumbnails/mini-waveform

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Pré-requisito:** `docs/plans/beats-timeline-zoom-resize.md` já executado
— este plano assume que `PX_PER_SEC` já é `let` (não `const`) e que
`trackHeights`/altura de track ajustável já existem (a track B-ROLL/TRILHA
redimensionada é o que torna os thumbnails/mini-waveform úteis; ver
`docs/superpowers/specs/` e o plano anterior para o raciocínio). Se por
algum motivo esse plano não tiver rodado ainda, pare e avise o
Orquestrador em vez de prosseguir.

Este é o **segundo de dois planos** desta rodada. Direito de contexto: os
números de linha aqui são estimativas pós-execução do plano anterior — o
plano anterior só faz inserções (nunca remove linhas), então todo trecho
de código citado abaixo como "atual" deve ser localizado pelo **conteúdo
exato**, não confiar cegamente no número de linha se ele não bater.

## Escopo

Só `public/index.html`. **Não tocar** `server.js` nem `lib/` — thumbnails
são gerados 100% client-side (`<video>` oculto + `<canvas>`, frame-grab
same-origin via `/files/`, sem round-trip de servidor) e mini-waveform
usa a mesma técnica de `AudioContext.decodeAudioData` que
`loadWaveform()` já usa pra track ÁUDIO principal. Beats continuam
seleção única (não fazem parte deste plano — só B-ROLL/TRILHA ganham
multi-seleção, decisão já confirmada com o usuário: beats são uma
partição contígua sem "deletar 1 beat" isolado hoje, generalizar isso
pra lote é left para uma rodada futura).

## Files

- **Modify:** `public/index.html`

## Task 1 — Estado de multi-seleção

Trocar (linhas ~931-932):

```js
  let selected = -1;
  let selectedClip = null; // {track:'broll'|'music', index} | null
```

por:

```js
  let selected = -1;
  let selectedClip = null; // {track:'broll'|'music', index} | null — âncora/único item quando não há multi-seleção
  let selectedClipSet = new Set(); // multi-seleção de clipes B-ROLL/TRILHA: chaves 'track:index'
  function clipKey(track, i) { return track + ':' + i; }
```

`selected`/`selectedClip` continuam existindo e sendo a "âncora" pros
fluxos de item único que não mudam neste plano (trim por handle,
popover de renomear beat, etc.).

## Task 2 — Caches de thumbnail/mini-waveform

Trocar (linha ~936):

```js
  const mediaCache = new Map(); // path -> {video?, audio?} — elementos ocultos pro compositor
```

por:

```js
  const mediaCache = new Map(); // path -> {video?, audio?} — elementos ocultos pro compositor
  const thumbCache = new Map();    // path -> dataURL | 'pending' | null (frame do clipe B-ROLL)
  const miniWaveCache = new Map(); // path -> Float32Array picos | 'pending' | null (mini-waveform do clipe TRILHA)
```

## Task 3 — Funções de multi-seleção e ações em lote

Logo depois de `deleteSelectedClip()` (o `}` que a fecha — hoje próximo
da linha 1834), adicionar:

```js
  function clearMultiSelection() { selectedClipSet.clear(); }
  function toggleClipMulti(track, i) {
    if (!selectedClipSet.size && selectedClip) selectedClipSet.add(clipKey(selectedClip.track, selectedClip.index));
    const key = clipKey(track, i);
    if (selectedClipSet.has(key)) selectedClipSet.delete(key); else selectedClipSet.add(key);
    selectedClip = selectedClipSet.size ? { track, index: i } : null;
  }
  function deleteSelection() {
    if (selectedClipSet.size) {
      const byTrack = { broll: [], music: [] };
      selectedClipSet.forEach(k => { const [t, i] = k.split(':'); byTrack[t].push(+i); });
      ['broll', 'music'].forEach(t => byTrack[t].sort((a, b) => b - a).forEach(i => clipsFor(t).splice(i, 1)));
      clearMultiSelection();
      selectedClip = null;
      pruneMediaCache();
      snapshot();
      renderTracks();
    } else {
      deleteSelectedClip();
    }
  }
  function startClipGroupMove(track0, i0, e) {
    const keys = selectedClipSet.size ? [...selectedClipSet] : [clipKey(track0, i0)];
    const items = keys.map(k => { const [track, i] = k.split(':'); return { track, index: +i, clip: clipsFor(track)[+i] }; })
      .filter(it => it.clip && !lockedTracks[it.track]);
    if (!items.length) return;
    const origins = items.map(it => it.clip.start);
    const startX = e.clientX;
    function onMove(ev) {
      const dt = (ev.clientX - startX) / PX_PER_SEC;
      items.forEach((it, k) => {
        it.clip.start = Math.max(0, Math.min(DURATION - it.clip.dur, origins[k] + dt));
      });
      renderBrollTrack(); renderMusicTrack();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
      renderTracks();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
```

**Limitação aceita v1 (documentar, não esconder):** ao contrário do
`startClipMove` de item único (que impede B-ROLL de sobrepor um clipe
vizinho), `startClipGroupMove` só limita cada item ao intervalo
`[0, DURATION-dur]` — um grupo de clipes B-ROLL arrastado junto **pode**
terminar sobrepondo um ao outro. Mover um clipe B-ROLL sozinho continua
com a checagem de colisão de sempre, inalterada.

**Acceptance:** `deleteSelection()` com nada selecionado não faz nada;
com só `selectedClip` (single, sem multi) se comporta idêntico a
`deleteSelectedClip()` de hoje; com `selectedClipSet` populado, deleta
todos os itens selecionados (de ambas as tracks se for o caso) sem
desalinhar índices (por isso o `sort desc` antes do `splice`).

## Task 4 — Interação: shift-clique seleciona/estende, clique simples em item já selecionado arrasta o grupo

Trocar `onTracksMouseDown()` (hoje próximo da linha 1835):

```js
  function onTracksMouseDown(e) {
    if (e.target.closest('.bt-track-label')) return; // H/L/M/S/+ controls — never seek the playhead
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

por:

```js
  function onTracksMouseDown(e) {
    if (e.target.closest('.bt-track-label')) return; // H/L/M/S/+ controls — never seek the playhead
    const handle = e.target.closest('.bt-handle');
    const clipEl = e.target.closest('.bt-clip');
    const beatEl = e.target.closest('.bt-beat');
    if (handle && handle.dataset.side) { startClipTrim(handle, e); return; }
    if (handle) { startTrim(handle, e); return; }
    if (clipEl) {
      const track = clipEl.dataset.track, i = +clipEl.dataset.idx;
      if (e.shiftKey) {
        toggleClipMulti(track, i);
        renderBrollTrack(); renderMusicTrack();
        return;
      }
      if (selectedClipSet.has(clipKey(track, i))) { startClipGroupMove(track, i, e); return; }
      clearMultiSelection();
      startClipMove(clipEl, e);
      return;
    }
    if (beatEl) { startBeatDrag(beatEl, e); return; }
    const t = snapTime(pageXToTime(e.clientX));
    seekTo(t);
  }
```

(Não existe hoje nenhum popover de duplo-clique em clipe B-ROLL/TRILHA —
só em beat e em palavra da LEGENDA — então `onTracksDblClick()` não
precisa de nenhuma mudança para este recurso.)

## Task 5 — Delete/Backspace e undo/redo cientes da multi-seleção

No handler de `keydown` (`switch (e.key)`), trocar:

```js
      case 'Delete': case 'Backspace':
        if (selectedClip) { e.preventDefault(); deleteSelectedClip(); }
        break;
```

por:

```js
      case 'Delete': case 'Backspace':
        if (selectedClip || selectedClipSet.size) { e.preventDefault(); deleteSelection(); }
        break;
```

Em `applyHistEntry()` (usada por undo/redo), trocar:

```js
  function applyHistEntry(entry) {
    BEATS = JSON.parse(JSON.stringify(entry.beats));
    BROLL = JSON.parse(JSON.stringify(entry.broll || []));
    MUSIC = JSON.parse(JSON.stringify(entry.music || []));
    if (selected >= BEATS.length) selected = BEATS.length - 1;
    selectedClip = null;
    pruneMediaCache();
  }
```

por:

```js
  function applyHistEntry(entry) {
    BEATS = JSON.parse(JSON.stringify(entry.beats));
    BROLL = JSON.parse(JSON.stringify(entry.broll || []));
    MUSIC = JSON.parse(JSON.stringify(entry.music || []));
    if (selected >= BEATS.length) selected = BEATS.length - 1;
    selectedClip = null;
    selectedClipSet.clear();
    pruneMediaCache();
  }
```

(sem isso, um undo/redo que muda os índices de `BROLL`/`MUSIC` deixaria
`selectedClipSet` apontando pra itens errados/inexistentes.)

Em `loadVideo()`, trocar a linha:

```js
    selected = -1; selectedClip = null; inPoint = null; outPoint = null;
```

por:

```js
    selected = -1; selectedClip = null; selectedClipSet.clear(); inPoint = null; outPoint = null;
```

**Acceptance:** `Delete` com múltiplos clipes selecionados apaga todos;
undo depois de uma edição qualquer nunca deixa a seleção múltipla
"fantasma" apontando pra um clipe que não existe mais; trocar de vídeo
limpa a seleção múltipla.

## Task 6 — Geração de thumbnail (B-ROLL) e mini-waveform (TRILHA)

Logo depois do `}` que fecha `drawWaveform()` (hoje entre essa função e
o comentário `/* ---------------- legend (palavras reais...) */`),
adicionar:

```js
  function ensureThumbnail(path) {
    if (thumbCache.has(path)) return;
    thumbCache.set(path, 'pending');
    const v = document.createElement('video');
    v.src = '/files/' + encodeURIComponent(path.replace(/\\/g, '/'));
    v.muted = true; v.preload = 'auto';
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, (v.duration || 0) / 2); });
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas'); c.width = 80; c.height = 45;
      c.getContext('2d').drawImage(v, 0, 0, 80, 45);
      thumbCache.set(path, c.toDataURL('image/jpeg', .7));
      v.remove();
      renderBrollTrack();
    }, { once: true });
    v.addEventListener('error', () => { thumbCache.set(path, null); v.remove(); });
    document.body.appendChild(v);
  }
  async function ensureMiniWave(path) {
    if (miniWaveCache.has(path)) return;
    miniWaveCache.set(path, 'pending');
    try {
      const buf = await (await fetch('/files/' + encodeURIComponent(path.replace(/\\/g, '/')))).arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const data = (await ctx.decodeAudioData(buf.slice(0))).getChannelData(0);
      const cols = 200, spc = Math.max(1, Math.floor(data.length / cols));
      const p = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        let m = 0; const s = c * spc, e2 = Math.min(data.length, s + spc);
        for (let i = s; i < e2; i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
        p[c] = m;
      }
      miniWaveCache.set(path, p);
      ctx.close();
    } catch (e) { miniWaveCache.set(path, null); }
    renderMusicTrack();
  }
  function drawPeaksToCanvas(canvas, peaksArr, color) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!peaksArr || !peaksArr.length) return;
    ctx.fillStyle = color;
    const mid = h / 2;
    for (let x = 0; x < w; x += 2) {
      const col = Math.min(peaksArr.length - 1, Math.floor((x / w) * peaksArr.length));
      const barH = Math.max(1, peaksArr[col] * (h - 6));
      ctx.fillRect(x, mid - barH / 2, 1.5, barH);
    }
  }
```

`ensureThumbnail`/`ensureMiniWave` são cacheadas por **path** — todo
clipe que reusa o mesmo arquivo-fonte reaproveita a mesma miniatura já
gerada, sem regenerar. `drawPeaksToCanvas` é uma função nova, separada
da `drawWaveform()` já existente (que continua exatamente como o plano
anterior a deixou) — **não** unificar as duas: `drawWaveform()` dimensiona
o canvas pelo `contentWidth()` (a área rolável inteira), enquanto o
canvas do mini-waveform dentro de um clipe é dimensionado por
`canvas.clientWidth` (a largura renderizada daquele clipe específico) —
são medidas diferentes por design, tentar reaproveitar uma pra outra
quebraria uma das duas.

**Acceptance:** chamar `ensureThumbnail(path)` duas vezes com o mesmo
path só gera a miniatura uma vez (segunda chamada é no-op por causa do
`thumbCache.has(path)`); erro de carregamento de vídeo/áudio (arquivo
removido, por exemplo) marca o cache como `null` em vez de tentar de
novo pra sempre ou travar a UI.

## Task 7 — CSS: overlay de thumbnail/mini-waveform dentro do clipe

Trocar (perto da linha ~351-352):

```css
.bt-clip .nm{font:600 9.5px var(--sans); color:var(--ink); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:1}
```

por:

```css
.bt-clip .nm{position:relative; z-index:1; font:600 9.5px var(--sans); color:var(--ink); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:1; text-shadow:0 1px 3px rgba(0,0,0,.9)}
.bt-clip-thumb{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.55; z-index:0}
.bt-clip-wave{position:absolute; inset:0; width:100%; height:100%; z-index:0}
```

(`.bt-clip` já tem `overflow:hidden`, então a imagem/canvas `inset:0`
nunca vaza pra fora da pílula, mesmo quando ela cresce com o
redimensionamento de track do plano anterior.)

## Task 8 — `renderClipTrack()`: injeta thumbnail/mini-waveform + reconhece multi-seleção

Trocar `renderClipTrack()` inteira:

```js
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
```

por:

```js
  function renderClipTrack(track, hostId) {
    const host = $q('#' + hostId);
    if (!host) return;
    host.style.width = contentWidth() + 'px';
    const arr = clipsFor(track);
    host.innerHTML = arr.map((c, i) => {
      const sel = (selectedClip && selectedClip.track === track && selectedClip.index === i) || selectedClipSet.has(clipKey(track, i)) ? ' selected' : '';
      const vol = track === 'music'
        ? `<input type="range" class="bt-clip-vol" min="0" max="1" step="0.05" value="${c.volume}" data-idx="${i}">`
        : '';
      let media = '';
      if (track === 'broll') {
        ensureThumbnail(c.path);
        const t = thumbCache.get(c.path);
        if (t) media = `<img class="bt-clip-thumb" src="${t}">`;
      }
      if (track === 'music') {
        ensureMiniWave(c.path);
        if (miniWaveCache.get(c.path) instanceof Float32Array) media = `<canvas class="bt-clip-wave" data-idx="${i}"></canvas>`;
      }
      return `<div class="bt-clip ${track}${sel}" data-track="${track}" data-idx="${i}"
          style="left:${timeToX(c.start)}px;width:${Math.max(4, timeToX(c.dur))}px">
          ${media}
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
      host.querySelectorAll('.bt-clip-wave').forEach(cv => {
        const peaksArr = miniWaveCache.get(arr[+cv.dataset.idx].path);
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, 'rgba(255,179,71,.6)');
      });
    }
  }
```

**Acceptance:** clipe de B-ROLL mostra um frame real do vídeo-fonte
(não um retângulo vazio); clipe de TRILHA mostra uma mini-waveform real
do áudio; o nome do arquivo continua legível por cima (sombra de texto);
multi-seleção (`selectedClipSet`) e seleção única (`selectedClip`)
mostram o mesmo destaque visual (`.selected`, já existente); redimensionar
a track (do plano anterior) faz o thumbnail/mini-waveform crescerem
junto, preenchendo a pílula.

## Overall acceptance criteria

1. `node --check server.js` continua exit 0 (arquivo não tocado).
2. `git diff --stat` mostra só `public/index.html`.
3. Nenhuma classe fora do prefixo `bt-` criada/alterada.
4. Beats continuam seleção única — nenhuma mudança em
   `startBeatDrag`/`doBeatTrim`/`splitBeatAt`/`mergeWithNext`/`openPopover`.
5. Shift-clique em clipes de B-ROLL e/ou TRILHA (misturando as duas
   tracks) seleciona múltiplos; `Delete`/`Backspace` apaga todos de uma
   vez; arrastar um clipe que faz parte da seleção múltipla move o grupo
   inteiro junto, respeitando zoom (funciona igual em qualquer nível de
   zoom do plano anterior).
6. Clique simples (sem shift) num clipe fora da seleção atual volta pro
   comportamento de seleção única de sempre (idêntico ao existente antes
   deste plano).
7. Limitação conhecida e aceita: grupo de B-ROLL arrastado junto pode
   sobrepor (mover um item B-ROLL sozinho continua sem sobrepor, como
   sempre foi).
8. Thumbnails de B-ROLL e mini-waveforms de TRILHA aparecem para clipes
   reais, cacheados por path (não regeneram a cada render).

## Status

_(propriedade do Executor)_
