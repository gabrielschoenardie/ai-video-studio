# Plan — Beat Timeline editor (novo step 04 · BEATS)

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Pré-requisito:** este plano assume que
`docs/plans/simplify-pipeline-remove-brief-score.md` **já foi executado** —
ou seja, a pipeline visível já é VISUALS(01) → VOICE(02) → ASSEMBLE(03) →
EXPORT(04), sem BRIEF nem SCORE. Se esse plano ainda não rodou, rode-o
primeiro: os âncoras de linha e a numeração abaixo partem do estado
pós-simplificação, não do repo original com 6 steps.

## Goal

Portar o conceito do timeline editor multi-track (protótipo em HTML/JS validado
fora do repo) para dentro do `ai-video-studio` real, como um **novo step da
pipeline** logo depois de ASSEMBLE. O step deixa o usuário revisar o corte que
o Whisper/Assemble já produziu, **dividir/fundir/renomear beats narrativos**
manualmente (HOOK, CONTEXTO, TENSAO, CTA…), reordenar por drag, navegar com
J/K/L e marcar região I/O — e **salvar esse rótulo como `<video>.beats.json`**
ao lado do arquivo, um sidecar que hoje não existe em lugar nenhum do app.

**Por que isso importa para o roadmap real:** o `clipper.js` já tem um
`llmMoments()`/`offlineMoments()` que escolhe momentos, mas nenhum dos dois
produz papéis narrativos nomeados — só `{start, end, reason, hookText}`. O
`beats.json` gerado aqui é exatamente o formato de fixture que um futuro
moment-picker semântico (Fase 4 mencionada no CLAUDE.md do projeto) vai
precisar como ground truth. Este plano não implementa esse picker — só cria a
ferramenta manual e o contrato de dados que ele vai consumir depois.

## Escopo — o que fica de fora desta rodada (e por quê)

O protótipo original também tinha uma aba "Estilo" (tela dividida, headline
com destaque, legenda com cor customizada) e tracks de B-ROLL/TRILHA
editáveis. **Nenhum dos dois entra aqui**, porque:

- Não existe no `ai-video-studio` real nenhum compositor de tela dividida ou
  de headline estilizada — isso pertenceria ao `remotion/src/scenes/`, não ao
  timeline editor, e é trabalho de composição, não de rotulagem.
- B-ROLL/TRILHA editáveis pressupõem múltiplos clipes de referência
  posicionados no tempo absoluto do vídeo montado. O `clipper.js` hoje corta
  cada momento em um **arquivo próprio com tempo local** (0..dur) — não dá
  pra plotar isso numa timeline absoluta sem inventar dado. Forçar essas
  tracks com dado falso seria pior que não ter a track.

O step novo entrega 3 tracks **reais**: BEATS (rótulo manual, novo),
ÁUDIO (waveform real decodificada via Web Audio do arquivo selecionado) e
LEGENDA (palavras reais extraídas do `.ass` que o ASSEMBLE já produz). Se
quiser B-ROLL/TRILHA de verdade depois, é outro plano
(`docs/plans/beats-broll-compositor.md`), condicionado a existir primeiro um
jeito de posicionar clipes em tempo absoluto — fora do escopo aqui.

## Global constraints

- **Zero npm deps.** Tudo em JS vanilla / Canvas / Web Audio API, dentro do
  `public/index.html` existente — mantém a filosofia de single-file/no-build
  do projeto. Não criar `public/beats.js` separado: o servidor não tem rota
  de arquivo estático genérica (só `/`, `/index.html` e `/files/*`), então um
  segundo arquivo JS exigiria uma rota nova só para servi-lo. Ficar inline
  evita essa superfície nova.
- **Não tocar** `lib/assemble.js`, `lib/encode.js`, `lib/clipper.js`,
  `lib/color.js`, `lib/vmaf.js` — nada do pipeline de encode/VBV/cor muda.
  Este plano é 100% aditivo: 2 rotas novas pequenas no `server.js` e um bloco
  novo (CSS + HTML + JS) no `public/index.html`.
- **Não renumerar/alterar** as entradas existentes de `STEP_ORDER` — só
  inserir `'beats'` depois de `'assemble'`. O rótulo visível "04" de EXPORT
  muda pra "05" (texto), a lógica de navegação (`goStep`, `markDone`,
  `data-step`) não.
- **Não restart do servidor** nem `npm install` — Orquestrador verifica depois.
- **Não commitar** — git passa pelo subagente `git-workflow` à parte.
- Reaproveitar os helpers já existentes (`$`, `$$`, `api()`, `addAsset()`,
  `renderAssets()`, `watchJob()`, `goStep()`, `markDone()`) — não duplicar.
- Reaproveitar os design tokens reais do tema (cinema noir índigo/âmbar):
  `--bg`, `--bg2`, `--panel`, `--panel2`, `--line`, `--line-soft`, `--ink`,
  `--dim`, `--faint`, `--go`/`--go-hi`/`--go-solid`/`--go-dim`, `--warn`,
  `--bad`, `--disp`/`--sans`/`--mono`, `--radius`/`--radius-sm`. **Não**
  introduzir uma segunda paleta (nada de verde fósforo / cor "destaque"
  customizável — isso pertencia à aba Estilo que ficou fora do escopo).

