# Plan — Remotion Player na TIMELINE + remoção do TRIBE

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

Este plano substitui o documento de visão `hyperframes-remotion-integration-plan.md`
(saída de brainstorm). Ele foi reescrito contra o estado real do repo em
`f621f2b` — o documento original descrevia um app que não existe mais em
quatro pontos (ver `## Correções ao documento de origem`).

---

## Goal

Três entregas, em ordem de risco crescente:

0. **Remover o TRIBE v2 do app por completo** — código, rota, pasta e toda a
   documentação de licenciamento que existe só por causa dele.
1. **Infra**: permitir que código React compilado (o Player) seja servido pelo
   app **sem introduzir build step no backend**, e corrigir o `serveFile` para
   honrar HTTP Range (pré-requisito de seek frame-accurate).
2. **Trocar o compositor canvas da TIMELINE pelo `@remotion/player`**, com
   fallback automático para o compositor atual se o bundle não existir.

As Etapas 3–5 estão listadas no fim como **roadmap não-executável** — cada uma
precisa do seu próprio plano antes de ir pro Executor.

---

## Decisões do usuário (registradas, não re-litigar)

| Decisão | Consequência neste plano |
|---|---|
| Substituir o player atual pelo Remotion Player | Etapas 1 e 2. O compositor canvas **não é apagado** — vira fallback |
| Remover TRIBE completamente | Etapa 0 |
| HyperFrames fica para o futuro | Movido para `## Backlog`, com as perguntas de due diligence que faltam |
| Começar por prioridades, em etapas | Ordem 0 → 1 → 2; cada etapa é commitável sozinha |

**Assunção declarada (o usuário pode derrubar):** "remover TRIBE" ≠ "remover a
curva de atenção". `proxyCurve()` e `POST /api/score` **sobrevivem** — são
heurística local própria, sem relação com a licença non-commercial. Só o que é
TRIBE sai. Se a intenção era remover o score inteiro, avise antes da Etapa 0.

---

## Global constraints (invariantes que nenhuma etapa pode quebrar)

1. **Zero npm no backend.** `server.js` e `lib/*` continuam sem `require` de
   pacote npm. Todo React vive em `remotion/`, que já é projeto npm.
2. **Zero build step para rodar o app.** `git clone && node server.js` continua
   funcionando. O bundle do Player é **artefato commitado**; quem não roda
   `npm run build:player` usa o que está no repo, e quem não tem o arquivo cai
   no fallback.
3. **Path-safety.** Nenhuma rota nova deixa path de cliente chegar a `fs`.
   A rota `/vendor/` usa allowlist por regex, não `resolveInput()`.
4. **Ordem canônica do filtergraph do EXPORT** (`lib/encode.js:90-112`)
   permanece intocada. Nenhuma etapa aqui mexe em encode.
5. **O Player é PREVIEW, nunca render.** `lib/timeline.js` (`/api/timeline/conform`)
   continua o **único** caminho pelo qual a timeline chega ao arquivo exportado.
   Frames do browser nunca entram na entrega.
6. **Contrato do job bus.** Se alguma etapa adicionar passo de pipeline em
   `lib/*`, ele recebe `onLog`/`onStage`/`onProgress`.
7. **Degradação graciosa.** Bundle ausente → TIMELINE funciona como hoje.
   Esse é o mesmo padrão de todo engine do app.

---

## Correções ao documento de origem

O documento de brainstorm parte de quatro premissas que não batem com o repo.
Registradas aqui para não voltarem:

| Premissa do documento | Realidade em `f621f2b` |
|---|---|
| "Interface estilo Premiere" a construir | **Já existe**: step 04 TIMELINE, 6 tracks, ripple edit, J/K/L, snapping, undo/redo, zoom, `CONFORMAR → EXPORT` |
| Atualizar `clipper/check-deps.js` para probar engine | Esse arquivo só **imprime**; o probe vive em `lib/deps.js`, que alimenta `/api/deps` e a sidebar |
| Legendas viram "território do Remotion" | Colide com `lib/encode.js:90-112` — legenda entra **depois** da LUT, ungraded. Ver Etapa 3 |
| Item 9: "gate VMAF com legendas queimadas" | `lib/encode.js:205-211` aplica grade+legenda **também na referência**, de propósito. A métrica atual não consegue ver blocking do texto. Ver Etapa 5 |

---

## Files

**Etapa 0:** `server.js`, `lib/score.js`, `LICENSES.md`, `README.md`, `CLAUDE.md`,
`.claude/agents/executor.md`, `.claude/agents/validator.md`; deletar `tribe/`.

