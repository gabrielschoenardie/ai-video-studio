# UI Premium da TIMELINE (sub-projeto A) — Implementation Plan

> **Para workers agênticos:** este plano segue o fluxo do `CLAUDE.md` — Orquestrador → subagente `executor` → subagente `validator` → `git-workflow`. **Uma task por invocação do executor**, na ordem 1 → 5. Steps usam checkbox (`- [ ]`). Steps marcados **[Orquestrador]** ou **[Usuário]** não são do executor: o executor para no último step marcado **[Executor]** e atualiza `## Status`.

**Goal:** Elevar a TIMELINE (passo 04) de `public/index.html` a editor de desktop premium — alvos de clique com folga, piso tipográfico, contraste, controles de track com estado, timecode no playhead, transporte agrupado, atalhos descobríveis e movimento tokenizado — sem quebrar nada que funciona hoje.

**Architecture:** Cinco estágios, um commit cada. E0 cria o instrumento de medição (`public/dev/ui-probe.js`) e grava o baseline do app atual. E1 é refatoração que precisa ser **pixel-idêntica** ao baseline (tokens com os valores de hoje). E2 muda valores (fonte, contraste, densidade). E3a e E3b acrescentam componentes. Nada fora de `public/index.html`, `public/dev/ui-probe.js` e uma rota estática em `server.js`.

**Tech Stack:** HTML/CSS/JS vanilla num único arquivo (`public/index.html`, sem build), Node ≥18 sem npm (`server.js`), Chrome (probe de runtime).

**Spec:** `docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md` — o executor lê a spec antes da Task 1. Números de linha citados aqui referem-se ao commit `3f47ec9`; **localize sempre pelo trecho de código citado**, não pelo número, porque cada task desloca as linhas das seguintes.

## Global Constraints

- Zero npm. A única mudança em `server.js` é a rota estática `GET /dev/*.js` (Task 1).
- Não tocar `lib/*`, `remotion/`, `public/vendor/`, `styles/`. Sem rebuild do bundle do Player.
- Não alterar a lógica de: handlers de arraste (`start*`, `on*MouseDown`), `wireTracks`, `saveBeats`, `doConform`, formato do sidecar, `seekTo`, o `switch` de teclado. Exceções exatas, todas na Task 5: `seekTo` ganha o parâmetro opcional `opts`; quatro chamadas passam `{ animate: true }` (`onRulerMouseDown`, `case 'Home'`, `case 'End'`, `.bt-legend-row` onclick); o handler de `keydown` ganha o guard `dialog[open]` na primeira linha.
- Nenhum `id` existente muda de nome.
- Conteúdo das lanes LEGENDA (`.bt-word`), ÁUDIO (waveform) e TRILHA (`.bt-clip.music`) visualmente igual.
- `@media (prefers-reduced-motion: reduce)` global (`index.html:56-61`) permanece; nenhuma animação/transição nova com duração literal — só `var(--dur-1..4)`.
- `localStorage`: só a chave nova `studio.density`, todo acesso em `try/catch`.
- Desktop apenas: nenhum breakpoint de telefone, `pointer:coarse`, gesto de toque ou alvo de 44px.
- O executor **não commita**. Git só via `git-workflow`, com aprovação do usuário entre fases.
- Condições de medição do probe: `node server.js`, janela com viewport 1280×800, URL `http://localhost:4870/?probe=1`, fixture `output/assembled-4545f906507a.mp4` (tem `jobs/4545f906507a/transcript.json`), carregada por `await uiProbe.load('output/assembled-4545f906507a.mp4')` logo após recarregar a página, sem outras ações antes de `uiProbe.run(...)`.

## File Structure

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `server.js` | + rota estática `/dev/*.js` (allowlist por regex, espelho de `/vendor/`) | 1 |
| `public/dev/ui-probe.js` (novo) | Instrumento de medição DOM/CSSOM; `window.uiProbe.{load,run}` | 1 (cria), Orquestrador grava `BASELINE` |
| `public/index.html` | Loader do probe; tokens; tipografia; contraste; densidade; ícones de track; timecode; transporte; folha de atalhos; microinterações | 1–5 |

## Checklist manual de regressão (referenciado pelas tasks 2–5)

Com a fixture carregada na TIMELINE, **nas duas densidades a partir da Task 3**:

1. Preview toca.
2. Espaço, J/K/L, `,`/`.`.
3. Beats: arrastar, trim, `S`, `M`, `R`.
4. B-ROLL: adicionar, mover, trim. TRILHA: adicionar, ajustar volume.
5. VÍDEO: split, trim, reordenar, deletar com ripple.
6. Ctrl+roda, `+`/`−`/FIT, scroll horizontal — playhead alinhado com a régua.
7. Redimensionar altura de track.
8. H/L/M/S refletem no preview.
9. Undo/redo.
10. SALVAR BEATS → recarregar a página → carregar beats.
11. CONFORMAR → EXPORT conclui e o arquivo chega ao EXPORT.
12. Rota canvas: DevTools → Network → *Block request URL* `/vendor/studio-player.js`, recarregar, repetir 1, 2 e 6.

---

### Task 0: Preparo (Orquestrador, antes de qualquer execução)

- [ ] **[Orquestrador]** Invocar `git-workflow` fase 1 com a tarefa explícita: criar a branch `feat/ui-premium-timeline` a partir de `main` e propor staging de `docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md` + `docs/plans/ui-premium-timeline.md`.
- [ ] **[Usuário]** Aprovar → fase 2 (commit `Add design spec and plan for TIMELINE premium UI (sub-project A)`).
- [ ] **[Orquestrador]** Só então invocar o `executor` para a Task 1.

---

### Task 1 (E0): Rota `/dev/`, loader e probe; gravar baseline

**Files:**
- Modify: `server.js` — junto de `const VENDOR_DIR` (`:32`) e logo após o bloco da rota `/vendor/` (`:191-198`)
- Modify: `public/index.html` — `<head>`, antes do comentário `<!-- Player da TIMELINE` (`:9`)
- Create: `public/dev/ui-probe.js`

**Interfaces:**
- Consumes: globais existentes `window.addAsset(asset)`, `window.goStep(step)`; DOM `#bt-visual`, `#step-beats`, `#bt-inner`, `.bt-transport`, `#bt-time`, `#bt-zoomlevel`, `#bt-playhead`, `#bt-ruler`, `.bt-tracks-top`, `.bt-track-row[data-track]`, `.bt-track-label`, `.bt-tctl[data-act]`.
- Produces: `window.__probeErrors: string[]` (só com `?probe`); `window.uiProbe.load(path): Promise<boolean>`; `window.uiProbe.run(stage: 'E0'|'E1'|'E2'|'E3a'|'E3b'): Promise<{stage, ok, results, snapshot}>`. Tasks 3–5 introduzem, e o probe já consulta: `#density-toggle`, `.bt-playhead-tc`, `.bt-tgroup`, `.bt-kbd`, `#bt-play .lbl`, `#shortcuts-btn`, `dialog#shortcuts-sheet`, `.sc-row`, `window.SHORTCUTS`.

- [ ] **Step 1 [Executor]: Rodar a checagem estática e confirmar que falha**

```bash
node - <<'NODE'
const fs = require('fs');
const fail = [];
const srv = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
if (!srv.includes("const DEV_DIR = path.join(ROOT, 'public', 'dev');")) fail.push('server.js: DEV_DIR ausente');
if (!srv.includes('const mDev = ') || !srv.includes('dev\\/([A-Za-z0-9._-]+')) fail.push('server.js: regex da rota /dev/ ausente');
if (!srv.includes('abs.startsWith(DEV_DIR + path.sep)')) fail.push('server.js: guarda startsWith(DEV_DIR + path.sep) ausente');
if (!/has\('probe'\)/.test(html)) fail.push('index.html: loader ?probe ausente');
if (!html.includes("'/dev/ui-probe.js'")) fail.push('index.html: loader não injeta /dev/ui-probe.js');
if (!fs.existsSync('public/dev/ui-probe.js')) fail.push('public/dev/ui-probe.js ausente');
else if (!/const BASELINE = /.test(fs.readFileSync('public/dev/ui-probe.js', 'utf8'))) fail.push('ui-probe.js: BASELINE ausente');
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('index.html: <script> inline #' + k + ' não compila: ' + e.message); }
});
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: Task 1 estático');
process.exitCode = fail.length ? 1 : 0;
NODE
```

Expected: `FAIL` com 6 linhas (DEV_DIR, regex, startsWith, loader, injeção do script, arquivo ausente).

- [ ] **Step 2 [Executor]: Rota estática `/dev/` em `server.js`**

Logo abaixo de `const VENDOR_DIR = path.join(ROOT, 'public', 'vendor');` acrescentar:

```js
// Instrumentos de desenvolvimento (probe de UI). Mesmo regime de /vendor/:
// arquivo versionado, servido por allowlist, nunca path vindo do cliente.
const DEV_DIR = path.join(ROOT, 'public', 'dev');
```

Logo após o fechamento do bloco `if (req.method === 'GET' && mVendor) { ... }` acrescentar:

```js
    // Probe de UI (public/dev/). Mesma allowlist por regex do /vendor/: o nome
    // casado não contém '/', então '..' nunca vira segmento de traversal.
    const mDev = /^\/dev\/([A-Za-z0-9._-]+\.js)$/.exec(p);
    if (req.method === 'GET' && mDev) {
      const abs = path.resolve(DEV_DIR, mDev[1]);
      if (!abs.startsWith(DEV_DIR + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(req, res, abs);
    }
```

- [ ] **Step 3 [Executor]: Loader no `<head>` de `public/index.html`**

Imediatamente antes da linha `<!-- Player da TIMELINE (bundle buildado em remotion/, commitado). Ausente ou` inserir (ajuste sobre a spec: fica no `<head>`, e não antes do script principal, para o coletor de erros já estar ativo quando o bundle e o script principal rodarem):

```html
<script>
/* Probe de UI (docs/plans/ui-premium-timeline.md). Inerte sem ?probe na URL.
   O coletor de erros entra antes de qualquer outro script para contar tudo. */
if (new URLSearchParams(location.search).has('probe')) {
  window.__probeErrors = [];
  addEventListener('error', e => window.__probeErrors.push(String(e.message || e.type)));
  addEventListener('unhandledrejection', e => window.__probeErrors.push(String((e.reason && e.reason.message) || e.reason)));
  const s = document.createElement('script');
  s.src = '/dev/ui-probe.js';
  document.head.appendChild(s);
}
</script>

- [ ] **Step 4 [Executor]: Criar `public/dev/ui-probe.js` com exatamente este conteúdo**

```js
/* ui-probe.js — instrumento de medição do sub-projeto A (UI da TIMELINE).
   Plano: docs/plans/ui-premium-timeline.md
   Spec:  docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md
   Carregado só com ?probe na URL (loader no <head> de public/index.html).
   Só lê DOM/CSSOM — não enxerga o closure da TIMELINE. Uso, no console:
     await uiProbe.load('output/assembled-4545f906507a.mp4')
     await uiProbe.run('E1')
   Checks que alteram estado (controles de track, densidade, play, folha de
   atalhos) desfazem o que fizeram; o de play move o playhead ~1s. */
