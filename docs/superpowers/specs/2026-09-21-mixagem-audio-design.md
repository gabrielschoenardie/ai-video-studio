# Design — Mixagem de áudio da TIMELINE (sub-projeto B)

**Data:** 2026-09-21
**Origem:** sub-projeto B da decomposição em `docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md` (seção "Decomposição"): R5 (trilha de SFX), M/S em ÁUDIO/SFX, solo exclusivo e a decisão preview × export. O texto original do R5 e do R4 vem de `ui-premium-upgrade.md` (plano do usuário, não versionado). Na Revisão R2, `mixagem-audio-reels.md` (documento do usuário, não versionado): referência de níveis para Reels e o medidor de pico. Na Revisão R3, três requisitos do usuário, trazidos na conversa: limitador no master com teto de −1 a −2 dBTP, SFX abaixo de −10 dB de pico e LRA global de 4 a 9 LU.
**Arquivos-alvo:** `lib/timeline.js`, `lib/ffmpeg.js` (um campo a mais no `mediaInfo`), `lib/assemble.js` (B4, só o áudio), `server.js`, `public/index.html`, `remotion/src/scenes/TimelinePreview.tsx`, `remotion/src/player-entry.tsx`, `public/vendor/studio-player.js` (bundle, regenerado), `public/dev/ui-probe.js`.
**Base:** `main` em `c3c8012`. Todo número de linha citado aqui se refere a esse commit. A Revisão R2 parte de `3b083d4`, que só acrescentou esta spec e o plano: o código é o mesmo de `c3c8012`. A Revisão R3 parte de `508d78a`, que também só mudou esta spec e o plano.
**Revisão R1 (2026-09-21, ao escrever o plano):** o código das quatro etapas foi escrito e testado numa cópia do repo antes do plano: o conform com mídia sintética e servidor numa porta de teste, a UI no navegador numa porta separada. Os testes acrescentaram dois achados e duas decisões: o mono da TRILHA/SFX sai 3 dB mais baixo no export (decisão 13) e o Player funde clipes idênticos empilhados (decisão 14). Também confirmaram o limite de áudio do Player. A mensagem do CONFORMAR ganhou um formato único ("fora do export: …"). As seções abaixo já refletem a revisão.
**Revisão R2 (2026-09-21, antes da execução), a partir de `mixagem-audio-reels.md`:** o usuário trouxe uma referência de níveis para Reels (voz, música e SFX, e −14 a −16 LUFS) e pediu um medidor de pico do master estilo Premiere. Conferido contra o código, o documento partia de premissas que não se confirmaram: não existe medição de LUFS no pipeline; as zonas de cor propostas pintavam de vermelho a voz no nível-alvo; o slider linear não alcança a faixa da música; e o master bus do preview não está ao alcance do app. A medição dos arquivos reais mostrou que a voz sai de 6 a 11 LU abaixo do alvo em todo projeto. Daí as decisões 15 a 20: o B1 mede LUFS, o B2 troca o slider por dB, o B3 mostra o LUFS, e entram duas etapas, **B4** (voz normalizada no ASSEMBLE) e **B5** (medidor de pico do master). As seções abaixo já refletem a revisão.
**Revisão R3 (2026-09-22, antes da execução), a partir de três requisitos do usuário:** um limitador no canal master com teto de −1,0 ou −2,0 dBTP, com folga para o AAC da plataforma; um limiter suave ou compressor na SFX para nenhum efeito passar de −10 dB no medidor de pico tradicional, salvo elemento dramático crucial; e LRA global entre 4 e 9 LU. Os testes no ffmpeg mostraram que o `alimiter` sozinho limita o pico de amostra, não o true peak, e que os dois AAC do próprio app (conform e Export) empurram o pico para cima: com teto −1 o arquivo chegou a +0,3 dBTP, com −2 ficou em −1,3. A medição dos arquivos reais mostrou LRA de 1,0 a 4,3 LU, abaixo da faixa pedida em quase todo reel com voz. Daí as decisões 21 a 26: o B1 ganha o limitador do master (−2 dBTP, com oversampling) e mede LRA e true peak; o B3 mostra os valores novos; o B4 passa a voz para TP −2; o B5 muda as zonas; e entra o **B6** (aviso de SFX acima de −10 dB no clipe). A SFX só é avisada, nunca processada. As seções abaixo já refletem a revisão.

---

## Contexto e problema

A TIMELINE tem uma track de música (`♫ TRILHA`) e nenhum lugar para efeito pontual (whoosh, impacto, riser): hoje ele precisa ser colado na TRILHA, sem mudo nem solo próprios. Os controles de áudio que existem são só de preview: o conform recebe a TRILHA inteira, então o arquivo exportado não soa como o que o usuário ouviu com um mudo ou solo ligado.

O B acrescenta a track SFX e transforma M/S em controles de mixagem de verdade: o que o preview toca é o que o conform entrega.

Na Revisão R2, o B passa a cuidar também do **nível**. A voz é o elemento principal de um Reel, e música e SFX se ajustam em relação a ela, dentro de −14 a −16 LUFS no arquivo final. Hoje o app não mede loudness, a voz que ele monta sai baixa demais, e não há onde ver o nível do mix enquanto se edita.

Na Revisão R3, o B cuida também da **folga**: o arquivo passa por três encodes AAC até o celular (conform, Export e a plataforma), e cada um pode empurrar o pico para cima. Hoje nada impede um pico acima de 0 dBFS de chegar ao Instagram.

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

(R3) A regra de −10 dB para efeitos (B6) marca os SFX de impacto desta tabela quando passam de −10: é o caso do "elemento dramático crucial", que quem edita mantém de propósito. Os SFX leves (−15 a −20) ficam sem marca.

A tabela é **referência para quem mixa**, não regra aplicada pelo app. O app mede e mostra (B1, B3, B5 e B6), normaliza só a voz na origem (B4) e, no mix, só aplica o limitador de segurança do master (R3, decisão 21).

**Correções ao documento, feitas pela verificação no código:**

| O documento dizia | O que o código mostrou | Como ficou |
|---|---|---|
| "o LUFS integrado continua sendo validado na exportação (pipeline FFmpeg/EBU R128 já existente)" | Não há `ebur128`, `loudnorm` nem medida de LUFS em `lib/`, `server.js`, `public/index.html`, `clipper/` ou `remotion/src`. O Export passa o áudio direto para AAC (`lib/encode.js:123`). | O conform passa a medir o LUFS (decisão 15). |
| Zonas: verde −60 a −18, amarelo −18 a −6, vermelho −6 a 0 | A voz no alvo (−3 a −5) cairia no vermelho "Saturação", e um mix correto apareceria vermelho quase o tempo todo. | Zonas amarradas aos limiares do conform (decisão 17). |
| Master bus: faixas → ganho de master → `AnalyserNode` L/R ao vivo; envelope pré-calculado só para o scrub | Na rota Player, todo o áudio passa pelo `AudioContext` interno do Remotion, que já chamou `createMediaElementSource` em cada elemento (só pode uma vez por elemento). Na rota canvas, não há grafo Web Audio. | Master calculado offline, servindo play e scrub nas duas rotas (decisão 16). |
| "Demo funcional validado" | Não há código de medidor no repo. | O B5 implementa a balística do documento. |
| (implícito) a voz já está no nível | Medidos com `ebur128`: a fixture `assembled-4545f906507a.mp4` em −25,4 LUFS (pico −8,3); outros arquivos do app em −21,9 a −22,3 LUFS (pico −9,5). | Voz normalizada no ASSEMBLE (decisão 19). |