**Etapa 1:** `server.js`, `remotion/package.json`, `remotion/src/player-entry.tsx` (novo),
`.gitignore`.

**Etapa 2:** `remotion/src/scenes/TimelinePreview.tsx` (novo), `public/index.html`,
`public/vendor/studio-player.js` (gerado e commitado).

---

# ETAPA 0 — Remover TRIBE v2

Risco: **baixo**. Nada na pipeline consome o resultado do score, e `tribeCurve()`
só dispara se `STUDIO_TRIBE_CMD` estiver setado (não está, por padrão).

## Task 0.1 — `lib/score.js`

**0.1a** — Cabeçalho, linhas 1–11. Substituir o bloco "Two tiers" por descrição
de camada única:

```js
// score.js — curva de atenção local.
//
// Heurística totalmente local a partir de sinais mensuráveis: energia de áudio
// (RMS por segundo), mudança visual (scene-diff por segundo) e densidade de
// fala. Não é modelo de resposta cerebral — é um detector de primeira passada
// ("onde isto fica plano?"), honesto sobre o que é.
```

**0.1b** — Linha 13: `const { spawn, execFile } = require('child_process');`
→ `const { execFile } = require('child_process');`
(`spawn` era usado **só** por `tribeCurve`, linha 199.)

**0.1c** — Linha 171, dentro do objeto retornado por `proxyCurve()`. Trocar:
```js
    note: 'Built-in attention PROXY (audio energy + cut density + speech density). ' +
          'Not the brain model — install TRIBE v2 yourself for brain-response scoring.',
```
por:
```js
    note: 'Curva de atenção local (energia de áudio + densidade de cortes + densidade de fala).',
```

**0.1d** — Remover integralmente o bloco das linhas 181–194: o comentário
`// TRIBE v2 hook: …` (3 linhas) e a const `TRIBE_INFO` inteira.

**0.1e** — Remover integralmente `async function tribeCurve(file)` (linhas 195–209).

**0.1f** — Simplificar `score()` (linhas 211–216). Trocar:
```js
async function score(file, opts = {}) {
  const tribe = await tribeCurve(file);
  if (tribe) return tribe;
  const proxy = await proxyCurve(file, opts);
  proxy.tribe = TRIBE_INFO;
  return proxy;
}
```
por:
```js
async function score(file, opts = {}) {
  return proxyCurve(file, opts);
}
```

**0.1g** — Linha 218: `module.exports = { score, proxyCurve, TRIBE_INFO };`
→ `module.exports = { score, proxyCurve };`

**Aceite 0.1:**
- `grep -ci tribe lib/score.js` → `0`
- `grep -c "spawn" lib/score.js` → `0`
- `node --check lib/score.js` → exit 0

## Task 0.2 — `server.js`

**0.2a** — Linha 19: `const { score, TRIBE_INFO } = require('./lib/score');`
→ `const { score } = require('./lib/score');`

**0.2b** — Remover as linhas 392–393 (a rota inteira):
```js
    if (req.method === 'GET' && p === '/api/tribe-info')
      return send(res, 200, TRIBE_INFO);
```

**0.2c** — Linha 380, comentário `// Step 6 — score`: a numeração de steps nesse
comentário já não corresponde à UI (5 steps). Trocar por `// Score — curva de
atenção (sem UI; chamável por curl)`.

**Aceite 0.2:**
- `grep -ci tribe server.js` → `0`
- `node --check server.js` → exit 0
- Com o servidor rodando: `curl -s -o /dev/null -w '%{http_code}' localhost:4870/api/tribe-info` → `404`
- `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4870/api/score -d '{"input":"<um mp4 existente>"}'` → `200` (o score continua vivo)

## Task 0.3 — Deletar a pasta `tribe/`

`git rm -r tribe/` (contém `README.md` e `tribe_runner.py`, ambos só
instruções/runner de auto-instalação do TRIBE).

**Aceite:** `test -d tribe && echo EXISTE || echo OK` → `OK`

## Task 0.4 — `LICENSES.md`

- Remover a seção `## 3. TRIBE v2 — a única peça restrita` inteira (linhas 23–31).
- Renumerar `## 4. Fontes e assets` → `## 3. Fontes e assets`.
- Substituir a linha 41 (resumo) por:
  `*Resumo de uma frase: o app e os engines de vídeo/voz/legenda são livres pra vender; o único ponto de atenção é confirmar os termos comerciais do Remotion antes de vender vídeos renderizados em escala.*`

