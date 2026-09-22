# Mixagem de áudio da TIMELINE (sub-projeto B) — Implementation Plan

> **Para workers agênticos:** este plano segue o fluxo do `CLAUDE.md`: Orquestrador → subagente `executor` → subagente `validator` → `git-workflow`. **Uma task por invocação do executor**, na ordem 1 → 7. Steps usam checkbox (`- [ ]`). Steps marcados **[Orquestrador]** ou **[Usuário]** não são do executor: o executor para no último step marcado **[Executor]** e atualiza `## Status`.

**Goal:** Acrescentar à TIMELINE uma track SFX e transformar mudo/solo em controles de mixagem de verdade, com o arquivo exportado soando como o preview; segurar o true peak do master em −2 dBTP com um limitador de segurança; medir loudness, LRA e true peak do export contra o alvo de Reels (−14 a −16 LUFS, LRA até 9 LU); entregar a voz no nível-alvo desde o ASSEMBLE; mostrar o pico do master num medidor à direita da timeline; e avisar dos efeitos de SFX acima de −10 dBFS.

**Architecture:** Sete etapas, um PR cada. B0 corrige dois bugs de preview da TRILHA que a SFX herdaria. B1 muda só o servidor: sidecar v4 (`sfx`, `mix`), a regra de mudo/solo no conform, mono sem os −3 dB, o limitador do master (−2 dBTP, com oversampling) e a medição do mix antes do limitador (`astats`) e do arquivo (LUFS, LRA e true peak, `ebur128`). Não mexe na UI, e um sidecar antigo conformado com `limiter: false` gera exatamente o mesmo grafo de hoje. B2 põe a lane SFX nas duas rotas de preview, troca a prop do Player por `audible` (o bundle muda aqui e só aqui) e passa o slider de ganho para dB. B3 troca as chaves da TRILHA por `MIX` persistido, com M/S/L nas três tracks de áudio, e a mensagem do CONFORMAR diz o que ficou fora, o pico real, o LUFS, o LRA e quanto o limitador cortou. B4 normaliza a voz no ASSEMBLE (loudnorm em duas passadas, −16 LUFS, true peak −2). B5 põe o medidor de pico do master: o mix é renderizado offline com as regras do conform, antes do limitador, e o envelope serve play e scrub nas duas rotas; o vermelho começa no teto do limitador. B6 marca os clipes de SFX com pico acima de −10 dBFS e conta quantos vão para o export.

**Tech Stack:** HTML/CSS/JS vanilla num arquivo só (`public/index.html`, sem build); Node ≥18 sem npm (`server.js`, `lib/`); ffmpeg 6.1; Remotion 4.0.494 + esbuild (`remotion/`, só para o bundle do Player); Chrome (verificação de runtime).

**Spec:** `docs/superpowers/specs/2026-09-21-mixagem-audio-design.md`. O executor lê a spec antes da Task 1. Números de linha citados referem-se a `c3c8012`; **localize sempre pelo trecho citado**, não pelo número, porque cada task desloca as linhas das seguintes.

**Como este plano foi escrito:** toda troca e todo script abaixo foram aplicados e rodados numa cópia do repo antes de entrar aqui, na ordem das tasks (B0 → B1 → B2 → B3 → B4 → B5 → B6): cada checagem estática com FAIL antes e PASS depois; o bundle reconstruído; o `tsc` sem erro novo; os testes do B1 e do B4 com ffmpeg, ASSEMBLE e servidor reais; e a UI de B2, B3, B4 e B5 no navegador, com o probe passando — inclusive com som tocando de verdade nas duas rotas, a 1280×800, e o bug do B0 reproduzido no `HEAD`. Os blocos são cópia literal do que foi testado. A Revisão R2 da spec (referência de mixagem para Reels, medidor, voz) e a Revisão R3 (limitador do master, LRA, aviso de SFX) passaram pelo mesmo processo antes da execução: na R3, o plano inteiro foi reaplicado de um clone limpo por script, troca a troca, e os arquivos resultantes conferidos byte a byte contra a cópia testada.

## Global Constraints

- Zero dependência nova (npm ou outra). O B2 usa o `esbuild` que `remotion/` já tem para `npm run build:player`.
- Tocar só os arquivos listados em cada task. `lib/encode.js`, `lib/color.js`, `lib/captions.js`, `styles/` e a parte de vídeo do grafo do conform ficam intocados. `lib/ffmpeg.js` só ganha o campo `channels` no `mediaInfo` (Task 2). `lib/assemble.js` só muda no áudio, na Task 5: a cadeia de vídeo, a transcrição e o `.ass` ficam como estão.
- O mix não é normalizado para o alvo de loudness. O único processamento do master é o limitador de segurança de true peak (−2 dBTP, Task 2). O app mede (Task 2), mostra (Tasks 4, 6 e 7) e normaliza só a voz, na origem (Task 5). Nenhum limitador, compressor ou ganho automático por track: a SFX só recebe aviso (Task 7).
- O medidor (Task 6) e o aviso de SFX (Task 7) nunca se ligam ao áudio que está tocando: nada de `AnalyserNode` nem `createMediaElementSource`; o medidor renderiza uma cópia do mix num `OfflineAudioContext`, e o aviso lê os buffers já decodificados.
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
| `public/index.html` | `<audio>` por ocorrência e slider ao vivo (B0); lane SFX, `audibleNow`, teto de 16, fragmento por clipe, slider em dB (B2); `MIX`, M/S/L, `.silent`, persistência, `measuresMsg` e a mensagem do conform (B3); chip da voz no ASSEMBLE (B4); medidor de pico do master (B5); aviso de SFX acima de −10 dBFS (B6) | 1, 3, 4, 5, 6, 7 |
| `lib/timeline.js` | `normalizeMix`, `audible`, SFX no grafo, mono sem −3 dB, limitador do master, `measureLoudness`, `parseLoudness`, `parseMixPeak`, `loudWarnOf`, `tpWarnOf`, `lraWarnOf`, retorno com `sfx`/`mix`/`excluded`/`mixPeakDb`/`limiter`/`truePeakDb`/`tpWarn`/`lufs`/`loudWarn`/`lra`/`lraWarn` | 2 |
| `lib/assemble.js` | voz normalizada: `parseLoudnormJson`, `measureVoice`, `VOICE_TARGET`, `normalizeVoice`, retorno com `voice` | 5 |
| `lib/ffmpeg.js` | `mediaInfo` com `channels` | 2 |
| `server.js` | sidecar v4 (`sfx`, `mix` saneado); conform lê `sfx` e `mix` e repassa `limiter` do corpo (Task 2); `/api/assemble` repassa `normalizeVoice` (Task 5) | 2, 5 |
| `remotion/src/scenes/TimelinePreview.tsx` | props `sfx` e `audible`; `<Audio>` só de track audível | 3 |
| `remotion/src/player-entry.tsx` | `numberOfSharedAudioTags={16}` | 3 |
| `public/vendor/studio-player.js` | bundle regenerado por `npm run build:player` | 3 |
| `public/dev/ui-probe.js` | estágios `B2`/`B3`/`B5`/`B6`, `track-order` e `text-floor` por estágio, `motion-literals` sem a sobreposição da extensão, checks `sfx-lane`, `audio-controls`, `solo-exclusive`, `silent-lanes`, `meter`, `sfx-peak` | 3, 4, 6, 7 |

## Checklist manual de regressão

O checklist do sub-projeto A (itens 1–12 de `docs/plans/ui-premium-timeline.md`, "Checklist manual de regressão") continua valendo em toda task deste plano, com uma troca a partir da Task 4: o item 8 vira "M/S nas tracks de áudio refletem no preview; H em MARKERS, B-ROLL e LEGENDA reflete no preview". Cada task acrescenta os itens próprios dela. A Task 5 não mexe na TIMELINE e pede outro tipo de conferência: ouvir a voz antes e depois.

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
  // espião no fetch: guarda o id do último job de conform; conformResult() lê o resultado
  // completo (mixPeakDb, limiter…) em /api/jobs/:id — a mensagem mostra só parte dele
  spyConform() {
    if (window.fetch.__spy) return;
    const orig = window.fetch;
    window.fetch = async function (url) {
      const res = await orig.apply(this, arguments);
      if (String(url).includes('/api/timeline/conform')) res.clone().json().then(j => { T.conformJob = j.job; });
      return res;
    };
    window.fetch.__spy = true;
  },
  async conformResult() {
    const j = await (await fetch('/api/jobs/' + T.conformJob)).json();
    return j.state === 'done' ? j.result : { state: j.state, error: j.error };
  },
  async sidecar() {
    const j = await (await fetch('/api/beats?video=' + encodeURIComponent('output/assembled-4545f906507a.mp4'))).json();
    return j.beats && { version: j.beats.version, sfx: (j.beats.sfx || []).length, music: (j.beats.music || []).length, mix: j.beats.mix };
  },
};
'T pronto';
```

---

### Task 0: Preparo (Orquestrador, antes de qualquer execução)

- [x] **[Orquestrador]** Spec e plano commitados pelo `git-workflow` (`prepare` → OK do usuário → `publish`), num PR só de documentação por revisão: `docs/audio-mix-plan` (PR #16), `docs/audio-mix-plan-r2` (PR #17) e `docs/audio-mix-plan-r3` (Revisão R3), com os arquivos `docs/superpowers/specs/2026-09-21-mixagem-audio-design.md` e `docs/plans/mixagem-audio.md`.
- [ ] **[Orquestrador]** Mídia de teste (fora do git, em `jobs/b-check/`):

```bash
mkdir -p jobs/b-check
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=1000:d=0.8" jobs/b-check/whoosh.wav   # mono, 0,8s
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=330:d=10" -ac 2 jobs/b-check/bed.wav  # estéreo, 10s
# (R3) quase escala cheia (−0,1 dBFS), 1s: dois empilhados passam de 0 e o limitador do master corta (Task 4)
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=1000:d=1" -af volume=18dB jobs/b-check/loud.wav
# (R3) 0,3s a −3,1 dBFS e 0,5s a −20 dBFS, mono: o aviso de SFX acima de −10 (Task 7) e o pico só do trecho usado
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc='if(lt(t,0.3),0.7,0.1)*sin(2*PI*1000*t)':s=44100:d=0.8" jobs/b-check/hit.wav
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

### Task 2 (B1): Conform com SFX, mudo/solo, limitador do master e medição; sidecar v4

**Files:**
- Modify: `lib/timeline.js` — cabeçalho, constantes, bloco novo depois de `normalizeClips()`, `buildConformGraph()`, `buildConformArgs()`, `probeClips()`, bloco novo antes de `conform()`, corpo e retorno de `conform()`, `module.exports`.
- Modify: `lib/ffmpeg.js` — retorno de `mediaInfo()`.
- Modify: `server.js` — `require` de `./lib/timeline`, `POST /api/beats`, `POST /api/timeline/conform`.

**Interfaces:**
- Consumes: `runFfmpeg(args, { onLog })`, `mediaInfo(file)` (`lib/ffmpeg.js`); `resolveInput()`, `beatsSidecar()` (`server.js`).
- Produces (usados nas Tasks 3 e 4):
  - `normalizeMix(mix) → { mute: string[], solo: 'audio'|'music'|'sfx'|null }` — `mute` em ordem canônica `['audio','music','sfx']`, sem duplicatas;
  - `audible(mix, track) → boolean` — `!m.mute.includes(track) && (m.solo === null || m.solo === track)`;
  - `parseLoudness(stderr) → { lufs, lra, truePeakDb }` (resumo do `ebur128=peak=true`, uma casa; os três `null` em silêncio digital ou saída sem resumo);
  - `measureLoudness(file, onLog) → Promise<{ lufs, lra, truePeakDb }>` (nunca lança);
  - `parseMixPeak(stderr) → number | null` (último `Peak level dB:` do `astats`, uma casa; `null` com `-inf` ou sem o bloco);
  - `loudWarnOf(lufs) → 'low' | 'high' | null` (`< −16` → `'low'`; `> −14` → `'high'`);
  - `tpWarnOf(truePeakDb) → 'over' | null` (`> −1` → `'over'`); `lraWarnOf(lra) → 'high' | null` (`> 9` → `'high'`);
  - `MASTER_CEIL_DB = -2` (exportada);
  - `conform({ …, sfx = [], mix = null, limiter = true })` devolve, além do de hoje, `sfx` (contagem), `mix` (normalizado), `excluded` (tracks com conteúdo silenciadas pelo mix), `mixPeakDb`, `limiter` (`{ ceilingDb: -2, cutDb }` ou `null` com `limiter: false`), `truePeakDb`, `tpWarn`, `lufs`, `loudWarn`, `lra`, `lraWarn`;
  - `buildConformGraph({ …, sfx = [], limiter = true })` e `buildConformArgs({ …, sfx = [] })`; clipe de áudio com `channels === 1` ganha `pan=stereo|c0=c0|c1=c0`; com o limitador, o rótulo de áudio é `[amaster]`;
  - `POST /api/timeline/conform` aceita `limiter` no corpo (ligado quando ausente);
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

// 1 — não-regressão: sem sfx/mix e com limiter: false, grafo e args idênticos ao HEAD.
//     Com o limitador (o padrão): o mesmo grafo mais a cadeia do master, e o -map de áudio nela.
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
  let gN, gH, gL;
  try { gN = T.buildConformGraph({ ...fx, limiter: false }); gH = H.buildConformGraph(fx); gL = T.buildConformGraph(fx); }
  catch (e) { fail.push(name + ': grafo lançou ' + e.message); continue; }
  ok(eq(gN, gH), name + ': grafo (limiter: false) difere do HEAD');
  const argIn = { base: 'base.mp4', broll: fx.broll, music: fx.music, output: 'out.mp4', duration: fx.duration };
  const aH = H.buildConformArgs({ ...argIn, graph: gH });
  ok(eq(T.buildConformArgs({ ...argIn, graph: gN }), aH), name + ': args (limiter: false) diferem do HEAD');
  const master = `[aout]atrim=end=${fx.duration.toFixed(6)},asplit=2[mpre][mlim];` +
    '[mpre]astats=measure_perchannel=none:measure_overall=Peak_level,anullsink;' +
    '[mlim]aresample=176400,alimiter=limit=0.794328:attack=5:release=50:level=disabled:latency=1,aresample=44100[amaster]';
  ok(gL.filter === gH.filter + ';' + master && gL.vlabel === gH.vlabel && gL.alabel === '[amaster]',
    name + ': cadeia do master ausente ou diferente');
  const aL = T.buildConformArgs({ ...argIn, graph: gL });
  ok(eq(aL.map(a => (a === gL.filter ? 'FILTER' : a)),
    aH.map(a => (a === gH.filter ? 'FILTER' : a === '[aout]' ? '[amaster]' : a))),
    name + ': args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio');
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

// 5 — limiares de true peak e LRA, e o teto exportado.
if (typeof T.tpWarnOf !== 'function' || typeof T.lraWarnOf !== 'function') fail.push('tpWarnOf/lraWarnOf não exportadas');
else {
  const tw = [[-2, null], [-1.3, null], [-1, null], [-0.9, 'over'], [2.6, 'over'], [null, null]];
  tw.forEach(([v, want]) => ok(T.tpWarnOf(v) === want, `tpWarnOf(${v}) = ${T.tpWarnOf(v)}, esperado ${want}`));
  const rw = [[1.5, null], [4.3, null], [9, null], [9.1, 'high'], [15.4, 'high'], [null, null]];
  rw.forEach(([v, want]) => ok(T.lraWarnOf(v) === want, `lraWarnOf(${v}) = ${T.lraWarnOf(v)}, esperado ${want}`));
}
ok(T.MASTER_CEIL_DB === -2, 'MASTER_CEIL_DB = ' + T.MASTER_CEIL_DB + ', esperado -2');

// 6 — parse do ebur128=peak=true com a saída real do ffmpeg 6.1 (CRLF, como no Windows), e limiares de LUFS.
const SUM = (i, lra, tp) => '[Parsed_ebur128_0 @ 0000026b83919940] Summary:\r\n\r\n  Integrated loudness:\r\n' +
  `    I:         ${i} LUFS\r\n    Threshold: -35.6 LUFS\r\n\r\n  Loudness range:\r\n    LRA:         ${lra} LU\r\n` +
  '    Threshold: -45.6 LUFS\r\n    LRA low:   -27.9 LUFS\r\n    LRA high:  -23.5 LUFS\r\n\r\n  True peak:\r\n' +
  `    Peak:       ${tp} dBFS\r\n`;
// linha por frame antes do resumo: o parse não pode pegar o I, o LRA nem o TPK dela
const FRAME = '[Parsed_ebur128_0 @ 0000026b83919940] t: 38.2       TARGET:-23 LUFS    M: -30.1 S: -26.9     I: -30.0 LUFS' +
  '       LRA:   7.7 LU  FTPK: -63.6 -63.6 dBFS  TPK:  -1.0  -1.0 dBFS\r\n';
const NONE = { lufs: null, lra: null, truePeakDb: null };
if (typeof T.parseLoudness !== 'function' || typeof T.loudWarnOf !== 'function') {
  fail.push('parseLoudness/loudWarnOf não exportadas');
} else {
  const pl = [
    ['fixture', FRAME + SUM('-25.4', '4.3', '-8.3'), { lufs: -25.4, lra: 4.3, truePeakDb: -8.3 }],
    ['fixture em LF', (FRAME + SUM('-25.4', '4.3', '-8.3')).replace(/\r\n/g, '\n'), { lufs: -25.4, lra: 4.3, truePeakDb: -8.3 }],
    ['tons altos limitados', SUM('-6.6', '0.0', '-1.8'), { lufs: -6.6, lra: 0, truePeakDb: -1.8 }],
    ['sem limitador', SUM('-6.6', '0.0', '5.9'), { lufs: -6.6, lra: 0, truePeakDb: 5.9 }],
    ['silêncio', SUM('-70.0', '0.0', '-inf'), NONE],
    ['saída truncada', FRAME, NONE],
    ['vazio', '', NONE],
  ];
  pl.forEach(([name, txt, want]) => ok(eq(T.parseLoudness(txt), want),
    'parseLoudness(' + name + ') = ' + JSON.stringify(T.parseLoudness(txt)) + ', esperado ' + JSON.stringify(want)));
  const lw = [[-25.4, 'low'], [-16.1, 'low'], [-16, null], [-15, null], [-14, null], [-13.9, 'high'], [-6.6, 'high'], [null, null]];
  lw.forEach(([v, want]) => ok(T.loudWarnOf(v) === want, `loudWarnOf(${v}) = ${T.loudWarnOf(v)}, esperado ${want}`));
}

// 7 — pico antes do limitador: o bloco Overall do astats no fim do log do conform (saída real, CRLF).
const AST = v => '[Parsed_astats_33 @ 000002656afee840] Overall\r\n' +
  `[Parsed_astats_33 @ 000002656afee840] Peak level dB: ${v}\r\n`;