### Requisitos da Revisão R3

| O usuário pediu | O que os testes mostraram | Como ficou |
|---|---|---|
| Limiter no master com teto de −1,0 ou −2,0 dBTP e folga para o AAC da plataforma | O `alimiter` do ffmpeg limita o pico de amostra: com o teto em −1, o true peak passou até 0,6 dB. Com oversampling 4× o teto fica exato. Depois dos dois AAC do app (conform a 192k, Export a 128k), o teto −1 chegou a +0,3 dBTP e o −2 ficou em −1,3. | Limitador no conform, com oversampling, teto **−2,0 dBTP** (decisões 21 e 22). |
| True peak de −1,0 a −2,0 dBTP | O arquivo do conform já é AAC, e o true peak dele pode passar do teto. | O conform mede o true peak do arquivo e avisa acima de −1 (decisão 23). |
| SFX: limiter suave ou compressor para nenhum efeito passar de −10 dB de pico, salvo elemento dramático crucial | O preview não consegue aplicar processamento, porque o master do Player está fora do alcance do app (decisão 16): um limiter só no export faria todo efeito alto soar até 10 dB mais forte no preview. "Dramático" é intenção, e o app não tem como saber. O slider em dB do B2 já dá o ajuste. | **Aviso no clipe** (B6, decisão 24). Nada é processado. |
| LRA global de 4 a 9 LU | Medido nos arquivos reais: vozes de TTS em 1,5 a 2,3 LU, a voz da fixture em 4,3, um reel baixado do Instagram em 3,3, voz com música por baixo em 1,7. | O LRA é sempre mostrado, com aviso **só acima de 9** (decisão 25). |

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
| Mixagem soma sem teto | `amix … normalize=0` (`lib/timeline.js:152-154`); Export passa o áudio direto para AAC sem loudnorm nem limitador (`lib/encode.js:123`) | Acima de 0 dBFS a distorção chega ao Instagram. Resolvido medindo e avisando (decisão 3); na R3, pelo limitador do master (decisão 21). |
| **Bug (export): mono sai 3 dB mais baixo** | `aformat=…:channel_layouts=stereo` na cadeia da TRILHA (`lib/timeline.js:149`): o ffmpeg converte mono em estéreo com `center_mix_level` de −3 dB, e o navegador toca mono nos dois canais sem atenuar | Medido no brainstorm: um tom mono de pico −18 dBFS saiu com RMS de −24,1 dB por canal no conform, onde o esperado era −21. Hoje afeta toda TRILHA mono; na SFX, arquivo mono é o comum. Resolvido na decisão 13. O plate não tem o problema: `lib/assemble.js:84` grava estéreo (`-ac 2`) e o preview toca esse mesmo arquivo. |
| **(R2) Nenhuma medida de loudness** | Busca por `ebur128`, `loudnorm`, `lufs` e `r128` em `lib/`, `server.js`, `public/index.html`, `clipper/` e `remotion/src`: nada. | O alvo de −14 a −16 LUFS não é verificado em lugar nenhum. |
| **(R2) A voz do app sai baixa** | `ebur128` nos arquivos de `output/`: fixture em −25,4 LUFS / pico −8,3 dBFS; `assembled-9680c0370b29.mp4` e `reel-05e8b68e4d84.mp4` em −21,9 / −9,5; `conformed-556f7c8f83b3.mp4` em −22,3 / −9,5. `lib/assemble.js` não normaliza (`:80-85`). | Só medir e avisar acusaria todo export sem dar como corrigir. |
| (R2) `ebur128` dá LUFS e pico numa passada | ffmpeg 6.1, `-af ebur128=peak=sample`: o resumo final traz `I: -25.4 LUFS` e, em `Sample peak`, `Peak: -8.3 dBFS`. Com silêncio digital, `I: -70.0 LUFS` e `Peak: -inf dBFS`. | Substitui o `astats` do B1. |
| (R2) loudnorm em duas passadas na voz da fixture | 1ª passada: `input_i -25.54`, `input_tp -8.33`, `input_lra 3.10`. 2ª com `linear=true`: `normalization_type dynamic` (o ganho de +9,5 dB levaria o pico a +1,2), saída medida em −16,0 LUFS, true peak −1,5, LRA 3,7. | Base da decisão 19. |
| (R2) Slider de ganho linear | `min 0 max 1 step 0.05` (`index.html:2165`). Entre −20 e −30 dB só há 0,10 (−20 dB) e 0,05 (−26 dB). | Não alcança a faixa da música (decisão 18). |
| (R2) Master do preview fora de alcance | O Player cria um `AudioContext` próprio com um `GainNode` de master (`remotion/dist/cjs/audio/use-audio-context.js:35-43`) e chama `createMediaElementSource` nos `<audio>` e no `<video>` (`shared-element-source-node.js:14`, `video/VideoForPreview.js`). Chegar nele exigiria `Internals.SharedAudioContext`, API interna. A rota canvas toca direto nos elementos, sem Web Audio. | Medidor por master offline (decisão 16). |
| (R2) O áudio decodificado é jogado fora | `loadWaveform` decodifica o vídeo base inteiro e guarda só os picos do canal 0 (`index.html:1626-1654`); `ensureMiniWave` faz o mesmo com cada clipe da TRILHA, com 200 colunas (`:1709-1728`). | O B5 passa a guardar os `AudioBuffer`. |
| (R2) Volume acima de 1 | O Player aceita, porque amplifica por `GainNode` (`use-amplification.js`); o `validate-media-props.js` só rejeita volume negativo. A rota canvas não passa de 1 (`HTMLMediaElement.volume`). | Ganho acima de 0 dB continua fora: o preview canvas não o reproduziria. |
| (R3) `alimiter` limita o pico de amostra, não o true peak | ffmpeg 6.1: um tom de 19 kHz com true peak de +3,7 dBFS saiu em +2,6 dBTP com `limit=0.891` (−1 dB). Em material real, com o teto em −1, o true peak passou até 0,6 dB. | O limitador precisa de oversampling (decisão 21). |
| (R3) Oversampling resolve | `aresample=176400,alimiter=…,aresample=44100`: true peak exato no teto em todo material testado. Com `latency=1`, a saída tem a mesma duração e lag 0 contra a entrada; sem limitação, a ida e volta difere no máximo −55 dBFS. Custo: +0,3 s em 47 s de áudio. | Cadeia do master (decisão 21). |
| (R3) Os dois AAC do app empurram o pico | Conform grava AAC 192k (`lib/timeline.js:173`); o Export recodifica em AAC 128k (`lib/encode.js:123`). Matriz: 4 fontes (voz + música do app, um reel baixado do Instagram, uma música, um vídeo de celular) × ganho 0/+3/+6 dB × teto −1/−2 × com e sem oversampling. Pior true peak depois de 192k + 128k: teto −1 com oversampling, **+0,3 dBTP**; teto −2 com oversampling, **−1,3 dBTP**. | Teto −2 (decisão 22). |
| (R3) Pico isolado do encoder AAC nativo | Duas vezes, com teto −1, o AAC 192k soltou um pico isolado de +4,4 e +5,0 dBTP: num dos arquivos, duas amostras num único ponto (t = 11,8 s), com a entrada limitada abaixo de −1 dBTP. Com teto −2, nunca. | Mais um motivo para −2; o `tpWarn` pega o caso no arquivo do conform. |
| (R3) LRA dos arquivos reais | `ebur128`: narrações de TTS em 1,5 a 2,3 LU; a fixture em 4,3; `assembled-167bbc84a983.mp4` em 3,4; um reel baixado do Instagram em 3,3; um clipe de 7 s enviado ao app em 1,0; uma narração normalizada com música por baixo em 1,7. | Aviso só acima de 9 (decisão 25). |
| (R3) loudnorm com TP −2 na voz | Fixture, `I=-16:TP=-2:LRA=9`: modo `dynamic`, saída em −16,0 LUFS, true peak −2,0, LRA 3,5. LRA 9 e LRA 11 deram saída idêntica na fixture e numa narração de TTS. | Base da decisão 22 para o B4. |
| (R3) Pico antes do limitador no mesmo ffmpeg | Um ramo `asplit` → `astats=measure_perchannel=none:measure_overall=Peak_level` → `anullsink` imprime `Peak level dB: -9.113448` no fim do stderr, em ponto flutuante (passa de 0 quando o mix passa). `runFfmpeg` entrega o stderr só por `onLog` (`lib/ffmpeg.js:57`). | O conform acumula o log e mede ali (decisão 23). |
| (R3) Ramo `anullsink` segura o ffmpeg com fonte sem fim | Com `anullsrc` sem duração na entrada e `-t 1` na saída, o grafo com o ramo `astats` → `anullsink` não terminou (morto pelo `timeout` depois de 20 s). Com a fonte limitada, termina na hora. | `atrim=end=<duração>` antes do `asplit` (seção do conform, item 5). |
| (R3) O limitador no conform real | Conforms com mídia sintética (ffmpeg 6.1): dois tons em escala cheia somando +6,0 dBFS saíram com `cutDb` 8,0 e true peak −2,0 dBTP no arquivo AAC 192k; sem o limitador, +6,4 dBTP. Um tom a −0,6 dBFS: corte 1,4 dB, true peak −2,0. 3 s altos e 3 s 20 dB abaixo: LRA 10,7 LU. Um clique a −0,9 dBFS em 2,000 s saiu em 2,000 s com e sem o limitador. | Base dos testes do B1. |