**Aceite:** `grep -ci tribe LICENSES.md` → `0`

## Task 0.5 — `CLAUDE.md`

- Linha 52: reescrever a descrição de `lib/score.js` sem as duas camadas —
  `- \`lib/score.js\` — attention curve: a local heuristic (audio RMS energy, scene-cut density, speech density) smoothed to 1s resolution, with dip detection. No UI surface today; reachable at \`POST /api/score\`.`
- Linha 57: remover o parágrafo **Licensing boundary** inteiro. Ele existe só
  por causa do TRIBE.

**Aceite:** `grep -ci tribe CLAUDE.md` → `0`

## Task 0.6 — `.claude/agents/`

- `executor.md` linha 22: remover o bullet `**Boundary de licenciamento do TRIBE v2**` inteiro.
- `validator.md` linha 21: remover o item `5. **Licenciamento**: …` inteiro.

**Aceite:** `grep -ci tribe .claude/agents/*.md` → `0` em ambos

## Task 0.7 — `README.md`

- Linha 163: remover `· \`GET /api/tribe-info\`` da célula da tabela de rotas.
- Linha 166 (nota sobre o SCORE): remover a menção a `/api/tribe-info`.
- Linha 176: substituir o parágrafo do TRIBE por uma frase sobre o Remotion,
  já que ele passa a ser o único item de licença a confirmar.
- Linha 199: `# curva de atenção (heurística local)`.
- Linha 203: remover a entrada `├── tribe/` da árvore.

**Aceite:** `grep -ci tribe README.md` → `0`

## Aceite geral da Etapa 0

```bash
grep -rci tribe --include=*.js --include=*.md --include=*.html . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=docs | grep -v ':0$'
```
→ nenhuma saída (só `docs/plans/` pode citar, é histórico).
`node --check server.js && node --check lib/score.js` → exit 0.

---

# ETAPA 1 — Infra para servir código React compilado

Nenhuma mudança de comportamento visível ao usuário. Só habilita a Etapa 2.

## Task 1.1 — HTTP Range em `serveFile` (`server.js:112-124`)

**Por que é obrigatório e não "nice to have":** `serveFile` anuncia
`Accept-Ranges: bytes` mas ignora `req.headers.range` e sempre responde 200 com
o arquivo inteiro. O `<video>` atual tolera porque só toca linearmente; o
Remotion Player faz seek frame-accurate, e sem 206 cada seek re-baixa o MP4
desde o byte 0. Em arquivo de 200 MB isso torna o Player inutilizável.

`serveFile` passa a aceitar `req` e, quando houver `Range: bytes=A-B` válido,
responder `206` com `Content-Range: bytes A-B/size`, `Content-Length: B-A+1` e
`fs.createReadStream(file, { start: A, end: B })`. Range inválido ou fora do
arquivo → `416` com `Content-Range: bytes */size`. Sem header Range → o
comportamento 200 atual, byte a byte idêntico.

Atualizar as 2 chamadas existentes (`/` e `/files/`) para passar `req`.

**Aceite 1.1:**
- `curl -s -o /dev/null -w '%{http_code}' -r 0-99 'localhost:4870/files/<mp4>'` → `206`
- `curl -sI -r 0-99 'localhost:4870/files/<mp4>' | grep -i content-range` → `bytes 0-99/<size>`
- `curl -s -o /dev/null -w '%{http_code}' 'localhost:4870/files/<mp4>'` → `200` (sem regressão)
- `curl -s -o /dev/null -w '%{http_code}' -r 999999999- 'localhost:4870/files/<mp4>'` → `416`

## Task 1.2 — Rota estática `/vendor/` (`server.js`)

Logo depois da rota de `/files/`, adicionar:

```js
    // Bundle do Player (artefato buildado em remotion/, commitado em public/vendor/).
    // Allowlist por regex — não passa por resolveInput()/insideRoot().
    const mVendor = /^\/vendor\/([A-Za-z0-9._-]+\.js)$/.exec(p);
    if (req.method === 'GET' && mVendor) {
      const abs = path.resolve(VENDOR_DIR, mVendor[1]);
      if (!abs.startsWith(VENDOR_DIR + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(req, res, abs);
    }
```

com `const VENDOR_DIR = path.join(ROOT, 'public', 'vendor');` junto das outras
constantes de diretório no topo.

A regex já exclui traversal (o nome não pode conter `/`, então `..` nunca forma
um segmento); o `startsWith` é cinto e suspensório.

