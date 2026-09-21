# Design — Mixagem de áudio da TIMELINE (sub-projeto B)

**Data:** 2026-09-21
**Origem:** sub-projeto B da decomposição em `docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md` (seção "Decomposição"): R5 (trilha de SFX), M/S em ÁUDIO/SFX, solo exclusivo e a decisão preview × export. O texto original do R5 e do R4 vem de `ui-premium-upgrade.md` (plano do usuário, não versionado). Na Revisão R2, `mixagem-audio-reels.md` (documento do usuário, não versionado): referência de níveis para Reels e o medidor de pico.
**Arquivos-alvo:** `lib/timeline.js`, `lib/ffmpeg.js` (um campo a mais no `mediaInfo`), `lib/assemble.js` (B4, só o áudio), `server.js`, `public/index.html`, `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`, `public/vendor/studio-player.js` (bundle, regenerado), `public/dev/ui-probe.js`.
**Base:** `main` em `c3c8012`. Todo número de linha citado aqui se refere a esse commit. A Revisão R2 parte de `3b083d4`, que só acrescentou esta spec e o plano: o código é o mesmo de `c3c8012`.
**Revisão R1 (2026-09-21, ao escrever o plano):** o código das quatro etapas foi escrito e testado numa cópia do repo antes do plano: o conform com mídia sintética e servidor numa porta de teste, a UI no navegador numa porta separada. Os testes acrescentaram dois achados e duas decisões: o mono da TRILHA/SFX sai 3 dB mais baixo no export (decisão 13) e o Player funde clipes idênticos empilhados (decisão 14). Também confirmaram o limite de áudio do Player. A mensagem do CONFORMAR ganhou um formato único ("fora do export: …"). As seções abaixo já refletem a revisão.
**Revisão R2 (2026-09-21, antes da execução), a partir de `mixagem-audio-reels.md`:** o usuário trouxe uma referência de níveis para Reels (voz, música e SFX, e −14 a −16 LUFS) e pediu um medidor de pico do master estilo Premiere. Conferido contra o código, o documento partia de premissas que não se confirmaram: não existe medição de LUFS no pipeline; as zonas de cor propostas pintavam de vermelho a voz no nível-alvo; o slider linear não alcança a faixa da música; e o master bus do preview não está ao alcance do app. A medição dos arquivos reais mostrou que a voz sai de 6 a 11 LU abaixo do alvo em todo projeto. Daí as decisões 15 a 20: o B1 mede LUFS, o B2 troca o slider por dB, o B3 mostra o LUFS, e entram duas etapas, **B4** (voz normalizada no ASSEMBLE) e **B5** (medidor de pico do master). As seções abaixo já refletem a revisão.

---

## Contexto e problema

A TIMELINE tem uma track de música (`♫ TRILHA`) e nenhum lugar para efeito pontual (whoosh, impacto, riser): hoje ele precisa ser colado na TRILHA, sem mudo nem solo próprios. Os controles de áudio que existem são só de preview: o conform recebe a TRILHA inteira, então o arquivo exportado não soa como o que o usuário ouviu com um mudo ou solo ligado.

O B acrescenta a track SFX e transforma M/S em controles de mixagem de verdade: o que o preview toca é o que o conform entrega.

Na Revisão R2, o B passa a cuidar também do **nível**. A voz é o elemento principal de um Reel, e música e SFX se ajustam em relação a ela, dentro de −14 a −16 LUFS no arquivo final. Hoje o app não mede loudness, a voz que ele monta sai baixa demais, e não há onde ver o nível do mix enquanto se edita.

---

## Referência de mixagem para Reels (documento do usuário, Revisão R2)

Referência de `mixagem-audio-reels.md`. A voz é o guia, e o resto se ajusta a ela:

| Elemento | Pico-alvo (dBFS) | Função |
|---|---|---|
| Voz principal | −3 a −5 | guia do vídeo, sempre nítida |
| Música de fundo | −20 a −30 (ou 18 a 25 dB abaixo da voz) | preenchimento, sem competir com a fala |
| SFX leves (pop, clique, transição leve) | −15 a −20 | pontuar animações e textos |
| SFX de impacto (batida, transição forte) | −6 a −10 | chamar atenção, curtos e fora de fala importante |