(function () {
  'use strict';

  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b'];
  // Isentos do piso de 11px: dado desenhado em escala de tempo (spec, decisão 2).
  const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music'];
  // Classes de estado mudam com playhead/seleção e não dizem nada sobre fonte.
  const STATE_CLASSES = new Set(['on', 'active', 'selected', 'hidden', 'locked', 'done', 'run', 'err',
    'dragging', 'flip', 'hot', 'over', 'enter', 'collapsed', 'bt-enter', 'bt-split', 'bt-seek']);
  // Loops de ambiente: não são resposta a ação, mantêm duração literal.
  const AMBIENT = /\b(drift|blink|bt-pulse)\b/;
  const TIME_LITERAL = /(?:^|[\s,(])(\d*\.?\d+m?s)(?![\w-])/g;
  const TRACK_ORDER = ['beats', 'broll', 'video', 'legend', 'audio', 'music'];
  const TRANSPORT_IDS = ['bt-play', 'bt-time', 'bt-rate', 'bt-j', 'bt-k', 'bt-l', 'bt-frameback',
    'bt-frameforward', 'bt-markin', 'bt-markout', 'bt-split', 'bt-merge', 'bt-rename', 'bt-undo',
    'bt-redo', 'bt-zoomout', 'bt-zoomlevel', 'bt-zoomin', 'bt-zoomfit', 'bt-save', 'bt-conform'];
  const TOGGLE_ACTS = ['hide', 'lock', 'mute', 'solo'];

  // Preenchido pelo Orquestrador na Task 1 com o JSON impresso por run('E0'). Não editar à mão.
  const BASELINE = null;

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function waitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('[uiProbe] timeout esperando a TIMELINE');
  }
  function timelineReady() {
    const step = document.getElementById('step-beats');
    return !!(step && step.classList.contains('on') && $('#bt-inner') && $('.bt-transport'));
  }

  /* ---------------- carregar a fixture ---------------- */
  async function load(path) {
    if (typeof window.addAsset !== 'function' || typeof window.goStep !== 'function')
      throw new Error('[uiProbe] addAsset/goStep não encontrados no escopo global');
    const sel = document.getElementById('bt-visual');
    if (![...sel.options].some(o => o.value === path))
      window.addAsset({ path, name: path.split(/[\\/]/).pop(), kind: 'video', source: 'probe' });
    window.goStep('beats');
    sel.value = path;
    sel.dispatchEvent(new Event('change'));
    await waitFor(() => $('#bt-track-legend .bt-word, #bt-track-legend .empty'), 30000);
    await sleep(500);
    return timelineReady();
  }

  /* ---------------- medições que não alteram estado ---------------- */
  function signature(el) {
    const cls = [...el.classList].filter(c => !STATE_CLASSES.has(c)).sort().join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  }
  function textFloor() {
    const offenders = new Set(), exempt = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!(size < 11)) continue;
      const ex = EXEMPT_TEXT.find(sel => el.closest(sel));
      if (ex) exempt.add(ex + '@' + size); else offenders.add(signature(el) + '@' + size);
    }
    return { offenders: [...offenders].sort(), exempt: [...exempt].sort() };
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast() {
    const out = {};
    for (const fg of ['--faint', '--dim']) for (const bg of ['--bg', '--panel', '--panel2']) {
      const a = hexRgb(cssVar(fg)), b = hexRgb(cssVar(bg));
      if (!a || !b) { out[fg + '/' + bg] = null; continue; }
      const la = luminance(a), lb = luminance(b);
      out[fg + '/' + bg] = round((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
    }
    return out;
  }
  function ariaLive() { return $$('[aria-live]').length; }
  function consoleErrors() { return (window.__probeErrors || []).slice(); }
  function motionLiterals() {
    const hits = new Set();
    const scan = (where, text) => {
      if (!text || AMBIENT.test(text)) return;
      if ([...text.matchAll(TIME_LITERAL)].some(m => parseFloat(m[1]) > 0)) hits.add(where + ' → ' + text);
    };
    const walk = rules => {
      for (const r of rules) {
        if (r.conditionText && /prefers-reduced-motion/.test(r.conditionText)) continue;
        if (r.style) {
          const text = ['transition', 'transition-duration', 'animation', 'animation-duration']
            .map(p => r.style.getPropertyValue(p)).filter(Boolean).join(' | ');
          scan(r.selectorText || r.keyText || '@rule', text);
        }
        if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // folha cross-origin (Google Fonts)
      walk(rules);
    }
    for (const el of $$('[style]'))
      scan(signature(el) + ' [style]', [el.style.transition, el.style.animation].filter(Boolean).join(' | '));
    return [...hits];
  }
  function tapTargets() {
    const h = $$('.bt-tbtn').map(e => e.getBoundingClientRect().height);
    const s = $$('.bt-tctl').map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });
    return { tbtnMinH: h.length ? round(Math.min(...h), 1) : null, tctlMinSide: s.length ? round(Math.min(...s), 1) : null };
  }
  function transportOverflow() { const t = $('.bt-transport'); return t.scrollWidth > t.clientWidth; }
  function trackOrder() { return $$('.bt-track-row').map(r => r.dataset.track); }
  function labelTruncate() {
    const bad = [];
    for (const row of $$('.bt-track-row')) {
      const label = $('.bt-track-label', row), nm = label && $('.nm', label);
      if (!label) continue;
      if (label.scrollWidth > label.clientWidth || (nm && nm.scrollWidth > nm.clientWidth)) bad.push(row.dataset.track);
    }
    return bad;
  }
  function parseTimecode(s) { const m = /(\d+):(\d+(?:\.\d+)?)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 0; }
  function labelwSync() {
    const token = parseFloat(cssVar('--bt-labelw'));
    const label = round($('.bt-track-label').getBoundingClientRect().width, 1);
    const ruler = round(parseFloat(getComputedStyle($('#bt-ruler')).marginLeft), 1);
    // left do playhead deve ser labelw + t·px. t vem de #bt-time (0,1s); px do readout de zoom (100% = 60 px/s).
    const time = $('#bt-time');
    const t = parseTimecode(time && time.firstChild ? time.firstChild.textContent : '');
    const px = 60 * parseFloat($('#bt-zoomlevel').textContent) / 100;
    const base = Number.isFinite(token) ? token : label;
    const delta = Math.abs(parseFloat($('#bt-playhead').style.left) - (base + t * px));
    return { token: Number.isFinite(token) ? token : null, label, ruler,
      playheadDelta: round(delta, 1), tolerance: round(px * 0.05 + 1, 1) };
  }
  function syncOk(s) {
    return !!s && s.token != null && Math.abs(s.label - s.token) <= 0.5 &&
      Math.abs(s.ruler - s.token) <= 0.5 && s.playheadDelta <= s.tolerance;
  }
  function markersAboveRuler() {
    const top = $('.bt-tracks-top'), ruler = $('#bt-ruler');
    return !!(top && ruler && (top.compareDocumentPosition(ruler) & Node.DOCUMENT_POSITION_FOLLOWING));
  }
  function playhead() {
    const all = $$('.bt-playhead');
    const h = all[0] ? all[0].getBoundingClientRect().height : 0;
    return { count: all.length, heightDelta: round(Math.abs(h - $('#bt-inner').getBoundingClientRect().height), 1) };
  }
  function tctl() {
    const all = $$('.bt-tctl');
    return {
      count: all.length,
      missingLabel: all.filter(b => !b.getAttribute('aria-label')).length,
      withText: all.filter(b => b.textContent.trim()).length,
      missingPressed: all.filter(b => b.dataset.act !== 'add' && !b.hasAttribute('aria-pressed')).length,
    };
  }
  function playheadTc() {
    const tc = $('.bt-playhead-tc'), time = $('#bt-time');
    return { chip: tc ? tc.textContent.trim() : null,
      time: time && time.firstChild ? time.firstChild.textContent.trim() : null };
  }

  /* ---------------- medições que alteram estado (e desfazem) ---------------- */
  function tctlToggles() {
    const bad = [];
    for (const btn of $$('.bt-tctl').filter(b => TOGGLE_ACTS.includes(b.dataset.act))) {
      const before = btn.getAttribute('aria-pressed');
      btn.click();
      const flipped = btn.getAttribute('aria-pressed') === String(before !== 'true');
      btn.click();
      if (!flipped || btn.getAttribute('aria-pressed') !== before) bad.push(btn.getAttribute('aria-label'));
    }
    return bad;
  }
  async function density() {
    const btn = document.getElementById('density-toggle');
    if (!btn) return null;
    const root = document.documentElement;
    const startComfy = root.dataset.density === 'comfortable';
    const measure = () => ({ tap: tapTargets(), truncated: labelTruncate(), sync: labelwSync(), overflow: transportOverflow() });
    const out = {};
    if (startComfy) { btn.click(); await sleep(80); }
    out.compact = measure();
    btn.click(); await sleep(80);
    out.comfortable = measure();
    if (!startComfy) { btn.click(); await sleep(80); }
    return out;
  }
  async function transportIds() {
    const missing = TRANSPORT_IDS.filter(id => !document.getElementById(id));
    const ungrouped = TRANSPORT_IDS.filter(id => {
      const el = document.getElementById(id);
      return el && !el.closest('.bt-tgroup');
    });
    const play = document.getElementById('bt-play');
    const kbdKept = [], playLabels = [];
    if (play) for (let i = 0; i < 2; i++) {
      play.click();
      await sleep(600);
      kbdKept.push(!!$('.bt-kbd', play));
      const lbl = $('.lbl', play);
      playLabels.push(lbl ? lbl.textContent : null);
    }
    return { missing, ungrouped, kbdKept, playLabels };
  }
  async function shortcutSheet() {
    const dlg = document.getElementById('shortcuts-sheet'), opener = document.getElementById('shortcuts-btn');
    if (!dlg || !opener) return { present: false };
    opener.focus();
    opener.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await sleep(80);
    const opened = dlg.open, modal = dlg.matches(':modal');
    const rows = $$('.sc-row', dlg).length, expected = (window.SHORTCUTS || []).length;
    if (dlg.open) dlg.close();
    await sleep(80);
    return { present: true, opened, modal, rows, expected, focusReturned: document.activeElement === opener };
  }

  /* ---------------- execução ---------------- */
  async function run(stage) {
    if (!ORDER.includes(stage)) throw new Error('[uiProbe] estágio inválido: ' + stage + ' — use ' + ORDER.join(' | '));
    const at = s => ORDER.indexOf(stage) >= ORDER.indexOf(s);
    const tl = timelineReady();
    if (window.innerWidth !== 1280) console.warn('[uiProbe] viewport ' + window.innerWidth + 'px — a referência é 1280px');
    if (!tl) console.warn('[uiProbe] TIMELINE não visível — rode `await uiProbe.load(<vídeo>)`. Checks da TIMELINE darão SKIP.');

    const snap = { textFloor: textFloor(), contrast: contrast(), ariaLive: ariaLive(),
      motionLiterals: motionLiterals(), consoleErrors: consoleErrors() };
    if (tl) Object.assign(snap, { tapTargets: tapTargets(), transportOverflow: transportOverflow(),
      trackOrder: trackOrder(), labelTruncate: labelTruncate(), labelwSync: labelwSync(),
      markersAboveRuler: markersAboveRuler(), playhead: playhead(), tctl: tctl() });

    if (stage === 'E0') {
      console.log('[uiProbe] E0 — baseline. Grave este JSON em BASELINE (public/dev/ui-probe.js):');
      console.log(JSON.stringify(snap));
      return { stage, ok: true, results: [], snapshot: snap };
    }

    const R = [];
    const add = (id, ok, measured, expected, note) =>
      R.push({ id, status: ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL', measured, expected, note: note || '' });
    const b = BASELINE || {};
    if (!BASELINE) add('baseline', false, null, 'BASELINE gravado', 'rode run("E0") no app antes das mudanças');

    if (at('E2')) add('text-floor', snap.textFloor.offenders.length === 0 && same(snap.textFloor.exempt, (b.textFloor || {}).exempt),
      snap.textFloor, { offenders: [], exempt: (b.textFloor || {}).exempt });
    else add('text-floor', same(snap.textFloor, b.textFloor), snap.textFloor, b.textFloor);

    const ratios = Object.values(snap.contrast).filter(v => v != null);
    if (at('E2')) add('contrast', ratios.length === 6 && Math.min(...ratios) >= 4.5, snap.contrast, '≥ 4.5 nos 6 pares');
    else add('contrast', same(snap.contrast, b.contrast), snap.contrast, b.contrast);

    add('aria-live', snap.ariaLive === 1, snap.ariaLive, 1);
    add('motion-literals', snap.motionLiterals.length === 0, snap.motionLiterals, []);
    add('console-errors', snap.consoleErrors.length === 0, snap.consoleErrors, []);

    if (!tl) {
      ['tap-targets', 'transport-overflow', 'track-order', 'label-truncate', 'labelw-sync',
        'markers-above-ruler', 'playhead', 'tctl-a11y'].forEach(id => add(id, null, null, null, 'TIMELINE não carregada'));
    } else {
      if (!at('E2')) add('tap-targets', same(snap.tapTargets, b.tapTargets), snap.tapTargets, b.tapTargets);
      if (at('E2')) add('transport-overflow', snap.transportOverflow === false, snap.transportOverflow, false);
      else add('transport-overflow', snap.transportOverflow === b.transportOverflow, snap.transportOverflow, b.transportOverflow);
      add('track-order', same(snap.trackOrder, TRACK_ORDER), snap.trackOrder, TRACK_ORDER);
      if (at('E2')) add('label-truncate', snap.labelTruncate.length === 0, snap.labelTruncate, []);
      else add('label-truncate', same(snap.labelTruncate, b.labelTruncate), snap.labelTruncate, b.labelTruncate);
      add('labelw-sync', syncOk(snap.labelwSync), snap.labelwSync, 'token = rótulo = margin-left da régua; playheadDelta ≤ tolerance');
      add('markers-above-ruler', snap.markersAboveRuler === true, snap.markersAboveRuler, true);
      add('playhead', snap.playhead.count === 1 && snap.playhead.heightDelta <= 1, snap.playhead, { count: 1, heightDelta: '≤ 1' });

      const t = snap.tctl;
      if (at('E3a')) {
        const failed = tctlToggles();
        add('tctl-a11y', t.count >= 15 && t.missingLabel === 0 && t.withText === 0 && t.missingPressed === 0 && failed.length === 0,
          Object.assign({}, t, { togglesFailed: failed }),
          { count: '≥ 15', missingLabel: 0, withText: 0, missingPressed: 0, togglesFailed: [] });
      } else {
        const bt = b.tctl || {};
        add('tctl-a11y', t.count === bt.count && t.missingLabel === 0 && t.withText === bt.withText, t,
          { count: bt.count, missingLabel: 0, withText: bt.withText });
      }

      if (at('E2')) {
        const d = await density();
        const want = { compact: [30, 24], comfortable: [36, 28] };
        const ok = !!d && ['compact', 'comfortable'].every(k =>
          d[k].tap.tbtnMinH === want[k][0] && d[k].tap.tctlMinSide === want[k][1] &&
          d[k].truncated.length === 0 && syncOk(d[k].sync) && (!at('E3b') || d[k].overflow === false));
        add('density', ok, d, { compact: 'tbtn 30 · tctl 24', comfortable: 'tbtn 36 · tctl 28',
          truncated: [], sync: 'ok', overflow: at('E3b') ? false : 'não avaliado' });
      }
      if (at('E3a')) {
        const p = playheadTc();
        add('playhead-tc', !!p.chip && p.chip === p.time, p, 'chip === texto corrente de #bt-time');
      }
      if (at('E3b')) {
        const ti = await transportIds();
        add('transport-ids', ti.missing.length === 0 && ti.ungrouped.length === 0 && ti.kbdKept.length === 2 && ti.kbdKept.every(Boolean),
          ti, { missing: [], ungrouped: [], kbdKept: [true, true] },
          ti.playLabels[0] !== '❚❚' ? 'o play não trocou o rótulo — o vídeo da fixture toca neste navegador?' : '');
        const sc = await shortcutSheet();
        add('shortcut-sheet', sc.present && sc.opened && sc.modal && sc.expected > 0 && sc.rows === sc.expected && sc.focusReturned,
          sc, { opened: true, modal: true, rows: 'SHORTCUTS.length', focusReturned: true });
      }
    }

    for (const r of R)
      console.log(r.status.padEnd(4) + ' ' + r.id + ' — medido: ' + JSON.stringify(r.measured) +
        ' · esperado: ' + JSON.stringify(r.expected) + (r.note ? ' · ' + r.note : ''));
    console.table(R.map(r => ({ id: r.id, status: r.status, note: r.note })));
    const ok = R.every(r => r.status !== 'FAIL');
    console.log('[uiProbe] ' + stage + ': ' + (ok ? 'PASS' : 'FAIL') + ' (' + R.filter(r => r.status === 'FAIL').length + ' falha(s))');
    return { stage, ok, results: R, snapshot: snap };
  }

  window.uiProbe = { load, run };
  console.info('[uiProbe] carregado — await uiProbe.load(<vídeo>); await uiProbe.run("E0"…"E3b")');
})();
```

- [ ] **Step 5 [Executor]: Checagem estática, sintaxe e HTTP**

Rodar de novo o script do Step 1. Expected: `PASS: Task 1 estático`.

```bash
node --check server.js && node --check public/dev/ui-probe.js && echo SYNTAX-OK
```

Expected: `SYNTAX-OK`.

```bash
PORT=4899 node server.js > /dev/null 2>&1 &
SRV=$!
sleep 2
for u in /dev/ui-probe.js /dev/nope.js "/dev/..%2Fserver.js" /dev/ui-probe.txt; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:4899$u")" "$u"
done
curl -s "http://127.0.0.1:4899/" | grep -c "has('probe')"
kill $SRV
```

Expected, nesta ordem: `200 /dev/ui-probe.js`, `404 /dev/nope.js`, `404 /dev/..%2Fserver.js`, `404 /dev/ui-probe.txt`, e `1`.

- [ ] **Step 6 [Executor]: Atualizar `## Status`** com os comandos dos Steps 1 e 5 e suas saídas. Parar aqui.

- [ ] **Step 7 [Orquestrador]: `validator`** — tarefa: "validar a Task 1 de `docs/plans/ui-premium-timeline.md` contra o diff; rodar os scripts dos Steps 1 e 5; conferir path-safety da rota `/dev/`".

- [ ] **Step 8 [Orquestrador]: Gravar o baseline**
  1. Com o app **como está no `main`** exceto os arquivos desta task (a rota e o loader não mudam nada visível), rodar `node server.js`, abrir `http://localhost:4870/?probe=1` via Chrome com viewport 1280×800.
  2. `await uiProbe.load('output/assembled-4545f906507a.mp4')` → deve retornar `true`.
  3. `await uiProbe.run('E0')` → copiar a linha JSON impressa.
  4. Substituir `const BASELINE = null;` por `const BASELINE = <JSON>;` em `public/dev/ui-probe.js` (edição de dado).
  5. Recarregar, repetir 2 e rodar `await uiProbe.run('E1')` **ainda sem a Task 2**: tudo deve dar PASS exceto `labelw-sync` (token ausente) e `motion-literals` (29 literais). Isso prova que o probe é estável entre recargas. Registrar os dois resultados em `## Verificação`.

- [ ] **Step 9 [Orquestrador → Usuário]: `git-workflow`** fase 1 (staging: `server.js`, `public/index.html`, `public/dev/ui-probe.js`) → aprovação → fase 2 (commit `Add UI probe and /dev/ static route (TIMELINE premium, E0)`) → aprovação → fase 3 só se o usuário pedir push.

---

### Task 2 (E1): Tokenização sem mudança visual

**Regra da task: nenhum pixel muda.** Toda substituição abaixo troca um literal por um token com o mesmo valor (ou, nas durações, ≤ 50ms de diferença).

**Files:**
- Modify: `public/index.html` — `:root` (`:14-26`); regras `nav button` (`:101-106`), `.step.on` (`:127`), `input[type=text]…` (`:147-151`), `.btn` (`:160-169`), `.btn::after` (`:170-174`), `.drop` (`:190-195`), `.asset` (`:200-202`), `.asset button` (`:207-208`), `aside` (`:225-228`), `#prog i` (`:256-258`), `.bt-tbtn` (`:299-301`), `.bt-ruler` (`:331`), `.bt-ruler-corner` (`:333`), `.bt-track-label` (`:346-348`), `.bt-tctl` (`:351-353`), `.bt-tbtn,.bt-tctl,.bt-toggle` (`:451`), `.bt-beat` (`:453`), `.bt-pop` (`:456`), `.bt-legend-row` (`:464`); closure da TIMELINE: declaração após `let built = false;` (`:1149`), `zoomAt` (`:1264`), `fitToWindow` (`:1273`), `buildDom` (`:1630`), `renderRuler` (`:1802`), `renderPlayhead` (`:2193`), `renderInOut` (`:2201`), `showSnapGuide` (`:2426`), marcadores de drop de beat (`:2749`) e de VÍDEO (`:2798`).

**Interfaces:**
- Consumes: nada de tasks anteriores (o probe da Task 1 só mede).
- Produces: tokens CSS `--bt-labelw`, `--tap`, `--tap-sm`, `--gap-ctl`, `--dur-1`…`--dur-4`, `--ease-out`, `--ease-in-out`, `--ease-spring`; no closure da TIMELINE, `let LABEL_W` e `function readLabelW()` (consumidos pelas Tasks 3 e 4).

- [ ] **Step 1 [Executor]: Rodar a checagem estática e confirmar que falha**

```bash
node - <<'NODE'
const fs = require('fs');
const src = fs.readFileSync('public/index.html', 'utf8');
const lines = src.split('\n');
const fail = [];
lines.forEach((l, i) => {
  if (!/(^|[^\d.])192(?!\d)/.test(l) || /--bt-labelw:192px/.test(l) || /let LABEL_W = 192;/.test(l)) return;
  fail.push('192 literal em :' + (i + 1) + ': ' + l.trim());
});
for (const t of ['--bt-labelw:192px;', '--tap:30px;', '--tap-sm:24px;', '--gap-ctl:2px;', '--dur-1:150ms;',
  '--dur-2:200ms;', '--dur-3:300ms;', '--dur-4:450ms;', '--ease-out:cubic-bezier(.16,1,.3,1);',
  '--ease-in-out:cubic-bezier(.65,0,.35,1);', '--ease-spring:cubic-bezier(.34,1.56,.64,1);'])
  if (!src.includes(t)) fail.push('token ausente: ' + t);
lines.forEach((l, i) => {
  if (!/(transition|animation)[\w-]*\s*:/.test(l)) return;
  if (/\b(drift|blink|bt-pulse)\b/.test(l) || /\.001ms/.test(l)) return;
  if (/(^|[\s,(:])\d*\.?\d+m?s(?![\w-])/.test(l.replace(/var\(--dur-\d\)/g, ''))) fail.push('duração literal em :' + (i + 1) + ': ' + l.trim());
});
const need = [
  [/\.bt-tbtn\{[^}]*height:calc\(var\(--tap\) - 2px\)/, '.bt-tbtn sem height:calc(var(--tap) - 2px)'],
  [/\.bt-tctl\{[^}]*width:var\(--tap-sm\); height:var\(--tap-sm\)/, '.bt-tctl sem --tap-sm'],
  [/\.bt-track-label\{[^}]*width:var\(--bt-labelw\)/, '.bt-track-label sem width:var(--bt-labelw)'],
  [/\.bt-track-label\{[^}]*gap:var\(--gap-ctl\)/, '.bt-track-label sem gap:var(--gap-ctl)'],
  [/\.bt-ruler\{[^}]*margin-left:var\(--bt-labelw\)/, '.bt-ruler sem margin-left:var(--bt-labelw)'],
  [/\.bt-ruler-corner\{[^}]*left:calc\(-1 \* var\(--bt-labelw\)\)[^}]*width:var\(--bt-labelw\)/, '.bt-ruler-corner sem --bt-labelw'],
  [/function readLabelW\(\) \{/, 'readLabelW() ausente'],
  [/function buildDom\(\) \{\s*readLabelW\(\);/, 'buildDom() não chama readLabelW() primeiro'],
];
for (const [re, msg] of need) if (!re.test(src)) fail.push(msg);
const uses = (src.match(/LABEL_W \+ /g) || []).length + (src.match(/clientWidth - LABEL_W/g) || []).length;
if (uses !== 8) fail.push('esperado 8 usos de LABEL_W no lugar de 192, achados ' + uses);
if (/--fs-/.test(src)) fail.push('--fs-* apareceu (é da Task 3)');
[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: Task 2 estático');
process.exitCode = fail.length ? 1 : 0;
NODE
```

Expected: `FAIL` com os 11 `192` literais, os 11 tokens ausentes, as 15 linhas de duração literal e os itens de `need`.

- [ ] **Step 2 [Executor]: Tokens no `:root`**

Logo abaixo da linha `  --glow-go:0 0 18px rgba(251,191,36,.35);` inserir:

```css
  /* Largura da coluna de rótulos da TIMELINE. O JS lê este valor (readLabelW)
     em vez de repetir o número: mudar aqui move régua, rótulos e playhead juntos. */
  --bt-labelw:192px;
  /* Alvos da TIMELINE. --tap é a altura RENDERIZADA do .bt-tbtn (borda inclusa). */
  --tap:30px; --tap-sm:24px; --gap-ctl:2px;
  /* Movimento: transição/animação de resposta a ação usa só estes tokens. Valores
     casados com as durações que já existiam, para a tokenização não mudar o timing. */
  --dur-1:150ms; --dur-2:200ms; --dur-3:300ms; --dur-4:450ms;
  --ease-out:cubic-bezier(.16,1,.3,1);
  --ease-in-out:cubic-bezier(.65,0,.35,1);
  --ease-spring:cubic-bezier(.34,1.56,.64,1);
```

- [ ] **Step 3 [Executor]: Consumidores de `--bt-labelw`, `--tap`, `--tap-sm`, `--gap-ctl`**

| Regra | Trecho atual | Vira |
|---|---|---|
| `.bt-tbtn` | `min-width:30px; height:28px; padding:0 8px;` | `min-width:30px; height:calc(var(--tap) - 2px); padding:0 8px;` |
| `.bt-ruler` | `margin-left:192px;` | `margin-left:var(--bt-labelw);` |
| `.bt-ruler-corner` | `left:-192px; top:var(--bt-markers-h,0px); width:192px;` | `left:calc(-1 * var(--bt-labelw)); top:var(--bt-markers-h,0px); width:var(--bt-labelw);` |
| `.bt-track-label` | `width:192px; flex:0 0 auto;` | `width:var(--bt-labelw); flex:0 0 auto;` |
| `.bt-track-label` | `display:flex; align-items:center; gap:2px; padding:0 3px;` | `display:flex; align-items:center; gap:var(--gap-ctl); padding:0 3px;` |
| `.bt-tctl` | `width:24px; height:24px; border-radius:3px;` | `width:var(--tap-sm); height:var(--tap-sm); border-radius:3px;` |

Imediatamente acima da regra `.bt-tbtn{all:unset; …` inserir o comentário:

```css
/* all:unset deixa o botão em content-box com borda de 1px: a altura renderizada
   é height + 2px, daí calc(var(--tap) - 2px). Não usar border-box aqui: mudaria
   também o min-width e encolheria os botões de um caractere de 48 para 30px. */
```

- [ ] **Step 4 [Executor]: Durações → tokens (15 declarações, 29 literais)**

| Regra | Trecho atual | Vira |
|---|---|---|
| `nav button` | `transition:color .18s, background .18s;` | `transition:color var(--dur-2), background var(--dur-2);` |
| `.step.on` | `animation:rise .28s ease both` | `animation:rise var(--dur-3) ease both` |
| `input[type=text],…` | `transition:border-color .18s, box-shadow .18s;` | `transition:border-color var(--dur-2), box-shadow var(--dur-2);` |
| `.btn` | `transition:transform .16s, filter .16s, box-shadow .16s;` | `transition:transform var(--dur-1), filter var(--dur-1), box-shadow var(--dur-1);` |
| `.btn::after` | `transition:transform .5s ease;` | `transition:transform var(--dur-4) ease;` |
| `.drop` | `transition:border-color .2s, color .2s, background .2s, transform .2s;` | `transition:border-color var(--dur-2), color var(--dur-2), background var(--dur-2), transform var(--dur-2);` |
| `.asset` | `transition:border-color .18s, background .18s}` | `transition:border-color var(--dur-2), background var(--dur-2)}` |
| `.asset button` | `transition:background .15s}` | `transition:background var(--dur-1)}` |
| `aside` | `transition:height .2s ease}` | `transition:height var(--dur-2) ease}` |
| `#prog i` | `transition:width .4s ease}` | `transition:width var(--dur-4) ease}` |
| `.bt-tctl` | `transition:color .15s ease, background .15s ease}` | `transition:color var(--dur-1) ease, background var(--dur-1) ease}` |
| `.bt-tbtn,.bt-tctl,.bt-toggle` | `transition:color .15s ease,border-color .15s ease,box-shadow .15s ease}` | `transition:color var(--dur-1) ease,border-color var(--dur-1) ease,box-shadow var(--dur-1) ease}` |
| `.bt-beat` | `transition:transform .15s ease,filter .15s ease,box-shadow .15s ease}` | `transition:transform var(--dur-1) ease,filter var(--dur-1) ease,box-shadow var(--dur-1) ease}` |
| `.bt-pop` | `transition:transform .16s ease,opacity .16s ease}` | `transition:transform var(--dur-1) ease,opacity var(--dur-1) ease}` |
| `.bt-legend-row` | `transition:background .15s ease}` | `transition:background var(--dur-1) ease}` |

Não tocar: `animation:drift 26s …`, `animation:blink 1.4s …`, `animation:blink 1.2s …`, `animation:bt-pulse 1.6s …`, e o bloco `prefers-reduced-motion`.

- [ ] **Step 5 [Executor]: `LABEL_W` no closure da TIMELINE**

Logo abaixo de `  let built = false;` inserir:

```js
  /* Largura da coluna de rótulos, em px. A fonte da verdade é o token CSS
     --bt-labelw (que muda com a densidade); aqui fica em cache porque
     renderPlayhead roda por frame e getComputedStyle ali forçaria recálculo. */
  let LABEL_W = 192;
  function readLabelW() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bt-labelw'));
    if (v > 0) LABEL_W = v;
  }
```

Em `function buildDom() {`, a primeira linha do corpo passa a ser `    readLabelW();` (antes de `const r = $('#bt-root');`).

Substituições (8):

| Função | Trecho atual | Vira |
|---|---|---|
| `zoomAt` | `scrollEl.scrollLeft = (192 + timeToX(t)) - (clientX - rect.left);` | `scrollEl.scrollLeft = (LABEL_W + timeToX(t)) - (clientX - rect.left);` |
| `fitToWindow` | `const avail = scrollEl.clientWidth - 192;` | `const avail = scrollEl.clientWidth - LABEL_W;` |
| `renderRuler` | `$q('#bt-inner').style.width = (192 + w) + 'px';` | `$q('#bt-inner').style.width = (LABEL_W + w) + 'px';` |
| `renderPlayhead` | `ph.style.left = (192 + timeToX(playhead)) + 'px';` | `ph.style.left = (LABEL_W + timeToX(playhead)) + 'px';` |
| `renderInOut` | `el.style.left = (192 + timeToX(a)) + 'px';` | `el.style.left = (LABEL_W + timeToX(a)) + 'px';` |
| `showSnapGuide` | `snapGuideEl.style.left = (192 + timeToX(t)) + 'px';` | `snapGuideEl.style.left = (LABEL_W + timeToX(t)) + 'px';` |
| drop de beat (`const beatsTrack = $q('#bt-track-beats');` logo acima) | `marker.style.left = (192 + timeToX(acc)) + 'px';` | `marker.style.left = (LABEL_W + timeToX(acc)) + 'px';` |
| drop de VÍDEO (`const row = $q('#bt-track-video');` logo acima) | `marker.style.left = (192 + timeToX(acc)) + 'px';` | `marker.style.left = (LABEL_W + timeToX(acc)) + 'px';` |

Não tocar em `(S.position.y / 1920)` de `updatePreviewOverlay`.

- [ ] **Step 6 [Executor]: Checagem estática** — rodar o script do Step 1. Expected: `PASS: Task 2 estático`.

- [ ] **Step 7 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 6. Parar aqui.

- [ ] **Step 8 [Orquestrador]: `validator`** — "validar a Task 2 de `docs/plans/ui-premium-timeline.md`; rodar o script do Step 1; confirmar que o diff só troca literais por tokens, sem outra alteração de valor".

- [ ] **Step 9 [Orquestrador]: Probe** — recarregar `?probe=1`, `await uiProbe.load('output/assembled-4545f906507a.mp4')`, `await uiProbe.run('E1')`. Expected: `[uiProbe] E1: PASS (0 falha(s))` — em particular `text-floor`, `contrast`, `tap-targets`, `label-truncate`, `tctl-a11y` **idênticos ao baseline**, `labelw-sync` PASS, `motion-literals` `[]`. Repetir `load` + `run('E1')` com o bundle bloqueado (rota canvas). Registrar em `## Verificação`.

- [ ] **Step 10 [Usuário]: Checklist manual de regressão** (itens 1–12).

- [ ] **Step 11 [Orquestrador → Usuário]: `git-workflow`** fase 1 (staging: `public/index.html`) → aprovação → fase 2 (commit `Tokenize TIMELINE label width, targets and motion durations (E1, no visual change)`).

---

### Task 3 (E2): Piso tipográfico, contraste e densidade

**Files:**
- Modify: `public/index.html` — `<head>` (script de densidade), `:root`, bloco novo `html[data-density="comfortable"]`, `.tag` + `.hdr-btn` novo, `.btn[disabled]`, as 57 declarações de fonte da tabela do Step 4, `<header>` (botão), script global (IIFE do toggle, após a IIFE do `#side-toggle`), closure da TIMELINE (listener `studio:density`, antes de `/* ---------------- keyboard shortcuts (scoped to #step-beats.on)`).

**Interfaces:**
- Consumes: `LABEL_W`, `readLabelW()`, `renderTracks()`, `built` (closure da TIMELINE, Task 2); tokens `--tap`, `--tap-sm`, `--gap-ctl`, `--bt-labelw`, `--dur-1` (Task 2).
- Produces: tokens `--fs-micro`, `--fs-sm`, `--fs-body`, `--fs-lead`, `--disabled-bg`; atributo `html[data-density="comfortable"]`; chave `localStorage` `studio.density` (`'comfortable'|'compact'`); evento `document` `studio:density`; `button#density-toggle.hdr-btn[aria-pressed]`; classe `.hdr-btn` (reusada na Task 5).

**Ajustes sobre a spec, decididos aqui:**
- O botão de densidade tem **texto fixo** `DENSIDADE CONFORTÁVEL` e o estado vai em `aria-pressed` + cor âmbar. Trocar o texto junto com `aria-pressed` repetiria o problema que a spec evitou nos controles de track (estado anunciado duas vezes).
- Não há override `.bt-clip.music .tag`: clipes de TRILHA não renderizam `.tag` (só VÍDEO renderiza, `renderVideoTrack`). Só `.bt-clip.music .nm` precisa de isenção.
- `.bt-beat .lbl` e `.bt-beat .dur` ganham `line-height:1.3`: a 11px com o `1.6` herdado do `body`, as duas linhas (35px) não cabem nos 34px internos do beat numa linha de 44px.

- [ ] **Step 1 [Executor]: Rodar a checagem estática e confirmar que falha**

```bash
node - <<'NODE'
const fs = require('fs');
const src = fs.readFileSync('public/index.html', 'utf8');
const lines = src.split('\n');
const fail = [];
for (const t of ['--fs-micro:11px;', '--fs-sm:12.5px;', '--fs-body:13.5px;', '--fs-lead:15px;', '--faint:#7b80ad;',
  '--disabled-bg:#5c6190;', '--bt-labelw:204px;',
  'html[data-density="comfortable"]{--tap:36px; --tap-sm:28px; --gap-ctl:4px; --bt-labelw:248px}',
  '.btn[disabled]{background:var(--disabled-bg);', 'id="density-toggle"', "localStorage.getItem('studio.density')",
  "localStorage.setItem('studio.density'", "new CustomEvent('studio:density')", "addEventListener('studio:density'"])
  if (!src.includes(t)) fail.push('ausente: ' + t);
if (!/\.bt-beat \.lbl\{font:700 var\(--fs-micro\)\/1\.3 /.test(src)) fail.push('.bt-beat .lbl sem --fs-micro/1.3');
if (!/\.bt-beat \.dur\{font:400 var\(--fs-micro\)\/1\.3 /.test(src)) fail.push('.bt-beat .dur sem --fs-micro/1.3');
if (!/\.bt-clip\.music \.nm\{font-size:9\.5px\}/.test(src)) fail.push('isenção .bt-clip.music .nm ausente');
const sizeOf = decl => { const m = /(\d*\.?\d+)px/.exec(decl); return m ? parseFloat(m[1]) : null; };
let tokens = 0, literal = 0;
lines.forEach((l, i) => {
  for (const m of l.matchAll(/font(?:-size)?\s*:\s*([^;}"]*)/g)) {
    const v = m[1];
    if (/var\(--fs-/.test(v)) { tokens++; continue; }
    const px = sizeOf(v);
    if (px == null || /isento:/.test(l)) continue;
    if (px < 11) fail.push('fonte < 11px em :' + (i + 1) + ': ' + l.trim());
    else if (px <= 15) literal++;
  }
});
if (tokens / (tokens + literal) < 0.9) fail.push('--fs-* em ' + tokens + ' de ' + (tokens + literal) + ' declarações de 11–15px (< 90%)');
[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: Task 3 estático (' + tokens + ' tokens, ' + literal + ' literais 11–15px)');
process.exitCode = fail.length ? 1 : 0;
NODE
```

Expected: `FAIL` com 14 itens `ausente:`, os 3 itens de `.bt-beat`/isenção, 31 linhas `fonte < 11px` e `--fs-* em 0 de 26`.

- [ ] **Step 2 [Executor]: Tokens, contraste e densidade no CSS**

No `:root`:
- `--ink:#eef1fb; --dim:#9aa3c7; --faint:#5c6190;` → `--ink:#eef1fb; --dim:#9aa3c7; --faint:#7b80ad;`
- `--bt-labelw:192px;` → `--bt-labelw:204px;`
- Logo abaixo de `--ease-spring:cubic-bezier(.34,1.56,.64,1);` inserir:

```css
  /* Escala tipográfica. Piso de 11px, e 11px só para rótulo curto (caixa alta,
     chip, meta); frase usa --fs-sm ou maior. */
  --fs-micro:11px; --fs-sm:12.5px; --fs-body:13.5px; --fs-lead:15px;
  /* --faint virou texto legível (4,5:1 sobre --panel2); o fundo de botão
     desabilitado mantém o tom apagado antigo. */
  --disabled-bg:#5c6190;
```

Logo após o `}` que fecha o `:root` inserir:

```css
/* Densidade confortável (toggle do header, salva em studio.density). compact é a
   ausência do atributo. Só a TIMELINE consome estes tokens. */
html[data-density="comfortable"]{--tap:36px; --tap-sm:28px; --gap-ctl:4px; --bt-labelw:248px}
```

`.btn[disabled]{background:var(--faint); color:#0a0a14;` → `.btn[disabled]{background:var(--disabled-bg); color:#0a0a14;`

Logo após a regra `.tag{…}` (termina em `background:rgba(129,140,248,.06)}`) inserir:

```css
/* Botões do header (densidade; atalhos). Mesmo chrome da .tag, com estado. */
.hdr-btn{all:unset; cursor:pointer; display:inline-flex; align-items:center; min-height:28px; padding:0 12px;
  border:1px solid var(--line); border-radius:999px; font:500 var(--fs-micro) var(--mono); letter-spacing:.12em;
  color:var(--dim); background:rgba(129,140,248,.06); white-space:nowrap;
  transition:color var(--dur-1), border-color var(--dur-1), background var(--dur-1)}
.hdr-btn:hover{color:var(--ink); border-color:rgba(129,140,248,.4)}
.hdr-btn:focus-visible{outline:2px solid var(--go); outline-offset:2px}
.hdr-btn[aria-pressed="true"]{color:var(--go); border-color:rgba(251,191,36,.5); background:var(--go-dim)}
```

- [ ] **Step 3 [Executor]: Densidade — `<head>`, header e JS**

No `<head>`, logo após o `</script>` do loader do probe (Task 1), inserir:

```html
<script>
/* Densidade da TIMELINE aplicada antes da primeira pintura, para não piscar.
   localStorage pode lançar em janela privada — daí o try. */
try { if (localStorage.getItem('studio.density') === 'comfortable') document.documentElement.dataset.density = 'comfortable'; } catch (e) {}
</script>
```

No `<header>`, entre `  <span class="spacer"></span>` e `  <span class="tag" id="port">…</span>`, inserir:

```html
  <button type="button" id="density-toggle" class="hdr-btn" aria-pressed="false"
    title="Alvos maiores na TIMELINE (36px em vez de 30px). A escolha fica salva neste navegador.">DENSIDADE CONFORTÁVEL</button>
```

No script global, logo após o fechamento `})();` da IIFE do rodapé colapsável (a que usa `studio-side-collapsed`), inserir:

```js
/* ---------------- densidade da TIMELINE (compact | comfortable)
   O atributo já foi aplicado no <head>; aqui fica só o botão. O closure da
   TIMELINE escuta 'studio:density' para reler --bt-labelw e redesenhar. */
(() => {
  const btn = $('#density-toggle');
  if (!btn) return;
  const root = document.documentElement;
  const paint = () => btn.setAttribute('aria-pressed', String(root.dataset.density === 'comfortable'));
  paint();
  btn.onclick = () => {
    const comfy = root.dataset.density !== 'comfortable';
    if (comfy) root.dataset.density = 'comfortable'; else delete root.dataset.density;
    try { localStorage.setItem('studio.density', comfy ? 'comfortable' : 'compact'); } catch (e) {}
    paint();
    document.dispatchEvent(new CustomEvent('studio:density'));
  };
})();
```

No closure da TIMELINE, imediatamente antes de `  /* ---------------- keyboard shortcuts (scoped to #step-beats.on) ---------------- */`, inserir:

```js
  /* Densidade: o toggle do header troca --bt-labelw. Os px da TIMELINE saem de
     LABEL_W, então é preciso reler o token e redesenhar. */
  document.addEventListener('studio:density', () => {
    readLabelW();
    if (built) renderTracks();
  });
```

- [ ] **Step 4 [Executor]: Fontes → escala (57 declarações)**

A coluna "Regra" identifica onde está o trecho (há trechos repetidos em regras diferentes, como `font:400 10.5px var(--mono);` em `.tag` e `.bt-zoomlevel`). Trocar só o trecho indicado.

| # | Regra | Trecho atual | Vira |
|---|---|---|---|
| 1 | `body` | `font:400 13.5px/1.6 var(--sans);` | `font:400 var(--fs-body)/1.6 var(--sans);` |
| 2 | `.rec` | `font-size:10.5px;` | `font-size:var(--fs-micro);` |
| 3 | `.tag` | `font:400 10.5px var(--mono);` | `font:400 var(--fs-micro) var(--mono);` |
| 4 | `nav button` | `font:500 12px var(--sans);` | `font:500 var(--fs-sm) var(--sans);` |
| 5 | `nav button .n` | `font:400 15px var(--disp);` | `font:400 var(--fs-lead) var(--disp);` |
| 6 | `nav button.done::after` | `font-size:11px;` | `font-size:var(--fs-micro);` |
| 7 | `.step .sub` | `font-size:13px` | `font-size:var(--fs-body)` |
| 8 | `.card h3` | `font-size:10.5px;` | `font-size:var(--fs-micro);` |
| 9 | `label` | `font-size:10.5px;` | `font-size:var(--fs-micro);` |
| 10 | `input[type=text],…` | `font:400 13px var(--mono);` | `font:400 var(--fs-body) var(--mono);` |
| 11 | `.btn` | `font:600 12px var(--sans);` | `font:600 var(--fs-sm) var(--sans);` |
| 12 | `.btn.sm` | `font-size:11px;` | `font-size:var(--fs-micro);` |
| 13 | `.chip` | `font:500 10px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 14 | `.drop` | `font-size:12px;` | `font-size:var(--fs-sm);` |
| 15 | `.asset` | `font-size:12px;` | `font-size:var(--fs-sm);` |
| 16 | `.asset .name` | `font:400 12px var(--mono)` | `font:400 var(--fs-sm) var(--mono)` |
| 17 | `.asset .meta` | `font:400 10px var(--mono)` | `font:400 var(--fs-micro) var(--mono)` |
| 18 | `.asset button` | `font:600 10px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` |
| 19 | `.empty` | `font-size:12px;` | `font-size:var(--fs-sm);` |
| 20 | `table` | `font-size:12px` | `font-size:var(--fs-sm)` |
| 21 | `th` | `font-size:9.5px;` | `font-size:var(--fs-micro);` |
| 22 | `td` | `font:400 12px var(--mono);` | `font:400 var(--fs-sm) var(--mono);` |
| 23 | `aside h3` | `font-size:10px;` | `font-size:var(--fs-micro);` |
| 24 | `#side-toggle` | `font:600 10px var(--mono);` | `font:600 var(--fs-micro) var(--mono);` |
| 25 | `#stage` | `font:400 12px var(--mono);` | `font:400 var(--fs-sm) var(--mono);` |
| 26 | `#console` | `font:400 10.5px/1.55 var(--mono);` | `font:400 var(--fs-sm)/1.55 var(--mono);` |
| 27 | `@media (max-width:900px)` → `nav button` | `font-size:11.5px` | `font-size:var(--fs-sm)` |
| 28 | `.bt-tbtn` | `font:600 11px var(--mono);` | `font:600 var(--fs-micro) var(--mono);` |
| 29 | `.bt-time` | `font:400 13px var(--mono);` | `font:400 var(--fs-body) var(--mono);` |
| 30 | `.bt-zoomlevel` | `font:400 10.5px var(--mono);` | `font:400 var(--fs-micro) var(--mono);` |
| 31 | `.bt-toggle` | `font:500 10.5px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 32 | `.bt-legend-head` | `font:600 9.5px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` |
| 33 | `.bt-legend-row` (a primeira, `display:flex; align-items:center; gap:8px;`) | `font:400 12px var(--mono);` | `font:400 var(--fs-sm) var(--mono);` |
| 34 | `.bt-tick span` | `font-size:9px;` | `font-size:var(--fs-micro);` |
| 35 | `.bt-track-label` | `font:600 9.5px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` |
| 36 | `.bt-tctl` | `font:700 9px var(--mono);` | `font:700 var(--fs-micro) var(--mono);` |
| 37 | `.bt-beat .lbl` | `font:700 9.5px var(--sans);` | `font:700 var(--fs-micro)/1.3 var(--sans);` |
| 38 | `.bt-beat .dur` | `font:400 8.5px var(--mono);` | `font:400 var(--fs-micro)/1.3 var(--mono);` |
| 39 | `.bt-word` | `font:400 9.5px var(--mono); color:var(--dim); padding:0 3px; white-space:nowrap; overflow:hidden;` | mesmo texto + ` /* isento: lane intocada — sub-projeto A, decisão 2 */` no fim **da mesma linha** |
| 40 | `.bt-pop .t` | `font:600 9px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` |
| 41 | `.bt-role-opt` (a primeira, com `all:unset`) | `font:500 9px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 42 | `.bt-pop input` | `font:400 12px var(--mono);` | `font:400 var(--fs-sm) var(--mono);` |
| 43 | `.bt-pop .row2 button` | `font:500 10px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 44 | `.bt-pop .msg` (frase) | `font:400 11px var(--sans);` | `font:400 var(--fs-sm) var(--sans);` |
| 45 | `.bt-menu-item` | `font:500 10px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 46 | `.bt-clip .tag` | `font:400 8.5px var(--mono);` | `font:400 var(--fs-micro) var(--mono);` |
| 47 | `.bt-clip .nm` | `font:600 9.5px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` — e logo após o fim dessa regra inserir a linha `.bt-clip.music .nm{font-size:9.5px} /* isento: lane intocada — sub-projeto A, decisão 2 */` |
| 48 | `.bt-asset-opt` | `font:500 10px var(--sans);` | `font:500 var(--fs-micro) var(--sans);` |
| 49 | `.bt-rate` | `font:600 10px var(--mono);` | `font:600 var(--fs-micro) var(--mono);` |
| 50 | `.bt-preview-tag` | `font:600 8.5px var(--sans);` | `font:600 var(--fs-micro) var(--sans);` |
| 51 | `.bt-preview-time` | `font:400 9.5px var(--mono);` | `font:400 var(--fs-micro) var(--mono);` |
| 52 | `.bt-cap-overlay` | `font:400 13px 'Unica One',sans-serif;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.85);z-index:3}` | mesmo texto + ` /* isento: display — representa a legenda queimada */` no fim da mesma linha |
| 53 | `.bt-preview-error` | `font:400 11.5px var(--sans);` | `font:400 var(--fs-sm) var(--sans);` |
| 54 | HTML do passo VISUALS (`First time: …cd remotion && npm install`) | `style="margin-top:12px;font-size:11px"` | `style="margin-top:12px;font-size:var(--fs-sm)"` |
| 55 | template JS (`command: <span …${r.command}`) | `style="margin-top:10px;font-size:11px"` | `style="margin-top:10px;font-size:var(--fs-sm)"` |
| 56 | template JS (`${m.reason}${m.hookText …`) | `style="font-size:11.5px"` | `style="font-size:var(--fs-sm)"` |
| 57 | template JS `#bt-word-pop-err` | `font:400 10px var(--sans);` | `font:400 var(--fs-sm) var(--sans);` |

- [ ] **Step 5 [Executor]: Checagem estática** — rodar o script do Step 1. Expected: `PASS: Task 3 estático (… tokens, 1 literais 11–15px)` ou menos literais.

- [ ] **Step 6 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 5. Parar aqui.

- [ ] **Step 7 [Orquestrador]: `validator`** — "validar a Task 3 de `docs/plans/ui-premium-timeline.md`; rodar o script do Step 1; conferir que as isenções são só `.bt-word`, `.bt-clip.music .nm` e `.bt-cap-overlay`, e que todo acesso a `studio.density` está em `try`".

- [ ] **Step 8 [Orquestrador]: Probe** — recarregar `?probe=1`, `load`, `await uiProbe.run('E2')`. Expected: PASS. Se `density` reprovar por `truncated` não vazio, subir o `--bt-labelw` da densidade que falhou em passos de 4px (`204` → `208`…; `248` → `252`…) até passar — ajuste de uma linha feito pelo Orquestrador e registrado em `## Verificação`. Recarregar a página e confirmar que a densidade escolhida persiste; abrir em janela anônima e confirmar `console-errors` = 0.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12) **nas duas densidades**; conferir visualmente que os chips de palavra da LEGENDA e os clipes da TRILHA estão iguais aos de antes.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** fase 1 (staging: `public/index.html`) → aprovação → fase 2 (commit `Raise UI type floor, fix --faint contrast, add TIMELINE density toggle (E2)`).

---

### Task 4 (E3a): Controles de track com ícone, timecode no playhead, área de pega

**Files:**
- Modify: `public/index.html` — logo após `<body>` (sprite SVG); CSS após `.bt-tctl.on{…}`, a regra `.bt-track-row.locked .bt-track-content`, após `.bt-playhead-flag{…}` (a primeira, com `clip-path`), após `.bt-handle.right{right:-2px}`; closure da TIMELINE: bloco novo antes de `/* ---------------- DOM build ---------------- */`, markup de `buildDom()` (tracks e playhead), `applyTrackVisibility()`, `renderPlayhead()`.

**Interfaces:**
- Consumes: `LABEL_W` (Task 2), `fmt(t)`, `timeToX(t)`, `contentWidth()`, `playhead` (existentes); `--fs-micro` (Task 3).
- Produces: `const TCTL` e `function tctlHtml(act, trackName): string` no closure; ids de símbolo `i-eye`, `i-eye-off`, `i-lock-open`, `i-lock`, `i-spk`, `i-spk-off`, `i-solo`, `i-plus`; `span.bt-playhead-tc` (com `.flip`) dentro de `#bt-playhead`.

**Ajuste sobre a spec, decidido aqui:** o texto do chip é atualizado em `renderPlayhead()`, e não em `updateTimeDisplay()`. Os dois sempre rodam juntos em `applyPlayhead`/`renderTracks`, mas na rota canvas o `compositeTick` chama só `renderPlayhead()` por frame — o chip acompanharia o playhead aos saltos de ~4×/s se ficasse em `updateTimeDisplay()`.

- [ ] **Step 1 [Executor]: Rodar a checagem estática e confirmar que falha**

```bash
node - <<'NODE'
const fs = require('fs');
const src = fs.readFileSync('public/index.html', 'utf8');
const lines = src.split('\n');
const fail = [];
for (const id of ['i-eye', 'i-eye-off', 'i-lock-open', 'i-lock', 'i-spk', 'i-spk-off', 'i-solo', 'i-plus'])
  if (!src.includes('<symbol id="' + id + '" viewBox="0 0 24 24">')) fail.push('símbolo ausente: ' + id);
for (const t of ['const TCTL = {', 'function tctlHtml(act, trackName) {', "btn.setAttribute('aria-pressed', String(on));",
  "use.setAttribute('href', '#' + TCTL[act].icons[on ? 1 : 0]);", '<span class="ic">◆</span><span class="nm">MARKERS</span>',
  '<span class="bt-playhead-tc" aria-hidden="true">00:00.0</span>', "tc.classList.toggle('flip', timeToX(playhead) + PH_TC_W > contentWidth());",
  '.bt-handle.left::before{left:0; right:-4px}', '.bt-handle.right::before{left:-4px; right:0}',
  'repeating-linear-gradient(45deg, rgba(255,179,71,.07) 0 6px, transparent 6px 12px)'])
  if (!src.includes(t)) fail.push('ausente: ' + t);
const calls = (src.match(/\$\{tctlHtml\('/g) || []).length;
if (calls !== 15) fail.push('esperado 15 chamadas ${tctlHtml(…)} no buildDom, achadas ' + calls);
if (/<button class="bt-tctl"[^>]*>[A-Z+]<\/button>/.test(src)) fail.push('ainda há .bt-tctl com letra no markup');
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
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: Task 4 estático');
process.exitCode = fail.length ? 1 : 0;
NODE
```

Expected: `FAIL` com os 8 símbolos, os 10 itens `ausente:`, `achadas 0` e a linha de `.bt-tctl` com letra.

- [ ] **Step 2 [Executor]: Sprite de ícones logo após `<body>`**

Imediatamente depois da linha `<body>` inserir:

```html
<!-- Ícones dos controles de track da TIMELINE, usados por <use href="#i-…">.
     Largura/altura zero em vez de hidden/display:none, que é frágil para <use>. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18 M10.7 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6 M6.7 7.7A16.6 16.6 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 3.5-.6 M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
  <symbol id="i-lock-open" viewBox="0 0 24 24"><path d="M5 11.5h14V21H5z M8.4 11.5V7.2A3.8 3.8 0 0 1 15.8 6"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><path d="M5 11.5h14V21H5z M8.4 11.5V7.2a3.6 3.6 0 0 1 7.2 0v4.3"/></symbol>
  <symbol id="i-spk" viewBox="0 0 24 24"><path d="M4 9.2h3l5-3.8v13.2l-5-3.8H4z M16.4 9.6a3.4 3.4 0 0 1 0 4.8 M18.9 7.1a7 7 0 0 1 0 9.8"/></symbol>
  <symbol id="i-spk-off" viewBox="0 0 24 24"><path d="M4 9.2h3l5-3.8v13.2l-5-3.8H4z M16.6 9.8l4.4 4.4 M21 9.8l-4.4 4.4"/></symbol>
  <symbol id="i-solo" viewBox="0 0 24 24"><path d="M4 15v-3.2a8 8 0 0 1 16 0V15 M4 14.2h3.2V20H5.2a1.2 1.2 0 0 1-1.2-1.2z M20 14.2h-3.2V20h2a1.2 1.2 0 0 0 1.2-1.2z"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5.2v13.6 M5.2 12h13.6"/></symbol>
</svg>
```

- [ ] **Step 3 [Executor]: CSS**

Logo após `.bt-tctl.on{color:var(--go); background:var(--go-dim)}` inserir:

```css
.bt-tctl svg{width:60%; height:60%; fill:none; stroke:currentColor; stroke-width:1.7;
  stroke-linecap:round; stroke-linejoin:round; pointer-events:none}
.bt-tctl.on[data-act="hide"],.bt-tctl.on[data-act="mute"]{color:var(--bad); background:rgba(251,113,133,.12)}
.bt-tctl.on[data-act="lock"]{color:var(--warn); background:rgba(255,179,71,.12)}
.bt-tctl.on[data-act="solo"]{color:var(--go); background:var(--go-dim)}
```

`.bt-track-row.locked .bt-track-content{cursor:not-allowed}` → 

```css
/* travada: hachura sobre a lane, sem trocar a cor de fundo */
.bt-track-row.locked .bt-track-content{cursor:not-allowed;
  background-image:repeating-linear-gradient(45deg, rgba(255,179,71,.07) 0 6px, transparent 6px 12px)}
```

Logo após a regra `.bt-playhead-flag{position:absolute; top:var(--bt-markers-h,0px); …}` (duas linhas, termina em `cursor:ew-resize}`) inserir:

```css
/* Timecode do playhead, na altura da régua; mesmo texto de #bt-time (fmt). Perto
   do fim da timeline passa para a esquerda da linha (.flip) para não sair dela. */
.bt-playhead-tc{position:absolute; top:calc(var(--bt-markers-h,0px) + 3px); left:9px; padding:0 5px; border-radius:3px;
  background:var(--go); color:#191100; font:600 var(--fs-micro)/16px var(--mono); letter-spacing:.02em;
  white-space:nowrap; pointer-events:none}
.bt-playhead-tc.flip{left:auto; right:9px}
```

Logo após `.bt-handle.right{right:-2px}` inserir:

```css
/* Área de pega 4px maior, para DENTRO do clipe: .bt-clip tem overflow:hidden (para
   fora seria cortada) e segmentos de VÍDEO encostam (para fora sobreporia a vizinha). */
.bt-handle::before{content:''; position:absolute; top:0; bottom:0}
.bt-handle.left::before{left:0; right:-4px}
.bt-handle.right::before{left:-4px; right:0}
```

- [ ] **Step 4 [Executor]: `TCTL` e `tctlHtml` no closure**

Imediatamente antes de `  /* ---------------- DOM build ---------------- */` inserir:

```js
  /* Controles de track (H/L/M/S/+): ícone de dois estados em vez de letra. O
     estado vai em aria-pressed e o aria-label não muda com ele — trocar os dois
     faria o leitor de tela anunciar a ação duas vezes, invertida. H/M/S são só
     do preview (o conform lê o sidecar inteiro), e o title diz isso. */
  const TCTL = {
    add:  { label: 'Adicionar clipe à track', title: 'adicionar clipe', icons: ['i-plus', 'i-plus'] },
    hide: { label: 'Ocultar track', title: 'ocultar no preview — não altera o export', icons: ['i-eye', 'i-eye-off'] },
    lock: { label: 'Travar track', title: 'travar edição', icons: ['i-lock-open', 'i-lock'] },
    mute: { label: 'Silenciar trilha', title: 'mudo no preview — não altera o export', icons: ['i-spk', 'i-spk-off'] },
    solo: { label: 'Ativar solo da trilha', title: 'solo da TRILHA: silencia o áudio do vídeo no preview — não altera o export', icons: ['i-solo', 'i-solo'] },
  };
  function tctlHtml(act, trackName) {
    const d = TCTL[act];
    const pressed = act === 'add' ? '' : ' aria-pressed="false"';
    return `<button class="bt-tctl" data-act="${act}"${pressed} title="${d.title}" aria-label="${d.label} ${trackName}">` +
      `<svg aria-hidden="true"><use href="#${d.icons[0]}"></use></svg></button>`;
  }
```

- [ ] **Step 5 [Executor]: Markup do `buildDom()`**

Substituir, dentro do template de `buildDom()`, o trecho que vai de `<div class="bt-tracks bt-tracks-top" id="bt-tracks-top">` até `<div class="bt-playhead" id="bt-playhead"><div class="bt-playhead-flag"></div></div>` (inclusive) por:

```html
          <div class="bt-tracks bt-tracks-top" id="bt-tracks-top">
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">◆</span><span class="nm">MARKERS</span>
                ${tctlHtml('hide', 'MARKERS')}${tctlHtml('lock', 'MARKERS')}</div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
          </div>
          <div class="bt-ruler-corner"></div>
          <div class="bt-ruler" id="bt-ruler"></div>
          <div class="bt-tracks" id="bt-tracks">
            <div class="bt-track-row" data-track="broll">
              <div class="bt-track-label"><span class="ic">▭</span><span class="nm">B-ROLL</span>
                ${tctlHtml('add', 'B-ROLL')}${tctlHtml('hide', 'B-ROLL')}${tctlHtml('lock', 'B-ROLL')}</div>
              <div class="bt-track-content" id="bt-track-broll"></div>
              <div class="bt-row-resize" data-track="broll"></div>
            </div>
            <div class="bt-track-row" data-track="video">
              <div class="bt-track-label"><span class="ic">▶</span><span class="nm">VÍDEO</span>
                ${tctlHtml('lock', 'VÍDEO')}</div>
              <div class="bt-track-content" id="bt-track-video"></div>
              <div class="bt-row-resize" data-track="video"></div>
            </div>
            <div class="bt-track-row" data-track="legend">
              <div class="bt-track-label"><span class="ic">T</span><span class="nm">LEGENDA</span>
                ${tctlHtml('hide', 'LEGENDA')}${tctlHtml('lock', 'LEGENDA')}</div>
              <div class="bt-track-content" id="bt-track-legend"></div>
              <div class="bt-row-resize" data-track="legend"></div>
            </div>
            <div class="bt-track-row" data-track="audio">
              <div class="bt-track-label"><span class="ic">♪</span><span class="nm">ÁUDIO</span>
                ${tctlHtml('hide', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>
              <div class="bt-track-content" id="bt-track-audio"><canvas id="bt-wave"></canvas></div>
              <div class="bt-row-resize" data-track="audio"></div>
            </div>
            <div class="bt-track-row" data-track="music">
              <div class="bt-track-label"><span class="ic">♫</span><span class="nm">TRILHA</span>
                ${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('hide', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>
              <div class="bt-track-content" id="bt-track-music"></div>
              <div class="bt-row-resize" data-track="music"></div>
            </div>
          </div>
          <div class="bt-playhead" id="bt-playhead"><div class="bt-playhead-flag"></div><span class="bt-playhead-tc" aria-hidden="true">00:00.0</span></div>
```

Os 15 `aria-label` gerados são idênticos aos de hoje (ex.: `Adicionar clipe à track B-ROLL`, `Silenciar trilha TRILHA`, `Ativar solo da trilha TRILHA`).

- [ ] **Step 6 [Executor]: `applyTrackVisibility()` e `renderPlayhead()`**

Em `applyTrackVisibility()`, substituir `        btn.classList.toggle('on', on);` por:

```js
        btn.classList.toggle('on', on);
        if (act !== 'add' && TCTL[act]) {
          btn.setAttribute('aria-pressed', String(on));
          const use = btn.querySelector('use');
          if (use) use.setAttribute('href', '#' + TCTL[act].icons[on ? 1 : 0]);
        }
```

Substituir a função `renderPlayhead()` inteira por:

```js
  // Largura aproximada do chip "00:00.0" + folga: constante para não ler layout por frame.
  const PH_TC_W = 72;
  function renderPlayhead() {
    const ph = $q('#bt-playhead');
    if (!ph) return;
    ph.style.left = (LABEL_W + timeToX(playhead)) + 'px';
    const tc = ph.querySelector('.bt-playhead-tc');
    if (!tc) return;
    const txt = fmt(playhead);
    if (tc.textContent !== txt) tc.textContent = txt;
    tc.classList.toggle('flip', timeToX(playhead) + PH_TC_W > contentWidth());
  }
```

- [ ] **Step 7 [Executor]: Checagem estática** — rodar o script do Step 1. Expected: `PASS: Task 4 estático`.

- [ ] **Step 8 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 7. Parar aqui.

- [ ] **Step 9 [Orquestrador]: `validator`** — "validar a Task 4 de `docs/plans/ui-premium-timeline.md`; rodar o script do Step 1; conferir que os 15 `aria-label` de `tctlHtml` reproduzem exatamente os do `git show HEAD:public/index.html` e que `wireTracks()` não foi alterado".

- [ ] **Step 10 [Orquestrador]: Probe** — recarregar `?probe=1`, `load`, `await uiProbe.run('E3a')`. Expected: PASS, incluindo `tctl-a11y` (`withText 0`, `missingPressed 0`, `togglesFailed []`) e `playhead-tc`. Repetir com o bundle bloqueado (rota canvas).

- [ ] **Step 11 [Usuário]: Checklist manual** (itens 1–12, nas duas densidades) + travar B-ROLL e tentar arrastar um clipe (não move) + trim num segmento de VÍDEO encostado no vizinho (pega o segmento certo) + levar o playhead ao fim da timeline (chip passa para a esquerda da linha).

- [ ] **Step 12 [Orquestrador → Usuário]: `git-workflow`** fase 1 (staging: `public/index.html`) → aprovação → fase 2 (commit `Replace track control letters with two-state icons, add playhead timecode (E3a)`).

---

### Task 5 (E3b): Transporte em grupos, folha de atalhos, microinterações

**Files:**
- Modify: `public/index.html` — CSS (`.bt-transport`, `.bt-tsep`, `.bt-spacer`, após `.bt-tbtn[disabled]`, bloco novo antes de `</style>`); `<header>` (botão `? ATALHOS`); entre `</aside>` e o `<script>` principal (`<dialog>`); script global (após a IIFE de densidade da Task 3); closure da TIMELINE: marcas `justAdded`/`justSplit` + `fxClass` (após `let selectedClipSet = new Set();`), `splitBeatAt`, `addClipAt`, `renderBeatsTrack`, `renderClipTrack`, `splitClipAt`, `duplicateClip`, `renderVideoTrack`, template do transporte em `buildDom()`, `renderLegendList`, `renderTracks`, `glidePlayhead` novo + `seekTo`, `onRulerMouseDown`, `wireTransport` (4 escritas do rótulo de play), handler de `keydown` (guard + Home/End).

**Interfaces:**
- Consumes: `.hdr-btn` e `--fs-*` (Task 3); `--dur-1..3`, `--ease-out`, `--ease-in-out` (Task 2); `renderTracks()`, `seekTo(t)`, `addClipAt`, `duplicateClip`, `splitBeatAt`, `splitClipAt` (existentes).
- Produces: `window.SHORTCUTS: {group, keys: string[], desc}[]`; `dialog#shortcuts-sheet` com linhas `.sc-row`; `button#shortcuts-btn`; `.bt-tgroup`, `.bt-kbd`, `#bt-play .lbl`; `seekTo(t, opts?: {animate?: boolean})`; classes `.bt-enter`, `.bt-split`, `.bt-seek`.

**Ajuste sobre a spec, decidido aqui:** `duplicateClip` também marca `justAdded` — é o outro caminho que faz um clipe surgir na timeline (menu de contexto → DUPLICAR); a spec citava só `addClipAt`.

- [ ] **Step 1 [Executor]: Rodar a checagem estática e confirmar que falha**

```bash
node - <<'NODE'
const fs = require('fs');
const src = fs.readFileSync('public/index.html', 'utf8');
const lines = src.split('\n');
const fail = [];
const ids = ['bt-play', 'bt-time', 'bt-rate', 'bt-j', 'bt-k', 'bt-l', 'bt-frameback', 'bt-frameforward', 'bt-markin',
  'bt-markout', 'bt-split', 'bt-merge', 'bt-rename', 'bt-undo', 'bt-redo', 'bt-zoomout', 'bt-zoomlevel', 'bt-zoomin',
  'bt-zoomfit', 'bt-save', 'bt-conform'];
const tpl = /<div class="bt-transport">([\s\S]*?)<div class="bt-preview">/.exec(src);
if (!tpl) fail.push('template do transporte não encontrado');
else {
  const groups = (tpl[1].match(/<div class="bt-tgroup[^"]*" role="group" aria-label="/g) || []).length;
  if (groups !== 5) fail.push('esperado 5 .bt-tgroup no transporte, achados ' + groups);
  for (const id of ids) if (!tpl[1].includes('id="' + id + '"')) fail.push('id ausente no transporte: ' + id);
  if ((tpl[1].match(/<kbd class="bt-kbd">/g) || []).length !== 16) fail.push('esperado 16 .bt-kbd no transporte');
  if (!tpl[1].includes('<kbd class="bt-kbd">\\\\</kbd>')) fail.push('kbd de FIT deve ser \\\\ no template (vira \\ no HTML)');
}
if (/bt-tsep|bt-spacer/.test(src)) fail.push('.bt-tsep/.bt-spacer ainda presentes');
if (src.includes("$q('#bt-play').textContent")) fail.push("rótulo do play ainda escrito em $q('#bt-play').textContent");
if ((src.match(/\$q\('#bt-play \.lbl'\)\.textContent = /g) || []).length !== 4) fail.push('esperado 4 escritas em #bt-play .lbl');
for (const t of ['id="shortcuts-btn"', '<dialog id="shortcuts-sheet" aria-labelledby="shortcuts-title">', 'id="shortcuts-grid"',
  'id="shortcuts-close"', 'window.SHORTCUTS = [', 'dlg.showModal();', "dlg.addEventListener('close'",
  "if (document.querySelector('dialog[open]')) return;", 'function glidePlayhead() {', 'function seekTo(t, opts) {',
  'if (opts && opts.animate) glidePlayhead();', 'let justAdded = null, justSplit = null;', 'function fxClass(track, i) {',
  'justAdded = null; justSplit = null;', '.bt-playhead.bt-seek{transition:left var(--dur-1) var(--ease-in-out)}',
  '.bt-clip.bt-enter{', '.bt-split{animation:bt-split-flash var(--dur-3) linear}'])
  if (!src.includes(t)) fail.push('ausente: ' + t);
if ((src.match(/\{ animate: true \}/g) || []).length !== 4) fail.push('esperado 4 chamadas seekTo(…, { animate: true })');
if ((src.match(/(?<!function )fxClass\('(beats|video)', i\)|(?<!function )fxClass\(track, i\)/g) || []).length !== 3) fail.push('esperado 3 usos de fxClass nos renders');
if ((src.match(/justAdded = \{ track, idx: /g) || []).length !== 3) fail.push('esperado 3 marcas justAdded (addClipAt + 2 em duplicateClip)');
if ((src.match(/justSplit = \{ track/g) || []).length !== 2) fail.push('esperado 2 marcas justSplit (splitBeatAt, splitClipAt)');
// SHORTCUTS ↔ handler de teclado da TIMELINE
const sc = /window\.SHORTCUTS = (\[[\s\S]*?\]);/.exec(src);
const kb = /keyboard shortcuts \(scoped to #step-beats\.on\)([\s\S]*?)init: wire the static elements/.exec(src);
if (sc && kb) {
  const listed = new Set(new Function('return ' + sc[1])().flatMap(s => s.keys));
  const norm = k => k === ' ' ? 'Espaço' : k === 'Escape' ? 'Esc' : k.length === 1 ? k.toUpperCase() : k;
  const handled = new Set([...kb[1].matchAll(/case '((?:\\.|[^'])*)'/g)].map(m => norm(m[1].replace(/\\\\/g, '\\'))));
  if (/e\.ctrlKey && !e\.shiftKey && e\.key\.toLowerCase\(\) === 'z'/.test(kb[1])) handled.add('Ctrl+Z');
  if (/e\.ctrlKey && e\.shiftKey && e\.key\.toLowerCase\(\) === 'z'/.test(kb[1])) handled.add('Ctrl+⇧+Z');
  if (/if \(!e\.ctrlKey\) return;\s*e\.preventDefault\(\);\s*zoomAt\(/.test(src)) handled.add('Ctrl+roda');
  handled.add('?');
  for (const k of handled) if (!listed.has(k)) fail.push('atalho registrado e ausente de SHORTCUTS: ' + k);
  for (const k of listed) if (!handled.has(k)) fail.push('SHORTCUTS lista atalho que o handler não registra: ' + k);
} else fail.push('SHORTCUTS ou handler de teclado não encontrados');
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
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: Task 5 estático');
process.exitCode = fail.length ? 1 : 0;
NODE
```

Expected: `FAIL` (grupos, kbd, `.bt-tsep`, rótulo do play, itens `ausente:`, contagens e `SHORTCUTS ou handler … não encontrados`).

- [ ] **Step 2 [Executor]: CSS do transporte e do atalho no botão**

`.bt-transport{display:flex; align-items:center; gap:8px; flex-wrap:wrap;` → `.bt-transport{display:flex; align-items:center; gap:10px 18px; flex-wrap:wrap;`

Substituir a linha `.bt-tsep{width:1px; height:18px; background:var(--line)}` por:

```css
/* Transporte em grupos por função. flex-wrap nos dois níveis: numa janela estreita
   um grupo desce de linha inteiro — nada é cortado nem escondido atrás de menu. */
.bt-tgroup{display:flex; align-items:center; gap:6px; flex-wrap:wrap}
.bt-tgroup-end{margin-left:auto}
```

Apagar a linha `.bt-spacer{flex:1}`.

Logo após `.bt-tbtn[disabled]{opacity:.3; cursor:default}` inserir:

```css
/* Atalho no próprio botão. compact: flutua acima só em hover/foco, sem mexer no
   layout. comfortable: inline e sempre visível. */
.bt-tbtn{position:relative}
.bt-kbd{position:absolute; left:50%; bottom:calc(100% + 4px); transform:translateX(-50%); z-index:8;
  font:500 var(--fs-micro)/1.4 var(--mono); color:var(--ink); background:var(--panel2);
  border:1px solid var(--line); border-radius:4px; padding:0 4px; white-space:nowrap;
  opacity:0; pointer-events:none; transition:opacity var(--dur-1)}
.bt-tbtn:hover .bt-kbd,.bt-tbtn:focus-visible .bt-kbd{opacity:1}
html[data-density="comfortable"] .bt-kbd{position:static; transform:none; opacity:1; margin-left:6px;
  color:var(--faint); background:none}
```

- [ ] **Step 3 [Executor]: Template do transporte em `buildDom()`**

Substituir o trecho que começa em `      <div class="bt-transport">` e termina no `      </div>` imediatamente antes de `      <div class="bt-preview">` por (as barras invertidas de FIT são duplas porque estão dentro de template literal — `\\` vira `\` no HTML; o original `title="\"` virava `title=""`):

```html
      <div class="bt-transport">
        <div class="bt-tgroup" role="group" aria-label="Reprodução">
          <button class="bt-tbtn" id="bt-play" title="Espaço"><span class="lbl">▶</span><kbd class="bt-kbd">Espaço</kbd></button>
          <div class="bt-time" id="bt-time">00:00.0<span class="d">/</span>00:00.0</div>
          <span class="bt-rate" id="bt-rate" style="display:none"></span>
        </div>
        <div class="bt-tgroup" role="group" aria-label="Navegação">
          <button class="bt-tbtn" id="bt-j" title="J">◀◀<kbd class="bt-kbd">J</kbd></button>
          <button class="bt-tbtn" id="bt-k" title="K">❚❚<kbd class="bt-kbd">K</kbd></button>
          <button class="bt-tbtn" id="bt-l" title="L">▶▶<kbd class="bt-kbd">L</kbd></button>
          <button class="bt-tbtn" id="bt-frameback" title=",">-1f<kbd class="bt-kbd">,</kbd></button>
          <button class="bt-tbtn" id="bt-frameforward" title=".">+1f<kbd class="bt-kbd">.</kbd></button>
          <button class="bt-tbtn" id="bt-markin" title="I">IN<kbd class="bt-kbd">I</kbd></button>
          <button class="bt-tbtn" id="bt-markout" title="O">OUT<kbd class="bt-kbd">O</kbd></button>
        </div>
        <div class="bt-tgroup" role="group" aria-label="Edição">
          <button class="bt-tbtn" id="bt-split" title="S">SPLIT<kbd class="bt-kbd">S</kbd></button>
          <button class="bt-tbtn" id="bt-merge" title="M">MERGE<kbd class="bt-kbd">M</kbd></button>
          <button class="bt-tbtn" id="bt-rename" title="R">RENAME<kbd class="bt-kbd">R</kbd></button>
          <button class="bt-tbtn" id="bt-undo" title="Ctrl+Z">UNDO<kbd class="bt-kbd">Ctrl+Z</kbd></button>
          <button class="bt-tbtn" id="bt-redo" title="Ctrl+Shift+Z">REDO<kbd class="bt-kbd">Ctrl+⇧+Z</kbd></button>
        </div>
        <div class="bt-tgroup" role="group" aria-label="Zoom">
          <button class="bt-tbtn" id="bt-zoomout" title="-">−<kbd class="bt-kbd">-</kbd></button>
          <span class="bt-zoomlevel" id="bt-zoomlevel">100%</span>
          <button class="bt-tbtn" id="bt-zoomin" title="+">+<kbd class="bt-kbd">+</kbd></button>
          <button class="bt-tbtn" id="bt-zoomfit" title="\\">FIT<kbd class="bt-kbd">\\</kbd></button>
        </div>
        <div class="bt-tgroup bt-tgroup-end" role="group" aria-label="Projeto">
          <button class="bt-toggle" id="bt-save">SALVAR BEATS</button>
          <button class="bt-toggle" id="bt-conform" title="Achata a timeline (cortes de V1 + B-ROLL + TRILHA) num mezanino e manda para o EXPORT">CONFORMAR → EXPORT</button>
        </div>
      </div>
```

Em `wireTransport()`, trocar as 4 ocorrências de `$q('#bt-play').textContent = ` por `$q('#bt-play .lbl').textContent = ` (duas nos listeners do Player, duas nos do `<video>`), sem mudar o resto das linhas.

- [ ] **Step 4 [Executor]: Folha de atalhos — header, `<dialog>`, CSS, JS**

No `<header>`, logo após o `</button>` do `#density-toggle`, inserir:

```html
  <button type="button" id="shortcuts-btn" class="hdr-btn" title="Folha de atalhos (?)">? ATALHOS</button>
```

Entre `</aside>` e a linha `<script>` do script principal (a que começa com `'use strict';`), inserir:

```html
<dialog id="shortcuts-sheet" aria-labelledby="shortcuts-title">
  <div class="sc-head">
    <h2 id="shortcuts-title">ATALHOS</h2>
    <span class="sc-note">atalhos da TIMELINE valem na etapa 04</span>
    <button type="button" class="hdr-btn" id="shortcuts-close">FECHAR · ESC</button>
  </div>
  <div class="sc-grid" id="shortcuts-grid"></div>
</dialog>
```

Imediatamente antes de `</style>` inserir:

```css
/* ---------------- folha de atalhos (?) */
#shortcuts-sheet{margin:auto; width:min(680px, calc(100vw - 48px)); max-height:80vh; overflow:auto; padding:22px;
  color:var(--ink); background:linear-gradient(180deg, rgba(28,29,64,.97), rgba(12,13,30,.98));
  border:1px solid rgba(251,191,36,.35); border-radius:16px; box-shadow:0 40px 80px -30px rgba(0,0,0,.9)}
#shortcuts-sheet::backdrop{background:rgba(5,5,12,.72); backdrop-filter:blur(6px)}
#shortcuts-sheet[open]{animation:sc-in var(--dur-2) var(--ease-out)}
@keyframes sc-in{from{opacity:0; transform:scale(.96)}}
.sc-head{display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px}
.sc-head h2{font:400 22px var(--disp); letter-spacing:.14em}
.sc-note{flex:1; font:400 var(--fs-micro) var(--mono); color:var(--faint); letter-spacing:.04em}
.sc-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px}
.sc-group h3{font:600 var(--fs-micro) var(--sans); letter-spacing:.18em; color:var(--go); margin-bottom:4px}
.sc-row{display:flex; align-items:center; gap:6px; margin-top:6px}
.sc-row kbd{font:500 var(--fs-micro) var(--mono); color:var(--ink); border:1px solid var(--line); border-radius:6px;
  padding:2px 7px; min-width:30px; text-align:center; background:rgba(10,11,26,.8)}
.sc-row span{margin-left:4px; font:400 var(--fs-sm) var(--sans); color:var(--dim)}

/* ---------------- microinterações da TIMELINE (marcas de uso único no JS) */
@keyframes bt-clip-in{from{opacity:0; transform:scale(.96)}}
.bt-clip.bt-enter{transform-origin:left center; animation:bt-clip-in var(--dur-2) var(--ease-out)}
@keyframes bt-split-flash{from{box-shadow:inset 2px 0 0 var(--go)}to{box-shadow:inset 2px 0 0 transparent}}
.bt-split{animation:bt-split-flash var(--dur-3) linear}
.bt-playhead.bt-seek{transition:left var(--dur-1) var(--ease-in-out)}
```

No script global, logo após o `})();` da IIFE de densidade (Task 3), inserir:

```js
/* ---------------- folha de atalhos (?)
   SHORTCUTS lista exatamente o que o handler de teclado da TIMELINE registra,
   mais `?` e Esc. Ao mexer no `switch` de keydown da TIMELINE, mexer aqui. */
window.SHORTCUTS = [
  { group: 'Reprodução', keys: ['Espaço'], desc: 'tocar / pausar' },
  { group: 'Reprodução', keys: ['J'], desc: 'voltar (repetir acelera)' },
  { group: 'Reprodução', keys: ['K'], desc: 'parar' },
  { group: 'Reprodução', keys: ['L'], desc: 'avançar (repetir acelera)' },
  { group: 'Reprodução', keys: [','], desc: 'voltar 1 frame' },
  { group: 'Reprodução', keys: ['.'], desc: 'avançar 1 frame' },
  { group: 'Reprodução', keys: ['Home'], desc: 'ir para o início' },
  { group: 'Reprodução', keys: ['End'], desc: 'ir para o fim' },
  { group: 'Edição', keys: ['I'], desc: 'marcar entrada' },
  { group: 'Edição', keys: ['O'], desc: 'marcar saída' },
  { group: 'Edição', keys: ['S'], desc: 'dividir o beat no playhead' },
  { group: 'Edição', keys: ['M'], desc: 'unir o beat selecionado ao próximo' },
  { group: 'Edição', keys: ['R'], desc: 'renomear o beat selecionado' },
  { group: 'Edição', keys: ['Delete', 'Backspace'], desc: 'apagar os clipes selecionados' },
  { group: 'Edição', keys: ['Ctrl+Z'], desc: 'desfazer' },
  { group: 'Edição', keys: ['Ctrl+⇧+Z'], desc: 'refazer' },
  { group: 'Zoom', keys: ['+', '='], desc: 'aproximar' },
  { group: 'Zoom', keys: ['-'], desc: 'afastar' },
  { group: 'Zoom', keys: ['\\'], desc: 'caber na janela' },
  { group: 'Zoom', keys: ['Ctrl+roda'], desc: 'zoom no ponteiro do mouse' },
  { group: 'Geral', keys: ['?'], desc: 'abrir esta folha' },
  { group: 'Geral', keys: ['Esc'], desc: 'fechar popover ou esta folha' },
];
(() => {
  const dlg = $('#shortcuts-sheet');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  let opener = null, rendered = false;
  // DOM em vez de innerHTML: as teclas incluem '\' e não precisam de escape
  function render() {
    const grid = $('#shortcuts-grid');
    const groups = new Map();
    for (const s of window.SHORTCUTS) {
      if (!groups.has(s.group)) {
        const g = document.createElement('div');
        g.className = 'sc-group';
        const h = document.createElement('h3');
        h.textContent = s.group.toUpperCase();
        g.appendChild(h);
        groups.set(s.group, g);
        grid.appendChild(g);
      }
      const row = document.createElement('div');
      row.className = 'sc-row';
      for (const k of s.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        row.appendChild(kbd);
      }
      const d = document.createElement('span');
      d.textContent = s.desc;
      row.appendChild(d);
      groups.get(s.group).appendChild(row);
    }
    rendered = true;
  }
  function open() {
    if (dlg.open) return;
    if (!rendered) render();
    opener = document.activeElement;
    dlg.showModal();
  }
  // o foco volta a quem abriu, sem depender de o navegador fazer isso sozinho
  dlg.addEventListener('close', () => {
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
  });
  $('#shortcuts-close').onclick = () => dlg.close();
  $('#shortcuts-btn').onclick = open;
  document.addEventListener('keydown', e => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    open();
  });
})();
```

No handler de teclado da TIMELINE, a primeira linha do corpo de `document.addEventListener('keydown', (e) => {` passa a ser:

```js
    if (document.querySelector('dialog[open]')) return; // folha de atalhos aberta: nada de J/K/L por trás
```

- [ ] **Step 5 [Executor]: Microinterações**

Logo após `  let selectedClipSet = new Set(); // multi-seleção …` inserir:

```js
  // Marcas de uso único para microinteração: o próximo renderTracks() anima só o
  // item marcado e as zera. renderTracks reconstrói por innerHTML — sem a marca,
  // a animação repetiria a cada render (a cada frame de arraste).
  let justAdded = null, justSplit = null; // {track: 'beats'|'broll'|'music'|'video', idx}
  function fxClass(track, i) {
    let c = '';
    if (justAdded && justAdded.track === track && justAdded.idx === i) c += ' bt-enter';
    if (justSplit && justSplit.track === track && justSplit.idx === i) c += ' bt-split';
    return c;
  }
```

| Função | Trecho atual | Vira |
|---|---|---|
| `splitBeatAt` | `    selected = idx;` seguido de `    snapshot(); renderTracks();` | `    selected = idx;` + nova linha `    justSplit = { track: 'beats', idx: idx + 1 };` + `    snapshot(); renderTracks();` |
| `addClipAt` | `    selectedClip = { track, index: clipsFor(track).length - 1 };` | a mesma linha + nova linha `    justAdded = { track, idx: clipsFor(track).length - 1 };` |
| `renderBeatsTrack` | `el.className = 'bt-beat' + (i === selected ? ' selected' : '');` | `el.className = 'bt-beat' + (i === selected ? ' selected' : '') + fxClass('beats', i);` |
| `renderClipTrack` | `` return `<div class="bt-clip ${track}${sel}" data-track="${track}" data-idx="${i}" `` | `` return `<div class="bt-clip ${track}${sel}${fxClass(track, i)}" data-track="${track}" data-idx="${i}" `` |
| `splitClipAt` | `    selectedClip = { track, index: i + 1 };` seguido de `    if (track === 'video') recomputeDuration();` | a mesma linha + nova linha `    justSplit = { track, idx: i + 1 };` antes de `if (track === 'video') recomputeDuration();` |
| `duplicateClip`, ramo `if (track === 'video')` | `      selectedClip = { track, index: i + 1 };` | a mesma linha + nova linha `      justAdded = { track, idx: i + 1 };` |
| `duplicateClip`, depois do ramo de vídeo | `    selectedClip = { track, index: clipsFor(track).length - 1 };` | a mesma linha + nova linha `    justAdded = { track, idx: clipsFor(track).length - 1 };` |
| `renderVideoTrack` | `` return `<div class="bt-clip video${sel}" data-track="video" data-idx="${i}" `` | `` return `<div class="bt-clip video${sel}${fxClass('video', i)}" data-track="video" data-idx="${i}" `` |
| `renderTracks` | `    syncPlayer();` (última linha da função) | `    syncPlayer();` + nova linha `    justAdded = null; justSplit = null;` |

Imediatamente antes de `  function seekTo(t) {` inserir:

```js
  /* Seek discreto (clique na régua, Home/End, linha da legenda) desliza em vez de
     saltar. É opt-in: play, scrub, J/K/L e frame a frame chamam seekTo sem opts e
     não ganham transição — senão o playhead atrasaria em relação ao vídeo. */
  function glidePlayhead() {
    const ph = $q('#bt-playhead');
    if (!ph) return;
    ph.classList.add('bt-seek');
    const done = () => { ph.classList.remove('bt-seek'); ph.removeEventListener('transitionend', done); };
    ph.addEventListener('transitionend', done);
    setTimeout(done, 250); // reduced-motion zera a transição e o transitionend pode não chegar
  }
```

`  function seekTo(t) {` → `  function seekTo(t, opts) {`, e logo após a linha `    t = Math.max(0, Math.min(DURATION, t));` dessa função inserir `    if (opts && opts.animate) glidePlayhead();`.

| Chamador | Trecho atual | Vira |
|---|---|---|
| `onRulerMouseDown` | `seekTo(snapTime(pageXToTime(e.clientX)));` (na linha de `function onRulerMouseDown`) | `seekTo(snapTime(pageXToTime(e.clientX)), { animate: true });` |
| `keydown` Home | `case 'Home': e.preventDefault(); seekTo(0); break;` | `case 'Home': e.preventDefault(); seekTo(0, { animate: true }); break;` |
| `keydown` End | `case 'End': e.preventDefault(); seekTo(DURATION); break;` | `case 'End': e.preventDefault(); seekTo(DURATION, { animate: true }); break;` |
| `renderLegendList` | `row.onclick = () => { selected = +row.dataset.idx; seekTo(beatStart(selected)); renderTracks(); };` | `row.onclick = () => { selected = +row.dataset.idx; seekTo(beatStart(selected), { animate: true }); renderTracks(); };` |

- [ ] **Step 6 [Executor]: Checagem estática** — rodar o script do Step 1. Expected: `PASS: Task 5 estático`.

- [ ] **Step 7 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 6. Parar aqui.

- [ ] **Step 8 [Orquestrador]: `validator`** — "validar a Task 5 de `docs/plans/ui-premium-timeline.md`; rodar o script do Step 1; conferir que os 21 ids e os handlers de `wireTransport()` não mudaram, e que `seekTo` sem `opts` se comporta como antes".

- [ ] **Step 9 [Orquestrador]: Probe** — recarregar `?probe=1`, `load`, `await uiProbe.run('E3b')`. Expected: PASS, incluindo `transport-ids`, `shortcut-sheet` e `density` com `overflow:false` nas duas densidades. Repetir com o bundle bloqueado (rota canvas).

- [ ] **Step 10 [Usuário]: Checklist manual** (itens 1–12, nas duas densidades) + adicionar clipe de B-ROLL (anima uma vez; arrastar logo depois não repete) + `S` num beat (flash uma vez) + clicar na régua (playhead desliza) + play logo depois (sem atraso visível) + `?` e fechar com `Esc` real (foco volta) + `J` com a folha aberta (nada acontece) + passar o mouse em FIT (badge mostra `\`).

- [ ] **Step 11 [Orquestrador → Usuário]: `git-workflow`** fase 1 (staging: `public/index.html`) → aprovação → fase 2 (commit `Group TIMELINE transport, add shortcut sheet and seek/clip micro-interactions (E3b)`) → fase 3 (push) e PR de `feat/ui-premium-timeline` para `main`, se o usuário pedir.

---

## Verificação

_Seção do Orquestrador. Por task: comando do probe, resultado (`ok` + falhas), ajustes de uma linha feitos (ex.: `--bt-labelw`), e o resultado do checklist manual informado pelo usuário._

---

## Status

_Seção de propriedade exclusiva do Executor. Registrar aqui, por task: comando rodado, saída observada, desvio do plano (com motivo) e o que ficou pendente. Updates incrementais — acrescentar, não apagar._