> ⚠️ **Correção (descoberta na execução):** uma versão anterior deste plano usava
> `insideRoot()` aqui. Está **errado** — `insideRoot()` é "dentro de um diretório
> de **mídia**" (`jobs/`, `output/`, `luts/`), não "dentro do repo", então ele
> rejeita `public/vendor/` e a rota devolve 403 para o arquivo legítimo.

**Aceite 1.2:**
- `curl -s -o /dev/null -w '%{http_code}' localhost:4870/vendor/studio-player.js` → `200` depois da Task 1.4 (antes dela, `404`)
- `curl -s -o /dev/null -w '%{http_code}' 'localhost:4870/vendor/../../.env'` → `404` (a regex não casa)
- `curl -sI localhost:4870/vendor/studio-player.js | grep -i content-type` → `text/javascript`

## Task 1.3 — `remotion/package.json`

Adicionar dependência `@remotion/player` (mesma major do `remotion`, `^4.0.0`),
devDependency `esbuild` (`^0.23.0`), e o script:

```json
"build:player": "esbuild src/player-entry.tsx --bundle --format=iife --platform=browser --target=es2020 --outfile=../public/vendor/studio-player.js --define:process.env.NODE_ENV=\\\"production\\\" --minify"
```

Isso **não** viola a restrição de zero-npm: `remotion/` já é projeto npm e já
exigia `npm install` para o passo VISUALS.

**Aceite:** `cd remotion && npm install && npm run build:player` produz
`public/vendor/studio-player.js`; `node --check public/vendor/studio-player.js` → exit 0.

## Task 1.4 — `remotion/src/player-entry.tsx` (novo)

Entry point que embrulha o Player numa API imperativa que JS puro consegue
chamar. Sem isso, `public/index.html` precisaria de JSX.

Exporta em `window.StudioPlayer`:

| Método | Contrato |
|---|---|
| `mount(el, props)` | cria root React em `el`, renderiza `<Player>`; idempotente |
| `update(props)` | re-renderiza com novos props (timeline editada) |
| `seek(seconds)` | posiciona o playhead |
| `play()` / `pause()` | transporte |
| `getTime()` | segundos atuais (o `compositeTick` atual lê isso) |
| `on(ev, cb)` | `'timeupdate'`, `'play'`, `'pause'`, `'ended'` |
| `unmount()` | desmonta e libera |

`<Player>` é montado com `compositionWidth={1080}`, `compositionHeight={1920}`,
`fps={30}`, `controls={false}` — o transporte é a toolbar que já existe na
TIMELINE, não a do Player.

> ⚠️ **Correção (descoberta na execução):** uma versão anterior deste plano
> mandava montar `component={TimelinePreview}` já aqui. É referência adiante:
> `TimelinePreview.tsx` só nasce na Task 2.1, então a Etapa 1 não conseguiria
> buildar. A Etapa 1 monta um placeholder (`PreviewStub`, no próprio
> `player-entry.tsx`) e a Task 2.1 troca o import e apaga o stub. O tipo
> `TimelineProps` já é o definitivo, então nada além do import muda.

**Aceite:** depois do build, `grep -c "StudioPlayer" public/vendor/studio-player.js` → ≥ 1.

## Task 1.5 — `.gitignore`

O bundle é **commitado** (constraint 2). Garantir que nenhuma regra existente o
ignore; se `public/vendor/` casar com algo, adicionar `!public/vendor/studio-player.js`.

**Aceite:** `git check-ignore -v public/vendor/studio-player.js` → sem saída.

---

# ETAPA 2 — Trocar o compositor canvas pelo Player

## Contexto do que está sendo substituído

O player atual é `public/index.html:1515` (`<video id="bt-video">` +
`<canvas id="bt-canvas">`) dirigido por `compositeTick()` (linhas ~1947–1988),
que a cada frame: avança o playhead, escolhe o B-ROLL ativo, desenha no canvas
com `drawImage`, e sincroniza os `<audio>` da TRILHA por `currentTime`.

**Limitações que o Player resolve:** sincronia de áudio feita à mão com
tolerância de 150 ms; B-ROLL e TRILHA como elementos DOM avulsos; nenhum
controle de volume ao longo do tempo.

**O que ele NÃO resolve, e precisa continuar valendo:** o preview usa o decoder
do browser. `.mov` HEVC continua sem decodificar — **o aviso
`#bt-preview-error` (linhas 1518–1522) tem que sobreviver**, apontando para o
Player agora.

## Task 2.1 — `remotion/src/scenes/TimelinePreview.tsx` (novo)

