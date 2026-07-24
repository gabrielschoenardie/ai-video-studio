# Score Proxy Improvements — Implementation Plan

> **For agentic workers:** implemente task-por-task, em ordem. Steps usam checkbox (`- [ ]`). Este projeto **não tem suíte de testes** (backend Node puro, zero-dep, sem runner) — a verificação de cada task é feita por script `node` runnable e/ou `POST /api/score`, mais inspeção. Não há `pytest`/`jest`.

**Goal:** Elevar a fidelidade do proxy de curva de atenção do Score (Step 05) adicionando movimento contínuo, penalidade de dead-air, normalização robusta por percentil e saídas de termômetro (`score` 0–100 + veredito de `hook`), sem novas dependências.

**Architecture:** Todas as mudanças de lógica ficam em `lib/score.js` (helpers + `proxyCurve`), mantendo a assinatura pública `{ score, proxyCurve, TRIBE_INFO }` e o contrato do job bus. A UI (`public/index.html`, função `doScore`) ganha dois chips para exibir os campos novos. Um único passo ffmpeg novo (movimento), paralelizado com os passos existentes.

**Tech Stack:** Node ≥18 CommonJS; `ffmpeg`/`ffprobe` via `child_process` (`execFile`); canvas 2D + DOM vanilla no front. Zero npm no backend.

**Spec de origem:** `docs/superpowers/specs/2026-07-24-score-proxy-improvements-design.md`

## Global Constraints

- **Zero dependência npm** no backend — só `ffmpeg`/`ffprobe` + transcript já disponível. Copiado do spec.
- **Assinatura pública intacta:** `module.exports = { score, proxyCurve, TRIBE_INFO }`.
- **Campos de saída existentes inalterados** (`kind`, `note`, `duration`, `curve`, `mean`, `dips`); `score` e `hook` são **aditivos**.
- **Degradação suave:** todo passo ffmpeg usa `.catch(() => '')` e retorna array preenchido (padrão dos helpers existentes).
- **Git:** o Executor **NÃO commita**. Ao terminar todas as tasks, deixa as mudanças no working tree para o ciclo `git-workflow` (inspecionar → commit → push) com aprovação do usuário, conforme CLAUDE.md. Nenhuma task deste plano roda `git commit`.
- **Reinício necessário:** mudanças em `lib/*.js` exigem reiniciar `node server.js` (sem hot-reload) antes de qualquer verificação via `/api/score`.
- **Constantes nomeadas** no topo do módulo para parâmetros ajustáveis: `DEADAIR_ENERGY=0.2`, `DEADAIR_FACTOR=0.5`, `HOOK_SECONDS=3`.

---

### Task 1: Normalização robusta por percentil (`percentile` + `normalize`)

**Files:**
- Modify: `lib/score.js:59-62` (substitui a função `normalize`; adiciona `percentile` logo acima dela)

**Interfaces:**
- Produces: `percentile(sorted: number[], p: number) -> number` (p em [0,100], `sorted` ascendente) e `normalize(arr: number[]) -> number[]` (valores em [0,1]). Assinatura de `normalize` inalterada — call-sites não mudam.

- [ ] **Step 1: Substituir a função `normalize` (linhas 59-62) pelo par abaixo**

```js
// p in [0,100]; sorted ascending. Linear interpolation between ranks.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Robust normalize: clamp to the 5th–95th percentile band, then scale to [0,1].
// A single spike no longer flattens the rest of the curve. Flat input -> 0.5.
function normalize(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const lo = percentile(sorted, 5), hi = percentile(sorted, 95);
  if (hi - lo < 1e-6) return arr.map(() => 0.5);
  return arr.map(v => Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}
```

- [ ] **Step 2: Verificar sintaxe e robustez a outlier**

Primeiro, o módulo carrega sem erro:
```bash
node -e "require('./lib/score.js'); console.log('loads ok')"
```
Expected: imprime `loads ok`.

Como `percentile`/`normalize` não são exportadas, crie `$CLAUDE_JOB_DIR/tmp/normcheck.js` colando as duas funções (verbatim do Step 1) seguidas de:
```js
const flat=[5,5,5,5];
const spike=[1,1,1,1,1,1,1,1,1,100];
console.log('flat', normalize(flat));                 // esperado: [0.5,0.5,0.5,0.5]
const n=normalize(spike);
console.log('spike[0..8]', n.map(x=>+x.toFixed(2)).slice(0,9));
console.log('spike max', Math.max(...n));
console.log('anyNaN', n.some(Number.isNaN));          // esperado: false
```
Run: `node "$CLAUDE_JOB_DIR/tmp/normcheck.js"`
Expected: `flat` → `[0.5,0.5,0.5,0.5]`; em `spike`, o valor `100` (acima do p95) é clampado a `1` e os nove primeiros **não** colapsam todos para `0` como fariam com min/max cru; `anyNaN` → `false`.