const PROG = 'frame=  181 fps= 60 q=-1.0 Lsize=     512KiB time=00:00:06.00 bitrate= 699.0kbits/s speed=1.99x    \r\n';
if (typeof T.parseMixPeak !== 'function') fail.push('parseMixPeak não exportada');
else {
  const mp = [
    ['voz', PROG + AST('-8.334512'), -8.3],
    ['acima de 0', AST('5.912345'), 5.9],
    ['logo abaixo de 0', AST('-0.063921'), -0.1],
    ['silêncio', AST('-inf'), null],
    ['dois blocos: vale o último', AST('-20.000000') + AST('-3.040000'), -3],
    ['sem astats', PROG, null],
    ['vazio', '', null],
  ];
  mp.forEach(([name, txt, want]) => ok(T.parseMixPeak(txt) === want,
    'parseMixPeak(' + name + ') = ' + T.parseMixPeak(txt) + ', esperado ' + want));
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
// Instante (s) da amostra de maior |valor| no áudio de `file`, entre os dois canais.
function peakAt(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0',
    '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'], { maxBuffer: 1 << 28 });
  const a = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
  let best = 0, at = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > best) { best = v; at = i >> 1; } }
  return at / 44100;
}
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
  // 6s a +3,5 dB: calibrado na cópia de teste para o conform cair em ~-15 LUFS (dentro de -14..-16)
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=6', '-af', 'volume=3.5dB', P('mid.wav')]);
  // 3s alto e 3s 20 dB abaixo: LRA acima de 9 LU
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=6', '-af', "volume='if(lt(t,3),2,0.2)':eval=frame", P('dyn.wav')]);
  // um clique de uma amostra em 2,000s, a -0,9 dBFS (acima do teto): prova que o lookahead não desloca o som
  ff(['-f', 'lavfi', '-i', "aevalsrc='if(eq(n,88200),0.9,0)':s=44100:d=6", P('click.wav')]);

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
  // tons de -18 dBFS que não se sobrepõem: o limitador não corta nada
  ok(typeof r.mixPeakDb === 'number' && r.mixPeakDb < -12 && r.limiter && r.limiter.ceilingDb === -2 && r.limiter.cutDb === 0,
    'C1: mix ' + r.mixPeakDb + ' / limitador ' + JSON.stringify(r.limiter));
  ok(typeof r.truePeakDb === 'number' && r.truePeakDb < -12 && r.tpWarn === null, 'C1: pico real ' + r.truePeakDb + ' / ' + r.tpWarn);
  ok(typeof r.lufs === 'number' && r.lufs < -16 && r.loudWarn === 'low', 'C1: loudness ' + r.lufs + ' / ' + r.loudWarn + ', esperado low');
  ok(typeof r.lra === 'number', 'C1: LRA ' + r.lra);

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
  ok(r.mixPeakDb === null && r.truePeakDb === null && r.tpWarn === null,
    'C4: silêncio deveria dar picos null, deu ' + r.mixPeakDb + ' / ' + r.truePeakDb);
  ok(r.limiter && r.limiter.cutDb === null, 'C4: silêncio deveria dar corte null, deu ' + JSON.stringify(r.limiter));
  ok(r.lufs === null && r.loudWarn === null && r.lra === null && r.lraWarn === null,
    'C4: silêncio deveria dar lufs e LRA null, deu ' + r.lufs + ' / ' + r.lra);

  // C5 — dois tons em escala cheia sobrepostos (+5,9 dBFS na soma): o limitador segura o true peak.
  const LOUD = { music: [{ ...MUS[0], path: P('loud.wav'), start: 2 }], sfx: [{ ...SFX[0], path: P('loud.wav'), start: 2 }] };
  r = await run(LOUD);
  ok(r.mixPeakDb > 0 && r.limiter?.cutDb > 2, 'C5: mix ' + r.mixPeakDb + ' / corte ' + r.limiter?.cutDb);
  ok(r.truePeakDb <= -1 && r.tpWarn === null, 'C5: pico real ' + r.truePeakDb + ' / ' + r.tpWarn + ', esperado ≤ -1 sem aviso');
  ok(r.loudWarn === 'high' && r.lufs > -14, 'C5: loudness ' + r.lufs + ' / ' + r.loudWarn + ', esperado high');

  // C5b — o mesmo sem o limitador: passa de 0 e avisa.
  r = await run({ ...LOUD, limiter: false });
  ok(r.limiter === null && r.mixPeakDb === null, 'C5b: limitador ' + JSON.stringify(r.limiter) + ' / mix ' + r.mixPeakDb);
  ok(r.truePeakDb > 0 && r.tpWarn === 'over', 'C5b: pico real ' + r.truePeakDb + ' / ' + r.tpWarn + ', esperado > 0 e over');

  // C6 — um tom a ~−0,6 dBFS: corte entre 1 e 2 dB, true peak no teto.
  r = await run({ music: [{ ...MUS[0], path: P('hot.wav'), start: 2 }] });
  ok(r.limiter?.cutDb > 1 && r.limiter?.cutDb < 2 && r.truePeakDb <= -1.5 && r.tpWarn === null,
    'C6: corte ' + r.limiter?.cutDb + ' / pico real ' + r.truePeakDb);

  // C7 — TRILHA de 6s no nível calibrado: loudness dentro do alvo, sem aviso; tom constante, LRA baixo.
  r = await run({ music: [{ ...MUS[0], path: P('mid.wav'), start: 0, dur: 6 }] });
  ok(typeof r.lufs === 'number' && r.lufs >= -16 && r.lufs <= -14 && r.loudWarn === null,
    'C7: loudness ' + r.lufs + ' / ' + r.loudWarn + ', esperado entre -16 e -14 sem aviso');
  ok(typeof r.lra === 'number' && r.lra < 9 && r.lraWarn === null, 'C7: LRA ' + r.lra + ' / ' + r.lraWarn);

  // C8 — 3s alto e 3s 20 dB abaixo: LRA acima de 9.
  r = await run({ music: [{ ...MUS[0], path: P('dyn.wav'), start: 0, dur: 6 }] });
  ok(r.lra > 9 && r.lraWarn === 'high', 'C8: LRA ' + r.lra + ' / ' + r.lraWarn + ', esperado > 9 e high');

  // C9 — alinhamento: o clique sai na mesma posição com e sem o limitador (±1 ms), e em 2,000s.
  const CLICK = { music: [{ ...MUS[0], path: P('click.wav'), start: 0, dur: 6 }] };
  const tOn = peakAt((await run(CLICK)).output);
  const tOff = peakAt((await run({ ...CLICK, limiter: false })).output);
  ok(Math.abs(tOn - tOff) <= 0.001 && Math.abs(tOn - 2) <= 0.001,
    `C9: clique em ${tOn.toFixed(4)}s com o limitador, ${tOff.toFixed(4)}s sem, esperado 2,000 ± 0,001`);

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

    const conformVia = async (extra = {}) => {
      const c = await req('POST', '/api/timeline/conform', { video, ...extra });
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
    ok(res1.limiter && res1.limiter.ceilingDb === -2, 'rota: limitador deveria vir ligado por padrão, veio ' + JSON.stringify(res1.limiter));
    const out1 = path.join(ROOT, res1.output);
    expectWin('rota mute sfx', windows(out1), { A: 'som', S: 'silêncio' });
    fs.rmSync(out1, { force: true });

    // limiter: false no corpo da requisição desliga o limitador.
    const resOff = await conformVia({ limiter: false });
    ok(resOff.limiter === null && resOff.mixPeakDb === null, 'rota limiter:false: ' + JSON.stringify({ limiter: resOff.limiter, mixPeakDb: resOff.mixPeakDb }));
    fs.rmSync(path.join(ROOT, resOff.output), { force: true });

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

Rodar `node jobs/checks/b1-unit.js`. Esperado: `FAIL` com, para cada um dos 4 fixtures, `cadeia do master ausente ou diferente` e `args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio`; as 5 linhas de "SFX…" (cadeia do primeiro clipe, segundo clipe, amix, ordem dos `-i`, SFX sem TRILHA); `mono: pan só no clipe de 1 canal`; `normalizeMix/audible não exportadas`; `tpWarnOf/lraWarnOf não exportadas`; `MASTER_CEIL_DB = undefined, esperado -2`; `parseLoudness/loudWarnOf não exportadas`; e `parseMixPeak não exportada`. As linhas de não-regressão com `limiter: false` **não** aparecem (o grafo de hoje é igual ao do `HEAD`).

Rodar `node jobs/checks/b1-e2e.js` (≈ 40s). Esperado: `FAIL` que inclui `C1: mono perdeu 3 dB no export — RMS S -Infinity, M -24.09…`, janelas de C3/C4 com som onde deveria haver silêncio, as linhas de medição com `undefined` (`C1: mix undefined / limitador undefined`, `C1: pico real undefined / undefined`, `C1: loudness undefined / undefined, esperado low`, `C4`, `C5`, `C5b`, `C6`, `C7`, `C8: LRA undefined / undefined, esperado > 9 e high`), `sidecar: version 3`, `rota: limitador deveria vir ligado por padrão, veio undefined` e `(arquivos mantidos em jobs/b1-check/)`. O `C9` (alinhamento) passa já no código de hoje, que não tem limitador: ele protege contra o lookahead deslocar o som. Apagar `jobs/b1-check/` depois (`rm -rf jobs/b1-check`) e qualquer `output/conformed-*.mp4` criado por esta rodada (o script lista o caminho na linha `rota: mix do sidecar ignorado`).

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

- [ ] **Step 3 [Executor]: `lib/timeline.js` — 12 trocas, nesta ordem**

**lib/timeline.js · troca 1 — cabeçalho: SFX, master e mix.** Substituir:

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
//   MASTER  a true-peak safety limiter on the sum, ceiling -2 dBTP: three AAC
//           encodes stand between this file and a phone (this mezzanine, the
//           Export, the platform), and each one can push a peak up.
//
// The mix follows the preview (export = preview): a track the user muted, or
// that another track's solo silences, never becomes an input. `mix` comes from
// the sidecar, so normalizeMix() drops anything unexpected before it is read.
// The limiter is the one declared exception: the preview cannot run it, so
// above the ceiling the export sounds more contained than what the user heard
// (the timeline meter shows where). `limiter: false` leaves the sum untouched.
//
```

**lib/timeline.js · troca 2 — constantes do limitador do master.** Substituir:

```js
const MEZZANINE_CRF = 12;   // matches assemble.js — visually lossless working file
const OUT_FPS = 30;
```

por:

```js
const MEZZANINE_CRF = 12;   // matches assemble.js — visually lossless working file
// Master limiter ceiling. -2, not -1: measured, this file's AAC 192k plus the
// Export's AAC 128k pushed a -1 dBTP ceiling to +0.3 dBTP; -2 held at -1.3.
const MASTER_CEIL_DB = -2;
const MASTER_LIMIT = '0.794328';   // 10^(-2/20): alimiter takes the ceiling as linear gain
const OUT_FPS = 30;
```

**lib/timeline.js · troca 3 — normalizeMix + audible depois de normalizeClips.** Substituir:

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

**lib/timeline.js · troca 4 — buildConformGraph: comentário e assinatura.** Substituir:

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
  fit = 'blur', duration, limiter = true }) {
```

**lib/timeline.js · troca 5 — buildConformGraph: TRILHA + SFX no amix, e o master.** Substituir:

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

  return { filter: g.join(';'), vlabel, alabel: '[aout]' };
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
  if (!limiter) return { filter: g.join(';'), vlabel, alabel: '[aout]' };

  // 4 — MASTER: the sum splits in two. One branch only measures the peak
  // before the limiter (astats is float, so it reads above 0 dBFS; conform()
  // parses it from the log). The other is the limiter: alimiter limits sample
  // peaks, so it runs 4× oversampled to hold the ceiling as a true peak;
  // level=disabled turns off its automatic make-up gain; latency=1 removes the
  // lookahead delay, keeping the sound on the picture. The atrim bounds the sum:
  // the measuring branch ends only when its input does, and an endless input
  // would hang ffmpeg past -t.
  g.push(`[aout]atrim=end=${ts(duration)},asplit=2[mpre][mlim]`);
  g.push('[mpre]astats=measure_perchannel=none:measure_overall=Peak_level,anullsink');
  g.push(`[mlim]aresample=176400,alimiter=limit=${MASTER_LIMIT}:attack=5:release=50:` +
    'level=disabled:latency=1,aresample=44100[amaster]');
  return { filter: g.join(';'), vlabel, alabel: '[amaster]' };
```

**lib/timeline.js · troca 6 — buildConformArgs: inputs de SFX.** Substituir:

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

**lib/timeline.js · troca 7 — probeClips: guardar canais do áudio.** Substituir:

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

**lib/timeline.js · troca 8 — medição e limiares antes de conform().** Substituir:

```js
async function conform({ base, segments = [], broll = [], music = [], output, workDir,
  fit = 'blur', words = null, captionStyle = 'impact',
  onLog = () => {}, onStage = () => {}, onProgress = () => {} }) {
```

por:

```js
// Nothing checked the mix before this: a Reel is mixed for -14..-16 LUFS
// integrated, a loudness range a phone speaker can carry, and a true peak of
// -1..-2 dBTP after encoding. Two readings, both never fatal (a failed run or
// unexpected output gives nulls):
//   - the sum before the limiter: the master chain's astats branch prints it at
//     the end of the conform's own log. Same sample peak as the timeline meter,
//     read before any AAC.
//   - the finished file (what the Export reads): one ebur128 pass gives the
//     integrated loudness, the LRA and the true peak. Digital silence (I at the
//     -70 LUFS gate floor, peak -inf; JSON has no -Infinity) gives nulls.
const num1 = v => (/inf/.test(v) ? null : Math.round(parseFloat(v) * 10) / 10);
function parseMixPeak(stderr) {
  const all = [...String(stderr || '').matchAll(/Peak level dB:\s*(-?(?:inf|[\d.]+))/g)];
  return all.length ? num1(all[all.length - 1][1]) : null;
}
function parseLoudness(stderr) {
  const none = { lufs: null, lra: null, truePeakDb: null };
  const s = String(stderr || '');
  const at = s.lastIndexOf('Summary:');
  if (at < 0) return none;
  const sum = s.slice(at);
  const i = /\bI:\s*(-?(?:inf|[\d.]+))\s*LUFS/.exec(sum);
  const lufs = i ? num1(i[1]) : null;
  if (lufs == null || lufs <= -70) return none;
  const l = /\bLRA:\s*(-?(?:inf|[\d.]+))\s*LU\b/.exec(sum);
  const p = /True peak:\s*Peak:\s*(-?(?:inf|[\d.]+))\s*dBFS/.exec(sum);
  return { lufs, lra: l ? num1(l[1]) : null, truePeakDb: p ? num1(p[1]) : null };
}
async function measureLoudness(file, onLog = () => {}) {
  let log = '';
  try {
    await runFfmpeg(['-nostats', '-i', file, '-map', '0:a:0',
      '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { onLog: s => { log += s; } });
  } catch (e) {
    onLog(`[conform] loudness não medida — ${String(e.message || e).split('\n')[0]}\n`);
    return { lufs: null, lra: null, truePeakDb: null };
  }
  return parseLoudness(log);
}
// Target for a Reel: -14..-16 LUFS integrated. Reported, never applied to the mix.
function loudWarnOf(lufs) {
  if (lufs == null) return null;
  if (lufs < -16) return 'low';
  return lufs > -14 ? 'high' : null;
}
// True peak above -1 dBTP: the AAC pushed the file out of the delivery range.
function tpWarnOf(truePeakDb) {
  return truePeakDb != null && truePeakDb > -1 ? 'over' : null;
}
// LRA above 9 LU swings too wide for a phone speaker. Below 4 is not flagged:
// nearly every voice-led reel measures 1-4.
function lraWarnOf(lra) {
  return lra != null && lra > 9 ? 'high' : null;
}

async function conform({ base, segments = [], broll = [], music = [], sfx = [], mix = null,
  limiter = true, output, workDir, fit = 'blur', words = null, captionStyle = 'impact',
  onLog = () => {}, onStage = () => {}, onProgress = () => {} }) {
```

**lib/timeline.js · troca 9 — conform(): regra antes do grafo.** Substituir:

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
    hasAudio: !!info.acodec && audible(mixN, 'audio'), fit, duration, limiter,
  });
  const args = buildConformArgs({ base, broll: b.usable, music: m.usable, sfx: x.usable,
    graph, output, duration });
```

**lib/timeline.js · troca 10 — conform(): pico antes do limitador e medição do arquivo depois do ffmpeg.** Substituir:

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
  // the tail of this run's log carries the master chain's pre-limiter peak
  let runLog = '';
  await runFfmpeg(args, {
    onLog: s => { runLog = (runLog + s).slice(-16000); onLog(s); },
    onProgress: p => onProgress({ ...p, pct: Math.min(99, (p.time / duration) * 100) }),
  });
  const mixPeakDb = limiter ? parseMixPeak(runLog) : null;
  // how far the loudest peak went over the ceiling (approximate: the limiter
  // acts on the true peak, mixPeakDb is a sample peak)
  const cutDb = mixPeakDb == null ? null
    : Math.max(0, Math.round((mixPeakDb - MASTER_CEIL_DB) * 10) / 10);

  onStage('loudness', 'Medindo pico real, loudness e LRA');
  const { lufs, lra, truePeakDb } = await measureLoudness(output, onLog);
  const f1 = (v, unit) => (v == null ? 'n/d' : v.toFixed(1) + unit);
  onLog('[conform] ' + (limiter ? `mix antes do limitador: ${f1(mixPeakDb, ' dBFS')}` +
      (cutDb == null ? '' : ` (corte ${cutDb.toFixed(1)} dB)`) + ' · ' : '') +
    `pico real: ${f1(truePeakDb, ' dBTP')} · loudness: ${f1(lufs, ' LUFS')} · LRA: ${f1(lra, ' LU')}\n`);
```

**lib/timeline.js · troca 11 — conform(): retorno.** Substituir:

```js
    broll: b.usable.length, music: m.usable.length,
    skipped: [...b.skipped, ...m.skipped],
```

por:

```js
    broll: b.usable.length, music: m.usable.length, sfx: x.usable.length,
    skipped: [...b.skipped, ...m.skipped, ...x.skipped],
    mix: mixN, excluded,
    mixPeakDb, limiter: limiter ? { ceilingDb: MASTER_CEIL_DB, cutDb } : null,
    truePeakDb, tpWarn: tpWarnOf(truePeakDb),
    lufs, loudWarn: loudWarnOf(lufs), lra, lraWarn: lraWarnOf(lra),
```

**lib/timeline.js · troca 12 — exports.** Substituir:

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
  normalizeMix, audible, measureLoudness, parseLoudness, parseMixPeak,
  loudWarnOf, tpWarnOf, lraWarnOf, MASTER_CEIL_DB,
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

**server.js · troca 5 — conform: passar sfx, mix e limiter.** Substituir:

```js
          base, segments: tl.segments || [], broll, music,
          output: out, workDir: dir, fit: b.fit || 'blur',
```

por:

```js
          base, segments: tl.segments || [], broll, music, sfx, mix: tl.mix,
          limiter: b.limiter !== false,
          output: out, workDir: dir, fit: b.fit || 'blur',
```

- [ ] **Step 5 [Executor]: Checagens** — `node --check server.js`; `node jobs/checks/b1-unit.js` → `PASS: B1 unidade`; `node jobs/checks/b1-e2e.js` → `PASS: B1 ponta a ponta` (ele apaga `jobs/b1-check/` quando passa). Nenhum servidor pode estar ocupando a porta 4879.

- [ ] **Step 6 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 5. Parar aqui.

- [ ] **Step 7 [Orquestrador]: `validator`** — "validar a Task 2 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b1-unit.js` e `node jobs/checks/b1-e2e.js`; conferir que a regra de `audible` em `lib/timeline.js` é exatamente a da spec; que a cadeia do master é exatamente a da spec (seção do conform, item 5), com `atrim=end=<duração>` antes do `asplit`; que todo caminho de `tl.sfx` passa por `resolveInput`; que `lib/ffmpeg.js` só ganhou o campo `channels`; que a parte de vídeo de `buildConformGraph` (passos 1 e 2) é idêntica ao `HEAD`; que o `limiter` do conform vem do corpo da requisição (`b.limiter`), não do sidecar; e que `measureLoudness` e `parseMixPeak` nunca fazem o conform falhar".

- [ ] **Step 8 [Usuário]: Conferência rápida** — num projeto que já tenha TRILHA, CONFORMAR → EXPORT conclui como antes (item 11 do checklist). Se a TRILHA for mono, o export sai 3 dB mais alto que antes: é a correção da decisão 13, agora igual ao preview. Com a TRILHA alta, os picos saem contidos pelo limitador do master (−2 dBTP): é a exceção declarada da decisão 21. O log do job mostra a linha `[conform] mix antes do limitador: … · pico real: … · loudness: … · LRA: …`.

- [ ] **Step 9 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b1`; arquivos `lib/timeline.js`, `lib/ffmpeg.js`, `server.js`; commit `Conform SFX and mute/solo, add master limiter, measure loudness (B1)`) → OK do usuário → `publish`.

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
  - slider em dB: `GAIN_DB_MIN = -40`, `dbOf(volume)`, `volumeOf(db)`, `dbLabel(db)` (o dado continua `volume` linear);
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
  'clipsFor(track)[+inp.dataset.idx].volume = volumeOf(+inp.value);', "inp.setAttribute('aria-valuetext', inp.title);",
  'min="${GAIN_DB_MIN}" max="0" step="0.5" value="${dbOf(c.volume)}"', 'const GAIN_DB_MIN = -40;',
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

// Slider em dB: as três funções puras, extraídas do HTML e testadas nos extremos.
{
  const a = src.indexOf('  const GAIN_DB_MIN = -40;'), b = src.indexOf('\n', src.indexOf('  function dbLabel(db) {'));
  let G = null;
  try { G = new Function(src.slice(a, b) + '\nreturn { dbOf, volumeOf, dbLabel };')(); }
  catch (e) { fail.push('dbOf/volumeOf/dbLabel não extraíveis: ' + e.message); }
  if (G && a >= 0) {
    const near = (x, y) => Math.abs(x - y) < 1e-4;
    const cases = [
      ['dbOf(1)', G.dbOf(1), 0], ['dbOf(0.8)', G.dbOf(0.8), -2], ['dbOf(0.0631)', G.dbOf(0.0631), -24],
      ['dbOf(0.01)', G.dbOf(0.01), -40], ['dbOf(0)', G.dbOf(0), -40], ['dbOf(0.001)', G.dbOf(0.001), -40],
      ['volumeOf(0)', G.volumeOf(0), 1], ['volumeOf(-40)', G.volumeOf(-40), 0.01],
      ['dbLabel(-24)', G.dbLabel(-24), '−24,0 dB'], ['dbLabel(0)', G.dbLabel(0), '0,0 dB'], ['dbLabel(-2.5)', G.dbLabel(-2.5), '−2,5 dB'],
    ];
    cases.forEach(([n, got, want]) => { if (got !== want) fail.push(n + ' = ' + got + ', esperado ' + want); });
    if (!near(G.volumeOf(-24), 0.0631)) fail.push('volumeOf(-24) = ' + G.volumeOf(-24) + ', esperado ≈ 0.0631');
    for (let d = -40; d <= 0; d += 0.5) if (G.dbOf(G.volumeOf(d)) !== d) { fail.push('ida e volta falhou em ' + d + ' dB'); break; }
  }
}

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
  /* Ganho do clipe em dB no slider, linear (0–1) no dado. Linear com passo de
     0,05 só tinha dois pontos entre -20 e -30 dB, a faixa em que a música fica
     sob a voz. O sidecar, o conform e o Player continuam lendo `volume`
     linear: um volume antigo só muda quando alguém mexe no slider. */
  const GAIN_DB_MIN = -40;
  function dbOf(volume) {
    return volume > 0 ? Math.max(GAIN_DB_MIN, Math.min(0, Math.round(40 * Math.log10(volume)) / 2)) : GAIN_DB_MIN;
  }
  function volumeOf(db) { return db <= GAIN_DB_MIN ? 0.01 : Math.min(1, Math.pow(10, db / 20)); }
  function dbLabel(db) { return (db < 0 ? '−' : '') + Math.abs(db).toFixed(1).replace('.', ',') + ' dB'; }
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
        ? `<input type="range" class="bt-clip-vol" min="${GAIN_DB_MIN}" max="0" step="0.5" value="${dbOf(c.volume)}" data-idx="${i}"
            title="${dbLabel(dbOf(c.volume))}" aria-label="Ganho do clipe" aria-valuetext="${dbLabel(dbOf(c.volume))}">`
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
        inp.addEventListener('input', () => {
          clipsFor(track)[+inp.dataset.idx].volume = volumeOf(+inp.value);
          inp.title = dbLabel(+inp.value);
          inp.setAttribute('aria-valuetext', inp.title);
          syncPlayer();
        });
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
inp.value = '-24'; inp.dispatchEvent(new Event('input'));
a.slider = { updates: T.updates - u0, vol: +T.props.sfx[0].volume.toFixed(4), title: inp.title, faixa: [inp.min, inp.max, inp.step] };
T.key('z', { ctrlKey: true }); await T.sleep(150); a.undo = T.clips('sfx');
a
```

Esperado: `titulo: "ADICIONAR SFX"`, `width: "48px"` (0,8s × 60px/s), `border: "rgb(34, 211, 238)"`, `nm: "9.5px"`, `props: ["sfx0"]`, `audible` todo `true`, `empilhados: ["sfx0","sfx1"]`, `slider: { updates: 1, vol: 0.0631, title: "−24,0 dB", faixa: ["-40", "0", "0.5"] }` (o Player recebe `10^(−24/20)`), `undo: 1`.

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

- [ ] **Step 13 [Usuário]: Checklist manual** (itens 1–12 do A) + subir um efeito curto (qualquer `.wav`/`.mp3`) e pô-lo na SFX pelo `+`: entra com a duração do arquivo, toca na janela certa nas duas rotas, o slider de ganho mostra dB no `title` e age ao vivo, arrastar/trim/dividir/duplicar/colar/apagar funcionam como na TRILHA, SALVAR → recarregar mantém a SFX. Um projeto antigo abre com a SFX vazia.

- [ ] **Step 14 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b2`; arquivos `public/index.html`, `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`, `public/vendor/studio-player.js`, `public/dev/ui-probe.js`; commit `Add SFX track to the TIMELINE with both preview routes (B2)`) → OK do usuário → `publish`.

**Lacuna conhecida até a Task 4:** o export mixa a SFX sempre (o app ainda não envia `mix`), enquanto o solo da TRILHA a cala no preview. Fecha na Task 4.

---

### Task 4 (B3): Mudo e solo como controles de mixagem, e as medidas na mensagem

**Files:**
- Modify: `public/index.html` — CSS depois de `.bt-track-row.hidden …`, estado (`trilhaMuted`/`trilhaSolo` saem), `audibleNow()`, `timelineState()`, `saveBeats()`, `measuresMsg()` (nova, antes do comentário do CONFORMAR), `doConform()`, `applySavedBeats()`, `TCTL` e comentário, markup do `buildDom()` (ÁUDIO, TRILHA, SFX), `applyTrackVisibility()`, `wireTracks()`, `loadVideo()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `audibleNow()`, `SFX`, sidecar v4 e o retorno de `conform()` (`sfx`, `mix`, `excluded`, `truePeakDb`, `tpWarn`, `lufs`, `loudWarn`, `lra`, `lraWarn`, `limiter`) das Tasks 2 e 3.
- Produces: `const AUDIO_TRACKS`, `let MIX = { mute: [], solo: null }`, `normalizeMix(mix)`, `audible(track)` — a regra com o mesmo texto de `lib/timeline.js`; `measuresMsg(r) → string` (as medidas da mensagem, pura; a Task 7 acrescenta um trecho depois dela); classe `.silent` nas linhas de áudio que não vão soar; probe com `TRACK_ACTS_B3`, `soloExclusive()`, `silentLanes()` e os checks `audio-controls`, `solo-exclusive`, `silent-lanes`.

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
  'Silenciar trilha', 'Ativar solo da trilha', 'não altera o export\', icons: [\'i-spk', 'r.peakWarn', 'r.peakDb']);
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
  '· ${r.sfx} SFX', 'fora do export: ${fora} (${why})', '${measuresMsg(r)}${skipped}', "r.tpWarn === 'over');",
  '  function measuresMsg(r) {',
]);
if (count(src, 'measuresMsg(r)') !== 2) fail.push('measuresMsg(r) deveria aparecer 2× (definição e doConform)');

// A mensagem das medidas: a função pura, extraída do HTML, contra resultados de conform.
{
  const m = /  function measuresMsg\(r\) \{\n[\s\S]*?\n  \}\n/.exec(src);
  if (!m) fail.push('measuresMsg não achada');
  else {
    const msg = new Function(m[0] + '\nreturn measuresMsg;')();
    const cases = [
      ['fixture', { truePeakDb: -8.3, tpWarn: null, lufs: -25.4, loudWarn: 'low', lra: 4.3, lraWarn: null, limiter: { ceilingDb: -2, cutDb: 0 } },
        ' · pico real −8,3 dBTP · −25,4 LUFS: abaixo do alvo −14 a −16 · LRA 4,3 LU'],
      ['no alvo, corte leve', { truePeakDb: -2, tpWarn: null, lufs: -15.1, loudWarn: null, lra: 0.2, lraWarn: null, limiter: { ceilingDb: -2, cutDb: 1.4 } },
        ' · pico real −2,0 dBTP · −15,1 LUFS · LRA 0,2 LU · limitador −1,4 dB'],
      ['corte de 3 dB', { truePeakDb: -2, tpWarn: null, lufs: -15, loudWarn: null, lra: 3, lraWarn: null, limiter: { ceilingDb: -2, cutDb: 3 } },
        ' · pico real −2,0 dBTP · −15,0 LUFS · LRA 3,0 LU · limitador −3,0 dB'],
      ['mix alto', { truePeakDb: -2, tpWarn: null, lufs: -3.8, loudWarn: 'high', lra: 5.3, lraWarn: null, limiter: { ceilingDb: -2, cutDb: 8 } },
        ' · pico real −2,0 dBTP · −3,8 LUFS: acima do alvo −14 a −16 · LRA 5,3 LU · limitador −8,0 dB — mix alto: abaixe TRILHA/SFX'],
      ['AAC passou do teto', { truePeakDb: 0.4, tpWarn: 'over', lufs: -14.2, loudWarn: null, lra: 11.4, lraWarn: 'high', limiter: { ceilingDb: -2, cutDb: 0 } },
        ' · pico real +0,4 dBTP — acima de −1 depois do AAC: abaixe TRILHA/SFX · −14,2 LUFS · LRA 11,4 LU: dinâmica alta para celular (ideal ≤ 9)'],
      ['limiter: false', { truePeakDb: 6.4, tpWarn: 'over', lufs: -1.3, loudWarn: 'high', lra: 5.5, lraWarn: null, limiter: null },
        ' · pico real +6,4 dBTP — acima de −1 depois do AAC: abaixe TRILHA/SFX · −1,3 LUFS: acima do alvo −14 a −16 · LRA 5,5 LU'],
      ['silêncio', { truePeakDb: null, tpWarn: null, lufs: null, loudWarn: null, lra: null, lraWarn: null, limiter: { ceilingDb: -2, cutDb: null } }, ''],
    ];
    cases.forEach(([name, r, want]) => { const got = msg(r); if (got !== want) fail.push(`measuresMsg(${name}) = "${got}", esperado "${want}"`); });
  }
}
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

Rodar `node jobs/checks/b3-static.js`. Esperado: `FAIL` com `index.html — regra audible() ausente ou duplicada`, as linhas `não deveria existir:` de `trilhaMuted`, `trilhaSolo`, `hiddenTracks.music`, dos H de ÁUDIO/TRILHA e dos textos antigos de M/S, as linhas `ausente:`, `esperadas 19 chamadas ${tctlHtml(…)}, achadas 17`, `mix: MIX deveria aparecer 2×`, `measuresMsg(r) deveria aparecer 2× (definição e doConform)`, `measuresMsg não achada` e as linhas `ausente:` do probe. A linha da regra em `lib/timeline.js` **não** aparece (a Task 2 já a criou).

- [ ] **Step 2 [Executor]: `public/index.html` — 19 trocas, nesta ordem**

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

**public/index.html · troca 6 — measuresMsg antes do CONFORMAR.** Substituir:

```html
  /* CONFORMAR: achata a timeline num mezanino de verdade e o entrega ao EXPORT.
```

por:

```html
  /* Medidas do arquivo conformado, na ordem da mensagem: pico real, LUFS, LRA e
     o corte do limitador do master. Informam; só o pico real acima de −1 dBTP
     (o AAC empurrou para fora da faixa) vira erro, no stage() de doConform. */
  function measuresMsg(r) {
    const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',');
    const un = v => v.toFixed(1).replace('.', ',');
    let s = '';
    if (r.truePeakDb != null) s += ` · pico real ${sg(r.truePeakDb)} dBTP` +
      (r.tpWarn === 'over' ? ' — acima de −1 depois do AAC: abaixe TRILHA/SFX' : '');
    if (r.lufs != null) s += ` · ${sg(r.lufs)} LUFS` +
      (r.loudWarn === 'low' ? ': abaixo do alvo −14 a −16' : r.loudWarn === 'high' ? ': acima do alvo −14 a −16' : '');
    if (r.lra != null) s += ` · LRA ${un(r.lra)} LU` + (r.lraWarn === 'high' ? ': dinâmica alta para celular (ideal ≤ 9)' : '');
    // acima de 3 dB de corte, um limitador de pico já achata os transientes
    const cut = r.limiter ? r.limiter.cutDb : null;
    if (cut > 0) s += ` · limitador −${un(cut)} dB` + (cut > 3 ? ' — mix alto: abaixe TRILHA/SFX' : '');
    return s;
  }
  /* CONFORMAR: achata a timeline num mezanino de verdade e o entrega ao EXPORT.
```

**public/index.html · troca 7 — doConform: SFX, o que ficou de fora e as medidas.** Substituir:

```html
      stage(`timeline conformada — ${r.duration.toFixed(1)}s · ${r.broll} B-ROLL · ${r.music} TRILHA` +
        ` · ${r.captionedWords} palavras${skipped}`);
```

por:

```html
      // export = preview: diz o que o mix deixou fora; depois, as medidas do arquivo
      const NAME = { audio: 'ÁUDIO', music: 'TRILHA', sfx: 'SFX' };
      const fora = (r.excluded || []).map(t => NAME[t]).join(', ');
      const why = r.mix && r.mix.solo ? 'solo: ' + NAME[r.mix.solo] : 'mudo';
      stage(`timeline conformada — ${r.duration.toFixed(1)}s · ${r.broll} B-ROLL · ${r.music} TRILHA · ${r.sfx} SFX` +
        ` · ${r.captionedWords} palavras${fora ? ` · fora do export: ${fora} (${why})` : ''}${measuresMsg(r)}${skipped}`,
        r.tpWarn === 'over');
```

**public/index.html · troca 8 — applySavedBeats lê mix.** Substituir:

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

**public/index.html · troca 9 — TCTL: comentário e textos de M/S.** Substituir:

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

**public/index.html · troca 10 — TCTL: mute.** Substituir:

```html
    mute: { label: 'Silenciar trilha', title: 'mudo no preview — não altera o export', icons: ['i-spk', 'i-spk-off'] },
```

por:

```html
    mute: { label: 'Silenciar track', title: 'mudo — vale no export', icons: ['i-spk', 'i-spk-off'] },
```

**public/index.html · troca 11 — TCTL: solo.** Substituir:

```html
    solo: { label: 'Ativar solo da trilha', title: 'solo da TRILHA: silencia o áudio do vídeo no preview — não altera o export', icons: ['i-solo', 'i-solo'] },
```

por:

```html
    solo: { label: 'Solo da track', title: 'solo — só esta track soa, também no export', icons: ['i-solo', 'i-solo'] },
```

**public/index.html · troca 12 — buildDom: ÁUDIO com M S L.** Substituir:

```html
                ${tctlHtml('hide', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>
```

por:

```html
                ${tctlHtml('mute', 'ÁUDIO')}${tctlHtml('solo', 'ÁUDIO')}${tctlHtml('lock', 'ÁUDIO')}</div>
```

**public/index.html · troca 13 — buildDom: TRILHA sem H.** Substituir:

```html
                ${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('hide', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>
```

por:

```html
                ${tctlHtml('add', 'TRILHA')}${tctlHtml('mute', 'TRILHA')}${tctlHtml('solo', 'TRILHA')}${tctlHtml('lock', 'TRILHA')}</div>
```

**public/index.html · troca 14 — buildDom: SFX com M S.** Substituir:

```html
                ${tctlHtml('add', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
```

por:

```html
                ${tctlHtml('add', 'SFX')}${tctlHtml('mute', 'SFX')}${tctlHtml('solo', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
```

**public/index.html · troca 15 — applyTrackVisibility: .silent.** Substituir:

```html
      row.classList.toggle('locked', !!lockedTracks[track]);
```

por:

```html
      row.classList.toggle('locked', !!lockedTracks[track]);
      row.classList.toggle('silent', AUDIO_TRACKS.includes(track) && !audible(track));
```

**public/index.html · troca 16 — applyTrackVisibility: estado de M/S.** Substituir:

```html
        else if (act === 'mute') on = trilhaMuted;
        else if (act === 'solo') on = trilhaSolo;
```

por:

```html
        else if (act === 'mute') on = MIX.mute.includes(track);
        else if (act === 'solo') on = MIX.solo === track;
```

**public/index.html · troca 17 — wireTracks: clique em M/S.** Substituir:

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

**public/index.html · troca 18 — loadVideo: zera MIX.** Substituir:

```html
    hiddenTracks = {}; lockedTracks = {}; trilhaMuted = false; trilhaSolo = false;
```

por:

```html
    hiddenTracks = {}; lockedTracks = {}; MIX = { mute: [], solo: null };
```

**public/index.html · troca 19 — loadVideo: lê mix do sidecar.** Substituir:

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

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 4 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b3-static.js`; conferir que `audible()` em `public/index.html` e em `lib/timeline.js` são a mesma regra; que `MIX` entra em `timelineState()` e em `saveBeats()` mas não em `snapshot()`; que clicar S sempre deixa no máximo um solo; que `measuresMsg` segue as tabelas de pico real, LUFS, LRA e limitador da spec (B3), com o estilo de erro só no `tpWarn === 'over'`; e que o H continua em MARKERS, B-ROLL e LEGENDA com o title de sempre".

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

Esperar o fim do conform em chamadas separadas (`T.stage()`). Esperado: "timeline conformada — 38.2s · 0 B-ROLL · 0 TRILHA · 1 SFX · … palavras · fora do export: ÁUDIO (solo: SFX) · pico real −18,… dBTP" (o tom mono de −18 dBFS sozinho, abaixo do teto: o limitador não corta e o trecho do limitador não aparece), seguido do LUFS com "abaixo do alvo −14 a −16" (um efeito de 0,8 s num arquivo de 38 s) e do LRA. No reteste do plano (R3): "timeline conformada — 38.2s · 0 B-ROLL · 0 TRILHA · 1 SFX · 100 palavras · fora do export: ÁUDIO (solo: SFX) · pico real −18,0 dBTP · −19,4 LUFS: abaixo do alvo −14 a −16 · LRA 4,3 LU". Medir o arquivo:

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

Limitador na mensagem (R3): recarregar, `load`, auxiliares; dois `loud.wav` (−0,1 dBFS) empilhados na TRILHA sobre a voz:

```js
T.asset('loud.wav', 1); T.key('Home'); await T.sleep(200); await T.steps(150, 'ArrowRight');
await T.add('music', 'loud.wav'); await T.add('music', 'loud.wav');     // os dois em 5,0–6,0s
document.getElementById('bt-conform').click();
await T.sleep(40000);
T.stage()
```

Em outra chamada:

```js
for (let i = 0; i < 40 && !/timeline conformada|erro/i.test(T.stage()); i++) await T.sleep(1000);
({ stage: T.stage(), estilo: document.getElementById('stage').className })
```

Esperado: a mensagem traz "· limitador −… dB — mix alto: abaixe TRILHA/SFX" (a soma passa de +6 dBFS), o pico real fica entre −2 e −1 dBTP (o teto é −2; o AAC do conform soma alguns décimos) e `estilo: "run"`, não `"err"`. No reteste do plano: "timeline conformada — 38.2s · 0 B-ROLL · 2 TRILHA · 0 SFX · 100 palavras · pico real −1,9 dBTP · −14,9 LUFS · LRA 20,8 LU: dinâmica alta para celular (ideal ≤ 9) · limitador −8,4 dB — mix alto: abaixe TRILHA/SFX". Apagar o conformado e restaurar o sidecar da fixture.

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

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 trocado) + M em ÁUDIO, TRILHA e SFX cala a track e esmaece a lane (que continua editável); S deixa só aquela track soar e troca de track com um clique; mudo vence solo; CONFORMAR com um solo ligado mostra "fora do export: …" e o arquivo exportado soa como o preview; a mensagem mostra pico real, LUFS (com "abaixo do alvo" num projeto com a voz antiga) e LRA; com dois clipes altos sobrepostos (TRILHA + SFX), aparece "limitador −… dB — mix alto: abaixe TRILHA/SFX", o pico real fica entre −2 e −1 dBTP e a mensagem não fica vermelha; **ouvir o arquivo** contra o preview nesse trecho: no export os picos saem contidos pelo limitador.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b3`; arquivos `public/index.html`, `public/dev/ui-probe.js`; commit `Make mute and solo real mix controls, report loudness and limiter on conform (B3)`) → OK do usuário → `publish`.