---

## Decisões tomadas no brainstorm

| # | Questão | Decisão |
|---|---|---|
| 1 | Preview × export | **Export = preview.** M e S vão para o sidecar e o conform aplica. A mensagem do CONFORMAR lista o que ficou de fora. **Na R3, com uma exceção declarada: o limitador do master, que só age acima do teto (decisão 21).** |
| 2 | H nas tracks de áudio | **Removido.** ÁUDIO, TRILHA e SFX ficam com M, S e L (+ `+` em TRILHA/SFX). H continua em MARKERS, B-ROLL e LEGENDA, só de preview. |
| 3 | Picos acima de 0 dBFS | **Medir e avisar.** O conform mede o pico do arquivo pronto e avisa; nada é processado. **Na R3, o limitador do master segura os picos (decisão 21) e o conform mede e avisa o resto (decisão 23).** |
| 4 | Corte em PRs | **B0 → B1 → B2 → B3**: bugs da TRILHA → servidor → lane SFX → controles de áudio. **Na R2, mais B4 → B5** (decisão 20); **na R3, mais B6** (decisão 26). |
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
| 15 | (R2) LUFS do export | **Medir e avisar**, como o pico (decisão 3). O conform mede LUFS integrado e pico de amostra numa passada de `ebur128`. Nada é processado no mix: o export continua igual ao preview. **Na R3, a mesma passada mede true peak e LRA (decisão 23), e o único processamento do mix é o limitador de segurança (decisão 21).** |
| 16 | (R2) Sinal do medidor | **Master offline.** O mix é renderizado num `OfflineAudioContext` com as regras do conform; um envelope de pico por frame serve play e scrub, nas duas rotas, e antecipa o pico do export. |
| 17 | (R2) Zonas de cor | **Amarradas ao conform:** verde abaixo de −6 dBFS, amarelo de −6 a −1 (a faixa da voz, −3 a −5), vermelho a partir de −1, o limiar do `'hot'`. O medidor e a mensagem do export usam os mesmos números. **Na R3, o vermelho começa no teto do master (−2) e passa a significar "o limitador corta aqui no export"; o amarelo vai de −6 a −2.** |
| 18 | (R2) Slider de ganho | **Em dB, de −40 a 0, passo de 0,5 dB**, com o valor no `title`. O sidecar continua guardando `volume` linear (`10^(dB/20)`). Sem ganho acima de 0 dB. |
| 19 | (R2) Voz baixa | **Normalizada no ASSEMBLE:** loudnorm em duas passadas, alvo −16 LUFS integrado e true peak −1,5 dBTP, `linear=true` (o loudnorm passa sozinho ao modo dinâmico quando o ganho fixo estouraria o teto). Sempre ligado, sem toggle na UI; `normalizeVoice: false` desliga pela API. Fail-soft. **Na R3, o alvo passa a true peak −2,0 dBTP e LRA 9 (decisão 22).** |
| 20 | (R2) Ordem | **B0 → B1 → B2 → B3 → B4 → B5.** O B4 é independente; fica perto do B5 para o medidor medir a voz normalizada na validação dele. **Na R3, mais B6 no fim (decisão 26).** |
| 21 | (R3) Limitador no master | **No conform, depois da soma:** `aresample=176400` → `alimiter` (teto −2 dBTP, `attack=5`, `release=50`, `level=disabled`, `latency=1`) → `aresample=44100`. Vale com ou sem TRILHA/SFX. Sempre ligado; `limiter: false` no corpo do conform desliga pela API, como o `normalizeVoice: false`. **É a exceção declarada à decisão 1:** o preview não passa pelo limitador (o master do Player está fora de alcance, decisão 16), então nos picos acima do teto o export soa mais contido que o preview. O medidor do B5 mostra onde isso acontece. |
| 22 | (R3) Teto | **−2,0 dBTP.** Com −1 o arquivo passou de 0 dBTP depois dos dois AAC do app; com −2 ficou em −1,3 no pior caso medido. A voz do B4 passa a sair em true peak −2,0 (e LRA 9, alinhado ao teto de LRA da decisão 25), para a voz sozinha nunca acionar o limitador. |
| 23 | (R3) Medição | O conform mede **o mix antes do limitador** (ramo `astats` no próprio grafo: `mixPeakDb`, o número do medidor) e **o arquivo** (a passada de `ebur128` passa a `peak=true`: LUFS, LRA e true peak). Avisos: `tpWarn` com true peak acima de −1 dBTP; `lraWarn` com LRA acima de 9 LU; e a mensagem pede para baixar TRILHA/SFX quando o limitador corta mais de 3 dB. `peakDb` e `peakWarn` saem. |
| 24 | (R3) SFX acima de −10 dB | **Aviso no clipe** (B6): um clipe de SFX com pico (trecho usado do arquivo × ganho) acima de −10 dBFS fica marcado, e a mensagem do CONFORMAR conta quantos vão para o export. Nada é processado: um limiter só no export faria o efeito soar até 10 dB mais forte no preview, e "elemento dramático" é decisão de quem edita, que pode deixar o aviso ali de propósito. |
| 25 | (R3) LRA | **Sempre mostrado; aviso só acima de 9 LU** (dinâmica demais para o alto-falante do celular). Abaixo de 4 não avisa: quase todo reel com voz mede entre 1,0 e 4,3. |
| 26 | (R3) Ordem | **B0 → B1 → B2 → B3 → B4 → B5 → B6.** O limitador e a medição entram no B1; a mensagem no B3; o alvo da voz no B4; as zonas no B5. O B6 vem por último porque usa o `audioBufCache` do B5. |