Composição que espelha o sidecar `.beats.json` v3. Ao criá-la, trocar em
`player-entry.tsx` o `component={PreviewStub}` por `component={TimelinePreview}`
(import de `./scenes/TimelinePreview`) e **apagar o `PreviewStub`** — ele existe
só para a Etapa 1 poder buildar. Os tipos `Segment`/`Clip`/`Word`/`TimelineProps`
já estão em `player-entry.tsx` e devem ser reaproveitados, não redefinidos.
Rebuildar o bundle (`npm run build:player`) e commitar o artefato novo.

Props (já declaradas como `TimelineProps`):

```ts
type Props = {
  src: string;                                  // /files/<video base>
  segments: { srcIn: number; dur: number }[];   // track VÍDEO, em ordem
  broll:   { path: string; start: number; dur: number; srcIn?: number }[];
  music:   { path: string; start: number; dur: number; srcIn?: number; volume: number }[];
  words:   { word: string; start: number; end: number }[] | null;
  hidden:  { broll?: boolean; music?: boolean; legend?: boolean };
  trilhaMuted: boolean;
};
```

Estrutura de render:

1. **VÍDEO** — `<Series>` com um `<Series.Sequence durationInFrames={dur*30}>`
   por segmento, cada um com `<Video src={src} startFrom={srcIn*30} />`.
   É isto que dá o ripple: a duração total é a soma dos segmentos.
2. **B-ROLL** — um `<Sequence from={start*30} durationInFrames={dur*30}>` por
   clipe, com `<Video src={path} startFrom={srcIn*30} muted />`.
   **`muted` é obrigatório** — espelha `lib/timeline.js`, que descarta o áudio
   de B-ROLL de propósito. Preview e export têm que soar igual.
3. **TRILHA** — `<Sequence>` + `<Audio src={path} volume={volume} startFrom={srcIn*30} />`.
4. **LEGENDA** — as `words` desenhadas como texto, respeitando `hidden.legend`.
   Nesta etapa é **paridade visual com o overlay atual** (`#bt-cap-overlay`),
   sem estilo karaokê novo — isso é a Etapa 3.

Regras:
- Usar `<Video>` (não `<OffthreadVideo>`, que é para render CLI).
- `hidden.broll`/`hidden.music` fazem a track sumir, igual hoje.
- `trilhaMuted` zera o volume da TRILHA sem removê-la.

**Aceite 2.1:** `cd remotion && npx tsc --noEmit` → exit 0.

## Task 2.2 — `public/index.html`: carregar o bundle com fallback

No `<head>` ou antes do `<script>` principal:
```html
<script src="/vendor/studio-player.js" onerror="window.__playerBundleFailed=1"></script>
```

No módulo da TIMELINE, uma única constante decide a rota:
```js
const USE_RPLAYER = !window.__playerBundleFailed && typeof window.StudioPlayer === 'object';
```

**Aceite:** com `public/vendor/studio-player.js` renomeado, abrir a TIMELINE →
preview funciona pelo canvas, console sem erro. Restaurando o arquivo → Player.

## Task 2.3 — `public/index.html`: montagem e transporte

- Em `buildTimeline()` (onde hoje o markup de `.bt-video-wrap` é criado, ~1515):
  se `USE_RPLAYER`, renderizar `<div id="bt-player"></div>` no lugar de
  `<video>`+`<canvas>` e chamar `StudioPlayer.mount($q('#bt-player'), props)`.
  Senão, o markup atual, inalterado.
- `compositeTick()` ganha guarda no topo: `if (USE_RPLAYER) return;` — o
  `requestAnimationFrame` deixa de rodar quando o Player está ativo.
  **Não apagar a função** (é o fallback).
- O playhead da régua passa a ser alimentado por `StudioPlayer.on('timeupdate', …)`
  em vez de `advancePlayhead()`.
- Transporte: `togglePlay`, `seekTo`, `frameStep`, `shuttleForward/Reverse/Stop`
  passam a chamar `StudioPlayer.play/pause/seek` quando `USE_RPLAYER`.
  Os atalhos (`J/K/L`, espaço, `,`/`.`, `Home`/`End`) **não mudam de tecla**.
- Toda edição que hoje redesenha o canvas (split, merge, delete com ripple,
  trim, add/remove B-ROLL ou TRILHA, toggles de hide/lock) passa a chamar
  `StudioPlayer.update(props)` com o estado novo.

**Aceite 2.3 (inspeção manual, roteiro fixo):**
1. Abrir TIMELINE com um MP4 H.264 → o preview mostra o frame do playhead.
2. Espaço toca com áudio; `J/K/L` faz shuttle; `,`/`.` anda 1 frame.
3. Deletar um segmento da track VÍDEO → a duração total encurta **e** o preview
   reflete o ripple sem reload.