## Files

- **Modify:** `server.js` (2 rotas novas: `GET`/`POST /api/beats`)
- **Modify:** `public/index.html` (nav + STEP_ORDER + nova `<section>` +
  CSS do timeline + módulo JS do timeline + 1 linha em `renderAssets()`)

Nenhum outro arquivo é tocado.

---

## Task 1 — `server.js`: rotas `/api/beats`

Sidecar JSON ao lado do próprio vídeo (`<nome-sem-extensão>.beats.json`),
seguindo exatamente o padrão de segurança de caminho já usado em
`resolveInput`/`insideRoot` — nenhuma rota nova de escrita fora dessas duas
funções.

Inserir logo após o bloco da rota `/api/luts` (atualmente linhas 165–171,
antes do comentário `// Step 4 — voiceover` na linha 173):

```js
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
      const payload = { version: 1, video: b.video, duration: b.duration || null,
        beats: b.beats, updatedAt: new Date().toISOString() };
      fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: path.relative(ROOT, sidecar) });
    }

```

**Formato de um beat:** `{ label: string, start: number, dur: number }`, tempos
em segundos, mesmo vocabulário de papel narrativo que o resto do projeto usa
informalmente (HOOK, QUEM, CONTEXTO, CONTRASTE, TENSAO, VIRADA, SOLUCAO,
TESE, PROVA, URGENCIA, OFERTA, BENEFICIO, CTA) — mas o campo aceita
qualquer string; a lista é só sugestão de UI (Task 4).

**Acceptance (Task 1):**
- `node --check server.js` exit 0.
- `grep -c "api/beats" server.js` → 2 (GET e POST).
- Teste manual rápido (servidor rodando):
  `curl -s -X POST localhost:4870/api/beats -H 'content-type: application/json' -d '{"video":"output/reel-teste.mp4","duration":10,"beats":[{"label":"HOOK","start":0,"dur":10}]}'`
  → `{"ok":true,"path":"output/reel-teste.beats.json"}` (ajustar o path pra um
  arquivo que realmente exista em `output/` no ambiente de teste; a rota
  chama `resolveInput`, que rejeita caminho inexistente fora de
  `jobs/`/`output/`/`luts/`).
- `curl -s "localhost:4870/api/beats?video=output/reel-teste.mp4"` → devolve
  o mesmo JSON salvo.

---

## Task 2 — `public/index.html`: esqueleto do novo step (nav + section + STEP_ORDER)

Só estrutura nesta tarefa — sem lógica de timeline ainda. Deixa o step
navegável e vazio, pra validar que nada quebrou antes de entrar na parte
grande (Task 3/4).

**2a. Nav button.** Localize o botão ASSEMBLE na `<nav>` (depois da
simplificação ele é `<button data-step="assemble"><span class="n"
aria-hidden="true">03</span>ASSEMBLE</button>`) e insira logo depois dele:
```html
  <button data-step="beats"><span class="n" aria-hidden="true">04</span>BEATS</button>
```
E renumere o botão EXPORT que vem em seguida — de:
```html
  <button data-step="export"><span class="n" aria-hidden="true">04</span>EXPORT</button>
```
para:
```html
  <button data-step="export"><span class="n" aria-hidden="true">05</span>EXPORT</button>
```

**2b. Section shell.** Insira logo depois do `</section>` que fecha
ASSEMBLE, antes do comentário `<!-- 04 EXPORT -->`:
```html

  <!-- 04 BEATS -->
  <section class="step wide" id="step-beats">
    <h2>04 / <em>BEATS</em></h2>
    <p class="sub">Divida o corte em papéis narrativos (HOOK, CONTEXTO, CTA…),
      ajuste as bordas arrastando, funda ou separe beats, e salve o rótulo ao
      lado do vídeo. Isso não altera o arquivo — é metadado para revisão e
      para alimentar um moment-picker mais tarde.</p>
    <div class="row">
      <div><label for="bt-visual">VÍDEO</label><select id="bt-visual"></select></div>
      <div><label for="bt-load">BEATS SALVOS</label>
        <button class="btn ghost sm" id="bt-load-btn" style="margin-top:0">CARREGAR</button></div>
    </div>
    <div id="bt-root"><div class="empty">Escolha um vídeo acima.</div></div>
  </section>
```
E renumere o heading visível do EXPORT — de `<h2>04 / <em>EXPORT</em></h2>`
para `<h2>05 / <em>EXPORT</em></h2>` (e o comentário `<!-- 04 EXPORT -->`
para `<!-- 05 EXPORT -->`, cosmético).