---

## Objetivo

- Uma track SFX abaixo da TRILHA, com clipes curtos, sobreponíveis, com ganho por clipe e as mesmas edições da TRILHA.
- Mudo e solo em ÁUDIO, TRILHA e SFX, com o mesmo efeito no preview e no arquivo exportado.
- O usuário sabe, ao conformar, o que ficou fora do export e se a mixagem vai distorcer.
- Os dois bugs de preview da TRILHA corrigidos, porque a SFX depende do mesmo código.
- (R2) O usuário sabe, ao conformar, o LUFS do arquivo contra o alvo de −14 a −16.
- (R2) A voz sai do ASSEMBLE no nível-alvo, e música e SFX se ajustam a ela com um slider em dB.
- (R2) Enquanto edita, o usuário vê o pico do master num medidor à direita da timeline, no play e no scrub, e o pico máximo do mix antes de conformar.
- (R3) O arquivo do conform nunca passa de −2 dBTP na saída do limitador, e o usuário sabe, ao conformar, o true peak do arquivo, o LRA e quanto o limitador cortou.
- (R3) Enquanto edita, o usuário vê quais efeitos da SFX passam de −10 dB de pico.

**Fora de escopo (deliberado):** normalização **do mix** para o alvo de loudness (a voz é normalizada na origem, decisão 19); limitador ou compressor por track, inclusive na SFX (decisão 24); limitador no preview; medir o true peak depois do Export (`lib/encode.js` fica intocado); LUFS estimado no navegador; ganho acima de 0 dB; slider de volume na ÁUDIO; fades e crossfades; H de B-ROLL/LEGENDA valer no export; atalhos de teclado para M/S; Pointer Events; sub-projetos C e D.

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

**`server.js`** — `/api/timeline/conform` (`:364-411`): `resolveClips(tl.sfx)` pelo mesmo `resolveInput` de B-ROLL e TRILHA (`:378-384`); `sfx` e `mix` passados ao `conform()` (`:400-406`); (R3) `limiter: b.limiter !== false`, do corpo da requisição.

**`lib/timeline.js`:**

1. `normalizeMix(mix)` e `audible(mix, track)`: puras, exportadas.
2. `conform()` aplica a regra **antes** do grafo:
   - `music` e `sfx` não audíveis viram `[]`, então não viram inputs do ffmpeg;
   - `hasAudio = !!info.acodec && audible(mix, 'audio')`. ÁUDIO muda cai no caminho `anullsrc` que já existe (`:124`), e a entrega continua com uma faixa AAC.
3. `buildConformGraph` ganha `sfx = []`. Ordem dos inputs: base, B-ROLL, TRILHA, SFX. Cada clipe de SFX recebe a cadeia da TRILHA (`atrim` → `aformat` → `volume` → `adelay`) com rótulo `[x${k}]`. O `amix` recebe `1 + music.length + sfx.length` entradas, ainda com `normalize=0`. Sem TRILHA nem SFX, continua `anull`. Um clipe com `channels === 1` (TRILHA ou SFX) ganha `pan=stereo|c0=c0|c1=c0` antes do `aformat` (decisão 13). `probeClips` passa a guardar `channels` nos clipes de áudio, vindo do `mediaInfo` (`lib/ffmpeg.js`, campo novo `channels: a.channels || 0`). Sem `channels` no clipe, nada muda: é o que mantém a não-regressão abaixo.
4. `buildConformArgs` acrescenta um `-i` por clipe de SFX, depois dos de TRILHA. O mesmo arquivo em cinco clipes vira cinco `-i`.
5. **(R3) Limitador do master** (decisões 21 e 22). `buildConformGraph` ganha `limiter = true`. Com ele, depois do `[aout]` (que sai do `amix` ou do `anull`), entra a cadeia do master, e o rótulo de áudio devolvido passa a `[amaster]`:
   ```
   [aout]atrim=end=<duração>,asplit=2[mpre][mlim];
   [mpre]astats=measure_perchannel=none:measure_overall=Peak_level,anullsink;
   [mlim]aresample=176400,alimiter=limit=0.794328:attack=5:release=50:level=disabled:latency=1,aresample=44100[amaster]
   ```
   - `atrim=end=<duração>` (a duração da timeline, com `ts()`) limita a soma. O ramo de medição só termina quando a entrada dele termina, e uma entrada sem fim segura o ffmpeg mesmo com `-t` (achado R3). Toda fonte de áudio do grafo já é finita; a guarda garante que um conform nunca trave por isso.
   - `limit=0.794328` é −2 dB (`10^(−2/20)`, seis casas). Com o oversampling 4×, o teto vale para o true peak.
   - `level=disabled` desliga o ganho automático, que o `alimiter` liga por padrão.
   - `latency=1` compensa o lookahead: a saída fica alinhada com o vídeo, com a mesma duração.
   - O ramo `astats` mede o pico do mix **antes** do limitador, em ponto flutuante.
   - `MASTER_CEIL_DB = -2` e `MASTER_LIMIT = '0.794328'` são constantes do módulo.
   Com `limiter: false`, nada disso entra e o rótulo continua `[aout]`. O `server.js` repassa `limiter: b.limiter !== false`, lido do corpo da requisição (não do sidecar), como o `normalizeVoice` do B4.