4. Adicionar um B-ROLL → aparece na janela dele, **sem** áudio próprio.
5. Adicionar uma TRILHA com volume 0.3 → toca sob a voz; botão mute silencia.
6. `SALVAR BEATS` → `CONFORMAR → EXPORT` → o mezanino bate com o que a preview
   mostrou (mesmos cortes, mesmo B-ROLL, mesma trilha).
7. Abrir um `.mov` HEVC → o aviso `#bt-preview-error` aparece; a timeline e o
   conform continuam funcionando.

## Task 2.4 — Atualizar `CLAUDE.md` e `README.md`

- `CLAUDE.md`: registrar que `remotion/` agora produz **dois** artefatos (render
  CLI via `npx remotion render` **e** o bundle do Player), que o bundle é
  commitado, e que o Player é preview — `lib/timeline.js` segue como único
  caminho de export.
- `README.md`: seção TIMELINE menciona o Player e o fallback; seção de engines
  ganha nota de que `npm run build:player` só é necessário para **alterar** o
  player, não para usar o app.

**Aceite:** `grep -c "studio-player" CLAUDE.md README.md` → ≥ 1 em cada.

---

# Roadmap — Etapas 3 a 5 (NÃO executáveis ainda)

> ⚠️ **Executor: não implemente nada abaixo desta linha.** Estas seções não têm
> lista de arquivos nem critérios de aceite. Cada uma precisa virar seu próprio
> `docs/plans/<slug>.md` aprovado antes de execução.

## Etapa 3 — Legendas karaokê com highlight semântico

Itens 1, 2, 5 e 8 do roadmap de origem.

**A decisão de arquitetura que falta:** `lib/encode.js:90-112` queima a legenda
no passo 6, **depois** da LUT, porque (a) a LUT não deve gradar texto e (b)
libass é 8-bit-only e só roda depois do dither. Se as legendas forem
renderizadas pelo Remotion **queimadas no plate**, elas entram no passo 2 e a
LUT grada o texto — o `#FF5200` vira outra cor conforme a LUT escolhida.

Duas rotas, mutuamente exclusivas:

- **Rota A (recomendada) — ASS continua a fonte de verdade.** Estender
  `lib/captions.js`: ASS já suporta `\c&HBBGGRR&` (cor por palavra), `\i1`
  (itálico), `\t(\fscx…\fscy…)` (pop/scale-in), `\bord`/`\shad`. Cobre todos os
  tokens da tabela do documento de origem menos o easing *spring*, que vira
  ease-out aproximado. Zero dependência nova, zero mudança no filtergraph, o
  laranja sai ungraded. O `TimelinePreview.tsx` (Etapa 2) passa a ler os mesmos
  tokens de um `styles.json` único, para preview e export não divergirem.
- **Rota B — Remotion renderiza a legenda.** Só é segura se render for para
  **asset com canal alpha** (ProRes 4444) e o EXPORT fizer `overlay` **depois**
  do passo 5. Custa um passo de render a mais e um ramo novo no filtergraph.

**Risco transversal das duas rotas:** o preview (React) e o export (libass) são
renderizadores diferentes. Divergência de fonte/kerning/quebra de linha é
esperada e precisa de critério de aceite explícito de quanto desvio é tolerável.

## Etapa 4 — Áudio determinístico

- **Ducking (item 6):** o lugar é `lib/timeline.js`, que já mixa TRILHA com
  `amix … normalize=0`. `sidechaincompress` entra nesse grafo — **não** como
  "passo antes do encode final", como dizia o documento de origem.
- **Loudness −14 LUFS (item 7):** `lib/encode.js:123` não tem `-af` nenhum.
  `loudnorm` preciso exige 2-pass (medir, depois aplicar). E `validate()` tem
  check de `audio aac` mas nenhum de loudness — o plano dessa etapa precisa
  decidir se adiciona um.

## Etapa 5 — QA

**Item 9 (gate de VMAF com legendas queimadas) precisa ser reformulado.**
`lib/encode.js:205-211` monta o `refFilter` aplicando grade + legenda **também
na referência**, de propósito, para isolar dano de compressão. Logo o texto é
idêntico nos dois ramos e a métrica atual **não consegue** detectar blocking
causado pelo texto. Medir o que o item quer exige uma segunda medição com
desenho diferente (referência sem legenda, ou métrica localizada na região do
texto) — decisão de design, não adição pequena.