**Loudness do arquivo final:** −14 a −16 LUFS integrado.

A tabela é **referência para quem mixa**, não regra aplicada pelo app. O app mede e mostra (B1, B3 e B5), normaliza só a voz na origem (B4) e não mexe no mix.

**Correções ao documento, feitas pela verificação no código:**

| O documento dizia | O que o código mostrou | Como ficou |
|---|---|---|
| "o LUFS integrado continua sendo validado na exportação (pipeline FFmpeg/EBU R128 já existente)" | Não há `ebur128`, `loudnorm` nem medida de LUFS em `lib/`, `server.js`, `public/index.html`, `clipper/` ou `remotion/src`. O Export passa o áudio direto para AAC (`lib/encode.js:123`). | O conform passa a medir o LUFS (decisão 15). |
| Zonas: verde −60 a −18, amarelo −18 a −6, vermelho −6 a 0 | A voz no alvo (−3 a −5) cairia no vermelho "Saturação", e um mix correto apareceria vermelho quase o tempo todo. | Zonas amarradas aos limiares do conform (decisão 17). |
| Master bus: faixas → ganho de master → `AnalyserNode` L/R ao vivo; envelope pré-calculado só para o scrub | Na rota Player, todo o áudio passa pelo `AudioContext` interno do Remotion, que já chamou `createMediaElementSource` em cada elemento (só pode uma vez por elemento). Na rota canvas, não há grafo Web Audio. | Master calculado offline, servindo play e scrub nas duas rotas (decisão 16). |
| "Demo funcional validado" | Não há código de medidor no repo. | O B5 implementa a balística do documento. |
| (implícito) a voz já está no nível | Medidos com `ebur128`: a fixture `assembled-4545f906507a.mp4` em −25,4 LUFS (pico −8,3); outros arquivos do app em −21,9 a −22,3 LUFS (pico −9,5). | Voz normalizada no ASSEMBLE (decisão 19). |

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
| **(R2) Nenhuma medida de loudness** | Busca por `ebur128`, `loudnorm`, `lufs` e `r128` em `lib/`, `server.js`, `public/index.html`, `clipper/` e `remotion/src`: nada. | O alvo de −14 a −16 LUFS não é verificado em lugar nenhum. |
| **(R2) A voz do app sai baixa** | `ebur128` nos arquivos de `output/`: fixture em −25,4 LUFS / pico −8,3 dBFS; `assembled-9680c0370b29.mp4` e `reel-05e8b68e4d84.mp4` em −21,9 / −9,5; `conformed-556f7c8f83b3.mp4` em −22,3 / −9,5. `lib/assemble.js` não normaliza (`:80-85`). | Só medir e avisar acusaria todo export sem dar como corrigir. |
| (R2) `ebur128` dá LUFS e pico numa passada | ffmpeg 6.1, `-af ebur128=peak=sample`: o resumo final traz `I: -25.4 LUFS` e, em `Sample peak`, `Peak: -8.3 dBFS`. Com silêncio digital, `I: -70.0 LUFS` e `Peak: -inf dBFS`. | Substitui o `astats` do B1. |
| (R2) loudnorm em duas passadas na voz da fixture | 1ª passada: `input_i -25.54`, `input_tp -8.33`, `input_lra 3.10`. 2ª com `linear=true`: `normalization_type dynamic` (o ganho de +9,5 dB levaria o pico a +1,2), saída medida em −16,0 LUFS, true peak −1,5, LRA 3,7. | Base da decisão 19. |
| (R2) Slider de ganho linear | `min 0 max 1 step 0.05` (`index.html:2165`). Entre −20 e −30 dB só há 0,10 (−20 dB) e 0,05 (−26 dB). | Não alcança a faixa da música (decisão 18). |
| (R2) Master do preview fora de alcance | O Player cria um `AudioContext` próprio com um `GainNode` de master (`remotion/dist/cjs/audio/use-audio-context.js:35-43`) e chama `createMediaElementSource` nos `<audio>` e no `<video>` (`shared-element-source-node.js:14`, `video/VideoForPreview.js`). Chegar nele exigiria `Internals.SharedAudioContext`, API interna. A rota canvas toca direto nos elementos, sem Web Audio. | Medidor por master offline (decisão 16). |
| (R2) O áudio decodificado é jogado fora | `loadWaveform` decodifica o vídeo base inteiro e guarda só os picos do canal 0 (`index.html:1626-1654`); `ensureMiniWave` faz o mesmo com cada clipe da TRILHA, com 200 colunas (`:1709-1728`). | O B5 passa a guardar os `AudioBuffer`. |
| (R2) Volume acima de 1 | O Player aceita, porque amplifica por `GainNode` (`use-amplification.js`); o `validate-media-props.js` só rejeita volume negativo. A rota canvas não passa de 1 (`HTMLMediaElement.volume`). | Ganho acima de 0 dB continua fora: o preview canvas não o reproduziria. |

