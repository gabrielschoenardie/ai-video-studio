# Design — Mixagem de áudio da TIMELINE (sub-projeto B)

**Data:** 2026-09-21
**Origem:** sub-projeto B da decomposição em `docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md` (seção "Decomposição"): R5 (trilha de SFX), M/S em ÁUDIO/SFX, solo exclusivo e a decisão preview × export. O texto original do R5 e do R4 vem de `ui-premium-upgrade.md` (plano do usuário, não versionado).
**Arquivos-alvo:** `lib/timeline.js`, `lib/ffmpeg.js` (um campo a mais no `mediaInfo`), `server.js`, `public/index.html`, `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`, `public/vendor/studio-player.js` (bundle, regenerado), `public/dev/ui-probe.js`.
**Base:** `main` em `c3c8012`. Todo número de linha citado aqui se refere a esse commit.
**Revisão R1 (2026-09-21, ao escrever o plano):** o código das quatro etapas foi escrito e testado numa cópia do repo antes do plano: o conform com mídia sintética e servidor numa porta de teste, a UI no navegador numa porta separada. Os testes acrescentaram dois achados e duas decisões: o mono da TRILHA/SFX sai 3 dB mais baixo no export (decisão 13) e o Player funde clipes idênticos empilhados (decisão 14). Também confirmaram o limite de áudio do Player. A mensagem do CONFORMAR ganhou um formato único ("fora do export: …"). As seções abaixo já refletem a revisão.

---

## Contexto e problema

A TIMELINE tem uma track de música (`♫ TRILHA`) e nenhum lugar para efeito pontual (whoosh, impacto, riser): hoje ele precisa ser colado na TRILHA, sem mudo nem solo próprios. Os controles de áudio que existem são só de preview: o conform recebe a TRILHA inteira, então o arquivo exportado não soa como o que o usuário ouviu com um mudo ou solo ligado.

O B acrescenta a track SFX e transforma M/S em controles de mixagem de verdade: o que o preview toca é o que o conform entrega.

---

## Achados no código (`c3c8012`)