---

---

### Task 5 (B4): Voz normalizada no ASSEMBLE

**Files:**
- Modify: `lib/assemble.js` — cabeçalho, bloco novo depois de `const MEZZANINE_CRF`, assinatura de `assemble()`, a montagem e o retorno, `module.exports`.
- Modify: `server.js` — `POST /api/assemble`.
- Modify: `public/index.html` — mensagem de fim do `doAssemble()`.

**Interfaces:**
- Consumes: `runFfmpeg(args, { onLog })` e `mediaInfo(file)` (`lib/ffmpeg.js`).
- Produces:
  - `assemble({ …, normalizeVoice = true })` devolve, além do de hoje, `voice: { normalized: boolean, lufsIn, lufsOut, mode: 'linear' | 'dynamic' | null, reason }`, com `reason` em `'desligada'`, `'sem faixa de voz'`, `'medição falhou'`, `'voz em silêncio'` ou `'loudnorm falhou na montagem'`;
  - `parseLoudnormJson(stderr) → object | null` (o último bloco JSON do loudnorm);
  - `VOICE_TARGET = 'I=-16:TP=-2:LRA=9'`;
  - `POST /api/assemble` aceita `normalizeVoice` (ligado quando ausente).

- [ ] **Step 1 [Executor]: Salvar as duas checagens e confirmar que falham**

Salvar como `jobs/checks/b4-unit.js`:

```js
// B4 — checagem de unidade e estática. Rodar da raiz do repo: node jobs/checks/b4-unit.js
'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const need = (s, where, list) => list.forEach(t => { if (!s.includes(t)) fail.push(where + ' — ausente: ' + t); });

// 1 — parse do JSON do loudnorm, com a saída real do ffmpeg 6.1 (linha do filtro, tabs, CRLF).
const block = (o) => '[Parsed_loudnorm_0 @ 00000242e693b9c0] \r\n{\r\n' +
  Object.entries(o).map(([k, v]) => `\t"${k}" : "${v}"`).join(',\r\n') + '\r\n}\r\n';
const PASS1 = { input_i: '-25.54', input_tp: '-8.33', input_lra: '3.10', input_thresh: '-35.76', output_i: '-16.16',
  output_tp: '-2.00', output_lra: '3.10', output_thresh: '-26.38', normalization_type: 'dynamic', target_offset: '0.16' };
const PASS2 = { ...PASS1, output_i: '-16.02' };
let A = null;
try { A = require(path.resolve('lib/assemble.js')); } catch (e) { fail.push('lib/assemble.js não carrega: ' + e.message); }
if (A && typeof A.parseLoudnormJson === 'function') {
  const P = A.parseLoudnormJson;
  const prog = 'size=N/A time=00:00:35.47 bitrate=N/A speed=32.7x    \r\n';
  const r1 = P(prog + block(PASS1));
  ok(r1 && r1.input_i === '-25.54' && r1.input_thresh === '-35.76' && r1.target_offset === '0.16', 'parse: 1ª passada ' + JSON.stringify(r1));
  const r2 = P(block(PASS1) + prog + block(PASS2));
  ok(r2 && r2.output_i === '-16.02', 'parse: com dois blocos, vale o último ' + JSON.stringify(r2));
  ok(P((prog + block(PASS1)).replace(/\r\n/g, '\n')).input_i === '-25.54', 'parse: saída em LF');
  ok(P(prog) === null && P('') === null && P(undefined) === null, 'parse: sem JSON deveria dar null');
  ok(P('[Parsed_loudnorm_0 @ 1] \r\n{\r\n\t"input_i" : "-25.54",\r\n\t"input_tp" : \r\n}\r\n') === null, 'parse: JSON quebrado deveria dar null');
  ok(A.VOICE_TARGET === 'I=-16:TP=-2:LRA=9', 'VOICE_TARGET = ' + A.VOICE_TARGET);
} else if (A) {
  fail.push('parseLoudnormJson não exportada');
}

// 2 — pontos de código.
const asm = read('lib/assemble.js');
need(asm, 'lib/assemble.js', [
  "const VOICE_TARGET = 'I=-16:TP=-2:LRA=9';", 'function parseLoudnormJson(stderr) {', 'async function measureVoice(src) {',
  "burnCaptions = false, normalizeVoice = true,", "const voiceSrc = voiceover || (vInfo.acodec ? visual : null);",
  "':linear=true:print_format=json'", 'if (audioFilter) args.push(\'-af\', audioFilter);',
  "voice.reason = 'loudnorm falhou na montagem';", 'await runFfmpeg(muxArgs(null), { onLog });', '    voice,\n  };',
  "module.exports = { assemble, parseLoudnormJson, VOICE_TARGET };",
  // a cadeia de vídeo não muda
  "const vf = [buildFit(fit, ':flags=lanczos'), 'fps=30'];",
  "'-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),",
]);
need(read('server.js'), 'server.js', ['normalizeVoice: b.normalizeVoice !== false,']);
const html = read('public/index.html');
need(html, 'index.html', ["const voiceChip = v.normalized", "' (com limitação de pico)'", 'voz sem normalizar — ${v.reason}',
  "(r.ass ? `<span class=\"chip ok\">.ass pronto — queima no Export</span>` : '') + voiceChip +"]);
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, k) => {
  try { new Function(m[1]); } catch (e) { fail.push('<script> inline #' + k + ' não compila: ' + e.message); }
});

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B4 unidade');
process.exitCode = fail.length ? 1 : 0;
```

Salvar como `jobs/checks/b4-e2e.js`:

```js
// B4 — ASSEMBLE real com a voz normalizada, direto e pela rota do servidor.
// Rodar da raiz do repo: node jobs/checks/b4-e2e.js
// Gera tudo em jobs/b4-check/ (gitignored) e apaga no fim se passar. Usa a voz da
// fixture output/assembled-4545f906507a.mp4 (condição de medição do plano).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'jobs', 'b4-check');
const FIXTURE = path.join(ROOT, 'output', 'assembled-4545f906507a.mp4');
const PORT = 4879;
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').split('\n').slice(-4).join(' | '));
  return r.stderr;
}
// LUFS integrado e true peak do primeiro áudio de `file` (null se não houver áudio).
function loud(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0?', '-af', 'ebur128=peak=true',
    '-f', 'null', '-'], { encoding: 'utf8' });
  const s = (r.stderr || '').slice((r.stderr || '').lastIndexOf('Summary:'));
  const i = /\bI:\s*(-?[\d.]+)\s*LUFS/.exec(s), tp = /True peak:\s*Peak:\s*(-?(?:inf|[\d.]+))/.exec(s);
  return i ? { i: parseFloat(i[1]), tp: tp && !/inf/.test(tp[1]) ? parseFloat(tp[1]) : null } : null;
}

async function main() {
  if (!fs.existsSync(FIXTURE)) throw new Error('fixture ausente: ' + rel(FIXTURE));
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const P = n => path.join(DIR, n);

  // Mídia: vídeo sem áudio; vídeo com áudio próprio baixo; "voz" sintética baixa e modulada;
  // narração em silêncio; 20 s da voz real da fixture.
  const VOZ = 'sine=f=300:d=6,tremolo=f=3:d=0.8,volume=-9dB';
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', P('visual.mp4')]);
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', P('visual20.mp4')]);
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=30:d=6', '-f', 'lavfi', '-i', VOZ,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '6', P('visual-a.mp4')]);
  ff(['-f', 'lavfi', '-i', VOZ, P('voz.wav')]);
  ff(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '6', P('silencio.wav')]);
  ff(['-i', FIXTURE, '-vn', '-t', '20', '-ac', '2', P('voz-fixture.wav')]);
  const inVoz = loud(P('voz.wav')), inFx = loud(P('voz-fixture.wav'));
  ok(inVoz && inVoz.i < -25, 'a voz sintética deveria estar bem abaixo do alvo, está em ' + (inVoz && inVoz.i));

  const { assemble } = require(path.join(ROOT, 'lib', 'assemble.js'));
  let n = 0;
  const run = opts => { n++; return assemble({ output: P('out' + n + '.mp4'), workDir: P('w' + n), captions: false, ...opts }); };
  const inTarget = (m, tag) => {
    ok(m && m.i >= -16.5 && m.i <= -15.5, tag + ': LUFS de saída ' + (m && m.i) + ', esperado -16 ± 0,5');
    ok(m && m.tp != null && m.tp <= -1.9, tag + ': true peak ' + (m && m.tp) + ', esperado ≤ -1,9');
  };

  // E1 — narração baixa: sai no alvo.
  let r = await run({ visual: P('visual.mp4'), voiceover: P('voz.wav') });
  inTarget(loud(r.output), 'E1');
  ok(r.voice && r.voice.normalized === true && ['linear', 'dynamic'].includes(r.voice.mode), 'E1: voice ' + JSON.stringify(r.voice));
  ok(r.voice && Math.abs(r.voice.lufsIn - inVoz.i) <= 0.5, 'E1: lufsIn ' + (r.voice && r.voice.lufsIn) + ' ≠ entrada ' + inVoz.i);
  ok(r.voice && r.voice.lufsOut >= -16.5 && r.voice.lufsOut <= -15.5, 'E1: lufsOut ' + (r.voice && r.voice.lufsOut));

  // E2 — normalizeVoice: false não mexe no nível.
  r = await run({ visual: P('visual.mp4'), voiceover: P('voz.wav'), normalizeVoice: false });
  const e2 = loud(r.output);
  ok(e2 && Math.abs(e2.i - inVoz.i) <= 0.5, 'E2: LUFS ' + (e2 && e2.i) + ' deveria ficar a ±0,5 de ' + inVoz.i);
  ok(r.voice && r.voice.normalized === false && r.voice.reason === 'desligada', 'E2: voice ' + JSON.stringify(r.voice));

  // E3 — narração em silêncio: monta, não normaliza, diz por quê.
  r = await run({ visual: P('visual.mp4'), voiceover: P('silencio.wav') });
  ok(fs.existsSync(r.output), 'E3: sem arquivo de saída');
  ok(r.voice && r.voice.normalized === false && r.voice.reason === 'voz em silêncio', 'E3: voice ' + JSON.stringify(r.voice));

  // E4 — sem narração, com áudio próprio: normaliza o áudio do vídeo.
  r = await run({ visual: P('visual-a.mp4') });
  inTarget(loud(r.output), 'E4');
  ok(r.voice && r.voice.normalized === true, 'E4: voice ' + JSON.stringify(r.voice));

  // E5 — sem narração e sem áudio: nada a normalizar.
  r = await run({ visual: P('visual.mp4') });
  ok(r.voice && r.voice.normalized === false && r.voice.reason === 'sem faixa de voz', 'E5: voice ' + JSON.stringify(r.voice));

  // E6 — a voz real da fixture (20 s).
  r = await run({ visual: P('visual20.mp4'), voiceover: P('voz-fixture.wav') });
  inTarget(loud(r.output), 'E6');
  ok(r.voice && r.voice.normalized === true && Math.abs(r.voice.lufsIn - inFx.i) <= 0.5, 'E6: voice ' + JSON.stringify(r.voice));

  // Rota do servidor numa porta de teste: normaliza por padrão; normalizeVoice: false desliga.
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
    const viaRota = async (extra) => {
      const c = await req('POST', '/api/assemble', { visual: rel(P('visual.mp4')), voiceover: rel(P('voz.wav')), captions: false, ...extra });
      if (c.status !== 200) throw new Error('POST /api/assemble: ' + c.status + ' ' + JSON.stringify(c.body));
      for (let i = 0; i < 600; i++) {
        const j = await req('GET', '/api/jobs/' + c.body.job);
        if (j.body.state === 'done') {
          fs.rmSync(path.join(ROOT, 'jobs', c.body.job), { recursive: true, force: true });
          fs.rmSync(path.join(ROOT, j.body.result.output), { force: true });
          return j.body.result;
        }
        if (j.body.state === 'error') throw new Error('job: ' + j.body.error);
        await new Promise(res => setTimeout(res, 200));
      }
      throw new Error('job não terminou');
    };
    const a = await viaRota({});
    ok(a.voice && a.voice.normalized === true, 'rota: deveria normalizar por padrão ' + JSON.stringify(a.voice));
    const b = await viaRota({ normalizeVoice: false });
    ok(b.voice && b.voice.normalized === false && b.voice.reason === 'desligada', 'rota: normalizeVoice false ' + JSON.stringify(b.voice));
  } catch (e) {
    fail.push('servidor: ' + e.message + (srvErr ? ' | stderr: ' + srvErr.slice(-300) : ''));
  } finally {
    srv.kill();
  }

  if (!fail.length) fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fail.length ? 'FAIL\n' + fail.join('\n') + '\n(arquivos mantidos em jobs/b4-check/)' : 'PASS: B4 ponta a ponta');
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.log('FAIL\n' + (e.stack || e)); process.exitCode = 1; });
```

Rodar `node jobs/checks/b4-unit.js`. Esperado: `FAIL` com `parseLoudnormJson não exportada`, onze linhas `lib/assemble.js — ausente:`, `server.js — ausente: normalizeVoice: b.normalizeVoice !== false,` e quatro linhas `index.html — ausente:`.

Rodar `node jobs/checks/b4-e2e.js` (≈ 30s). Esperado: `FAIL` com `E1: LUFS de saída -34.4, esperado -16 ± 0,5`, `E4: LUFS de saída -34.4…`, `E6: LUFS de saída -25.4…`, as linhas `voice undefined` de E1 a E6, as duas linhas `rota:` e `(arquivos mantidos em jobs/b4-check/)`. Apagar `jobs/b4-check/` depois (`rm -rf jobs/b4-check`).

- [ ] **Step 2 [Executor]: `lib/assemble.js` — 5 trocas, nesta ordem**

**lib/assemble.js · troca 1 — cabeçalho: voz normalizada.** Substituir:

```js
// behavior for callers that use this step in isolation.
'use strict';
```

por:

```js
// behavior for callers that use this step in isolation.
//
// The voice leaves this step at the Reel target level (-16 LUFS integrated,
// true peak -2 dBTP, the master limiter's ceiling in lib/timeline.js, so the
// voice alone never triggers it): the TIMELINE sets music and SFX relative to it, and the
// voice the pipeline produces comes out 6 to 11 LU below that. Two loudnorm
// passes — measure, then apply the measured values with linear=true (a fixed
// gain when it fits under the ceiling; loudnorm falls back to its dynamic mode
// on its own when it does not). Never fatal: without a usable measurement the
// file is assembled un-normalized and `voice.reason` says why.
'use strict';
```

**lib/assemble.js · troca 2 — alvo, parse e medição da voz antes de assemble().** Substituir:

```js
const MEZZANINE_CRF = 12;   // visualmente lossless; 444 preserva a croma das legendas
```

por:

```js
const MEZZANINE_CRF = 12;   // visualmente lossless; 444 preserva a croma das legendas
const VOICE_TARGET = 'I=-16:TP=-2:LRA=9';

// loudnorm prints its measurement as a JSON block on stderr, after a
// "[Parsed_loudnorm_0 @ …]" line. The last block wins (the apply pass prints one too).
function parseLoudnormJson(stderr) {
  const blocks = String(stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) return null;
  try { return JSON.parse(blocks[blocks.length - 1]); } catch (e) { return null; }
}
async function measureVoice(src) {
  let log = '';
  try {
    await runFfmpeg(['-nostats', '-i', src, '-map', '0:a:0',
      '-af', `loudnorm=${VOICE_TARGET}:print_format=json`, '-f', 'null', '-'],
      { onLog: s => { log += s; } });
  } catch (e) { return null; }
  return parseLoudnormJson(log);
}
```

**lib/assemble.js · troca 3 — assinatura: normalizeVoice.** Substituir:

```js
  language = null, fit = 'blur', burnCaptions = false,
  onLog = () => {}, onStage = () => {} }) {
```

por:

```js
  language = null, fit = 'blur', burnCaptions = false, normalizeVoice = true,
  onLog = () => {}, onStage = () => {} }) {
```

**lib/assemble.js · troca 4 — montagem com a voz normalizada e retorno com voice.** Substituir:

```js
  onStage('mux', 'Assembling MP4');
  const args = ['-i', visual];
  if (voiceover) args.push('-i', voiceover);
  args.push('-vf', vf.join(','));
  if (voiceover) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
    '-pix_fmt', 'yuv444p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', output);

  await runFfmpeg(args, { onLog });
  return {
    output, duration: vInfo.duration,
    captionedWords: words ? words.length : 0,
    ass: assPath ? path.relative(process.cwd(), assPath) : null,
    assDuration: words ? assDuration(words) : 0,
    burned: burnCaptions,
  };