---

## Decisões tomadas no brainstorm

| # | Questão | Decisão |
|---|---|---|
| 1 | Preview × export | **Export = preview.** M e S vão para o sidecar e o conform aplica. A mensagem do CONFORMAR lista o que ficou de fora. |
| 2 | H nas tracks de áudio | **Removido.** ÁUDIO, TRILHA e SFX ficam com M, S e L (+ `+` em TRILHA/SFX). H continua em MARKERS, B-ROLL e LEGENDA, só de preview. |
| 3 | Picos acima de 0 dBFS | **Medir e avisar.** O conform mede o pico do arquivo pronto e avisa; nada é processado. |
| 4 | Corte em PRs | **B0 → B1 → B2 → B3**: bugs da TRILHA → servidor → lane SFX → controles de áudio. **Na R2, mais B4 → B5** (decisão 20). |
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
| 15 | (R2) LUFS do export | **Medir e avisar**, como o pico (decisão 3). O conform mede LUFS integrado e pico de amostra numa passada de `ebur128`. Nada é processado no mix: o export continua igual ao preview. |
| 16 | (R2) Sinal do medidor | **Master offline.** O mix é renderizado num `OfflineAudioContext` com as regras do conform; um envelope de pico por frame serve play e scrub, nas duas rotas, e antecipa o pico do export. |
| 17 | (R2) Zonas de cor | **Amarradas ao conform:** verde abaixo de −6 dBFS, amarelo de −6 a −1 (a faixa da voz, −3 a −5), vermelho a partir de −1, o limiar do `'hot'`. O medidor e a mensagem do export usam os mesmos números. |
| 18 | (R2) Slider de ganho | **Em dB, de −40 a 0, passo de 0,5 dB**, com o valor no `title`. O sidecar continua guardando `volume` linear (`10^(dB/20)`). Sem ganho acima de 0 dB. |
| 19 | (R2) Voz baixa | **Normalizada no ASSEMBLE:** loudnorm em duas passadas, alvo −16 LUFS integrado e true peak −1,5 dBTP, `linear=true` (o loudnorm passa sozinho ao modo dinâmico quando o ganho fixo estouraria o teto). Sempre ligado, sem toggle na UI; `normalizeVoice: false` desliga pela API. Fail-soft. |
| 20 | (R2) Ordem | **B0 → B1 → B2 → B3 → B4 → B5.** O B4 é independente; fica perto do B5 para o medidor medir a voz normalizada na validação dele. |

---

## Objetivo

- Uma track SFX abaixo da TRILHA, com clipes curtos, sobreponíveis, com ganho por clipe e as mesmas edições da TRILHA.
- Mudo e solo em ÁUDIO, TRILHA e SFX, com o mesmo efeito no preview e no arquivo exportado.
- O usuário sabe, ao conformar, o que ficou fora do export e se a mixagem vai distorcer.
- Os dois bugs de preview da TRILHA corrigidos, porque a SFX depende do mesmo código.
- (R2) O usuário sabe, ao conformar, o LUFS do arquivo contra o alvo de −14 a −16.
- (R2) A voz sai do ASSEMBLE no nível-alvo, e música e SFX se ajustam a ela com um slider em dB.
- (R2) Enquanto edita, o usuário vê o pico do master num medidor à direita da timeline, no play e no scrub, e o pico máximo do mix antes de conformar.

