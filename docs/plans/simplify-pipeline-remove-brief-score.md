# Plan — Simplificar pipeline: remover BRIEF e SCORE

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

## Goal

Reduzir a pipeline visível de 6 pra 4 steps — **VISUALS → VOICE → ASSEMBLE →
EXPORT** — pra quem abre o app pela primeira vez ter um caminho mais curto e
óbvio até um vídeo pronto. BRIEF e SCORE saem da navegação.

**Por que é seguro remover:**
- **BRIEF** só copia texto pro campo `#vo-script` do step VOICE e guarda um
  rascunho em `localStorage`. O VOICE já tem seu próprio textarea
  (`#vo-script`) que funciona sozinho — `genVoice()` lê direto dele, nunca
  de `#brief-script`. Remover BRIEF não quebra a geração de voz, só tira uma
  etapa de copiar-e-colar que o usuário pode fazer direto no campo do VOICE.
- **SCORE** roda `/api/score` e desenha a curva de atenção, mas **nada mais
  no app lê o resultado dele** — EXPORT não consulta score, ASSEMBLE não
  consulta score, não há nenhum gate (`markDone('score')` é só o
  checkmark visual na nav, não bloqueia nada). Remover é isolado por
  construção.

**Decisão de escopo — só front-end.** Este plano toca **apenas
`public/index.html`**. As rotas `POST /api/score`, `GET /api/tribe-info` e o
módulo `lib/score.js` **continuam existindo no backend**, intactos e
funcionais — só saem da UI. Isso é deliberado: mantém a capacidade
recuperável (dá pra reexpor depois, ou chamar via curl) sem tocar em nenhum
código de `lib/`, e mantém o diff pequeno e óbvio de revisar.

## Global constraints

- **Só `public/index.html`.** Não tocar `server.js` nem nada em `lib/`.
- Não restart do servidor, não `npm install`, não commit.
- Preservar tudo que VOICE, ASSEMBLE, EXPORT, CLIPPER, DOWNLOAD, LIBRARY já
  fazem — nenhuma linha de `doAssemble`, `doExport`, `doClip`, `genVoice`,
  `renderRemotion`, `upload`, `wireDrop` é tocada.
- **Ordem de execução recomendada:** rode este plano **antes** do
  `docs/plans/beat-timeline-editor.md`. Ele insere um step novo (BEATS)
  logo depois de ASSEMBLE e foi escrito assumindo a numeração já reduzida
  (01 VISUALS / 02 VOICE / 03 ASSEMBLE / 04 BEATS / 05 EXPORT) — rodar na
  ordem inversa vai fazer os âncoras de linha dele não baterem.

## Files

- **Modify:** `public/index.html` (nav, 2 sections removidas, `STEP_ORDER`,
  4 blocos de JS removidos, 1 linha em `renderAssets()`)

---

## Task 1 — nav: remover botões, renumerar, mover o step ativo padrão

Bloco atual (linhas 254–259):
```html
  <button data-step="brief" class="on" aria-current="step"><span class="n" aria-hidden="true">01</span>BRIEF</button>
  <button data-step="visuals"><span class="n" aria-hidden="true">02</span>VISUALS</button>
  <button data-step="voice"><span class="n" aria-hidden="true">03</span>VOICE</button>
  <button data-step="assemble"><span class="n" aria-hidden="true">04</span>ASSEMBLE</button>
  <button data-step="score"><span class="n" aria-hidden="true">05</span>SCORE</button>
  <button data-step="export"><span class="n" aria-hidden="true">06</span>EXPORT</button>
```
Substituir por:
```html
  <button data-step="visuals" class="on" aria-current="step"><span class="n" aria-hidden="true">01</span>VISUALS</button>
  <button data-step="voice"><span class="n" aria-hidden="true">02</span>VOICE</button>
  <button data-step="assemble"><span class="n" aria-hidden="true">03</span>ASSEMBLE</button>
  <button data-step="export"><span class="n" aria-hidden="true">04</span>EXPORT</button>
```
(Note o `class="on" aria-current="step"` que migrou do botão BRIEF pro
VISUALS — é o que faz VISUALS ser o step aberto quando o app carrega.)