```

por:

```js
  // The voice is the narration when there is one, else the visual's own audio.
  const voice = { normalized: false, lufsIn: null, lufsOut: null, mode: null, reason: null };
  const voiceSrc = voiceover || (vInfo.acodec ? visual : null);
  let af = null;
  if (!normalizeVoice) voice.reason = 'desligada';
  else if (!voiceSrc) voice.reason = 'sem faixa de voz';
  else {
    onStage('voice', 'Medindo o nível da voz');
    const m = await measureVoice(voiceSrc);
    const i = m ? parseFloat(m.input_i) : NaN;
    if (!m) voice.reason = 'medição falhou';
    else if (!Number.isFinite(i) || i <= -70) voice.reason = 'voz em silêncio';
    else {
      voice.lufsIn = Math.round(i * 10) / 10;
      af = `loudnorm=${VOICE_TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
        `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}` +
        ':linear=true:print_format=json';
    }
  }

  onStage('mux', 'Assembling MP4');
  // -ar 44100 below also undoes loudnorm's internal 192 kHz resampling.
  const muxArgs = (audioFilter) => {
    const args = ['-i', visual];
    if (voiceover) args.push('-i', voiceover);
    args.push('-vf', vf.join(','));
    if (audioFilter) args.push('-af', audioFilter);
    if (voiceover) {
      args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
      '-pix_fmt', 'yuv444p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', output);
    return args;
  };

  let muxLog = '';
  try {
    await runFfmpeg(muxArgs(af), { onLog: s => { if (af) muxLog += s; onLog(s); } });
  } catch (e) {
    if (!af) throw e;
    // the normalization must never cost the assemble: retry without it
    onLog(`[voice] loudnorm falhou na montagem — ${String(e.message || e).split('\n')[0]}; montando sem normalizar\n`);
    voice.reason = 'loudnorm falhou na montagem';
    af = null;
    await runFfmpeg(muxArgs(null), { onLog });
  }
  if (af) {
    const o = parseLoudnormJson(muxLog);
    const out = o ? parseFloat(o.output_i) : NaN;
    voice.normalized = true;
    voice.lufsOut = Number.isFinite(out) ? Math.round(out * 10) / 10 : null;
    voice.mode = (o && o.normalization_type) || null;
    onLog(`[voice] ${voice.lufsIn} → ${voice.lufsOut} LUFS (${voice.mode})\n`);
  } else {
    onLog(`[voice] sem normalização — ${voice.reason}\n`);
  }
  return {
    output, duration: vInfo.duration,
    captionedWords: words ? words.length : 0,
    ass: assPath ? path.relative(process.cwd(), assPath) : null,
    assDuration: words ? assDuration(words) : 0,
    burned: burnCaptions,
    voice,
  };
```

**lib/assemble.js · troca 5 — exports.** Substituir:

```js
module.exports = { assemble };
```

por:

```js
module.exports = { assemble, parseLoudnormJson, VOICE_TARGET };
```

- [ ] **Step 3 [Executor]: `server.js` — 1 troca**

**server.js · troca 1 — /api/assemble repassa normalizeVoice.** Substituir:

```js
          burnCaptions: b.burnCaptions === true,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
        });
        return { ...r, output: path.relative(ROOT, r.output),
```

por:

```js
          burnCaptions: b.burnCaptions === true,
          normalizeVoice: b.normalizeVoice !== false,
          onLog: s => jlog(job, s), onStage: (st, l) => jstage(job, st, l),
        });
        return { ...r, output: path.relative(ROOT, r.output),
```

- [ ] **Step 4 [Executor]: `public/index.html` — 1 troca**

**public/index.html · troca 1 — mensagem do ASSEMBLE: nível da voz.** Substituir:

```html
    $('#asm-out').innerHTML = `<span class="chip ok">${r.captionedWords} words captioned</span>` +
      (r.ass ? `<span class="chip ok">.ass pronto — queima no Export</span>` : '') +
```

por:

```html
    // a voz sai no nível-alvo (-16 LUFS); o chip mostra de onde veio, ou por que não
    const v = r.voice || {};
    const lu = x => (x == null ? '?' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(1).replace('.', ','));
    const voiceChip = v.normalized
      ? `<span class="chip ok">voz normalizada: ${lu(v.lufsIn)} → ${lu(v.lufsOut)} LUFS${v.mode === 'dynamic' ? ' (com limitação de pico)' : ''}</span>`
      : (v.reason ? `<span class="chip no">voz sem normalizar — ${v.reason}</span>` : '');
    $('#asm-out').innerHTML = `<span class="chip ok">${r.captionedWords} words captioned</span>` +
      (r.ass ? `<span class="chip ok">.ass pronto — queima no Export</span>` : '') + voiceChip +
```

- [ ] **Step 5 [Executor]: Checagens** — `node --check server.js`; `node jobs/checks/b4-unit.js` → `PASS: B4 unidade`; `node jobs/checks/b4-e2e.js` → `PASS: B4 ponta a ponta` (≈ 30s; apaga `jobs/b4-check/` quando passa). Nenhum servidor pode estar ocupando a porta 4879.

- [ ] **Step 6 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 5. Parar aqui.

- [ ] **Step 7 [Orquestrador]: `validator`** — "validar a Task 5 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b4-unit.js` e `node jobs/checks/b4-e2e.js`; conferir que o diff de `lib/assemble.js` contra `HEAD` só toca o áudio (o `vf`, os argumentos de vídeo, a transcrição e o `.ass` ficam iguais); que toda falha da normalização termina numa montagem sem normalizar, nunca num ASSEMBLE que falha; e que o alvo é o da spec (−16 LUFS, true peak −1,5, LRA 11)".

- [ ] **Step 8 [Orquestrador]: ASSEMBLE pela interface** — condições de medição, auxiliares colados (o `uiProbe.load` põe a fixture na lista de vídeos). Um ASSEMBLE sem legendas (sem Whisper), com o `bed.wav` da Task 0 como narração:

```js
addAsset({ path: 'jobs/b-check/bed.wav', name: 'bed.wav', kind: 'audio', info: { duration: 10 }, source: 'probe' });
const sv = document.getElementById('asm-visual'), vo = document.getElementById('asm-vo'), cap = document.getElementById('asm-cap');
sv.value = 'output/assembled-4545f906507a.mp4'; vo.value = 'jobs/b-check/bed.wav'; cap.value = '0';
const vals = { visual: sv.value, vo: vo.value, cap: cap.value };
doAssemble();
await T.sleep(40000);
({ vals, out: document.getElementById('asm-out').innerText.slice(0, 200), stage: T.stage() })
```

Esperado: `vals` com os três valores (se `visual` vier vazio, a fixture não está na lista: recarregar e fazer o `load`); `out` com "voz normalizada: −21,8 → −15,9 LUFS" (no reteste do plano, seguido de "(com limitação de pico)"). Medir o arquivo novo e apagá-lo, sem tocar na fixture:

```bash
F=$(ls -t output/assembled-*.mp4 | head -1)
[ "$F" != output/assembled-4545f906507a.mp4 ] && ffmpeg -hide_banner -nostats -i "$F" -map 0:a:0 -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" && rm "$F"
```

Esperado: `I:` entre −16,5 e −15,5 LUFS e o `Peak:` de true peak ≤ −1,9 dBFS.

- [ ] **Step 9 [Usuário]: Ouvir** — montar pelo ASSEMBLE um vídeo com uma narração real do VOICE e comparar com um vídeo montado antes desta task: a voz fica mais alta, sem distorção audível, e o chip mostra o nível de entrada e de saída. Um ASSEMBLE sem narração, com um vídeo que tem áudio próprio, também normaliza.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b4`; arquivos `lib/assemble.js`, `server.js`, `public/index.html`; commit `Normalize the voice to -16 LUFS at ASSEMBLE (B4)`) → OK do usuário → `publish`.

---

### Task 6 (B5): Medidor de pico do master

**Files:**
- Modify: `public/index.html` — `:root`, CSS logo depois de `.bt-scroll{…}`, bloco novo antes de `/* ---------------- legend (palavras reais`, `loadWaveform()`, `ensureMiniWave()`, `pruneMediaCache()`, `clearMediaCache()`, `snapshot()`, `renderTracks()`, listener `input` do slider de ganho, clique de M/S em `wireTracks()`, markup do `buildDom()` (linha e medidor) e `loadVideo()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `audibleNow()`, `SFX`, `dbOf`/`volumeOf` e o listener do slider (Task 3); `audible()`/`MIX` e o clique de M/S (Task 4); `VIDEO`, `segStart()`, `MUSIC`, `DURATION`, `playhead`, `engineReady()`, `isPaused()`, `waveError` (existentes).
- Produces: `#bt-meter` com `data-state` (`ok` | `pending` | `unavailable`), `data-peak`, `data-l`, `data-r` e `data-render-ms`; `#bt-meter-peak` com a classe `z-green` | `z-yellow` | `z-red`; `scheduleMaster()`; estágio `B5` do probe com o check `meter`.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b5-static.js`:

```js
// B5 — checagem estática. Rodar da raiz: node jobs/checks/b5-static.js
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

need(src, 'index.html', [
  '--meter-ok:#34d399;', '.bt-mixrow{display:flex; gap:6px; align-items:stretch}', '.bt-meter{flex:0 0 44px;',
  '.bt-meter canvas{flex:1 1 0; min-height:0; width:100%; display:block}',
  '<div class="bt-mixrow">\n      <div class="bt-scroll" id="bt-scroll">',
  '<div class="bt-meter" id="bt-meter" data-state="pending" role="img" aria-label="Medidor de pico do master"',
  '<canvas id="bt-meter-canvas"></canvas>', '<div class="bt-meter-peak" id="bt-meter-peak"',
  'title="pico do mix antes do limitador — acima de −2 o limitador do master corta no export; o CONFORMAR mede o mesmo"',
  'amarelo até −2, vermelho a partir de −2 (o limitador corta no export)">',
  'let plateBuf = null;', 'let plateAudio = true;', 'const audioBufCache = new Map();',
  'const METER_SR = 44100, METER_FPS = 60, METER_FLOOR = -60;', 'const METER_RELEASE = 20, METER_HOLD_MS = 1200;',
  'async function renderMaster() {', 'const ctx = new OAC(2, Math.max(1, Math.ceil(DURATION * METER_SR)), METER_SR);',
  'if (aud.audio && plateBuf) VIDEO.forEach((s, i) => {', 'src.start(segStart(i), s.srcIn, s.dur);',
  'g.gain.value = Math.max(0, Math.min(1, c.volume));', 'src.start(c.start, srcIn, dur);',
  'if (gen !== meterGen) return;', 'function meterTick(now) {', 'function drawMeter(cv) {',
  'plateBuf = audioBuf;', 'audioBufCache.set(path, decoded);', 'plateAudio = !!info.acodec;',
  'plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();',
  "if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }",
  '    built = true;\n    startMeter();',
]);
// recálculo com atraso: 1 definição + 6 chamadas (loadWaveform, ensureMiniWave, snapshot, renderTracks, slider, M/S)
if (count(src, 'scheduleMaster()') !== 7) fail.push('scheduleMaster() deveria aparecer 7×, achado ' + count(src, 'scheduleMaster()'));
if (count(src, 'AnalyserNode') || /createMediaElementSource/.test(src)) fail.push('o medidor não pode se ligar ao áudio que está tocando');

// Zonas e balística: funções puras extraídas do HTML.
{
  const grab = name => { const m = new RegExp('  function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}').exec(src); return m ? m[0] : null; };
  const code = ['ampDb', 'meterZone', 'fmtDb'].map(grab);
  if (code.some(c => !c)) fail.push('ampDb/meterZone/fmtDb não achadas numa linha só');
  else {
    const G = new Function(code.join('\n') + '\nreturn { ampDb, meterZone, fmtDb };')();
    [[-6.1, 'green'], [-6, 'yellow'], [-2.1, 'yellow'], [-2, 'red'], [-1, 'red'], [0.4, 'red'], [-60, 'green']]
      .forEach(([d, z]) => { if (G.meterZone(d) !== z) fail.push(`meterZone(${d}) = ${G.meterZone(d)}, esperado ${z}`); });
    if (G.ampDb(0) !== -Infinity || Math.abs(G.ampDb(0.5) + 6.0206) > 1e-3) fail.push('ampDb errado');
    [[-8.3, '−8,3'], [0, '0,0'], [1.8, '+1,8']].forEach(([d, t]) => { if (G.fmtDb(d) !== t) fail.push(`fmtDb(${d}) = ${G.fmtDb(d)}`); });
  }
}

need(probe, 'ui-probe.js', ["const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5'];", 'async function meter() {', "add('meter',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B5 estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b5-static.js`. Esperado: `FAIL` com as linhas `index.html — ausente:` (token, CSS, markup, estado, motor, ganchos), `scheduleMaster() deveria aparecer 7×, achado 0`, `ampDb/meterZone/fmtDb não achadas numa linha só` e as linhas `ui-probe.js — ausente:`.

- [ ] **Step 2 [Executor]: `public/index.html` — 18 trocas, nesta ordem**

As trocas 1, 8, 9, 10, 11 e 13 usam como âncora o texto deixado pelas Tasks 1 a 3 (o token `--sfx`, `ensureMiniWave` com a SFX, `pruneMediaCache` e `clearMediaCache` por ocorrência, `snapshot()` com `sfx`, o listener do slider em dB): as Tasks 1 a 5 precisam estar aplicadas.

**public/index.html · troca 1 — :root — token --meter-ok.** Substituir:

```html
  --sfx:#22d3ee; /* lane SFX da TIMELINE — B-ROLL usa --go, TRILHA usa --warn */
```

por:

```html
  --sfx:#22d3ee; /* lane SFX da TIMELINE — B-ROLL usa --go, TRILHA usa --warn */
  --meter-ok:#34d399; /* medidor de pico: zona verde; amarelo = --go, vermelho = --bad */
```

**public/index.html · troca 2 — CSS — linha timeline + medidor.** Substituir:

```html
.bt-scroll{overflow:auto; border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--bg2); position:relative}
```

por:

```html
.bt-scroll{overflow:auto; border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--bg2); position:relative}
/* Timeline e medidor de pico lado a lado. O medidor estica à altura das tracks e
   não empurra a linha: o canvas tem base 0 e só cresce no espaço que sobra. */
.bt-mixrow{display:flex; gap:6px; align-items:stretch}
.bt-mixrow > .bt-scroll{flex:1 1 auto; min-width:0}
.bt-meter{flex:0 0 44px; display:flex; flex-direction:column; min-height:0;
  border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg2); overflow:hidden}
.bt-meter canvas{flex:1 1 0; min-height:0; width:100%; display:block}
.bt-meter-peak{flex:0 0 auto; padding:3px 0; border-top:1px solid var(--line); text-align:center;
  font:600 var(--fs-micro) var(--mono); color:var(--faint)}
