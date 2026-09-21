# Mixagem de áudio da TIMELINE (sub-projeto B) — Implementation Plan

> **Para workers agênticos:** este plano segue o fluxo do `CLAUDE.md`: Orquestrador → subagente `executor` → subagente `validator` → `git-workflow`. **Uma task por invocação do executor**, na ordem 1 → 4. Steps usam checkbox (`- [ ]`). Steps marcados **[Orquestrador]** ou **[Usuário]** não são do executor: o executor para no último step marcado **[Executor]** e atualiza `## Status`.

**Goal:** Acrescentar à TIMELINE uma track SFX e transformar mudo/solo em controles de mixagem de verdade, com o arquivo exportado soando como o preview.

**Architecture:** Quatro etapas, um PR cada. B0 corrige dois bugs de preview da TRILHA que a SFX herdaria. B1 muda só o servidor: sidecar v4 (`sfx`, `mix`), a regra de mudo/solo no conform, mono sem os −3 dB e a medição de pico. Não mexe na UI, e um sidecar antigo gera exatamente o mesmo grafo de hoje. B2 põe a lane SFX nas duas rotas de preview e troca a prop do Player por `audible` (o bundle muda aqui e só aqui). B3 troca as chaves da TRILHA por `MIX` persistido, com M/S/L nas três tracks de áudio, e a mensagem do CONFORMAR diz o que ficou fora e qual foi o pico.

**Tech Stack:** HTML/CSS/JS vanilla num arquivo só (`public/index.html`, sem build); Node ≥18 sem npm (`server.js`, `lib/`); ffmpeg 6.1; Remotion 4.0.494 + esbuild (`remotion/`, só para o bundle do Player); Chrome (verificação de runtime).

**Spec:** `docs/superpowers/specs/2026-09-21-mixagem-audio-design.md`. O executor lê a spec antes da Task 1. Números de linha citados referem-se a `c3c8012`; **localize sempre pelo trecho citado**, não pelo número, porque cada task desloca as linhas das seguintes.

**Como este plano foi escrito:** toda troca e todo script abaixo foram aplicados e rodados numa cópia do repo antes de entrar aqui, na ordem das tasks (B0 → B1 → B2 → B3): cada checagem estática com FAIL antes e PASS depois; o bundle reconstruído; o `tsc` sem erro novo; os testes do B1 com ffmpeg e servidor reais; e a UI de B2/B3 no navegador, com o probe passando — inclusive com som tocando de verdade nas duas rotas, a 1280×800, e o bug do B0 reproduzido no `HEAD`. Os blocos são cópia literal do que foi testado.

## Global Constraints

- Zero dependência nova (npm ou outra). O B2 usa o `esbuild` que `remotion/` já tem para `npm run build:player`.
- Tocar só os arquivos listados em cada task. `lib/encode.js`, `lib/color.js`, `lib/assemble.js`, `lib/captions.js`, `styles/` e a parte de vídeo do grafo do conform ficam intocados. `lib/ffmpeg.js` só ganha o campo `channels` no `mediaInfo` (Task 2).
- Os handlers de arraste só ganham `'sfx'` nas listas de tracks e o mapa `CLIP_HOST`; nenhuma regra de arraste muda para as tracks existentes.
- `normalize=0` continua no `amix`; o áudio de B-ROLL continua descartado; todo caminho de clipe do sidecar continua passando por `resolveInput()`.
- Sidecar antigo (v2/v3, sem `sfx`/`mix`) nunca gera erro de leitura e soa como antes.
- O Player continua sendo só preview; `POST /api/timeline/conform` continua o único caminho até o arquivo.
- Invariantes do sub-projeto A continuam valendo: nenhum texto abaixo de 11px fora das isenções declaradas (`isento:`); nenhuma duração de transição/animação literal (só `var(--dur-1..4)`); `@media (prefers-reduced-motion: reduce)` global intocado; nenhuma chave nova em `localStorage`; nenhum `id` existente muda de nome (o único novo é `bt-track-sfx`).
- Scripts de checagem: salvar cada bloco em `jobs/checks/<nome>.js` (a pasta `jobs/` é ignorada pelo git) e rodar `node jobs/checks/<nome>.js` **a partir da raiz do repo**. Nunca por heredoc `node - <<'NODE'`: o Git Bash deste ambiente come as barras invertidas. **Nunca editar um script de checagem para fazê-lo passar**; se um script parecer errado, parar e reportar ao Orquestrador.
- O working tree está em CRLF (`core.autocrlf=true`) e os trechos deste plano estão em LF. A ferramenta Edit casa os dois; um script que compare texto normaliza com `.replace(/\r\n/g, '\n')` (os deste plano já fazem isso).
- O executor **não commita** e trabalha sobre a `main` local sincronizada. Git só pelo `git-workflow`: `prepare` (branch `feat/audio-mix-b<N>`) → OK do usuário → `publish`. **Um PR por task.**
- Condições de medição no navegador: `node server.js`; janela com viewport 1280×800 **visível** (em aba oculta o Chrome não carrega mídia); URL `http://localhost:4870/?probe=1`; fixture `output/assembled-4545f906507a.mp4`, carregada por `await uiProbe.load('output/assembled-4545f906507a.mp4')` logo após recarregar a página; depois colar o bloco de auxiliares (seção abaixo). Rota canvas: DevTools → Network → *Block request URL* `/vendor/studio-player.js`, recarregar — feito pelo usuário.
- O `javascript_tool` do Chrome tem limite de 45s por chamada: esperas longas (conform) vão em chamadas separadas.
- Reprodução: o play se dá com a tecla **Espaço** pela ferramenta de teclado do Chrome (evento real, aceito pela política de autoplay); `T.record` antes, `T.pause()` e `T.stop()` depois. Clicar por coordenada falha quando a página rola até o playhead, e um `click()` por script alterna play/pause sem saber o estado. O `uiProbe.run(...)` anda o playhead ~0,6s: `T.key('Home')` antes de montar cena.

## File Structure

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `public/index.html` | `<audio>` por ocorrência e slider ao vivo (B0); lane SFX, `audibleNow`, teto de 16, fragmento por clipe (B2); `MIX`, M/S/L, `.silent`, persistência, mensagem do conform (B3) | 1, 3, 4 |
| `lib/timeline.js` | `normalizeMix`, `audible`, SFX no grafo, mono sem −3 dB, `measurePeak`, `peakWarnOf`, retorno com `sfx`/`mix`/`excluded`/`peakDb`/`peakWarn` | 2 |
| `lib/ffmpeg.js` | `mediaInfo` com `channels` | 2 |
| `server.js` | sidecar v4 (`sfx`, `mix` saneado); conform lê `sfx` e `mix` | 2 |
| `remotion/src/scenes/TimelinePreview.tsx` | props `sfx` e `audible`; `<Audio>` só de track audível | 3 |
| `remotion/src/player-entry.tsx` | `numberOfSharedAudioTags={16}` | 3 |
| `public/vendor/studio-player.js` | bundle regenerado por `npm run build:player` | 3 |
| `public/dev/ui-probe.js` | estágios `B2`/`B3`, `track-order` e `text-floor` por estágio, checks `sfx-lane`, `audio-controls`, `solo-exclusive`, `silent-lanes` | 3, 4 |

## Checklist manual de regressão

O checklist do sub-projeto A (itens 1–12 de `docs/plans/ui-premium-timeline.md`, "Checklist manual de regressão") continua valendo em toda task deste plano, com uma troca a partir da Task 4: o item 8 vira "M/S nas tracks de áudio refletem no preview; H em MARKERS, B-ROLL e LEGENDA reflete no preview". Cada task acrescenta os itens próprios dela.

## Auxiliares do Orquestrador (console do navegador)

Colar no console depois do `uiProbe.load(...)`. Os steps de verificação usam `T.*`.

```js
// Auxiliares do Orquestrador para o console da TIMELINE (sub-projeto B). Colar depois de
// `await uiProbe.load('output/assembled-4545f906507a.mp4')`. Só usa DOM, teclado e o global
// addAsset — o closure da TIMELINE continua invisível, como no probe.
window.T = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  key: (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o })),
  btn: (track, act) => document.querySelector(`.bt-track-row[data-track="${track}"] .bt-tctl[data-act="${act}"]`),
  // tons gerados na Task 0 em jobs/b-check/; `dur` é o que o upload guardaria em info.duration
  asset: (name, dur) => addAsset({ path: 'jobs/b-check/' + name, name, kind: 'audio', info: { duration: dur }, source: 'probe' }),
  async add(track, name) {
    T.btn(track, 'add').click(); await T.sleep(150);
    const opt = [...document.querySelectorAll('.bt-pop .bt-asset-opt')].find(b => b.textContent === name);
    if (!opt) throw new Error('asset ' + name + ' não aparece no + da track ' + track);
    opt.click(); await T.sleep(250);
  },
  async steps(n, key) { for (let i = 0; i < n; i++) T.key(key); await T.sleep(100); }, // 1 passo = 1 frame (1/30 s)
  async menu(track, idx, id) {
    const el = document.querySelector(`#bt-track-${track} .bt-clip[data-idx="${idx}"]`), r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    await T.sleep(100); document.getElementById(id).click(); await T.sleep(200);
  },
  // espião nas props que o app manda ao Player (rota Player): conta updates e guarda a última
  spy() {
    const SP = window.StudioPlayer;
    if (!SP || SP.__spy) return;
    const orig = SP.update;
    SP.update = function (p) { T.updates = (T.updates || 0) + 1; T.props = JSON.parse(JSON.stringify(p)); return orig.apply(this, arguments); };
    SP.__spy = true;
  },
  clips: track => document.querySelectorAll(`#bt-track-${track} .bt-clip`).length,
  // <audio> da rota canvas: o compositor os anexa ao <body>
  audios: name => [...document.querySelectorAll('body > audio')].filter(a => a.src.includes(name))
    .map(a => ({ paused: a.paused, t: +a.currentTime.toFixed(2) })),
  // estado compacto: rota canvas → 'p▶' (um caractere por elemento); rota Player → '▶sfx0 ▶sfx1'
  state: name => T.audios(name).map(x => x.paused ? 'p' : '▶').join(''),
  tags: name => [...document.querySelectorAll('#bt-player audio')].filter(a => a.src.includes(name))
    .map(a => (a.paused ? 'p' : '▶') + (a.src.split('#')[1] || '')).join(' '),
  // Amostra `fn()` a cada 100 ms com o relógio da TIMELINE; stop() devolve só as mudanças.
  // Uma leitura só engana: o vídeo da fixture (121 MB) demora a arrancar depois do play.
  record(fn) {
    // sem foco em botão: senão o Espaço aciona o botão focado em vez do play
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    T._rec = [];
    T._timer = setInterval(() => T._rec.push([document.getElementById('bt-time').firstChild.textContent, fn()]), 100);
  },
  stop() {
    clearInterval(T._timer);
    const out = []; let last = null;
    for (const [t, s] of T._rec) { if (s !== last) out.push(t + ' ' + s); last = s; }
    return out;
  },
  // O play se dá com a tecla Espaço pela ferramenta de teclado do Chrome (evento real: conta
  // como gesto para a política de autoplay). Clicar por coordenada falha quando a página rola
  // até o playhead. Para pausar, pause() — o botão alterna, então só clica se estiver tocando.
  pause() {
    const v = document.getElementById('bt-video');
    const playing = v ? !v.paused : !!(window.StudioPlayer && StudioPlayer.isPlaying());
    if (playing) document.getElementById('bt-play').click();
  },
  playerBroken: () => !!document.querySelector('#bt-player') && document.querySelector('#bt-player').innerText.includes('⚠'),
  stage: () => [...document.querySelectorAll('[aria-live]')].map(e => e.textContent).join(' | '),
  async sidecar() {
    const j = await (await fetch('/api/beats?video=' + encodeURIComponent('output/assembled-4545f906507a.mp4'))).json();
    return j.beats && { version: j.beats.version, sfx: (j.beats.sfx || []).length, music: (j.beats.music || []).length, mix: j.beats.mix };
  },
};
'T pronto';
```

---

### Task 0: Preparo (Orquestrador, antes de qualquer execução)

- [ ] **[Orquestrador]** Spec e plano commitados pelo `git-workflow` (`prepare` → OK do usuário → `publish`), num PR só de documentação: branch `docs/audio-mix-plan`, arquivos `docs/superpowers/specs/2026-09-21-mixagem-audio-design.md` e `docs/plans/mixagem-audio.md`, commit `Add design spec and plan for audio mixing (sub-project B)`.
- [ ] **[Orquestrador]** Mídia de teste (fora do git, em `jobs/b-check/`):

```bash
mkdir -p jobs/b-check
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=1000:d=0.8" jobs/b-check/whoosh.wav   # mono, 0,8s
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=330:d=10" -ac 2 jobs/b-check/bed.wav  # estéreo, 10s
cp output/assembled-4545f906507a.beats.json jobs/b-check/fixture.beats.json.bak                  # sidecar v3 da fixture
```

- [ ] **[Orquestrador]** Antes de cada task: `git-workflow` `sync` se `origin/main` puder ter andado; o executor roda sobre a `main` local limpa. Depois dos testes de navegador de cada task, restaurar o sidecar da fixture: `cp jobs/b-check/fixture.beats.json.bak output/assembled-4545f906507a.beats.json`.

---

### Task 1 (B0): TRILHA no preview — um `<audio>` por ocorrência e ganho ao vivo no Player

**Files:**
- Modify: `public/index.html` — `const mediaCache`, `pruneMediaCache()`, `clearMediaCache()`, `getMusicAudioEl()` (vira `getAudioEl()`), laço `MUSIC.forEach` do `compositeTick()`, listener `input` do `.bt-clip-vol` em `renderClipTrack()`.

**Interfaces:**
- Consumes: `mediaCache`, `MUSIC`, `BROLL`, `syncPlayer()` (existentes).
- Produces: `function getAudioEl(path, k): HTMLAudioElement` — um elemento por ocorrência `k` do arquivo `path`; entrada do `mediaCache` passa a ser `{ video?, audios?: HTMLAudioElement[] }`. A Task 3 estende o laço para a SFX e conta TRILHA + SFX no `pruneMediaCache()`.

- [ ] **Step 1 [Orquestrador + Usuário]: Reproduzir os dois bugs antes da mudança**

Rota Player (servidor rodando o `HEAD`, condições de medição, auxiliares colados):

```js
T.asset('bed.wav', 10); await T.add('music', 'bed.wav'); T.spy(); T.updates = 0;
const inp = document.querySelector('#bt-track-music .bt-clip-vol');
inp.value = '0.4'; inp.dispatchEvent(new Event('input'));
({ updates: T.updates })
```

Esperado no `HEAD`: `{ updates: 0 }` (o ganho não chega ao Player).

Rota canvas (usuário bloqueia `/vendor/studio-player.js` e recarrega; `load` e auxiliares de novo):

```js
T.asset('bed.wav', 10); await T.add('music', 'bed.wav');   // clipe em 0–3s
await T.steps(45, 'ArrowRight');                            // playhead em 1,5s
await T.menu('music', 0, 'bt-menu-split');                  // DIVIDIR NO PLAYHEAD
T.key('Home'); await T.sleep(200); await T.steps(6, 'ArrowRight');   // 0,2s: antes do corte
T.record(() => 'trilha[' + T.state('bed.wav') + ']');
T.clips('music')
```

Pressionar **Espaço** com a ferramenta de teclado do Chrome (evento real; ver `T.pause`). Depois:

```js
await T.sleep(2500); T.pause(); T.stop()
```

Esperado no `HEAD` (`clips: 2`): enquanto o relógio está na primeira metade (até ~1,4s), `trilha[p]` — **um** elemento, pausado: o laço só lhe ajusta o `currentTime`. Ele passa a `trilha[▶]` só na segunda metade (~1,5s) e volta a `p` em 3,0s. No reteste do plano: `00:00.2 trilha[p]` … `00:01.4 trilha[▶]` … `00:03.0 trilha[p]`. Registrar as duas saídas em `## Verificação`. Restaurar o sidecar da fixture.

