# Plan — BEATS timeline: zoom (Premiere-style) + altura de track ajustável

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Design de referência:** brainstorm + exploração feitos em modo de planejamento
nesta sessão (sem spec formal separada desta vez — o design já foi validado
linha a linha contra o código atual antes deste plano ser escrito). Este é o
**primeiro de dois planos** desta rodada de melhorias — o segundo
(`docs/plans/beats-timeline-thumbnails-multiselect.md`) cobre thumbnails/
mini-waveform e multi-seleção, e depende deste (usa `trackHeights`).

**Pré-requisito:** `docs/plans/beats-track-height-fix.md` já executado
(`8cdc623`) — todas as 5 tracks (BEATS/ÁUDIO/LEGENDA/B-ROLL/TRILHA) têm hoje
`min-height:44px` fixo. Este plano torna essa altura ajustável, mas **nunca
abaixo de 44px** — é o piso que evita o bug de colapso documentado naquele
plano (filhos `position:absolute` sem altura própria).

## Escopo

Só `public/index.html` (CSS do timeline + a IIFE do BEATS). **Não tocar**
`server.js` nem qualquer arquivo em `lib/` — zoom e altura de track são
estado 100% client-side, sem persistência em disco. Nenhuma mudança de
lógica de edição (split/merge/trim/drag-reorder/snap/undo/redo continuam
idênticos — só passam a ler `PX_PER_SEC` como variável, não constante,
o que já funciona automaticamente por causa de closures, sem editar essas
funções).

## Files

- **Modify:** `public/index.html`

## Task 1 — `PX_PER_SEC` mutável + funções de zoom

Em `public/index.html`, linha 923, trocar:

```js
  const PX_PER_SEC = 60;
```

por:

```js
  let PX_PER_SEC = 60;
  const PX_PER_SEC_MIN = 4;
  const PX_PER_SEC_MAX = 400;
  const ZOOM_STEP = Math.SQRT2;
```

Isso sozinho já é suficiente para `timeToX`/`xToTime`/`contentWidth`
(linhas 959-961) e as 4 funções que leem `PX_PER_SEC` direto sem passar
por elas (`snapTime` linha 1013, `startTrim` linha 1704, `startClipMove`
linha 1780, `startClipTrim` linha 1809) ficarem zoom-safe — todas leem a
variável do módulo por closure, não uma cópia capturada; **nenhuma dessas
funções precisa ser tocada**.

Logo depois de `function contentWidth() { ... }` (linha 961), adicionar as
funções novas de zoom:

```js
  function clampPx(v) { return Math.max(PX_PER_SEC_MIN, Math.min(PX_PER_SEC_MAX, v)); }
  function updateZoomReadout() {
    const el = $q('#bt-zoomlevel');
    if (el) el.textContent = Math.round(PX_PER_SEC / 60 * 100) + '%';
  }
  function zoomAt(newPx, clientX) {
    const scrollEl = $q('#bt-scroll');
    if (!scrollEl) { PX_PER_SEC = clampPx(newPx); return; }
    const rect = scrollEl.getBoundingClientRect();
    const t = pageXToTime(clientX);
    PX_PER_SEC = clampPx(newPx);
    renderTracks();
    scrollEl.scrollLeft = (192 + timeToX(t)) - (clientX - rect.left);
    updateZoomReadout();
  }
  function zoomAtCenter(newPx) {
    const rect = $q('#bt-scroll').getBoundingClientRect();
    zoomAt(newPx, rect.left + rect.width / 2);
  }
  function fitToWindow() {
    const scrollEl = $q('#bt-scroll');
    const avail = scrollEl.clientWidth - 192;
    if (DURATION > 0 && avail > 0) zoomAtCenter(avail / DURATION);
  }
```

`pageXToTime` (definida mais abaixo, linha 1690) e `renderTracks`
(linha 1526) são `function` declarations dentro da mesma IIFE — hoisted,
podem ser chamadas aqui mesmo definidas depois no arquivo.

**Acceptance:** `PX_PER_SEC` não é mais `const`; `zoomAt(120, x)` chamado
manualmente no console (com um vídeo carregado) dobra o espaçamento visual
dos beats/waveform/legenda sem quebrar nada.