.bt-meter-peak.z-green{color:var(--meter-ok)}
.bt-meter-peak.z-yellow{color:var(--go)}
.bt-meter-peak.z-red{color:var(--bad)}
```

**public/index.html · troca 3 — bloco do medidor antes da seção de legenda.** Substituir:

```html
  /* ---------------- legend (palavras reais, resolvidas no servidor a
```

por:

```html
  /* ---------------- medidor de pico do master (B5) ----------------
     O master é renderizado OFFLINE com as regras do conform: um trecho do vídeo
     base por segmento da VÍDEO, cada clipe de TRILHA/SFX com o próprio ganho, só
     as tracks que soam (audibleNow), mono duplicado nos dois canais (o up-mix
     padrão do Web Audio) e soma direta. Nada se liga ao áudio que está tocando:
     na rota Player ele mora no AudioContext interno do Remotion, e na rota canvas
     não passa por Web Audio. Do mix sai um envelope de pico por 1/60 s que serve
     play e scrub nas duas rotas — e antecipa o pico que o CONFORMAR mede antes do
     limitador do master. O limitador fica de fora de propósito: o preview também
     toca sem ele, e o vermelho mostra onde o export vai soar diferente. */
  let plateBuf = null;               // AudioBuffer do vídeo base, guardado por loadWaveform
  let plateAudio = true;             // o vídeo base tem faixa de áudio? (do probe, em loadVideo)
  const audioBufCache = new Map();   // path -> AudioBuffer | null, guardado por ensureMiniWave
  const METER_SR = 44100, METER_FPS = 60, METER_FLOOR = -60;
  const METER_RELEASE = 20, METER_HOLD_MS = 1200;   // dB/s e ms (documento de referência)
  let meterEnv = null;               // { l, r: Float32Array de amplitude, peakDb }
  let meterGen = 0, meterTimer = null, lastMixSig = '', meterRaf = null, meterColors = null;
  const meterDisp = { l: METER_FLOOR, r: METER_FLOOR, hl: METER_FLOOR, hr: METER_FLOOR, htl: 0, htr: 0, last: 0, drawn: '' };
  function ampDb(a) { return a > 0 ? 20 * Math.log10(a) : -Infinity; }
  // Zonas amarradas ao limitador do master: a partir de -2 dBFS (o teto, MASTER_CEIL_DB de
  // lib/timeline.js) ele corta no export; a voz normalizada (pico -2) fica no limite do amarelo.
  function meterZone(db) { return db >= -2 ? 'red' : db >= -6 ? 'yellow' : 'green'; }
  function fmtDb(db) { return (db < 0 ? '−' : db > 0 ? '+' : '') + Math.abs(db).toFixed(1).replace('.', ','); }
  function setMeterData(k, v) { const m = $q('#bt-meter'); if (m) m.dataset[k] = v; }
  function scheduleMaster() { clearTimeout(meterTimer); meterTimer = setTimeout(renderMaster, 200); }
  // O que muda o master: cortes, clipes, ganhos, quem soa e quais buffers já chegaram.
  function mixSignature(aud) {
    const clip = c => [c.path, c.start, c.dur, c.srcIn || 0, c.volume, audioBufCache.get(c.path) instanceof AudioBuffer];
    return JSON.stringify([DURATION, !!plateBuf, aud, VIDEO, MUSIC.map(clip), SFX.map(clip)]);
  }
  async function renderMaster() {
    if (!built) return;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    // o vídeo base TEM áudio e ele não decodificou: medir sem ele mentiria sobre a voz
    if (!OAC || (waveError && plateAudio)) {
      meterEnv = null; lastMixSig = '';
      setMeterData('state', 'unavailable');
      const m = $q('#bt-meter');
      if (m) m.title = 'medidor indisponível: o áudio do vídeo não decodificou neste navegador';
      updateMeterPeak();
      return;
    }
    if ((plateAudio && !plateBuf) || !(DURATION > 0)) { setMeterData('state', 'pending'); return; }
    const aud = audibleNow();
    const sig = mixSignature(aud);
    if (sig === lastMixSig) return;
    const gen = ++meterGen;
    const t0 = performance.now();
    const ctx = new OAC(2, Math.max(1, Math.ceil(DURATION * METER_SR)), METER_SR);
    let missing = false;
    if (aud.audio && plateBuf) VIDEO.forEach((s, i) => {
      const src = ctx.createBufferSource();
      src.buffer = plateBuf; src.connect(ctx.destination);
      src.start(segStart(i), s.srcIn, s.dur);
    });
    [['music', MUSIC], ['sfx', SFX]].forEach(([track, arr]) => {
      if (!aud[track]) return;
      arr.forEach(c => {
        const buf = audioBufCache.get(c.path);
        if (!(buf instanceof AudioBuffer)) { if (buf !== null) missing = true; return; }  // null = não decodifica
        const srcIn = c.srcIn || 0;
        const dur = Math.min(c.dur, buf.duration - srcIn, DURATION - c.start);
        if (!(dur > 0)) return;
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, c.volume));
        g.connect(ctx.destination);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(g);
        src.start(c.start, srcIn, dur);
      });
    });
    let out;
    try { out = await ctx.startRendering(); }
    catch (e) { if (gen === meterGen) { meterEnv = null; setMeterData('state', 'unavailable'); updateMeterPeak(); } return; }
    if (gen !== meterGen) return;    // um render mais novo começou enquanto este rodava
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const hop = METER_SR / METER_FPS, n = Math.ceil(L.length / hop);
    const l = new Float32Array(n), r = new Float32Array(n);
    let max = 0;
    for (let f = 0; f < n; f++) {
      let a = 0, b = 0;
      for (let i = Math.floor(f * hop), e = Math.min(L.length, Math.floor((f + 1) * hop)); i < e; i++) {
        const x = L[i] < 0 ? -L[i] : L[i]; if (x > a) a = x;
        const y = R[i] < 0 ? -R[i] : R[i]; if (y > b) b = y;
      }
      l[f] = a; r[f] = b;
      if (a > max) max = a;
      if (b > max) max = b;
    }
    meterEnv = { l, r, peakDb: max > 0 ? Math.round(ampDb(max) * 10) / 10 : null };
    lastMixSig = sig;                // um buffer que chegar depois muda a assinatura e força outro render
    setMeterData('renderMs', String(Math.round(performance.now() - t0)));
    setMeterData('state', missing ? 'pending' : 'ok');
    updateMeterPeak();
    meterDisp.drawn = '';
  }
  function updateMeterPeak() {
    const pk = meterEnv ? meterEnv.peakDb : null;
    setMeterData('peak', pk == null ? '' : pk.toFixed(1));
    const el = $q('#bt-meter-peak');
    if (!el) return;
    el.textContent = pk == null ? '—' : fmtDb(pk);
    el.className = 'bt-meter-peak' + (pk == null ? '' : ' z-' + meterZone(pk));
  }
  function startMeter() { if (!meterRaf) meterRaf = requestAnimationFrame(meterTick); }
  function envDb(env, t) {
    if (!env || !env.length) return METER_FLOOR;
    const i = Math.min(env.length - 1, Math.max(0, Math.floor(t * METER_FPS)));
    return Math.max(METER_FLOOR, ampDb(env[i]));
  }
  function meterTick(now) {
    meterRaf = null;
    const m = $q('#bt-meter'), cv = $q('#bt-meter-canvas');
    if (!built || !m || !cv) return;           // desmontado: o próximo startMeter() religa
    meterRaf = requestAnimationFrame(meterTick);
    const step = $('#step-beats');
    if (!step || !step.classList.contains('on')) { meterDisp.last = 0; return; }
    const dt = meterDisp.last ? Math.min(0.1, (now - meterDisp.last) / 1000) : 0;
    meterDisp.last = now;
    const playing = engineReady() && !isPaused();
    ['l', 'r'].forEach(ch => {
      const target = meterEnv ? envDb(meterEnv[ch], playhead) : METER_FLOOR;
      const cur = meterDisp[ch];
      // Ataque instantâneo; queda de no máximo METER_RELEASE dB/s, nunca abaixo do
      // envelope. Parado ou no scrub, o valor do frame direto.
      const lv = !playing || target >= cur ? target : Math.max(target, cur - METER_RELEASE * dt);
      meterDisp[ch] = lv;
      const hk = 'h' + ch, tk = 'ht' + ch;
      if (lv >= meterDisp[hk]) { meterDisp[hk] = lv; meterDisp[tk] = now; }
      else if (now - meterDisp[tk] > METER_HOLD_MS) meterDisp[hk] = Math.max(lv, meterDisp[hk] - METER_RELEASE * dt);
    });
    const key = [meterDisp.l, meterDisp.r, meterDisp.hl, meterDisp.hr].map(v => v.toFixed(1)).join('|') + '|' + cv.clientHeight;
    if (key === meterDisp.drawn) return;
    meterDisp.drawn = key;
    m.dataset.l = meterDisp.l.toFixed(1);
    m.dataset.r = meterDisp.r.toFixed(1);
    drawMeter(cv);
  }
  function drawMeter(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    if (!meterColors) {   // canvas não lê custom properties: resolve uma vez
      const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
      meterColors = { green: v('--meter-ok'), yellow: v('--go'), red: v('--bad'), text: v('--faint'), track: v('--panel2'), font: v('--mono') };
    }
    const C = meterColors, ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const top = 7, span = h - 14;
    const y = db => top + span * (Math.min(0, Math.max(METER_FLOOR, db)) / METER_FLOOR);   // 0 dB no topo
    ctx.font = '11px ' + C.font; ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, -6, -12, -18, -30, -60].forEach(d => ctx.fillText(String(-d), 19, y(d)));
    [['l', 22], ['r', 32]].forEach(([ch, x]) => {
      ctx.fillStyle = C.track; ctx.fillRect(x, top, 8, span);
      const lv = meterDisp[ch];
      const seg = (from, to, color) => {   // pinta a faixa [from, to] dB até onde o nível chega
        const hi = Math.min(lv, to);
        if (hi <= from) return;
        ctx.fillStyle = color; ctx.fillRect(x, y(hi), 8, y(from) - y(hi));
      };
      seg(METER_FLOOR, -6, C.green); seg(-6, -1, C.yellow); seg(-1, 0, C.red);
      const hd = meterDisp['h' + ch];
      if (hd > METER_FLOOR) { ctx.fillStyle = C[meterZone(hd)]; ctx.fillRect(x, y(hd) - 1, 8, 2); }
    });
  }

  /* ---------------- legend (palavras reais, resolvidas no servidor a
```

**public/index.html · troca 4 — loadWaveform: zera o buffer do vídeo base.** Substituir:

```html
    peaks = null;
    waveError = false;
    try {
```

por:

```html
    peaks = null;
    plateBuf = null;
    waveError = false;
    try {
```

**public/index.html · troca 5 — loadWaveform: guarda o buffer.** Substituir:

```html
      const audioBuf = await ctx.decodeAudioData(buf.slice(0));
```

por:

```html
      const audioBuf = await ctx.decodeAudioData(buf.slice(0));
      plateBuf = audioBuf;   // o medidor (B5) mixa a partir dele
```

**public/index.html · troca 6 — loadWaveform: recalcula o master.** Substituir:

```html
      waveError = true;
    }
    drawWaveform();
  }
```

por:

```html
      waveError = true;
    }
    drawWaveform();
    scheduleMaster();
  }
```

**public/index.html · troca 7 — ensureMiniWave: guarda o buffer.** Substituir:

```html
      const data = (await ctx.decodeAudioData(buf.slice(0))).getChannelData(0);
```

por:

```html
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      audioBufCache.set(path, decoded);   // o medidor (B5) mixa a partir dele
      const data = decoded.getChannelData(0);
```

**public/index.html · troca 8 — ensureMiniWave: falha e recálculo.** Substituir:

```html
    } catch (e) { miniWaveCache.set(path, null); }
    renderMusicTrack();
    renderSfxTrack();
  }
```

por:

```html
    } catch (e) { miniWaveCache.set(path, null); if (!audioBufCache.has(path)) audioBufCache.set(path, null); }
    renderMusicTrack();
    renderSfxTrack();
    scheduleMaster();
  }
```

**public/index.html · troca 9 — pruneMediaCache: buffers do medidor saem com o arquivo.** Substituir:

```html
      if (!entry.video && !(entry.audios && entry.audios.length)) mediaCache.delete(path);
    }
  }
```

por:

```html
      if (!entry.video && !(entry.audios && entry.audios.length)) mediaCache.delete(path);
    }
    // buffers decodificados do medidor (B5): saem junto com o último clipe do arquivo, e a
    // minionda também, para um arquivo que volte ser decodificado de novo
    for (const path of [...audioBufCache.keys()])
      if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }
  }
```

**public/index.html · troca 10 — clearMediaCache: zera o medidor na troca de vídeo.** Substituir:

```html
      if (entry.audios) entry.audios.forEach(a => { if (a) { a.pause(); a.remove(); } });
    }
    mediaCache.clear();
  }
```

por:

```html
      if (entry.audios) entry.audios.forEach(a => { if (a) { a.pause(); a.remove(); } });
    }
    mediaCache.clear();
    // medidor (B5): nada do vídeo anterior entra no master do próximo
    plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();
    meterEnv = null; lastMixSig = ''; meterGen++;
  }
```

**public/index.html · troca 11 — snapshot: toda edição confirmada recalcula o master.** Substituir:

```html
    hist.push(JSON.parse(JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO })));
    histPos = hist.length - 1;
  }
```

por:

```html
    hist.push(JSON.parse(JSON.stringify({ beats: BEATS, broll: BROLL, music: MUSIC, sfx: SFX, video: VIDEO })));
    histPos = hist.length - 1;
    scheduleMaster();   // arraste, trim, split, colar… toda edição confirmada passa por aqui
  }
```

**public/index.html · troca 12 — renderTracks: recalcula o master.** Substituir:

```html
    syncPlayer();
    justAdded = null; justSplit = null;
  }
```

por:

```html
    syncPlayer();
    scheduleMaster();
    justAdded = null; justSplit = null;
  }
```

**public/index.html · troca 13 — slider de ganho: recalcula o master.** Substituir:

```html
          inp.setAttribute('aria-valuetext', inp.title);
          syncPlayer();
        });
```

por:

```html
          inp.setAttribute('aria-valuetext', inp.title);
          syncPlayer();
          scheduleMaster();
        });
```

**public/index.html · troca 14 — M/S: recalcula o master.** Substituir:

```html
          // ser avisado aqui — senão hide/mute/solo só mudariam a UI
          syncPlayer();
        };
```

por:

```html
          // ser avisado aqui — senão hide/mute/solo só mudariam a UI
          syncPlayer();
          scheduleMaster();
        };
```

**public/index.html · troca 15 — buildDom: linha com o medidor.** Substituir:

```html
      <div class="bt-scroll" id="bt-scroll">
```

por:

```html
      <div class="bt-mixrow">
      <div class="bt-scroll" id="bt-scroll">
```

**public/index.html · troca 16 — buildDom: o medidor à direita das tracks.** Substituir:

```html
          <div class="bt-inout" id="bt-inout" style="display:none"></div>
        </div>
      </div>`;
```

por:

```html
          <div class="bt-inout" id="bt-inout" style="display:none"></div>
        </div>
      </div>
      <div class="bt-meter" id="bt-meter" data-state="pending" role="img" aria-label="Medidor de pico do master"
        title="pico do master (L/R), antes do limitador: verde abaixo de −6 dBFS, amarelo até −2, vermelho a partir de −2 (o limitador corta no export)">
        <canvas id="bt-meter-canvas"></canvas>
        <div class="bt-meter-peak" id="bt-meter-peak" title="pico do mix antes do limitador — acima de −2 o limitador do master corta no export; o CONFORMAR mede o mesmo">—</div>
      </div>
      </div>`;
```

**public/index.html · troca 17 — loadVideo: vídeo base com ou sem áudio.** Substituir:

```html
    MEDIA_DUR = info.duration || 0;
```

por:

```html
    MEDIA_DUR = info.duration || 0;
    plateAudio = !!info.acodec;   // sem faixa de áudio, o medidor mede só TRILHA/SFX
```

**public/index.html · troca 18 — loadVideo: liga o laço do medidor.** Substituir:

```html
    buildDom();
    built = true;
```

por:

```html
    buildDom();
    built = true;
    startMeter();
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 5 trocas**

**public/dev/ui-probe.js · troca 1 — cabeçalho.** Substituir:

```js
   Sub-projeto B (B2–B3): docs/plans/mixagem-audio.md
```

por:

```js
   Sub-projeto B (B2, B3, B5): docs/plans/mixagem-audio.md
```

**public/dev/ui-probe.js · troca 2 — ORDER com B5.** Substituir:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3'];
```

por:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5']; // o B4 não mexe na TIMELINE
```

**public/dev/ui-probe.js · troca 3 — meter().** Substituir:

```js
  async function transportIds() {
```

por:

```js
  // Espera o primeiro render do master (até 10 s) e mede o lugar do medidor.
  async function meter() {
    const m = $('#bt-meter'), s = $('.bt-scroll');
    if (!m || !s) return { present: false };
    for (let i = 0; i < 100 && m.dataset.state === 'pending'; i++) await sleep(100);
    const rm = m.getBoundingClientRect(), rs = s.getBoundingClientRect();
    return { present: true, rightOfTracks: rm.left >= rs.right - 1, heightDelta: round(Math.abs(rm.height - rs.height), 1),
      state: m.dataset.state, peak: m.dataset.peak, token: cssVar('--meter-ok') };
  }
  async function transportIds() {
```

**public/dev/ui-probe.js · troca 4 — check meter.** Substituir:

```js
      if (at('B3')) {
        const acts = trackActs();
```

por:

```js
      if (at('B5')) {
        const mt = await meter();
        add('meter', mt.present && mt.rightOfTracks && mt.heightDelta <= 2 && mt.state === 'ok' && mt.token === '#34d399' &&
          /^-?\d+\.\d$/.test(mt.peak || ''), mt, { rightOfTracks: true, heightDelta: '≤ 2', state: 'ok', token: '#34d399', peak: 'dBFS, uma casa' });
      }
      if (at('B3')) {
        const acts = trackActs();
```

**public/dev/ui-probe.js · troca 5 — console.info.** Substituir:

```js
await uiProbe.run("E0"…"E3b" | "B2" | "B3")');
```

por:

```js
await uiProbe.run("E0"…"E3b" | "B2" | "B3" | "B5")');
```

- [ ] **Step 4 [Executor]: Checagem** — `node jobs/checks/b5-static.js` → `PASS: B5 estático`.

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 6 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b5-static.js`; conferir que nada do medidor se liga ao áudio que está tocando (sem `AnalyserNode` nem `createMediaElementSource`); que o master usa as regras do conform (um trecho do vídeo base por segmento da VÍDEO, ganho por clipe, `audibleNow()`, soma direta); que um render atrasado nunca sobrescreve um mais novo; que o laço de `requestAnimationFrame` para quando a TIMELINE é desmontada; e que a única mudança de layout é o wrapper `.bt-mixrow` com o medidor".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado (v3).

```js
const r = await uiProbe.run('B5');
const m = document.getElementById('bt-meter');
({ ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id), data: { ...m.dataset } })
```

Esperado: `ok: true`, `falhas: []`, `data.state: "ok"`, `data.peak` a ±0,5 do pico de amostra da fixture (no reteste do plano, −8,4 contra −8,3) e `data.renderMs` abaixo de 1000 (no reteste, 52). O pico da fixture:

```bash
ffmpeg -hide_banner -nostats -i output/assembled-4545f906507a.mp4 -map 0:a:0 -af ebur128=peak=sample -f null - 2>&1 | grep -A1 "Sample peak" | tail -1
```

Scrub e slider, com a ÁUDIO muda e um whoosh isolado em 2,0–2,8s:

```js
const m = document.getElementById('bt-meter');
const waitRender = async (prev) => { for (let i = 0; i < 40; i++) { await T.sleep(100); if (m.dataset.peak !== prev && m.dataset.state === 'ok') return; } };
T.asset('whoosh.wav', 0.8);
T.btn('audio', 'mute').click();
let prev = m.dataset.peak; await waitRender(prev);
const soSilencio = m.dataset.peak;
T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight');
await T.add('sfx', 'whoosh.wav');                              // 2,0–2,8s
prev = m.dataset.peak; await waitRender(prev);
const pkWhoosh = m.dataset.peak;
T.key('Home'); await T.sleep(200); await T.steps(72, 'ArrowRight'); await T.sleep(300);   // 2,4s: dentro do efeito
const dentro = { l: m.dataset.l, r: m.dataset.r };
T.key('Home'); await T.sleep(200); await T.steps(30, 'ArrowRight'); await T.sleep(300);   // 1,0s: fora
const fora = { l: m.dataset.l, r: m.dataset.r };
// slider do efeito a -10 dB: o pico do mix acompanha
const inp = document.querySelector('#bt-track-sfx .bt-clip-vol');
inp.value = '-10'; inp.dispatchEvent(new Event('input'));
prev = m.dataset.peak; await waitRender(prev);
({ soSilencio, pkWhoosh, dentro, fora, pkMenos10: m.dataset.peak, sliderTitle: inp.title, renderMs: m.dataset.renderMs })
```

Esperado (reteste do plano): `soSilencio: ""` (só a voz, e ela está muda), `pkWhoosh: "-18.1"`, `dentro: { l: "-18.1", r: "-18.1" }`, `fora: { l: "-60.0", r: "-60.0" }`, `pkMenos10: "-28.1"`, `sliderTitle: "−10,0 dB"`.

Balística tocando de verdade (continua da cena acima):

```js
const m = document.getElementById('bt-meter');
const inp = document.querySelector('#bt-track-sfx .bt-clip-vol');
inp.value = '0'; inp.dispatchEvent(new Event('input')); await T.sleep(600);
T.key('Home'); await T.sleep(200); await T.steps(54, 'ArrowRight');     // 1,8s
T._raw = [];
T.record(() => { T._raw.push([performance.now(), parseFloat(m.dataset.l)]); return 'L=' + m.dataset.l; });
({ peak: m.dataset.peak, t: document.getElementById('bt-time').firstChild.textContent })
```

Pressionar **Espaço** (ferramenta de teclado). Depois:

```js
await T.sleep(3500); T.pause(); const out = T.stop();
// queda máxima por segundo entre amostras consecutivas
let worst = 0;
for (let i = 1; i < T._raw.length; i++) {
  const [t0, a] = T._raw[i - 1], [t1, b] = T._raw[i];
  const rate = (a - b) / ((t1 - t0) / 1000);
  if (b < a && rate > worst) worst = rate;
}
({ transicoes: out.slice(0, 40), piorQueda_dB_s: +worst.toFixed(1) })
```

Esperado: `L=-60.0` antes do efeito, salto direto para `L=-18.1` quando ele entra (ataque instantâneo) e, depois que ele acaba, uma descida de ~2 dB a cada 100 ms até `L=-60.0`; `piorQueda_dB_s` até 25 (20 dB/s mais a folga de amostragem; no reteste, 21,1).

O medidor prevê o conform (religa a ÁUDIO: voz e efeito juntos):

```js
const m = document.getElementById('bt-meter');
T.btn('audio', 'mute').click();
for (let i = 0; i < 40; i++) { await T.sleep(100); if (m.dataset.peak !== '-18.1') break; }
window.__meterPeak = m.dataset.peak;
T.spyConform();                                   // guarda o id do job: o mixPeakDb não aparece na mensagem
document.getElementById('bt-conform').click();
await T.sleep(40000);
({ medidor: window.__meterPeak, stage: T.stage() })
```

Em outra chamada, até a mensagem final:

```js
for (let i = 0; i < 40 && !/timeline conformada|erro/i.test(T.stage()); i++) await T.sleep(1000);
const res = await T.conformResult();
({ medidor: window.__meterPeak, mixPeakDb: res.mixPeakDb, limiter: res.limiter, stage: T.stage() })
```

Esperado: `medidor` e `mixPeakDb` (o pico do mix antes do limitador, medido pelo conform) a menos de 0,5 dB. Na R2 a comparação era com o pico da mensagem; na R3 a mensagem mostra o pico real depois do limitador, que é outra coisa. No reteste do plano (R3), em dois cenários: −1,6 contra −1,6 (voz + um efeito a −3 dBFS, `cutDb` 0,4) e 6,3 contra 6,4 (voz + dois tons empilhados, `cutDb` 8,4). Apagar o conformado e restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares.

```js
const r = await uiProbe.run('B5');
const m = document.getElementById('bt-meter');
const pkInicial = m.dataset.peak;
T.asset('whoosh.wav', 0.8); T.btn('audio', 'mute').click();
T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight'); await T.add('sfx', 'whoosh.wav');
for (let i = 0; i < 40 && m.dataset.peak !== '-18.1'; i++) await T.sleep(100);
T.key('Home'); await T.sleep(200); await T.steps(72, 'ArrowRight'); await T.sleep(300);
({ rota: window.__playerBundleFailed ? 'canvas' : 'player', ok: r.ok, falhas: r.results.filter(x => x.status !== 'PASS').map(x => x.id), pkInicial, pkWhoosh: m.dataset.peak, scrubDentro: m.dataset.l })
```

Esperado: `rota: "canvas"`, `ok: true`, `falhas: []` e os mesmos números da rota Player (`pkInicial` a ±0,5 do pico da fixture, `pkWhoosh: "-18.1"`, `scrubDentro: "-18.1"`): o medidor não depende da rota. Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 da Task 4) + o medidor anda com o som tocando e acompanha o scrub; mexer num slider de ganho muda o pico embaixo do medidor; M e S mudam o medidor; o número fica vermelho a partir de −2 (onde o limitador do master vai cortar no export); a timeline e a rolagem continuam como antes, só mais estreitas.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b5`; arquivos `public/index.html`, `public/dev/ui-probe.js`; commit `Add a master peak meter to the TIMELINE (B5)`) → OK do usuário → `publish`.

---

### Task 7 (B6): Aviso de SFX acima de −10 dB

**Files:**
- Modify: `public/index.html` — CSS logo depois de `.bt-clip.sfx{…}`, bloco novo depois de `setMeterData()`, listener `input` do slider de ganho e fim do `renderClipTrack()`, `stage()` do `doConform()`.
- Modify: `public/dev/ui-probe.js`.

**Interfaces:**
- Consumes: `audioBufCache`, `ampDb()` e `fmtDb()` (Task 6); `audible(track)` e `measuresMsg(r)` (Task 4); `SFX`, `clipsFor()`, `volumeOf()` e o listener do slider (Task 3).
- Produces: `SFX_PEAK_MAX = -10`; `regionPeak(buf, srcIn, dur) → amplitude` (pura); `clipPeakDb(c) → dBFS com uma casa | null`; `markSfxPeak(el, c)`; `sfxHotMsg() → string`; nos clipes de SFX, `data-peak` (pico conhecido), a classe `over` e o `title` (acima de −10); estágio `B6` do probe com o check `sfx-peak`.

- [ ] **Step 1 [Executor]: Salvar a checagem estática e confirmar que falha**

Salvar como `jobs/checks/b6-static.js`:

```js
// B6 — checagem estática. Rodar da raiz: node jobs/checks/b6-static.js
'use strict';
const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('public/index.html');
const probe = read('public/dev/ui-probe.js');
const lines = src.split('\n');
const fail = [];
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

need(src, 'index.html', [
  '.bt-clip.sfx.over{box-shadow:inset 0 0 0 1px var(--go)}', ".bt-clip.sfx.over .nm::before{content:'▲ '; color:var(--go)}",
  'const SFX_PEAK_MAX = -10;', 'const regionPeakCache = new WeakMap();', '  function regionPeak(buf, srcIn, dur) {',
  '  function clipPeakDb(c) {', '  function markSfxPeak(el, c) {', '  function sfxHotMsg() {',
  "    if (!audible('sfx')) return '';", '` · ${n} SFX acima de −10 dB`', 'mantenha só se for um elemento dramático',
  "if (track === 'sfx') markSfxPeak(inp.closest('.bt-clip'), clipsFor(track)[+inp.dataset.idx]);",
  "if (track === 'sfx') host.querySelectorAll('.bt-clip').forEach(el => markSfxPeak(el, arr[+el.dataset.idx]));",
  '${measuresMsg(r)}${sfxHotMsg()}${skipped}',
  // o B5 fica como está: o cache do B6 é um WeakMap por buffer, então as limpezas não mudam
  'plateBuf = null; audioBufCache.clear(); miniWaveCache.clear();',
  "if (![...MUSIC, ...SFX].some(c => c.path === path)) { audioBufCache.delete(path); miniWaveCache.delete(path); }",
]);
// o aviso só lê: nada de processar ou escutar o áudio
if (/createMediaElementSource|AnalyserNode|DynamicsCompressor/.test(src)) fail.push('o aviso de SFX não pode processar nem escutar o áudio');

// regionPeak: a função pura, extraída do HTML, contra buffers falsos (10 amostras por segundo).
{
  const m = /  function regionPeak\(buf, srcIn, dur\) \{\n[\s\S]*?\n  \}\n/.exec(src);
  if (!m) fail.push('regionPeak não achada');
  else {
    const regionPeak = new Function(m[0] + '\nreturn regionPeak;')();
    const fake = (sr, chans) => ({ sampleRate: sr, length: chans[0].length, numberOfChannels: chans.length,
      getChannelData: k => Float32Array.from(chans[k]) });
    const L = [0, 0.1, -0.7, 0.2, 0, 0, 0.05, -0.1, 0, 0], R = [0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0];
    const b = fake(10, [L, R]);
    [[0, 1, 0.7, 'arquivo inteiro, pico negativo'], [0.3, 0.7, 0.3, 'trecho sem o pico da esquerda: vale o da direita'],
      [0.6, 0.4, 0.1, 'fim do arquivo'], [0.8, 5, 0, 'além do fim, limitado ao buffer'], [0, 0.2, 0.1, 'duas primeiras amostras']]
      .forEach(([s, d, want, name]) => {
        const got = regionPeak(b, s, d);
        if (Math.abs(got - want) > 1e-6) fail.push(`regionPeak(${name}) = ${got}, esperado ${want}`);
      });
  }
}

need(probe, 'ui-probe.js', ["const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6'];", '  function sfxPeak() {', "add('sfx-peak',"]);

console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS: B6 estático');
process.exitCode = fail.length ? 1 : 0;
```

Rodar `node jobs/checks/b6-static.js`. Esperado: `FAIL` com as linhas `index.html — ausente:` dos pontos do B6 (CSS, constante, cache, as quatro funções, a mensagem, o slider, o render e o `${measuresMsg(r)}${sfxHotMsg()}${skipped}`), `regionPeak não achada` e as três linhas `ui-probe.js — ausente:`. As duas linhas do B5 (`plateBuf = null; …` e `if (![...MUSIC, ...SFX]…`) **não** aparecem: o B6 não mexe nelas.

- [ ] **Step 2 [Executor]: `public/index.html` — 5 trocas, nesta ordem**

**public/index.html · troca 1 — CSS: efeito acima de −10.** Substituir:

```html
.bt-clip.sfx{border-left:3px solid var(--sfx)}
```

por:

```html
.bt-clip.sfx{border-left:3px solid var(--sfx)}
/* efeito com pico acima de −10 dBFS (B6): contorno e ▲, para o aviso não depender só da cor */
.bt-clip.sfx.over{box-shadow:inset 0 0 0 1px var(--go)}
.bt-clip.sfx.over .nm::before{content:'▲ '; color:var(--go)}
```

**public/index.html · troca 2 — pico por efeito depois de setMeterData.** Substituir:

```html
  function setMeterData(k, v) { const m = $q('#bt-meter'); if (m) m.dataset[k] = v; }