**2c. CSS do wrapper largo.** O CSS compartilhado tem `.step{...;max-width:840px}`
— não editar essa regra; ela é usada por todos os outros steps. Em vez
disso, logo antes do `</style>`, adicionar uma regra aditiva:
```css
.step.wide{max-width:none}
```
Isso dá ao BEATS a largura toda do `<main>` sem afetar VISUALS/VOICE/
ASSEMBLE/EXPORT/CLIPPER/DOWNLOAD/LIBRARY, que continuam com
`max-width:840px` por não terem a classe `wide`.

**2d. STEP_ORDER.** Localize (pós-simplificação):
```js
const STEP_ORDER = ['visuals', 'voice', 'assemble', 'export'];
```
e troque por:
```js
const STEP_ORDER = ['visuals', 'voice', 'assemble', 'beats', 'export'];
```
O footer prev/next já é gerado a partir desse array — nenhuma outra mudança
necessária ali, os números `String(i+1)` se recalculam sozinhos.

**2e. Popular o select de vídeo.** Em `renderAssets()`, logo depois da
linha que popula `#asm-visual` (`$('#asm-visual').innerHTML =
vids.map(opt).join('');`), adicionar:
```js
  $('#bt-visual').innerHTML = vids.map(opt).join('');
```

**Acceptance (Task 2):**
- Abrir `http://localhost:4870`, clicar em BEATS na nav — a section aparece,
  mostra "Escolha um vídeo acima.", e o footer prev/next mostra
  `← 03 ASSEMBLE` / `05 EXPORT →`.
- EXPORT agora mostra "05" no rail e no `<h2>`.
- Montar/exportar um vídeo em ASSEMBLE continua funcionando exatamente igual
  (nenhuma linha de `doAssemble` foi tocada nesta tarefa).
- `grep -c 'data-step="beats"' public/index.html` → 1 na nav +
  `id="step-beats"` aparece 1x na section.

---

## Task 3 — `public/index.html`: CSS do timeline (escopo `#step-beats`)

Adicionar, também antes do `</style>` (depois da regra `.step.wide` da Task
2c), o bloco de estilo do timeline. Prefixo `bt-` em toda classe nova pra não
colidir com nada existente (`.card`, `.row`, `.chip`, `.btn` continuam sendo
reaproveitadas como estão — só os elementos exclusivos do timeline levam
prefixo).