## Task 2 — Régua com espaçamento de ticks proporcional ao zoom

Hoje `renderRuler()` (linha 1229) escolhe o intervalo entre ticks só pela
`DURATION`, ignorando o zoom — em zoom alto os ticks ficam grudados, em
zoom baixo, esparsos demais. Adicionar, logo antes de
`function renderRuler() {` (linha 1229):

```js
  const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];
  function pickTickStep(targetPx = 60) {
    for (const s of TICK_STEPS) if (s * PX_PER_SEC >= targetPx) return s;
    return TICK_STEPS[TICK_STEPS.length - 1];
  }
```

Dentro de `renderRuler()`, trocar a linha:

```js
    const step = DURATION > 120 ? 10 : (DURATION > 40 ? 5 : 1);
```

por:

```js
    const step = pickTickStep();
```

O resto de `renderRuler()` (loop de criação dos ticks, marcação de
`major` a cada 5) não muda.

**Acceptance:** com um vídeo de ~8s, zoom padrão mostra ticks a cada 1s;
aplicar zoom alto (`PX_PER_SEC` grande) faz os ticks recalcularem para um
intervalo menor (ex. 0.1s/0.2s) automaticamente, sem ficarem amontoados;
zoom baixo faz os ticks saltarem para intervalos maiores (10s/30s/etc)
sem ficarem esparsos demais.

## Task 3 — Resolução da waveform independente do zoom atual

Hoje `loadWaveform()` (linha 1049) calcula a resolução dos picos a partir
de `contentWidth()` **no zoom em que o vídeo foi carregado** — se o
usuário depois aumentar bastante o zoom, os picos já calculados ficam
"blocados" (esticados de uma resolução baixa). Trocar, dentro de
`loadWaveform()`, a linha:

```js
      const totalPx = Math.ceil(contentWidth());
```

por:

```js
      const totalPx = Math.ceil(DURATION * PX_PER_SEC_MAX);
```

(o comentário `// ~2px/coluna` na linha seguinte não muda). Isso faz os
picos serem computados uma vez, na resolução do zoom **máximo** possível
— nunca ficam piores que hoje, e ficam consistentemente nítidos em
qualquer nível de zoom, sem re-decodificar áudio a cada mudança de zoom
(comportamento aceitável — é assim que NLEs de verdade também lidam com
zoom extremo de waveform).

**Acceptance:** carregar um vídeo, aplicar zoom alto: a waveform continua
com o mesmo nível de detalhe visual que tinha no zoom padrão (não fica
mais "blocada"/pixelizada que antes).

## Task 4 — Controles de zoom (toolbar, scroll+Ctrl, atalhos de teclado)

### 4a. CSS

Perto de `.bt-time{...}` (linha 251), adicionar:

```css
.bt-zoomlevel{font:400 10.5px var(--mono); color:var(--faint); min-width:38px; text-align:center}
```

### 4b. HTML da toolbar

Em `buildDom()` (linha 1140), no template de `.bt-transport`, trocar:

```html
        <button class="bt-tbtn" id="bt-undo" title="Ctrl+Z">UNDO</button>
        <button class="bt-tbtn" id="bt-redo" title="Ctrl+Shift+Z">REDO</button>
        <div class="bt-time" id="bt-time">00:00.0<span class="d">/</span>00:00.0</div>
```

por:

```html
        <button class="bt-tbtn" id="bt-undo" title="Ctrl+Z">UNDO</button>
        <button class="bt-tbtn" id="bt-redo" title="Ctrl+Shift+Z">REDO</button>
        <div class="bt-tsep"></div>
        <button class="bt-tbtn" id="bt-zoomout" title="-">−</button>
        <span class="bt-zoomlevel" id="bt-zoomlevel">100%</span>
        <button class="bt-tbtn" id="bt-zoomin" title="+">+</button>
        <button class="bt-tbtn" id="bt-zoomfit" title="\">FIT</button>
        <div class="bt-time" id="bt-time">00:00.0<span class="d">/</span>00:00.0</div>
```

### 4c. Wiring