```

por:

```html
  function setMeterData(k, v) { const m = $q('#bt-meter'); if (m) m.dataset[k] = v; }

  /* ---------------- pico por efeito da SFX (B6) ----------------
     A referência de Reels quer cada efeito abaixo de −10 dBFS no medidor de pico
     tradicional, salvo elemento dramático. O app só avisa: o pico de amostra do
     trecho usado do arquivo, vezes o ganho do clipe, sem processar nada (o
     preview não tocaria um limiter só do export). */
  const SFX_PEAK_MAX = -10;
  // em cache por buffer: some junto quando o audioBufCache solta o arquivo
  const regionPeakCache = new WeakMap();
  function regionPeak(buf, srcIn, dur) {
    const a = Math.max(0, Math.floor(srcIn * buf.sampleRate));
    const b = Math.min(buf.length, Math.ceil((srcIn + dur) * buf.sampleRate));
    let m = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = a; i < b; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
    }
    return m;
  }
  function clipPeakDb(c) {
    const buf = audioBufCache.get(c.path);
    if (!buf) return null;
    let per = regionPeakCache.get(buf);
    if (!per) regionPeakCache.set(buf, per = new Map());
    const key = c.srcIn + '|' + c.dur;
    if (!per.has(key)) per.set(key, regionPeak(buf, c.srcIn, c.dur));
    const db = ampDb(per.get(key) * c.volume);
    return isFinite(db) ? Math.round(db * 10) / 10 : null;
  }
  // classe, title e data-peak de um clipe de SFX: no render e, ao vivo, no slider
  function markSfxPeak(el, c) {
    const pk = clipPeakDb(c), over = pk != null && pk > SFX_PEAK_MAX;
    el.classList.toggle('over', over);
    if (pk == null) delete el.dataset.peak; else el.dataset.peak = pk.toFixed(1);
    if (over) el.title = `pico ${fmtDb(pk)} dBFS — acima de −10; mantenha só se for um elemento dramático`;
    else el.removeAttribute('title');
  }
  // quantos efeitos acima do limiar vão para o export (só com a SFX soando)
  function sfxHotMsg() {
    if (!audible('sfx')) return '';
    const n = SFX.filter(c => { const pk = clipPeakDb(c); return pk != null && pk > SFX_PEAK_MAX; }).length;
    return n ? ` · ${n} SFX acima de −10 dB` : '';
  }
```

**public/index.html · troca 3 — slider: marca ao vivo.** Substituir:

```html
          syncPlayer();
          scheduleMaster();
        });
```

por:

```html
          syncPlayer();
          scheduleMaster();
          if (track === 'sfx') markSfxPeak(inp.closest('.bt-clip'), clipsFor(track)[+inp.dataset.idx]);
        });