- [ ] **Step 3: Registrar no `## Status`** que a Task 1 foi concluída (arquivo, verificação, resultado).

---

### Task 2: Sinal de movimento contínuo (`motionMagnitude`) + blend + dead-air

**Files:**
- Modify: `lib/score.js` — adicionar constantes no topo do módulo; adicionar helper `motionMagnitude` (após `visualChange`, ~linha 57); alterar o corpo de `proxyCurve` (linhas ~64-89) para incluir motion no `Promise.all`, recompor o blend e aplicar a penalidade dead-air.

**Interfaces:**
- Consumes: `normalize` (Task 1).
- Produces: `motionMagnitude(file: string, duration: number) -> Promise<number[]>` (um valor de magnitude de movimento por segundo, `ceil(duration)` posições, zeros onde não houver amostra). `proxyCurve` passa a produzir `curve` a partir do blend de 4 sinais com penalidade dead-air aplicada antes do smoothing.

- [ ] **Step 1: Adicionar constantes nomeadas no topo do módulo** (logo após os `require`, antes de `runCapture`)

```js
const DEADAIR_ENERGY = 0.2;   // normalized-energy threshold below which a silent second counts as dead air
const DEADAIR_FACTOR = 0.5;   // multiplier applied to dead-air seconds
const HOOK_SECONDS = 3;       // opening window that carries extra weight (used in Task 3)
```

- [ ] **Step 2: Adicionar o helper `motionMagnitude`** (logo após `visualChange`, antes de `normalize`)

```js
// continuous motion magnitude per second: diff between consecutive frames
// (downscaled 64x64 for speed/robustness), averaged per second via signalstats YAVG.
async function motionMagnitude(file, duration) {
  const out = await runCapture('ffmpeg', ['-hide_banner', '-i', file,
    '-vf', 'scale=64:64,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-']).catch(() => '');
  const sum = new Array(Math.ceil(duration)).fill(0);
  const cnt = new Array(Math.ceil(duration)).fill(0);
  let t = 0;
  for (const line of out.split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = parseFloat(pts[1]);
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (y) {
      const sec = Math.min(Math.floor(t), sum.length - 1);
      sum[sec] += parseFloat(y[1]);
      cnt[sec]++;
    }
  }
  return sum.map((s, i) => cnt[i] ? s / cnt[i] : 0);
}
```

- [ ] **Step 3: Alterar o início de `proxyCurve`** para incluir motion no `Promise.all`

Localize (linhas ~67-70):
```js
  const [energy, cuts] = await Promise.all([
    audioEnergy(file, info.duration),
    visualChange(file, info.duration),
  ]);
```
Substitua por:
```js
  const [energy, cuts, motion] = await Promise.all([
    audioEnergy(file, info.duration),
    visualChange(file, info.duration),
    motionMagnitude(file, info.duration),
  ]);
```

- [ ] **Step 4: Recompor o blend + aplicar dead-air**

Localize o bloco (linhas ~80-83):
```js
  const nE = normalize(energy), nC = normalize(cuts.map(c => Math.min(c, 3))), nS = normalize(speech);
  const hasSpeech = speech.some(v => v > 0);
  const curve = nE.map((e, i) =>
    hasSpeech ? 0.45 * e + 0.30 * nC[i] + 0.25 * nS[i] : 0.6 * e + 0.4 * nC[i]);
```
Substitua por:
```js
  const nE = normalize(energy);
  const nC = normalize(cuts.map(c => Math.min(c, 3)));
  const nM = normalize(motion);
  const nS = normalize(speech);
  const hasSpeech = speech.some(v => v > 0);
  const visual = nC.map((c, i) => 0.5 * c + 0.5 * nM[i]);
  const curve = nE.map((e, i) => {
    const base = hasSpeech
      ? 0.40 * e + 0.35 * visual[i] + 0.25 * nS[i]
      : 0.55 * e + 0.45 * visual[i];
    const deadAir = speech[i] === 0 && e < DEADAIR_ENERGY;
    return deadAir ? base * DEADAIR_FACTOR : base;
  });
```

- [ ] **Step 5: Verificar chamando `proxyCurve` diretamente (sem server/API)**