6. **(R3) Pico antes do limitador.** O `conform()` acumula o stderr do `runFfmpeg` principal num buffer local, pelo `onLog` que já passa (sem mudar `lib/ffmpeg.js`), guardando os últimos 16 000 caracteres. Uma função pura, `parseMixPeak(stderr) → number | null`, lê o último `Peak level dB:` do `astats`, com uma casa. `-inf` ou ausência dão `null`.
7. **Medição do arquivo (R2; R3):** depois do `runFfmpeg` principal, um segundo ffmpeg lê o arquivo pronto com `-af ebur128=peak=true -f null -`. Do resumo final saem o `I:` (LUFS integrado), o `LRA:` e, na seção `True peak`, o `Peak:` (true peak em dBTP). Mede o arquivo, porque é ele que o Export recebe. `measureLoudness(file, onLog) → Promise<{ lufs, lra, truePeakDb }>`. O parse fica numa função pura, `parseLoudness(stderr) → { lufs, lra, truePeakDb }`, testada com a saída real capturada. Silêncio digital (`I` ≤ −70, `Peak: -inf`) dá os três `null`. Se a medição falhar, os três saem `null` com uma linha de log; o conform não falha por isso. Três funções puras e exportadas classificam os valores: `loudWarnOf(lufs)` (R2), `tpWarnOf(truePeakDb)` e `lraWarnOf(lra)`.
8. Retorno ganha:
   - `sfx` (contagem de clipes usados);
   - (R3) `mixPeakDb`: pico de amostra do mix antes do limitador, uma casa; `null` com `limiter: false`, em silêncio ou se o parse falhar;
   - (R3) `limiter`: `{ ceilingDb: -2, cutDb }` com o limitador ligado, `null` com `limiter: false`. `cutDb = max(0, mixPeakDb − ceilingDb)`, uma casa, é o quanto o limitador cortou no pico mais alto (aproximado: ele age no true peak, e `mixPeakDb` é pico de amostra); `null` quando `mixPeakDb` é `null`;
   - (R3) `truePeakDb` (true peak do arquivo, uma casa) e `tpWarn`: `'over'` se `truePeakDb > -1`, senão `null`;
   - `lufs` (LUFS integrado, uma casa decimal) e `loudWarn`: `'low'` se `lufs < -16`, `'high'` se `lufs > -14`, senão `null` (também `null` com `lufs` nulo);
   - (R3) `lra` (uma casa) e `lraWarn`: `'high'` se `lra > 9`, senão `null`;
   - `excluded`: as tracks que tinham conteúdo e o `mix` silenciou. Conteúdo, para `audio`, é o plate ter faixa de áudio; para `music`/`sfx`, ter ao menos um clipe depois da normalização;
   - `mix`: o `mix` normalizado que foi aplicado.
   `peakDb` e `peakWarn` da R2 saem: com o limitador, o arquivo não passa de 0, e o número que o medidor do B5 compara passa a ser o `mixPeakDb`.
9. Log: `· N TRILHA · M SFX`, mais `· fora do export: …` quando `excluded` não estiver vazio, e uma linha com as medidas, com ponto decimal como o resto do log do servidor: `[conform] mix antes do limitador: -0.4 dBFS (corte 1.6 dB) · pico real: -2.1 dBTP · loudness: -14.8 LUFS · LRA: 3.2 LU` (`n/d` no lugar de um valor nulo; sem o trecho do limitador com `limiter: false`). Silêncio digital zera o LRA junto com o LUFS: com `lufs` nulo, `lra` também sai nulo.

O `mixPeakDb` fica no pico de **amostra** antes do limitador: é o mesmo número que o medidor do B5 mostra, medido antes do AAC, então medidor e conform comparam a mesma coisa.

**Não-regressão:** um sidecar sem `sfx` nem `mix`, conformado com `limiter: false`, produz `filter` e `args` idênticos, byte a byte, aos do `lib/timeline.js` de `c3c8012` para as mesmas entradas. Com o limitador ligado (o padrão), a única diferença é a cadeia do master depois do `[aout]` e o `-map` de áudio em `[amaster]`.

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
  - (R3) as medidas, nesta ordem: pico real, LUFS, LRA e limitador, conforme as tabelas abaixo.

A linha completa fica assim (R3):

```
timeline conformada — 38,2s · 0 B-ROLL · 1 TRILHA · 3 SFX · 120 palavras · pico real −2,1 dBTP · −14,8 LUFS · LRA 3,2 LU · limitador −1,6 dB
```

**(R3) Pico real**, do `truePeakDb`:

| `tpWarn` | Texto | Estilo |
|---|---|---|
| `null` | "· pico real −2,1 dBTP" | normal |
| `'over'` | "· pico real −0,6 dBTP — acima de −1 depois do AAC: abaixe TRILHA/SFX" | erro (`stage(msg, true)`) |
| `truePeakDb === null` | nada sobre pico | normal |

**(R2) LUFS**, sempre em cor normal (não quebra o arquivo):

| `loudWarn` | Texto |
|---|---|
| `null` | "· −15,2 LUFS" |
| `'low'` | "· −25,4 LUFS: abaixo do alvo −14 a −16" |
| `'high'` | "· −11,8 LUFS: acima do alvo −14 a −16" |
| `lufs === null` | nada sobre LUFS |

**(R3) LRA**, sempre em cor normal:

| `lraWarn` | Texto |
|---|---|
| `null` | "· LRA 3,2 LU" |
| `'high'` | "· LRA 11,4 LU: dinâmica alta para celular (ideal ≤ 9)" |
| `lra === null` | nada sobre LRA |

**(R3) Limitador**, do `limiter.cutDb`, sempre em cor normal:

| Situação | Texto |
|---|---|
| `cutDb > 3` | "· limitador −4,2 dB — mix alto: abaixe TRILHA/SFX" |
| `0 < cutDb ≤ 3` | "· limitador −1,6 dB" |
| `cutDb` igual a 0 ou nulo, ou `limiter === null` | nada sobre o limitador |

(R3) O trecho das medidas sai de uma função pura, `measuresMsg(r)`, que a checagem estática do B3 extrai do HTML e testa com resultados de conform montados à mão (sinal, vírgula decimal e cada limiar).

O limiar de 3 dB: acima disso, um limitador de pico costuma achatar os transientes de forma audível, e o recado útil é baixar a TRILHA/SFX em vez de deixar o limitador trabalhar. O estilo de erro fica reservado ao `tpWarn === 'over'`, o único caso em que o arquivo sai fora da faixa pedida.

---