```css
/* ---------------- BEATS timeline ---------------- */
#bt-root{display:flex; flex-direction:column; gap:14px; margin-top:8px}
.bt-transport{display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  background:var(--panel); border:1px solid var(--line); border-radius:var(--radius-sm);
  padding:9px 12px}
.bt-tbtn{all:unset; cursor:pointer; min-width:30px; height:28px; padding:0 8px;
  display:flex; align-items:center; justify-content:center; font:600 11px var(--mono);
  color:var(--dim); border:1px solid var(--line); border-radius:6px; text-align:center}
.bt-tbtn:hover:not([disabled]){color:var(--go); border-color:rgba(251,191,36,.5)}
.bt-tbtn[disabled]{opacity:.3; cursor:default}
.bt-tsep{width:1px; height:18px; background:var(--line)}
.bt-time{font:400 13px var(--mono); color:var(--ink)}
.bt-time .d{color:var(--faint); margin:0 3px}
.bt-spacer{flex:1}
.bt-toggle{all:unset; cursor:pointer; font:500 10.5px var(--sans); color:var(--dim);
  border:1px solid var(--line); border-radius:6px; padding:5px 10px}
.bt-toggle.on{color:var(--go); border-color:rgba(251,191,36,.5); background:var(--go-dim)}

.bt-preview{display:flex; gap:14px}
.bt-video-wrap{width:220px; flex:0 0 auto; background:#000; border:1px solid var(--line);
  border-radius:var(--radius-sm); overflow:hidden; aspect-ratio:9/16}
.bt-video-wrap video{width:100%; height:100%; object-fit:contain; background:#000}
.bt-legend{flex:1; display:flex; flex-direction:column; gap:6px; min-width:200px}
.bt-legend-row{display:flex; align-items:center; gap:8px; font:400 12px var(--mono);
  color:var(--dim); cursor:pointer; padding:4px 6px; border-radius:6px}
.bt-legend-row:hover{background:rgba(129,140,248,.06)}
.bt-legend-row .dot{width:9px; height:9px; border-radius:2px; flex:0 0 auto}
.bt-legend-row .n{color:var(--ink); flex:1}
.bt-legend-row .d{color:var(--faint)}

.bt-scroll{overflow:auto; border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--bg2); position:relative}
.bt-inner{position:relative}
.bt-ruler{position:sticky; top:0; z-index:5; height:22px; margin-left:120px;
  background:var(--panel); border-bottom:1px solid var(--line)}
.bt-ruler-corner{position:absolute; left:-120px; top:0; width:120px; height:22px;
  background:var(--panel); border-right:1px solid var(--line); border-bottom:1px solid var(--line); z-index:6}
.bt-tick{position:absolute; top:0; bottom:0; border-left:1px solid var(--line-soft)}
.bt-tick.major{border-left:1px solid rgba(129,140,248,.28)}
.bt-tick span{position:absolute; top:3px; left:4px; font-size:9px; color:var(--faint)}
.bt-tick.major span{color:var(--dim)}
.bt-tracks{position:relative; padding-bottom:12px}
.bt-track-row{display:flex; border-bottom:1px solid var(--line-soft)}
.bt-track-label{position:sticky; left:0; z-index:4; width:120px; flex:0 0 auto;
  display:flex; align-items:center; gap:6px; padding:0 9px; background:var(--panel);
  border-right:1px solid var(--line); font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim)}
.bt-track-label .ic{color:var(--go); width:11px; text-align:center; flex:0 0 auto}
.bt-track-label .nm{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.bt-tctl{all:unset; cursor:pointer; color:var(--faint); font:700 8.5px var(--mono);
  width:15px; height:15px; border-radius:3px; display:flex; align-items:center; justify-content:center}
.bt-tctl:hover{color:var(--ink)}
.bt-tctl.on{color:var(--go); background:var(--go-dim)}
.bt-track-content{position:relative; background:rgba(10,11,26,.5)}
.bt-track-row.hidden .bt-track-content{opacity:.2; pointer-events:none}
.bt-track-row.locked .bt-track-content{cursor:not-allowed}

.bt-beat{position:absolute; top:5px; bottom:5px; border-radius:5px; cursor:grab;
  display:flex; flex-direction:column; justify-content:center; padding:0 8px; overflow:hidden;
  border:1px solid rgba(0,0,0,.25)}
.bt-beat.selected{outline:2px solid var(--go); outline-offset:-2px}
.bt-beat.dragging{opacity:.45; cursor:grabbing}
.bt-beat .lbl{font:700 9.5px var(--sans); letter-spacing:.04em; color:#0a0a14; white-space:nowrap}
.bt-beat .dur{font:400 8.5px var(--mono); color:rgba(10,10,20,.6)}
.bt-handle{position:absolute; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:2}
.bt-handle.right{right:-2px}
.bt-handle:hover::after{content:''; position:absolute; top:22%; bottom:22%; left:3px;
  width:2px; background:rgba(255,255,255,.55); border-radius:2px}

.bt-word{position:absolute; top:4px; bottom:4px; border-radius:3px; background:var(--panel2);
  border:1px solid var(--line); display:flex; align-items:center; justify-content:center;
  font:400 9.5px var(--mono); color:var(--dim); padding:0 3px; white-space:nowrap; overflow:hidden}
.bt-word.active{background:var(--go-dim); border-color:var(--go); color:var(--go)}

.bt-playhead{position:absolute; top:0; bottom:0; width:1px; background:var(--go); z-index:7;
  pointer-events:none; box-shadow:0 0 6px rgba(251,191,36,.7)}
.bt-playhead-flag{position:absolute; top:0; left:-6px; width:13px; height:13px; background:var(--go);
  clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%); pointer-events:auto; cursor:ew-resize}
.bt-snap-guide{position:absolute; width:1px; background:var(--warn); z-index:8; pointer-events:none;
  box-shadow:0 0 5px rgba(255,179,71,.7)}
.bt-drop-marker{position:absolute; width:2px; background:var(--go); z-index:8; pointer-events:none}
.bt-inout{position:absolute; z-index:1; pointer-events:none; background:rgba(251,191,36,.06);
  border-left:1.5px solid var(--go); border-right:1.5px solid var(--go)}

.bt-pop{position:fixed; z-index:50; background:var(--panel2); border:1px solid var(--line);
  border-radius:var(--radius-sm); padding:10px; box-shadow:0 10px 30px rgba(0,0,0,.6); width:210px}
.bt-pop .t{font:600 9px var(--sans); letter-spacing:.1em; color:var(--dim); margin-bottom:7px}
.bt-role-grid{display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; max-height:130px; overflow:auto}
.bt-role-opt{all:unset; cursor:pointer; font:500 9px var(--sans); color:var(--dim);
  border:1px solid var(--line); border-radius:4px; padding:4px 7px}
.bt-role-opt:hover{color:var(--go); border-color:rgba(251,191,36,.5)}
.bt-role-opt.cur{color:var(--go); border-color:rgba(251,191,36,.5); background:var(--go-dim)}
.bt-pop input{width:100%; background:var(--bg2); border:1px solid var(--line); border-radius:6px;
  color:var(--ink); font:400 12px var(--mono); padding:7px 9px}
.bt-pop .row2{display:flex; gap:6px; margin-top:7px}
.bt-pop .row2 button{all:unset; flex:1; text-align:center; cursor:pointer; font:500 10px var(--sans);
  color:var(--dim); border:1px solid var(--line); border-radius:6px; padding:6px}
.bt-pop .row2 button.primary{background:var(--go); border-color:var(--go); color:#191100; font-weight:700}
```