Escolha um vídeo real existente com áudio — ex. `output_clips-d7b650e0239d_clip-01.mp4` na raiz (se não existir, use qualquer `output/*.mp4`). Crie `$CLAUDE_JOB_DIR/tmp/pc_check.js`:
```js
const { proxyCurve } = require('./lib/score.js');
proxyCurve('output_clips-d7b650e0239d_clip-01.mp4', {}).then(r => {
  const vs = r.curve.map(p => p.v);
  console.log('len', r.curve.length);
  console.log('min', Math.min(...vs), 'max', Math.max(...vs));
  console.log('anyNaN', vs.some(Number.isNaN));
  console.log('inRange', vs.every(v => v >= 0 && v <= 1));
}).catch(e => { console.error('FAIL', e.message); process.exit(1); });
```
Run: `node "$CLAUDE_JOB_DIR/tmp/pc_check.js"`
Expected: `len` = `ceil(duration)` do clipe; `inRange` → `true`; `anyNaN` → `false`; sem `FAIL`. (Sem `transcript`, `speech` é tudo zero e o blend usa o ramo sem-fala — o objetivo aqui é só confirmar que motion+normalização+dead-air produzem curva válida.)

- [ ] **Step 6: Registrar no `## Status`** (helper adicionado, blend recomposto, resultado da verificação).

---

### Task 3: Saídas de termômetro (`score` 0–100 + `hook`)

**Files:**
- Modify: `lib/score.js` — no fim de `proxyCurve`, computar `score` e `hook` a partir de `smooth`/`mean` e adicioná-los ao objeto de retorno (bloco `return {...}`, linhas ~100-108).

**Interfaces:**
- Consumes: `smooth` (array da curva suavizada), `mean` (número), `HOOK_SECONDS` (Task 2).
- Produces: no retorno de `proxyCurve`, campos `score: number` (inteiro 0–100) e `hook: { value: number, weak: boolean, advice: string }`.

- [ ] **Step 1: Computar `score` e `hook`** — inserir logo após o cálculo de `dips` e antes do `return {`

```js
  // thermometer summary: weighted mean of the smoothed curve, opening 3s counts 2x
  let sw = 0, ww = 0;
  for (let i = 0; i < smooth.length; i++) {
    const w = i < HOOK_SECONDS ? 2 : 1;
    sw += smooth[i] * w; ww += w;
  }
  const score = Math.round(100 * (ww ? sw / ww : 0));

  const hookWin = smooth.slice(0, Math.min(HOOK_SECONDS, smooth.length));
  const hookVal = hookWin.length ? hookWin.reduce((a, b) => a + b, 0) / hookWin.length : 0;
  const weak = hookVal < 0.5 || hookVal < mean * 0.9;
  const hook = {
    value: +hookVal.toFixed(3),
    weak,
    advice: weak
      ? 'hook fraco — reforce os primeiros 3s (corte mais forte, primeira fala mais direta, movimento)'
      : 'hook forte — a abertura segura a atenção',
  };
```

- [ ] **Step 2: Adicionar `score` e `hook` ao objeto de retorno** — no `return { ... }` de `proxyCurve`, após `mean:` e antes de `dips:`

```js
    score,
    hook,
```
(Resultado: o objeto passa a ter `kind, note, duration, curve, mean, score, hook, dips`.)

- [ ] **Step 3: Verificar os campos novos chamando `proxyCurve` diretamente**

Crie `$CLAUDE_JOB_DIR/tmp/pc_check2.js`:
```js
const { proxyCurve } = require('./lib/score.js');
proxyCurve('output_clips-d7b650e0239d_clip-01.mp4', {}).then(r => {
  console.log('score', r.score, Number.isInteger(r.score) && r.score>=0 && r.score<=100);
  console.log('hook', JSON.stringify(r.hook));
  console.log('hook.weak isBool', typeof r.hook.weak === 'boolean');
  console.log('has dips', Array.isArray(r.dips));
  console.log('kind', r.kind);
}).catch(e => { console.error('FAIL', e.message); process.exit(1); });
```
Run: `node "$CLAUDE_JOB_DIR/tmp/pc_check2.js"`
Expected: `score` inteiro em `[0,100]` (segundo booleano `true`); `hook.value` numérico em `[0,1]`; `hook.weak isBool` → `true`; `hook.advice` string não-vazia; `has dips` → `true`; `kind` → `proxy`.

- [ ] **Step 4: Registrar no `## Status`**.

---

### Task 4: UI — chips de retention e hook no `doScore`

**Files:**
- Modify: `public/index.html` — função `doScore` (linhas ~653-659), montagem do `#score-out`.