---

# Backlog — HyperFrames

Adiado por decisão do usuário. **Bloqueado em due diligence**, não em esforço.
Antes de qualquer `hyperframes/`, responder:

1. **Distribuição.** É CLI local, biblioteca, ou serviço hospedado da HeyGen?
   Se for serviço hospedado, viola a premissa central do app ("$0 por uso, nada
   sobe pra nuvem") e a Fase C inteira precisa ser repensada.
2. **Licença.** Comercial? O repo tem disciplina explícita disso (`LICENSES.md`).
3. **Dependência real.** O documento de origem promete "camada determinística
   (CLI/HTML/ffmpeg)" sem npm, mas renderizar HTML→MP4 exige browser headless —
   o próprio documento nota que o Remotion usa Puppeteer. Evitar bundling de
   React não torna a dependência leve.

Quando essas três tiverem resposta: o probe vai em **`lib/deps.js`** (não em
`clipper/check-deps.js`), seguindo o padrão de todo engine — probe, fail soft,
hint de instalação acionável.

---

## Status

_(propriedade do Executor)_

### Etapa 0 — executada em 2026-09-12 ✅

Tasks 0.1 a 0.7 aplicadas literalmente conforme o plano. Etapas 1 e 2 **não**
foram iniciadas.

- **0.1 `lib/score.js`** — cabeçalho reescrito; `spawn` removido do require
  (`execFile` fica); `note` do `proxyCurve()` trocado; `TRIBE_INFO` e
  `tribeCurve()` removidos por inteiro; `score()` virou um passthrough para
  `proxyCurve()`; exports reduzidos a `{ score, proxyCurve }`.
- **0.2 `server.js`** — require sem `TRIBE_INFO`; rota `GET /api/tribe-info`
  removida; comentário `// Step 6 — score` atualizado.
- **0.3** — `tribe/` removida via `git rm -r` (2 arquivos, 206 linhas).
- **0.4 `LICENSES.md`** — seção 3 (TRIBE) removida, seção 4 renumerada para 3,
  linha de resumo reescrita apontando o Remotion como único ponto de atenção.
- **0.5 `CLAUDE.md`** — descrição de `lib/score.js` reescrita sem as duas
  camadas; parágrafo **Licensing boundary** removido.
- **0.6 `.claude/agents/`** — bullet do TRIBE removido do `executor.md`; item 5
  (Licenciamento) removido do `validator.md`.
- **0.7 `README.md`** — 5 pontos: célula da tabela de rotas, nota sobre o SCORE,
  parágrafo de licenciamento, comentário do `score.js` na árvore, e a entrada
  `tribe/` da árvore.

**Aceite verificado (saída real, não afirmação):**

| Critério | Resultado |
|---|---|
| `grep -ci tribe lib/score.js` | `0` |
| `grep -c spawn lib/score.js` | `0` |
| `grep -ci tribe server.js` | `0` |
| `node --check lib/score.js && node --check server.js` | exit 0 |
| `test -d tribe` | não existe |
| `grep -ci tribe` em `LICENSES.md` / `CLAUDE.md` / `README.md` / `executor.md` / `validator.md` | `0` em todos |
| grep global (fora de `docs/`) | nenhuma ocorrência |
| `GET /api/tribe-info` | `404` |
| `GET /` · `GET /api/deps` | `200` · `200` (app vivo) |
| `POST /api/score` | `200`, devolve `{"job":"…"}` — a rota sobreviveu |
| `require('./lib/score')` | exports `score, proxyCurve`; `TRIBE_INFO === undefined` |

`git diff --stat`: exatamente os 7 arquivos do plano + os 2 deletados.

**Desvio / limitação de verificação:** o critério do plano pedia
`POST /api/score` com um MP4 real. **Não há ffmpeg/ffprobe neste container e o
repo não tem mídia de teste**, então o score não foi exercitado ponta a ponta —
`proxyCurve()` depende de `mediaInfo()`. O que foi verificado é que a rota
responde 200 criando job e que o módulo exporta `score` como função sem
referência a `TRIBE_INFO` (que era o risco real da remoção: `ReferenceError` no
require ou no handler). A aritmética de `proxyCurve()` não foi tocada pelo diff.

**Assunção do plano mantida:** `proxyCurve()` e `POST /api/score` seguem vivos.
O usuário aprovou a Etapa 0 sem derrubar essa assunção.

### Etapa 1 — executada em 2026-09-12 ✅

Tasks 1.1 a 1.5 aplicadas. Etapa 2 **não** foi iniciada.

- **1.1 `serveFile`** — ganhou `req` como primeiro parâmetro e um helper
  `parseRange()`. Responde `206` + `Content-Range` para `bytes=A-B`, `bytes=-N`
  (sufixo) e `bytes=A-` (aberto); `416` + `Content-Range: bytes */size` para
  range fora do arquivo; e o caminho `200` de antes, inalterado, quando não há
  header `Range` ou ele é multi-range/malformado. As 3 chamadas existentes
  passaram a receber `req`.
- **1.2 rota `/vendor/`** — allowlist `^\/vendor\/([A-Za-z0-9._-]+\.js)$` mais
  `VENDOR_DIR` novo no topo do arquivo.
- **1.3 `remotion/package.json`** — `@remotion/player`, `esbuild`,
  `@types/react-dom` e o script `build:player`.
- **1.4 `remotion/src/player-entry.tsx`** — novo; expõe `window.StudioPlayer`
  com `mount/update/seek/play/pause/getTime/isPlaying/on/unmount`.
- **1.5 `.gitignore`** — nenhuma mudança necessária: `git check-ignore` confirma
  que o bundle não casa com regra alguma.

**Aceite verificado (saída real):**

| Critério | Resultado |
|---|---|
| `Range: bytes=0-99` | `206`, `Content-Range: bytes 0-99/100000`, `Content-Length: 100` |
| `Range: bytes=-500` | `206`, `bytes 99500-99999/100000` |
| `Range: bytes=99990-` | `206`, `bytes 99990-99999/100000` |
| `Range: bytes=999999999-` | `416`, `bytes */100000` |
| sem `Range` | `200`, `Content-Length: 100000` (sem regressão) |
| bytes do range conferem | `bytes=10-19` devolve os 10 bytes certos |
| `GET /vendor/studio-player.js` | `200`, `text/javascript`, idêntico ao disco (`cmp`) |
| `Range` no bundle | `206` |
| traversal: `../../.env`, `../server.js`, `..%2f..%2f.env`, `sub/dir.js`, `.env`, `.js.map` | `404` em todos (a regex não casa) |
| arquivo inexistente em `/vendor/` | `404` |
| `npx tsc --noEmit` | exit 0 |
| `npm run build:player` | 402.5 kb; `node --check` passa; `window.StudioPlayer` presente; React em modo production |
| não-regressão: `/`, `/index.html`, `/api/deps`, `/api/luts`, `/api/voices`, `/files/…`, `POST /api/score` | `200` em todos |
| `/files/../.env` | `404` (path-safety intacta) |
| `GET /` byte-a-byte | 154813 = tamanho de `public/index.html` |

**Desvios em relação ao plano como estava escrito (os dois viraram correção no
texto do plano, acima):**

1. **`insideRoot()` na Task 1.2 era o predicado errado.** Ele significa "dentro
   de um diretório de mídia" (`jobs/`/`output/`/`luts/`), não "dentro do repo" —
   a rota devolvia `403` para o bundle legítimo. Trocado por `VENDOR_DIR` +
   `startsWith`. Pego em teste, não em leitura.
2. **Task 1.4 tinha referência adiante.** Mandava montar
   `component={TimelinePreview}`, arquivo que só nasce na Task 2.1 — a Etapa 1
   não buildaria. Resolvido com o placeholder `PreviewStub`, que a Task 2.1
   apaga.

**Outros desvios menores:**

3. **Versões do Remotion pinadas em `4.0.494` exato** (eram `^4.0.0`). O
   lockfile já resolvia `remotion`/`@remotion/cli` nessa versão, e o Remotion
   exige que todos os `@remotion/*` estejam na **mesma** versão — com caret, um
   `npm install` futuro poderia trazer `@remotion/player` numa versão diferente
   e quebrar em runtime. `react`/`react-dom` seguem em caret.
4. **`esbuild` em `^0.28.0`**, não `^0.23.0` como o plano dizia — `0.23` foi
   chute meu escrito sem consultar o registry; `0.28.2` é a estável atual.
5. **`@types/react-dom` adicionado** — `createRoot` vem de `react-dom/client` e
   o `tsc --noEmit` não passa sem os tipos.

**Limitação de verificação:** o Player não foi exercitado num browser — este
container não tem display, e a montagem real só acontece na Etapa 2, quando
`public/index.html` passa a carregar o bundle. O que está provado aqui é que o
bundle compila, carrega como script clássico, define `window.StudioPlayer` e é
servido corretamente. Comportamento visual do Player é aceite da Etapa 2.