Em `wireTransport()` (linha 1885), logo após `$q('#bt-save').onclick = saveBeats;`
(e antes das linhas `video.addEventListener(...)`), adicionar:

```js
    $q('#bt-zoomin').onclick = () => zoomAtCenter(PX_PER_SEC * ZOOM_STEP);
    $q('#bt-zoomout').onclick = () => zoomAtCenter(PX_PER_SEC / ZOOM_STEP);
    $q('#bt-zoomfit').onclick = fitToWindow;
    $q('#bt-scroll').addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAt(PX_PER_SEC * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), e.clientX);
    }, { passive: false });
    updateZoomReadout();
```

`{ passive: false }` é obrigatório — sem isso `e.preventDefault()` não
tem efeito e o navegador executaria o zoom nativo da página junto.

### 4d. Atalhos de teclado

No `switch (e.key)` do handler de `keydown` (linha 1951), adicionar,
depois do `case 'r': case 'R': ...` (linha 1964) e antes do
`case 'Delete': case 'Backspace':` (linha 1965):

```js
      case '+': case '=': e.preventDefault(); zoomAtCenter(PX_PER_SEC * ZOOM_STEP); break;
      case '-': e.preventDefault(); zoomAtCenter(PX_PER_SEC / ZOOM_STEP); break;
      case '\\': e.preventDefault(); fitToWindow(); break;
```

**Acceptance:** botão `+`/`-`/scroll+Ctrl no timeline muda o zoom;
`Ctrl+scroll` sobre um ponto específico do timeline mantém aquele
instante de tempo visualmente sob o cursor (não "foge" a posição); `FIT`
(ou `\`) ajusta a timeline inteira pra caber na largura visível do
`.bt-scroll`; o indicador de porcentagem atualiza a cada mudança;
`Ctrl+scroll` sem estar sobre o timeline (ex. sobre a página) não é afetado.

## Task 5 — Altura de track ajustável (drag handle)

### 5a. Estado

Depois de `let hiddenTracks = {}, lockedTracks = {};` (linha 934),
adicionar:

```js
  const TRACK_MIN_H = 44;
  const TRACK_MAX_H = 240;
  let trackHeights = { beats: 44, audio: 44, legend: 44, broll: 44, music: 44 };
```

`TRACK_MIN_H` precisa ficar numericamente igual ao `min-height:44px` de
`.bt-track-row` (linha 284, ver Task 5b) — é o piso que preserva o fix de
`docs/plans/beats-track-height-fix.md`.

### 5b. CSS

Trocar (linha 284):

```css
.bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft)}
```

por:

```css
.bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft); position:relative}
.bt-row-resize{position:absolute; left:0; right:0; bottom:-3px; height:6px; cursor:row-resize; z-index:3}
.bt-row-resize:hover{background:var(--go-dim)}
```

(`position:relative` em `.bt-track-row` não afeta o `position:sticky` de
`.bt-track-label{position:sticky; left:0}` — o contexto de scroll da
sticky continua sendo `.bt-scroll`, não muda com um ancestral intermediário
relative.)

### 5c. Handle de resize em cada track

Em `buildDom()` (linha 1140), no template das 5 `.bt-track-row`, trocar
o bloco inteiro:

```html
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">BEATS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
            </div>
            <div class="bt-track-row" data-track="audio">
              <div class="bt-track-label"><span class="ic">♪</span><span class="nm">ÁUDIO</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-audio"><canvas id="bt-wave"></canvas></div>
            </div>
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
```

por (cada `.bt-track-row` ganha um `.bt-row-resize` como último filho):

```html
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">BEATS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
            <div class="bt-track-row" data-track="audio">
              <div class="bt-track-label"><span class="ic">♪</span><span class="nm">ÁUDIO</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-audio"><canvas id="bt-wave"></canvas></div>
              <div class="bt-row-resize" data-track="audio"></div>
            </div>
            <div class="bt-track-row" data-track="legend">
              <div class="bt-track-label"><span class="ic">T</span><span class="nm">LEGENDA</span>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-legend"></div>
              <div class="bt-row-resize" data-track="legend"></div>
            </div>
            <div class="bt-track-row" data-track="broll">
              <div class="bt-track-label"><span class="ic">▭</span><span class="nm">B-ROLL</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe">+</button>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-broll"></div>
              <div class="bt-row-resize" data-track="broll"></div>
            </div>
            <div class="bt-track-row" data-track="music">
              <div class="bt-track-label"><span class="ic">♫</span><span class="nm">TRILHA</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe">+</button>
                <button class="bt-tctl" data-act="mute" title="mudo">M</button>
                <button class="bt-tctl" data-act="solo" title="solo">S</button>
                <button class="bt-tctl" data-act="hide" title="ocultar">H</button>
                <button class="bt-tctl" data-act="lock" title="travar">L</button></div>
              <div class="bt-track-content" id="bt-track-music"></div>
              <div class="bt-row-resize" data-track="music"></div>
            </div>