- [ ] **Step 2 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b0-static.js`:

```js
// B0 — checagem estática de public/index.html. Rodar da raiz: node jobs/checks/b0-static.js
'use strict';
const fs = require('fs');
const src = fs.readFileSync('public/index.html', 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const fail = [];
const has = t => src.includes(t);
const count = re => (src.match(re) || []).length;

// Invariantes do sub-projeto A (valem em toda etapa do B).
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

// B0 — um <audio> por ocorrência.
if (has('getMusicAudioEl')) fail.push('getMusicAudioEl ainda existe');
if (/entry\.audio\b(?!s)/.test(src)) fail.push('ainda há entry.audio (singular)');
for (const t of ['function getAudioEl(path, k) {', 'entry.audios[k] = a;',
  'const seen = new Map(); // path -> ocorrências já servidas nesta passada',
  'const el = getAudioEl(c.path, k);',
  'if (entry.audios) entry.audios.splice(uses).forEach(a => { if (a) { a.pause(); a.remove(); } });',
  'if (entry.audios) entry.audios.forEach(a => { if (a) { a.pause(); a.remove(); } });'])
  if (!has(t)) fail.push('ausente: ' + t);
if (count(/getAudioEl\(/g) !== 2) fail.push('getAudioEl deveria aparecer 2× (definição + laço), achado ' + count(/getAudioEl\(/g));

// B0 — slider de ganho avisa o Player.
if (!has("inp.addEventListener('input', () => { MUSIC[+inp.dataset.idx].volume = +inp.value; syncPlayer(); });"))
  fail.push('o input do slider de ganho não chama syncPlayer()');

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B0 estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b0-static.js`. Esperado: `FAIL` com `getMusicAudioEl ainda existe`, `ainda há entry.audio (singular)`, seis linhas `ausente:`, `getAudioEl deveria aparecer 2× (definição + laço), achado 0` e `o input do slider de ganho não chama syncPlayer()`.

- [ ] **Step 3 [Executor]: Aplicar as 6 trocas em `public/index.html`**

**public/index.html · troca 1 — mediaCache: forma da entrada.** Substituir:

```html
  const mediaCache = new Map(); // path -> {video?, audio?} — elementos ocultos pro compositor
```

por:

```html
  const mediaCache = new Map(); // path -> {video?, audios?: []} — elementos ocultos pro compositor
```

**public/index.html · troca 2 — pruneMediaCache.** Substituir:

```html
  function pruneMediaCache() {
    for (const [path, entry] of mediaCache) {
      const stillBroll = BROLL.some(c => c.path === path);
      const stillMusic = MUSIC.some(c => c.path === path);
      if (!stillBroll && entry.video) { entry.video.pause(); entry.video.remove(); entry.video = null; }
      if (!stillMusic && entry.audio) { entry.audio.pause(); entry.audio.remove(); entry.audio = null; }
      if (!entry.video && !entry.audio) mediaCache.delete(path);
    }
  }
```

por:

```html
  function pruneMediaCache() {
    for (const [path, entry] of mediaCache) {
      const stillBroll = BROLL.some(c => c.path === path);
      if (!stillBroll && entry.video) { entry.video.pause(); entry.video.remove(); entry.video = null; }
      // um <audio> por ocorrência: sobram só tantos quantos clipes ainda usam o arquivo
      const uses = MUSIC.filter(c => c.path === path).length;
      if (entry.audios) entry.audios.splice(uses).forEach(a => { if (a) { a.pause(); a.remove(); } });
      if (!entry.video && !(entry.audios && entry.audios.length)) mediaCache.delete(path);
    }
  }
```

**public/index.html · troca 3 — clearMediaCache.** Substituir:

```html
      if (entry.audio) { entry.audio.pause(); entry.audio.remove(); }
```

por:

```html
      if (entry.audios) entry.audios.forEach(a => { if (a) { a.pause(); a.remove(); } });
```

**public/index.html · troca 4 — getMusicAudioEl → getAudioEl(path, k).** Substituir:

```html
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
```

por:

```html
  /* Um <audio> por OCORRÊNCIA do arquivo, não por arquivo. Dois clipes do mesmo
     arquivo (split, duplicar, colar) disputariam um elemento só: o que está fora
     da janela pausava o que está dentro, e a primeira metade de um split ficava
     muda. `k` é a ordem da ocorrência na passada do compositor; reordenar só
     troca qual elemento serve qual clipe, e o seek do laço corrige a posição. */
  function getAudioEl(path, k) {
    let entry = mediaCache.get(path);
    if (!entry) { entry = {}; mediaCache.set(path, entry); }
    if (!entry.audios) entry.audios = [];
    if (!entry.audios[k]) {
      const a = document.createElement('audio');
      a.src = '/files/' + encodeURIComponent(path.replace(/\\/g, '/'));
      a.preload = 'auto';
      document.body.appendChild(a);
      entry.audios[k] = a;
    }
    return entry.audios[k];
  }
```

**public/index.html · troca 5 — compositeTick: laço da TRILHA por ocorrência.** Substituir:

```html
    MUSIC.forEach(c => {
      const el = getMusicAudioEl(c.path);
```

por:

```html
    const seen = new Map(); // path -> ocorrências já servidas nesta passada
    MUSIC.forEach(c => {
      const k = seen.get(c.path) || 0;
      seen.set(c.path, k + 1);
      const el = getAudioEl(c.path, k);
```

**public/index.html · troca 6 — slider de ganho avisa o Player.** Substituir:

```html
        inp.addEventListener('input', () => { MUSIC[+inp.dataset.idx].volume = +inp.value; });
```

por:

```html
        // o Player só relê as props em syncPlayer(); sem isto o ganho mudava na
        // tela e no sidecar, mas o som só no próximo renderTracks()
        inp.addEventListener('input', () => { MUSIC[+inp.dataset.idx].volume = +inp.value; syncPlayer(); });
```

- [ ] **Step 4 [Executor]: Checagem** — `node jobs/checks/b0-static.js`. Esperado: `PASS: B0 estático`.

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 2 e 4 e o número de hunks de `git diff --stat`. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 1 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b0-static.js` (salvar o bloco do Step 2 se não existir); conferir que o diff contra `HEAD` são só as 6 trocas do Step 3; que `getAudioEl` só é chamado no laço do `compositeTick`; e que nenhum outro leitor de `entry.audio` sobrou".

- [ ] **Step 7 [Orquestrador]: Verificar depois** — repetir os dois blocos do Step 1 no código novo. Esperado: rota Player `{ updates: 1 }`; rota canvas `clips: 2` e **dois** elementos: `trilha[▶p]` na primeira metade e `trilha[p▶]` a partir de ~1,4s (no reteste do plano: `00:00.2 trilha[▶p]` · `00:01.4 trilha[p▶]` · `trilha[pp]` perto de 3,0s). Rodar `await uiProbe.run('E3b')` nas duas rotas: `PASS` (o B0 não muda layout). Restaurar o sidecar da fixture.

- [ ] **Step 8 [Usuário]: Checklist manual** (itens 1–12 do A) + rota canvas: dividir um clipe da TRILHA e tocar desde antes do corte (as duas metades soam) + rota Player: arrastar o slider de ganho com o vídeo tocando (o volume muda na hora).

- [ ] **Step 9 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b0`; arquivo `public/index.html`; commit `Fix TRILHA preview: one audio element per clip, live gain (B0)`) → OK do usuário → `publish`.

---

### Task 2 (B1): Conform com SFX, mudo/solo e pico; sidecar v4

**Files:**
- Modify: `lib/timeline.js` — cabeçalho, bloco novo depois de `normalizeClips()`, `buildConformGraph()`, `buildConformArgs()`, `probeClips()`, bloco novo antes de `conform()`, corpo e retorno de `conform()`, `module.exports`.
- Modify: `lib/ffmpeg.js` — retorno de `mediaInfo()`.
- Modify: `server.js` — `require` de `./lib/timeline`, `POST /api/beats`, `POST /api/timeline/conform`.

**Interfaces:**
- Consumes: `runFfmpeg(args, { onLog })`, `mediaInfo(file)` (`lib/ffmpeg.js`); `resolveInput()`, `beatsSidecar()` (`server.js`).
- Produces (usados nas Tasks 3 e 4):
  - `normalizeMix(mix) → { mute: string[], solo: 'audio'|'music'|'sfx'|null }` — `mute` em ordem canônica `['audio','music','sfx']`, sem duplicatas;
  - `audible(mix, track) → boolean` — `!m.mute.includes(track) && (m.solo === null || m.solo === track)`;
  - `measurePeak(file, onLog) → Promise<number|null>` (dB com uma casa; `null` em falha ou silêncio digital);
  - `peakWarnOf(peakDb) → 'clip' | 'hot' | null` (`> 0` → `'clip'`; `≥ −1` → `'hot'`);
  - `conform({ …, sfx = [], mix = null })` devolve, além do de hoje, `sfx` (contagem), `mix` (normalizado), `excluded` (tracks com conteúdo silenciadas pelo mix), `peakDb`, `peakWarn`;
  - `buildConformGraph({ …, sfx = [] })` e `buildConformArgs({ …, sfx = [] })`; clipe de áudio com `channels === 1` ganha `pan=stereo|c0=c0|c1=c0`;
  - sidecar v4: `{ version: 4, …, sfx: [...], mix: { mute, solo } }`;
  - `mediaInfo(file).channels` (número de canais do primeiro áudio, `0` sem áudio).

- [ ] **Step 1 [Executor]: Salvar as duas checagens e confirmar que falham**

Salvar como `jobs/checks/b1-unit.js`:

```js
// B1 — checagem de unidade de lib/timeline.js. Rodar da raiz do repo: node jobs/checks/b1-unit.js
'use strict';
const path = require('path');
const Module = require('module');
const { execSync } = require('child_process');

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Módulo novo (working tree) e o do HEAD, carregado da memória com require relativo a lib/.
const T = require(path.resolve('lib/timeline.js'));
const headSrc = execSync('git show HEAD:lib/timeline.js', { encoding: 'utf8', maxBuffer: 1 << 24 });
const H = (() => {
  const filename = path.resolve('lib/__timeline_head__.js');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(headSrc, filename);
  return m.exports;
})();

// 1 — não-regressão: sem sfx/mix, grafo e args idênticos ao HEAD.
const segs = [{ srcIn: 0, dur: 4 }, { srcIn: 6, dur: 3.5 }];
const music = [{ path: 'm1.wav', start: 0.5, dur: 3, srcIn: 0, volume: 0.8 },
  { path: 'm2.wav', start: 4, dur: 2, srcIn: 1.25, volume: 1 }];
const broll = [{ path: 'b1.mp4', start: 1, dur: 2, srcIn: 0 }];
const fixtures = {
  'só VÍDEO': { segments: segs, broll: [], music: [], hasAudio: true, fit: 'blur', duration: 7.5 },
  'com TRILHA': { segments: segs, broll: [], music, hasAudio: true, fit: 'blur', duration: 7.5 },
  'B-ROLL + TRILHA': { segments: segs, broll, music, hasAudio: true, fit: 'crop', duration: 7.5 },
  'plate sem áudio': { segments: segs, broll, music, hasAudio: false, fit: 'blur', duration: 7.5 },
};
for (const [name, fx] of Object.entries(fixtures)) {
  let gN, gH;
  try { gN = T.buildConformGraph(fx); gH = H.buildConformGraph(fx); }
  catch (e) { fail.push(name + ': grafo lançou ' + e.message); continue; }
  ok(eq(gN, gH), name + ': grafo difere do HEAD');
  const argIn = { base: 'base.mp4', broll: fx.broll, music: fx.music, output: 'out.mp4', duration: fx.duration };
  ok(eq(T.buildConformArgs({ ...argIn, graph: gN }), H.buildConformArgs({ ...argIn, graph: gH })),
    name + ': args diferem do HEAD');
}

// 2 — SFX no grafo: depois da TRILHA, mesma cadeia, amix com todos.
try {
  const sfx = [{ path: 'x1.wav', start: 2, dur: 0.5, srcIn: 0, volume: 0.5 },
    { path: 'x1.wav', start: 5, dur: 0.5, srcIn: 0.1, volume: 1 }];
  const g = T.buildConformGraph({ segments: segs, broll, music, sfx, hasAudio: true, fit: 'blur', duration: 7.5 });
  ok(g.filter.includes('[4:a]atrim=start=0.000000:end=0.500000,asetpts=PTS-STARTPTS,' +
    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.500,adelay=2000|2000[x0]'),
    'SFX: cadeia do primeiro clipe (input 4) ausente ou diferente');
  ok(g.filter.includes('[5:a]atrim=start=0.100000:end=0.600000,') && g.filter.includes('adelay=5000|5000[x1]'),
    'SFX: segundo clipe (input 5, mesmo arquivo) ausente');
  ok(g.filter.includes('[ab][m0][m1][x0][x1]amix=inputs=5:duration=first:dropout_transition=0:normalize=0[aout]'),
    'SFX: amix não soma base + 2 TRILHA + 2 SFX com normalize=0');
  const a = T.buildConformArgs({ base: 'base.mp4', broll, music, sfx, graph: g, output: 'o.mp4', duration: 7.5 });
  const ins = a.reduce((acc, v, i) => (a[i - 1] === '-i' ? acc.concat(v) : acc), []);
  ok(eq(ins, ['base.mp4', 'b1.mp4', 'm1.wav', 'm2.wav', 'x1.wav', 'x1.wav']), 'SFX: ordem dos -i ' + JSON.stringify(ins));
  const g2 = T.buildConformGraph({ segments: segs, broll: [], music: [], sfx: [sfx[0]], hasAudio: true, fit: 'blur', duration: 7.5 });
  ok(g2.filter.includes('[1:a]atrim=') && g2.filter.includes('[ab][x0]amix=inputs=2:'), 'SFX sem TRILHA: input 1 e amix de 2');
  // mono é duplicado nos dois canais antes do aformat (sem os −3 dB do upmix do ffmpeg)
  const g3 = T.buildConformGraph({ segments: segs, broll: [], music: [{ ...music[0], channels: 1 }],
    sfx: [{ ...sfx[0], channels: 2 }], hasAudio: true, fit: 'blur', duration: 7.5 });
  ok(g3.filter.includes('asetpts=PTS-STARTPTS,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp') &&
    (g3.filter.match(/pan=stereo/g) || []).length === 1, 'mono: pan só no clipe de 1 canal');
} catch (e) { fail.push('SFX no grafo lançou ' + e.message); }

// 3 — normalizeMix: sidecar não confiável.
if (typeof T.normalizeMix !== 'function' || typeof T.audible !== 'function') {
  fail.push('normalizeMix/audible não exportadas');
} else {
  const cases = [
    [undefined, { mute: [], solo: null }],
    [null, { mute: [], solo: null }],
    ['sfx', { mute: [], solo: null }],
    [{}, { mute: [], solo: null }],
    [{ mute: 'sfx', solo: 'sfx' }, { mute: [], solo: 'sfx' }],
    [{ mute: ['sfx', 'video', 'sfx', 'audio', 7], solo: 'video' }, { mute: ['audio', 'sfx'], solo: null }],
    [{ mute: ['music'], solo: 'music' }, { mute: ['music'], solo: 'music' }],
  ];
  cases.forEach(([inp, want], k) => ok(eq(T.normalizeMix(inp), want),
    'normalizeMix #' + k + ': ' + JSON.stringify(T.normalizeMix(inp)) + ' ≠ ' + JSON.stringify(want)));

  // 4 — audible: tabela 8 × 4 e as três propriedades da spec.
  const TR = ['audio', 'music', 'sfx'];
  const subsets = [...Array(8).keys()].map(n => TR.filter((_, i) => n & (1 << i)));
  let rows = 0;
  for (const mute of subsets) for (const solo of [null, ...TR]) for (const t of TR) {
    const want = !mute.includes(t) && (solo === null || solo === t);
    ok(T.audible({ mute, solo }, t) === want, `audible(${JSON.stringify({ mute, solo })}, ${t}) ≠ ${want}`);
    rows++;
  }
  ok(rows === 96, 'tabela de audible: ' + rows + ' linhas, esperado 96');
  ok(TR.every(t => T.audible(undefined, t)), 'sem mix, tudo deveria soar');
  ok(!T.audible({ mute: ['sfx'], solo: 'sfx' }, 'sfx'), 'mudo deveria vencer solo');
  ok(T.audible({ solo: 'music' }, 'music') && !T.audible({ solo: 'music' }, 'audio') && !T.audible({ solo: 'music' }, 'sfx'),
    'solo deveria deixar só a própria track');
}

// 5 — limiares de pico.
if (typeof T.peakWarnOf !== 'function') fail.push('peakWarnOf não exportada');
else {
  const pw = [[0.1, 'clip'], [5.5, 'clip'], [0, 'hot'], [-0.4, 'hot'], [-1, 'hot'], [-1.1, null], [-18, null], [null, null]];
  pw.forEach(([v, want]) => ok(T.peakWarnOf(v) === want, `peakWarnOf(${v}) = ${T.peakWarnOf(v)}, esperado ${want}`));
}

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B1 unidade');
process.exitCode = fail.length ? 1 : 0;
```

Salvar como `jobs/checks/b1-e2e.js`:

```js
// B1 — checagem ponta a ponta: conforms reais com mídia sintética, e o servidor
// (sidecar v4 + rota de conform) numa porta de teste. Rodar da raiz do repo:
//   node jobs/checks/b1-e2e.js
// Gera tudo em jobs/b1-check/ (gitignored) e apaga no fim se passar.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'jobs', 'b1-check');
const PORT = 4879;
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').split('\n').slice(-4).join(' | '));
  return r.stderr;
}
// RMS (dB) do áudio de `file` entre a e b segundos; -Infinity = silêncio digital.
function rms(file, a, b) {
  const log = ff(['-nostats', '-i', file, '-map', '0:a:0',
    '-af', `atrim=start=${a}:end=${b},astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-']);
  const m = /RMS level dB:\s*(-?inf|-?[\d.]+)/.exec(log);
  if (!m) throw new Error('RMS não encontrado em ' + file);
  return /inf/.test(m[1]) ? -Infinity : parseFloat(m[1]);
}
const SOM = v => v > -40, SILENCIO = v => v < -60;
// Janelas: A = tom do plate (0–1s); S = SFX (2,0–2,5s); M = TRILHA (3,5–4,5s); Q = nada.
const WIN = { A: [0.1, 0.9], S: [2.1, 2.4], M: [3.6, 4.4], Q: [5.0, 5.9] };
function windows(file) {
  const o = {};
  for (const [k, [a, b]] of Object.entries(WIN)) o[k] = rms(file, a, b);
  return o;
}
function expectWin(tag, w, want) {
  for (const [k, kind] of Object.entries(want)) {
    const v = w[k];
    ok(kind === 'som' ? SOM(v) : SILENCIO(v), `${tag}: janela ${k} deveria ter ${kind}, RMS ${v} dB`);
  }
}

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const P = n => path.join(DIR, n);

  // Mídia sintética. O tom do lavfi `sine` tem pico 1/8 (−18 dBFS).
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=220:d=1',
    '-af', 'apad=whole_dur=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '6', P('base.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=1000:d=0.5', P('sfx.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=1', P('music.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=1', '-af', 'volume=18dB', P('loud.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=1', '-af', 'volume=17.5dB', P('hot.wav')]);

  const { conform } = require(path.join(ROOT, 'lib', 'timeline.js'));
  const SFX = [{ path: P('sfx.wav'), name: 'sfx.wav', start: 2, dur: 0.5, srcIn: 0, volume: 1 }];
  const MUS = [{ path: P('music.wav'), name: 'music.wav', start: 3.5, dur: 1, srcIn: 0, volume: 1 }];
  let n = 0;
  const run = async (opts) => {
    n++;
    return conform({ base: P('base.mp4'), segments: [], output: P('out' + n + '.mp4'), workDir: P('w' + n), ...opts });
  };

  // C1 — sem mix: tudo soa.
  let r = await run({ music: MUS, sfx: SFX });
  const w1 = windows(r.output);
  expectWin('C1 padrão', w1, { A: 'som', S: 'som', M: 'som', Q: 'silêncio' });
  // Tom mono de pico −18 dBFS: RMS por canal ≈ −21 dB se duplicado, ≈ −24 dB com o upmix de −3 dB do ffmpeg.
  ok(w1.S > -22.5 && w1.M > -22.5, 'C1: mono perdeu 3 dB no export — RMS S ' + w1.S + ', M ' + w1.M);
  ok(r.sfx === 1 && r.music === 1, 'C1: contagens sfx/music ' + r.sfx + '/' + r.music);
  ok(JSON.stringify(r.excluded) === '[]', 'C1: excluded ' + JSON.stringify(r.excluded));
  ok(typeof r.peakDb === 'number' && r.peakDb < -12 && r.peakWarn === null, 'C1: pico ' + r.peakDb + ' / ' + r.peakWarn);

  // C2 — SFX muda.
  r = await run({ music: MUS, sfx: SFX, mix: { mute: ['sfx'] } });
  expectWin('C2 mute sfx', windows(r.output), { A: 'som', S: 'silêncio', M: 'som' });
  ok(JSON.stringify(r.excluded) === '["sfx"]' && r.sfx === 0, 'C2: excluded ' + JSON.stringify(r.excluded) + ' sfx ' + r.sfx);

  // C3 — solo da SFX: plate e TRILHA fora.
  r = await run({ music: MUS, sfx: SFX, mix: { solo: 'sfx' } });
  expectWin('C3 solo sfx', windows(r.output), { A: 'silêncio', S: 'som', M: 'silêncio' });
  ok(JSON.stringify(r.excluded) === '["audio","music"]', 'C3: excluded ' + JSON.stringify(r.excluded));

  // C4 — mudo vence solo: ÁUDIO muda e em solo → nada soa.
  r = await run({ music: MUS, sfx: SFX, mix: { mute: ['audio'], solo: 'audio' } });
  expectWin('C4 mute+solo audio', windows(r.output), { A: 'silêncio', S: 'silêncio', M: 'silêncio' });
  ok(JSON.stringify(r.excluded) === '["audio","music","sfx"]', 'C4: excluded ' + JSON.stringify(r.excluded));
  ok(r.peakDb === null && r.peakWarn === null, 'C4: silêncio deveria dar pico null, deu ' + r.peakDb);

  // C5 — dois tons em escala cheia sobrepostos: acima de 0 dBFS.
  r = await run({ music: [{ ...MUS[0], path: P('loud.wav'), start: 2 }],
    sfx: [{ ...SFX[0], path: P('loud.wav'), start: 2 }] });
  ok(r.peakWarn === 'clip' && r.peakDb > 0, 'C5: pico ' + r.peakDb + ' / ' + r.peakWarn + ', esperado clip');

  // C6 — um tom a ~−0,6 dBFS: sem folga.
  r = await run({ music: [{ ...MUS[0], path: P('hot.wav'), start: 2 }] });
  ok(r.peakWarn === 'hot' && r.peakDb <= 0 && r.peakDb >= -1, 'C6: pico ' + r.peakDb + ' / ' + r.peakWarn + ', esperado hot');

  // Servidor numa porta de teste: sidecar v4 saneado e a rota de conform lendo sfx + mix.
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  let srvErr = '';
  srv.stderr.on('data', b => { srvErr += b; });
  try {
    const req = (method, p, body) => new Promise((resolve, reject) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
        let s = ''; res.on('data', c => { s += c; }); res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch (e) { resolve({ status: res.statusCode, body: s }); }
        });
      });
      q.on('error', reject);
      if (data) q.write(data);
      q.end();
    });
    for (let i = 0; i < 50; i++) {
      try { await req('GET', '/api/luts'); break; } catch (e) { await new Promise(res => setTimeout(res, 200)); }
    }
    const video = rel(P('base.mp4'));
    const sidecar = P('base.beats.json');
    const w = await req('POST', '/api/beats', { video, duration: 6,
      beats: [{ label: 'CORTE', start: 0, dur: 6 }], segments: [{ srcIn: 0, dur: 6 }], broll: [], music: [],
      sfx: [{ path: rel(P('sfx.wav')), name: 'sfx.wav', start: 2, dur: 0.5, srcIn: 0, volume: 1 }],
      mix: { mute: ['sfx', 'bogus', 'sfx'], solo: 'video' } });
    ok(w.status === 200, 'POST /api/beats: status ' + w.status + ' ' + JSON.stringify(w.body));
    const sc = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    ok(sc.version === 4, 'sidecar: version ' + sc.version);
    ok(Array.isArray(sc.sfx) && sc.sfx.length === 1, 'sidecar: sfx não gravado');
    ok(JSON.stringify(sc.mix) === '{"mute":["sfx"],"solo":null}', 'sidecar: mix não saneado ' + JSON.stringify(sc.mix));

    const conformVia = async () => {
      const c = await req('POST', '/api/timeline/conform', { video });
      if (c.status !== 200) throw new Error('POST conform: ' + c.status + ' ' + JSON.stringify(c.body));
      for (let i = 0; i < 600; i++) {
        const j = await req('GET', '/api/jobs/' + c.body.job);
        if (j.body.state === 'done') {
          fs.rmSync(path.join(ROOT, 'jobs', c.body.job), { recursive: true, force: true }); // workDir do job
          return j.body.result;
        }
        if (j.body.state === 'error') throw new Error('job: ' + j.body.error);
        await new Promise(res => setTimeout(res, 200));
      }
      throw new Error('job não terminou');
    };
    let res1 = await conformVia();
    ok(res1.sfx === 0 && JSON.stringify(res1.excluded) === '["sfx"]', 'rota: mix do sidecar ignorado ' + JSON.stringify(res1));
    const out1 = path.join(ROOT, res1.output);
    expectWin('rota mute sfx', windows(out1), { A: 'som', S: 'silêncio' });
    fs.rmSync(out1, { force: true });

    // sidecar v3 (sem sfx/mix) conforma sem erro, com tudo audível.
    const v3 = { ...sc, version: 3 }; delete v3.sfx; delete v3.mix;
    fs.writeFileSync(sidecar, JSON.stringify(v3, null, 2));
    const res2 = await conformVia();
    ok(res2.sfx === 0 && JSON.stringify(res2.excluded) === '[]' && JSON.stringify(res2.mix) === '{"mute":[],"solo":null}',
      'rota v3: ' + JSON.stringify({ sfx: res2.sfx, excluded: res2.excluded, mix: res2.mix }));
    fs.rmSync(path.join(ROOT, res2.output), { force: true });
  } catch (e) {
    fail.push('servidor: ' + e.message + (srvErr ? ' | stderr: ' + srvErr.slice(-300) : ''));
  } finally {
    srv.kill();
  }

  if (!fail.length) fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fail.length ? 'FAIL\n' + fail.join('\n') + '\n(arquivos mantidos em jobs/b1-check/)' : 'PASS: B1 ponta a ponta');
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.log('FAIL\n' + (e.stack || e)); process.exitCode = 1; });
```

Rodar `node jobs/checks/b1-unit.js`. Esperado: `FAIL` com as 5 linhas de "SFX…" (cadeia do primeiro clipe, segundo clipe, amix, ordem dos `-i`, SFX sem TRILHA), `mono: pan só no clipe de 1 canal`, `normalizeMix/audible não exportadas` e `peakWarnOf não exportada`. Os 4 fixtures de não-regressão **não** aparecem (o grafo de hoje é igual ao do `HEAD`).

Rodar `node jobs/checks/b1-e2e.js` (≈ 25s). Esperado: `FAIL` que inclui `C1: mono perdeu 3 dB no export — RMS S -Infinity, M -24.09…`, janelas de C3/C4 com som onde deveria haver silêncio, `sidecar: version 3` e `(arquivos mantidos em jobs/b1-check/)`. Apagar `jobs/b1-check/` depois (`rm -rf jobs/b1-check`) e qualquer `output/conformed-*.mp4` criado por esta rodada (o script lista o caminho na linha `rota: mix do sidecar ignorado`).

- [ ] **Step 2 [Executor]: `lib/ffmpeg.js`**

**lib/ffmpeg.js · troca 1 — mediaInfo: canais de áudio.** Substituir:

```js
    vcodec: v.codec_name || null,
    acodec: a.codec_name || null,
```

por:

```js
    vcodec: v.codec_name || null,
    acodec: a.codec_name || null,
    channels: a.channels || 0,
```

- [ ] **Step 3 [Executor]: `lib/timeline.js` — 11 trocas, nesta ordem**

**lib/timeline.js · troca 1 — cabeçalho: SFX e mix.** Substituir:

```js
//   TRILHA  each clip trimmed, gain-staged, delayed to its timeline position
//           and mixed under the base audio (normalize=0 — amix would otherwise
//           attenuate the base by 1/N and quietly duck the voice).
//
```

por:

```js
//   TRILHA  each clip trimmed, gain-staged, delayed to its timeline position
//           and mixed under the base audio (normalize=0 — amix would otherwise
//           attenuate the base by 1/N and quietly duck the voice).
//   SFX     the TRILHA chain again, one input per clip: the same whoosh used
//           five times is five inputs, with no state shared between them.
//
// The mix follows the preview (export = preview): a track the user muted, or
// that another track's solo silences, never becomes an input. `mix` comes from
// the sidecar, so normalizeMix() drops anything unexpected before it is read.
//
```

**lib/timeline.js · troca 2 — normalizeMix + audible depois de normalizeClips.** Substituir:

```js
    if (withVolume) clip.volume = Math.max(0, Math.min(1, num(c.volume, 1)));
    out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}
```

por:

```js
    if (withVolume) clip.volume = Math.max(0, Math.min(1, num(c.volume, 1)));
    out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------- mixing
// M/S of the step-04 audio tracks. `audible` is the same rule, word for word,
// as the one in public/index.html: mute wins over solo, and a solo leaves only
// its own track audible. 'audio' is the plate's own sound (the VÍDEO segments).
const MIX_TRACKS = ['audio', 'music', 'sfx'];
function normalizeMix(mix) {
  const m = mix && typeof mix === 'object' ? mix : {};
  const mute = Array.isArray(m.mute) ? MIX_TRACKS.filter(t => m.mute.includes(t)) : [];
  const solo = MIX_TRACKS.includes(m.solo) ? m.solo : null;
  return { mute, solo };
}
function audible(mix, track) {
  const m = normalizeMix(mix);
  return !m.mute.includes(track) && (m.solo === null || m.solo === track);
}
```

**lib/timeline.js · troca 3 — buildConformGraph: comentário e assinatura.** Substituir:

```js
// Pure: no fs, no child_process. Inputs are positional and the caller must
// pass them to ffmpeg in exactly this order — base, then B-ROLL, then TRILHA.
function buildConformGraph({ segments, broll = [], music = [], hasAudio = true,
  fit = 'blur', duration }) {
```

por:

```js
// Pure: no fs, no child_process. Inputs are positional and the caller must
// pass them to ffmpeg in exactly this order — base, B-ROLL, TRILHA, then SFX.
function buildConformGraph({ segments, broll = [], music = [], sfx = [], hasAudio = true,
  fit = 'blur', duration }) {
```

**lib/timeline.js · troca 4 — buildConformGraph: TRILHA + SFX no amix.** Substituir:

```js
  g.push('[ca]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[ab]');
  music.forEach((c, k) => {
    const idx = 1 + broll.length + k;
    const ms = Math.round(c.start * 1000);
    g.push(`[${idx}:a]atrim=start=${ts(c.srcIn)}:end=${ts(c.srcIn + c.dur)},asetpts=PTS-STARTPTS,` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
      `volume=${c.volume.toFixed(3)},adelay=${ms}|${ms}[m${k}]`);
  });
  if (music.length) {
    g.push(`[ab]${music.map((_, k) => `[m${k}]`).join('')}` +
      `amix=inputs=${1 + music.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    g.push('[ab]anull[aout]');
  }
```

por:

```js
  g.push('[ca]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[ab]');
  // TRILHA [m*] and SFX [x*] share one chain: trim, gain, delay to position.
  // A mono file is copied to both channels first: left to aformat, ffmpeg would
  // upmix it at -3 dB (center_mix_level), while the browser plays mono at full
  // level on both speakers — the export would sound 3 dB quieter than the
  // preview. `channels` comes from probeClips; unknown means "leave it alone".
  const bed = (c, idx, label) => {
    const ms = Math.round(c.start * 1000);
    const up = c.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : '';
    g.push(`[${idx}:a]atrim=start=${ts(c.srcIn)}:end=${ts(c.srcIn + c.dur)},asetpts=PTS-STARTPTS,${up}` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
      `volume=${c.volume.toFixed(3)},adelay=${ms}|${ms}[${label}]`);
  };
  music.forEach((c, k) => bed(c, 1 + broll.length + k, 'm' + k));
  sfx.forEach((c, k) => bed(c, 1 + broll.length + music.length + k, 'x' + k));
  const beds = [...music.map((_, k) => `[m${k}]`), ...sfx.map((_, k) => `[x${k}]`)];
  if (beds.length) {
    g.push(`[ab]${beds.join('')}` +
      `amix=inputs=${1 + beds.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    g.push('[ab]anull[aout]');
  }
```

**lib/timeline.js · troca 5 — buildConformArgs: inputs de SFX.** Substituir:

```js
function buildConformArgs({ base, broll, music, graph, output, duration }) {
  const args = ['-i', base];
  for (const c of broll) args.push('-i', c.path);
  for (const c of music) args.push('-i', c.path);
```

por:

```js
function buildConformArgs({ base, broll, music, sfx = [], graph, output, duration }) {
  const args = ['-i', base];
  for (const c of broll) args.push('-i', c.path);
  for (const c of music) args.push('-i', c.path);
  for (const c of sfx) args.push('-i', c.path);
```

**lib/timeline.js · troca 6 — probeClips: guardar canais do áudio.** Substituir:

```js
      const ok = kind === 'video' ? !!info.vcodec : !!info.acodec;
      if (!ok) throw new Error(`sem faixa de ${kind === 'video' ? 'vídeo' : 'áudio'}`);
      usable.push(c);
```

por:

```js
      const ok = kind === 'video' ? !!info.vcodec : !!info.acodec;
      if (!ok) throw new Error(`sem faixa de ${kind === 'video' ? 'vídeo' : 'áudio'}`);
      // the graph needs the channel count to upmix mono without the -3 dB
      usable.push(kind === 'audio' ? { ...c, channels: info.channels } : c);
```

**lib/timeline.js · troca 7 — measurePeak antes de conform().** Substituir:

```js
async function conform({ base, segments = [], broll = [], music = [], output, workDir,
  fit = 'blur', words = null, captionStyle = 'impact',
  onLog = () => {}, onStage = () => {}, onProgress = () => {} }) {
```

por:

```js
// The mix sums with normalize=0 and nothing downstream limits it (the Export
// hands the audio straight to AAC), so a peak over 0 dBFS reaches delivery.
// Measured on the finished file, because that is what the Export reads. Never
// fatal: a failed run or unexpected output gives null. Digital silence (-inf)
// also gives null — JSON has no -Infinity, and there is no peak to warn about.
async function measurePeak(file, onLog = () => {}) {
  let log = '';
  try {
    await runFfmpeg(['-nostats', '-i', file, '-map', '0:a:0',
      '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level', '-f', 'null', '-'],
      { onLog: s => { log += s; } });
  } catch (e) {
    onLog(`[conform] pico não medido — ${String(e.message || e).split('\n')[0]}\n`);
    return null;
  }
  const m = /Peak level dB:\s*(-?[\d.]+)/.exec(log);
  return m ? Math.round(parseFloat(m[1]) * 10) / 10 : null;
}
function peakWarnOf(peakDb) {
  if (peakDb == null) return null;
  if (peakDb > 0) return 'clip';
  return peakDb >= -1 ? 'hot' : null;
}

async function conform({ base, segments = [], broll = [], music = [], sfx = [], mix = null,
  output, workDir, fit = 'blur', words = null, captionStyle = 'impact',
  onLog = () => {}, onStage = () => {}, onProgress = () => {} }) {
```

**lib/timeline.js · troca 8 — conform(): regra antes do grafo.** Substituir:

```js
  const brollAll = normalizeClips(broll, duration);
  const musicAll = normalizeClips(music, duration, { withVolume: true });
  onStage('probe', 'Checando os clipes da timeline');
  const b = await probeClips(brollAll, 'video', onLog);
  const m = await probeClips(musicAll, 'audio', onLog);

  onLog(`[conform] ${segs.length} segmento(s) de VÍDEO → ${duration.toFixed(2)}s ` +
    `(fonte ${info.duration.toFixed(2)}s) · ${b.usable.length} B-ROLL · ${m.usable.length} TRILHA\n`);

  const graph = buildConformGraph({
    segments: segs, broll: b.usable, music: m.usable,
    hasAudio: !!info.acodec, fit, duration,
  });
  const args = buildConformArgs({ base, broll: b.usable, music: m.usable, graph, output, duration });
```

por:

```js
  const brollAll = normalizeClips(broll, duration);
  const musicAll = normalizeClips(music, duration, { withVolume: true });
  const sfxAll = normalizeClips(sfx, duration, { withVolume: true });
  // Export = preview: what the mix silences is left out before the graph, and
  // reported back when it had something to leave out.
  const mixN = normalizeMix(mix);
  const excluded = [];
  if (info.acodec && !audible(mixN, 'audio')) excluded.push('audio');
  if (musicAll.length && !audible(mixN, 'music')) excluded.push('music');
  if (sfxAll.length && !audible(mixN, 'sfx')) excluded.push('sfx');
  onStage('probe', 'Checando os clipes da timeline');
  const b = await probeClips(brollAll, 'video', onLog);
  const m = await probeClips(audible(mixN, 'music') ? musicAll : [], 'audio', onLog);
  const x = await probeClips(audible(mixN, 'sfx') ? sfxAll : [], 'audio', onLog);

  onLog(`[conform] ${segs.length} segmento(s) de VÍDEO → ${duration.toFixed(2)}s ` +
    `(fonte ${info.duration.toFixed(2)}s) · ${b.usable.length} B-ROLL · ${m.usable.length} TRILHA · ` +
    `${x.usable.length} SFX${excluded.length ? ' · fora do export: ' + excluded.join(', ') : ''}\n`);

  const graph = buildConformGraph({
    segments: segs, broll: b.usable, music: m.usable, sfx: x.usable,
    hasAudio: !!info.acodec && audible(mixN, 'audio'), fit, duration,
  });
  const args = buildConformArgs({ base, broll: b.usable, music: m.usable, sfx: x.usable,
    graph, output, duration });
```

**lib/timeline.js · troca 9 — conform(): medir pico depois do ffmpeg.** Substituir:

```js
  onStage('conform', 'Conformando a timeline num mezanino');
  await runFfmpeg(args, {
    onLog,
    onProgress: p => onProgress({ ...p, pct: Math.min(99, (p.time / duration) * 100) }),
  });
```

por:

```js
  onStage('conform', 'Conformando a timeline num mezanino');
  await runFfmpeg(args, {
    onLog,
    onProgress: p => onProgress({ ...p, pct: Math.min(99, (p.time / duration) * 100) }),
  });

  onStage('peak', 'Medindo o pico da mixagem');
  const peakDb = await measurePeak(output, onLog);
  onLog(`[conform] pico da mixagem: ${peakDb == null ? 'n/d' : peakDb.toFixed(1) + ' dBFS'}\n`);
```

**lib/timeline.js · troca 10 — conform(): retorno.** Substituir:

```js
    broll: b.usable.length, music: m.usable.length,
    skipped: [...b.skipped, ...m.skipped],
```

por:

```js
    broll: b.usable.length, music: m.usable.length, sfx: x.usable.length,
    skipped: [...b.skipped, ...m.skipped, ...x.skipped],
    mix: mixN, excluded, peakDb, peakWarn: peakWarnOf(peakDb),
```

**lib/timeline.js · troca 11 — exports.** Substituir:

```js
module.exports = {
  conform, buildConformGraph, buildConformArgs,
  normalizeSegments, normalizeClips, timelineDuration, remapWords,
};
```

por:

```js
module.exports = {
  conform, buildConformGraph, buildConformArgs,
  normalizeSegments, normalizeClips, timelineDuration, remapWords,
  normalizeMix, audible, measurePeak, peakWarnOf,
};
```

- [ ] **Step 4 [Executor]: `server.js` — 5 trocas**

**server.js · troca 1 — require.** Substituir:

```js
const { conform } = require('./lib/timeline');
```

por:

```js
const { conform, normalizeMix } = require('./lib/timeline');
```

**server.js · troca 2 — POST /api/beats v4.** Substituir:

```js
      // v3 adds `segments`: the VÍDEO track's own cuts, as {srcIn,dur} in
      // timeline order. Their position is implicit in the order — that is what
      // makes a delete ripple. An absent or empty array means "the whole
      // media, untouched", which is exactly how a v2 sidecar reads.
      const payload = { version: 3, video: b.video, duration: b.duration || null,
        beats: b.beats, segments: Array.isArray(b.segments) ? b.segments : [],
        broll: Array.isArray(b.broll) ? b.broll : [],
        music: Array.isArray(b.music) ? b.music : [], updatedAt: new Date().toISOString() };
```

por:

```js
      // v3 adds `segments`: the VÍDEO track's own cuts, as {srcIn,dur} in
      // timeline order. Their position is implicit in the order — that is what
      // makes a delete ripple. An absent or empty array means "the whole
      // media, untouched", which is exactly how a v2 sidecar reads.
      // v4 adds `sfx` (TRILHA's clip shape) and `mix` ({mute, solo} of the
      // audio tracks, which the conform honours). Absent reads as empty SFX and
      // everything audible — how a v3 sidecar sounds.
      const payload = { version: 4, video: b.video, duration: b.duration || null,
        beats: b.beats, segments: Array.isArray(b.segments) ? b.segments : [],
        broll: Array.isArray(b.broll) ? b.broll : [],
        music: Array.isArray(b.music) ? b.music : [],
        sfx: Array.isArray(b.sfx) ? b.sfx : [],
        mix: normalizeMix(b.mix), updatedAt: new Date().toISOString() };
```

**server.js · troca 3 — conform: comentário do bloco.** Substituir:

```js
    // Timeline conform — flattens the step-04 sidecar (VÍDEO segment cuts,
    // B-ROLL, TRILHA) into a real 4:4:4 CRF-12 mezzanine.
```

por:

```js
    // Timeline conform — flattens the step-04 sidecar (VÍDEO segment cuts,
    // B-ROLL, TRILHA, SFX, and the M/S mix) into a real 4:4:4 CRF-12 mezzanine.
```

**server.js · troca 4 — conform: resolver SFX.** Substituir:

```js
      let broll, music;
      try {
        const resolveClips = (arr) => (Array.isArray(arr) ? arr : []).map(c =>
          ({ ...c, path: resolveInput(c.path) }));
        broll = resolveClips(tl.broll);
        music = resolveClips(tl.music);
```

por:

```js
      let broll, music, sfx;
      try {
        const resolveClips = (arr) => (Array.isArray(arr) ? arr : []).map(c =>
          ({ ...c, path: resolveInput(c.path) }));
        broll = resolveClips(tl.broll);
        music = resolveClips(tl.music);
        sfx = resolveClips(tl.sfx);
```

**server.js · troca 5 — conform: passar sfx e mix.** Substituir:

```js
          base, segments: tl.segments || [], broll, music,
          output: out, workDir: dir, fit: b.fit || 'blur',
```

por:

```js
          base, segments: tl.segments || [], broll, music, sfx, mix: tl.mix,
          output: out, workDir: dir, fit: b.fit || 'blur',
```

- [ ] **Step 5 [Executor]: Checagens** — `node --check server.js`; `node jobs/checks/b1-unit.js` → `PASS: B1 unidade`; `node jobs/checks/b1-e2e.js` → `PASS: B1 ponta a ponta` (ele apaga `jobs/b1-check/` quando passa). Nenhum servidor pode estar ocupando a porta 4879.

- [ ] **Step 6 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 5. Parar aqui.

- [ ] **Step 7 [Orquestrador]: `validator`** — "validar a Task 2 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b1-unit.js` e `node jobs/checks/b1-e2e.js`; conferir que a regra de `audible` em `lib/timeline.js` é exatamente a da spec; que todo caminho de `tl.sfx` passa por `resolveInput`; que `lib/ffmpeg.js` só ganhou o campo `channels`; que a parte de vídeo de `buildConformGraph` (passos 1 e 2) é idêntica ao `HEAD`; e que `measurePeak` nunca faz o conform falhar".

- [ ] **Step 8 [Usuário]: Conferência rápida** — num projeto que já tenha TRILHA, CONFORMAR → EXPORT conclui como antes (item 11 do checklist). Se a TRILHA for mono, o export sai 3 dB mais alto que antes: é a correção da decisão 13, agora igual ao preview.

- [ ] **Step 9 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b1`; arquivos `lib/timeline.js`, `lib/ffmpeg.js`, `server.js`; commit `Conform SFX and mute/solo, measure the mix peak, keep mono level (B1)`) → OK do usuário → `publish`.

---

### Task 3 (B2): Lane SFX nas duas rotas de preview

**Files:**
- Modify: `public/index.html` — `:root`, CSS de `.bt-clip.music`, estado da TIMELINE, `playerProps()` (e o bloco novo antes dele), `snapshot()`, `timelineState()`, `applyHistEntry()`, `pruneMediaCache()`, `snapTargets()`, `ensureMiniWave()`, `saveBeats()`, `applySavedBeats()`, markup do `buildDom()`, `clipsFor()`, `addClipAt()`, `renderClipTrack()`, `renderMusicTrack()`, `openAddClipPopover()`, `compositeTick()`, `renderTracks()`, `onClipContextMenu()`, `startRowResize()`, `startClipMove()`, `startClipTrim()`, `deleteSelection()`, `startClipGroupMove()`, `onTracksMouseDown()`, `loadVideo()`.
- Modify: `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`.
- Regenerate: `public/vendor/studio-player.js`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `getAudioEl(path, k)` e o laço por ocorrência (Task 1); sidecar v4 com `sfx` (Task 2).
- Produces (usados na Task 4):
  - `let SFX = []` com o formato da TRILHA; `renderSfxTrack()`; `CLIP_HOST`, `CLIP_TRACK_NAME`;
  - `function audibleNow() → { audio: boolean, music: boolean, sfx: boolean }` — o único lugar do lado do preview que decide quem soa (a Task 4 troca só o corpo);
  - `PLAYER_AUDIO_MAX = 16`, `capSimultaneous(items)`;
  - props do Player: `{ src, segments, broll, music, sfx, hidden: { broll }, audible }`; cada clipe de TRILHA/SFX com URL terminada em `#<track><índice>`;
  - probe: estágios `B2`/`B3` em `ORDER`, `TRACK_ORDER_B`, `sfxLane()`, check `sfx-lane`.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b2-static.js`:

```js
// B2 — checagem estática. Rodar da raiz: node jobs/checks/b2-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const tsx = read('remotion/src/scenes/TimelinePreview.tsx');
const entry = read('remotion/src/player-entry.tsx');
const probe = read('public/dev/ui-probe.js');
const bundle = read('public/vendor/studio-player.js');
const lines = src.split('\n');
const fail = [];
const count = (s, t) => s.split(t).length - 1;
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });
const none = (s, where, list) => list.forEach(t => { if (s.includes(t)) fail.push(where + ' — não deveria existir: ' + t); });

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

// index.html — lane, estado, persistência.
need(src, 'index.html', [
  '--sfx:#22d3ee;', '.bt-clip.sfx{border-left:3px solid var(--sfx)}',
  '.bt-clip.music .nm,.bt-clip.sfx .nm{font-size:9.5px} /* isento:',
  'let SFX = [];', '<div class="bt-track-row" data-track="sfx">', '<span class="ic">≈</span><span class="nm">SFX</span>',
  "${tctlHtml('add', 'SFX')}${tctlHtml('lock', 'SFX')}</div>", '<div class="bt-track-content" id="bt-track-sfx"></div>',
  "track === 'sfx' ? SFX : MUSIC", "const CLIP_HOST = { broll: 'bt-track-broll', music: 'bt-track-music', sfx: 'bt-track-sfx' };",
  "const CLIP_TRACK_NAME = { broll: 'B-ROLL', music: 'TRILHA', sfx: 'SFX' };", 'ADICIONAR ${CLIP_TRACK_NAME[track]}',
  "function renderSfxTrack() { renderClipTrack('sfx', 'bt-track-sfx'); }",
  "const want = track === 'sfx' && asset.info && asset.info.duration > 0 ? asset.info.duration : 3;",
  "const isAudio = track === 'music' || track === 'sfx';",
  "inp.addEventListener('input', () => { clipsFor(track)[+inp.dataset.idx].volume = +inp.value; syncPlayer(); });",
  "['broll', 'music', 'sfx'].forEach(track => clipsFor(track).forEach((c, i) => {",
  'const byTrack = { broll: [], music: [], sfx: [], video: [] };', "['broll', 'music', 'sfx', 'video'].forEach(t =>",
  'SFX = JSON.parse(JSON.stringify(entry.sfx || []));', 'const uses = [...MUSIC, ...SFX].filter(c => c.path === path).length;',
  'sfx: SFX.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),',
  'SFX = Array.isArray(saved.sfx) ? saved.sfx.map(', 'SFX = (saved && Array.isArray(saved.sfx)) ? saved.sfx.map(',
  'function audibleNow() {', 'return { audio: !trilhaSolo, music: !trilhaMuted && !hiddenTracks.music, sfx: !trilhaSolo };',
  'const PLAYER_AUDIO_MAX = 16;', 'function capSimultaneous(items) {', "sfx: bedsOf('sfx'),", 'audible: aud,', "path: url(c) + '#' + track + k,",
  'if (video.muted !== !aud.audio) video.muted = !aud.audio;',
  "[...MUSIC.map(c => ['music', c]), ...SFX.map(c => ['sfx', c])].forEach(([track, c]) => {",
  'const shouldPlay = onWindow && !video.paused && aud[track];',
]);
none(src, 'index.html', ["track === 'broll' ? 'bt-track-broll' : 'bt-track-music'", "track === 'broll' ? 'B-ROLL' : 'TRILHA'",
  'trilhaMuted, trilhaSolo,', 'el.muted = trilhaMuted;', '!video.paused && !hiddenTracks.music']);
if (count(src, 'renderClipTrack(track, CLIP_HOST[track]);') !== 3) fail.push('CLIP_HOST[track] deveria aparecer 3× (arraste e trim)');
if (count(src, 'renderSfxTrack()') !== 7) fail.push('renderSfxTrack() deveria aparecer 7× (1 definição + 6 chamadas), achado ' + count(src, 'renderSfxTrack()'));
if (count(src, 'music: MUSIC, sfx: SFX, video: VIDEO') !== 2) fail.push('snapshot e timelineState deveriam levar sfx');
if (count(src, 'sfx: 44 }') !== 2) fail.push('trackHeights.sfx deveria existir nos dois lugares');
if ((src.match(/\$\{tctlHtml\('/g) || []).length !== 17) fail.push('esperadas 17 chamadas ${tctlHtml(…)} (15 + 2 da SFX)');
const iMusic = src.indexOf('<div class="bt-track-row" data-track="music">'), iSfx = src.indexOf('<div class="bt-track-row" data-track="sfx">');
if (!(iMusic > 0 && iSfx > iMusic)) fail.push('a linha SFX deveria vir depois da TRILHA');

// Composição, ponte e bundle.
need(tsx, 'TimelinePreview.tsx', ['sfx: Clip[];', 'audible: { audio: boolean; music: boolean; sfx: boolean };',
  'muted={!audible.audio}', "{audible.music && bed(music, 'm')}", "{audible.sfx && bed(sfx, 'x')}",
  'audible: { audio: true, music: true, sfx: true },']);
none(tsx, 'TimelinePreview.tsx', ['trilhaMuted', 'trilhaSolo', 'hidden.music']);
need(entry, 'player-entry.tsx', ['numberOfSharedAudioTags={16}']);
if (!bundle.includes('audible') || bundle.includes('trilhaSolo')) fail.push('bundle não reconstruído (sem "audible" ou ainda com "trilhaSolo")');
if (!/numberOfSharedAudioTags:16\b/.test(bundle)) fail.push('bundle sem numberOfSharedAudioTags:16');

// Probe.
need(probe, 'ui-probe.js', ["const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3'];",
  "const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music', '.bt-clip.sfx'];", "const TRACK_ORDER_B = TRACK_ORDER.concat('sfx');",
  'function sfxLane() {', "add('sfx-lane',", 'const wantOrder = at(\'B2\') ? TRACK_ORDER_B : TRACK_ORDER;',
  'if (!text || AMBIENT.test(text) || /#claude-/.test(where)) return;']);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B2 estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b2-static.js`. Esperado: `FAIL` com dezenas de linhas `ausente:` em `index.html`, `TimelinePreview.tsx`, `player-entry.tsx` e `ui-probe.js`, as linhas `não deveria existir:` de `trilhaMuted`/`trilhaSolo`/`hidden.music` na composição e `bundle não reconstruído`.

- [ ] **Step 2 [Executor]: `public/index.html` — 35 trocas, nesta ordem**

As trocas 11, 22 e 25 usam como âncora o texto deixado pela Task 1 (`pruneMediaCache`, listener do slider, laço do `compositeTick`): a Task 1 precisa estar aplicada.

**public/index.html · troca 1 — :root — token --sfx.** Substituir:

```html
  --violet:#8b8cf8; --warn:#ffb347; --bad:#fb7185;
```

por:

```html
  --violet:#8b8cf8; --warn:#ffb347; --bad:#fb7185;
  --sfx:#22d3ee; /* lane SFX da TIMELINE — B-ROLL usa --go, TRILHA usa --warn */
```

**public/index.html · troca 2 — CSS — borda do clipe SFX.** Substituir:

```html
.bt-clip.music{border-left:3px solid var(--warn)}
```

por:

```html
.bt-clip.music{border-left:3px solid var(--warn)}
.bt-clip.sfx{border-left:3px solid var(--sfx)}
```

**public/index.html · troca 3 — CSS — nome do clipe SFX com a isenção da TRILHA.** Substituir:

```html
.bt-clip.music .nm{font-size:9.5px} /* isento: lane intocada — sub-projeto A, decisão 2 */
```

por:

```html
.bt-clip.music .nm,.bt-clip.sfx .nm{font-size:9.5px} /* isento: lane intocada — sub-projeto A, decisão 2; SFX segue a TRILHA (sub-projeto B, decisão 11) */
```

**public/index.html · troca 4 — estado — SFX.** Substituir:

```html
  let MUSIC = []; // {path, name, start, dur, volume, srcIn}
```

por:

```html
  let MUSIC = []; // {path, name, start, dur, volume, srcIn}
  let SFX = [];   // {path, name, start, dur, volume, srcIn} — mesmo formato da TRILHA
```

**public/index.html · troca 5 — estado — comentários de selectedClip e justAdded.** Substituir:

```html
  let selectedClip = null; // {track:'broll'|'music'|'video', index} | null — âncora/único item quando não há multi-seleção
  let selectedClipSet = new Set(); // multi-seleção de clipes B-ROLL/TRILHA: chaves 'track:index'
```

por:

```html
  let selectedClip = null; // {track:'broll'|'music'|'sfx'|'video', index} | null — âncora/único item quando não há multi-seleção
  let selectedClipSet = new Set(); // multi-seleção de clipes B-ROLL/TRILHA/SFX/VÍDEO: chaves 'track:index'
```

**public/index.html · troca 6 — estado — altura inicial da SFX.** Substituir:

```html
  let trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44 };
  let trilhaMuted = false, trilhaSolo = false;
```

por:

```html
  let trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44, sfx: 44 };
  let trilhaMuted = false, trilhaSolo = false;
```

**public/index.html · troca 7 — playerProps: audibleNow + sfx + teto de 16.** Substituir:

```html
  function playerProps() {
    return {
      src: plateSrc(),
      segments: VIDEO.map(s => ({ srcIn: s.srcIn, dur: s.dur })),
      broll: hiddenTracks.broll ? [] : BROLL.map(c => ({ path: '/files/' + encodeURIComponent(c.path.replace(/\\/g, '/')), start: c.start, dur: c.dur, srcIn: c.srcIn || 0 })),
      music: hiddenTracks.music ? [] : MUSIC.map(c => ({ path: '/files/' + encodeURIComponent(c.path.replace(/\\/g, '/')), start: c.start, dur: c.dur, srcIn: c.srcIn || 0, volume: c.volume })),
      hidden: { broll: !!hiddenTracks.broll, music: !!hiddenTracks.music },
      trilhaMuted, trilhaSolo,
    };
  }
```

por:

```html
  /* Quem soa no preview. As duas rotas leem daqui e o Player recebe o
     resultado pronto (prop `audible`): a regra mora num lugar só deste lado.
     Por ora são as chaves de sempre da TRILHA — mudo, ocultar e o solo, que
     cala o plate e agora também a SFX; o sub-projeto B, etapa B3, troca o
     corpo por MIX + audible(). */
  function audibleNow() {
    return { audio: !trilhaSolo, music: !trilhaMuted && !hiddenTracks.music, sfx: !trilhaSolo };
  }
  /* O Player monta no máximo PLAYER_AUDIO_MAX <Audio> ao mesmo tempo; o
     seguinte lança erro e derruba o preview inteiro. Acima do teto, os clipes
     que entrariam a mais ficam fora do PREVIEW (o export toca todos) e o
     aviso sai uma vez por situação nova. A conta é em frames, arredondados
     como a composição arredonda, para bater com o que o Remotion monta. */
  const PLAYER_AUDIO_MAX = 16; // = numberOfSharedAudioTags em remotion/src/player-entry.tsx
  const PLAYER_FPS = 30;       // = FPS em remotion/src/player-entry.tsx
  let lastDropKey = '';
  function capSimultaneous(items) {
    const f0 = c => Math.max(0, Math.round((c.start || 0) * PLAYER_FPS));
    const f1 = c => f0(c) + Math.max(1, Math.round((c.dur || 0) * PLAYER_FPS));
    const ends = [], kept = [], dropped = [];
    for (const it of items.slice().sort((a, b) => f0(a[1]) - f0(b[1]))) {
      for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= f0(it[1])) ends.splice(i, 1);
      if (ends.length >= PLAYER_AUDIO_MAX) { dropped.push(it); continue; }
      ends.push(f1(it[1]));
      kept.push(it);
    }
    const key = dropped.map(([t, c]) => t + ':' + c.start + ':' + c.path).join('|');
    if (key && key !== lastDropKey)
      stage(`mais de ${PLAYER_AUDIO_MAX} áudios simultâneos: o preview toca ${PLAYER_AUDIO_MAX}, o export toca todos`);
    lastDropKey = key;
    return kept;
  }
  function playerProps() {
    const aud = audibleNow();
    const url = c => '/files/' + encodeURIComponent(c.path.replace(/\\/g, '/'));
    const beds = capSimultaneous([
      ...(aud.music ? MUSIC.map(c => ['music', c]) : []),
      ...(aud.sfx ? SFX.map(c => ['sfx', c]) : []),
    ]);
    // O Remotion identifica cada <Audio> por src + janela: dois clipes idênticos
    // empilhados (Ctrl+V duas vezes no mesmo ponto) virariam UM áudio no preview,
    // enquanto o export soma os dois. O fragmento por clipe separa os ids; o
    // navegador não o envia ao servidor e o elemento de mídia o ignora.
    const bedsOf = track => beds.filter(([t]) => t === track)
      .map(([, c], k) => ({ path: url(c) + '#' + track + k, start: c.start, dur: c.dur, srcIn: c.srcIn || 0, volume: c.volume }));
    return {
      src: plateSrc(),
      segments: VIDEO.map(s => ({ srcIn: s.srcIn, dur: s.dur })),
      broll: hiddenTracks.broll ? [] : BROLL.map(c => ({ path: url(c), start: c.start, dur: c.dur, srcIn: c.srcIn || 0 })),
      music: bedsOf('music'),
      sfx: bedsOf('sfx'),
      hidden: { broll: !!hiddenTracks.broll },
      audible: aud,
    };
  }
```

**public/index.html · troca 8 — snapshot com sfx.** Substituir:

```html
    hist.push(JSON.parse(JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, video: VIDEO })));
```

por:

```html
    hist.push(JSON.parse(JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO })));
```

**public/index.html · troca 9 — timelineState com sfx.** Substituir:

```html
    return JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, video: VIDEO });
```

por:

```html
    return JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO });
```

**public/index.html · troca 10 — applyHistEntry com sfx.** Substituir:

```html
    MUSIC = JSON.parse(JSON.stringify(entry.music || []));
```

por:

```html
    MUSIC = JSON.parse(JSON.stringify(entry.music || []));
    SFX = JSON.parse(JSON.stringify(entry.sfx || []));
```

**public/index.html · troca 11 — pruneMediaCache conta TRILHA + SFX.** Substituir:

```html
      const uses = MUSIC.filter(c => c.path === path).length;
```

por:

```html
      const uses = [...MUSIC, ...SFX].filter(c => c.path === path).length;
```

**public/index.html · troca 12 — snap nas bordas de clipe da SFX.** Substituir:

```html
      ['broll', 'music'].forEach(track => clipsFor(track).forEach((c, i) => {
```

por:

```html
      ['broll', 'music', 'sfx'].forEach(track => clipsFor(track).forEach((c, i) => {
```

**public/index.html · troca 13 — ensureMiniWave redesenha a SFX também.** Substituir:

```html
    } catch (e) { miniWaveCache.set(path, null); }
    renderMusicTrack();
  }
```

por:

```html
    } catch (e) { miniWaveCache.set(path, null); }
    renderMusicTrack();
    renderSfxTrack();
  }
```

**public/index.html · troca 14 — saveBeats envia sfx.** Substituir:

```html
        music: MUSIC.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
      });
```

por:

```html
        music: MUSIC.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
        sfx: SFX.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
      });
```

**public/index.html · troca 15 — applySavedBeats lê sfx.** Substituir:

```html
    MUSIC = Array.isArray(saved.music) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    VIDEO = normalizeSegments(saved.segments);
```

por:

```html
    MUSIC = Array.isArray(saved.music) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    SFX = Array.isArray(saved.sfx) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    VIDEO = normalizeSegments(saved.segments);
```

**public/index.html · troca 16 — buildDom — linha SFX depois da TRILHA.** Substituir:

```html
              <div class="bt-track-content" id="bt-track-music"></div>
              <div class="bt-row-resize" data-track="music"></div>
            </div>
```

por:

```html
              <div class="bt-track-content" id="bt-track-music"></div>
              <div class="bt-row-resize" data-track="music"></div>
            </div>
            <div class="bt-track-row" data-track="sfx">
              <div class="bt-track-label"><span class="ic">≈</span><span class="nm">SFX</span>
                ${tctlHtml('add', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
              <div class="bt-track-content" id="bt-track-sfx"></div>
              <div class="bt-row-resize" data-track="sfx"></div>
            </div>
```

**public/index.html · troca 17 — clipsFor com sfx + mapas de host e nome.** Substituir:

```html
  function clipsFor(track) { return track === 'video' ? VIDEO : track === 'broll' ? BROLL : MUSIC; }
```

por:

```html
  function clipsFor(track) { return track === 'video' ? VIDEO : track === 'broll' ? BROLL : track === 'sfx' ? SFX : MUSIC; }
  // Host e nome de cada track de clipes. Substituem os ternários "broll ou o
  // resto é TRILHA", que mandariam a SFX para o host e o título da TRILHA.
  const CLIP_HOST = { broll: 'bt-track-broll', music: 'bt-track-music', sfx: 'bt-track-sfx' };
  const CLIP_TRACK_NAME = { broll: 'B-ROLL', music: 'TRILHA', sfx: 'SFX' };
```

**public/index.html · troca 18 — addClipAt: duração padrão da SFX.** Substituir:

```html
    } else {
      dur = Math.min(3, DURATION - t);
      if (dur <= MIN_BEAT_DUR) { stage('sem espaço até o fim da timeline', true); return; }
    }
    const clip = track === 'broll'
```

por:

```html
    } else {
      // SFX entra com a duração do próprio arquivo — um whoosh de 0,8s não vira
      // 3s com silêncio no fim. TRILHA continua com 3s. Os dois param no fim.
      const want = track === 'sfx' && asset.info && asset.info.duration > 0 ? asset.info.duration : 3;
      dur = Math.min(want, DURATION - t);
      if (dur <= MIN_BEAT_DUR) { stage('sem espaço até o fim da timeline', true); return; }
    }
    const clip = track === 'broll'
```

**public/index.html · troca 19 — renderClipTrack: slider, minionda e listeners para TRILHA e SFX.** Substituir:

```html
      const vol = track === 'music'
        ? `<input type="range" class="bt-clip-vol" min="0" max="1" step="0.05" value="${c.volume}" data-idx="${i}">`
        : '';
```

por:

```html
      const vol = isAudio
        ? `<input type="range" class="bt-clip-vol" min="0" max="1" step="0.05" value="${c.volume}" data-idx="${i}">`
        : '';
```

**public/index.html · troca 20 — renderClipTrack: isAudio.** Substituir:

```html
    const arr = clipsFor(track);
    host.innerHTML = arr.map((c, i) => {
```

por:

```html
    const arr = clipsFor(track);
    const isAudio = track === 'music' || track === 'sfx';
    host.innerHTML = arr.map((c, i) => {
```

**public/index.html · troca 21 — renderClipTrack: minionda para áudio.** Substituir:

```html
      if (track === 'music') {
        ensureMiniWave(c.path);
```

por:

```html
      if (isAudio) {
        ensureMiniWave(c.path);
```

**public/index.html · troca 22 — renderClipTrack: listeners do slider e cor da minionda.** Substituir:

```html
    if (track === 'music') {
      host.querySelectorAll('.bt-clip-vol').forEach(inp => {
        inp.addEventListener('mousedown', e => e.stopPropagation());
        // o Player só relê as props em syncPlayer(); sem isto o ganho mudava na
        // tela e no sidecar, mas o som só no próximo renderTracks()
        inp.addEventListener('input', () => { MUSIC[+inp.dataset.idx].volume = +inp.value; syncPlayer(); });
        inp.addEventListener('change', () => snapshot());
      });
      host.querySelectorAll('.bt-clip-wave').forEach(cv => {
        const peaksArr = miniWaveCache.get(arr[+cv.dataset.idx].path);
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, 'rgba(255,179,71,.6)');
      });
    }
```

por:

```html
    if (isAudio) {
      host.querySelectorAll('.bt-clip-vol').forEach(inp => {
        inp.addEventListener('mousedown', e => e.stopPropagation());
        // o Player só relê as props em syncPlayer(); sem isto o ganho mudava na
        // tela e no sidecar, mas o som só no próximo renderTracks()
        inp.addEventListener('input', () => { clipsFor(track)[+inp.dataset.idx].volume = +inp.value; syncPlayer(); });
        inp.addEventListener('change', () => snapshot());
      });
      const waveColor = track === 'sfx' ? 'rgba(34,211,238,.6)' : 'rgba(255,179,71,.6)';
      host.querySelectorAll('.bt-clip-wave').forEach(cv => {
        const peaksArr = miniWaveCache.get(arr[+cv.dataset.idx].path);
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, waveColor);
      });
    }
```

**public/index.html · troca 23 — renderSfxTrack.** Substituir:

```html
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
```

por:

```html
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
  function renderSfxTrack() { renderClipTrack('sfx', 'bt-track-sfx'); }
```

**public/index.html · troca 24 — popover de adicionar: título pelo mapa.** Substituir:

```html
    popEl.innerHTML = `<div class="t">ADICIONAR ${track === 'broll' ? 'B-ROLL' : 'TRILHA'}</div>
```

por:

```html
    popEl.innerHTML = `<div class="t">ADICIONAR ${CLIP_TRACK_NAME[track]}</div>
```

**public/index.html · troca 25 — compositeTick: TRILHA + SFX por ocorrência, plate por audibleNow.** Substituir:

```html
    const seen = new Map(); // path -> ocorrências já servidas nesta passada
    MUSIC.forEach(c => {
      const k = seen.get(c.path) || 0;
      seen.set(c.path, k + 1);
      const el = getAudioEl(c.path, k);
      const onWindow = t >= c.start && t < c.start + c.dur;
      const shouldPlay = onWindow && !video.paused && !hiddenTracks.music;
      el.volume = Math.max(0, Math.min(1, c.volume));
      el.muted = trilhaMuted;
```

por:

```html
    const aud = audibleNow();
    if (video.muted !== !aud.audio) video.muted = !aud.audio;
    const seen = new Map(); // path -> ocorrências já servidas nesta passada
    [...MUSIC.map(c => ['music', c]), ...SFX.map(c => ['sfx', c])].forEach(([track, c]) => {
      const k = seen.get(c.path) || 0;
      seen.set(c.path, k + 1);
      const el = getAudioEl(c.path, k);
      const onWindow = t >= c.start && t < c.start + c.dur;
      // track que não soa pausa o elemento, em vez de tocá-lo mudo
      const shouldPlay = onWindow && !video.paused && aud[track];
      el.volume = Math.max(0, Math.min(1, c.volume));
```

**public/index.html · troca 26 — renderTracks: SFX.** Substituir:

```html
    renderVideoTrack();
    renderMusicTrack();
    renderPlayhead();
```

por:

```html
    renderVideoTrack();
    renderMusicTrack();
    renderSfxTrack();
    renderPlayhead();
```

**public/index.html · troca 27 — menu de contexto: re-render com SFX.** Substituir:

```html
      selectedClip = { track, index: i };
      renderBrollTrack(); renderMusicTrack(); renderVideoTrack();
    }
    openClipMenu(track, i, e.clientX, e.clientY);
```

por:

```html
      selectedClip = { track, index: i };
      renderBrollTrack(); renderMusicTrack(); renderSfxTrack(); renderVideoTrack();
    }
    openClipMenu(track, i, e.clientX, e.clientY);
```

**public/index.html · troca 28 — redimensionar a linha da SFX.** Substituir:

```html
      if (track === 'music') renderMusicTrack();
      if (track === 'beats') syncMarkersOffset();
```

por:

```html
      if (track === 'music') renderMusicTrack();
      if (track === 'sfx') renderSfxTrack();
      if (track === 'beats') syncMarkersOffset();
```

**public/index.html · troca 29 — arraste/trim: host pelo mapa (3×).** Substituir **as 3 ocorrências** (idênticas) de:

```html
renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
```

por:

```html
renderClipTrack(track, CLIP_HOST[track]);
```

**public/index.html · troca 30 — apagar em grupo com SFX.** Substituir:

```html
      const byTrack = { broll: [], music: [], video: [] };
```

por:

```html
      const byTrack = { broll: [], music: [], sfx: [], video: [] };
```

**public/index.html · troca 31 — apagar em grupo: ordem das tracks.** Substituir:

```html
      ['broll', 'music', 'video'].forEach(t =>
```

por:

```html
      ['broll', 'music', 'sfx', 'video'].forEach(t =>
```

**public/index.html · troca 32 — movimento em grupo: re-render com SFX.** Substituir:

```html
      if (guide != null && intact) showSnapGuide(guide);
      else hideSnapGuide();
      renderBrollTrack(); renderMusicTrack();
```

por:

```html
      if (guide != null && intact) showSnapGuide(guide);
      else hideSnapGuide();
      renderBrollTrack(); renderMusicTrack(); renderSfxTrack();
```

**public/index.html · troca 33 — shift+clique: re-render com SFX.** Substituir:

```html
        toggleClipMulti(track, i);
        renderBrollTrack(); renderMusicTrack(); renderVideoTrack();
```

por:

```html
        toggleClipMulti(track, i);
        renderBrollTrack(); renderMusicTrack(); renderSfxTrack(); renderVideoTrack();
```

**public/index.html · troca 34 — loadVideo: altura e SFX do sidecar.** Substituir:

```html
    trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44 };
    PX_PER_SEC = 60; updateZoomReadout();
```

por:

```html
    trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44, sfx: 44 };
    PX_PER_SEC = 60; updateZoomReadout();
```

**public/index.html · troca 35 — loadVideo: ler sfx.** Substituir:

```html
    MUSIC = (saved && Array.isArray(saved.music)) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    hist = []; histPos = -1; snapshot();
```

por:

```html
    MUSIC = (saved && Array.isArray(saved.music)) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    SFX = (saved && Array.isArray(saved.sfx)) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    hist = []; histPos = -1; snapshot();
```

- [ ] **Step 3 [Executor]: `remotion/src/scenes/TimelinePreview.tsx` — 4 trocas**

**remotion/src/scenes/TimelinePreview.tsx · troca 1 — props: sfx e audible.** Substituir:

```tsx
export type TimelineProps = {
  src: string;
  segments: Segment[];
  broll: Clip[];
  music: Clip[];
  hidden: { broll?: boolean; music?: boolean };
  trilhaMuted: boolean;
  /* SOLO da TRILHA: silencia o plate para sobrar só a música, espelhando o
     `video.muted = trilhaSolo` da rota de canvas. */
  trilhaSolo: boolean;
};

export const EMPTY_TIMELINE: TimelineProps = {
  src: '', segments: [], broll: [], music: [], hidden: {}, trilhaMuted: false, trilhaSolo: false,
};
```

por:

```tsx
export type TimelineProps = {
  src: string;
  segments: Segment[];
  broll: Clip[];
  music: Clip[];
  sfx: Clip[];
  hidden: { broll?: boolean };
  /* Quem soa, calculado pelo app (`audibleNow()` em public/index.html). A
     composição só obedece: a regra de mudo/solo mora num lugar só deste lado,
     e o conform (lib/timeline.js) aplica a mesma ao arquivo exportado. */
  audible: { audio: boolean; music: boolean; sfx: boolean };
};

export const EMPTY_TIMELINE: TimelineProps = {
  src: '', segments: [], broll: [], music: [], sfx: [], hidden: {},
  audible: { audio: true, music: true, sfx: true },
};
```

**remotion/src/scenes/TimelinePreview.tsx · troca 2 — composição: plate, TRILHA e SFX por audible.** Substituir:

```tsx
export const TimelinePreview: React.FC<TimelineProps> = ({
  src, segments, broll, music, hidden, trilhaMuted, trilhaSolo,
}) => {
  const { fps } = useVideoConfig();
  const frames = (s: number) => atLeastOneFrame(s, fps);
  const from = (s: number) => Math.max(0, Math.round((s || 0) * fps));
```

por:

```tsx
export const TimelinePreview: React.FC<TimelineProps> = ({
  src, segments, broll, music, sfx, hidden, audible,
}) => {
  const { fps } = useVideoConfig();
  const frames = (s: number) => atLeastOneFrame(s, fps);
  const from = (s: number) => Math.max(0, Math.round((s || 0) * fps));

  // TRILHA e SFX tocam igual: um <Audio> por clipe, na janela dele. Track que
  // não soa não monta <Audio> nenhum (não toca com volume 0): cada <Audio>
  // montado ocupa uma das numberOfSharedAudioTags do Player.
  const bed = (clips: Clip[], key: string) => clips.map((c, i) => (
    <Sequence key={`${key}${i}`} from={from(c.start)} durationInFrames={frames(c.dur)}>
      <Audio src={c.path} startFrom={from(c.srcIn || 0)} volume={Math.max(0, Math.min(1, c.volume ?? 1))} />
    </Sequence>
  ));
```

**remotion/src/scenes/TimelinePreview.tsx · troca 3 — composição: plate mudo por audible.audio.** Substituir:

```tsx
              <Video src={src} startFrom={from(seg.srcIn)} muted={trilhaSolo} style={fit} />
```

por:

```tsx
              <Video src={src} startFrom={from(seg.srcIn)} muted={!audible.audio} style={fit} />
```

**remotion/src/scenes/TimelinePreview.tsx · troca 4 — composição: TRILHA e SFX.** Substituir:

```tsx
      {!hidden.music && music.map((c, i) => (
        <Sequence key={`m${i}`} from={from(c.start)} durationInFrames={frames(c.dur)}>
          <Audio
            src={c.path}
            startFrom={from(c.srcIn || 0)}
            volume={trilhaMuted ? 0 : Math.max(0, Math.min(1, c.volume ?? 1))}
          />
        </Sequence>
      ))}
```

por:

```tsx
      {audible.music && bed(music, 'm')}
      {audible.sfx && bed(sfx, 'x')}
```

- [ ] **Step 4 [Executor]: `remotion/src/player-entry.tsx` — 1 troca**

**remotion/src/player-entry.tsx · troca 1 — numberOfSharedAudioTags.** Substituir:

```tsx
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
```

por:

```tsx
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      // Cada <Audio> montado ao mesmo tempo ocupa uma destas tags; o padrão é 5 e
      // o sexto lança erro e derruba o preview. A SFX empilha efeitos, então o
      // teto sobe — e public/index.html (PLAYER_AUDIO_MAX) nunca manda mais que isto.
      numberOfSharedAudioTags={16}
```

- [ ] **Step 5 [Executor]: Tipos e bundle**

```bash
cd remotion && npx tsc --noEmit -p . ; npm run build:player ; cd ..
```

Esperado do `tsc`: **uma** linha de erro, a pré-existente `src/player-entry.tsx(11,39): error TS7016: Could not find a declaration file for module 'react-dom/client'` (os tipos de `react-dom` não estão instalados localmente; já acontece no `HEAD`). Qualquer outro erro → parar e reportar. Esperado do build: `..\public\vendor\studio-player.js  403.4kb` (±1kb) e `Done`.

- [ ] **Step 6 [Executor]: `public/dev/ui-probe.js` — 9 trocas**

A troca 9 faz o `motion-literals` ignorar a sobreposição que a extensão Claude in Chrome injeta enquanto o agente age (`#claude-agent-glow-border…`, `#claude-phantom-cursor`): sem ela, o check falha depois de qualquer tecla ou clique da verificação. Achado no reteste do plano; um literal do próprio app continua sendo acusado.

**public/dev/ui-probe.js · troca 1 — cabeçalho.** Substituir:

```js
/* ui-probe.js — instrumento de medição do sub-projeto A (UI da TIMELINE).
   Plano: docs/plans/ui-premium-timeline.md
   Spec:  docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md
```

por:

```js
/* ui-probe.js — instrumento de medição da TIMELINE.
   Sub-projeto A (E0–E3b): docs/plans/ui-premium-timeline.md
     spec docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md
   Sub-projeto B (B2–B3): docs/plans/mixagem-audio.md
     spec docs/superpowers/specs/2026-09-21-mixagem-audio-design.md
```

**public/dev/ui-probe.js · troca 2 — ORDER, EXEMPT_TEXT.** Substituir:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b'];
  // Isentos do piso de 11px: dado desenhado em escala de tempo (spec, decisão 2).
  const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music'];
```

por:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3'];
  // Isentos do piso de 11px: dado desenhado em escala de tempo (spec A, decisão 2;
  // a SFX segue a TRILHA — spec B, decisão 11).
  const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music', '.bt-clip.sfx'];
```

**public/dev/ui-probe.js · troca 3 — TRACK_ORDER_B.** Substituir:

```js
  const TRACK_ORDER = ['beats', 'broll', 'video', 'legend', 'audio', 'music'];
```

por:

```js
  const TRACK_ORDER = ['beats', 'broll', 'video', 'legend', 'audio', 'music'];
  const TRACK_ORDER_B = TRACK_ORDER.concat('sfx'); // lane SFX abaixo da TRILHA, do B2 em diante
```

**public/dev/ui-probe.js · troca 4 — sfxLane().** Substituir:

```js
  function playheadTc() {
```

por:

```js
  function sfxLane() {
    const order = trackOrder(), row = $('.bt-track-row[data-track="sfx"]');
    return { afterMusic: order.indexOf('sfx') === order.indexOf('music') + 1,
      acts: row ? $$('.bt-tctl', row).map(b => b.dataset.act) : [],
      host: !!$('#bt-track-sfx'), token: cssVar('--sfx') };
  }
  function playheadTc() {
```

**public/dev/ui-probe.js · troca 5 — text-floor: isenções pela lista a partir do B2.** Substituir:

```js
    if (at('E2')) add('text-floor', snap.textFloor.offenders.length === 0 && same(snap.textFloor.exempt, (b.textFloor || {}).exempt),
      snap.textFloor, { offenders: [], exempt: (b.textFloor || {}).exempt });
```

por:

```js
    // Do B2 em diante há clipes de TRILHA/SFX na tela conforme o teste: toda
    // isenção vale se o seletor estiver em EXEMPT_TEXT (o baseline não tinha clipes).
    const exemptOk = at('B2') ? snap.textFloor.exempt.every(e => EXEMPT_TEXT.includes(e.split('@')[0]))
      : same(snap.textFloor.exempt, (b.textFloor || {}).exempt);
    if (at('E2')) add('text-floor', snap.textFloor.offenders.length === 0 && exemptOk,
      snap.textFloor, { offenders: [], exempt: at('B2') ? 'seletores de EXEMPT_TEXT' : (b.textFloor || {}).exempt });
```

**public/dev/ui-probe.js · troca 6 — track-order por estágio.** Substituir:

```js
      add('track-order', same(snap.trackOrder, TRACK_ORDER), snap.trackOrder, TRACK_ORDER);
```

por:

```js
      const wantOrder = at('B2') ? TRACK_ORDER_B : TRACK_ORDER;
      add('track-order', same(snap.trackOrder, wantOrder), snap.trackOrder, wantOrder);
```

**public/dev/ui-probe.js · troca 7 — check sfx-lane.** Substituir:

```js
        add('shortcut-sheet', sc.present && sc.opened && sc.modal && sc.expected > 0 && sc.rows === sc.expected && sc.focusReturned,
          sc, { opened: true, modal: true, rows: 'SHORTCUTS.length', focusReturned: true });
      }
```

por:

```js
        add('shortcut-sheet', sc.present && sc.opened && sc.modal && sc.expected > 0 && sc.rows === sc.expected && sc.focusReturned,
          sc, { opened: true, modal: true, rows: 'SHORTCUTS.length', focusReturned: true });
      }
      if (at('B2')) {
        const s = sfxLane();
        add('sfx-lane', s.afterMusic && s.host && s.token === '#22d3ee' && s.acts.includes('add') && s.acts.includes('lock'),
          s, { afterMusic: true, host: true, token: '#22d3ee', acts: 'inclui add e lock' });
      }
```

**public/dev/ui-probe.js · troca 8 — console.info.** Substituir:

```js
  console.info('[uiProbe] carregado — await uiProbe.load(<vídeo>); await uiProbe.run("E0"…"E3b")');
```

por:

```js
  console.info('[uiProbe] carregado — await uiProbe.load(<vídeo>); await uiProbe.run("E0"…"E3b" | "B2" | "B3")');
```

**public/dev/ui-probe.js · troca 9 — motion-literals ignora a sobreposição da extensão do Chrome.** Substituir:

```js
    const scan = (where, text) => {
      if (!text || AMBIENT.test(text)) return;
```

por:

```js
    const scan = (where, text) => {
      // A extensão Claude in Chrome injeta na página, enquanto o agente age, uma borda
      // animada e um cursor fantasma (#claude-agent-glow-border…, #claude-phantom-cursor).
      // Não são do app: sem este filtro, o check falha depois de qualquer tecla ou clique.
      if (!text || AMBIENT.test(text) || /#claude-/.test(where)) return;
```

- [ ] **Step 7 [Executor]: Checagem** — `node jobs/checks/b2-static.js`. Esperado: `PASS: B2 estático`.

- [ ] **Step 8 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1, 5 e 7. Parar aqui.

- [ ] **Step 9 [Orquestrador]: `validator`** — "validar a Task 3 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b2-static.js`; conferir que nenhum ramo `track === 'broll' ? … : <TRILHA>` sobrou em host, título ou array; que os handlers de arraste só ganharam `'sfx'` nas listas e `CLIP_HOST`; que `capSimultaneous` conta em frames com o mesmo arredondamento de `TimelinePreview.tsx` (`Math.round(s * fps)` e piso de 1 frame); e que o bundle contém `numberOfSharedAudioTags:16` e `audible`, e não contém `trilhaSolo`".

- [ ] **Step 10 [Orquestrador]: Bundle reproduzível** — `sha256sum public/vendor/studio-player.js; (cd remotion && npm run build:player >/dev/null); sha256sum public/vendor/studio-player.js`. Esperado: os dois hashes iguais (o esbuild é determinístico; na cópia de teste, duas builds das mesmas fontes deram o mesmo hash). Hash diferente significa que o bundle do diff não saiu destas fontes: parar.

- [ ] **Step 11 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado (v3, sem SFX).

```js
const r = await uiProbe.run('B2');
({ ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id), sfxAntes: T.clips('sfx') })
```

Esperado: `ok: true`, `falhas: []`, `sfxAntes: 0` (projeto salvo antes do B2 abre com a SFX vazia). O estágio `E3b` deixa de valer daqui em diante (o `track-order` dele não conhece a SFX).

```js
T.spy(); T.asset('whoosh.wav', 0.8); T.asset('bed.wav', 10);
T.btn('sfx', 'add').click(); await T.sleep(150);
const titulo = document.querySelector('.bt-pop .t').textContent; document.getElementById('bt-pop-cancel').click();
await T.add('sfx', 'whoosh.wav');
const clip = document.querySelector('#bt-track-sfx .bt-clip');
const a = { titulo, width: clip.style.width, border: getComputedStyle(clip).borderLeftColor, nm: getComputedStyle(clip.querySelector('.nm')).fontSize,
  props: T.props.sfx.map(c => c.path.split('#')[1]), audible: T.props.audible };
T.key('c', { ctrlKey: true }); T.key('v', { ctrlKey: true }); await T.sleep(200);
a.empilhados = T.props.sfx.map(c => c.path.split('#')[1]);
const inp = document.querySelector('#bt-track-sfx .bt-clip-vol'); const u0 = T.updates;
inp.value = '0.35'; inp.dispatchEvent(new Event('input')); a.slider = { updates: T.updates - u0, vol: T.props.sfx[0].volume };
T.key('z', { ctrlKey: true }); await T.sleep(150); a.undo = T.clips('sfx');
a
```

Esperado: `titulo: "ADICIONAR SFX"`, `width: "48px"` (0,8s × 60px/s), `border: "rgb(34, 211, 238)"`, `nm: "9.5px"`, `props: ["sfx0"]`, `audible` todo `true`, `empilhados: ["sfx0","sfx1"]`, `slider: { updates: 1, vol: 0.35 }`, `undo: 1`.

Som de verdade no Player, com dois efeitos idênticos empilhados (o `run('B2')` acima andou o playhead ~0,6s; o `Home` zera):

```js
T.key('z', { ctrlKey: true, shiftKey: true }); await T.sleep(150);        // redo: os dois efeitos de volta
const ini = [...document.querySelectorAll('#bt-track-sfx .bt-clip')].map(c => (parseFloat(c.style.left) / 60).toFixed(2));
T.key('Home'); await T.sleep(200);
T.record(() => '[' + T.tags('whoosh.wav') + '] plateMudo=' + document.querySelector('#bt-player video').muted);
ini
```

Pressionar **Espaço** (ferramenta de teclado). Depois `await T.sleep(2500); T.pause(); T.stop()`. Esperado: dentro da janela dos efeitos (`ini` até `ini` + 0,8s), `[▶sfx0 ▶sfx1] plateMudo=false` — as duas tags tocam ao mesmo tempo; fora dela, `[]`. No reteste do plano, com os efeitos em 0,57s: `00:00.6 [▶sfx0 ▶sfx1] plateMudo=false` · `00:01.4 [] plateMudo=false`.

Teto de 16, com clipes **distintos** (entradas a 0,2s uma da outra; clipes no mesmo frame o Remotion funde e não testam o teto):

```js
await T.add('sfx', 'bed.wav'); T.key('c', { ctrlKey: true });
for (let i = 0; i < 17; i++) { await T.steps(6, 'ArrowRight'); T.key('v', { ctrlKey: true }); }
await T.steps(3, 'ArrowRight'); await T.sleep(1200);
({ total: T.clips('sfx'), camasNoPlayer: T.props.sfx.filter(c => c.path.includes('bed.wav')).length, aviso: T.stage(), quebrou: T.playerBroken() })
```

Esperado: `total: 20` (2 whooshes + 18 camas), `camasNoPlayer: 16`, `aviso` com "mais de 16 áudios simultâneos: o preview toca 16, o export toca todos", `quebrou: false`.

Salvar e recarregar: recarregar a página (descarta o teste acima), `load`, auxiliares; `T.asset('whoosh.wav', 0.8); await T.add('sfx', 'whoosh.wav'); document.getElementById('bt-save').click(); await T.sleep(600); await T.sidecar()` → `{ version: 4, sfx: 1, music: 0, mix: { mute: [], solo: null } }`; recarregar, `load`, `T.clips('sfx')` → `1`.

CONFORMAR com esse efeito em 0–0,8s: clicar `#bt-conform`, esperar a mensagem "timeline conformada" em chamadas separadas (`T.stage()`), e medir o arquivo:

```bash
F=$(ls -t output/conformed-*.mp4 | head -1)
for f in "$F" output/assembled-4545f906507a.mp4; do
  ffmpeg -hide_banner -nostats -i "$f" -map 0:a:0 \
    -af "atrim=start=0.1:end=0.7,bandpass=f=1000:width_type=h:w=50,astats=measure_perchannel=none:measure_overall=RMS_level" \
    -f null - 2>&1 | grep "RMS level" | sed "s|^|$f: |"
done
```

O passa-banda de 50 Hz em torno de 1 kHz isola o tom da voz. Esperado: no conformado, cerca de −21 dB (o tom mono de −18 dBFS duplicado nos dois canais; −24 indicaria os −3 dB do upmix de volta); na fixture sem o efeito, abaixo de −45 dB. No teste da cópia deu −21,1 e −55,4. Registrar os dois valores e apagar o conformado. Restaurar o sidecar da fixture.

- [ ] **Step 12 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares.

```js
const r = await uiProbe.run('B2');
T.asset('whoosh.wav', 0.8); T.key('Home'); await T.sleep(200); await T.steps(15, 'ArrowRight');   // 0,5s
await T.add('sfx', 'whoosh.wav'); T.key('c', { ctrlKey: true }); T.key('v', { ctrlKey: true }); await T.sleep(150);
T.key('Home'); await T.sleep(200); await T.steps(6, 'ArrowRight');                                 // 0,2s
T.record(() => 'sfx[' + T.state('whoosh.wav') + '] plateMudo=' + document.getElementById('bt-video').muted);
({ ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id), clips: T.clips('sfx') })
```

Pressionar **Espaço**. Depois `await T.sleep(2500); T.pause(); T.stop()`. Esperado: `ok: true`, `clips: 2`, e `sfx[▶▶] plateMudo=false` durante a janela 0,5–1,3s (o mesmo arquivo empilhado toca duas vezes); `sfx[pp]` fora dela. No reteste do plano: `00:00.4 sfx[▶▶]` … `00:01.2 sfx[pp]`. Restaurar o sidecar da fixture.

- [ ] **Step 13 [Usuário]: Checklist manual** (itens 1–12 do A) + subir um efeito curto (qualquer `.wav`/`.mp3`) e pô-lo na SFX pelo `+`: entra com a duração do arquivo, toca na janela certa nas duas rotas, o slider de ganho age ao vivo, arrastar/trim/dividir/duplicar/colar/apagar funcionam como na TRILHA, SALVAR → recarregar mantém a SFX. Um projeto antigo abre com a SFX vazia.

- [ ] **Step 14 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b2`; arquivos `public/index.html`, `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`, `public/vendor/studio-player.js`, `public/dev/ui-probe.js`; commit `Add SFX track to the TIMELINE with both preview routes (B2)`) → OK do usuário → `publish`.

**Lacuna conhecida até a Task 4:** o export mixa a SFX sempre (o app ainda não envia `mix`), enquanto o solo da TRILHA a cala no preview. Fecha na Task 4.

---

### Task 4 (B3): Mudo e solo como controles de mixagem

**Files:**
- Modify: `public/index.html` — CSS depois de `.bt-track-row.hidden …`, estado (`trilhaMuted`/`trilhaSolo` saem), `audibleNow()`, `timelineState()`, `saveBeats()`, `doConform()`, `applySavedBeats()`, `TCTL` e comentário, markup do `buildDom()` (ÁUDIO, TRILHA, SFX), `applyTrackVisibility()`, `wireTracks()`, `loadVideo()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `audibleNow()`, `SFX`, sidecar v4 e o retorno de `conform()` (`sfx`, `mix`, `excluded`, `peakDb`, `peakWarn`) das Tasks 2 e 3.
- Produces: `const AUDIO_TRACKS`, `let MIX = { mute: [], solo: null }`, `normalizeMix(mix)`, `audible(track)` — a regra com o mesmo texto de `lib/timeline.js`; classe `.silent` nas linhas de áudio que não vão soar; probe com `TRACK_ACTS_B3`, `soloExclusive()`, `silentLanes()` e os checks `audio-controls`, `solo-exclusive`, `silent-lanes`.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b3-static.js`:

```js
// B3 — checagem estática. Rodar da raiz: node jobs/checks/b3-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const lib = read('lib/timeline.js');
const probe = read('public/dev/ui-probe.js');
const lines = src.split('\n');
const fail = [];
const count = (s, t) => s.split(t).length - 1;
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });
const none = (s, where, list) => list.forEach(t => { if (s.includes(t)) fail.push(where + ' — não deveria existir: ' + t); });

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

// A mesma regra dos dois lados (spec B, "A regra").
const RULE_APP = '!MIX.mute.includes(track) && (MIX.solo === null || MIX.solo === track)';
const RULE_LIB = '!m.mute.includes(track) && (m.solo === null || m.solo === track)';
if (count(src, RULE_APP) !== 1) fail.push('index.html — regra audible() ausente ou duplicada');
if (count(lib, RULE_LIB) !== 1) fail.push('lib/timeline.js — regra audible() ausente ou duplicada');

// Estado, persistência, controles.
none(src, 'index.html', ['trilhaMuted', 'trilhaSolo', 'hiddenTracks.music', "tctlHtml('hide', 'ÁUDIO')", "tctlHtml('hide', 'TRILHA')",
  'Silenciar trilha', 'Ativar solo da trilha', 'não altera o export\', icons: [\'i-spk']);
need(src, 'index.html', [
  ".bt-track-row.silent .bt-track-content{opacity:.45}", "const AUDIO_TRACKS = ['audio', 'music', 'sfx'];",
  'let MIX = { mute: [], solo: null };', 'function normalizeMix(mix) {', 'function audible(track) {',
  "return { audio: audible('audio'), music: audible('music'), sfx: audible('sfx') };",
  'return JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO, mix: MIX });',
  '        mix: MIX,\n      });', 'MIX = normalizeMix(saved.mix);', 'MIX = normalizeMix(saved && saved.mix);',
  'hiddenTracks = {}; lockedTracks = {}; MIX = { mute: [], solo: null };',
  "mute: { label: 'Silenciar track', title: 'mudo — vale no export', icons: ['i-spk', 'i-spk-off'] },",
  "solo: { label: 'Solo da track', title: 'solo — só esta track soa, também no export', icons: ['i-solo', 'i-solo'] },",
  "${tctlHtml('mute', 'ÁUDIO')}${tctlHtml('solo', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>",
  "${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>",
  "${tctlHtml('add', 'SFX')}${tctlHtml('mute', 'SFX')}${tctlHtml('solo', 'SFX')}${tctlHtml('lock', 'SFX')}</div>",
  "row.classList.toggle('silent', AUDIO_TRACKS.includes(track) && !audible(track));",
  "else if (act === 'mute') on = MIX.mute.includes(track);", "else if (act === 'solo') on = MIX.solo === track;",
  "if (act === 'solo') MIX = { mute: MIX.mute, solo: MIX.solo === track ? null : track };",
  '· ${r.sfx} SFX', 'fora do export: ${fora} (${why})', '— vai distorcer: abaixe TRILHA/SFX', '— sem folga (ideal ≤ −1)',
  "r.peakWarn === 'clip');",
]);
if ((src.match(/\$\{tctlHtml\('/g) || []).length !== 19) fail.push('esperadas 19 chamadas ${tctlHtml(…)}, achadas ' + (src.match(/\$\{tctlHtml\('/g) || []).length);
if (count(src, 'mix: MIX') !== 2) fail.push('mix: MIX deveria aparecer 2× (timelineState e saveBeats)');
// snapshot() não leva o mix: Ctrl+Z não desfaz chave de mixagem
if (/hist\.push\([^\n]*MIX/.test(src)) fail.push('snapshot() não deveria levar MIX');

// Probe.
need(probe, 'ui-probe.js', ["'bt-seek', 'silent']);", 'const TRACK_ACTS_B3 = {', 'function soloExclusive() {',
  'function silentLanes() {', "add('audio-controls',", "add('solo-exclusive',", "add('silent-lanes',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B3 estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b3-static.js`. Esperado: `FAIL` com `index.html — regra audible() ausente ou duplicada`, as linhas `não deveria existir:` de `trilhaMuted`, `trilhaSolo`, `hiddenTracks.music`, dos H de ÁUDIO/TRILHA e dos textos antigos de M/S, as linhas `ausente:`, `esperadas 19 chamadas ${tctlHtml(…)}, achadas 17`, `mix: MIX deveria aparecer 2×` e as linhas `ausente:` do probe. A linha da regra em `lib/timeline.js` **não** aparece (a Task 2 já a criou).

- [ ] **Step 2 [Executor]: `public/index.html` — 18 trocas, nesta ordem**

As trocas 3, 4, 5, 7, 13 e 18 usam como âncora o texto deixado pela Task 3: a Task 3 precisa estar aplicada.

**public/index.html · troca 1 — CSS — lane silenciada.** Substituir:

```html
.bt-track-row.hidden .bt-track-content{opacity:.2; pointer-events:none}
```

por:

```html
.bt-track-row.hidden .bt-track-content{opacity:.2; pointer-events:none}
/* track de áudio que não vai soar (mudo próprio ou solo de outra): esmaecida,
   mas editável — ao contrário da oculta, que bloqueia o mouse */
.bt-track-row.silent .bt-track-content{opacity:.45}
```

**public/index.html · troca 2 — estado — MIX no lugar de trilhaMuted/trilhaSolo.** Substituir:

```html
  let trilhaMuted = false, trilhaSolo = false;
```

por:

```html
  /* M/S das tracks de áudio. `mute` ⊆ AUDIO_TRACKS; `solo` é um valor só, então é
     exclusivo por construção, e o mudo vence o solo. Vai para o sidecar, e o
     conform aplica a mesma regra (lib/timeline.js, audible): export = preview.
     'audio' é o som do plate — os segmentos da VÍDEO. */
  const AUDIO_TRACKS = ['audio', 'music', 'sfx'];
  let MIX = { mute: [], solo: null };
  function normalizeMix(mix) {
    const m = mix && typeof mix === 'object' ? mix : {};
    const mute = Array.isArray(m.mute) ? AUDIO_TRACKS.filter(t => m.mute.includes(t)) : [];
    return { mute, solo: AUDIO_TRACKS.includes(m.solo) ? m.solo : null };
  }
  function audible(track) {
    return !MIX.mute.includes(track) && (MIX.solo === null || MIX.solo === track);
  }
```

**public/index.html · troca 3 — audibleNow pelo MIX.** Substituir:

```html
  /* Quem soa no preview. As duas rotas leem daqui e o Player recebe o
     resultado pronto (prop `audible`): a regra mora num lugar só deste lado.
     Por ora são as chaves de sempre da TRILHA — mudo, ocultar e o solo, que
     cala o plate e agora também a SFX; o sub-projeto B, etapa B3, troca o
     corpo por MIX + audible(). */
  function audibleNow() {
    return { audio: !trilhaSolo, music: !trilhaMuted && !hiddenTracks.music, sfx: !trilhaSolo };
  }
```

por:

```html
  /* Quem soa no preview. As duas rotas leem daqui e o Player recebe o
     resultado pronto (prop `audible`): a regra mora num lugar só deste lado. */
  function audibleNow() {
    return { audio: audible('audio'), music: audible('music'), sfx: audible('sfx') };
  }
```

**public/index.html · troca 4 — timelineState com mix.** Substituir:

```html
    return JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO });
```

por:

```html
    // mix entra no "não salvo" (vale no export), mas não no histórico: Ctrl+Z
    // desfaz edição, não chave de mixagem
    return JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO, mix: MIX });
```

**public/index.html · troca 5 — saveBeats envia mix.** Substituir:

```html
        sfx: SFX.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
      });
```

por:

```html
        sfx: SFX.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
        mix: MIX,
      });
```

**public/index.html · troca 6 — doConform: SFX, o que ficou de fora e pico.** Substituir:

```html
      stage(`timeline conformada — ${r.duration.toFixed(1)}s · ${r.broll} B-ROLL · ${r.music} TRILHA` +
        ` · ${r.captionedWords} palavras${skipped}`);
```

por:

```html
      // export = preview: diz o que o mix deixou fora e se a soma passou do teto
      const NAME = { audio: 'ÁUDIO', music: 'TRILHA', sfx: 'SFX' };
      const fora = (r.excluded || []).map(t => NAME[t]).join(', ');
      const why = r.mix && r.mix.solo ? 'solo: ' + NAME[r.mix.solo] : 'mudo';
      const db = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + ' dBFS';
      const peak = r.peakDb == null ? ''
        : r.peakWarn === 'clip' ? ` · pico ${db(r.peakDb)} — vai distorcer: abaixe TRILHA/SFX`
        : r.peakWarn === 'hot' ? ` · pico ${db(r.peakDb)} — sem folga (ideal ≤ −1)`
        : ` · pico ${db(r.peakDb)}`;
      stage(`timeline conformada — ${r.duration.toFixed(1)}s · ${r.broll} B-ROLL · ${r.music} TRILHA · ${r.sfx} SFX` +
        ` · ${r.captionedWords} palavras${fora ? ` · fora do export: ${fora} (${why})` : ''}${peak}${skipped}`,
        r.peakWarn === 'clip');
```

**public/index.html · troca 7 — applySavedBeats lê mix.** Substituir:

```html
    SFX = Array.isArray(saved.sfx) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    VIDEO = normalizeSegments(saved.segments);
```

por:

```html
    SFX = Array.isArray(saved.sfx) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    MIX = normalizeMix(saved.mix);
    VIDEO = normalizeSegments(saved.segments);
```

**public/index.html · troca 8 — TCTL: comentário e textos de M/S.** Substituir:

```html
     faria o leitor de tela anunciar a ação duas vezes, invertida. H/M/S são só
     do preview (o conform lê o sidecar inteiro), e o title diz isso. */
```

por:

```html
     faria o leitor de tela anunciar a ação duas vezes, invertida. H é só do
     preview; M/S valem no export (o conform lê o mix do sidecar). O title diz
     qual é qual. */
```

**public/index.html · troca 9 — TCTL: mute.** Substituir:

```html
    mute: { label: 'Silenciar trilha', title: 'mudo no preview — não altera o export', icons: ['i-spk', 'i-spk-off'] },
```

por:

```html
    mute: { label: 'Silenciar track', title: 'mudo — vale no export', icons: ['i-spk', 'i-spk-off'] },
```

**public/index.html · troca 10 — TCTL: solo.** Substituir:

```html
    solo: { label: 'Ativar solo da trilha', title: 'solo da TRILHA: silencia o áudio do vídeo no preview — não altera o export', icons: ['i-solo', 'i-solo'] },
```

por:

```html
    solo: { label: 'Solo da track', title: 'solo — só esta track soa, também no export', icons: ['i-solo', 'i-solo'] },
```

**public/index.html · troca 11 — buildDom: ÁUDIO com M S L.** Substituir:

```html
                ${tctlHtml('hide', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>
```

por:

```html
                ${tctlHtml('mute', 'ÁUDIO')}${tctlHtml('solo', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>
```

**public/index.html · troca 12 — buildDom: TRILHA sem H.** Substituir:

```html
                ${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('hide', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>
```

por:

```html
                ${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>
```

**public/index.html · troca 13 — buildDom: SFX com M S.** Substituir:

```html
                ${tctlHtml('add', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
```

por:

```html
                ${tctlHtml('add', 'SFX')}${tctlHtml('mute', 'SFX')}${tctlHtml('solo', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
```

**public/index.html · troca 14 — applyTrackVisibility: .silent.** Substituir:

```html
      row.classList.toggle('locked', !!lockedTracks[track]);
```

por:

```html
      row.classList.toggle('locked', !!lockedTracks[track]);
      row.classList.toggle('silent', AUDIO_TRACKS.includes(track) && !audible(track));
```

**public/index.html · troca 15 — applyTrackVisibility: estado de M/S.** Substituir:

```html
        else if (act === 'mute') on = trilhaMuted;
        else if (act === 'solo') on = trilhaSolo;
```

por:

```html
        else if (act === 'mute') on = MIX.mute.includes(track);
        else if (act === 'solo') on = MIX.solo === track;
```

**public/index.html · troca 16 — wireTracks: clique em M/S.** Substituir:

```html
          if (act === 'mute') trilhaMuted = !trilhaMuted;
          if (act === 'solo') { trilhaSolo = !trilhaSolo; if (video) video.muted = trilhaSolo; }
```

por:

```html
          // o plate da rota canvas segue audibleNow() no compositeTick
          if (act === 'mute') MIX = normalizeMix({ solo: MIX.solo,
            mute: MIX.mute.includes(track) ? MIX.mute.filter(t => t !== track) : MIX.mute.concat(track) });
          if (act === 'solo') MIX = { mute: MIX.mute, solo: MIX.solo === track ? null : track };
```

**public/index.html · troca 17 — loadVideo: zera MIX.** Substituir:

```html
    hiddenTracks = {}; lockedTracks = {}; trilhaMuted = false; trilhaSolo = false;
```

por:

```html
    hiddenTracks = {}; lockedTracks = {}; MIX = { mute: [], solo: null };
```

**public/index.html · troca 18 — loadVideo: lê mix do sidecar.** Substituir:

```html
    SFX = (saved && Array.isArray(saved.sfx)) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    hist = []; histPos = -1; snapshot();
```

por:

```html
    SFX = (saved && Array.isArray(saved.sfx)) ? saved.sfx.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
    MIX = normalizeMix(saved && saved.mix);
    hist = []; histPos = -1; snapshot();
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 4 trocas**

**public/dev/ui-probe.js · troca 1 — STATE_CLASSES com silent.** Substituir:

```js
    'dragging', 'flip', 'hot', 'over', 'enter', 'collapsed', 'bt-enter', 'bt-split', 'bt-seek']);
```

por:

```js
    'dragging', 'flip', 'hot', 'over', 'enter', 'collapsed', 'bt-enter', 'bt-split', 'bt-seek', 'silent']);
```

**public/dev/ui-probe.js · troca 2 — TRACK_ACTS_B3.** Substituir:

```js
  const TRACK_ORDER_B = TRACK_ORDER.concat('sfx'); // lane SFX abaixo da TRILHA, do B2 em diante
```

por:

```js
  const TRACK_ORDER_B = TRACK_ORDER.concat('sfx'); // lane SFX abaixo da TRILHA, do B2 em diante
  // Controles por track do B3 em diante (spec B, tabela da seção "B3: controles de áudio").
  const TRACK_ACTS_B3 = { beats: ['hide', 'lock'], broll: ['add', 'hide', 'lock'], video: ['lock'],
    legend: ['hide', 'lock'], audio: ['mute', 'solo', 'lock'], music: ['add', 'mute', 'solo', 'lock'],
    sfx: ['add', 'mute', 'solo', 'lock'] };
  const AUDIO_TRACKS = ['audio', 'music', 'sfx'];
```

**public/dev/ui-probe.js · troca 3 — trackActs, soloExclusive, silentLanes.** Substituir:

```js
  async function transportIds() {
```

por:

```js
  function trackActs() {
    const o = {};
    for (const r of $$('.bt-track-row')) o[r.dataset.track] = $$('.bt-tctl', r).map(b => b.dataset.act);
    return o;
  }
  const audioBtn = (t, act) => $(`.bt-track-row[data-track="${t}"] .bt-tctl[data-act="${act}"]`);
  const pressed = el => !!el && el.getAttribute('aria-pressed') === 'true';
  function mixState() {
    return { mute: AUDIO_TRACKS.filter(t => pressed(audioBtn(t, 'mute'))),
      solo: AUDIO_TRACKS.find(t => pressed(audioBtn(t, 'solo'))) || null };
  }
  // Leva M/S ao estado pedido clicando nos botões, como o usuário faria.
  function setMix(mute, solo) {
    for (const t of AUDIO_TRACKS) if (pressed(audioBtn(t, 'mute')) !== mute.includes(t)) audioBtn(t, 'mute').click();
    const cur = mixState().solo;
    if (cur !== solo) (solo ? audioBtn(solo, 'solo') : audioBtn(cur, 'solo')).click();
  }
  function soloExclusive() {
    const start = mixState();
    const soloed = () => $$('.bt-tctl[data-act="solo"]').filter(pressed).map(b => b.closest('.bt-track-row').dataset.track);
    const steps = [];
    setMix(start.mute, null);
    audioBtn('audio', 'solo').click(); steps.push(soloed());
    audioBtn('sfx', 'solo').click(); steps.push(soloed());
    audioBtn('sfx', 'solo').click(); steps.push(soloed());
    setMix(start.mute, start.solo);
    return { steps, ok: same(steps, [['audio'], ['sfx'], []]) };
  }
  function silentLanes() {
    const start = mixState();
    const combos = [[[], null], [['music'], null], [['audio', 'sfx'], null], [[], 'sfx'], [['music'], 'music'], [['sfx'], 'audio']];
    const bad = [];
    for (const [mute, solo] of combos) {
      setMix(mute, solo);
      for (const t of AUDIO_TRACKS) {
        const want = !(!mute.includes(t) && (solo === null || solo === t));
        const got = $(`.bt-track-row[data-track="${t}"]`).classList.contains('silent');
        if (want !== got) bad.push({ mute, solo, track: t, silent: got });
      }
    }
    setMix(start.mute, start.solo);
    return { combos: combos.length, bad };
  }
  async function transportIds() {
```

**public/dev/ui-probe.js · troca 4 — checks do B3.** Substituir:

```js
      if (at('B2')) {
        const s = sfxLane();
```

por:

```js
      if (at('B3')) {
        const acts = trackActs();
        add('audio-controls', same(acts, TRACK_ACTS_B3), acts, TRACK_ACTS_B3);
        const se = soloExclusive();
        add('solo-exclusive', se.ok, se.steps, [['audio'], ['sfx'], []]);
        const sl = silentLanes();
        add('silent-lanes', sl.bad.length === 0, sl, { combos: 6, bad: [] });
      }
      if (at('B2')) {
        const s = sfxLane();
```

- [ ] **Step 4 [Executor]: Checagens** — `node jobs/checks/b3-static.js` → `PASS: B3 estático`; `node jobs/checks/b1-unit.js` → `PASS: B1 unidade` (o conform não muda nesta task).

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 4 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b3-static.js`; conferir que `audible()` em `public/index.html` e em `lib/timeline.js` são a mesma regra; que `MIX` entra em `timelineState()` e em `saveBeats()` mas não em `snapshot()`; que clicar S sempre deixa no máximo um solo; e que o H continua em MARKERS, B-ROLL e LEGENDA com o title de sempre".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado.

```js
const r = await uiProbe.run('B3');
({ ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id + ' ' + JSON.stringify(x.measured)) })
```

Esperado: `ok: true`, `falhas: []` (inclui `audio-controls`, `solo-exclusive`, `silent-lanes`).

```js
T.spy(); T.asset('whoosh.wav', 0.8); T.key('Home'); await T.sleep(200);          // o run('B3') andou o playhead
await T.steps(60, 'ArrowRight'); await T.add('sfx', 'whoosh.wav');            // efeito em 2,0–2,8s
T.btn('sfx', 'solo').click();
const a = { labels: ['audio', 'music', 'sfx'].map(t => [T.btn(t, 'mute').getAttribute('aria-label'), T.btn(t, 'solo').getAttribute('aria-label')]),
  titulos: [T.btn('sfx', 'mute').title, T.btn('sfx', 'solo').title],
  audible: T.props.audible, silent: [...document.querySelectorAll('.bt-track-row.silent')].map(r => r.dataset.track) };
// Ctrl+Z desfaz edição, não chave de mixagem: o mudo fica, o efeito sai; o redo o traz de volta
T.btn('music', 'mute').click(); T.key('z', { ctrlKey: true }); await T.sleep(150);
a.depoisDoUndo = { mudoTrilha: T.btn('music', 'mute').getAttribute('aria-pressed'), sfx: T.clips('sfx') };
T.btn('music', 'mute').click(); T.key('z', { ctrlKey: true, shiftKey: true }); await T.sleep(150);
a.depoisDoRedo = { mudoTrilha: T.btn('music', 'mute').getAttribute('aria-pressed'), sfx: T.clips('sfx') };
document.getElementById('bt-conform').click();
a
```

Esperado: rótulos `Silenciar track ÁUDIO` / `Solo da track ÁUDIO` (e o mesmo para TRILHA e SFX); títulos `mudo — vale no export` e `solo — só esta track soa, também no export`; `audible: { audio: false, music: false, sfx: true }`; `silent: ["audio","music"]`; `depoisDoUndo: { mudoTrilha: "true", sfx: 0 }`; `depoisDoRedo: { mudoTrilha: "false", sfx: 1 }`.

Esperar o fim do conform em chamadas separadas (`T.stage()`). Esperado: "timeline conformada — 38.2s · 0 B-ROLL · 0 TRILHA · 1 SFX · … palavras · fora do export: ÁUDIO (solo: SFX) · pico −18,… dBFS" (o tom mono de −18 dBFS sozinho). No reteste do plano: "timeline conformada — 38.2s · 0 B-ROLL · 0 TRILHA · 1 SFX · 100 palavras · fora do export: ÁUDIO (solo: SFX) · pico −18,0 dBFS". Medir o arquivo:

```bash
F=$(ls -t output/conformed-*.mp4 | head -1)
for w in "5:6" "2.1:2.7"; do
  ffmpeg -hide_banner -nostats -i "$F" -map 0:a:0 \
    -af "atrim=start=${w%:*}:end=${w#*:},bandpass=f=1000:width_type=h:w=50,astats=measure_perchannel=none:measure_overall=RMS_level" \
    -f null - 2>&1 | grep "RMS level" | sed "s|^|$w: |"
done
```

Esperado: `5:6` → `-inf` (a voz do plate não está no export, e o preview também a calou); `2.1:2.7` → cerca de −21 dB (o efeito). No reteste do plano: `-inf` e −21,1. Apagar o conformado.

Persistência: `await T.sidecar()` → `mix: { mute: [], solo: "sfx" }`; recarregar, `load`, auxiliares: `T.btn('sfx', 'solo').getAttribute('aria-pressed')` → `"true"` e `.silent` em `audio` e `music`. Restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia o bundle e recarrega; `load`, auxiliares; `await uiProbe.run('B3')` → `ok: true`. Depois, TRILHA com a cama dividida e dois efeitos empilhados, com o solo da SFX:

```js
T.asset('bed.wav', 10); T.asset('whoosh.wav', 0.8); T.key('Home'); await T.sleep(200);
await T.add('music', 'bed.wav'); await T.steps(45, 'ArrowRight'); await T.menu('music', 0, 'bt-menu-split');
T.key('Home'); await T.sleep(200); await T.steps(15, 'ArrowRight');
await T.add('sfx', 'whoosh.wav'); T.key('c', { ctrlKey: true }); T.key('v', { ctrlKey: true }); await T.sleep(150);
T.btn('sfx', 'solo').click();
T.key('Home'); await T.sleep(200); await T.steps(6, 'ArrowRight');
T.record(() => 'trilha[' + T.state('bed.wav') + '] sfx[' + T.state('whoosh.wav') + '] plateMudo=' + document.getElementById('bt-video').muted);
[...document.querySelectorAll('.bt-track-row.silent')].map(r => r.dataset.track)
```

Esperado: `["audio","music"]`. Pressionar **Espaço**; depois `await T.sleep(2500); T.pause(); T.stop()`. Esperado: `trilha[pp]` o tempo todo, `sfx[▶▶]` na janela dos efeitos e `plateMudo=true` o tempo todo. No reteste do plano: `00:00.2 trilha[pp] sfx[pp] plateMudo=true` · `00:00.4 trilha[pp] sfx[▶▶] plateMudo=true` · `00:01.2 trilha[pp] sfx[pp] plateMudo=true`. Desligar o solo: `T.btn('sfx', 'solo').click(); await T.sleep(100); document.getElementById('bt-video').muted` → `false`. Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 trocado) + M em ÁUDIO, TRILHA e SFX cala a track e esmaece a lane (que continua editável); S deixa só aquela track soar e troca de track com um clique; mudo vence solo; CONFORMAR com um solo ligado mostra "fora do export: …" e o arquivo exportado soa como o preview; o pico aparece na mensagem, em vermelho se passar de 0 dBFS (testar com dois clipes de TRILHA altos sobrepostos).

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b3`; arquivos `public/index.html`, `public/dev/ui-probe.js`; commit `Make mute and solo real mix controls on the audio tracks (B3)`) → OK do usuário → `publish`.

---

## Verificação

Seção do Orquestrador: resultados de validator, navegador e checklist de cada task, e qualquer desvio aprovado pelo usuário. Vazia até a Task 1.

---

## Status

Seção do executor. Vazia até a primeira execução.
