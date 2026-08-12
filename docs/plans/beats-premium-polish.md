# Plan — Polimento premium do step 04 · BEATS

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Pré-requisito:** `docs/plans/beat-timeline-editor.md` já executado — o step BEATS
real já existe em `server.js` (`/api/beats`) e `public/index.html` (tracks
BEATS/ÁUDIO/LEGENDA/B-ROLL/TRILHA, drag/trim/split/merge/undo/snap/J-K-L).
Este plano é **aditivo e cosmético/UX** — não muda o modelo de dados, as
rotas, nem nenhuma mecânica de edição já validada.

## Auditoria — o que hoje está funcional mas abaixo do resto do app

O resto do `ai-video-studio` (header, `.card`, `.btn`) usa uma linguagem
"cinema noir" consistente: gradientes sutis, glow âmbar em elementos ativos,
sweep de brilho no hover dos botões primários, cantos com hairline
âmbar→violeta. O módulo BEATS (`#bt-root` e o bloco JS da IIFE em
`public/index.html`) foi implementado funcionalmente correto mas visualmente
mais plano que o resto do produto:

1. **Popover de papel narrativo** (`openPopover`) abre sem transição (pop-in
   instantâneo), os botões de `ROLES` não mostram a cor que será aplicada ao
   beat, e não há glow no papel atualmente selecionado.
2. **Painel de preview** (`.bt-preview`) só mostra o `<video>` bruto — sem
   overlay de legenda ao vivo (a track LEGENDA já tem `words` real, mas
   nada no preview usa isso), sem tag de fase, sem timecode sobreposto.
3. **Lista de papéis (`renderLegendList`)** nunca marca qual beat está tocando
   agora — nenhuma linha recebe destaque quando o playhead entra na sua
   janela de tempo, e não há indicação de progresso dentro do beat ativo.
4. **Shuttle J/K/L** não mostra a velocidade atual (1×/2×/4×/8×) em lugar
   nenhum da UI — o usuário só descobre por tentativa.
5. **Sem glow/pulso no playhead** e sem estados de hover/foco mais ricos nos
   botões do transporte (`.bt-tbtn`, `.bt-tctl`) — eles têm apenas troca de
   cor, sem o tratamento de elevação/glow que `.btn` usa no resto do app.
6. **Acessibilidade de foco:** `.bt-tbtn`/`.bt-tctl`/`.bt-toggle` não estão
   na lista de seletores com `:focus-visible` definida no topo do arquivo —
   navegação por teclado nesses controles não mostra anel de foco.

Nenhum bug de dados ou de mecânica de edição foi encontrado — split, merge,
trim com ripple, drag-reorder, snap, undo/redo, hide/lock de track,
mute/solo de trilha e o sidecar `.beats.json` funcionam como descrito no
plano anterior. Este plano só cobre os 6 pontos acima.

## Escopo

Só `public/index.html` (CSS + a IIFE do BEATS). **Não tocar** `server.js`
nem qualquer arquivo em `lib/`. Nenhuma track nova, nenhuma aba "Estilo" —
ficou fora do escopo pedido.

## Files

- **Modify:** `public/index.html`

## Task 1 — CSS (antes do `</style>`, depois do bloco `.bt-asset-opt:hover`)