**Acceptance:** grep `data-step="brief"` e `data-step="score"` no arquivo →
zero ocorrências em `<nav>` (ainda vai sobrar `id="step-brief"`/`id="step-score"`
até a Task 2 remover as sections — normal nesse ponto intermediário).

---

## Task 2 — remover as duas sections, renumerar os headings

**2a.** Remover a section inteira do BRIEF (comentário `<!-- 01 BRIEF -->`
até o `</section>` correspondente, linhas 275–289):
```html
  <!-- 01 BRIEF -->
  <section class="step on" id="step-brief">
    <h2>01 / <em>BRIEF</em></h2>
    <p class="sub">Decide the one idea the video sells and who it's for. The clearer the line, the cleaner everything downstream. The script written here feeds the VOICE step.</p>
    <div class="card">
      <label for="brief-idea">ONE-LINE IDEA</label>
      <input type="text" id="brief-idea" placeholder="e.g. Uptime is not success — measure outcomes.">
      <label for="brief-aud">AUDIENCE</label>
      <input type="text" id="brief-aud" placeholder="e.g. AI & tech creators shipping reels weekly">
      <label for="brief-script">SCRIPT (3–6 LINES)</label>
      <textarea id="brief-script" placeholder="Line 1: the hook.&#10;Line 2–4: the payoff.&#10;Last line: the CTA."></textarea>
      <button class="btn ghost" onclick="saveBrief()">SAVE BRIEF → FEEDS STEP 03</button>
    </div>
  </section>

```
Delete o bloco inteiro (do comentário até a linha em branco depois do
`</section>`).

**2b.** A section de VISUALS que sobra logo em seguida ganha `on` e vira
`<h2>01 / ...`. Trocar:
```html
  <!-- 02 VISUALS -->
  <section class="step" id="step-visuals">
    <h2>02 / <em>VISUALS</em></h2>
```
por:
```html
  <!-- 01 VISUALS -->
  <section class="step on" id="step-visuals">
    <h2>01 / <em>VISUALS</em></h2>
```

**2c.** Renumerar os headings de VOICE e ASSEMBLE (só o texto do `<h2>` e o
comentário HTML — o resto de cada section não muda):
```html
  <!-- 03 VOICE -->
  ...
    <h2>03 / <em>VOICE</em></h2>
```
→
```html
  <!-- 02 VOICE -->
  ...
    <h2>02 / <em>VOICE</em></h2>
```
e
```html
  <!-- 04 ASSEMBLE -->
  ...
    <h2>04 / <em>ASSEMBLE</em></h2>
```
→
```html
  <!-- 03 ASSEMBLE -->
  ...
    <h2>03 / <em>ASSEMBLE</em></h2>
```

**2d.** Remover a section inteira do SCORE (comentário `<!-- 05 SCORE -->`
até o `</section>` correspondente):
```html
  <!-- 05 SCORE -->
  <section class="step" id="step-score">
    <h2>05 / <em>SCORE</em></h2>
    <p class="sub">The improvement loop: render → score → fix the flagged seconds → re-score, until the curve holds. Built-in curve is a local attention <b>proxy</b> (audio energy + cut density + speech density). For brain-response scoring, install TRIBE v2 yourself — non-commercial license, never bundled.</p>
    <div class="card">
      <label for="score-input">VIDEO TO SCORE</label>
      <select id="score-input"></select>
      <button class="btn" onclick="doScore()">RUN ATTENTION CURVE</button>
      <canvas id="curve" width="760" height="180"></canvas>
      <div id="score-out"></div>
    </div>
    <div class="card">
      <h3>TRIBE V2 — BRAIN MODEL (SELF-INSTALL)</h3>
      <div id="tribe-info" class="sub" style="font-size:11.5px"></div>
    </div>
  </section>

```
Delete o bloco inteiro.