**Acceptance (Task 3):** nenhuma mudança visual em nenhum outro step (todas
as classes têm prefixo `bt-` exceto `.step.wide` da Task 2, que só afeta
`#step-beats`). Abrir BEATS não deve gerar nenhum erro no console mesmo sem
JS ainda (Task 4) — os elementos referenciados por essas classes só existem
depois de montados pelo JS.

---

## Task 4 — `public/index.html`: módulo JS do timeline

Inserir logo antes do `</script>` final (linha 848), depois de todo o resto
do script existente. Um único IIFE, sem poluir o escopo global além do que já
existe.

**Contrato de dados que o módulo consome:**
- Duração real: `POST /api/probe` (rota já existente) com `{input: <path do
  #bt-visual>}` → usa `info.duration`.
- Waveform real: `fetch('/files/' + encodeURIComponent(path))` →
  `arrayBuffer()` → `AudioContext.decodeAudioData()` → downsample pra
  ~2px/coluna e desenha em `<canvas>` (nada de waveform sintética).
- Legenda real: o `.ass` mais recente fica em `lastAss` (variável global já
  existente, setada em `doAssemble`). Buscar via
  `fetch('/files/' + encodeURIComponent(lastAss)).then(r=>r.text())` e fazer
  parse manual — **não existe parser de ASS no projeto**, então:
  - Cada linha `Dialogue: 0,START,END,Word,,0,0,0,,TEXT` vira um evento.
  - `START`/`END` no formato `H:MM:SS.CS` → segundos:
    `h*3600 + m*60 + s + cs/100`.
  - `TEXT` contém a linha inteira com a palavra ativa marcada por tags ASS:
    `{\c&H...\}PALAVRA{\c&H...\}`. Extrair a palavra ativa com
    `/\{\\c[^}]*\}([^{]*)\{\\c[^}]*\}/`. Se não achar (linha sem realce),
    pular o evento — não deveria acontecer dado como `buildAss` monta o
    texto, mas é defensivo.
  - Se `lastAss` for `null` (usuário não rodou ASSEMBLE com legendas nesta
    sessão), a track LEGENDA fica vazia com uma nota — não é erro bloqueante.
- Beats: tenta `GET /api/beats?video=<path>` ao trocar o vídeo selecionado;
  se vier `{beats:null}`, inicializa com **um único beat** cobrindo
  `[0, duration]`, label `"CORTE"` — não inventa rótulos automáticos, é
  ponto de partida honesto pro usuário dividir manualmente.

**Estado do módulo** (mesma forma do protótipo, sem tracks de estilo):
```js
let BEATS = [{ label:'CORTE', dur: DURATION, color:'#fbbf24' }];
// start de cada beat = soma cumulativa das durações anteriores (mesma
// função beatStart(i) do protótipo)
```
Paleta de cores dos beats: usar tons derivados de `--go`/`--violet`/`--warn`/
`--bad` mais 4–5 variações HSL geradas em runtime (não precisa de paleta fixa
igual ao protótipo — qualquer conjunto de 8–10 cores distintas e legíveis
sobre texto escuro serve).

**Operações a portar do protótipo, adaptadas para este DOM/CSS:**
1. Ruler + tracks (BEATS, ÁUDIO, LEGENDA — **sem** B-ROLL/TRILHA, ver Escopo).
2. Playhead: clique pra seek, arrastar a bandeirinha, `video.currentTime`
   sincronizado nos dois sentidos (scrub na timeline move o `<video>`; dar
   play no `<video>` nativo também avança o playhead via `timeupdate`).
3. Transport: play/pause, J/K/L com aceleração 1×/2×/4×/8×, `,`/`.`
   frame-step (assumir 30fps), Home/End.
4. I/O: marcar entrada/saída, overlay verde-âmbar atravessando as tracks.
5. Beat: trim de borda com ripple (mesma lógica `doBeatTrim` do protótipo),
   split no playhead (`S`), merge com o próximo (`M`), rename via popover
   com grid de papéis + campo livre (`R` ou duplo-clique), reordenar
   arrastando o corpo do beat com marcador de destino.
6. Track: apenas **hide** e **lock** por track (sem mute/solo — só existe
   uma fonte de áudio real aqui, mute/solo não tem o que alternar).
7. Snap: contra bordas de beat, in/out e playhead, com guia visual laranja
   (`--warn`), reaproveitando a lógica `snapTargets()`/`snapTime()`.
8. Undo/redo: histórico de snapshots de `BEATS` (só isso — não há
   `styleState` nem `BROLL` nesta versão), `Ctrl+Z`/`Ctrl+Shift+Z`, escopado
   pra só agir quando `#step-beats` está com `.on` (`if
   (!document.getElementById('step-beats').classList.contains('on')) return;`
   no topo do handler de `keydown`, igual ao guard já usado nas outras
   telas — evita capturar teclas enquanto o usuário está em VOICE digitando
   o script no textarea, por exemplo).

**Persistência (novo, não existia no protótipo):**
- Botão "SALVAR BEATS" → `api('/api/beats', { video: path, duration:
  DURATION, beats: BEATS.map(b => ({label:b.label, start:beatStart(i),
  dur:b.dur})) })`, reaproveitando o helper `api()` já existente — chama a
  rota da Task 1.