```css
@keyframes bt-pulse{0%,100%{box-shadow:0 0 6px rgba(251,191,36,.7)}50%{box-shadow:0 0 16px rgba(251,191,36,1)}}
.bt-playhead-flag{animation:bt-pulse 1.6s ease-in-out infinite}

.bt-tbtn,.bt-tctl,.bt-toggle{transition:color .15s ease,border-color .15s ease,box-shadow .15s ease}
.bt-tbtn:focus-visible,.bt-tctl:focus-visible,.bt-toggle:focus-visible{outline:2px solid var(--go);outline-offset:2px}
.bt-beat{transition:transform .15s ease,filter .15s ease,box-shadow .15s ease}
.bt-beat:hover{filter:brightness(1.15);transform:translateY(-1px);box-shadow:0 6px 16px -6px rgba(0,0,0,.6)}

.bt-pop{transform-origin:top left;transition:transform .16s ease,opacity .16s ease}
.bt-pop.enter{transform:scale(.96);opacity:0}
.bt-role-opt{display:flex;align-items:center;gap:5px}
.bt-role-dot{width:7px;height:7px;border-radius:2px;flex:0 0 auto}

.bt-rate{font:600 10px var(--mono);color:#0a0a14;background:linear-gradient(180deg,#fde68a,#fbbf24);
  padding:2px 8px;border-radius:999px;box-shadow:0 0 10px rgba(251,191,36,.55);letter-spacing:.04em;margin-left:8px}

.bt-legend-row{position:relative;transition:background .15s ease}
.bt-legend-row.active{background:rgba(251,191,36,.08)}
.bt-legend-row .bar{position:absolute;left:22px;right:60px;bottom:2px;height:2px;border-radius:2px;
  background:rgba(129,140,248,.25);overflow:hidden}
.bt-legend-row .bar i{display:block;height:100%;background:linear-gradient(90deg,var(--go-solid),var(--go))}

.bt-preview-tag{position:absolute;top:8px;left:8px;font:600 8.5px var(--sans);letter-spacing:.08em;color:var(--go);
  background:rgba(0,0,0,.55);border:1px solid rgba(251,191,36,.4);padding:2px 7px;border-radius:3px;z-index:3}
.bt-preview-time{position:absolute;bottom:8px;right:8px;font:400 9.5px var(--mono);color:var(--dim);
  background:rgba(0,0,0,.5);padding:2px 6px;border-radius:3px;z-index:3}
.bt-cap-overlay{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);width:90%;text-align:center;
  font:400 13px 'Unica One',sans-serif;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.85);z-index:3}
.bt-cap-overlay b{color:var(--go);font-weight:400;text-shadow:0 0 10px rgba(251,191,36,.6)}
```

**Acceptance:** nenhuma classe fora do prefixo `bt-`; abrir os outros 6
steps/tools não muda visualmente (regras só afetam seletores `.bt-*`).

## Task 2 — Preview panel com overlay de legenda ao vivo

Em `buildDom()`, dentro de `.bt-video-wrap`, logo após a tag `<video>`,
adicionar:

```html
<span class="bt-preview-tag">BEATS · REVISÃO</span>
<div class="bt-cap-overlay" id="bt-cap-overlay"></div>
<span class="bt-preview-time" id="bt-preview-time"></span>
```

Nova função, chamada do `timeupdate` (junto de `renderPlayhead`/
`updateTimeDisplay`/`highlightActiveWord`):

```js
function updatePreviewOverlay() {
  const t = video ? video.currentTime : 0;
  $q('#bt-preview-time').textContent = fmt(t);
  const idx = words.findIndex(w => t >= w.start && t < w.end);
  const el = $q('#bt-cap-overlay');
  if (idx < 0) { el.innerHTML = ''; return; }
  const before = words.slice(Math.max(0, idx - 2), idx).map(w => w.text).join(' ');
  const after = words.slice(idx + 1, idx + 3).map(w => w.text).join(' ');
  el.innerHTML = (before ? before + ' ' : '') + '<b>' + escapeHtml(words[idx].text) + '</b>' + (after ? ' ' + after : '');
}
```

Chamar `updatePreviewOverlay()` no listener `timeupdate` existente.

**Acceptance:** com um vídeo que tenha `.ass` (via `lastAss`), tocar o
preview mostra a palavra ativa em âmbar com 2 palavras de contexto de cada
lado; sem `.ass`, o overlay fica vazio (sem erro).

## Task 3 — Legenda com beat ativo + barra de progresso

Substituir `renderLegendList()` para incluir estado ativo:

```js
function renderLegendList() {
  const host = $q('#bt-legend-list');
  if (!host) return;
  const t = video ? video.currentTime : 0;
  host.innerHTML = BEATS.map((b, i) => {
    const s = beatStart(i), active = t >= s && t < s + b.dur;
    const pct = active ? Math.max(0, Math.min(100, ((t - s) / b.dur) * 100)) : 0;
    return `<div class="bt-legend-row${active ? ' active' : ''}" data-idx="${i}">
        <span class="dot" style="background:${b.color}${active ? `;box-shadow:0 0 8px ${b.color}` : ''}"></span>
        <span class="n">${escapeHtml(b.label)}</span><span class="d">${b.dur.toFixed(1)}s</span>
        ${active ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : ''}
      </div>`;
  }).join('');
  host.querySelectorAll('.bt-legend-row').forEach(row => {
    row.onclick = () => { selected = +row.dataset.idx; seekTo(beatStart(selected)); renderTracks(); };
  });
}
```

Call it from the `timeupdate` listener too (cheap re-render — the row count
tops out at a handful of beats per reel).

**Acceptance:** avançar o vídeo e observar a linha correspondente ao beat
atual ganhar fundo âmbar e uma barrinha de progresso; clicar em uma linha
ainda seleciona e faz seek, como antes.

## Task 4 — Badge de velocidade J/K/L

No HTML estático da `.bt-transport` (`buildDom()`), adicionar depois do
`#bt-time`:

```html
<span class="bt-rate" id="bt-rate" style="display:none"></span>
```

Em `shuttleForward`/`shuttleReverse`, depois de `video.playbackRate = …`,
e em `shuttleStop`, atualizar:

```js
function updateRateBadge() {
  const el = $q('#bt-rate');
  if (!el) return;
  const abs = Math.abs(jklLevel);
  if (abs <= 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = (jklLevel < 0 ? '◀ ' : '') + abs + '×';
}
```
Chamar `updateRateBadge()` no fim de `shuttleForward`, `shuttleReverse` e
`shuttleStop`.

**Acceptance:** apertar `L` duas vezes seguidas mostra "4×"; `K` some com o
badge.

## Task 5 — Popover com entrada suave + swatch de cor por papel

Em `openPopover()`, logo após `document.body.appendChild(popEl)`:

```js
popEl.classList.add('enter');
requestAnimationFrame(() => popEl.classList.remove('enter'));
```

No template do grid de papéis, adicionar o swatch:

```js
${ROLES.map(r => `<button class="bt-role-opt${r === b.label ? ' cur' : ''}" data-role="${r}">
    <span class="bt-role-dot" style="background:${colorFor(ROLES.indexOf(r))}"></span>${r}</button>`).join('')}
```

Aplicar o mesmo padrão (`.classList.add('enter')` + rAF remove) em
`openAddClipPopover()`.

**Acceptance:** abrir o popover (duplo-clique num beat ou botão RENAME)
mostra um pop-in suave (~160ms) em vez de aparecer instantâneo; cada opção
de papel mostra a cor que será aplicada.

## Overall acceptance criteria

1. `node --check server.js` continua exit 0 (arquivo não tocado).
2. `git diff --stat` mostra só `public/index.html`.
3. Todos os 6 steps/tools fora de BEATS continuam idênticos — nenhuma
   classe fora do prefixo `bt-` foi criada ou alterada.
4. Split/merge/trim/drag-reorder/snap/undo/redo/hide/lock/mute/solo em
   BEATS continuam funcionando exatamente como antes (nenhuma dessas
   funções foi reescrita — só chamadas extras de render foram adicionadas).
5. `SALVAR BEATS`/`CARREGAR` continuam gravando/lendo o mesmo
   `<video>.beats.json`.

## Status

_(propriedade do Executor)_

**Executado em 2026-08-12.** Todas as 5 tasks implementadas literalmente
conforme os blocos de código do plano, em `public/index.html`:

- **Task 1 (CSS):** bloco inserido logo depois de `.bt-asset-opt:hover`
  (linha ~355), antes de `</style>`. Confere byte-a-byte com o snippet do
  plano.
- **Task 2 (overlay de legenda no preview):** `<span class="bt-preview-tag">`,
  `<div id="bt-cap-overlay">` e `<span id="bt-preview-time">` adicionados
  dentro de `.bt-video-wrap` em `buildDom()`. Função `updatePreviewOverlay()`
  criada logo após `highlightActiveWord()` e chamada a partir do listener
  `timeupdate` existente (`video.addEventListener('timeupdate', …)`).
- **Task 3 (legenda com beat ativo):** `renderLegendList()` substituída
  exatamente pelo snippet do plano (fundo âmbar + barra de progresso);
  chamada adicionada também ao mesmo listener `timeupdate`.
- **Task 4 (badge de velocidade):** `<span class="bt-rate" id="bt-rate"
  style="display:none">` inserido depois de `#bt-time` na `.bt-transport`.
  Função `updateRateBadge()` criada e chamada ao fim de `shuttleForward`,
  `shuttleReverse` e `shuttleStop`.
- **Task 5 (popover suave + swatch de papel):** `.classList.add('enter')` +
  `requestAnimationFrame(() => popEl.classList.remove('enter'))` aplicado em
  `openPopover()` e `openAddClipPopover()`, logo após
  `document.body.appendChild(popEl)`. Grid de `ROLES` em `openPopover()`
  atualizado para incluir `<span class="bt-role-dot" style="background:
  ${colorFor(ROLES.indexOf(r))}">` antes do rótulo.

**Validação dos critérios de aceite gerais:**

1. `node --check server.js` → exit 0 (`OK`), arquivo não tocado (não aparece
   em `git status --short`).
2. `git diff --stat` → só `public/index.html` (`1 file changed, 74
   insertions(+), 6 deletions(-)`).
3. Todos os seletores/classes novos ou alterados têm prefixo `bt-`
   (`bt-pulse` keyframe, `bt-playhead-flag`, `bt-tbtn`, `bt-tctl`,
   `bt-toggle`, `bt-beat`, `bt-pop`/`bt-pop.enter`, `bt-role-opt`,
   `bt-role-dot`, `bt-rate`, `bt-legend-row`/`.active`/`.bar`,
   `bt-preview-tag`, `bt-preview-time`, `bt-cap-overlay`) — confirmado via
   `git diff` filtrado por `class=`/seletores CSS adicionados. As classes
   genéricas `dot`/`n`/`d`/`bar` usadas no HTML novo já existiam no CSS como
   filhas escopadas de `.bt-legend-row`, seguindo o padrão pré-existente do
   arquivo (não são seletores globais novos). Os outros 6 steps/tools não
   foram tocados (nenhuma edição fora das faixas de código do módulo BEATS).
4. Nenhuma função de mecânica de edição (split/merge/trim/drag-reorder/
   snap/undo/redo/hide/lock/mute/solo) foi reescrita — inspecionado no diff
   completo: as únicas mudanças em `shuttleForward`/`shuttleReverse`/
   `shuttleStop` são a chamada extra `updateRateBadge()`; `renderLegendList`
   ganhou marcação visual mas manteve o mesmo comportamento de clique/seek;
   `openPopover`/`openAddClipPopover` só ganharam a animação de entrada e o
   swatch de cor, sem alterar a lógica de salvar/cancelar/selecionar papel.
5. `saveBeats`/carregamento de `<video>.beats.json` não aparecem no diff —
   intocados.

**Verificação adicional feita pelo Executor (fora dos critérios formais, só
para reduzir risco):** extraí o único bloco `<script>` do arquivo e validei
sintaticamente com `new Function(script)` — sem erros de parsing.

Nenhum bloqueio encontrado. Nenhum desvio do plano.