**2e.** Renumerar EXPORT — trocar:
```html
  <!-- 06 EXPORT -->
  <section class="step" id="step-export">
    <h2>06 / <em>EXPORT</em></h2>
```
por:
```html
  <!-- 04 EXPORT -->
  <section class="step" id="step-export">
    <h2>04 / <em>EXPORT</em></h2>
```

**Acceptance (Task 2):** `grep -c 'id="step-brief"\|id="step-score"'
public/index.html` → 0. `grep -c 'id="step-visuals"'` → 1, e essa section
tem `class="step on"`.

---

## Task 3 — `STEP_ORDER`

Linha ~497, trocar:
```js
const STEP_ORDER = ['brief', 'visuals', 'voice', 'assemble', 'score', 'export'];
```
por:
```js
const STEP_ORDER = ['visuals', 'voice', 'assemble', 'export'];
```
O footer prev/next de cada step se regenera sozinho a partir desse array —
nenhuma outra mudança necessária.

**Acceptance:** abrir o app, VISUALS aparece ativo e sem botão "← anterior"
no footer (é o primeiro da lista agora); EXPORT não tem botão "próximo".

---

## Task 4 — limpar JS morto (saveBrief, doScore, drawCurve, TRIBE fetch)

**4a.** Remover `window.saveBrief` inteiro e o bloco de restauração do
`localStorage` logo abaixo (atualmente):
```js
window.saveBrief = () => {
  const s = $('#brief-script').value.trim();
  if (s) $('#vo-script').value = s;
  localStorage.setItem('studio-brief', JSON.stringify({
    idea: $('#brief-idea').value, aud: $('#brief-aud').value, script: s }));
  stage('brief saved → script loaded in step 03');
  markDone('brief');
};
try { const b = JSON.parse(localStorage.getItem('studio-brief') || 'null');
  if (b) { $('#brief-idea').value = b.idea||''; $('#brief-aud').value = b.aud||'';
    $('#brief-script').value = b.script||''; $('#vo-script').value = b.script||''; } } catch {}
```
Delete os dois. `#vo-script` continua um textarea comum, vazio até o
usuário digitar — comportamento correto sem BRIEF.

**4b.** Remover a IIFE que busca `/api/tribe-info` (populava `#tribe-info`,
que não existe mais depois da Task 2d):
```js
(async () => {
  const t = await (await fetch('/api/tribe-info')).json();
  $('#tribe-info').innerHTML = `<b>${t.name}</b><br>${t.license}<br><br>` +
    t.install.map((s,i)=>`${i+1}. ${s}`).join('<br>');
})();
```
Delete o bloco inteiro.