| Achado | Onde | Consequência para o B |
|---|---|---|
| O R5 original pedia `sfx: [{src, in, out, at, gain}]` num "sidecar v2" | Sidecar é **v3** (`server.js:291-294`); TRILHA grava `{path, name, start, dur, srcIn, volume}` (`index.html:1777`) | SFX usa o formato da TRILHA. Conform, Player, undo e clipboard reaproveitam o caminho da TRILHA. |
| Solo da TRILHA só silencia o plate | `index.html:3394` (`video.muted = trilhaSolo`), `TimelinePreview.tsx:59` | Com três tracks de áudio, solo precisa silenciar ÁUDIO **e** SFX. |
| H na ÁUDIO não afeta o som | `hiddenTracks.audio` só vira classe de linha (`index.html:2491`); nenhum consumidor de áudio lê | Resolvido tirando H das tracks de áudio (decisão 2). |
| H na TRILHA silencia a música | `index.html:1384-1385`, `:2403` | H vira um segundo mudo; resolvido pela decisão 2. |
| **Bug (rota canvas):** um `<audio>` por **arquivo**, não por clipe | `getMusicAudioEl(path)` (`index.html:2341-2352`) + laço `MUSIC.forEach` (`:2400-2413`) | Dois clipes do mesmo arquivo (split, duplicar, colar) disputam o elemento: o que está fora da janela pausa o que está dentro. Na primeira metade de um split, a música para. SFX reusa o mesmo arquivo o tempo todo. |
| **Bug (rota Player):** slider de ganho não chega ao Player | `input` só grava `MUSIC[i].volume`; `change` só faz `snapshot()` (`index.html:2188-2192`); `syncPlayer()` só roda em `renderTracks()` (`:2541`) e no clique dos controles (`:3398`) | Arrastar o ganho não muda o que se ouve até o próximo render. A rota canvas lê `c.volume` por frame e não tem o problema. |
| Ramos binários `broll` × "resto é música" | `clipsFor` (`:2117`), `renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music')` (`:3115`, `:3140`, `:3187`), popover (`:2304`) | Uma track `sfx` cairia no host e no array da TRILHA. Os ramos precisam de mapa explícito. |
| **Player limita `<Audio>` simultâneos a 5** | `@remotion/player` 4.0.494, `numberOfSharedAudioTags = 5`; o sexto `registerAudio` lança `Tried to simultaneously mount 6 <Html5Audio /> tags` (`remotion/dist/cjs/audio/shared-audio-tags.js:350`) | O erro derruba o preview inteiro (`errorFallback` padrão `⚠️`). Com SFX empilhado, seis áudios ao mesmo tempo é fácil. **Confirmado no brainstorm:** um bundle de teste com o limite em 2 e três áudios distintos sobrepostos mostrou `⚠️` no lugar do preview, sem play, só com o seek. |
| **Player funde `<Audio>` idênticos** | O id de cada áudio é `src` + `relativeFrom` + `cumulatedFrom` + `durationInFrames` (`remotion/dist/cjs/audio/AudioForPreview.js`, `const id`); `registerAudio` devolve o registro existente quando o id se repete | Dois clipes idênticos empilhados (Ctrl+V duas vezes no mesmo ponto) tocam **uma** vez no preview, e o export soma os dois (+6 dB). Resolvido com um fragmento por clipe na URL (decisão 14): testado no brainstorm, dois clipes idênticos com `#x0`/`#x1` ocuparam duas tags. |
| Mixagem soma sem teto | `amix … normalize=0` (`lib/timeline.js:152-154`); Export passa o áudio direto para AAC sem loudnorm nem limitador (`lib/encode.js:123`) | Acima de 0 dBFS a distorção chega ao Instagram. Resolvido medindo e avisando (decisão 3). |
| **Bug (export): mono sai 3 dB mais baixo** | `aformat=…:channel_layouts=stereo` na cadeia da TRILHA (`lib/timeline.js:149`): o ffmpeg converte mono em estéreo com `center_mix_level` de −3 dB, e o navegador toca mono nos dois canais sem atenuar | Medido no brainstorm: um tom mono de pico −18 dBFS saiu com RMS de −24,1 dB por canal no conform, onde o esperado era −21. Hoje afeta toda TRILHA mono; na SFX, arquivo mono é o comum. Resolvido na decisão 13. O plate não tem o problema: `lib/assemble.js:84` grava estéreo (`-ac 2`) e o preview toca esse mesmo arquivo. |

---

## Decisões tomadas no brainstorm

| # | Questão | Decisão |
|---|---|---|
| 1 | Preview × export | **Export = preview.** M e S vão para o sidecar e o conform aplica. A mensagem do CONFORMAR lista o que ficou de fora. |
| 2 | H nas tracks de áudio | **Removido.** ÁUDIO, TRILHA e SFX ficam com M, S e L (+ `+` em TRILHA/SFX). H continua em MARKERS, B-ROLL e LEGENDA, só de preview. |
| 3 | Picos acima de 0 dBFS | **Medir e avisar.** O conform mede o pico do arquivo pronto e avisa; nada é processado. |
| 4 | Corte em PRs | **B0 → B1 → B2 → B3**: bugs da TRILHA → servidor → lane SFX → controles de áudio. |
| 5 | Solo | Exclusivo (decisão herdada do R4 original): ligar um solo desliga os outros. **Mudo vence solo.** |
| 6 | `MIX` e undo | `MIX` entra no "não salvo" (`timelineState()`), **não** no histórico: Ctrl+Z desfaz edição, não chave de monitoração. `SFX` entra no histórico. |
| 7 | Formato da SFX | O da TRILHA: `{path, name, start, dur, srcIn, volume}`, sobreposição permitida, sem crossfade. |
| 8 | Duração padrão de um efeito novo | A do arquivo (`asset.info.duration`), limitada ao fim da timeline; 3s se desconhecida. A TRILHA não muda. |
| 9 | Prop do Player | `audible: {audio, music, sfx}` já no B2; o bundle muda uma vez só. |
| 10 | Limite de áudio do Player | `numberOfSharedAudioTags={16}`; acima de 16 simultâneos o preview toca 16 e avisa. |
| 11 | Aparência da SFX | Token `--sfx:#22d3ee`, ícone `≈`, clipe idêntico ao da TRILHA mudando a cor; nome do clipe em 9,5px com a mesma isenção da TRILHA. |
| 12 | Lane que não vai soar | Classe `.silent`: opacidade 0,45, **continua editável**. |
| 13 | Mono na TRILHA e na SFX (achado dos testes, segue a decisão 1) | O conform duplica o mono nos dois canais (`pan=stereo\|c0=c0\|c1=c0`) antes do `aformat`, como o navegador faz. `mediaInfo` ganha `channels`, e `probeClips` guarda esse valor no clipe. **Muda o export de projetos que já têm TRILHA mono: +3 dB, agora igual ao preview.** |
| 14 | Clipes idênticos empilhados no Player (achado dos testes) | `playerProps()` acrescenta à URL de cada clipe de TRILHA/SFX um fragmento `#<track><índice>`. O fragmento separa os ids do Remotion; o navegador não o envia ao servidor e o elemento de mídia o ignora. |