## Voz normalizada no ASSEMBLE — `lib/assemble.js` e `server.js` (B4, Revisão R2)

**Alvo** (decisões 19 e 22): −16 LUFS integrado, true peak −2,0 dBTP, LRA 9. A voz em −16 deixa espaço para música e SFX levarem o mix para dentro de −14 a −16. O teto de −2,0 é o mesmo do limitador do master (R3): a voz sozinha nunca o aciona. O LRA 9 acompanha o teto de LRA da decisão 25; nas vozes testadas, a saída foi idêntica à de LRA 11. `VOICE_TARGET = 'I=-16:TP=-2:LRA=9'` (na R2, `I=-16:TP=-1.5:LRA=11`).

**`lib/assemble.js`:**

1. `assemble()` ganha `normalizeVoice = true`.
2. **Fonte da voz:** a narração (`voiceover`, input 1) quando existe; senão, o áudio do próprio `visual` (input 0), se `vInfo.acodec`. Sem nenhuma das duas, não há o que normalizar.
3. **1ª passada (medição):** `ffmpeg -i <fonte> -map 0:a:0 -af loudnorm=I=-16:TP=-2:LRA=9:print_format=json -f null -` (o `VOICE_TARGET`). Do bloco JSON impresso no stderr saem `input_i`, `input_tp`, `input_lra`, `input_thresh` e `target_offset`. Uma função pura, `parseLoudnormJson(stderr)`, faz o parse.
4. **2ª passada (aplicação):** no mesmo ffmpeg que já monta o MP4, entra `-af loudnorm=I=-16:TP=-2:LRA=9:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true:print_format=json`. O `-ar 44100 -ac 2` que já existe (`:84`) desfaz o reamostramento interno do loudnorm (192 kHz). Do JSON dessa passada saem `output_i` e `normalization_type` (`linear` ou `dynamic`).
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
- **Pico do mix inteiro**, em texto, abaixo do canvas (`#bt-meter-peak`): "−8,3", na cor da zona. (R3) O `title` diz: "pico do mix antes do limitador — acima de −2 o limitador do master corta no export; o CONFORMAR mede o mesmo".
- **Zonas** (decisão 17, R3): verde abaixo de −6 dBFS, amarelo de −6 a −2, vermelho a partir de −2, o teto do limitador do master: `meterZone(db)` é `db >= -2 ? 'red' : db >= -6 ? 'yellow' : 'green'`. A voz normalizada (pico −2,0) fica no limite do amarelo. Token novo `--meter-ok:#34d399` para o verde; o amarelo usa `--go` e o vermelho, `--bad`.
- **(R3) O que o medidor mede:** o mix **antes** do limitador, porque o preview também toca sem ele. O vermelho mostra onde o export vai soar diferente do preview. O motor não muda.
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

## Aviso de SFX acima de −10 dB (B6, Revisão R3)

Decisão 24. O "medidor de pico tradicional" da referência do usuário é o pico de amostra de cada efeito, isolado. O app já tem o arquivo decodificado (`audioBufCache`, do B5) e o ganho de cada clipe, então calcula esse pico sem processar nada.

- **Pico do trecho:** uma função pura, `regionPeak(buf, srcIn, dur)`, devolve o maior valor absoluto de amostra, entre todos os canais, no trecho `[srcIn, srcIn + dur)` do `AudioBuffer`, limitado ao tamanho do buffer. Fica em cache num `WeakMap` indexado pelo próprio `AudioBuffer` (`regionPeakCache`), com um `Map` de `srcIn|dur` → valor linear por buffer. Quando o `audioBufCache` solta um arquivo (`clearMediaCache`, `pruneMediaCache`), o cache dele some junto, sem mudar essas funções do B5.
- **Pico do clipe:** `clipPeakDb(c) = ampDb(regionPeak(buf, c.srcIn, c.dur) × c.volume)`, com o `ampDb` do B5. Devolve `null` enquanto o buffer não decodificou ou quando ele é `null` (arquivo que não decodifica).
- **Limiar:** `const SFX_PEAK_MAX = -10;`. Um clipe está acima quando `clipPeakDb(c) > SFX_PEAK_MAX`.
- **Marca no clipe:** em `renderClipTrack('sfx')`, um clipe acima ganha a classe `over`:
  - `.bt-clip.sfx.over{box-shadow:inset 0 0 0 1px var(--go)}`;
  - `.bt-clip.sfx.over .nm::before{content:'▲ '; color:var(--go)}`, para o aviso não depender só da cor;
  - o `div.bt-clip`, que hoje não tem `title` (`index.html:2179`), ganha um: "pico −4,2 dBFS — acima de −10; mantenha só se for um elemento dramático".
  Um clipe abaixo do limiar, ou com pico ainda desconhecido, fica sem a classe e sem o `title`.
- **Ao vivo:** o `input` do slider de ganho de um clipe de SFX recalcula o pico daquele clipe e troca a classe, o `title` e o `data-peak` no próprio elemento, sem re-render. O fim do `ensureMiniWave` já chama `renderTracks()`, então a marca aparece quando o buffer chega.
- **Mensagem do CONFORMAR:** ganha, no fim, "· 2 SFX acima de −10 dB", contando os clipes de SFX acima do limiar **quando a SFX é audível** (os que vão para o export). Sem nenhum, o trecho não aparece. Cor normal.
- **Só a SFX.** A TRILHA não recebe o aviso: a referência fala de efeitos, e a música tem a sua própria faixa (−20 a −30).
- **Ganchos de teste:** todo clipe de SFX com pico conhecido tem `data-peak`, em dBFS com uma casa, acima ou abaixo do limiar; sem pico conhecido, sem o atributo. O probe e o Orquestrador leem isso sem enxergar o closure.

**Onde toca:** só `public/index.html` e `public/dev/ui-probe.js` (estágio `B6`). Sem servidor e sem bundle.

---

## Etapas

| Etapa | Toca | Entrega |
|---|---|---|
| **B0** | `public/index.html` | Os dois bugs de preview da TRILHA. |
| **B1** | `lib/timeline.js`, `lib/ffmpeg.js`, `server.js` | Sidecar v4, SFX e `mix` no conform, mono sem os −3 dB, **limitador do master (−2 dBTP)**, medição do mix antes do limitador e do arquivo (**LUFS, LRA, true peak**). Nada na UI. |
| **B2** | `public/index.html`, `TimelinePreview.tsx`, `player-entry.tsx`, bundle, `ui-probe.js` | Lane SFX nas duas rotas, prop `audible`, teto de 16, **slider em dB**. |
| **B3** | `public/index.html`, `ui-probe.js` | M/S/L nas tracks de áudio, `MIX` persistido, mensagem do conform **com pico real, LUFS, LRA e limitador**. |
| **B4** | `lib/assemble.js`, `server.js`, `public/index.html` | Voz normalizada no ASSEMBLE (−16 LUFS, true peak −2,0 na R3). |
| **B5** | `public/index.html`, `ui-probe.js` | Medidor de pico do master, offline, à direita da timeline; vermelho a partir do teto do limitador (−2). |
| **B6** | `public/index.html`, `ui-probe.js` | Aviso nos clipes de SFX com pico acima de −10 dBFS, e a contagem na mensagem do conform. |

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
- (R3) `B6`, `sfx-peak`: em todo clipe de SFX com `data-peak`, a classe `over` e o `title` existem se e só se o pico passa de −10; um clipe sem pico conhecido não tem nenhum dos dois. Só lê: não depende de mídia de teste nem mexe no estado. Pôr um efeito alto, mexer no slider e dividir o clipe ficam nos passos do Orquestrador, com a mídia da Task 0 (`jobs/b-check/hit.wav`). `ORDER` ganha `B6`.