```

### 5d. Função de drag

Logo antes de `function startTrim(handleEl, e) {` (linha 1694), adicionar:

```js
  function startRowResize(handleEl, e) {
    e.preventDefault();
    e.stopPropagation();
    const track = handleEl.dataset.track;
    const row = handleEl.closest('.bt-track-row');
    const startY = e.clientY, startH = row.getBoundingClientRect().height;
    function onMove(ev) {
      const h = Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, startH + (ev.clientY - startY)));
      trackHeights[track] = h;
      row.style.height = h + 'px';
      if (track === 'audio') drawWaveform();
      if (track === 'broll') renderBrollTrack();
      if (track === 'music') renderMusicTrack();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
```

### 5e. Wiring + aplicar altura salva

Em `wireTracks()` (linha 1865), trocar:

```js
  function wireTracks() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.querySelectorAll('.bt-tctl').forEach(btn => {
```

por:

```js
  function wireTracks() {
    $$q('.bt-track-row').forEach(row => {
      const track = row.dataset.track;
      row.style.height = (trackHeights[track] || TRACK_MIN_H) + 'px';
      row.querySelectorAll('.bt-tctl').forEach(btn => {
```

E, na mesma função, trocar:

```js
    });
    $q('#bt-tracks').addEventListener('mousedown', onTracksMouseDown);
    $q('#bt-tracks').addEventListener('dblclick', onTracksDblClick);
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
    $q('.bt-playhead-flag').addEventListener('mousedown', onFlagMouseDown);
  }
```

por:

```js
      const resizeHandle = row.querySelector('.bt-row-resize');
      if (resizeHandle) resizeHandle.addEventListener('mousedown', e => startRowResize(resizeHandle, e));
    });
    $q('#bt-tracks').addEventListener('mousedown', onTracksMouseDown);
    $q('#bt-tracks').addEventListener('dblclick', onTracksDblClick);
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
    $q('.bt-playhead-flag').addEventListener('mousedown', onFlagMouseDown);
  }
```

(o `});` que fecha o `forEach` externo muda de posição — a linha do
`resizeHandle` entra **dentro** do `forEach`, logo antes do `});` que já
existia.)

### 5f. Waveform respeita a altura da track

Em `drawWaveform()` (linha 1073), trocar:

```js
    const w = contentWidth(), h = 44;
```

por:

```js
    const w = contentWidth(), h = trackHeights.audio;
```

**Acceptance:** arrastar a borda inferior de qualquer track redimensiona
só aquela track (as outras não mudam); a track nunca fica menor que 44px
nem maior que 240px; a waveform da track ÁUDIO preenche a nova altura sem
esticar/comprimir de forma distorcida (barras continuam proporcionais);
`.bt-beat`/`.bt-word`/`.bt-clip` (que usam `top/bottom` em vez de altura
fixa) preenchem automaticamente a nova altura sem CSS adicional.

## Task 6 — Resetar zoom e alturas ao trocar de vídeo

Em `loadVideo()` (linha 1906), trocar a linha:

```js
    hiddenTracks = {}; lockedTracks = {}; trilhaMuted = false; trilhaSolo = false;
```

por:

```js
    hiddenTracks = {}; lockedTracks = {}; trilhaMuted = false; trilhaSolo = false;
    trackHeights = { beats: 44, audio: 44, legend: 44, broll: 44, music: 44 };
    PX_PER_SEC = 60; updateZoomReadout();