---

## Objetivo

- Uma track SFX abaixo da TRILHA, com clipes curtos, sobreponíveis, com ganho por clipe e as mesmas edições da TRILHA.
- Mudo e solo em ÁUDIO, TRILHA e SFX, com o mesmo efeito no preview e no arquivo exportado.
- O usuário sabe, ao conformar, o que ficou fora do export e se a mixagem vai distorcer.
- Os dois bugs de preview da TRILHA corrigidos, porque a SFX depende do mesmo código.

**Fora de escopo (deliberado):** normalização LUFS e limitador; ganho acima de 1 e slider de volume na ÁUDIO; fades e crossfades; H de B-ROLL/LEGENDA valer no export; atalhos de teclado para M/S; Pointer Events; sub-projetos C e D.

---

## Modelo de dados

**Estado novo no app** (`public/index.html`, bloco de estado em `:1300-1330`):

```js
let SFX = [];                          // {path, name, start, dur, volume, srcIn} — formato da TRILHA
let MIX = { mute: [], solo: null };    // mute ⊆ ['audio','music','sfx']; solo ∈ {null,'audio','music','sfx'}
```

`MIX` substitui `trilhaMuted` e `trilhaSolo` (B3). Até o B3, `trilhaMuted`/`trilhaSolo`/`hiddenTracks.music` continuam existindo.

**A regra**, com o mesmo texto no app e em `lib/timeline.js`:

```js
audible(track) = !MIX.mute.includes(track) && (MIX.solo === null || MIX.solo === track)
```

`audio` é o som do plate, ou seja, dos segmentos da VÍDEO.

**Sidecar v4** (`POST /api/beats`, `server.js:282-297`):

```js
{ version: 4, video, duration, beats, segments, broll, music,
  sfx: [...],                       // novo — mesmo tratamento de `music`
  mix: { mute: [...], solo: null }, // novo — saneado no servidor
  updatedAt }
```

O servidor saneia `mix`: `mute` vira a interseção deduplicada com `['audio','music','sfx']`; `solo` fora desse conjunto vira `null`. Um `mix` ausente ou inválido vira `{ mute: [], solo: null }`.

**Compatibilidade:** sidecar v3 ou v2 sem `sfx`/`mix` lê como SFX vazia e tudo audível. Nenhum caminho de leitura falha por campo ausente.

**Undo e "não salvo":** `snapshot()` (`:1488-1492`), `timelineState()` (`:1499-1501`) e `applyHistEntry()` (`:1504-1518`) ganham `sfx`. `timelineState()` ganha também `mix`; `snapshot()` não.

---

## Conform — `lib/timeline.js` e `server.js` (B1)

**`server.js`** — `/api/timeline/conform` (`:364-411`): `resolveClips(tl.sfx)` pelo mesmo `resolveInput` de B-ROLL e TRILHA (`:378-384`); `sfx` e `mix` passados ao `conform()` (`:400-406`).

**`lib/timeline.js`:**

1. `normalizeMix(mix)` e `audible(mix, track)`: puras, exportadas.
2. `conform()` aplica a regra **antes** do grafo:
   - `music` e `sfx` não audíveis viram `[]`, então não viram inputs do ffmpeg;
   - `hasAudio = !!info.acodec && audible(mix, 'audio')`. ÁUDIO muda cai no caminho `anullsrc` que já existe (`:124`), e a entrega continua com uma faixa AAC.