**Fora de escopo (deliberado):** normalização e limitador **do mix** (a voz é normalizada na origem, decisão 19); LUFS estimado no navegador; ganho acima de 0 dB; slider de volume na ÁUDIO; fades e crossfades; H de B-ROLL/LEGENDA valer no export; atalhos de teclado para M/S; Pointer Events; sub-projetos C e D.

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
5. **Pico e LUFS (R2):** depois do `runFfmpeg` principal, um segundo ffmpeg lê o arquivo pronto com `-af ebur128=peak=sample -f null -`. Do resumo final saem o `I:` (LUFS integrado) e, na seção `Sample peak`, o `Peak:` (pico de amostra em dBFS). Mede o arquivo, porque é ele que o Export recebe. A função `measureLoudness(file, onLog) → Promise<{ lufs, peakDb }>` substitui o `measurePeak` da R1. O parse fica numa função pura, `parseLoudness(stderr) → { lufs, peakDb }`, testada com a saída real capturada. Ao lado de `peakWarnOf`, entra `loudWarnOf(lufs)`, também pura e exportada. Silêncio digital (`I` ≤ −70, `Peak: -inf`) dá `lufs: null` e `peakDb: null`. Se a medição falhar, os dois saem `null` com uma linha de log; o conform não falha por isso.
6. Retorno ganha:
   - `sfx` (contagem de clipes usados);
   - `peakDb` (pico de amostra, uma casa decimal);
   - `peakWarn`: `'clip'` se `peakDb > 0`, `'hot'` se `-1 ≤ peakDb ≤ 0`, senão `null`;
   - `lufs` (LUFS integrado, uma casa decimal);
   - `loudWarn`: `'low'` se `lufs < -16`, `'high'` se `lufs > -14`, senão `null` (também `null` com `lufs` nulo);
   - `excluded`: as tracks que tinham conteúdo e o `mix` silenciou. Conteúdo, para `audio`, é o plate ter faixa de áudio; para `music`/`sfx`, ter ao menos um clipe depois da normalização;
   - `mix`: o `mix` normalizado que foi aplicado.
7. Log: `· N TRILHA · M SFX`, mais `· fora do export: …` quando `excluded` não estiver vazio, e uma linha com pico e LUFS.

O `peakWarn` fica no pico de **amostra**, não no true peak: é o mesmo número que o medidor do B5 mostra, então medidor e conform nunca discordam.

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
- **Volume** de 0 a 1 nas duas rotas, como a TRILHA: é o teto do `HTMLMediaElement`, e o conform já limita a `[0, 1]` (`lib/timeline.js:72`). Na R2 o slider passa a ser em dB (decisão 18, ver B2 em "Interface"), mas o valor guardado e enviado ao Player continua linear.
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
- **(R2) Slider de ganho em dB, na TRILHA e na SFX** (decisão 18). O `<input type="range">` do clipe passa a `min=-40 max=0 step=0.5`, com `value` igual ao dB do volume guardado (`20·log10(volume)`, arredondado ao passo e limitado a −40). O `title` e o `aria-valuetext` mostram o dB ("−24,5 dB"). No `input`, o volume vira `10^(dB/20)`, e −40 grava exatamente `0.01`. O volume guardado só muda quando o slider é mexido: um 0,8 antigo aparece como −2,0 dB e continua 0,8 até alguém arrastar. Duas funções puras, `dbOf(volume)` e `volumeOf(db)`, fazem a conversão.

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

**(R2) LUFS**, depois do pico, sempre em cor normal (não quebra o arquivo):

| `loudWarn` | Texto |
|---|---|
| `null` | "· −15,2 LUFS" |
| `'low'` | "· −25,4 LUFS: abaixo do alvo −14 a −16" |
| `'high'` | "· −11,8 LUFS: acima do alvo −14 a −16" |
| `lufs === null` | nada sobre LUFS |

O estilo de erro continua reservado ao `peakWarn === 'clip'`.

---

## Voz normalizada no ASSEMBLE — `lib/assemble.js` e `server.js` (B4, Revisão R2)