Todo check novo restaura o estado que alterou.

**B0:** checagem estática do plano. No navegador:
- **Rota canvas** (bundle bloqueado no DevTools, pelo usuário, como no A): o bug é reproduzido **antes** da mudança (clipe da TRILHA dividido, play na primeira metade, `<audio>` pausado) e verificado depois (`paused === false`).
- **Rota Player:** chamadas a `StudioPlayer.update` durante o arraste do slider, zero antes e maior que zero depois.

**B1 (Node, sem navegador):**
- `filter`/`args` idênticos aos de `c3c8012` em pelo menos quatro fixtures, **com `limiter: false`** (R3): sem clipes, com TRILHA, com B-ROLL + TRILHA, e com plate sem áudio.
- (R3) Com o limitador ligado (o padrão), nas mesmas fixtures: o `filter` é o de `limiter: false` seguido da cadeia do master exatamente como na seção do conform, e o `-map` de áudio aponta para `[amaster]`.
- `audible` nas 32 combinações de `mute` (8) × `solo` (4) contra a tabela esperada; `normalizeMix` com lixo (nomes desconhecidos, duplicatas, `solo` inválido, `mix` ausente).
- Conforms reais com mídia `lavfi`: base de 6s em silêncio; SFX com tom de 1 kHz em 2,0–2,5s; TRILHA com 440 Hz em 3,5–4,5s. O `astats` por janela (`atrim`) prova:
  - SFX presente na janela quando audível;
  - silêncio na janela com `mute: ['sfx']`;
  - com `solo: 'sfx'`, a janela da TRILHA em silêncio e a da SFX com som;
  - `excluded` correto em cada caso.
- Um tom mono de pico −18 dBFS sai com RMS acima de −22,5 dB por canal (≈ −21 dB duplicado; ≈ −24 dB com o upmix de −3 dB).
- (R3) **Limitador:** dois tons em escala cheia sobrepostos (o caso `'clip'` da R2) saem com `mixPeakDb > 0`, `limiter.cutDb > 2` e `truePeakDb ≤ −1` no arquivo, sem `tpWarn`. Com os tons de −18 dBFS, `limiter.cutDb === 0`. Com `limiter: false` e os mesmos tons altos, `limiter === null`, `mixPeakDb === null`, `truePeakDb > 0` e `tpWarn === 'over'`. Tudo mudo (silêncio digital): `mixPeakDb`, `truePeakDb`, `lufs` e `lra` nulos, `limiter.cutDb` nulo.
- (R3) **Alinhamento:** um clique de 1 amostra em 2,000 s, a −0,9 dBFS (acima do teto, então o limitador age nele), sai do conform em 2,000 s (±1 ms) com e sem o limitador: o `latency=1` compensa o lookahead.
- (R3) **Termina:** todo conform dos testes termina; a soma chega ao `asplit` limitada pelo `atrim`.
- `POST /api/beats` (servidor rodando) grava `version: 4` e saneia um `mix` inválido; um sidecar v3 conforma sem erro. (R3) `POST /api/timeline/conform` com `limiter: false` no corpo devolve `limiter: null`; sem o campo, devolve o objeto do limitador.
- (R2; R3) `parseLoudness` com a saída real do `ebur128=peak=true` capturada ao escrever o plano (fixture, tons, silêncio) e com saída truncada, que deve dar os três `null`. `parseMixPeak` com a saída real do `astats` (valor negativo, positivo e `-inf`) e sem ela. `loudWarnOf` nos limiares (−16,1 → `'low'`, −16 e −14 → `null`, −13,9 → `'high'`, `null` → `null`); `tpWarnOf` (−1 → `null`, −0,9 → `'over'`, `null` → `null`); `lraWarnOf` (9 → `null`, 9,1 → `'high'`, `null` → `null`). Nos conforms sintéticos: `lufs` numérico quando há som e `null` com tudo mudo; um caso `'low'`, um `'high'` e um dentro do alvo, com os níveis calibrados na cópia de teste; `lra` numérico; um caso com `lraWarn === 'high'` (um trecho alto e um baixo, 20 LU de diferença).

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
- a mensagem do CONFORMAR mostra a exclusão, o pico real, o LUFS e o LRA (R3); a fixture, em −25 LUFS, aparece "abaixo do alvo";
- (R3) com dois tons altos empilhados na TRILHA sobre a fixture, a mensagem mostra "limitador −X dB — mix alto" e o pico real fica entre −2 e −1 dBTP (o AAC do conform soma alguns décimos ao teto), sem estilo de erro. Medido na cópia de teste: corte de 8,4 dB, pico real −1,9 dBTP.

**B4 (Node, sem navegador, R2):**
- `parseLoudnormJson` com a saída real das duas passadas capturada no brainstorm, e com saída sem JSON, que dá `null`;
- ASSEMBLE real com legendas desligadas (sem Whisper): uma voz sintética a cerca de −30 LUFS sai em −16 ± 0,5 LUFS e true peak ≤ −1,9 dBTP (R3; era −1,4) (`ebur128=peak=true` no arquivo), e `voice.normalized === true`;
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
- **o medidor prevê o conform:** depois de CONFORMAR, `data-peak` e o `mixPeakDb` do resultado (R3; na R2, o `peakDb`) ficam a menos de 0,5 dB;
- (R3) `meterZone` nos limiares novos: −2,1 → amarelo, −2 → vermelho, −6,1 → verde, −6 → amarelo;
- `data-render-ms` do master da fixture é registrado (referência: abaixo de 1 s num reel de 38 s).

Medido na cópia de teste, ao escrever o plano da R2 (janela visível, 1280×800): `run('B5')` PASS nas duas rotas; `data-peak` −8,4 contra −8,3 do `ebur128` no arquivo; um whoosh isolado deu −18,1 no pico e no scrub, e −60 fora dele; o slider a −10 dB levou o pico a −28,1; tocando, a queda ficou em ~20 dB/s (pior intervalo 21,1 dB/s); o conform mediu −8,3 dBFS com o medidor em −8,4; o master de 38 s renderizou em 14 a 52 ms.