3. `buildConformGraph` ganha `sfx = []`. Ordem dos inputs: base, B-ROLL, TRILHA, SFX. Cada clipe de SFX recebe a cadeia da TRILHA (`atrim` → `aformat` → `volume` → `adelay`) com rótulo `[x${k}]`. O `amix` recebe `1 + music.length + sfx.length` entradas, ainda com `normalize=0`. Sem TRILHA nem SFX, continua `anull`. Um clipe com `channels === 1` (TRILHA ou SFX) ganha `pan=stereo|c0=c0|c1=c0` antes do `aformat` (decisão 13). `probeClips` passa a guardar `channels` nos clipes de áudio, vindo do `mediaInfo` (`lib/ffmpeg.js`, campo novo `channels: a.channels || 0`). Sem `channels` no clipe, nada muda: é o que mantém a não-regressão abaixo.
4. `buildConformArgs` acrescenta um `-i` por clipe de SFX, depois dos de TRILHA. O mesmo arquivo em cinco clipes vira cinco `-i`.
5. **Pico:** depois do `runFfmpeg` principal, um segundo ffmpeg lê o arquivo pronto com `astats` (`measure_perchannel=none:measure_overall=Peak_level`, `-f null -`) e extrai o `Peak level dB` geral. Mede o arquivo, porque é ele que o Export recebe. Se falhar, `peakDb: null` e uma linha de log; o conform não falha por isso.
6. Retorno ganha:
   - `sfx` (contagem de clipes usados);
   - `peakDb`;
   - `peakWarn`: `'clip'` se `peakDb > 0`, `'hot'` se `-1 ≤ peakDb ≤ 0`, senão `null`;
   - `excluded`: as tracks que tinham conteúdo e o `mix` silenciou. Conteúdo, para `audio`, é o plate ter faixa de áudio; para `music`/`sfx`, ter ao menos um clipe depois da normalização;
   - `mix`: o `mix` normalizado que foi aplicado.
7. Log: `· N TRILHA · M SFX`, mais `· fora do export: …` quando `excluded` não estiver vazio, e uma linha com o pico.

**Não-regressão:** um sidecar sem `sfx` nem `mix` produz `filter` e `args` idênticos, byte a byte, aos do `lib/timeline.js` de `c3c8012` para as mesmas entradas.

---

## Preview — duas rotas (B0 e B2)

### B0: bugs da TRILHA, sem mudar comportamento

1. **Canvas, um `<audio>` por ocorrência.** O elemento de áudio passa a ser indexado por `(path, k)`, onde `k` é a ordem da ocorrência daquele `path` entre os clipes de áudio iterados na passada. O primeiro clipe de `whoosh.wav` usa o elemento 0; o segundo, o 1. Reordenar só troca qual elemento serve qual clipe, e o seek já existente corrige a posição. `pruneMediaCache()` (`:1529`) remove também os elementos com `k` acima do número de ocorrências atual.
2. **Player, slider ao vivo.** O `input` do `.bt-clip-vol` chama `syncPlayer()` depois de gravar o volume.

### B2: SFX nas duas rotas

- **`TimelinePreview.tsx`:** nova prop `sfx: Clip[]`, tocada como a TRILHA. `trilhaMuted`, `trilhaSolo` e `hidden.music` saem, e entra `audible: { audio: boolean; music: boolean; sfx: boolean }`. O plate usa `muted={!audible.audio}`; TRILHA e SFX **não montam** `<Audio>` quando a track não é audível. `hidden.broll` continua.
- **`player-entry.tsx`:** `numberOfSharedAudioTags={16}` no `<Player>`; `EMPTY_TIMELINE` com `sfx: []` e `audible` todo `true`.
- **`playerProps()`** (`index.html:1379-1388`) calcula `audible` e envia `sfx`. No B2, antes do `MIX`:
  - `audio = !trilhaSolo`
  - `music = !trilhaMuted && !hiddenTracks.music`
  - `sfx = !trilhaSolo`