**Alvo** (decisão 19): −16 LUFS integrado, true peak −1,5 dBTP, LRA 11. A voz em −16 deixa espaço para música e SFX levarem o mix para dentro de −14 a −16. O teto de −1,5 fica abaixo do vermelho do medidor (−1) e dá folga para o AAC e a recompressão do Instagram.

**`lib/assemble.js`:**

1. `assemble()` ganha `normalizeVoice = true`.
2. **Fonte da voz:** a narração (`voiceover`, input 1) quando existe; senão, o áudio do próprio `visual` (input 0), se `vInfo.acodec`. Sem nenhuma das duas, não há o que normalizar.
3. **1ª passada (medição):** `ffmpeg -i <fonte> -map 0:a:0 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`. Do bloco JSON impresso no stderr saem `input_i`, `input_tp`, `input_lra`, `input_thresh` e `target_offset`. Uma função pura, `parseLoudnormJson(stderr)`, faz o parse.
4. **2ª passada (aplicação):** no mesmo ffmpeg que já monta o MP4, entra `-af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true:print_format=json`. O `-ar 44100 -ac 2` que já existe (`:84`) desfaz o reamostramento interno do loudnorm (192 kHz). Do JSON dessa passada saem `output_i` e `normalization_type` (`linear` ou `dynamic`).
5. **Fail-soft:** a montagem segue sem normalizar, com uma linha de log, quando a medição falha, o JSON não vem, `input_i` não é finito ou é ≤ −70 (silêncio), ou não há fonte de voz. Se o próprio ffmpeg da montagem falhar com o loudnorm, a montagem é refeita sem ele. O ASSEMBLE nunca falha por causa disso.
6. **Retorno:** ganha `voice: { normalized: boolean, lufsIn, lufsOut, mode, reason }`. `reason` diz por que não normalizou: `'desligada'`, `'sem faixa de voz'`, `'medição falhou'`, `'voz em silêncio'` ou `'loudnorm falhou na montagem'`.
7. **O que não muda:** a cadeia de vídeo (`vf`), a transcrição (roda antes, sobre a fonte original), o `.ass` e os argumentos de vídeo.

**`server.js`:** `/api/assemble` repassa `normalizeVoice: b.normalizeVoice !== false`.

**`public/index.html`:** a mensagem de fim do ASSEMBLE acrescenta "voz normalizada: −25,5 → −16,0 LUFS". Com `mode === 'dynamic'`, acrescenta também "(com limitação de pico)"; quando não normalizou, mostra o `reason`. Sem toggle na UI.

**Vídeos já montados** não mudam; só um novo ASSEMBLE os normaliza. A fixture dos testes continua em −25,4 LUFS de propósito.

---

## Medidor de pico do master (B5, Revisão R2)

### Motor: master offline (decisão 16)

- **Buffers decodificados, em cache por arquivo.** `loadWaveform` passa a guardar o `AudioBuffer` do vídeo base (todos os canais) em `plateBuf`, além dos picos que já calcula. `ensureMiniWave` guarda o `AudioBuffer` de cada arquivo de TRILHA/SFX em `audioBufCache` (`path → AudioBuffer | null`, com `null` para arquivo que não decodifica). Os dois são liberados na troca de vídeo (`clearMediaCache`); um arquivo que deixa de ser usado sai do `audioBufCache` e da `miniWaveCache` juntos (`pruneMediaCache`), para ser decodificado de novo se voltar.
- **Render.** `renderMaster()` cria um `OfflineAudioContext(2, ceil(DURATION·44100), 44100)` e agenda:
  - se `audible('audio')`, um `AudioBufferSourceNode` do `plateBuf` por segmento da VÍDEO, com `start(segStart(i), s.srcIn, s.dur)`;
  - para cada clipe de TRILHA/SFX com track audível e buffer pronto, um `AudioBufferSourceNode` → `GainNode(volume)`, com `start(c.start, c.srcIn, dur)`.
  O mono é duplicado nos dois canais pelo up-mix padrão do Web Audio (`speakers`), o mesmo resultado do conform depois do B1. `normalize=0` também vale aqui: a soma é direta.