- Botão "CARREGAR" (`#bt-load-btn`, já no HTML da Task 2) → `GET
  /api/beats?video=<path>`, substitui `BEATS` pelo resultado se existir.
- Ao trocar `#bt-visual`, tentar carregar automaticamente (mesma chamada),
  silenciosamente — se não houver sidecar salvo, segue com o beat único
  default.

**Acceptance (Task 4):**
- Selecionar um vídeo já montado em ASSEMBLE dentro de `#bt-visual` carrega
  duração real (`/api/probe`), desenha waveform real (não é ruído
  sintético — comparar visualmente com picos de fala reais do arquivo) e,
  se `lastAss` existir da sessão, popula a track LEGENDA com palavras reais.
- Dividir um beat no meio, renomear as duas metades, arrastar a borda entre
  elas, reordenar arrastando — tudo funciona sem recarregar a página.
- `Ctrl+Z` desfaz a última operação de beat; não interfere em nada fora do
  step BEATS (testar digitando num textarea em VOICE depois de usar BEATS —
  `Ctrl+Z` ali deve ser o undo nativo do textarea, não o do timeline).
- "SALVAR BEATS" grava o `.beats.json`; recarregar a página, voltar pro
  mesmo vídeo, clicar "CARREGAR" traz os beats de volta idênticos.
- Nenhum erro no console em nenhum dos outros 6 steps/tools.

---

## Overall acceptance criteria

1. `node --check server.js` exit 0.
2. `git diff --stat` mostra só `server.js` e `public/index.html` alterados —
   nenhum arquivo em `lib/`, `remotion/`, `clipper/` tocado.
3. Todos os outros 6 steps/tools (VISUALS, VOICE, ASSEMBLE, EXPORT,
   CLIPPER, DOWNLOAD, LIBRARY) continuam funcionando exatamente como antes —
   percorrer cada um manualmente uma vez é suficiente, não precisa de teste
   ponta-a-ponta completo de encode.
4. O rail mostra 01–05 em sequência sem número repetido ou faltando
   (VISUALS/VOICE/ASSEMBLE/BEATS/EXPORT), mais os 3 de TOOLS inalterados.
5. BEATS aparece entre ASSEMBLE e EXPORT na nav, no `STEP_ORDER`, e no footer
   prev/next dos steps vizinhos.
6. `POST`/`GET /api/beats` funcionam via curl conforme Task 1.
7. O timeline em BEATS mostra dado real (duração, waveform, legenda) para
   qualquer vídeo que já tenha passado por ASSEMBLE — nunca dado inventado.

## Status

_(propriedade do Executor)_

**Execução em 2026-08-12 — Tasks 1-4 aplicadas em `server.js` e
`public/index.html`. Servidor não foi reiniciado (instrução explícita) —
tudo abaixo marcado como "não exercitado" foi verificado apenas
estruturalmente/por sintaxe, não em navegador/servidor real.**

### Task 1 — `server.js` (rotas `/api/beats`)
- Bloco inserido literalmente entre o comentário `// Step 4 — voiceover` (âncora
  válida) — `beatsSidecar()` + `GET`/`POST /api/beats`, exatamente como no plano.
- Acceptance verificado:
  - `node --check server.js` → exit 0 (confirmado).
  - `grep -c "api/beats" server.js` → `2` (confirmado).
  - Teste `curl` manual (servidor rodando) **não exercitado** — instrução
    explícita de não reiniciar o servidor nesta sessão.

### Task 2 — esqueleto do step BEATS
- Nav: botão `BEATS` (`04`) inserido entre ASSEMBLE e EXPORT; EXPORT renumerado
  para `05` (nav + `<h2>` + comentário `<!-- 05 EXPORT -->`).
- Section `#step-beats` (classe `step wide`) inserida entre `</section>` do
  ASSEMBLE e o comentário do EXPORT, com `<select id="bt-visual">` e
  `<button id="bt-load-btn">CARREGAR</button>` conforme o plano.
- `.step.wide{max-width:none}` adicionado antes do `</style>`.
- `STEP_ORDER` alterado para
  `['visuals', 'voice', 'assemble', 'beats', 'export']` — só a entrada `'beats'`
  foi inserida, nenhuma outra entrada tocada.
- Linha `$('#bt-visual').innerHTML = vids.map(opt).join('');` adicionada logo
  após a linha equivalente de `#asm-visual` em `renderAssets()`.
- Acceptance verificado estruturalmente:
  - `grep -c 'data-step="beats"' public/index.html` → `1`.
  - `grep -c 'id="step-beats"' public/index.html` → `1`.
  - `grep -n 'data-step="export"'` confirma rótulo `05`.
  - Teste manual no navegador (clicar BEATS na nav, conferir footer prev/next,
    reconfirmar que ASSEMBLE segue funcionando) **não exercitado** — sem
    servidor/navegador nesta sessão.