```

(mesmo padrão de reset por-troca-de-vídeo já usado para `hiddenTracks`/
`lockedTracks` nessa mesma linha — `updateZoomReadout()` é seguro chamar
aqui mesmo antes de `buildDom()` rodar, porque checa `if (el)` antes de
tocar o DOM.)

**Acceptance:** trocar de vídeo no dropdown VÍDEO reseta o zoom pra 100%
e todas as tracks pra 44px, mesmo que o vídeo anterior estivesse com zoom
ou alturas customizadas.

## Overall acceptance criteria

1. `node --check server.js` continua exit 0 (arquivo não tocado).
2. `git diff --stat` mostra só `public/index.html`.
3. Nenhuma classe fora do prefixo `bt-` criada/alterada.
4. Nenhuma função de mecânica de edição existente (split/merge/trim/
   drag-reorder/snap/undo/redo/hide/lock/mute/solo, `renderTracks`,
   `renderBeatsTrack`, `renderClipTrack`, `renderLegendTrack`) foi
   reescrita — só passaram a ler `PX_PER_SEC`/`trackHeights` como estado
   mutável, sem mudança de lógica própria.
5. Com um vídeo real carregado (BEATS + B-ROLL/TRILHA com pelo menos um
   clipe cada, se disponível): zoom via scroll+Ctrl, botões +/-/FIT e
   atalhos de teclado funcionam; redimensionar cada uma das 5 tracks
   funciona independentemente; split/merge/trim/drag continuam
   funcionando normalmente em qualquer nível de zoom (não só o padrão).
6. Trocar de vídeo reseta zoom e alturas de track.

## Status

_(propriedade do Executor)_

**Execução concluída (2026-08-12).** Todas as 6 tasks aplicadas em
`public/index.html` exatamente como especificado no plano (blocos ATUAL/NOVO
localizados por conteúdo, não por número de linha — os números do plano
bateram muito perto dos reais, com desvio de poucas linhas por edições
anteriores já commitadas).

**O que foi feito:**
1. `PX_PER_SEC` → `let` + `PX_PER_SEC_MIN`/`MAX`/`ZOOM_STEP` + `clampPx`/
   `updateZoomReadout`/`zoomAt`/`zoomAtCenter`/`fitToWindow` logo após
   `contentWidth()`.
2. `TICK_STEPS`/`pickTickStep()` adicionados antes de `renderRuler()`; a
   linha do `step` fixo trocada por `pickTickStep()`.
3. `loadWaveform()`: `totalPx` agora usa `DURATION * PX_PER_SEC_MAX` em vez
   de `contentWidth()`.
4. Controles de zoom completos: CSS `.bt-zoomlevel`, botões `bt-zoomout`/
   `bt-zoomlevel`/`bt-zoomin`/`bt-zoomfit` na toolbar (com `.bt-tsep` extra
   antes, como no plano), wiring em `wireTransport()` (cliques + `wheel`
   com `{ passive: false }` + `updateZoomReadout()` inicial), atalhos de
   teclado `+`/`-`/`\` no `switch (e.key)` do handler de keydown, entre
   `case 'r'` e `case 'Delete'`.
5. Altura de track ajustável: estado `TRACK_MIN_H`/`TRACK_MAX_H`/
   `trackHeights` após `hiddenTracks`/`lockedTracks`; CSS `.bt-track-row`
   ganhou `position:relative`, novo `.bt-row-resize` (+`:hover`); as 5
   `.bt-track-row` no template de `buildDom()` ganharam
   `<div class="bt-row-resize" data-track="...">` como último filho;
   `startRowResize()` adicionada antes de `startTrim()`; `wireTracks()`
   aplica `row.style.height` na montagem e liga `mousedown` no handle de
   cada row (dentro do `forEach`, antes do `});` que já existia);
   `drawWaveform()` agora usa `h = trackHeights.audio` em vez de `44`
   fixo.
6. `loadVideo()`: reset de `trackHeights` para o default de 44px em todas
   as tracks e `PX_PER_SEC = 60; updateZoomReadout();` na mesma linha que
   já resetava `hiddenTracks`/`lockedTracks`/`trilhaMuted`/`trilhaSolo`.

**Validação estática executada (com evidência):**
- `node --check server.js` → exit 0 (`server.js` não tocado, confirmado
  também por `git diff --stat` não listá-lo).
- `git diff --stat` → só `public/index.html` (1 file changed, 92
  insertions(+), 5 deletions(-)).
- Extraí o único bloco `<script>` do HTML para um `.js` temporário e rodei
  `node --check` nele → passou sem erro de sintaxe (cobre os 6 blocos de
  JS inseridos/editados: funções de zoom, `pickTickStep`, `loadWaveform`,
  wiring de zoom, `startRowResize`, wiring de `wireTracks`, reset em
  `loadVideo`, atalhos de teclado).
- Classes CSS novas nas linhas adicionadas do diff: `bt-zoomlevel`,
  `bt-row-resize` — ambas com prefixo `bt-`; nenhuma outra classe nova
  fora desse prefixo (reusei `bt-tbtn`/`bt-tsep` já existentes para os
  botões de zoom, não criei classes novas para eles).
  Seletores CSS novos (`grep '^+\.'` no diff): `.bt-zoomlevel`,
  `.bt-track-row` (reescrita, já existia), `.bt-row-resize`,
  `.bt-row-resize:hover` — todos `bt-`.
- Confirmado por leitura de diff que nenhuma função de mecânica de edição
  (`splitBeatAt`, `mergeWithNext`, `startTrim`, `startClipMove`,
  `startClipTrim`, `snapTime`, `renderTracks`, `renderBeatsTrack`,
  `renderClipTrack`, `renderLegendTrack`, undo/redo, hide/lock/mute/solo)
  teve seu corpo alterado — os únicos `diff` hunks dentro dessas funções
  são as duas linhas de Task 5f/1 (`drawWaveform` h= e `loadWaveform`
  totalPx=), que são leituras de estado, não mudança de lógica.
- Verifiquei por grep que todos os identificadores referenciados pelo
  código novo existem no arquivo: `pageXToTime` (linha ~1740, dentro da
  mesma IIFE, hoisted), `renderTracks` (linha ~1575), `renderBrollTrack`/
  `renderMusicTrack` (linhas 1404-1405, wrappers de `renderClipTrack`),
  `#bt-scroll` (id existente no template), variável CSS `--go-dim`
  (usada em `.bt-row-resize:hover`, já definida no `:root`).