- **Um fragmento por clipe (decisão 14):** a URL de cada clipe de TRILHA/SFX enviada ao Player termina em `#<track><índice>` (`#music0`, `#sfx3`).
- **Teto de 16:** `playerProps()` percorre os clipes audíveis de TRILHA e SFX em ordem de entrada e descarta cada clipe cuja entrada faria a sobreposição passar de 16 no mesmo instante. A conta é em frames (30 fps), arredondados como a composição arredonda. Quando o conjunto descartado não está vazio e é diferente do da chamada anterior, `stage()` avisa: "mais de 16 áudios simultâneos: o preview toca 16, o export toca todos". Repetir a mesma situação não repete o aviso.
- **Rota canvas:** SFX entra no mesmo laço da TRILHA com os elementos por ocorrência do B0; o plate recebe `video.muted = !audible.audio`.
- **Volume** de 0 a 1 nas duas rotas, como a TRILHA: é o teto do `HTMLMediaElement`, e o conform já limita a `[0, 1]` (`lib/timeline.js:72`).
- **Bundle:** `cd remotion && npm run build:player`; `public/vendor/studio-player.js` vai no commit.

**Lacuna temporária entre B2 e B3:** o export mixa a SFX sempre (o app ainda não envia `mix`), enquanto o solo da TRILHA a cala só no preview. É a mesma classe de diferença que a TRILHA já tem hoje e fecha no B3.

---

## Interface (B2 e B3)

### B2: a lane SFX

- Nova linha `data-track="sfx"` depois da TRILHA (`index.html:1951-1956`): ícone `≈`, nome **SFX**, controles `+` e `L`. Ordem das tracks: `beats, broll, video, legend, audio, music, sfx`.
- `--sfx:#22d3ee` no `:root`, ao lado de `--go` e `--warn`.
- CSS da TRILHA compartilhado por seletor (`.bt-clip.music, .bt-clip.sfx`), mudando só a cor da borda e da minionda. O nome do clipe fica em 9,5px; o comentário de isenção e o `EXEMPT_TEXT` do probe ganham `.bt-clip.sfx`.
- Os ramos binários viram mapa explícito: `clipsFor(track)` com `sfx → SFX`; um `CLIP_HOST = { broll: 'bt-track-broll', music: 'bt-track-music', sfx: 'bt-track-sfx' }` substitui os ternários de `:3115`, `:3140` e `:3187`; o título do popover (`:2304`) sai de um mapa de nomes.
- `'sfx'` entra em todo ponto que hoje lista `'broll', 'music'`: snap nas bordas de clipe (`:1563`), apagar em grupo (`:3282`, com a chave `sfx` no `byTrack`), movimento em grupo (`:3298`, `:3356`), redimensionar a altura da linha (`:2945-2946`) e `trackHeights` (`:1329`). O plano enumera a lista completa por `grep`, não só esta. Adicionar, colar e duplicar tratam `sfx` como a TRILHA (sem busca de vão, limitado ao fim da timeline), com a duração padrão da decisão 8.
- `saveBeats` (`:1767-1783`) envia `sfx`; `applySavedBeats` (`:1809-1824`) lê `saved.sfx` como lê `saved.music`.

### B3: controles de áudio

| Track | Antes | Depois |
|---|---|---|
| MARKERS | H L | H L |
| B-ROLL | + H L | + H L |
| VÍDEO | L | L |
| LEGENDA | H L | H L |
| ÁUDIO | H L | **M S L** |
| TRILHA | + M S H L | **+ M S L** |
| SFX | + L | **+ M S L** |