- **Envelope.** Do buffer renderizado sai o pico por canal a cada 1/60 s (`envL`, `envR`, `Float32Array`) e o pico máximo do mix inteiro (`mixPeakDb`).
- **Quando recalcula.** 200 ms depois da última chamada a `scheduleMaster()`, que acontece em `snapshot()` (toda edição confirmada: arraste, trim, split, colar), `renderTracks()`, `input` do slider de ganho, clique em M/S, fim do `loadWaveform` e fim do `ensureMiniWave`. Uma assinatura do mix (cortes, clipes, ganhos, quem soa e quais buffers chegaram) pula o render quando nada mudou, porque `renderTracks()` também roda em zoom e seleção. Um contador de geração descarta um render que termina depois de outro mais novo.
- **Estado.** `pending` enquanto um buffer necessário não decodificou; o render roda sem ele e repete quando ele chegar. `unavailable` quando o vídeo base **tem** faixa de áudio (do probe, `info.acodec`) e ela não decodificou (`waveError`), ou quando não existe `OfflineAudioContext`: medir sem a voz mentiria. Um vídeo base sem faixa de áudio mede só TRILHA e SFX. `ok` no resto; um mix em silêncio fica `ok` com `data-peak` vazio.

### Tela

- **Lugar.** Uma faixa `#bt-meter` de 44px à direita das tracks. `.bt-scroll` e `#bt-meter` ficam lado a lado numa linha flex (`.bt-mixrow`), que estica o medidor à altura das tracks. A rolagem horizontal, a régua e o playhead não mudam.
- **Desenho**, num `<canvas>` dentro da faixa:
  - barras L e R;
  - escala 0 / −6 / −12 / −18 / −30 / −60 (piso de −60 dBFS);
  - linha de peak hold por canal.
- **Pico do mix inteiro**, em texto, abaixo do canvas (`#bt-meter-peak`): "−8,3", na cor da zona. O `title` diz que é o pico que o conform vai medir.
- **Zonas** (decisão 17): verde abaixo de −6 dBFS, amarelo de −6 a −1, vermelho a partir de −1. Token novo `--meter-ok:#34d399` para o verde; o amarelo usa `--go` e o vermelho, `--bad`.
- **Balística** (do documento): ataque instantâneo; queda de no máximo 20 dB/s, nunca abaixo do valor atual do envelope; peak hold por 1,2 s, depois cai à mesma taxa.
- **Play e scrub.** O medidor lê o envelope no frame de `playhead`. Tocando, aplica a balística; parado ou no scrub, mostra o valor do frame direto, como no documento.
- **Laço.** `requestAnimationFrame` só enquanto a TIMELINE está montada e visível, e só redesenha quando algo mudou.

### Ganchos de teste

`#bt-meter` expõe:
- `data-state`: `ok`, `pending` ou `unavailable`;
- `data-peak`: o pico do mix inteiro, em dBFS com uma casa, ou vazio;
- `data-l` e `data-r`: o nível mostrado agora, em dBFS com uma casa;
- `data-render-ms`: a duração do último render.

O probe e o Orquestrador leem tudo isso sem enxergar o closure.

### Onde toca

Só `public/index.html` e `public/dev/ui-probe.js` (estágio `B5`). Sem servidor e sem bundle, porque o medidor não depende do Player.

---

## Etapas