**B6 (navegador, duas rotas, R3):**
- `run('B6')` PASS;
- um whoosh a 0 dB aparece com `▲` e contorno; o `title` mostra o pico; o slider a −20 tira a marca na hora, sem re-render (a mesma referência de elemento continua no DOM);
- o `data-peak` do clipe bate com o pico do trecho medido pelo `astats` no próprio arquivo, mais o ganho (±0,2 dB);
- um clipe aparado para fora do trecho mais alto do arquivo muda o `data-peak` (o pico é do trecho, não do arquivo inteiro);
- a mensagem do CONFORMAR conta os clipes acima de −10 com a SFX audível e não os conta com a SFX muda.

Medido na cópia de teste, ao escrever o plano da R3 (janela visível, 1280×800, plano reaplicado de um clone limpo): `run('B6')` PASS nas duas rotas; um efeito de −3,1 dBFS a 0 dB marcado com `▲` e contorno, e o slider a −20 levou o `data-peak` a −23,1 e tirou a marca no mesmo elemento; dividido no trecho baixo do arquivo, as metades deram −3,1 (marcada) e −20,0 (sem marca); o medidor e o `mixPeakDb` do conform deram −1,6 e −1,6 com esse efeito sobre a voz (corte de 0,4 dB, pico real −2,0 dBTP), e 6,3 e 6,4 com dois tons altos empilhados (corte de 8,4 dB, pico real −1,9 dBTP, "mix alto"); a mensagem contou "1 SFX acima de −10 dB" com a SFX audível e nada com ela muda.

**Checklist manual do usuário** em B0, B2, B3, B4, B5 e B6, no formato do A:
- no B3, conformar com uma TRILHA alta e **ouvir o arquivo** contra o preview (R3: os picos saem contidos pelo limitador);
- no B4, **ouvir a voz antes e depois** (o modo dinâmico);
- no B5, olhar o medidor tocando e no scrub;
- no B6, ver o aviso aparecer e sumir com o slider.

---

## Guardrails

1. `lib/encode.js`, `lib/color.js` e a parte de vídeo do grafo do conform ficam intocados. `lib/ffmpeg.js` só ganha o campo `channels` no retorno de `mediaInfo` (R3: o pico antes do limitador é lido do log acumulado no próprio `lib/timeline.js`). (R2) `lib/assemble.js` só muda no áudio (B4): a cadeia de vídeo, a transcrição e o `.ass` ficam como estão.
2. `normalize=0` continua; o áudio de B-ROLL continua descartado.
3. Os handlers de arraste só ganham `'sfx'` nas listas e o mapa de hosts; nenhuma regra de arraste muda para as tracks existentes.
4. O Player continua sendo só preview; `POST /api/timeline/conform` continua o único caminho até o arquivo.
5. Nenhuma chave nova em `localStorage`; nenhuma dependência npm nova.
6. Todo caminho de clipe do sidecar continua passando por `resolveInput()`.
7. Sidecar antigo nunca gera erro de leitura.
8. (R2; reescrito na R3) O mix não é normalizado para o alvo de loudness. O único processamento do master é o limitador de segurança de true peak (−2 dBTP, decisão 21). O app mede (B1), mostra (B3, B5, B6) e normaliza só a voz na origem (B4).
9. (R2) O medidor não muda o que o preview toca: ele renderiza uma cópia do mix num contexto offline e nunca se liga ao áudio que está saindo.
10. (R3) Nenhum limitador, compressor ou ganho automático por track: a SFX só recebe aviso (B6), e o ganho de cada clipe continua sendo o do slider.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Mais de 16 áudios simultâneos no Player | Teto aplicado em `playerProps()` com aviso; o export não tem teto. |
| `ebur128` ou `astats` indisponível ou com saída diferente em outro build do ffmpeg | `mixPeakDb`, `truePeakDb`, `lufs` e `lra` nulos, log, e o conform segue. |
| (R3) `alimiter` ou `aresample` ausente no build do ffmpeg | Os dois fazem parte do ffmpeg padrão (libavfilter e libswresample). Se o conform falhar por causa da cadeia do master, o erro sai com o tail do ffmpeg como hoje, e `limiter: false` pela API contorna. Não há refazer automático sem o limitador: o arquivo sairia sem o teto sem ninguém pedir. |
| (R3) AAC passar do teto | Medido: com teto −2 e oversampling, o pior true peak depois dos AAC de 192k (conform) e 128k (Export) foi −1,3 dBTP. O `tpWarn` pega o caso no arquivo do conform (192k). O AAC de 128k do Export não é medido, porque `lib/encode.js` fica intocado. |
| (R3) Pico isolado do encoder AAC nativo | Visto duas vezes com teto −1, nunca com −2. Se aparecer no arquivo do conform, o `tpWarn` avisa com estilo de erro. |
| (R3) Limitador audível num mix alto | A mensagem pede para baixar TRILHA/SFX acima de 3 dB de corte, e o vermelho do medidor mostra os trechos. O checklist do B3 pede para ouvir o arquivo. |
| (R3) Export soar diferente do preview nos picos | É a exceção declarada da decisão 21. Só acontece acima do teto, onde o preview já estaria distorcendo, e o medidor mostra onde. |
| (R2) loudnorm em modo dinâmico mudar o caráter da voz | Medido: LRA de 3,1 para 3,7 LU na fixture. O `mode` sai no resultado e na mensagem, e o checklist do B4 pede para ouvir antes e depois. `normalizeVoice: false` desliga pela API. |
| (R2) Memória dos buffers decodificados do medidor | Vídeo base estéreo a 44,1 kHz ocupa ~13 MB em 38 s e ~60 MB em 3 min; aceitável para reels. O cache é liberado na troca de vídeo e ao remover um arquivo. |
| (R2) Render do master pesar durante o arraste | Atraso de 200 ms e descarte de renders velhos; o tempo de cada render fica em `data-render-ms`. |
| (R2) Medidor divergir do conform | Mesmas regras de mix (segmentos, ganhos, `audible`, mono duplicado, soma direta) e o mesmo pico de amostra; a verificação do B5 compara `data-peak` com o `mixPeakDb` do conform (±0,5 dB). Na R3 os dois são medidos antes do limitador e do AAC; sobra a diferença entre os decodificadores do navegador e do ffmpeg. |
| (R3) Pico do clipe de SFX divergir do export | O B6 mede o trecho do arquivo decodificado pelo navegador, sem a soma com outros efeitos (duplicar o mono não muda o pico). É o pico do efeito isolado, como pede a referência, não o da track somada; efeitos sobrepostos podem somar acima de −10 sem aviso. |
| Muitos `-i` num conform com dezenas de efeitos | Aceito: o ffmpeg abre um demuxer por input; o reel é curto. Reavaliar só com caso real. |
| Solo esquecido indo para o export | É a decisão 1; a mensagem do CONFORMAR diz o que ficou de fora. |