- **Estado:** M faz toggle de `track` em `MIX.mute`; S faz `MIX.solo = (MIX.solo === track ? null : track)`. Solo exclusivo por construção.
- **`TCTL`** (`:1844-1850`): `mute` com label "Silenciar track" e title "mudo — vale no export"; `solo` com label "Solo da track" e title "solo — só esta track soa, também no export". O `aria-label` continua sendo ação + nome da track.
- **`applyTrackVisibility()`** (`:2488-2508`): `on` de `mute` = `MIX.mute.includes(track)`; de `solo` = `MIX.solo === track`. Tracks de áudio com `!audible(track)` ganham `.silent`.
- **CSS:** `.bt-track-row.silent .bt-track-content{opacity:.45}`, sem `pointer-events:none`.
- **Remoções:** `trilhaMuted`, `trilhaSolo`, `hiddenTracks.music` e seus leitores (`:1330`, `:1384-1386`, `:2403-2405`, `:3393-3394`, `:3488`). `playerProps()` e o laço do canvas passam a usar `audible()`.
- **Persistência:** `saveBeats` envia `mix: MIX`; `applySavedBeats` normaliza `saved.mix` com a mesma regra do servidor; a troca de vídeo (`:3488`) zera `MIX`.
- **Mensagem do CONFORMAR** (`doConform`, `:1788-1808`) acrescenta à linha de hoje:
  - `· N SFX`;
  - o que ficou de fora, só quando `excluded` não está vazio: "fora do export: ÁUDIO, TRILHA (solo: SFX)" com solo, e "fora do export: TRILHA (mudo)" sem solo;
  - o pico, conforme a tabela abaixo.

| `peakWarn` | Texto | Estilo |
|---|---|---|
| `'clip'` | "pico +1,8 dBFS — vai distorcer: abaixe TRILHA/SFX" | erro (`stage(msg, true)`) |
| `'hot'` | "pico −0,4 dBFS — sem folga (ideal ≤ −1)" | normal |
| `null` | "pico −6,2 dBFS" | normal |
| `peakDb === null` | nada sobre pico | normal |

---

## Etapas

| Etapa | Toca | Entrega |
|---|---|---|
| **B0** | `public/index.html` | Os dois bugs de preview da TRILHA. |
| **B1** | `lib/timeline.js`, `lib/ffmpeg.js`, `server.js` | Sidecar v4, SFX e `mix` no conform, mono sem os −3 dB, medição de pico. Nada na UI. |
| **B2** | `public/index.html`, `TimelinePreview.tsx`, `player-entry.tsx`, bundle, `ui-probe.js` | Lane SFX nas duas rotas, prop `audible`, teto de 16. |
| **B3** | `public/index.html`, `ui-probe.js` | M/S/L nas tracks de áudio, `MIX` persistido, mensagem do conform. |

Um PR por etapa, merge commit, pelo fluxo executor → validator → git-workflow.

---

## Verificação

**Probe (`public/dev/ui-probe.js`):** `ORDER` ganha `B2` e `B3` depois de `E3b`; os checks do A continuam valendo nesses estágios, com três ajustes:
- `track-order` passa a esperar `sfx` no fim a partir de `B2`;
- `text-floor` passa a aceitar como isentos os itens cujo seletor está em `EXEMPT_TEXT`, em vez de exigir igualdade com o baseline (o baseline não tinha clipe de TRILHA nem de SFX na tela);
- `motion-literals` ignora a sobreposição que a extensão Claude in Chrome injeta enquanto o agente age (`#claude-agent-glow-border…`, `#claude-phantom-cursor`). Achado no reteste do plano: depois de uma tecla ou clique da verificação, o check falhava com as animações da extensão. Um literal do próprio app continua sendo acusado.

Checks novos:
- `B2`, `sfx-lane`: a linha existe depois da TRILHA, com `+` e `L`, e `--sfx` é resolvido;
- `B3`, `audio-controls`: o conjunto de controles por track é igual à tabela do B3;
- `B3`, `solo-exclusive`: ligar S em duas tracks deixa exatamente um `aria-pressed="true"`;
- `B3`, `silent-lanes`: `.silent` bate com `audible()` nas combinações de M/S.

Todo check novo restaura o estado que alterou.

**B0:** checagem estática do plano. No navegador:
- **Rota canvas** (bundle bloqueado no DevTools, pelo usuário, como no A): o bug é reproduzido **antes** da mudança (clipe da TRILHA dividido, play na primeira metade, `<audio>` pausado) e verificado depois (`paused === false`).
- **Rota Player:** chamadas a `StudioPlayer.update` durante o arraste do slider, zero antes e maior que zero depois.