### Task 3 — CSS do timeline
- Bloco de CSS colado literalmente (prefixo `bt-` em todas as classes novas)
  antes do `</style>`, logo depois da regra `.step.wide` da Task 2 — texto
  idêntico ao do plano, sem edição.
- Nenhuma classe fora do prefixo `bt-` foi criada; `.step.wide` é a única
  exceção documentada no próprio plano.
- Verificação visual em outros steps **não exercitada** (precisa de navegador).

### Task 4 — módulo JS do timeline
- IIFE única inserida imediatamente antes do `</script>` final (o único
  `</script>` do arquivo — confirmado via grep antes de editar).
- Implementado seguindo o contrato de dados do plano:
  - Duração real via `POST /api/probe` (`info.duration`).
  - Waveform real via `fetch` + `AudioContext.decodeAudioData` +
    downsample para ~2px/coluna, desenhada em `<canvas id="bt-wave">` —
    nenhum dado sintético.
  - Legenda real via parse manual de linhas `Dialogue:` do `.ass`
    (`lastAss`), conversão `H:MM:SS.CS`→segundos, e extração da palavra ativa
    com a regex exata do plano `/\{\\c[^}]*\}([^{]*)\{\\c[^}]*\}/`; se
    `lastAss` for `null`, a track LEGENDA mostra nota não-bloqueante.
  - Beats via `GET`/`POST /api/beats`; ao trocar `#bt-visual` tenta carregar
    o sidecar salvo e, se não houver, inicializa com beat único `"CORTE"`
    cobrindo `[0, DURATION]`.
  - Nomes exigidos pelo plano usados literalmente: `BEATS`, `beatStart(i)`,
    `doBeatTrim(i, newBoundary)`, `snapTargets()`, `snapTime(t)`, guard
    `if (!stepEl || !stepEl.classList.contains('on')) return;` no topo do
    handler de `keydown` (usa `document.getElementById('step-beats')`).
  - Reaproveitados sem duplicação: `$`, `$$`, `api()`, `addAsset()`
    (não precisou ser chamado aqui), `renderAssets()` (só a linha nova do
    `#bt-visual`), `watchJob()` (não aplicável — beats não usa job bus, é
    síncrono como o próprio server.js implementa), `goStep()`, `markDone()`
    (não chamado — BEATS não é um estágio "concluído" obrigatório do
    pipeline, é uma ferramenta de revisão opcional; o plano não pede
    explicitamente `markDone('beats')` em nenhum critério de aceite).
  - Operações implementadas: ruler+3 tracks (BEATS/ÁUDIO/LEGENDA), playhead
    (clique, arrastar bandeirinha, sync bidirecional com `<video>` via
    `timeupdate`), transport play/pause + J/K/L com aceleração 1/2/4/8×
    (J via timer manual decrementando `currentTime`, já que `playbackRate`
    negativo não é suportado de forma confiável entre browsers — desvio
    documentado abaixo), `,`/`.` frame-step assumindo 30fps, Home/End, I/O
    com overlay `.bt-inout`, trim de borda com ripple (`doBeatTrim`), split
    (`S`)/merge (`M`)/rename via popover (`R` ou duplo-clique) com grid de
    papéis + campo livre, reordenar por drag com `.bt-drop-marker`, hide/lock
    por track (sem mute/solo, conforme escopo), snap contra bordas/in-out
    com guia `--warn`, undo/redo de snapshots de `BEATS` (`Ctrl+Z`/
    `Ctrl+Shift+Z`) escopado ao guard do `keydown`.
  - Persistência: botão `SALVAR BEATS` (criado dinamicamente na toolbar,
    dentro de `#bt-root` — o plano não especificava onde ficaria o elemento
    estático desse botão na Task 2, só o `#bt-load-btn`; ver desvio/lacuna
    abaixo) chama `POST /api/beats`; `#bt-load-btn` (estático, da Task 2)
    chama `GET /api/beats`; troca de `#bt-visual` tenta autoload silencioso.

**Desvio/lacuna documentado (não inventado silenciosamente):**
1. O plano não especifica onde o botão "SALVAR BEATS" deveria existir no HTML
   estático da Task 2 (só `#bt-load-btn` foi definido lá). Implementei-o como
   parte da toolbar `.bt-transport` construída dinamicamente pelo JS da
   Task 4 (`id="bt-save"`), já que era o único ponto sem ambiguidade de
   layout. Se o Orquestrador queria esse botão fixo no HTML estático da
   Task 2 (ex: ao lado de `#bt-load-btn`), é um ajuste de poucas linhas.
2. Reverse shuttle (`J`) não usa `video.playbackRate` negativo (suporte
   inconsistente entre browsers para reverse playback nativo de `<video>`);
   implementado via `setInterval` que decrementa `currentTime` manualmente
   a ~30fps, com níveis de velocidade 1/2/4/8× espelhando a lógica de `L`.
   Funcional, mas não é reverse playback "nativo" — não teve como testar
   suavidade real sem navegador.