| Etapa | Toca | Entrega |
|---|---|---|
| **B0** | `public/index.html` | Os dois bugs de preview da TRILHA. |
| **B1** | `lib/timeline.js`, `lib/ffmpeg.js`, `server.js` | Sidecar v4, SFX e `mix` no conform, mono sem os −3 dB, medição de pico **e LUFS** (`ebur128`). Nada na UI. |
| **B2** | `public/index.html`, `TimelinePreview.tsx`, `player-entry.tsx`, bundle, `ui-probe.js` | Lane SFX nas duas rotas, prop `audible`, teto de 16, **slider em dB**. |
| **B3** | `public/index.html`, `ui-probe.js` | M/S/L nas tracks de áudio, `MIX` persistido, mensagem do conform **com LUFS**. |
| **B4** | `lib/assemble.js`, `server.js`, `public/index.html` | Voz normalizada no ASSEMBLE (−16 LUFS, true peak −1,5). |
| **B5** | `public/index.html`, `ui-probe.js` | Medidor de pico do master, offline, à direita da timeline. |

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
- `B3`, `silent-lanes`: `.silent` bate com `audible()` nas combinações de M/S;
- (R2) `B5`, `meter`: `#bt-meter` à direita de `.bt-scroll`, com a mesma altura (±2px), `data-state="ok"` depois de carregar, `--meter-ok` resolvido e um `data-peak` numérico. `ORDER` ganha `B5` (não há estágio `B4`: o B4 não mexe na TIMELINE).

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
- (R2) `parseLoudness` com a saída real do `ebur128` capturada no brainstorm (fixture, tons, silêncio) e com saída truncada, que deve dar `null`. `loudWarnOf` nos limiares (−16,1 → `'low'`, −16 e −14 → `null`, −13,9 → `'high'`, `null` → `null`). Nos conforms sintéticos: `lufs` numérico quando há som e `null` com tudo mudo; um caso `'low'`, um `'high'` e um dentro do alvo, com os níveis calibrados na cópia de teste.

**B2 (navegador, duas rotas):**
- clipe de SFX toca na sua janela e fica pausado fora dela;
- o mesmo arquivo em dois clipes sobrepostos toca duas vezes;
- 17 clipes **distintos** simultâneos (entradas a 0,2s uma da outra; clipes no mesmo frame o Remotion funde e não testam o teto) → o Player recebe 16, sai o aviso, e o preview funciona, sem `⚠️`;
- dois clipes idênticos empilhados chegam ao Player com fragmentos diferentes;
- salvar → sidecar com `sfx`; recarregar → restaurado; undo/redo;
- projeto salvo antes do B2 abre com a SFX vazia;
- conformar → log com `M SFX` e a janela do efeito com som no arquivo;
- `run('B2')` PASS. A partir do B2 o estágio `E3b` deixa de valer, porque o `track-order` dele espera a ordem sem SFX; o `B2` roda todos os checks do A mais os novos.

- (R2) slider em dB: o `title` mostra "−24,0 dB" depois de mover o slider até −24, e o Player recebe `volume` ≈ 0,0631 (`10^(−24/20)`); um volume salvo de 0,8 aparece em −2,0 dB e continua 0,8 no sidecar até o slider ser mexido; −40 grava 0,01. `dbOf`/`volumeOf` testadas nos extremos.

**B3 (navegador):**
- `run('B3')` PASS;
- `mix` sobrevive a salvar e recarregar;
- um conform real com SFX muda mostra silêncio na janela do efeito (export = preview);
- a mensagem do CONFORMAR mostra a exclusão, o pico e (R2) o LUFS; a fixture, em −25 LUFS, aparece "abaixo do alvo".

**B4 (Node, sem navegador, R2):**
- `parseLoudnormJson` com a saída real das duas passadas capturada no brainstorm, e com saída sem JSON, que dá `null`;
- ASSEMBLE real com legendas desligadas (sem Whisper): uma voz sintética a cerca de −30 LUFS sai em −16 ± 0,5 LUFS e true peak ≤ −1,4 dBTP (`ebur128=peak=true` no arquivo), e `voice.normalized === true`;
- `normalizeVoice: false`: o LUFS de saída fica a ±0,5 do de entrada, e `voice.normalized === false`;
- narração em silêncio: monta sem erro, `voice.normalized === false` e `reason` preenchido;
- vídeo sem narração, com áudio próprio: normaliza o áudio do vídeo;
- a voz real da fixture, extraída e usada como narração, sai em −16 ± 0,5 LUFS.

**B5 (navegador, duas rotas, R2):**
- `run('B5')` PASS;
- no vídeo sem edição, `data-peak` bate com o pico de amostra do próprio arquivo medido pelo `ebur128` (±0,5 dB);
- com a ÁUDIO muda e um efeito isolado, `data-l` no scrub dentro da janela do efeito bate com o nível dele (±1 dB) e fica no piso (−60) fora dela;
- tocando, a série de `data-l` nunca cai mais de 20 dB/s (com folga de amostragem);
- mexer no slider ou em M/S muda `data-peak` depois do atraso de 200 ms;
- **o medidor prevê o conform:** depois de CONFORMAR, `data-peak` e o `peakDb` da mensagem ficam a menos de 0,5 dB;
- `data-render-ms` do master da fixture é registrado (referência: abaixo de 1 s num reel de 38 s).