**B1 (Node, sem navegador):**
- `filter`/`args` idênticos aos de `c3c8012` em pelo menos quatro fixtures: sem clipes, com TRILHA, com B-ROLL + TRILHA, e com plate sem áudio.
- `audible` nas 32 combinações de `mute` (8) × `solo` (4) contra a tabela esperada; `normalizeMix` com lixo (nomes desconhecidos, duplicatas, `solo` inválido, `mix` ausente).
- Conforms reais com mídia `lavfi`: base de 6s em silêncio; SFX com tom de 1 kHz em 2,0–2,5s; TRILHA com 440 Hz em 3,5–4,5s. O `astats` por janela (`atrim`) prova:
  - SFX presente na janela quando audível;
  - silêncio na janela com `mute: ['sfx']`;
  - com `solo: 'sfx'`, a janela da TRILHA em silêncio e a da SFX com som;
  - `excluded` correto em cada caso.
- Um tom mono de pico −18 dBFS sai com RMS acima de −22,5 dB por canal (≈ −21 dB duplicado; ≈ −24 dB com o upmix de −3 dB).
- `peakWarn === 'clip'` com dois tons em escala cheia sobrepostos; `'hot'` com um tom a cerca de −0,6 dBFS; `null` com os tons de −18 dBFS; pico `null` quando tudo está mudo (silêncio digital).
- `POST /api/beats` (servidor rodando) grava `version: 4` e saneia um `mix` inválido; um sidecar v3 conforma sem erro.

**B2 (navegador, duas rotas):**
- clipe de SFX toca na sua janela e fica pausado fora dela;
- o mesmo arquivo em dois clipes sobrepostos toca duas vezes;
- 17 clipes **distintos** simultâneos (entradas a 0,2s uma da outra; clipes no mesmo frame o Remotion funde e não testam o teto) → o Player recebe 16, sai o aviso, e o preview funciona, sem `⚠️`;
- dois clipes idênticos empilhados chegam ao Player com fragmentos diferentes;
- salvar → sidecar com `sfx`; recarregar → restaurado; undo/redo;
- projeto salvo antes do B2 abre com a SFX vazia;
- conformar → log com `M SFX` e a janela do efeito com som no arquivo;
- `run('B2')` PASS. A partir do B2 o estágio `E3b` deixa de valer, porque o `track-order` dele espera a ordem sem SFX; o `B2` roda todos os checks do A mais os novos.

**B3 (navegador):**
- `run('B3')` PASS;
- `mix` sobrevive a salvar e recarregar;
- um conform real com SFX muda mostra silêncio na janela do efeito (export = preview);
- a mensagem do CONFORMAR mostra a exclusão e o pico.

**Checklist manual do usuário** em B0, B2 e B3, no formato do A.

---

## Guardrails

1. `lib/encode.js`, `lib/color.js`, `lib/assemble.js` e a parte de vídeo do grafo do conform ficam intocados. `lib/ffmpeg.js` só ganha o campo `channels` no retorno de `mediaInfo`.
2. `normalize=0` continua; o áudio de B-ROLL continua descartado.
3. Os handlers de arraste só ganham `'sfx'` nas listas e o mapa de hosts; nenhuma regra de arraste muda para as tracks existentes.
4. O Player continua sendo só preview; `POST /api/timeline/conform` continua o único caminho até o arquivo.
5. Nenhuma chave nova em `localStorage`; nenhuma dependência npm nova.
6. Todo caminho de clipe do sidecar continua passando por `resolveInput()`.
7. Sidecar antigo nunca gera erro de leitura.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Mais de 16 áudios simultâneos no Player | Teto aplicado em `playerProps()` com aviso; o export não tem teto. |
| `astats` indisponível ou com saída diferente em outro build do ffmpeg | `peakDb: null`, log e conform segue. |
| AAC arredondar picos acima de 0 dBFS para baixo | Medido no brainstorm (ffmpeg 6.1): dois tons somando acima de 0 dBFS, codificados em AAC 192k, leem `Peak level dB: 5.51` no `astats`. O AAC preserva o excesso. Mesmo assim, o limiar `'hot'` começa em −1 dBFS, e um pico achatado em 0 ainda avisaria. |
| Muitos `-i` num conform com dezenas de efeitos | Aceito: o ffmpeg abre um demuxer por input; o reel é curto. Reavaliar só com caso real. |
| Solo esquecido indo para o export | É a decisão 1; a mensagem do CONFORMAR diz o que ficou de fora. |