**Pendente de checagem visual/funcional ao vivo (não executado nesta
rodada — ferramentas de navegador não usadas por padrão nesta execução):**
- Zoom via scroll+Ctrl sobre o timeline mantendo o ponto sob o cursor
  fixo visualmente.
- Zoom via botões `+`/`−`/`FIT` e atalhos de teclado `+`/`-`/`\`.
- Indicador de porcentagem (`#bt-zoomlevel`) atualizando corretamente.
- `Ctrl+scroll` fora do `.bt-scroll` (ex. na página) não é capturado.
- Ruler recalculando o intervalo de ticks corretamente em zoom alto/baixo
  com um vídeo real (~8s).
- Waveform mantendo nitidez em zoom alto (não "blocada").
- Arrastar o handle inferior de cada uma das 5 tracks (BEATS/ÁUDIO/
  LEGENDA/B-ROLL/TRILHA) redimensionando só aquela track, respeitando
  piso 44px / teto 240px, com waveform/clipes de B-ROLL/TRILHA
  re-renderizando ao vivo durante o arraste.
- Split/merge/trim/drag-reorder continuando a funcionar normalmente em
  zoom não-padrão (ex. 200%/50%).
- Troca de vídeo no dropdown resetando zoom para 100% e todas as tracks
  para 44px mesmo partindo de estado customizado.

Recomendo ao Orquestrador rodar esses 9 pontos manualmente (ou via
subagente com acesso a browser) antes de considerar a Task pronta para
o segundo plano (`beats-timeline-thumbnails-multiselect.md`), que depende
de `trackHeights` já estar funcionando corretamente na prática.