Medido na cópia de teste, ao escrever o plano (janela visível, 1280×800): `run('B5')` PASS nas duas rotas; `data-peak` −8,4 contra −8,3 do `ebur128` no arquivo; um whoosh isolado deu −18,1 no pico e no scrub, e −60 fora dele; o slider a −10 dB levou o pico a −28,1; tocando, a queda ficou em ~20 dB/s (pior intervalo 21,1 dB/s); o conform mediu −8,3 dBFS com o medidor em −8,4; o master de 38 s renderizou em 14 a 52 ms.

**Checklist manual do usuário** em B0, B2, B3, B4 e B5, no formato do A. No B4, **ouvir a voz antes e depois** (o modo dinâmico). No B5, olhar o medidor tocando e no scrub.

---

## Guardrails

1. `lib/encode.js`, `lib/color.js` e a parte de vídeo do grafo do conform ficam intocados. `lib/ffmpeg.js` só ganha o campo `channels` no retorno de `mediaInfo`. (R2) `lib/assemble.js` só muda no áudio (B4): a cadeia de vídeo, a transcrição e o `.ass` ficam como estão.
2. `normalize=0` continua; o áudio de B-ROLL continua descartado.
3. Os handlers de arraste só ganham `'sfx'` nas listas e o mapa de hosts; nenhuma regra de arraste muda para as tracks existentes.
4. O Player continua sendo só preview; `POST /api/timeline/conform` continua o único caminho até o arquivo.
5. Nenhuma chave nova em `localStorage`; nenhuma dependência npm nova.
6. Todo caminho de clipe do sidecar continua passando por `resolveInput()`.
7. Sidecar antigo nunca gera erro de leitura.
8. (R2) O mix nunca é processado para o alvo de loudness: o app mede (B1), mostra (B3, B5) e normaliza só a voz na origem (B4).
9. (R2) O medidor não muda o que o preview toca: ele renderiza uma cópia do mix num contexto offline e nunca se liga ao áudio que está saindo.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Mais de 16 áudios simultâneos no Player | Teto aplicado em `playerProps()` com aviso; o export não tem teto. |
| `ebur128` indisponível ou com saída diferente em outro build do ffmpeg | `peakDb` e `lufs` nulos, log, e o conform segue. |
| (R2) loudnorm em modo dinâmico mudar o caráter da voz | Medido: LRA de 3,1 para 3,7 LU na fixture. O `mode` sai no resultado e na mensagem, e o checklist do B4 pede para ouvir antes e depois. `normalizeVoice: false` desliga pela API. |
| (R2) Memória dos buffers decodificados do medidor | Vídeo base estéreo a 44,1 kHz ocupa ~13 MB em 38 s e ~60 MB em 3 min; aceitável para reels. O cache é liberado na troca de vídeo e ao remover um arquivo. |
| (R2) Render do master pesar durante o arraste | Atraso de 200 ms e descarte de renders velhos; o tempo de cada render fica em `data-render-ms`. |
| (R2) Medidor divergir do conform | Mesmas regras de mix (segmentos, ganhos, `audible`, mono duplicado, soma direta) e o mesmo pico de amostra; a verificação do B5 compara `data-peak` com o `peakDb` do conform (±0,5 dB, a diferença do AAC). |
| AAC arredondar picos acima de 0 dBFS para baixo | Medido no brainstorm (ffmpeg 6.1): dois tons somando acima de 0 dBFS, codificados em AAC 192k, leem `Peak level dB: 5.51` no `astats`. O AAC preserva o excesso. Mesmo assim, o limiar `'hot'` começa em −1 dBFS, e um pico achatado em 0 ainda avisaria. |
| Muitos `-i` num conform com dezenas de efeitos | Aceito: o ffmpeg abre um demuxer por input; o reel é curto. Reavaliar só com caso real. |
| Solo esquecido indo para o export | É a decisão 1; a mensagem do CONFORMAR diz o que ficou de fora. |