**Interfaces:**
- Consumes: `r.score` (inteiro), `r.hook` (`{value,weak,advice}`) do resultado do `/api/score`.
- Produces: dois `<span class="chip">` renderizados acima da tabela de dips. Guardas para não quebrar quando `kind==='tribe'` (sem esses campos).

- [ ] **Step 1: Inserir os chips** — no `$('#score-out').innerHTML =`, logo após o chip de `kind` e antes do bloco de dips (`(r.dips && r.dips.length ? ...)`)

Localize:
```js
    $('#score-out').innerHTML =
      `<span class="chip ${r.kind === 'tribe' ? 'ok' : 'wn'}">${r.kind === 'tribe' ? 'TRIBE v2 brain model' : 'local proxy'}</span>` +
      (r.dips && r.dips.length
```
Substitua por:
```js
    $('#score-out').innerHTML =
      `<span class="chip ${r.kind === 'tribe' ? 'ok' : 'wn'}">${r.kind === 'tribe' ? 'TRIBE v2 brain model' : 'local proxy'}</span>` +
      (r.score != null ? ` <span class="chip ${r.score >= 60 ? 'ok' : 'wn'}">retention ${r.score}/100</span>` : '') +
      (r.hook ? ` <span class="chip ${r.hook.weak ? 'bad' : 'ok'}" title="${r.hook.advice}">${r.hook.weak ? 'hook fraco' : 'hook forte'}</span>` : '') +
      (r.dips && r.dips.length
```

- [ ] **Step 2: Confirmar que a classe de chip `bad` existe no CSS** (senão usar `wn`)

Run: `grep -nE "\.chip\.(bad|wn|ok)" public/index.html`
Expected: se `.chip.bad` existir, mantenha `bad`; se **não** existir, troque `bad` por `wn` no Step 1 (chip de aviso). Registre qual foi usada.

- [ ] **Step 3: Verificação por inspeção (o Executor não tem navegador)**

Run: `grep -nE "retention \\$\\{r\\.score\\}|hook (fraco|forte)|r\\.hook\\.weak" public/index.html`
Expected: as três substrings inseridas aparecem dentro de `doScore`; confirme por leitura que os guardas `r.score != null` e `r.hook` envolvem os chips. A verificação visual ao vivo no Chrome é feita pelo Orquestrador após a validação (ver Verificação final).

- [ ] **Step 4: Registrar no `## Status`** (linhas alteradas, classe de chip usada).

---

## Verificação final (integração)

**Executor (node + grep):**
- [ ] `node -e "require('./lib/score.js')"` carrega sem erro.
- [ ] `module.exports` de `lib/score.js` continua `{ score, proxyCurve, TRIBE_INFO }` (grep).
- [ ] `proxyCurve(<clip>, {})` direto retorna objeto com `curve` (v∈[0,1]), `score` (int 0–100), `hook.{value,weak,advice}`, `dips` no formato atual, `kind:'proxy'`.
- [ ] Working tree contém apenas `lib/score.js` e `public/index.html` modificados (mais os docs de spec/plano).

**Orquestrador (pós-validação — precisa reiniciar server + Chrome):**
- [ ] Reiniciar `node server.js`; `POST /api/score` num clipe real via UI.
- [ ] UI do Step 05 mostra os chips `retention NN/100` e `hook forte`/`hook fraco` acima da tabela de dips; curva + dips seguem renderizando.
- [ ] Ciclo `git-workflow` (inspecionar → commit → push) com aprovação do usuário.

## Status

_(propriedade do Executor — updates incrementais durante a implementação)_

**Task 1 — Normalização robusta por percentil: CONCLUÍDA**
- Arquivo: `lib/score.js` (função `normalize` linhas ~59-62 substituída por `percentile` + `normalize`).
- `node -e "require('./lib/score.js'); console.log('loads ok')"` → `loads ok`.
- `node "$CLAUDE_JOB_DIR/tmp/normcheck.js"` → `flat [0.5,0.5,0.5,0.5]`; `spike max 1`; `anyNaN false`. Nota: a afirmação do plano de que "os nove primeiros não colapsam todos para 0" não se confirma para este array específico de 10 elementos (9×`1` + um `100`): com p5=1 e p95≈55.45, os nove valores `1` mapeiam para `0` de qualquer forma (mesmo resultado que min/max cru neste caso particular, porque o valor mínimo do array coincide com o p5). O comportamento robusto a outlier fica evidente em arrays com mais variação abaixo do p95 — os asserts machine-checkable do step (`flat`, `anyNaN`, clamp do spike a `1`) todos passam.