**4c.** Remover `window.doScore` e `drawCurve`:
```js
window.doScore = async () => {
  try {
    const { job } = await api('/api/score', { input: $('#score-input').value });
    const r = await watchJob(job);
    drawCurve(r);
    markDone('score');
    $('#score-out').innerHTML =
      `<span class="chip ${r.kind === 'tribe' ? 'ok' : 'wn'}">${r.kind === 'tribe' ? 'TRIBE v2 brain model' : 'local proxy'}</span>` +
      (r.score != null ? ` <span class="chip ${r.score >= 60 ? 'ok' : 'wn'}">retention ${r.score}/100</span>` : '') +
      (r.hook ? ` <span class="chip ${r.hook.weak ? 'wn' : 'ok'}" title="${r.hook.advice}">${r.hook.weak ? 'hook fraco' : 'hook forte'}</span>` : '') +
      (r.dips && r.dips.length
        ? `<table><tr><th>DIP</th><th>SECONDS</th><th>FIX</th></tr>` +
          r.dips.map(d => `<tr><td class="bad-x">▼</td><td>${d.start}s–${d.end}s</td><td>${d.advice||'tighten / rewrite / add motion'}</td></tr>`).join('') + '</table>'
        : '<p class="sub" style="margin-top:10px">no dips below threshold — the curve holds.</p>') +
      (r.note ? `<p class="sub" style="margin-top:8px;font-size:11px">${r.note}</p>` : '');
  } catch (e) { stage(e.message, true); }
};
function drawCurve(r) {
  const cv = $('#curve'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(139,140,248,.12)';
  for (let y = 0.25; y < 1; y += 0.25) { ctx.beginPath(); ctx.moveTo(0, H*y); ctx.lineTo(W, H*y); ctx.stroke(); }
  const pts = r.curve || []; if (!pts.length) return;
  const x = t => (t / Math.max(r.duration, 1)) * W;
  const y = v => H - v * (H - 20) - 10;
  ctx.fillStyle = 'rgba(251,113,133,.10)';
  for (const d of r.dips || []) ctx.fillRect(x(d.start), 0, Math.max(x(d.end + 1) - x(d.start), 2), H);
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v)));
  ctx.lineTo(x(pts[pts.length-1].t), H); ctx.lineTo(x(pts[0].t), H); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(251,191,36,.22)'); grad.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(251,191,36,.55)'; ctx.shadowBlur = 8;
  pts.forEach((p, i) => i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v)));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(154,163,199,.4)';
  ctx.beginPath(); ctx.moveTo(0, y(r.mean)); ctx.lineTo(W, y(r.mean)); ctx.stroke();
  ctx.setLineDash([]);
}
```
Delete as duas funções inteiras.

**4d.** Em `renderAssets()`, remover a linha que populava o select do SCORE
(hoje por volta da linha 542):
```js
  $('#score-input').innerHTML = vids.map(opt).join('');
```
Delete só essa linha — as outras 4 linhas de `renderAssets()` que populam
`#asm-visual`, `#asm-vo`, `#exp-input`, `#clip-file` ficam intactas.

**Acceptance (Task 4):**
- `grep -c "doScore\|drawCurve\|saveBrief\|tribe-info\|score-input\|studio-brief" public/index.html` → 0.
- Abrir o console do navegador em cada um dos 4 steps restantes — zero
  erros de `ReferenceError`/`querySelector null`.

---

## Overall acceptance criteria

1. Rail mostra exatamente 4 steps de pipeline (VISUALS, VOICE, ASSEMBLE,
   EXPORT) numerados 01–04, mais os 3 de TOOLS (AUTO-CLIPPER, DOWNLOAD,
   LIBRARY) inalterados.
2. Abrir `http://localhost:4870` carrega direto em VISUALS.
3. Fluxo completo continua funcionando: subir vídeo em VISUALS → digitar
   script direto em VOICE → gerar narração → ASSEMBLE → EXPORT.
4. `grep -rn "brief\|score" public/index.html -i` só retorna, no máximo,
   ocorrências inofensivas dentro de nomes não relacionados (ex.: nenhuma
   esperada, mas confira — não deve sobrar `id`, `data-step`, `window.`,
   `#` ou `onclick` apontando pra algo removido).
5. `server.js`, `lib/score.js` e todo o resto do backend continuam
   byte-a-byte iguais — `git diff --stat` mostra só `public/index.html`.

## Status

_(propriedade do Executor)_

**Executado em 2026-08-12.** Tasks 1–4 aplicadas em `public/index.html`,
literalmente conforme especificado no plano. Nenhum outro arquivo tocado,
servidor não reiniciado, nenhum `npm install`, nenhum commit criado.

- **Task 1 (nav):** bloco de 6 botões substituído pelos 4 (VISUALS 01 /
  VOICE 02 / ASSEMBLE 03 / EXPORT 04), `class="on" aria-current="step"`
  migrado para o botão VISUALS.
- **Task 2 (sections):** section BRIEF (`id="step-brief"`) removida por
  inteiro; section SCORE (`id="step-score"`) removida por inteiro; VISUALS
  ganhou `class="step on"` e `<h2>01 / …`; VOICE renumerado pra `02`;
  ASSEMBLE renumerado pra `03`; EXPORT renumerado pra `04` (comentário HTML
  e `<h2>` de cada um).