3. Cores dos beats: usei uma paleta de 10 cores fixas derivadas dos tokens
   do tema (`--go`, `--violet`, `--warn`, `--bad` mais variações) em vez de
   HSL gerado em runtime — o plano permitia qualquer conjunto de 8-10 cores
   distintas, então tratei isso como liberdade de implementação, não lacuna.

### Verificações rodadas (sem servidor/navegador)
- `node --check server.js` → exit 0.
- `git diff --stat` → só `server.js` (29 linhas) e `public/index.html`
  (788 linhas) alterados; nenhum arquivo em `lib/`, `remotion/`, `clipper/`
  tocado.
- `grep -c 'data-step="beats"' public/index.html` → `1`.
- `grep -c 'id="step-beats"' public/index.html` → `1`.
- `STEP_ORDER` contém `'beats'` entre `'assemble'` e `'export'` (confirmado
  por grep, linha 578).
- Extração do bloco `<script>...</script>` (único no arquivo, confirmado por
  `grep -c '<script>'`/`grep -c '</script>'` → 1/1) e execução via
  `new Function(source)` em `node -e` → nenhum `SyntaxError`.

### Não exercitado nesta sessão (requer servidor rodando + navegador)
- `curl` real em `GET`/`POST /api/beats` (Task 1, acceptance de teste manual).
- Abrir BEATS na UI de verdade: nav, footer prev/next, heading `04`/`05`.
- Waveform real desenhada a partir de áudio real (comparação visual com picos
  de fala) e legenda real populada a partir de `lastAss`.
- Drag de borda (ripple), split, merge, reordenar por drag, popover de rename,
  hide/lock de track, snap visual, J/K/L com aceleração, I/O overlay.
- Undo/redo (`Ctrl+Z`/`Ctrl+Shift+Z`) e confirmação de que não interfere no
  undo nativo de textarea em VOICE.
- Salvar/recarregar `.beats.json` ponta-a-ponta pela UI.
- Confirmação de que os outros 6 steps/tools continuam funcionando sem erro
  de console (Overall acceptance criteria item 3).

Nenhum arquivo fora de `server.js` e `public/index.html` foi tocado. Nenhum
commit foi feito.

### Verificação real em navegador (Orquestrador, pós-execução)

Reiniciei o servidor (necessário — a instância que já estava rodando era
anterior às rotas `/api/beats`, então respondia 404 "not found") e rodei o
fluxo completo pela UI real (Chrome via claude-in-chrome) com
`Highend_cinematic_commercial.mov` (vídeo de teste do usuário, 8s/720×1280/
hevc): upload → ASSEMBLE (Whisper base, 36 palavras legendadas) → BEATS.

**Bug real encontrado e corrigido:** `#bt-visual` só carregava o vídeo no
listener `change` do `<select>` — mas `renderAssets()` popula o dropdown via
`innerHTML`, o que nunca dispara `change`. Resultado: entrar em BEATS com um
vídeo já selecionado (o caso comum, logo depois de ASSEMBLE) não carregava
nada, ficava preso em "Escolha um vídeo acima." Corrigido envolvendo
`window.goStep` (linha ~1515 de `public/index.html`): ao entrar no step
`'beats'`, se `sel.value` for diferente de `currentPath`, chama `loadVideo()`
automaticamente. Sintaxe revalidada via `new Function()` depois do fix.

**Confirmado funcionando, com dado real (não sintético):**
- Duração real via `/api/probe` (8.0s, bate com `ffprobe`).
- Waveform real via Web Audio (picos visíveis, não ruído).
- Legenda real: parse do `.ass` extraiu texto coerente ("VEM A CONHECER AS
  PEÇAS DA MARCA DE JEANS MAIS...") a partir do Whisper de verdade.
- Split de beat (0.9s / 7.1s, soma exata 8.0s), rename via popover (grid de
  papel narrativo → HOOK), undo/redo revertendo e reaplicando o rename.
- `SALVAR BEATS` grava `output/<nome>.beats.json` de verdade; recarregar a
  página e voltar pro mesmo vídeo dispara autoload do sidecar (e o botão
  `CARREGAR` também funciona explicitamente) — beat "HOOK" veio de volta
  idêntico.
- Zero erros de console em BEATS e nos outros 5 steps/tools (VOICE, ASSEMBLE,
  EXPORT, CLIPPER, DOWNLOAD, LIBRARY) navegados em sequência.

**Não testado nesta verificação:** drag de borda (ripple), merge, reordenar
por drag, hide/lock de track, snap visual, J/K/L com aceleração, `,`/`.`
frame-step, I/O overlay. O core (split/rename/undo/redo/persistência) foi
validado; essas operações restantes usam os mesmos padrões de evento
(pointer down/move/up) já confirmados no drag do playhead e no split, mas
não foram exercitadas uma a uma.

Servidor deixado rodando em `localhost:4870` ao final (processo Node
reiniciado pelo Orquestrador durante esta verificação). Nenhum commit feito.