```

**public/index.html · troca 4 — renderClipTrack: marca no render.** Substituir:

```html
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, waveColor);
      });
    }
  }
  function renderBrollTrack() {
```

por:

```html
        if (peaksArr instanceof Float32Array) drawPeaksToCanvas(cv, peaksArr, waveColor);
      });
      if (track === 'sfx') host.querySelectorAll('.bt-clip').forEach(el => markSfxPeak(el, arr[+el.dataset.idx]));
    }
  }
  function renderBrollTrack() {
```

**public/index.html · troca 5 — doConform: quantos efeitos acima de −10.** Substituir:

```html
${measuresMsg(r)}${skipped}`,
```

por:

```html
${measuresMsg(r)}${sfxHotMsg()}${skipped}`,
```

- [ ] **Step 3 [Executor]: `public/dev/ui-probe.js` — 3 trocas**

**public/dev/ui-probe.js · troca 1 — ORDER com B6.** Substituir:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5']; // o B4 não mexe na TIMELINE
```

por:

```js
  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6']; // o B4 não mexe na TIMELINE
```

**public/dev/ui-probe.js · troca 2 — sfxPeak antes de meter.** Substituir:

```js
  // Espera o primeiro render do master (até 10 s) e mede o lugar do medidor.
```

por:

```js
  // B6: em todo clipe de SFX com pico conhecido, a marca segue o limiar de −10 dBFS;
  // sem pico conhecido (arquivo ainda decodificando), nenhuma marca. Só lê.
  function sfxPeak() {
    const clips = $$('#bt-track-sfx .bt-clip'), bad = [];
    let known = 0;
    clips.forEach((c, i) => {
      const over = c.classList.contains('over'), title = !!c.getAttribute('title');
      if (!('peak' in c.dataset)) { if (over || title) bad.push({ i, peak: null, over, title }); return; }
      known++;
      const want = parseFloat(c.dataset.peak) > -10;
      if (over !== want || title !== want) bad.push({ i, peak: c.dataset.peak, over, title });
    });
    return { clips: clips.length, known, bad };
  }
  // Espera o primeiro render do master (até 10 s) e mede o lugar do medidor.
```

**public/dev/ui-probe.js · troca 3 — check do B6.** Substituir:

```js
          /^-?\d+\.\d$/.test(mt.peak || ''), mt, { rightOfTracks: true, heightDelta: '≤ 2', state: 'ok', token: '#34d399', peak: 'dBFS, uma casa' });
      }
```

por:

```js
          /^-?\d+\.\d$/.test(mt.peak || ''), mt, { rightOfTracks: true, heightDelta: '≤ 2', state: 'ok', token: '#34d399', peak: 'dBFS, uma casa' });
      }
      if (at('B6')) {
        const sp = sfxPeak();
        add('sfx-peak', sp.bad.length === 0, sp, { bad: [] });
      }
```

- [ ] **Step 4 [Executor]: Checagem** — `node jobs/checks/b6-static.js` → `PASS: B6 estático`. (O `b3-static` e o `b5-static` passam a falhar nos pontos que esta task muda de propósito — o trecho da mensagem e o `ORDER` —, como cada checagem estática deste plano vale no estágio dela.)

- [ ] **Step 5 [Executor]: Atualizar `## Status`** com as saídas dos Steps 1 e 4. Parar aqui.

- [ ] **Step 6 [Orquestrador]: `validator`** — "validar a Task 7 de `docs/plans/mixagem-audio.md`; rodar `node jobs/checks/b6-static.js`; conferir que o B6 só lê o áudio (nenhum nó de processamento, nada ligado ao que toca, nenhum ganho mudado); que o pico é o do trecho usado do arquivo (`srcIn`, `dur`) vezes o ganho do clipe; que a marca só existe em clipe da SFX, com a classe, o `▲` e o `title` juntos; que a contagem da mensagem só conta com a SFX audível; e que as limpezas de cache do B5 não mudaram".

- [ ] **Step 7 [Orquestrador]: Rota Player** — condições de medição, auxiliares colados, sidecar da fixture restaurado (v3).

```js
T.asset('hit.wav', 0.8); T.key('Home'); await T.sleep(200); await T.steps(60, 'ArrowRight');
await T.add('sfx', 'hit.wav');                                              // 2,0–2,8s, ganho 0 dB
const el = () => document.querySelector('#bt-track-sfx .bt-clip[data-idx="0"]');
for (let i = 0; i < 30 && !('peak' in el().dataset); i++) await T.sleep(100);   // espera decodificar
const antes = { peak: el().dataset.peak, over: el().classList.contains('over'), title: el().title,
  seta: getComputedStyle(el().querySelector('.nm'), '::before').content };
const r6 = await uiProbe.run('B6');
const ref = el(), inp = ref.querySelector('.bt-clip-vol');
inp.value = '-20'; inp.dispatchEvent(new Event('input'));
const depois = { mesmoElemento: el() === ref, peak: el().dataset.peak, over: el().classList.contains('over'), title: el().title };
({ antes, probe: { ok: r6.ok, falhas: r6.results.filter(x => x.status !== 'PASS').map(x => x.id) }, depois })
```

Esperado: `antes: { peak: "-3.1", over: true, title: "pico −3,1 dBFS — acima de −10; mantenha só se for um elemento dramático", seta: "\"▲ \"" }`; `probe: { ok: true, falhas: [] }`; `depois: { mesmoElemento: true, peak: "-23.1", over: false, title: "" }` (o slider tirou a marca sem re-render). No reteste do plano: exatamente esses valores, com o contorno `rgb(251, 191, 36) 0px 0px 0px 1px inset` no clipe marcado. Um clipe **selecionado** também ganha contorno âmbar (o `outline` de 2px da seleção); o `▲` é o que distingue o aviso. O pico do arquivo, para conferir: `ffmpeg -hide_banner -nostats -i jobs/b-check/hit.wav -af astats=measure_perchannel=none:measure_overall=Peak_level -f null - 2>&1 | grep "Peak level"` → −3,1.

O pico é do trecho usado (continua da cena acima: ganho de volta a 0 dB e o clipe dividido já no trecho baixo do arquivo):

```js
const inp = document.querySelector('#bt-track-sfx .bt-clip-vol');
inp.value = '0'; inp.dispatchEvent(new Event('input')); await T.sleep(100);
T.key('Home'); await T.sleep(200); await T.steps(70, 'ArrowRight');          // 2,33s: o arquivo já está a −20 dBFS
await T.menu('sfx', 0, 'bt-menu-split'); await T.sleep(300);
[...document.querySelectorAll('#bt-track-sfx .bt-clip')].map(c => ({ peak: c.dataset.peak, over: c.classList.contains('over') }))
```

Esperado: `[{ peak: "-3.1", over: true }, { peak: "-20.0", over: false }]` (no reteste do plano, esses valores).

A contagem na mensagem (duas chamadas por conform, como no B3):

```js
document.getElementById('bt-conform').click();
await T.sleep(40000);
T.stage()
```

```js
for (let i = 0; i < 40 && !/timeline conformada|erro/i.test(T.stage()); i++) await T.sleep(1000);
T.stage()
```

Esperado: a mensagem termina em "· 1 SFX acima de −10 dB" (só a primeira metade passa do limiar). No reteste do plano: "timeline conformada — 38.2s · 0 B-ROLL · 0 TRILHA · 2 SFX · 100 palavras · pico real −2,0 dBTP · −21,1 LUFS: abaixo do alvo −14 a −16 · LRA 15,0 LU: dinâmica alta para celular (ideal ≤ 9) · limitador −0,4 dB · 1 SFX acima de −10 dB" — o efeito a −3 dBFS somado à voz passa do teto (o medidor mostra −1,6 em vermelho), e um efeito alto de 0,8 s basta para o LRA do arquivo passar de 9. Depois `T.btn('sfx', 'mute').click()` e conformar de novo: a mensagem mostra "fora do export: SFX (mudo)" e **não** tem o trecho "SFX acima de −10 dB". Apagar os conformados e restaurar o sidecar da fixture.

- [ ] **Step 8 [Orquestrador + Usuário]: Rota canvas** — usuário bloqueia `/vendor/studio-player.js` e recarrega; `load`, auxiliares; repetir o primeiro bloco do Step 7. Esperado: os mesmos valores (`antes`, `probe`, `depois`): o aviso não depende da rota. No reteste do plano (bundle fora do ar, `rota: "canvas"`): iguais. Restaurar o sidecar da fixture.

- [ ] **Step 9 [Usuário]: Checklist manual** (itens 1–12 do A, com o item 8 da Task 4) + pôr um efeito alto na SFX: aparece o `▲` e o contorno, e o `title` diz o pico; baixar o slider até o aviso sumir; um efeito leve (abaixo de −10) fica sem marca; a mensagem do CONFORMAR conta os efeitos marcados.

- [ ] **Step 10 [Orquestrador → Usuário]: `git-workflow`** `prepare` (branch `feat/audio-mix-b6`; arquivos `public/index.html`, `public/dev/ui-probe.js`; commit `Flag SFX clips peaking above -10 dBFS (B6)`) → OK do usuário → `publish`.

---

## Verificação

Seção do Orquestrador: resultados de validator, navegador e checklist de cada task, e qualquer desvio aprovado pelo usuário.

### Task 1 (B0) — 2026-09-22

**Preparo (Task 0):** mídia de teste gerada em `jobs/b-check/` (`whoosh.wav`, `bed.wav`, `loud.wav`, `hit.wav`) e sidecar v3 da fixture copiado para `jobs/b-check/fixture.beats.json.bak`. `main` em `09c5ba9`, sincronizada com `origin/main`; working tree limpo.

**Bugs reproduzidos no `HEAD` (Step 1):** `node server.js`, Chrome 1280×800, `?probe=1`, fixture carregada, auxiliares colados.
- Rota Player (`StudioPlayer` presente): `bed.wav` na TRILHA, espião ligado, slider do clipe a 0,4 → `{ updates: 0 }`. O ganho não chega ao Player.
- Rota canvas (Network request blocking em `/vendor/studio-player.js`, feito pelo usuário; conferido `__playerBundleFailed` ligado e `StudioPlayer` ausente): `bed.wav` dividido em 1,5s (`clips: 2`), play por Espaço a partir de 0,2s → `00:00.2 trilha[p]` · `00:01.5 trilha[▶]` · `00:02.8 trilha[p]`. Um elemento só, pausado durante toda a primeira metade; ele toca só na segunda. O `p` final é o `T.pause()` da gravação.

**Validator (Step 6):** APROVADO, sem achados. `node jobs/checks/b0-static.js` → `PASS: B0 estático` (script idêntico ao bloco do Step 2); diff de `public/index.html` = exatamente as 6 trocas (5 hunks: trocas 2 e 3 no mesmo); `getAudioEl` só na definição e no laço do `compositeTick()`; nenhum `entry.audio` (singular) nem `getMusicAudioEl` restante; o plano só mudou em `## Verificação` e `## Status`; nenhum outro arquivo versionado modificado.

**Depois da mudança (Step 7):** mesmas condições do Step 1; conferido que o servidor entrega o código novo (`function getAudioEl(path, k)` no HTML).
- Rota canvas: `await uiProbe.run('E3b')` → `ok: true`, sem falhas. Cena do Step 1 → `clips: 2` e **dois** elementos: `00:00.2 trilha[▶p]` · `00:01.5 trilha[p▶]` · `00:02.8 trilha[pp]`. A primeira metade toca no primeiro elemento, a segunda no outro, e os dois param perto do fim do clipe (3,0s).
- Rota Player (bloqueio desligado pelo usuário; `StudioPlayer` presente): `await uiProbe.run('E3b')` → `ok: true`, sem falhas. Slider do clipe da TRILHA a 0,4 → `{ updates: 1 }`, e o Player recebe `volume: 0.4`.
- Sidecar da fixture restaurado (estava intacto: a cena não salva).

**Checklist manual (Step 8):** informado pelo usuário — tudo OK: itens 1–12 do A, as duas metades de um clipe dividido da TRILHA soando na rota canvas e o slider de ganho mudando o volume na hora, com o vídeo tocando, na rota Player. Depois do checklist, sidecar da fixture conferido intacto e nenhum arquivo de teste deixado em `output/`.

**Publicação (Step 9):** PR #19, commit `8128bdd`, merge commit `ba928a7`.

### Task 2 (B1) — 2026-09-22

**Validator (Step 7):** APROVADO, sem achados. `node jobs/checks/b1-unit.js` → `PASS: B1 unidade`; `node jobs/checks/b1-e2e.js` → `PASS: B1 ponta a ponta` (porta 4879, autolimpeza conferida); os dois scripts idênticos aos blocos do Step 1. Diff contra `HEAD` = exatamente as 18 trocas (16 hunks): `lib/ffmpeg.js` só ganhou `channels`; a parte de vídeo de `buildConformGraph` (passos 1 e 2) não aparece no diff; a regra de `audible` é a da spec, literal; a cadeia do master é a da spec (item 5), com `atrim=end=<duração>` antes do `asplit`; `tl.sfx` passa por `resolveClips` → `resolveInput()`; `limiter` vem de `b.limiter` (corpo da requisição) e `mix` de `tl.mix` (sidecar); `parseMixPeak` é regex pura e `measureLoudness` devolve nulos em qualquer erro. No plano só `## Status` mudou; nenhum outro arquivo versionado modificado; nenhum `output/conformed-*.mp4` novo.

**Servidor reiniciado** na porta 4870 com o código novo (o processo anterior tinha o `lib/timeline.js` antigo carregado).

**Conferência do usuário (Step 8):** conform rodado num projeto real com TRILHA (duas músicas na lane). Linha do CONSOLE: `[conform] mix antes do limitador: -0.8 dBFS (corte 1.2 dB) · pico real: -1.8 dBTP · loudness: -17.0 LUFS · LRA: 1.5 LU`. O limitador cortou 1,2 dB e o arquivo saiu em −1,8 dBTP, dentro da faixa de −1 a −2. O EXPORT também concluiu, com o arquivo chegando ao passo seguinte (item 11 do checklist).

**Achado do usuário, fora do escopo desta task (vira a etapa B7, decidido pelo usuário):** aparar ou dividir um clipe da TRILHA não muda o desenho da minionda. O áudio é cortado de verdade (preview canvas busca `c.srcIn + (t − c.start)`; o conform usa `atrim` por `srcIn`/`dur`), mas `ensureMiniWave` guarda 200 colunas do **arquivo inteiro** e `drawPeaksToCanvas` estica essas colunas na largura do clipe, sem olhar `srcIn`/`dur`: as duas metades de um split mostram a mesma onda. Junto disso, o trim da borda direita só trava no fim da timeline (`hi = DURATION` em `startClipTrim`), não no fim da mídia, então dá para esticar um clipe além do arquivo e o excedente sai em silêncio. Correção esboçada: guardar a duração decodificada por arquivo, desenhar só a janela `[srcIn, srcIn + dur]` e travar o trim direito em `srcIn + dur ≤ duração da mídia`. Fica para depois do B6, com spec e plano próprios, para não reabrir tasks já testadas (o B2, o B5 e o B6 mexem nas mesmas funções).

**Correção no Step 9 desta task:** o título de commit escrito na R3 tinha 85 caracteres, acima do limite de 72 do projeto. Encurtado para `Conform SFX and mute/solo, add master limiter, measure loudness (B1)` (68); "keep mono level" continua no corpo do commit. O Step 9 acima já está com o título novo.

**Publicação (Step 9):** PR #20, commit `631e2c0`, merge commit `56d2a04`.

### Task 3 (B2) — 2026-09-22

**Validator (Step 9):** APROVADO, sem achados. `node jobs/checks/b2-static.js` → `PASS: B2 estático` (script idêntico ao bloco do Step 1). Diff = as 35 + 4 + 1 + 9 trocas do plano (33 + 4 + 1 + 9 hunks), sem nada a mais; nenhum ramo `track === 'broll' ? … : <TRILHA>` restante; os três pontos de arraste/trim usam `CLIP_HOST[track]`; `capSimultaneous` arredonda como `TimelinePreview.tsx` (`Math.round(s * fps)`, piso de 1 frame, `FPS = 30` nos dois lados); o bundle tem `numberOfSharedAudioTags:16` e `audible` e não tem `trilhaSolo`; `lib/`, `server.js` e `styles/` intocados; no plano só `## Status` mudou.

**Bundle reproduzível (Step 10):** `sha256` antes e depois de um `npm run build:player` das mesmas fontes: `32999dfdc5bb96d48283fbf00117c8ad91149a445523c009993c9c1a90f8de7a` nas duas vezes.

**Rota Player (Step 11):** condições de medição (1280×800, `?probe=1`, fixture carregada, sidecar v3 restaurado).
- `await uiProbe.run('B2')` → `ok: true`, `falhas: []`, `sfxAntes: 0`.
- Lane e clipe: `titulo: "ADICIONAR SFX"`, `width: "48px"`, `border: "rgb(34, 211, 238)"`, `nm: "9.5px"`, `props: ["sfx0"]`, `audible` todo `true`, `empilhados: ["sfx0","sfx1"]`, `slider: { updates: 1, vol: 0.0631, title: "−24,0 dB", faixa: ["-40","0","0.5"] }`, `undo: 1` — todos os valores esperados pelo plano.
- Som de verdade, dois efeitos idênticos empilhados em 0,53s: `00:00.0 [] plateMudo=false` · `00:00.6 [▶sfx0 ▶sfx1] plateMudo=false` · `00:01.4 [] plateMudo=false`.
- Teto de 16: `total: 20`, `camasNoPlayer: 16`, aviso "mais de 16 áudios simultâneos: o preview toca 16, o export toca todos", `quebrou: false`.
- Salvar e recarregar: sidecar `{ version: 4, sfx: 1, music: 0, mix: { mute: [], solo: null } }`; depois da recarga, `T.clips('sfx')` → 1.
- CONFORMAR com o efeito em 0–0,8s: resultado com `sfx: 1`, `mixPeakDb: -8.3`, `limiter: { ceilingDb: -2, cutDb: 0 }`, `truePeakDb: -8.3`, `lufs: -25`, `lra: 4.4`. Medição do tom (passa-banda de 1 kHz, 0,1–0,7s): conformado −21,1 dB (mono duplicado; −24 indicaria o upmix de −3 dB), fixture sem efeito −55,4 dB. A mensagem ainda não traz "· N SFX": esse trecho entra no B3. Conformado apagado e sidecar da fixture restaurado.

**Rota canvas (Step 12):** bloqueio de `/vendor/studio-player.js` ligado pelo usuário; conferido `rota: "canvas"`. `await uiProbe.run('B2')` → `ok: true`, `falhas: []`; dois efeitos idênticos empilhados em 0,5s → `00:00.2 sfx[pp] plateMudo=false` · `00:00.4 sfx[▶▶] plateMudo=false` · `00:01.2 sfx[pp] plateMudo=false`: o mesmo arquivo toca duas vezes, cada clipe no seu elemento (a correção do B0 valendo para a SFX). Sidecar da fixture restaurado.

**Checklist manual (Step 13):** informado pelo usuário — tudo OK: itens 1–12 do A, mais a lane SFX com efeito próprio (entra com a duração do arquivo, toca na janela certa nas duas rotas, slider em dB agindo ao vivo, arraste/trim/divisão/duplicar/colar/apagar como na TRILHA, SALVAR e recarregar mantendo a SFX, e projeto antigo abrindo com a SFX vazia).

---

## Status

Seção do executor. Vazia até a primeira execução.

### Task 1 (B0) — 2026-09-22 (Executor, Steps 2–5)

Executado sobre a `main` local em `09c5ba9`. Steps 2, 3 e 4 concluídos; Step 5 (este) atualiza o Status e para.

**Step 2 — `jobs/checks/b0-static.js` salvo (cópia literal do plano) e rodado antes das trocas:**

```
FAIL
getMusicAudioEl ainda existe
ainda há entry.audio (singular)
ausente: function getAudioEl(path, k) {
ausente: entry.audios[k] = a;
ausente: const seen = new Map(); // path -> ocorrências já servidas nesta passada
ausente: const el = getAudioEl(c.path, k);
ausente: if (entry.audios) entry.audios.splice(uses).forEach(a => { if (a) { a.pause(); a.remove(); } });
ausente: if (entry.audios) entry.audios.forEach(a => { if (a) { a.pause(); a.remove(); } });
getAudioEl deveria aparecer 2× (definição + laço), achado 0
o input do slider de ganho não chama syncPlayer()
```

(`exitCode 1`) — idêntico ao esperado no plano.

**Step 3 — as 6 trocas aplicadas em `public/index.html`** (`mediaCache` comentário; `pruneMediaCache()`; `clearMediaCache()`; `getMusicAudioEl` → `getAudioEl(path, k)`; laço `MUSIC.forEach` do `compositeTick()`; listener `input` do `.bt-clip-vol`), na ordem do plano.

**Step 4 — `node jobs/checks/b0-static.js` depois das trocas:**

```
PASS: B0 estático
```

**`git diff --stat -- public/index.html`:**

```
public/index.html | 34 +++++++++++++++++++++++-----------
1 file changed, 23 insertions(+), 11 deletions(-)
```

5 hunks (`git diff | grep -c '^@@'`). São as 6 trocas do Step 3: troca 2 (`pruneMediaCache`) e troca 3 (`clearMediaCache`) caíram no mesmo hunk por estarem a poucas linhas uma da outra (contexto padrão de 3 linhas do diff); as outras 4 trocas (mediaCache, slider de ganho, `getAudioEl`, laço `MUSIC.forEach`) geraram um hunk cada. Nenhuma outra parte de `public/index.html` foi tocada; nenhum outro arquivo do repo foi modificado por esta task.

Nenhum desvio do plano. Parando no Step 5 conforme instruído; Steps 6–9 (validator, verificação pós-troca, checklist manual, git-workflow) ficam para o Orquestrador.

### Task 2 (B1) — 2026-09-22 (Executor, Steps 1–6)

Executado sobre a `main` local em `ba928a7`. Steps 1–5 concluídos; Step 6 (este) atualiza o Status e para.

**Step 1 — `jobs/checks/b1-unit.js` e `jobs/checks/b1-e2e.js` salvos (cópia literal do plano, via ferramenta de escrita de arquivos, sem heredoc) e rodados antes das trocas:**

`node jobs/checks/b1-unit.js` →

```
FAIL
só VÍDEO: cadeia do master ausente ou diferente
só VÍDEO: args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio
com TRILHA: cadeia do master ausente ou diferente
com TRILHA: args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio
B-ROLL + TRILHA: cadeia do master ausente ou diferente
B-ROLL + TRILHA: args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio
plate sem áudio: cadeia do master ausente ou diferente
plate sem áudio: args com o limitador deveriam diferir do HEAD só no filtro e no -map de áudio
SFX: cadeia do primeiro clipe (input 4) ausente ou diferente
SFX: segundo clipe (input 5, mesmo arquivo) ausente
SFX: amix não soma base + 2 TRILHA + 2 SFX com normalize=0
SFX: ordem dos -i ["base.mp4","b1.mp4","m1.wav","m2.wav"]
SFX sem TRILHA: input 1 e amix de 2
mono: pan só no clipe de 1 canal
normalizeMix/audible não exportadas
tpWarnOf/lraWarnOf não exportadas
MASTER_CEIL_DB = undefined, esperado -2
parseLoudness/loudWarnOf não exportadas
parseMixPeak não exportada
```

(`exitCode 1`) — idêntico ao esperado no plano (as linhas de não-regressão com `limiter: false` não apareceram, como previsto).

`node jobs/checks/b1-e2e.js` (~15s) → `FAIL`, com as linhas-chave esperadas todas presentes: `C1: mono perdeu 3 dB no export — RMS S -Infinity, M -24.09041`; janelas de C3/C4 com som onde deveria haver silêncio (`C3 solo sfx: janela A deveria ter silêncio, RMS -24.10…`, `janela M deveria ter silêncio, RMS -24.09…`; mesmo padrão em C4); as linhas de medição com `undefined` em C1, C4, C5, C5b, C6, C7 e `C8: LRA undefined / undefined, esperado > 9 e high`; `sidecar: version 3`; `rota: limitador deveria vir ligado por padrão, veio undefined`; e `(arquivos mantidos em jobs/b1-check/)`. `C9` (alinhamento) não apareceu na lista de falhas — passou já no código de hoje, como o plano antecipa. Também apareceram falhas adicionais não citadas no texto do plano mas cobertas pelo "inclui" (p.ex. `C1 padrão: janela S deveria ter som, RMS -Infinity dB`, `C1: contagens sfx/music undefined/1`, `C1: excluded undefined` e as correspondentes em C2/C3/C4/C5/C5b) — todas consistentes com SFX/mix ainda não implementados.

Limpeza pós-Step-1 conforme pedido: `jobs/b1-check/` apagado (`rm -rf`). O arquivo `output/conformed-cdd0dd366b41.mp4`, citado na linha `rota: mix do sidecar ignorado`, já não existia em `output/` ao checar — o próprio script o remove com `fs.rmSync(out1, { force: true })` logo depois de montar as asserções daquele bloco (as chamadas `ok(...)` só acumulam falhas, não interrompem a execução, então a limpeza roda de qualquer forma). Conferido que só os dois `conformed-*.mp4` pré-existentes (556f7c8f83b3, ab05b3a46a09, anteriores a esta sessão) seguem em `output/`; nenhum arquivo estranho ficou para trás.

**Steps 2–4 — as trocas aplicadas**, na ordem do plano: `lib/ffmpeg.js` (1 troca — `channels` em `mediaInfo`); `lib/timeline.js` (12 trocas — cabeçalho; constantes do limitador; `normalizeMix`/`audible`; assinatura de `buildConformGraph`; TRILHA+SFX no amix e cadeia do master; `-i` de SFX em `buildConformArgs`; `channels` em `probeClips`; bloco de medição — `parseMixPeak`, `parseLoudness`, `measureLoudness`, `loudWarnOf`, `tpWarnOf`, `lraWarnOf` — e nova assinatura de `conform()`; regra `audible`/`excluded` antes do grafo; pico e medição do arquivo depois do `runFfmpeg`; retorno de `conform()`; `module.exports`); `server.js` (5 trocas — `require` com `normalizeMix`; sidecar v4 em `POST /api/beats`; comentário do bloco de conform; `sfx` resolvido por `resolveInput` junto de broll/music; `sfx`, `mix: tl.mix` e `limiter: b.limiter !== false` passados a `conform()`).

**Step 5 — checagens depois das trocas:**

```
$ node --check server.js
server.js OK

$ node jobs/checks/b1-unit.js
PASS: B1 unidade

$ node jobs/checks/b1-e2e.js
PASS: B1 ponta a ponta
```

O `b1-e2e.js` se autolimpou (`jobs/b1-check/` removido, o `conform` via servidor removeu cada `output/conformed-*.mp4` que criou). Confirmado depois: porta 4879 livre; porta 4870 (servidor do Orquestrador) seguia `LISTENING`, não tocada.

**`git diff --stat` (arquivos rastreados; `jobs/checks/*.js` não aparece — `jobs/` é ignorado pelo git):**

```
lib/ffmpeg.js   |   1 +
lib/timeline.js | 190 +++++++++++++++++++++++++++++++++++++++++++++++++-------
server.js       |  19 ++++--
3 files changed, 180 insertions(+), 30 deletions(-)
```

16 hunks (`git diff | grep -c '^@@'`) nos 3 arquivos, batendo com as 1 + 12 + 5 = 18 trocas do plano (algumas trocas adjacentes caem no mesmo hunk pelo contexto padrão do diff, como já visto na Task 1/B0).

Nenhum desvio do plano. `git status --short` mostra só `M lib/ffmpeg.js`, `M lib/timeline.js`, `M server.js` — nenhum outro arquivo rastreado tocado; nenhum commit criado; nenhuma branch trocada. Parando no Step 6 conforme instruído; Steps 7–9 (validator, conferência do usuário, git-workflow) ficam para o Orquestrador.

### Task 3 (B2) — 2026-09-22 (Executor, Steps 1–8)

Executado sobre a `main` local em `56d2a04` (sincronizada com `origin/main`; Tasks 1/B0 e 2/B1 já mergeadas). Steps 1–7 concluídos; Step 8 (este) atualiza o Status e para.

**Step 1 — `jobs/checks/b2-static.js` salvo (cópia literal do plano, via ferramenta de escrita de arquivos, sem heredoc) e rodado antes das trocas:**

```
FAIL
index.html — ausente: --sfx:#22d3ee;
index.html — ausente: .bt-clip.sfx{border-left:3px solid var(--sfx)}
index.html — ausente: .bt-clip.music .nm,.bt-clip.sfx .nm{font-size:9.5px} /* isento:
index.html — ausente: let SFX = [];
index.html — ausente: <div class="bt-track-row" data-track="sfx">
index.html — ausente: <span class="ic">≈</span><span class="nm">SFX</span>
index.html — ausente: ${tctlHtml('add', 'SFX')}${tctlHtml('lock', 'SFX')}</div>
index.html — ausente: <div class="bt-track-content" id="bt-track-sfx"></div>
index.html — ausente: track === 'sfx' ? SFX : MUSIC
index.html — ausente: const CLIP_HOST = { broll: 'bt-track-broll', music: 'bt-track-music', sfx: 'bt-track-sfx' };
index.html — ausente: const CLIP_TRACK_NAME = { broll: 'B-ROLL', music: 'TRILHA', sfx: 'SFX' };
index.html — ausente: ADICIONAR ${CLIP_TRACK_NAME[track]}
index.html — ausente: function renderSfxTrack() { renderClipTrack('sfx', 'bt-track-sfx'); }
index.html — ausente: const want = track === 'sfx' && asset.info && asset.info.duration > 0 ? asset.info.duration : 3;
index.html — ausente: const isAudio = track === 'music' || track === 'sfx';
index.html — ausente: clipsFor(track)[+inp.dataset.idx].volume = volumeOf(+inp.value);
index.html — ausente: inp.setAttribute('aria-valuetext', inp.title);
index.html — ausente: min="${GAIN_DB_MIN}" max="0" step="0.5" value="${dbOf(c.volume)}"
index.html — ausente: const GAIN_DB_MIN = -40;
index.html — ausente: ['broll', 'music', 'sfx'].forEach(track => clipsFor(track).forEach((c, i) => {
index.html — ausente: const byTrack = { broll: [], music: [], sfx: [], video: [] };
index.html — ausente: ['broll', 'music', 'sfx', 'video'].forEach(t =>
index.html — ausente: SFX = JSON.parse(JSON.stringify(entry.sfx || []));
index.html — ausente: const uses = [...MUSIC, ...SFX].filter(c => c.path === path).length;
index.html — ausente: sfx: SFX.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
index.html — ausente: SFX = Array.isArray(saved.sfx) ? saved.sfx.map(
index.html — ausente: SFX = (saved && Array.isArray(saved.sfx)) ? saved.sfx.map(
index.html — ausente: function audibleNow() {
index.html — ausente: return { audio: !trilhaSolo, music: !trilhaMuted && !hiddenTracks.music, sfx: !trilhaSolo };
index.html — ausente: const PLAYER_AUDIO_MAX = 16;
index.html — ausente: function capSimultaneous(items) {
index.html — ausente: sfx: bedsOf('sfx'),
index.html — ausente: audible: aud,
index.html — ausente: path: url(c) + '#' + track + k,
index.html — ausente: if (video.muted !== !aud.audio) video.muted = !aud.audio;
index.html — ausente: [...MUSIC.map(c => ['music', c]), ...SFX.map(c => ['sfx', c])].forEach(([track, c]) => {
index.html — ausente: const shouldPlay = onWindow && !video.paused && aud[track];
index.html — não deveria existir: track === 'broll' ? 'bt-track-broll' : 'bt-track-music'
index.html — não deveria existir: track === 'broll' ? 'B-ROLL' : 'TRILHA'
index.html — não deveria existir: trilhaMuted, trilhaSolo,
index.html — não deveria existir: el.muted = trilhaMuted;
index.html — não deveria existir: !video.paused && !hiddenTracks.music
CLIP_HOST[track] deveria aparecer 3× (arraste e trim)
renderSfxTrack() deveria aparecer 7× (1 definição + 6 chamadas), achado 0
snapshot e timelineState deveriam levar sfx
trackHeights.sfx deveria existir nos dois lugares
esperadas 17 chamadas ${tctlHtml(…)} (15 + 2 da SFX)
a linha SFX deveria vir depois da TRILHA
dbOf/volumeOf/dbLabel não extraíveis: dbOf is not defined
TimelinePreview.tsx — ausente: sfx: Clip[];
TimelinePreview.tsx — ausente: audible: { audio: boolean; music: boolean; sfx: boolean };
TimelinePreview.tsx — ausente: muted={!audible.audio}
TimelinePreview.tsx — ausente: {audible.music && bed(music, 'm')}
TimelinePreview.tsx — ausente: {audible.sfx && bed(sfx, 'x')}
TimelinePreview.tsx — ausente: audible: { audio: true, music: true, sfx: true },
TimelinePreview.tsx — não deveria existir: trilhaMuted
TimelinePreview.tsx — não deveria existir: trilhaSolo
TimelinePreview.tsx — não deveria existir: hidden.music
player-entry.tsx — ausente: numberOfSharedAudioTags={16}
bundle não reconstruído (sem "audible" ou ainda com "trilhaSolo")
bundle sem numberOfSharedAudioTags:16
ui-probe.js — ausente: const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3'];
ui-probe.js — ausente: const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music', '.bt-clip.sfx'];
ui-probe.js — ausente: const TRACK_ORDER_B = TRACK_ORDER.concat('sfx');
ui-probe.js — ausente: function sfxLane() {
ui-probe.js — ausente: add('sfx-lane',
ui-probe.js — ausente: const wantOrder = at('B2') ? TRACK_ORDER_B : TRACK_ORDER;
ui-probe.js — ausente: if (!text || AMBIENT.test(text) || /#claude-/.test(where)) return;
```

(`exitCode 1`) — idêntico ao esperado no plano: dezenas de `ausente:` em `index.html`, `TimelinePreview.tsx`, `player-entry.tsx` e `ui-probe.js`; as `não deveria existir:` de `trilhaMuted`/`trilhaSolo`/`hidden.music` na composição; e `bundle não reconstruído`.

**Steps 2–4 — as trocas aplicadas**, na ordem do plano: `public/index.html` (35 trocas: `:root`; CSS de `.bt-clip.sfx` e `.bt-clip.music,.bt-clip.sfx .nm`; estado — `SFX`, comentários de `selectedClip`/`selectedClipSet`, `trackHeights.sfx`; `audibleNow()` + `capSimultaneous()` + `playerProps()` reescrito; `snapshot()`, `timelineState()`, `applyHistEntry()` com `sfx`; `pruneMediaCache()` conta TRILHA+SFX; `snapTargets()` com `'sfx'`; `ensureMiniWave()` chama `renderSfxTrack()`; `saveBeats()`/`applySavedBeats()` com `sfx`; markup do `buildDom()` — linha SFX depois da TRILHA; `clipsFor()` + `CLIP_HOST`/`CLIP_TRACK_NAME` + `dbOf`/`volumeOf`/`dbLabel`; `addClipAt()` — duração padrão da SFX; `renderClipTrack()` — slider em dB, `isAudio`, minionda e listeners para TRILHA+SFX; `renderSfxTrack()`; `openAddClipPopover()` pelo mapa; `compositeTick()` — TRILHA+SFX por ocorrência, plate por `audibleNow()`; `renderTracks()`, `onClipContextMenu()`, `startRowResize()` com SFX; `startClipMove()`/`startClipTrim()` — host pelo mapa (3×); `deleteSelection()` — `byTrack` e ordem com `sfx`; `startClipGroupMove()`, `onTracksMouseDown()` — re-render com SFX; `loadVideo()` — altura e leitura de `sfx`); `remotion/src/scenes/TimelinePreview.tsx` (4 trocas: props `sfx`/`audible`; função `bed()`; plate `muted={!audible.audio}`; TRILHA+SFX via `bed()`); `remotion/src/player-entry.tsx` (1 troca: `numberOfSharedAudioTags={16}`); `public/dev/ui-probe.js` (9 trocas: cabeçalho; `ORDER`/`EXEMPT_TEXT`; `TRACK_ORDER_B`; `sfxLane()`; isenção de `text-floor` a partir do B2; `track-order` por estágio; check `sfx-lane`; `console.info`; filtro `/#claude-/` em `motion-literals`).

**Step 5 — tipos e bundle:**

```
$ cd remotion && npx tsc --noEmit -p .
src/player-entry.tsx(11,39): error TS7016: Could not find a declaration file for module 'react-dom/client'. 'C:/Users/Usuario/Documents/GitHub/ai-video-studio/remotion/node_modules/react-dom/client.js' implicitly has an 'any' type.
  Try `npm i --save-dev @types/react-dom` if it exists or add a new declaration (.d.ts) file containing `declare module 'react-dom/client';`
```

Só o erro pré-existente esperado (`TS7016` em `react-dom/client`, já presente no `HEAD`); nenhum outro erro de tipo.

```
$ npm run build:player

> build:player
> esbuild src/player-entry.tsx --bundle --format=iife --platform=browser --target=es2020 --outfile=../public/vendor/studio-player.js --define:process.env.NODE_ENV=\"production\" --minify

  ..\public\vendor\studio-player.js  403.4kb

Done in 58ms
```

Tamanho igual ao esperado (`403.4kb`, ±1kb); `wc -c public/vendor/studio-player.js` → 413101 bytes. `public/vendor/studio-player.js` entra no diff (bundle regenerado, versionado).

**Step 6 — as 9 trocas aplicadas em `public/dev/ui-probe.js`**, na ordem do plano.

**Step 7 — `node jobs/checks/b2-static.js` depois das trocas:**

```
PASS: B2 estático
```

**`git diff --stat` (arquivos rastreados; `jobs/checks/b2-static.js` não aparece — `jobs/` é ignorado pelo git):**

```
public/dev/ui-probe.js                  |  45 +++++++---
public/index.html                       | 155 +++++++++++++++++++++++++-------
public/vendor/studio-player.js          |  24 ++---
remotion/src/player-entry.tsx           |   4 +
remotion/src/scenes/TimelinePreview.tsx |  38 ++++----
5 files changed, 193 insertions(+), 73 deletions(-)
```

Hunks por arquivo (`git diff -- <arquivo> | grep -c '^@@'`): `public/index.html` 33 (as 35 trocas do Step 2, com algumas adjacentes caindo no mesmo hunk pelo contexto padrão do diff, como nas Tasks 1 e 2); `remotion/src/scenes/TimelinePreview.tsx` 4; `remotion/src/player-entry.tsx` 1; `public/dev/ui-probe.js` 9; `public/vendor/studio-player.js` 5 (bundle minificado — hunks não correspondem 1:1 às trocas de fonte).

Nenhum desvio do plano. `git status --short` mostra só `M public/dev/ui-probe.js`, `M public/index.html`, `M public/vendor/studio-player.js`, `M remotion/src/player-entry.tsx`, `M remotion/src/scenes/TimelinePreview.tsx` — nenhum outro arquivo rastreado tocado; nenhum commit criado; nenhuma branch trocada; `main` local permanece em `56d2a04`. Parando no Step 8 conforme instruído; Steps 9–11 (validator, bundle reproduzível, verificação no navegador nas duas rotas) e os Steps de usuário/git-workflow ficam para o Orquestrador.
