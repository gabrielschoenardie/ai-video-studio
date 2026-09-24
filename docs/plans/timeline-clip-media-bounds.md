# Limites de mídia nos clipes da TIMELINE (etapa B7) — Implementation Plan

> **Para o executor:** este plano é do fluxo de agentes do projeto (`CLAUDE.md`). O executor implementa as trocas literalmente e é dono exclusivo da seção `## Status`. Ele não commita: o ciclo git passa pelo subagente `git-workflow`, um modo por invocação, com OK do usuário antes do `publish`. Passos usam `- [ ]` para acompanhamento.

**Goal:** o clipe na tela passa a dizer a verdade sobre a mídia que usa — waveform do trecho usado, borda direita que para no fim do arquivo, e o excesso já existente visível.

**Architecture:** uma cache de duração por caminho, alimentada por `POST /api/probe` (rota que já existe) no mesmo laço de markup onde as outras duas caches de mídia já são alimentadas. Dela saem três consumidores: a trava do trim direito, a marcação do excesso e a janela da mini-waveform. A track VÍDEO já faz as duas primeiras coisas e é a referência copiada.

**Tech Stack:** `public/index.html` (o app é vanilla JS num `<script>` inline, sem build), `public/dev/ui-probe.js`, checagens em Node CommonJS sob `jobs/checks/` (gitignored).

**Spec:** `docs/superpowers/specs/2026-09-24-timeline-clip-media-bounds-design.md`

## Global Constraints

- **Nada em `lib/`, `server.js` ou no sidecar.** A etapa é de interface e usa uma rota que já existe. Para a mesma timeline, o conform exporta o mesmo arquivo, byte a byte.
- **`null` de duração nunca bloqueia edição.** Sem o dado, o comportamento é exatamente o de antes da etapa: sem trava, sem janela, sem marcação.
- **Nenhum cálculo novo por render sem custo limitado.** `renderClipTrack` roda a cada frame de arraste.
- **`data-peak` e as classes de zona do medidor não mudam.** São a superfície que o probe e as checagens do B5 e do B6 leem.
- **Projeto salvo abre como foi salvo.** Nenhum saneamento silencioso de `dur` ou `srcIn` nas tracks de clipe.
- **Trocas aditivas onde possível.** `jobs/checks/b5-static.js` e `b6-static.js` fixam as duas linhas de limpeza de cache (`plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();` e a linha do `audioBufCache.delete`). As trocas desta etapa acrescentam linhas novas em vez de reescrever essas.
- **Mas "aditivo" não garante checagem anterior verde, e eu escrevi isso errado na primeira versão deste plano.** Ao escrever a Task 1 eu auditei as âncoras de **texto** das checagens antigas e concluí que as seis passariam. Falhou em duas, por tipos de asserção que eu não audi­tei: uma **contagem fixa** (`b2-static` exigia exatamente 7 ocorrências de `renderSfxTrack()`, e a chamada nova do `ensureMediaDur` fez 8) e um **literal de lista** (`b6-static` fixava o `ORDER` do probe fechado em `'B6'`). Antes de cada task, auditar os três tipos: âncora de texto, contagem e literal de lista. Quando uma vencer, o Orquestrador atualiza a checagem — o executor **reporta e não edita**.
- **Invariantes do sub-projeto A valem:** nenhuma fonte literal abaixo de 11px fora de `var(--fs-*)`, nenhuma duração literal de `transition`/`animation` fora das exceções, e os `<script>` inline têm de compilar.
- **Working tree em CRLF** (`core.autocrlf=true`) em `public/index.html` e `public/dev/ui-probe.js`: preservar os terminadores existentes, nunca normalizar o arquivo.

## Review Focus

Classes de entrada que a spec implica e que nenhuma tarefa exercitaria por padrão. Cada linha tem o teste que a fixa, na tarefa que é dona do código.

1. **Arquivo que não é mídia, ou `duration` ausente na resposta do probe** → `mediaDurOf` devolve `null`, sem trava, sem marcação, sem exceção. (Task 1, Step 1, caso `nao-midia`.)
2. **Arquivo do clipe apagado do disco** → o `/api/probe` responde erro, a cache guarda `null` e a edição segue normal. (Task 1, Step 1, caso `probe-falhou`.)
3. **`srcIn` além do fim da mídia** (sidecar antigo, ou arquivo trocado por um mais curto) → o excesso é limitado à largura do próprio clipe, nunca maior; a janela da waveform é vazia e devolve zeros. (Task 1, Step 1, caso `srcIn-alem`; Task 2, Step 1, caso `janela-vazia`.)
4. **Duração chegando no meio de um arraste** → `hi` já foi calculado, aquele arraste termina sem trava e não dá salto; o próximo já tem. (Task 1, Step 1, caso `hi-uma-vez`.)
5. **Clipe estreito em zoom extremo** (o markup tem piso de 4 px de largura) → a sobreposição do excesso não escapa do clipe. É afirmação geométrica, então o teste é no navegador, não na checagem estática: o `clipBounds()` do probe (Task 1, Step 3) compara a largura da sobreposição com a do clipe em toda track de clipe, e o `overflow:hidden` do `.bt-clip` é a garantia no CSS.

---

## File Structure

| Arquivo | Responsabilidade | Tarefas |
| --- | --- | --- |
| `public/index.html` | Todo o app: a cache de duração, os três consumidores, a waveform, o `title` e o rótulo | 1, 2, 3 |
| `public/dev/ui-probe.js` | Instrumento de medição: estágio `B7` e os checks | 1, 2, 3 |
| `jobs/checks/b7a-static.js` | Checagem da Task 1 (gitignored, não entra em commit) | 1 |
| `jobs/checks/b7b-static.js` | Checagem da Task 2, com o teste de unidade de `windowPeaks` | 2 |
| `jobs/checks/b7c-static.js` | Checagem da Task 3 | 3 |

Um arquivo de app só, porque é assim que este projeto é: o `public/index.html` é a UI inteira e não vou fragmentá-lo por causa desta etapa.

## Checklist manual de regressão

O checklist do sub-projeto A (itens 1–12 de `docs/plans/ui-premium-timeline.md`) continua valendo, com o item 8 na forma da Task 4 de `docs/plans/mixagem-audio.md`: "M/S nas tracks de áudio refletem no preview; H em MARKERS, B-ROLL e LEGENDA reflete no preview". Cada task acrescenta os itens dela.

## Auxiliares do Orquestrador (console do navegador)

Os mesmos de `docs/plans/mixagem-audio.md`, seção "Auxiliares do Orquestrador", mais estes dois, para os testes de arraste desta etapa:

```js
// Arrasta um puxador de trim por `dx` pixels, com eventos de mouse reais.
T.trim = async (track, idx, side, dx) => {
  const h = document.querySelector(`.bt-handle.${side}[data-track="${track}"][data-idx="${idx}"]`);
  if (!h) throw new Error('puxador não achado: ' + track + ' ' + idx + ' ' + side);
  const r = h.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y0 }));
  await T.sleep(50);
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: y0 }));
  await T.sleep(50);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + dx, clientY: y0 }));
  await T.sleep(200);
};
// Medidas de um clipe: largura, e a do trecho marcado como excesso.
T.clipBox = (track, idx) => {
  const el = document.querySelector(`#bt-track-${track} .bt-clip[data-idx="${idx}"]`);
  const ov = el && el.querySelector('.bt-clip-over');
  return { w: el ? Math.round(el.getBoundingClientRect().width) : null,
    excesso: ov ? Math.round(ov.getBoundingClientRect().width) : 0,
    win: el && el.querySelector('.bt-clip-wave') ? el.querySelector('.bt-clip-wave').dataset.win : null };
};
```

### Task 0: Preparo (Orquestrador, antes de qualquer execução)

Os tons de `jobs/b-check/` do sub-projeto B continuam servindo (`whoosh.wav` 0,8 s, `bed.wav` 10 s, `hit.wav` 0,8 s com pico só no começo, `loud.wav` 1 s). Esta etapa precisa de um a mais, para o caso de "arquivo que não é mídia":

```bash
printf 'isto nao e midia\n' > jobs/b-check/nao-midia.txt
```

E a fixture de sempre, `output/assembled-4545f906507a.mp4`, com o sidecar restaurado de `jobs/b-check/fixture.beats.json.bak` antes e depois de cada teste de navegador.

---

### Task 1 (B7a): Cache de duração, trava do trim direito e marcação do excesso

**Files:**
- Create: `jobs/checks/b7a-static.js`
- Modify: `public/index.html` — CSS depois de `.bt-clip-wave{…}`, declaração depois de `miniWaveCache`, bloco novo depois de `ensureMiniWave()`, limpeza por caminho em `pruneMediaCache()`, limpeza total em `clearMediaCache()`, criação de clipe em `addClipFromAsset`, markup do clipe em `renderClipTrack()`, `hi` em `startClipTrim()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `renderBrollTrack()`, `renderMusicTrack()`, `renderSfxTrack()`, `timeToX()`, `clipsFor()`, `MIN_BEAT_DUR`, `DURATION` (todos já existentes); `POST /api/probe` (`server.js:229`).
- Produces: `const mediaDur` (Map); `mediaDurOf(path) → número > 0 | null`; `ensureMediaDur(path) → Promise<void>`; `overflowSec(c, md) → segundos ≥ 0` (pura); classe CSS `.bt-clip-over`; estágio `B7` do probe com o check `clip-bounds`.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b7a-static.js`:

```js
// B7a — checagem estática. Rodar da raiz: node jobs/checks/b7a-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const probe = read('public/dev/ui-probe.js');
const lines = src.split('\n');
const fail = [];
const count = (s, t) => s.split(t).length - 1;
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });

// Invariantes do sub-projeto A.
lines.forEach((l, i) => {
  for (const m of l.matchAll(/font(?:-size)?\s*:\s*([^;}"]*)/g)) {
    const px = /(\d*\.?\d+)px/.exec(m[1]);
    if (px && !/var\(--fs-/.test(m[1]) && !/isento:/.test(l) && parseFloat(px[1]) < 11) fail.push('fonte < 11px em :' + (i + 1));
  }
  if (/(transition|animation)[\w-]*\s*:/.test(l) && !/\b(drift|blink|bt-pulse)\b|\.001ms/.test(l) &&
      /(^|[\s,(:])\d*\.?\d+m?s(?![\w-])/.test(l.replace(/var\(--dur-\d\)/g, ''))) fail.push('duração literal em :' + (i + 1));
});
[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});
try { new Function(probe); } catch (e) { fail.push('ui-probe.js não compila: ' + e.message); }

// Pontos de código da Task 1.
need(src, 'index.html', [
  '.bt-clip-over{position:absolute; top:0; bottom:0; right:0; z-index:0; pointer-events:none;',
  "const mediaDur = new Map();",
  '  function mediaDurOf(path) {',
  '  async function ensureMediaDur(path) {',
  "      body: JSON.stringify({ input: path }) });",
  '  function overflowSec(c, md) {',
  'mediaDur.set(path, info && info.duration > 0 ? info.duration : null);',
  'if (![...BROLL, ...MUSIC, ...SFX].some(c => c.path === path)) mediaDur.delete(path);',
  'mediaDur.clear();',
  'if (asset.info && asset.info.duration > 0) mediaDur.set(asset.path, asset.info.duration);',
  'ensureMediaDur(c.path);',
  'const ovSec = overflowSec(c, mediaDurOf(c.path));',
  'class="bt-clip-over"',
  'const md = mediaDurOf(c.path);',
  'if (md) hi = Math.min(hi, origStart + (md - origSrcIn));',
]);
// As linhas que b5-static e b6-static fixam não podem ter mudado: as trocas são aditivas.
need(src, 'index.html', [
  'plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();',
  "if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }",
]);
if (count(src, 'ensureMediaDur(c.path);') !== 1) fail.push('ensureMediaDur deveria ser chamado 1× no markup do clipe');
if (count(src, 'mediaDur.clear();') !== 1) fail.push('mediaDur.clear() deveria aparecer 1× (clearMediaCache)');

// overflowSec: a função pura, extraída do HTML.
{
  const m = /  function overflowSec\(c, md\) \{\n[\s\S]*?\n  \}\n/.exec(src);
  if (!m) fail.push('overflowSec não achada');
  else {
    const f = new Function(m[0] + '\nreturn overflowSec;')();
    const cases = [
      ['cabe', { srcIn: 0, dur: 0.8 }, 0.8, 0],
      ['cabe com srcIn', { srcIn: 2, dur: 1 }, 5, 0],
      ['exato', { srcIn: 0, dur: 5 }, 5, 0],
      ['passa', { srcIn: 0, dur: 4 }, 0.8, 3.2],
      ['passa com srcIn', { srcIn: 2, dur: 4 }, 3, 3],
      // srcIn além do fim da mídia: o excesso é o clipe inteiro, nunca mais que isso
      ['srcIn-alem', { srcIn: 9, dur: 2 }, 5, 2],
      ['nao-midia', { srcIn: 0, dur: 4 }, null, 0],
      ['probe-falhou', { srcIn: 0, dur: 4 }, 0, 0],
      ['sem srcIn', { dur: 4 }, 0.8, 3.2],
    ];
    cases.forEach(([name, c, md, want]) => {
      const got = f(c, md);
      if (Math.abs(got - want) > 1e-9) fail.push(`overflowSec(${name}) = ${got}, esperado ${want}`);
    });
  }
}

// hi é calculado uma vez, antes do onMove: a duração que chega no meio do arraste não dá salto.
{
  const m = /  function startClipTrim\(handleEl, e\) \{\n[\s\S]*?\n    function onMove\(ev\) \{/.exec(src);
  if (!m) fail.push('startClipTrim não achada');
  else if (!/if \(md\) hi = Math\.min\(hi, origStart \+ \(md - origSrcIn\)\);/.test(m[0]))
    fail.push('hi-uma-vez: a trava da mídia deveria estar antes do onMove, não dentro dele');
}

// Probe.
need(probe, 'ui-probe.js', ["const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6', 'B7'];",
  '  function clipBounds() {', "add('clip-bounds',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B7a estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b7a-static.js`. Esperado: `FAIL` com as quinze linhas `index.html — ausente:` do primeiro bloco, as linhas de contagem de `ensureMediaDur` e `mediaDur.clear()`, `overflowSec não achada`, `hi-uma-vez: …` e as três linhas `ui-probe.js — ausente:`. As **duas** linhas do segundo `need` (as que `b5-static` e `b6-static` fixam) **não** aparecem: elas já existem e as trocas não vão mexer nelas.

- [ ] **Step 2 [Executor]: `public/index.html` — 9 trocas, nesta ordem**

**public/index.html · troca 1 — CSS do trecho excedente.** Substituir:

```html
.bt-clip-wave{position:absolute; inset:0; width:100%; height:100%; z-index:0}
```

por:

```html
.bt-clip-wave{position:absolute; inset:0; width:100%; height:100%; z-index:0}
/* Trecho do clipe além do fim da mídia (B7). Só aparece em projeto salvo antes da
   trava do trim direito: com ela valendo, não há como criar um novo. Esmaecido e
   tracejado, e sem capturar mouse — a edição do clipe continua igual, e o contorno
   sólido da seleção segue distinguível do tracejado do aviso. O overflow:hidden do
   .bt-clip é o que impede a sobreposição de escapar num clipe estreito. */
.bt-clip-over{position:absolute; top:0; bottom:0; right:0; z-index:0; pointer-events:none;
  background:var(--panel); opacity:.55; border-left:1px dashed var(--faint)}
```

**public/index.html · troca 2 — a cache de duração.** Substituir:

```html
  const miniWaveCache = new Map(); // path -> Float32Array picos | 'pending' | null (mini-waveform do clipe TRILHA)
```

por:

```html
  const miniWaveCache = new Map(); // path -> Float32Array picos | 'pending' | null (mini-waveform do clipe TRILHA)
  /* Duração da mídia de cada arquivo usado em clipe (B7). O MEDIA_DUR vale só para o
     vídeo base; cada clipe aponta para um arquivo próprio, e o sidecar não guarda a
     duração. Uma consulta ao POST /api/probe por caminho, cacheada — é o que trava o
     trim direito e marca o excesso, nas três tracks de clipe. `null` significa
     desconhecido, não-mídia ou probe falho: aí o comportamento é o de antes do B7. */
  const mediaDur = new Map();      // path -> segundos | 'pending' | null
```

**public/index.html · troca 3 — acessador, consulta e a conta do excesso.** Substituir:

```html
    } catch (e) { miniWaveCache.set(path, null); if (!audioBufCache.has(path)) audioBufCache.set(path, null); }
    renderMusicTrack();
    renderSfxTrack();
    scheduleMaster();
  }
```

por:

```html
    } catch (e) { miniWaveCache.set(path, null); if (!audioBufCache.has(path)) audioBufCache.set(path, null); }
    renderMusicTrack();
    renderSfxTrack();
    scheduleMaster();
  }
  function mediaDurOf(path) {
    const d = mediaDur.get(path);
    return typeof d === 'number' && d > 0 ? d : null;
  }
  /* Uma consulta por caminho. O caminho vai como o clipe o guarda: é o resolveInput do
     servidor que decide se é legítimo, a mesma fronteira que o /api/probe já aplica a
     todo chamador. Erro de rede, resposta não-ok ou arquivo que não é mídia viram
     `null` e não são perguntados de novo. As três tracks de clipe re-renderizam porque
     a trava e a marcação valem nas três. */
  async function ensureMediaDur(path) {
    if (mediaDur.has(path)) return;
    mediaDur.set(path, 'pending');
    try {
      const r = await fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: path }) });
      const info = r.ok ? await r.json() : null;
      mediaDur.set(path, info && info.duration > 0 ? info.duration : null);
    } catch (e) { mediaDur.set(path, null); }
    renderBrollTrack();
    renderMusicTrack();
    renderSfxTrack();
  }
  /* Segundos do clipe que passam do fim da mídia. Limitado à duração do próprio clipe:
     um srcIn além do fim da mídia (sidecar antigo, ou arquivo trocado por um mais
     curto) marcaria o clipe inteiro, nunca mais que ele. Duração desconhecida ou zero
     devolve 0 — sem dado, sem marcação. */
  function overflowSec(c, md) {
    if (!(md > 0)) return 0;
    const over = (c.srcIn || 0) + c.dur - md;
    return over > 0 ? Math.min(c.dur, over) : 0;
  }
```

**public/index.html · troca 4 — limpeza por caminho (aditiva).** Substituir:

```html
      if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }
  }
```

por:

```html
      if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }
    // a duração (B7) sai quando nenhum clipe de nenhuma das três tracks usa mais o arquivo
    for (const path of [...mediaDur.keys()])
      if (![...BROLL, ...MUSIC, ...SFX].some(c => c.path === path)) mediaDur.delete(path);
  }
```

**public/index.html · troca 5 — limpeza total (aditiva).** Substituir:

```html
    plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();
    meterEnv = null; lastMixSig = ''; meterGen++;
```

por:

```html
    plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();
    mediaDur.clear();   // B7: nada da duração do vídeo anterior
    meterEnv = null; lastMixSig = ''; meterGen++;
```

**public/index.html · troca 6 — semeadura ao criar clipe.** Substituir:

```html
    const clip = track === 'broll'
      ? { path: asset.path, name: asset.name, start, dur, srcIn: 0 }
      : { path: asset.path, name: asset.name, start, dur, volume: 1, srcIn: 0 };
```

por:

```html
    // a duração do asset já é conhecida aqui: semeia a cache do B7 e poupa o probe.
    // Clipe vindo do sidecar não tem essa sorte — para ele o ensureMediaDur consulta.
    if (asset.info && asset.info.duration > 0) mediaDur.set(asset.path, asset.info.duration);
    const clip = track === 'broll'
      ? { path: asset.path, name: asset.name, start, dur, srcIn: 0 }
      : { path: asset.path, name: asset.name, start, dur, volume: 1, srcIn: 0 };
```

**public/index.html · troca 7 — markup do clipe: consulta e marcação.** Substituir:

```html
      let media = '';
      if (track === 'broll') {
```

por:

```html
      // B7: a duração da mídia entra no mesmo laço onde a minionda e o thumbnail já
      // entram — um por clipe, e a cache descarta a repetição. Cobre projeto aberto do
      // sidecar e clipe recém-criado sem gancho novo no loadVideo.
      ensureMediaDur(c.path);
      const ovSec = overflowSec(c, mediaDurOf(c.path));
      const overMark = ovSec > 0 ? `<div class="bt-clip-over" style="width:${timeToX(ovSec)}px"></div>` : '';
      let media = '';
      if (track === 'broll') {
```

**public/index.html · troca 8 — o excesso no HTML do clipe.** Substituir:

```html
          style="left:${timeToX(c.start)}px;width:${Math.max(4, timeToX(c.dur))}px">
          ${media}
```

por:

```html
          style="left:${timeToX(c.start)}px;width:${Math.max(4, timeToX(c.dur))}px">
          ${media}${overMark}
```

**public/index.html · troca 9 — a trava do trim direito.** Substituir:

```html
    // não dá para esticar a cabeça para antes do começo da mídia: srcIn não pode
    // ficar negativo. Mesma trava que qualquer NLE aplica ao trim de entrada.
    if (side === 'left') lo = Math.max(lo, origStart - origSrcIn);
```

por:

```html
    // não dá para esticar a cabeça para antes do começo da mídia: srcIn não pode
    // ficar negativo. Mesma trava que qualquer NLE aplica ao trim de entrada.
    if (side === 'left') lo = Math.max(lo, origStart - origSrcIn);
    // ...nem a cauda para depois do fim dela (B7). Espelho da trava de cima, e a mesma
    // forma do Math.min(MEDIA_DUR, …) que a track VÍDEO já usa no startVideoTrim.
    // Calculado uma vez, aqui: uma duração que chegue no meio do arraste não muda o
    // teto do gesto em curso, então a borda não dá salto — o próximo arraste já trava.
    // O teto da mídia nunca puxa a borda para dentro de um clipe que já passa do fim do
    // arquivo (projeto salvo antes desta trava): nesse caso o teto é o próprio fim atual,
    // então ele impede crescer e deixa encurtar à vontade. Assim que o clipe volta a caber,
    // o teto passa a ser o fim da mídia. Um toque no puxador não apaga trecho nenhum.
    const md = mediaDurOf(c.path);
    if (md) hi = Math.min(hi, Math.max(origEnd, origStart + (md - origSrcIn)));
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 3 trocas**

**public/dev/ui-probe.js · troca 1 — estágio B7 no ORDER.** Substituir:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6']; // o B4 não mexe na TIMELINE
```

por:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6', 'B7']; // o B4 não mexe na TIMELINE
```

**public/dev/ui-probe.js · troca 2 — clipBounds().** Substituir:

```js
  async function transportIds() {
```

por:

```js
  /* B7: o trecho marcado como excesso não pode escapar do clipe, e clipe que cabe na
     mídia não pode ter marcação. Só lê DOM — a duração da mídia mora no closure da
     TIMELINE e o probe não a enxerga, então a afirmação é geométrica. */
  function clipBounds() {
    const bad = [];
    for (const track of ['broll', 'music', 'sfx']) {
      for (const el of $$(`#bt-track-${track} .bt-clip`)) {
        const ov = $('.bt-clip-over', el);
        if (!ov) continue;
        const w = el.getBoundingClientRect().width, ow = ov.getBoundingClientRect().width;
        if (ow > w + 1) bad.push({ track, idx: el.dataset.idx, clipe: round(w, 1), excesso: round(ow, 1) });
        if (getComputedStyle(ov).pointerEvents !== 'none') bad.push({ track, idx: el.dataset.idx, pointerEvents: 'não é none' });
      }
    }
    return { marcados: $$('.bt-clip-over').length, bad };
  }
  async function transportIds() {
```

**public/dev/ui-probe.js · troca 3 — o check do B7.** Substituir:

```js
      if (at('B6')) {
        const sp = sfxPeak();
```

por:

```js
      if (at('B7')) {
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
      }
      if (at('B6')) {
        const sp = sfxPeak();
```

- [ ] **Step 4 [Executor]: Checagens** — `node jobs/checks/b7a-static.js` → `PASS: B7a estático`. Depois rodar as seis anteriores e **reportar sem editar nenhuma**: `b0-static`, `b1-unit`, `b2-static`, `b3-static`, `b5-static`, `b6-static`. **Todas as seis devem passar**: as trocas 4 e 5 foram desenhadas como aditivas exatamente para as âncoras de `b5-static` e `b6-static` continuarem casando. Se alguma falhar, reportar qual e a linha — é sinal de que uma troca não ficou aditiva como planejado, e a decisão de ajustar é do Orquestrador.

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 1 de `docs/plans/timeline-clip-media-bounds.md`; rodar `node jobs/checks/b7a-static.js` e as seis checagens anteriores; conferir que nada em `lib/`, `server.js` ou no sidecar mudou; que `mediaDurOf` devolve `null` para `'pending'`, para zero e para ausente; que `ensureMediaDur` nunca lança e nunca pergunta duas vezes pelo mesmo caminho; que a trava do trim direito é calculada antes do `onMove` e não dentro dele; que `overflowSec` limita o excesso à duração do clipe; e que a sobreposição não captura mouse".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição (aba em **primeiro plano** — o `requestAnimationFrame` do medidor é pausado em aba de fundo, lição da Task 6 do plano do B), auxiliares colados, sidecar da fixture restaurado.

```js
const r = await uiProbe.run('B7');
({ ok: r.ok, total: r.results.length, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id) })
```

Esperado: `ok: true`, `falhas: []`, com `clip-bounds` entre os checks.

A trava, num efeito de 0,8 s (o `whoosh.wav`):

```js
T.asset('whoosh.wav', 0.8); T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight');
await T.add('sfx', 'whoosh.wav');
for (let i = 0; i < 40 && !T.clipBox('sfx', 0).w; i++) await T.sleep(100);
const antes = { dur: +T.clipBox('sfx', 0).w, excesso: T.clipBox('sfx', 0).excesso };
await T.trim('sfx', 0, 'right', 400);            // 400 px para a direita: bem além dos 0,8 s
const depois = { dur: +T.clipBox('sfx', 0).w, excesso: T.clipBox('sfx', 0).excesso };
({ antes, depois, sidecar: (await T.sidecar()).sfx })
```

Esperado: `depois.dur` praticamente igual a `antes.dur` (a borda encostou no fim do arquivo e parou; tolerância de 1 px) e `depois.excesso: 0` — a trava impede criar excesso, então nada é marcado.

A marcação do excesso, num clipe fabricado além do fim da mídia (é o estado que um projeto salvo antes desta etapa pode ter):

```js
SFX[0].dur = 4; renderSfxTrack(); await T.sleep(200);
const box = T.clipBox('sfx', 0);
({ box, proporcao: +(box.excesso / box.w).toFixed(2) })
```

Esperado: `excesso` maior que zero e `proporcao` perto de `0,8` (3,2 s de excesso em 4 s de clipe). Depois, arrastar a borda direita para dentro e ver o excesso desaparecer ao cruzar o fim da mídia:

```js
await T.trim('sfx', 0, 'right', -220);
T.clipBox('sfx', 0)
```

Esperado: `excesso: 0`. Restaurar o sidecar da fixture.

Arquivo que não é mídia (Review Focus 1), com o `nao-midia.txt` da Task 0:

```js
addAsset({ path: 'jobs/b-check/nao-midia.txt', name: 'nao-midia.txt', kind: 'audio', info: {}, source: 'probe' });
T.key('Home'); await T.sleep(200); await T.steps(90, 'ArrowRight');
await T.add('sfx', 'nao-midia.txt'); await T.sleep(1200);
const i = T.clips('sfx') - 1;
({ clipes: T.clips('sfx'), box: T.clipBox('sfx', i), erroNoConsole: false })
```

Esperado: o clipe entra, `excesso: 0` (sem duração, sem marcação), nenhuma exceção no console, e a borda direita continua arrastável sem trava. Restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares; `await uiProbe.run('B7')` → `ok: true`, `falhas: []`. Só regressão (spec, decisão 8): a etapa não toca nenhuma das duas engines de preview. Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 da Task 4 do plano do B) + esticar a borda direita de um efeito curto e ela parar no fim do arquivo, em vez de ir até o fim da timeline; abrir um projeto antigo que tenha clipe esticado demais e ver o trecho excedente esmaecido com borda tracejada; arrastar essa borda para dentro e a marcação sumir; e um clipe que cabe na mídia continuar sem marcação nenhuma.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/clip-media-bounds-a`; arquivos `public/index.html`, `public/dev/ui-probe.js`, `docs/plans/timeline-clip-media-bounds.md`; commit `Clamp clip right trim to media end, flag overflow (B7a)`) → OK do usuário → `publish`. A spec já foi publicada junto do plano, num PR próprio antes desta task, como a da R3 no PR #18.

---

### Task 2 (B7b): Mini-waveform da janela usada

Depende da Task 1 apenas por ordem de publicação: as trocas não colidem, mas o `winPeakCache` entra nas mesmas linhas de limpeza que a Task 1 já tocou, então a Task 1 precisa estar aplicada.

**Files:**
- Create: `jobs/checks/b7b-static.js`
- Modify: `public/index.html` — comentário da declaração de `miniWaveCache`, bloco novo antes de `drawPeaksToCanvas()`, corpo de `ensureMiniWave()`, limpezas de cache, portão do canvas e chamada de desenho em `renderClipTrack()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `audioBufCache` (B5), `drawPeaksToCanvas()`, `mediaDur`/`mediaDurOf` (Task 1).
- Produces: `MINI_COLS = 200`; `MINI_MAX_PER_COL = 256`; `windowPeaks(buf, srcIn, dur, cols) → Float32Array` (pura); `windowPeaksCached(path, srcIn, dur) → Float32Array | null`; atributo `data-win` no canvas, formato `"<srcIn>,<dur>"` com 3 casas; check `wave-window` no estágio `B7` do probe.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b7b-static.js`:

```js
// B7b — checagem estática e de unidade da janela da mini-waveform.
// Rodar da raiz: node jobs/checks/b7b-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const probe = read('public/dev/ui-probe.js');
const fail = [];
const count = (s, t) => s.split(t).length - 1;
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });

[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});
try { new Function(probe); } catch (e) { fail.push('ui-probe.js não compila: ' + e.message); }

need(src, 'index.html', [
  'const MINI_COLS = 200;', 'const MINI_MAX_PER_COL = 256;', 'const winPeakCache = new Map();',
  '  function windowPeaks(buf, srcIn, dur, cols) {', '  function windowPeaksCached(path, srcIn, dur) {',
  'if (winPeakCache.size > 300) winPeakCache.clear();',
  'miniWaveCache.set(path, true);',
  'if (audioBufCache.get(c.path) instanceof AudioBuffer) media =',
  'data-win="${(c.srcIn || 0).toFixed(3)},${c.dur.toFixed(3)}"',
  'const peaksArr = windowPeaksCached(c2.path, c2.srcIn || 0, c2.dur);',
  'winPeakCache.clear();',
]);
// o laço de 200 colunas do arquivo inteiro sai: era trabalho morto depois desta task
['const cols = 200, spc = Math.max(1, Math.floor(data.length / cols));', 'miniWaveCache.set(path, p);']
  .forEach(t => { if (src.includes(t)) fail.push('index.html — não deveria existir: ' + t); });
// as linhas que b5-static e b6-static fixam seguem intactas
need(src, 'index.html', ['audioBufCache.set(path, decoded);',
  'plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();']);
if (count(src, 'winPeakCache.clear();') !== 2) fail.push('winPeakCache.clear() deveria aparecer 2× (memo cheio e clearMediaCache)');

// windowPeaks: a função pura, extraída do HTML, contra um AudioBuffer falso.
{
  const m = /  function windowPeaks\(buf, srcIn, dur, cols\) \{\n[\s\S]*?\n  \}\n/.exec(src);
  if (!m) fail.push('windowPeaks não achada');
  else {
    const f = new Function('MINI_MAX_PER_COL', m[0] + '\nreturn windowPeaks;')(256);
    // 10 s a 100 Hz: 1 s em amplitude 1,0 e o resto em 0,1
    const data = Float32Array.from({ length: 1000 }, (_, i) => (i < 100 ? 1 : 0.1));
    const buf = { sampleRate: 100, length: 1000, duration: 10, getChannelData: () => data };
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const all = (arr, v) => arr.every(x => near(x, v));

    const inicio = f(buf, 0, 1, 10);
    if (!all(inicio, 1)) fail.push('janela do começo deveria ser toda 1,0: ' + inicio.join(','));
    const meio = f(buf, 2, 4, 10);
    if (!all(meio, 0.1)) fail.push('janela do trecho baixo deveria ser toda 0,1: ' + meio.join(','));
    const fim = f(buf, 9, 1, 10);
    if (!all(fim, 0.1)) fail.push('janela do fim deveria ser toda 0,1: ' + fim.join(','));
    const todo = f(buf, 0, 10, 10);
    if (!near(todo[0], 1) || !near(todo[9], 0.1)) fail.push('arquivo todo: primeira coluna 1,0 e última 0,1, achado ' + todo.join(','));

    // janela vazia, negativa e fora do buffer: zeros, sem exceção
    [['janela-vazia', 0, 0], ['dur-negativa', 0, -3], ['fora-do-buffer', 20, 5], ['srcIn-alem', 11, 2]]
      .forEach(([name, srcIn, dur]) => {
        let out; try { out = f(buf, srcIn, dur, 10); } catch (e) { fail.push(`windowPeaks(${name}) lançou ${e.message}`); return; }
        if (out.length !== 10 || !all(out, 0)) fail.push(`windowPeaks(${name}) deveria ser zeros, achado ${out.join(',')}`);
      });
    // srcIn negativo entra como 0 e não lê fora do array
    const neg = f(buf, -1, 2, 10);
    if (neg.some(v => !(v >= 0))) fail.push('srcIn negativo produziu valor inválido: ' + neg.join(','));

    // o teto de amostras: uma janela de 10 min custa o mesmo que uma de 1 s.
    // Um Proxy conta as leituras sem alocar 26 milhões de floats.
    const mk = (len) => { let reads = 0;
      const p = new Proxy({}, { get: (_, k) => (k === 'length' ? len : (reads++, 0.5)) });
      return { reads: () => reads, buf: { sampleRate: 44100, length: len, duration: len / 44100, getChannelData: () => p } };
    };
    const curta = mk(44100 * 1); f(curta.buf, 0, 1, 200);
    const longa = mk(44100 * 600); f(longa.buf, 0, 600, 200);
    const teto = 200 * 256 + 200;
    if (curta.reads() > teto) fail.push('janela de 1 s visitou ' + curta.reads() + ', teto ' + teto);
    if (longa.reads() > teto) fail.push('janela de 10 min visitou ' + longa.reads() + ', teto ' + teto);
  }
}

need(probe, 'ui-probe.js', ['  function waveWindow() {', "add('wave-window',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B7b estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b7b-static.js`. Esperado: `FAIL` com as onze linhas `index.html — ausente:`, a linha de contagem do `winPeakCache.clear()`, `windowPeaks não achada` e as duas linhas `ui-probe.js — ausente:`. As duas linhas `não deveria existir:` **aparecem** neste FAIL: o laço de 200 colunas e o `miniWaveCache.set(path, p);` ainda estão no arquivo, e é a troca 3 desta task que os remove — o check acusa presença, então ele dispara. (A primeira versão deste plano dizia o contrário, com uma justificativa que explicava justamente por que eles apareceriam; prosa invertida, corrigida depois que o executor a confrontou com a saída real.) Já as duas linhas do segundo `need`, as âncoras que `b5-static` e `b6-static` fixam, **não** aparecem: elas já existem e esta task não as toca.

- [ ] **Step 2 [Executor]: `public/index.html` — 6 trocas, nesta ordem**

**public/index.html · troca 1 — o comentário da declaração, que deixa de ser verdade.** Substituir:

```html
  const miniWaveCache = new Map(); // path -> Float32Array picos | 'pending' | null (mini-waveform do clipe TRILHA)
```

por:

```html
  // Estado do decode de cada arquivo de clipe de áudio: 'pending' enquanto baixa e
  // decodifica, true quando o AudioBuffer entrou no audioBufCache, null quando falhou.
  // Até o B7a guardava 200 colunas de pico do arquivo inteiro; a mini-waveform passou a
  // desenhar a janela usada, calculada do buffer, e o array do arquivo virou trabalho morto.
  const miniWaveCache = new Map(); // path -> 'pending' | true | null
```

**public/index.html · troca 2 — `windowPeaks` e o memo, antes do desenho.** Substituir:

```html
  function drawPeaksToCanvas(canvas, peaksArr, color) {
```

por:

```html
  const MINI_COLS = 200;          // colunas da mini-waveform; o desenho anda de 2 em 2 px
  const MINI_MAX_PER_COL = 256;   // teto de amostras visitadas por coluna
  const winPeakCache = new Map(); // `path|srcIn|dur` -> Float32Array
  /* Picos do trecho usado do arquivo. É isto que faz a mini-waveform mostrar o que o
     clipe toca, em vez do arquivo inteiro esticado na largura dele — e é o que torna
     visível que cortar um clipe ao meio cortou o áudio. Pura: só lê o buffer.
     O passo mantém o total visitado sob MINI_MAX_PER_COL por coluna porque
     renderClipTrack roda a cada frame de arraste e o `dur` muda em todo frame: sem
     teto, esticar uma cama de 10 minutos varreria milhões de amostras por frame. O pico
     de cada coluna é o pico das amostras visitadas — numa waveform de 26 px de altura,
     indistinguível do pico exato. */
  function windowPeaks(buf, srcIn, dur, cols) {
    const out = new Float32Array(cols);
    if (!buf || !(dur > 0)) return out;
    const data = buf.getChannelData(0), sr = buf.sampleRate;
    const a = Math.max(0, Math.floor((srcIn || 0) * sr));
    const b = Math.min(data.length, Math.ceil(((srcIn || 0) + dur) * sr));
    if (b <= a) return out;
    const per = (b - a) / cols;
    for (let c = 0; c < cols; c++) {
      const s = a + Math.floor(c * per), e = Math.min(b, a + Math.floor((c + 1) * per));
      // ceil, não floor: com floor o passo fica em 1 quando a coluna tem entre 256 e 511
      // amostras, e aí não reduz nada — o "teto" viraria o dobro numa janela de ~2,3 s.
      const step = Math.max(1, Math.ceil((e - s) / MINI_MAX_PER_COL));
      let m = 0;
      for (let i = s; i < e; i += step) { const v = Math.abs(data[i]); if (v > m) m = v; }
      out[c] = m;
    }
    return out;
  }
  /* Memo por janela, arredondada ao milissegundo para não errar por ruído de ponto
     flutuante. Um arraste erra o memo de propósito em todo frame — é para isso que o
     teto de amostras existe. O memo é limpo inteiro ao passar de 300 entradas: é cache
     de desenho, não estado, e um arraste longo geraria uma entrada por frame. */
  function windowPeaksCached(path, srcIn, dur) {
    const buf = audioBufCache.get(path);
    if (!(buf instanceof AudioBuffer)) return null;
    const key = path + '|' + (srcIn || 0).toFixed(3) + '|' + dur.toFixed(3);
    let p = winPeakCache.get(key);
    if (!p) {
      if (winPeakCache.size > 300) winPeakCache.clear();
      p = windowPeaks(buf, srcIn, dur, MINI_COLS);
      winPeakCache.set(key, p);
    }
    return p;
  }
  function drawPeaksToCanvas(canvas, peaksArr, color) {
```

**public/index.html · troca 3 — `ensureMiniWave` para de calcular o array do arquivo.** Substituir:

```html
      const data = decoded.getChannelData(0);
      const cols = 200, spc = Math.max(1, Math.floor(data.length / cols));
      const p = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        let m = 0; const s = c * spc, e2 = Math.min(data.length, s + spc);
        for (let i = s; i < e2; i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
        p[c] = m;
      }
      miniWaveCache.set(path, p);
```

por:

```html
      // o desenho vem de windowPeaksCached, direto do buffer: aqui só fica o estado
      miniWaveCache.set(path, true);
```

**public/index.html · troca 4 — o memo entra nas limpezas.** Substituir:

```html
    mediaDur.clear();   // B7: nada da duração do vídeo anterior
```

por:

```html
    mediaDur.clear();   // B7: nada da duração do vídeo anterior
    winPeakCache.clear();
```

**public/index.html · troca 5 — portão do canvas e a janela desenhada.** Substituir:

```html
      if (isAudio) {
        ensureMiniWave(c.path);
        if (miniWaveCache.get(c.path) instanceof Float32Array) media = `<canvas class="bt-clip-wave" data-idx="${i}"></canvas>`;
      }
```

por:

```html
      if (isAudio) {
        ensureMiniWave(c.path);
        // o portão passa a ser o buffer, que é de onde a janela é calculada. O data-win
        // é gancho de teste: o probe compara a janela desenhada com o srcIn/dur do clipe.
        if (audioBufCache.get(c.path) instanceof AudioBuffer) media =
          `<canvas class="bt-clip-wave" data-idx="${i}" data-win="${(c.srcIn || 0).toFixed(3)},${c.dur.toFixed(3)}"></canvas>`;
      }
```

**public/index.html · troca 6 — desenhar a janela, não o arquivo.** Substituir:

```html
      host.querySelectorAll('.bt-clip-wave').forEach(cv => {
        const peaksArr = miniWaveCache.get(arr[+cv.dataset.idx].path);
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, waveColor);
      });
```

por:

```html
      host.querySelectorAll('.bt-clip-wave').forEach(cv => {
        const c2 = arr[+cv.dataset.idx];
        const peaksArr = windowPeaksCached(c2.path, c2.srcIn || 0, c2.dur);
        if (peaksArr) drawPeaksToCanvas(cv, peaksArr, waveColor);
      });
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 2 trocas**

**public/dev/ui-probe.js · troca 1 — waveWindow().** Substituir:

```js
  async function transportIds() {
```

por:

```js
  /* B7: a janela que o canvas desenhou tem de ser a do clipe. O probe não enxerga o
     closure da TIMELINE, então compara o data-win com o que o DOM sabe do clipe —
     a largura do clipe em segundos vem da escala do próprio ruler. */
  function waveWindow() {
    const out = [];
    for (const track of ['music', 'sfx']) {
      for (const cv of $$(`#bt-track-${track} .bt-clip-wave`)) {
        const el = cv.closest('.bt-clip');
        out.push({ track, idx: el && el.dataset.idx, win: cv.dataset.win || null });
      }
    }
    return { canvases: out.length, semWin: out.filter(o => !o.win).length, janelas: out };
  }
  async function transportIds() {
```

**public/dev/ui-probe.js · troca 2 — o check.** Substituir:

```js
      if (at('B7')) {
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
      }
```

por:

```js
      if (at('B7')) {
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
        const ww = waveWindow();
        add('wave-window', ww.semWin === 0, ww, { semWin: 0 });
      }
```

- [ ] **Step 4 [Executor]: Checagens** — `node jobs/checks/b7b-static.js` → `PASS: B7b estático`; `node jobs/checks/b7a-static.js` → `PASS: B7a estático`; e as seis anteriores (`b0-static`, `b1-unit`, `b2-static`, `b3-static`, `b5-static`, `b6-static`), **todas passando, sem editar nenhuma**. Reportar qualquer falha com a linha.

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 2 de `docs/plans/timeline-clip-media-bounds.md`; rodar `node jobs/checks/b7b-static.js` e as sete outras; conferir que `windowPeaks` não lê fora do array em nenhum dos casos de borda; que o teto de amostras por coluna vale mesmo (não só no caso testado); que o memo tem limite de crescimento e é limpo nas trocas de vídeo; que o portão do canvas mudou de `miniWaveCache` para `audioBufCache` sem mudar quando a waveform aparece; e que o laço de 200 colunas do arquivo inteiro foi removido do `ensureMiniWave`".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado.

```js
const r = await uiProbe.run('B7');
({ ok: r.ok, total: r.results.length, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id) })
```

Esperado: `ok: true`, `falhas: []`, com `clip-bounds` e `wave-window`.

A prova do item: dividir um clipe e ver as duas metades com janelas diferentes. Com o `hit.wav` (0,8 s, forte só nos primeiros 0,3 s), a segunda metade tem de ficar visivelmente mais baixa:

```js
T.asset('hit.wav', 0.8); T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight');
await T.add('sfx', 'hit.wav');
for (let i = 0; i < 40 && !T.clipBox('sfx', 0).win; i++) await T.sleep(100);
const inteiro = T.clipBox('sfx', 0).win;
T.key('Home'); await T.sleep(200); await T.steps(70, 'ArrowRight');   // 2,33s: dentro do clipe
await T.menu('sfx', 0, 'bt-menu-split'); await T.sleep(400);
({ inteiro, metades: [T.clipBox('sfx', 0).win, T.clipBox('sfx', 1).win] })
```

Esperado: `inteiro: "0.000,0.800"`; `metades: ["0.000,0.333", "0.333,0.467"]` (ou muito perto — o ponto de corte é o playhead, e o que importa é que a **segunda** metade começa onde a primeira termina e que as duas somam a duração original). O que este teste fixa é justamente o que confundiu o usuário no B1: antes, as duas metades desenhariam a mesma coisa.

Custo do arraste (o teto de amostras valendo em navegador de verdade), com o `bed.wav` de 10 s:

```js
T.asset('bed.wav', 10); T.key('Home'); await T.sleep(200);
await T.add('music', 'bed.wav');
for (let i = 0; i < 40 && !T.clipBox('music', 0).win; i++) await T.sleep(100);
const t0 = performance.now(); await T.trim('music', 0, 'right', -120); const dt = performance.now() - t0;
({ win: T.clipBox('music', 0).win, msDoArraste: Math.round(dt) })
```

Esperado: `win` com o `dur` novo, e o arraste concluindo sem travar a página. Restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares; `await uiProbe.run('B7')` → `ok: true`, `falhas: []`, e o teste da divisão repetido, esperando as mesmas janelas. Só regressão (spec, decisão 8). Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 da Task 4 do plano do B) + cortar um clipe de TRILHA ao meio e ver as duas metades com desenhos **diferentes**, cada uma mostrando o seu trecho; arrastar a borda esquerda de um clipe e o desenho acompanhar; e a waveform de um clipe recém-adicionado aparecer como antes, sem demora nova.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/clip-media-bounds-b`; arquivos `public/index.html`, `public/dev/ui-probe.js`, `docs/plans/timeline-clip-media-bounds.md`; commit `Draw the clip mini-waveform for the used window (B7b)`) → OK do usuário → `publish`.

---

### Task 3 (B7c): Pico sempre no `title` do clipe de SFX, e rótulo no medidor

As duas trocas de `public/index.html` são independentes das Tasks 1 e 2. As do probe **não**: a troca 2 ancora no bloco `if (at('B7'))` que a Task 1 cria, então esta task vem **depois da Task 1**. (Na spec a ordem B7c é livre; esta dependência é do instrumento de teste, não do código do app.) Duas correções de legibilidade que saíram do teste do B6.

**Files:**
- Create: `jobs/checks/b7c-static.js`
- Modify: `public/index.html` — `markSfxPeak()` e `updateMeterPeak()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `clipPeakDb()`, `SFX_PEAK_MAX`, `fmtDb()` (B6 e B5).
- Produces: `title` de clipe de SFX com o pico sempre que ele é conhecido; `#bt-meter-peak` com o prefixo literal `projeto `; check `peak-labels` no estágio `B7` do probe.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b7c-static.js`:

```js
// B7c — checagem estática dos dois rótulos. Rodar da raiz: node jobs/checks/b7c-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const probe = read('public/dev/ui-probe.js');
const fail = [];
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });

[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});
try { new Function(probe); } catch (e) { fail.push('ui-probe.js não compila: ' + e.message); }

need(src, 'index.html', [
  "    if (pk == null) el.removeAttribute('title');",
  "    else el.title = `pico ${fmtDb(pk)} dBFS` + (over ? ' — acima de −10; mantenha só se for um elemento dramático' : '');",
  "el.textContent = pk == null ? '—' : 'projeto ' + fmtDb(pk);",
]);
['if (over) el.title = `pico ${fmtDb(pk)} dBFS — acima de −10',
 "el.textContent = pk == null ? '—' : fmtDb(pk);"]
  .forEach(t => { if (src.includes(t)) fail.push('index.html — não deveria existir: ' + t); });

// o que o B6 e o B5 afirmam não pode ter mudado
need(src, 'index.html', ['mantenha só se for um elemento dramático', "el.className = 'bt-meter-peak'",
  'const SFX_PEAK_MAX = -10;']);

// markSfxPeak: a regra do title, exercitada com um elemento e um clipe falsos
{
  const m = /  function markSfxPeak\(el, c\) \{\n[\s\S]*?\n  \}\n/.exec(src);
  if (!m) fail.push('markSfxPeak não achada');
  else {
    const mk = () => { const d = { cls: new Set(), ds: {}, title: '' };
      return { dataset: d.ds, title: '', _d: d,
        classList: { toggle: (c, on) => { if (on) d.cls.add(c); else d.cls.delete(c); } },
        removeAttribute: () => { d.removed = true; } , get _cls() { return d.cls; } }; };
    const run = (pk) => {
      const el = mk();
      const f = new Function('SFX_PEAK_MAX', 'clipPeakDb', 'fmtDb',
        m[0] + '\nreturn markSfxPeak;')(-10, () => pk,
        (v) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(1).replace('.', ','));
      f(el, {});
      return { title: el.title, removed: !!el._d.removed, peak: el.dataset.peak };
    };
    const acima = run(-3.1);
    if (acima.title !== 'pico −3,1 dBFS — acima de −10; mantenha só se for um elemento dramático')
      fail.push('title acima do limiar: "' + acima.title + '"');
    const abaixo = run(-9.6);
    if (abaixo.title !== 'pico −9,6 dBFS') fail.push('title abaixo do limiar: "' + abaixo.title + '"');
    const limiar = run(-10);
    if (limiar.title !== 'pico −10,0 dBFS') fail.push('title exatamente em −10 deveria ser sem aviso: "' + limiar.title + '"');
    const semPico = run(null);
    if (!semPico.removed) fail.push('pico desconhecido deveria remover o title');
  }
}

need(probe, 'ui-probe.js', ['  function peakLabels() {', "add('peak-labels',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B7c estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b7c-static.js`. Esperado: `FAIL` com as três linhas `index.html — ausente:`, as duas linhas `não deveria existir:` (o texto antigo ainda está lá), as quatro linhas de `title` do bloco de `markSfxPeak` e as duas `ui-probe.js — ausente:`.

- [ ] **Step 2 [Executor]: `public/index.html` — 2 trocas**

**public/index.html · troca 1 — o pico no `title`, sempre.** Substituir:

```html
    if (over) el.title = `pico ${fmtDb(pk)} dBFS — acima de −10; mantenha só se for um elemento dramático`;
    else el.removeAttribute('title');
```

por:

```html
    // O pico aparece sempre que é conhecido, e a frase de aviso só acima do limiar.
    // Antes, clipe abaixo de −10 não tinha title nenhum: quem via a marca sair com meio
    // decibel de atenuação não tinha como saber que o efeito estava em −9,6 e não em −3.
    if (pk == null) el.removeAttribute('title');
    else el.title = `pico ${fmtDb(pk)} dBFS` + (over ? ' — acima de −10; mantenha só se for um elemento dramático' : '');
```

**public/index.html · troca 2 — o rótulo no número do medidor.** Substituir:

```html
    el.textContent = pk == null ? '—' : fmtDb(pk);
```

por:

```html
    // "projeto" porque este número é o pico do projeto inteiro antes do limitador — o
    // mesmo que o CONFORMAR mede —, e não uma leitura ao vivo. Sem o rótulo, um número
    // parado embaixo de uma barra que se move lê como medidor travado.
    el.textContent = pk == null ? '—' : 'projeto ' + fmtDb(pk);
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 2 trocas**

**public/dev/ui-probe.js · troca 1 — peakLabels().** Substituir:

```js
  async function transportIds() {
```

por:

```js
  /* B7: o número do medidor diz que é do projeto, e clipe de SFX com pico conhecido tem
     o pico no title mesmo quando está abaixo do limiar. */
  function peakLabels() {
    const el = $('#bt-meter-peak'), m = $('#bt-meter');
    const txt = el ? el.textContent.trim() : '';
    const comPico = m && m.dataset.peak !== '' && m.dataset.peak != null;
    const clipes = $$('#bt-track-sfx .bt-clip').map(c => ({ peak: c.dataset.peak || null, title: c.title || '' }));
    const semTitle = clipes.filter(c => c.peak && !c.title).length;
    return { texto: txt, prefixado: comPico ? /^projeto\s/.test(txt) : txt === '—', clipes: clipes.length, semTitle };
  }
  async function transportIds() {
```

**public/dev/ui-probe.js · troca 2 — o check.** Substituir:

```js
      if (at('B7')) {
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
```

por:

```js
      if (at('B7')) {
        const pl = peakLabels();
        add('peak-labels', pl.prefixado && pl.semTitle === 0, pl, { prefixado: true, semTitle: 0 });
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
```

- [ ] **Step 4 [Executor]: Checagens** — `node jobs/checks/b7c-static.js` → `PASS: B7c estático`, e todas as outras passando sem edição: `b0-static`, `b1-unit`, `b2-static`, `b3-static`, `b5-static`, `b6-static`, `b7a-static`, `b7b-static`. Reportar qualquer falha com a linha.

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 3 de `docs/plans/timeline-clip-media-bounds.md`; rodar `node jobs/checks/b7c-static.js` e as sete outras; conferir que a frase de aviso do B6 não mudou de texto; que `−10` exato não é tratado como acima do limiar (a regra do B6 é `> SFX_PEAK_MAX`); que o `data-peak` e as classes de zona do medidor não mudaram, porque são o que as checagens do B5 e do B6 leem; e que o `—` de 'sem pico' não ganhou prefixo".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado.

```js
const r = await uiProbe.run('B7');
T.asset('hit.wav', 0.8); T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight');
await T.add('sfx', 'hit.wav');
const el = () => document.querySelector('#bt-track-sfx .bt-clip[data-idx="0"]');
for (let i = 0; i < 30 && !('peak' in el().dataset); i++) await T.sleep(100);
const inp = el().querySelector('.bt-clip-vol');
const t = [];
for (const v of [0, -6.5, -7, -20]) { inp.value = String(v); inp.dispatchEvent(new Event('input')); await T.sleep(120);
  t.push({ slider: v, peak: el().dataset.peak, over: el().classList.contains('over'), title: el().title }); }
({ probe: { ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id) },
   medidor: document.getElementById('bt-meter-peak').textContent, sweep: t })
```

Esperado: `falhas: []`, com `peak-labels` entre os checks; `medidor` começando em `projeto `; e a varredura mostrando o `title` **presente nos quatro valores**, com a frase de aviso só nos dois primeiros:

| slider | `peak` | `over` | `title` |
| --- | --- | --- | --- |
| 0 | `-3.1` | `true` | `pico −3,1 dBFS — acima de −10; mantenha só se for um elemento dramático` |
| −6,5 | `-9.6` | `true` | `pico −9,6 dBFS — acima de −10; mantenha só se for um elemento dramático` |
| −7 | `-10.1` | `false` | `pico −10,1 dBFS` |
| −20 | `-23.1` | `false` | `pico −23,1 dBFS` |

É exatamente a varredura que o usuário não conseguiu interpretar no teste do B6, agora legível no `title`. Restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares; `await uiProbe.run('B7')` → `ok: true`, `falhas: []`. Só regressão. Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 da Task 4 do plano do B) + passar o mouse num efeito **abaixo** de −10 e ler o pico no `title`; baixar o slider de um efeito marcado e ver o número do `title` acompanhar até a marca sair; e o número embaixo do medidor dizendo `projeto` antes do valor, sem prefixo quando está em `—`.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/clip-media-bounds-c`; arquivos `public/index.html`, `public/dev/ui-probe.js`, `docs/plans/timeline-clip-media-bounds.md`; commit `Always show clip peak in title, label the master meter (B7c)`) → OK do usuário → `publish`.

---

## Verificação

### Task 1 (B7a) — 2026-09-24

**Duas checagens anteriores falharam, e a culpa é do plano, não da execução.** Eu havia escrito em `## Global Constraints` que as seis passariam porque desenhei as trocas como aditivas. Auditei só as âncoras de **texto** e esqueci dois outros tipos de asserção:

1. `b2-static.js` exigia `count(src, 'renderSfxTrack()') === 7`; o `ensureMediaDur` re-renderiza as três tracks e fez 8. Primeiro troquei por um piso (`< 7`); o validador apontou que isso **enfraquece** a checagem — deixaria passar duplicação acidental de uma chamada de render num caminho quente, contra a restrição de custo por frame. Aceitei: voltou a ser igualdade, agora em 8, com comentário explicando a composição do número.
2. `b6-static.js` fixava o literal `const ORDER = [… 'B6'];` fechado. É o mesmo problema que já derrubou `b2-static` e `b5-static` no B5, onde passei a ancorar no prefixo — mas o `b6-static` nasceu depois, do meu próprio texto, repetindo o erro. Agora ancora no prefixo também. O validador conferiu e não considerou enfraquecimento: é a convenção já aceita para asserção que cresce por natureza.

A linha de `## Global Constraints` foi corrigida: auditar os **três** tipos antes de cada task — âncora de texto, contagem e literal de lista.

**Validator (Step 6):** APROVADO, sem achados bloqueantes no código, com as sete checagens rodadas em contexto limpo. Diff = as 9 + 3 trocas do plano, literais; nada em `lib/`, `server.js` ou no sidecar. Conferido por leitura: `mediaDurOf` devolvendo `null` para `'pending'`, para zero e para ausente; `200` com JSON sem `duration` caindo em `null`; `ensureMediaDur` sem caminho que lance, e a guarda `mediaDur.has(path)` + `set('pending')` síncrono fechando tanto chamadas concorrentes no mesmo tick quanto o ciclo com os `render*Track()` que ele mesmo dispara (o validador rastreou a volta inteira e ela termina em uma); a trava fora do closure de `onMove`, com os três limites (`DURATION`, vizinho do B-ROLL, mídia) convivendo por `Math.min` sucessivo; `overflowSec` limitando a `c.dur` e tratando `srcIn` ausente como 0; e a sobreposição com `pointer-events:none` dentro do `overflow:hidden` do clipe.

**Contrato da rota, medido antes da validação** (não suposto): `POST /api/probe` devolve `200` com `{"duration":0.8,…}` para `hit.wav`; **`500`** com `{"error":…}` tanto para `nao-midia.txt` quanto para caminho inexistente. Os dois casos de falha caem no mesmo ramo, e o `r.ok` do `ensureMediaDur` é o discriminador correto.

**Falha do plano no Step 7:** o script fabricava o clipe longo com `SFX[0].dur = 4` no console. `SFX` vive no IIFE da TIMELINE (linhas 1296–3952) e não é alcançável de lá. Troquei por montar o sidecar com o clipe longo e abrir o projeto — teste de fidelidade maior, porque é o caminho real de um projeto salvo antes desta trava.

**Achado do Step 7, que mudou a fórmula da trava.** Com `hi = Math.min(hi, origStart + (md - origSrcIn))`, pegar a borda direita de um clipe legado de 4 s sobre um arquivo de 0,8 s levava o clipe de 240 px para 48 px num arraste de 60 px: a trava apagava 3,2 s no primeiro movimento. Isso contraria a decisão 4 da spec (não mexer em projeto salvo sem o usuário pedir). Levei ao usuário com as duas saídas e ele escolheu a **B**: o teto passa a ser `Math.max(origEnd, origStart + (md - origSrcIn))` — impede crescer, deixa encurtar, e volta a ser o fim da mídia assim que o clipe cabe. Aplicado no código, no texto da troca 9 do plano, na âncora do `b7a-static.js` e na seção da spec.

**Rota Player (Step 7), depois da mudança:**
- `await uiProbe.run('B7')` → `ok: true`, `falhas: []`, 23 checks, com `clip-bounds`.
- **A trava, com controle de que o arraste funciona:** num `whoosh.wav` de 0,8 s, esticar 400 px não moveu a borda; encurtar respondeu (48 → 28 px); esticar de volta parou em **exatamente 48 px**, o fim do arquivo.
- **Clipe legado aberto do sidecar** (4 s sobre 0,8 s): 240 px com 192 px de excesso — 0,80 da largura, que é 3,2 s de 4 s —, borda tracejada e `pointer-events: none`.
- **O ciclo de vida completo do clipe legado:** tentar crescer 60 px → fica em 240 px (não cresce); encurtar 60 → 180 px com 132 de excesso; mais 60 → 120 px com 72; mais 80 → 40 px e **excesso 0** (cruzou o fim da mídia, marcação sumiu); daí esticar 400 px → 48 px, o fim do arquivo, e o mesmo resultado ao repetir. O excesso encurta 1:1 com o clipe, e a catraca é de mão única.
- **Arquivo que não é mídia** (`nao-midia.txt`): o clipe entra com os 3 s padrão, sem marcação, **sem erro no console**, e a borda direita continua esticando livre (180 → 300 px) — o guardrail de "`null` nunca bloqueia edição" valendo.

**Rota canvas (Step 8):** bloqueio de `/vendor/studio-player.js` ligado pelo usuário; `rota: "canvas"` e `window.StudioPlayer` indefinido, confirmados. `await uiProbe.run('B7')` → `ok: true`, `falhas: []`, 23 checks. Confirmação extra da trava nesta rota, para não depender só do probe: num `whoosh.wav` de 0,8 s, esticar 400 px manteve o clipe em 48 px e encurtar 25 px respondeu (48 → 23 px). A etapa não toca nenhuma das duas engines de preview, então isso é regressão, não ciclo completo (spec, decisão 8). Sidecar da fixture restaurado.

**Teste no vídeo do usuário, a pedido dele.** Montei um sidecar de teste em `output/assembled-9680c0370b29.mp4` (19 MB, 6,3 s, sidecar com só um corte — os dois projetos com B-ROLL e trilha de verdade eu não toquei), com backup em `jobs/b-check/assembled-9680c0370b29.beats.json.ORIGINAL`. Dois clipes legados do mesmo `whoosh.wav` de 0,8 s: um na SFX desenhado com 3,0 s e um na TRILHA com 2,5 s. Medido: marcação inicial em 0,73 e 0,68 da largura, batendo com os 2,2 s e 1,7 s de excesso previstos, as duas tracejadas; tentar crescer 200 px não moveu nenhum dos dois; encurtar 60 px derrubou o excesso exatamente 60 px em cada (1:1 com o clipe); ao cruzar o fim do áudio a marcação sumiu nos dois; e esticar 300 px levou **ambos a 48 px** — as duas tracks param no mesmo lugar porque usam o mesmo arquivo, o que prova que a trava lê a mídia e não algo do clipe. Sidecar do usuário restaurado e conferido byte a byte contra o backup.

**Checklist manual (Step 9):** os itens 1–12 do sub-projeto A foram **dispensados pelo usuário** ("não quero passar os olhos novamente no sub-projeto A de antes"). Os itens próprios do B7a foram exercitados por mim no navegador, nas duas rotas e no vídeo do próprio usuário, com os números acima. Fica registrado que esta task não teve conferência humana de regressão do A.

### Task 2 (B7b) — 2026-09-24

**Auditoria antes de despachar, e ela funcionou.** Aplicando a regra que a Task 1 me ensinou, auditei os três tipos de asserção das checagens existentes contra o que esta task muda, e previ ao executor que as oito passariam. Passaram, de primeira, sem editar nenhuma — a primeira vez em quatro tasks que isso acontece. Nenhuma checagem ancorava os textos que esta task mexe (o comentário da declaração de `miniWaveCache`, o laço de 200 colunas, o portão do canvas, o bloco de desenho), e nenhuma contagem muda: `renderSfxTrack()` fica em 8, `scheduleMaster()` em 7, `mediaDur.clear();` em 1.

**Erro meu na prosa do Step 1:** eu havia escrito que as duas linhas `não deveria existir:` não apareceriam no FAIL inicial, com uma justificativa que explicava justamente por que elas apareceriam — o laço antigo ainda está no arquivo antes da troca 3, e o check acusa presença. O executor confrontou a prosa com a saída real em vez de aceitá-la. Prosa corrigida; a checagem nunca esteve errada.

**Achado do validator (Step 6), corrigido: o teto de amostras não era um teto.** Com `step = max(1, floor(amostras / 256))`, o passo fica em 1 quando a coluna tem entre 256 e 511 amostras, e aí não reduz nada. O validador mediu: uma janela de 2,3 s a 44,1 kHz com 200 colunas lia **101.430** amostras contra o teto nominal de 51.400 — o dobro. Pior: os dois tamanhos que eu pus na checagem (1 s e 600 s) escapam exatamente dessa faixa, um por ficar abaixo do limiar e o outro por ser múltiplo grande, então ela não pegava. Corrigido com `ceil` em vez de `floor`, o que torna as leituras por coluna `ceil(amostras / passo) ≤ 256` para qualquer tamanho.

Verifiquei que o teste agora morde, extraindo a função do arquivo nas duas formas e contando as leituras com um `Proxy`:

| janela | com `floor` (antes) | com `ceil` (agora) |
| --- | --- | --- |
| 1 s | 44.100 | 44.100 |
| **2,3 s** | **101.430 — estoura** | 50.800 |
| 10 min | 51.400 | 51.200 |

Teto: 51.400. Os dois casos antigos passam nas duas versões, o que confirma que a checagem era cega exatamente onde importava. Ela ganhou o caso de 2,3 s, e código, plano e spec foram alinhados.

**Resto da validação:** APROVADO. O validador exercitou `windowPeaks` além dos casos do check (`cols=0`, `cols=1`, `dur=NaN`, `srcIn=NaN`, valores em 1e9, janela terminando exatamente no fim do buffer) — nenhum lançou, nenhum leu fora de `[0, data.length)`, com a prova geométrica de que todo índice cai em `[a, b) ⊂ [0, data.length)`. Confirmou o limite de 300 do memo e a limpeza no `clearMediaCache`, e avaliou que limpar o memo inteiro ao estourar é aceitável. Confirmou que nenhum ponto do arquivo ainda espera `Float32Array` do `miniWaveCache`, que a guarda contra decode duplo segue valendo, e que o portão do canvas não mudou o **momento** em que a waveform aparece, porque `audioBufCache` e `miniWaveCache` são preenchidas na mesma sequência síncrona.

**Rota Player (Step 7):**
- `await uiProbe.run('B7')` → `ok: true`, `falhas: []`, 24 checks, com `wave-window`.
- **O item que originou a etapa inteira.** Clipe de `hit.wav` inteiro: janela `0.000,0.800`. Dividido em 2,33 s: `0.000,0.333` e `0.333,0.467` — somam 0,800 exatos e emendam, a segunda começando onde a primeira termina. Antes desta task as duas metades desenhariam `0.000,0.800`, idênticas: era isso que fazia parecer que o áudio não tinha sido cortado.
- **Prova nos pixels, não só no gancho de teste.** Densidade de tinta no canvas: 0,6129 na primeira metade contra 0,0968 na segunda — **6,3× mais cheia**, exatamente o formato do `hit.wav` (forte nos primeiros 0,3 s, baixo depois).
- **Custo do arraste:** um arraste em 308 ms e oito em 2.484 ms, dominados pelas esperas do próprio auxiliar de teste (300 ms por arraste); nenhum travamento. O memo erra em todo frame de propósito, e é o teto que mantém isso barato.

**Rota canvas (Step 8):** bloqueio de `/vendor/studio-player.js` ligado pelo usuário; `rota: "canvas"` confirmada. `await uiProbe.run('B7')` → `ok: true`, `falhas: []`, 24 checks. O teste da divisão repetido nesta rota deu **valor por valor o mesmo resultado**, inclusive na medição de pixels: janelas `0.000,0.333` e `0.333,0.467`, soma 0,800, e densidades de tinta 0,6129 e 0,0968 com razão 6,33 — os mesmos números da rota Player. Era o esperado, porque a waveform é canvas e DOM, sem passar por nenhuma das duas engines de preview. Sidecar da fixture restaurado.

**Checklist manual (Step 9):** o usuário testou e reportou "tudo funcionando corretamente", depois de eu listar os itens próprios desta task — clipe de TRILHA cortado ao meio mostrando desenhos diferentes em cada metade, a borda esquerda com o desenho acompanhando, e clipe recém-adicionado sem demora nova. Ele não especificou se percorreu também os itens 1–12 do sub-projeto A, que havia dispensado na Task 1; fica registrado assim, sem presumir. O item da borda esquerda era justamente o que eu não conseguia afirmar bem por medição automática, porque arrastar ali muda `srcIn` e `dur` juntos e o olho pega melhor que o número se o desenho escorrega.


---

## Status

Seção do executor. Vazia até a primeira execução.

### Task 1 (B7a) — 2026-09-24 (Executor, Steps 1–5)

Executado sobre a `main` local em `1d4bd60` (working tree limpo). Steps 1–4 concluídos; Step 5 (este) atualiza o Status e para.

**Step 1 — `jobs/checks/b7a-static.js` salvo (cópia literal do plano) e rodado antes das trocas:**

```
FAIL
index.html — ausente: .bt-clip-over{position:absolute; top:0; bottom:0; right:0; z-index:0; pointer-events:none;
index.html — ausente: const mediaDur = new Map();
index.html — ausente:   function mediaDurOf(path) {
index.html — ausente:   async function ensureMediaDur(path) {
index.html — ausente:       body: JSON.stringify({ input: path }) });
index.html — ausente:   function overflowSec(c, md) {
index.html — ausente: mediaDur.set(path, info && info.duration > 0 ? info.duration : null);
index.html — ausente: if (![...BROLL, ...MUSIC, ...SFX].some(c => c.path === path)) mediaDur.delete(path);
index.html — ausente: mediaDur.clear();
index.html — ausente: if (asset.info && asset.info.duration > 0) mediaDur.set(asset.path, asset.info.duration);
index.html — ausente: ensureMediaDur(c.path);
index.html — ausente: const ovSec = overflowSec(c, mediaDurOf(c.path));
index.html — ausente: class="bt-clip-over"
index.html — ausente: const md = mediaDurOf(c.path);
index.html — ausente: if (md) hi = Math.min(hi, origStart + (md - origSrcIn));
ensureMediaDur deveria ser chamado 1× no markup do clipe
mediaDur.clear() deveria aparecer 1× (clearMediaCache)
overflowSec não achada
hi-uma-vez: a trava da mídia deveria estar antes do onMove, não dentro dele
ui-probe.js — ausente: const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6', 'B7'];
ui-probe.js — ausente:   function clipBounds() {
ui-probe.js — ausente: add('clip-bounds',
```

(`exitCode 1`) — as 15 linhas `index.html — ausente:` do primeiro bloco, as duas linhas de contagem, `overflowSec não achada`, `hi-uma-vez: …` e as três linhas `ui-probe.js — ausente:`, exatamente como o plano previa. Conferido à parte: as **duas** linhas do segundo `need` (as que `b5-static` e `b6-static` fixam — `plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();` e a linha do `audioBufCache.delete`) **não** apareceram no FAIL, confirmando que já existiam antes das trocas.

**Steps 2 e 3 — as trocas aplicadas na ordem do plano:** `public/index.html` (9 trocas — CSS `.bt-clip-over`; comentário + `const mediaDur = new Map()`; `mediaDurOf`/`ensureMediaDur`/`overflowSec`; limpeza por caminho em `pruneMediaCache()`, aditiva; limpeza total em `clearMediaCache()`, aditiva; semeadura em `addClipFromAsset`; `ensureMediaDur(c.path)`/`overMark` no markup do clipe em `renderClipTrack()`; `${overMark}` no HTML do clipe; trava do trim direito em `startClipTrim()`, antes do `onMove`); `public/dev/ui-probe.js` (3 trocas — `B7` no `ORDER`; `clipBounds()`; check `clip-bounds` no `at('B7')`). Todas as âncoras casaram em exatamente 1 ocorrência antes de cada edição — nenhuma trocada às cegas.

**Step 4 — checagens depois das trocas:**

```
$ node jobs/checks/b7a-static.js
PASS: B7a estático

$ node jobs/checks/b0-static.js
PASS: B0 estático

$ node jobs/checks/b1-unit.js
PASS: B1 unidade

$ node jobs/checks/b2-static.js
FAIL
renderSfxTrack() deveria aparecer 7× (1 definição + 6 chamadas), achado 8

$ node jobs/checks/b3-static.js
PASS: B3 estático

$ node jobs/checks/b5-static.js
PASS: B5 estático

$ node jobs/checks/b6-static.js
FAIL
ui-probe.js — ausente: const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6'];
```

Quatro das seis checagens anteriores passaram (`b0-static`, `b1-unit`, `b3-static`, `b5-static`) — as duas que o plano citava por nome como desenhadas para continuar passando (`b5-static`, `b6-static`) não bateram 2 de 2: `b5-static` passou, `b6-static` não. As duas falhas, reportadas sem editar nenhuma checagem:

- **`b2-static`** — a âncora `if (count(src, 'renderSfxTrack()') !== 7) …` (linha 57 de `jobs/checks/b2-static.js`) exige exatamente 7 ocorrências de `renderSfxTrack()` (1 definição + 6 chamadas). A troca 3 do Step 2 desta task (`ensureMediaDur`), copiada literalmente do plano, acrescenta uma 7ª chamada (`renderBrollTrack(); renderMusicTrack(); renderSfxTrack();` dentro de `ensureMediaDur`), levando a contagem a 8. A troca é aditiva no sentido de não reescrever nenhuma linha existente, mas o número de chamadas que `b2-static` fixa como invariante deixou de bater.
- **`b6-static`** — a âncora `need(probe, 'ui-probe.js', ["const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6'];", …])` (linha 59 de `jobs/checks/b6-static.js`) exige a string exata do array `ORDER` terminando em `'B6'`. A troca 1 do Step 3 desta task, também copiada literalmente do plano, substitui essa linha pela mesma lista com `, 'B7'` acrescentado ao fim — string diferente da que `b6-static` procura, então essa âncora deixa de casar.

Ambas as falhas vêm de trocas que o plano especifica literalmente (não de decisão do executor); nenhuma checagem foi editada. Fica para o Orquestrador decidir se `b2-static`/`b6-static` devem ser atualizadas (ex.: `renderSfxTrack()` para 8×, `ORDER` com `'B7'`) ou se a Task 1 deve mudar.

**`git diff --stat` (arquivos rastreados; `jobs/checks/b7a-static.js` não aparece — `jobs/` é gitignored):**

```
public/dev/ui-probe.js | 22 ++++++++++++++++-
public/index.html      | 65 +++++++++++++++++++++++++++++++++++++++++++++++++-
2 files changed, 85 insertions(+), 2 deletions(-)
```

9 hunks em `public/index.html` e 3 em `public/dev/ui-probe.js` (`git diff | grep -c '^@@'` por arquivo), batendo 1:1 com as 9 + 3 trocas dos Steps 2 e 3 — nenhuma trocaram caiu no mesmo hunk de outra. `git status --short` mostra só `M public/dev/ui-probe.js` e `M public/index.html`; nada em `lib/`, `server.js` ou no sidecar tocado; nenhum commit criado; nenhuma branch trocada. CRLF preservado nos dois arquivos (conferido por contagem de bytes antes e depois das trocas: todo `\n` continua precedido de `\r`).

Nenhum desvio das instruções de trocas — as duas falhas acima são resultado de aplicar o plano literalmente, não de improviso do executor. Parando no Step 5 conforme instruído; Steps 6–10 (validator, rota Player, rota canvas, checklist manual, git-workflow) ficam para o Orquestrador.

### Task 2 (B7b) — 2026-09-24 (Executor, Steps 1–5)

Executado sobre a `main` local em `9ad6dfc` (working tree limpo, Task 1 já mergeada no PR #28). Steps 1–4 concluídos; Step 5 (este) atualiza o Status e para.

**Step 1 — `jobs/checks/b7b-static.js` salvo (cópia literal do plano) e rodado antes das trocas:**

```
FAIL
index.html — ausente: const MINI_COLS = 200;
index.html — ausente: const MINI_MAX_PER_COL = 256;
index.html — ausente: const winPeakCache = new Map();
index.html — ausente:   function windowPeaks(buf, srcIn, dur, cols) {
index.html — ausente:   function windowPeaksCached(path, srcIn, dur) {
index.html — ausente: if (winPeakCache.size > 300) winPeakCache.clear();
index.html — ausente: miniWaveCache.set(path, true);
index.html — ausente: if (audioBufCache.get(c.path) instanceof AudioBuffer) media =
index.html — ausente: data-win="${(c.srcIn || 0).toFixed(3)},${c.dur.toFixed(3)}"
index.html — ausente: const peaksArr = windowPeaksCached(c2.path, c2.srcIn || 0, c2.dur);
index.html — ausente: winPeakCache.clear();
index.html — não deveria existir: const cols = 200, spc = Math.max(1, Math.floor(data.length / cols));
index.html — não deveria existir: miniWaveCache.set(path, p);
winPeakCache.clear() deveria aparecer 2× (memo cheio e clearMediaCache)
windowPeaks não achada
ui-probe.js — ausente:   function waveWindow() {
ui-probe.js — ausente: add('wave-window',
```

(`exitCode 1`) — as onze linhas `index.html — ausente:`, a linha de contagem do `winPeakCache.clear()`, `windowPeaks não achada` e as duas linhas `ui-probe.js — ausente:` bateram exatamente com o previsto no plano. **Divergência encontrada e reportada, não corrigida:** o plano previa que as duas linhas `índex.html — não deveria existir:` (o laço de 200 colunas e `miniWaveCache.set(path, p);`) **não** apareceriam nesse FAIL ("o laço antigo ainda está lá, e é a Task 2 que o remove"). Elas apareceram — e é o comportamento correto do check: antes da troca 3 do Step 2, esse laço ainda está de fato em `ensureMiniWave()` (confirmado por grep, 1 ocorrência literal), então `if (src.includes(t)) fail.push(...)` dispara como esperado pela própria lógica do check. A prosa do plano parece estar invertida nesse trecho — o mesmo tipo de furo de auditoria já relatado na Task 1, desta vez na narrativa do "esperado" do Step 1, não numa âncora de troca. Não editei o check nem o plano além desta seção de Status; registrando para o Orquestrador decidir. As **duas** linhas do segundo `need` (as que `b5-static`/`b6-static` fixam) não apareceram, como previsto.

**Steps 2 e 3 — as 6 trocas em `public/index.html` e as 2 em `public/dev/ui-probe.js`, na ordem do plano.** Todas as âncoras foram conferidas por grep antes de cada edição e casaram em exatamente 1 ocorrência — nenhuma trocada às cegas. `public/index.html`: comentário da declaração de `miniWaveCache`; bloco `MINI_COLS`/`MINI_MAX_PER_COL`/`winPeakCache`/`windowPeaks`/`windowPeaksCached` antes de `drawPeaksToCanvas()`; `ensureMiniWave()` trocando o laço de 200 colunas por `miniWaveCache.set(path, true);`; `winPeakCache.clear();` em `clearMediaCache()`; portão do canvas de `miniWaveCache` para `audioBufCache` com `data-win`; laço de desenho em `renderClipTrack()` chamando `windowPeaksCached`. `public/dev/ui-probe.js`: função `waveWindow()` antes de `transportIds()`; check `wave-window` no bloco `at('B7')`.

**Step 4 — checagens depois das trocas, todas passando, nenhuma editada:**

```
$ node jobs/checks/b7b-static.js
PASS: B7b estático

$ node jobs/checks/b7a-static.js
PASS: B7a estático

$ node jobs/checks/b0-static.js
PASS: B0 estático

$ node jobs/checks/b1-unit.js
PASS: B1 unidade

$ node jobs/checks/b2-static.js
PASS: B2 estático

$ node jobs/checks/b3-static.js
PASS: B3 estático

$ node jobs/checks/b5-static.js
PASS: B5 estático

$ node jobs/checks/b6-static.js
PASS: B6 estático
```

As oito checagens passaram de primeira — `b2-static` e `b6-static` já vinham corrigidas do fechamento da Task 1 (8× para `renderSfxTrack()`, prefixo do `ORDER` sem exigir o fim exato da lista), e nenhuma troca desta task mexeu em contagens fixas ou em literais de lista.

**`git diff --stat` (arquivos rastreados; `jobs/checks/b7b-static.js` não aparece — `jobs/` é gitignored):**

```
public/dev/ui-probe.js | 15 +++++++++++
public/index.html      | 72 +++++++++++++++++++++++++++++++++++++++++---------
2 files changed, 74 insertions(+), 13 deletions(-)
```

2 hunks em `public/dev/ui-probe.js` e 6 em `public/index.html` (`git diff | grep -c '^@@'` por arquivo), batendo 1:1 com as 2 + 6 trocas dos Steps 2 e 3. `git status --short` mostra só `M public/dev/ui-probe.js` e `M public/index.html`; nada em `lib/`, `server.js` ou no sidecar tocado; nenhum commit criado; nenhuma branch trocada. CRLF preservado nos dois arquivos (contagem de bytes: todo `\n` continua precedido de `\r` nos dois — `LF total == CRLF` para cada arquivo, zero LF solto).

Único desvio: a divergência do Step 1 relatada acima, na prosa do "esperado" do plano, não em código ou em critério de aceite. Nenhuma checagem foi editada. Parando no Step 5 conforme instruído; Steps 6–10 (validator, rota Player, rota canvas, checklist manual, git-workflow) ficam para o Orquestrador.