- **Task 3 (STEP_ORDER):** `const STEP_ORDER = ['visuals', 'voice',
  'assemble', 'export'];` (linha 463 no arquivo final).
- **Task 4 (JS morto):**
  - 4a: `window.saveBrief` + bloco de restauração de `studio-brief` do
    `localStorage` removidos. O comentário `/* ---------------- brief */`
    (que não estava no old_string do plano) foi deixado no lugar — ficou um
    comentário de seção vazio antes de `/* ---------------- remotion */`.
    É inofensivo (não é `id`/`data-step`/`window.`/`#`/`onclick`), mas
    reporto como observação caso o Orquestrador prefira removê-lo num
    passo de limpeza cosmética futuro.
  - 4b: IIFE de `/api/tribe-info` (populava `#tribe-info`) removida por
    inteiro.
  - 4c: `window.doScore` e `function drawCurve` removidos por inteiro,
    junto com o comentário `/* ---------------- score */` que os precedia
    (esse sim foi removido, diferente do caso 4a, porque delimitava um
    bloco JS inteiro que sumiu, não deixando nada órfão). O corpo real de
    `drawCurve` no arquivo tinha 3 comentários inline extras (`// dip
    zones`, `// area under curve`, `// mean`) que não apareciam no trecho
    citado no plano — função e assinatura batiam integralmente, então
    tratei como o mesmo bloco e removi por completo.
  - 4d: linha `$('#score-input').innerHTML = vids.map(opt).join('');`
    removida de `renderAssets()`; as outras 4 linhas do bloco
    (`#asm-visual`, `#asm-vo`, `#exp-input`, `#clip-file`) ficaram
    intactas.

**Verificação (greps de aceite, todos passaram):**
- `grep -n 'data-step="brief"\|data-step="score"' public/index.html` → 0
  ocorrências.
- `grep -n 'id="step-brief"\|id="step-score"' public/index.html` → 0
  ocorrências.
- `grep -n 'id="step-visuals"' public/index.html` → 1 ocorrência (linha
  274), com `class="step on"`.
- `grep -c "doScore\|drawCurve\|saveBrief\|tribe-info\|score-input\|studio-brief" public/index.html`
  → `0`.
- `git diff --stat` → só `public/index.html` (128 linhas tocadas: 14
  inserções, 114 remoções).
- Sanity extra (não pedido no plano, mas rodado por precaução): extraí o
  único bloco `<script>` do HTML final e rodei `new Function(source)` via
  `node -e` — parseou sem `SyntaxError`.

**Desvio/observação para o Orquestrador (não corrigido, fora do escopo
literal do plano):** a section LIBRARY (linha 431) ainda tem o texto
`"Assets flow between steps — send any of them to Assemble, Score, or
Export."` — menciona "Score" em prosa, não em `id`/`data-step`/`onclick`,
então passa nos greps de aceite do plano, mas é uma referência de copy
agora desatualizada já que o step SCORE não existe mais na UI. O plano não
listou esse arquivo/linha entre os blocos a mudar, então não toquei —
sinalizando para decisão do Orquestrador (correção cosmética trivial, ou
inclusão em plano futuro).

Nenhum bloqueio. Todas as acceptance criteria das Tasks 1–4 e os critérios
gerais ("Overall acceptance criteria") 1, 2 (visual, não testado via
browser real nesta sessão — sem restart do servidor) e 5 foram verificados
por grep/diff conforme listado acima. Critérios 2 e 3 (abrir o app no
navegador e rodar o fluxo fim-a-fim) não foram exercitados manualmente
porque a instrução explícita da tarefa foi não reiniciar o servidor — a
verificação estrutural (nav com VISUALS `on`, `STEP_ORDER` começando em
`visuals`, ausência de refs quebradas) foi feita por inspeção de código.