**Task 2 — Motion + blend + dead-air: CONCLUÍDA**
- Arquivo: `lib/score.js` — constantes `DEADAIR_ENERGY`/`DEADAIR_FACTOR`/`HOOK_SECONDS` adicionadas após os `require`s; helper `motionMagnitude` adicionado entre `visualChange` e `percentile`/`normalize`; `Promise.all` em `proxyCurve` agora inclui `motion`; blend recomposto com `visual = 0.5*nC + 0.5*nM` e penalidade dead-air (`base * DEADAIR_FACTOR` quando `speech[i]===0 && e < DEADAIR_ENERGY`).
- Verificação: `node "$CLAUDE_JOB_DIR/tmp/pc_check.js"` contra `output_clips-d7b650e0239d_clip-01.mp4` (duração real 5.033s, `ffprobe` confirmado) → `len 6` (= `ceil(5.033)`), `min 0.465 max 0.845`, `anyNaN false`, `inRange true`. Sem `FAIL`.
- Nota de execução: o require relativo `./lib/score.js` do snippet do plano não resolve quando o script roda fora do repo root (Node resolve `require` relativo ao arquivo, não ao cwd) — usei paths absolutos no script de verificação (`$CLAUDE_JOB_DIR/tmp/pc_check.js`), sem alterar nenhum arquivo do plano.

**Task 3 — score/hook (termômetro): CONCLUÍDA**
- Arquivo: `lib/score.js` — bloco de cálculo de `score` (média ponderada, HOOK_SECONDS conta 2x) e `hook` (`{value, weak, advice}`) inserido após o loop de `dips` e antes do `return`; `score` e `hook` adicionados ao objeto retornado por `proxyCurve` (entre `mean` e `dips`).
- Verificação: `node "$CLAUDE_JOB_DIR/tmp/pc_check2.js"` → `score 77 true`; `hook {"value":0.844,"weak":false,"advice":"hook forte — a abertura segura a atenção"}`; `hook.weak isBool true`; `has dips true`; `kind proxy`. Sem `FAIL`.

**Task 4 — UI chips retention/hook: CONCLUÍDA**
- Arquivo: `public/index.html` — em `doScore` (linhas ~653-659), dois chips inseridos logo após o chip de `kind` e antes do bloco de dips, guardados por `r.score != null` e `r.hook`.
- Classe de chip usada para o estado "fraco/abaixo do limiar": `wn` (não `bad`) — confirmado por `grep -nE "\.chip\.(bad|wn|ok)" public/index.html`, que só encontrou `.chip.ok` (linha 171) e `.chip.wn` (linha 173); `.chip.bad` não existe no CSS. Ambos os chips novos (`retention NN/100` e `hook forte`/`hook fraco`) usam `ok`/`wn` conforme threshold (`r.score >= 60` e `!r.hook.weak` → `ok`).
- Verificação por grep: `grep -nE "retention \$\{r\.score\}|hook (fraco|forte)|r\.hook\.weak" public/index.html` → 3 ocorrências nas linhas 655-656, todas dentro de `doScore`, envolvidas pelos guardas esperados.
- Verificação visual no Chrome fica pendente para o Orquestrador (não tenho navegador).

**Verificação final (parte do Executor):**
- `node -e "require('./lib/score.js')"` → carrega sem erro.
- `module.exports = { score, proxyCurve, TRIBE_INFO }` confirmado por grep em `lib/score.js:218` — assinatura pública intacta.
- `proxyCurve(<clip>, {})` retorna `curve` (v∈[0,1]), `score` (inteiro 77, dentro de 0-100), `hook.{value,weak,advice}`, `dips` (array), `kind:'proxy'` — todos confirmados nas verificações acima.
- `git status --short` mostra `lib/score.js` e `public/index.html` modificados, como esperado. **Divergência não relacionada a esta task:** `lib/captions.js` também aparece modificado (troca de cor `accent` em `STYLES.impact`, `&H0088FF00`→`&H0000FFFF`), mas com timestamp (15:19) anterior ao início desta execução (minhas edições em `score.js`/`index.html` são 16:02-16:03) — não foi tocado por este Executor nem faz parte do plano; sinalizando para o Orquestrador/git-workflow tratar separadamente no staging do commit.
- Nenhum `git add`/`git commit` foi executado, conforme instruído. Working tree deixado intacto para o ciclo `git-workflow`.
- Reinício do `node server.js` e verificação visual do `/api/score` na UI ficam para o Orquestrador (não reiniciei o server rodando em :4870, conforme instruído).
