# Design — Limites de mídia nos clipes da TIMELINE (etapa B7)

Etapa seguinte ao sub-projeto B (mixagem de áudio, spec `2026-09-21-mixagem-audio-design.md`, etapas B0 a B6, PRs #18 a #26). Agendada pelo usuário durante a execução do B1, quando ele comparou o comportamento do trim com o Adobe Premiere, e ampliada ao fim do B6 com dois achados de legibilidade.

## Contexto e problema

O usuário reportou, ao testar o B1: "ao aumentar ou diminuir o clip TRILHA ou cortar no meio dentro da TIMELINE ele não corta o tempo de áudio e nem divide o áudio como funciona no Adobe Premiere Pro".

Diagnosticado na época: **o áudio é cortado e dividido corretamente**. A rota canvas busca `c.srcIn + (t − c.start)` e o conform usa `atrim` com os mesmos números; a divisão avança o `srcIn` da segunda metade pela duração da primeira. O que engana é a tela. Dois enganos, na verdade, e um terceiro apareceu depois:

1. **A mini-waveform desenha o arquivo inteiro** esticado na largura do clipe, sem olhar `srcIn` nem `dur`. Cortar um clipe no meio mostra as duas metades com o mesmo desenho — o do arquivo completo. A impressão é de que nada foi cortado.
2. **A borda direita não para no fim da mídia.** Um efeito de 0,8 s pode ser esticado até o fim da timeline; os 0,8 s iniciais tocam e o resto é cauda muda, sem nada na tela dizendo isso.
3. **Clipes já esticados demais ficam invisíveis.** Como o item 2 nunca teve trava, projetos salvos podem conter clipes com cauda muda, e não há como distingui-los de um clipe íntegro.

Ao testar o B6, o usuário reportou mais dois pontos, ambos investigados e concluídos como **não sendo defeito** (registro em `docs/plans/mixagem-audio.md`, seção `## Verificação`, Task 7, Step 9):

4. **O `▲` "aparece somente com o slider em 0,0 dB".** Medição: a marca acompanha o ganho com precisão, apagando ao cruzar −10 dBFS (num efeito de −3,1 dBFS, aceso até −6,5 dB de atenuação e apagado em −7). O sintoma vem de um efeito que pica pouco acima de −10 no trecho usado, onde meio decibel já cruza o limiar. O que impede entender isso é que **o `title` do clipe só existe quando ele está marcado** — sem marca, não há como ler o pico.
5. **O número do medidor de pico do master "fica estático fixo em −9,3".** Medição: com o som tocando, em 146 amostras a barra L assumiu 66 valores distintos e o número, 1 só. O número é, por decisão do B5, o pico do projeto inteiro antes do limitador — é o que o torna comparável ao `mixPeakDb` que o conform mede. Ele responde a edição, não a playhead: atenuando a SFX foi de −1,6 a −8,4 e parou ali, porque −8,4 é o pico da voz do próprio arquivo base (`astats` mede −8,343 na fixture; no projeto do usuário esse piso é −9,3). Correto, mas um número parado embaixo de uma barra que se move lê como leitura ao vivo quebrada.

## Achados no código (`24511db`)

| Achado | Onde | Consequência |
| --- | --- | --- |
| A track VÍDEO **já** trava o trim direito no fim da mídia: `endSrc = Math.max(origSrcIn + MIN_BEAT_DUR, Math.min(MEDIA_DUR, origEndSrc + dx))` | `startVideoTrim`, `public/index.html:3497` | Não há comportamento a inventar: esta etapa faz as tracks de clipe se comportarem como a VÍDEO já se comporta. É a referência. |
| A waveform grande **já** mapeia tempo de origem para coluna de pico: `Math.floor((src / MEDIA_DUR) * peaks.length)` | `public/index.html:1778-1779` | O padrão de janelar picos por tempo de origem também já existe no projeto. |
| `normalizeSegments` encurta segmento salvo contra `MEDIA_DUR` (`dur = Math.min(+s.dur \|\| 0, Math.max(0, MEDIA_DUR - srcIn))`) | `public/index.html:2177` | Precedente de saneamento na carga — mas só na VÍDEO, onde segmentos são consecutivos. Ver decisão 4. |
| `MEDIA_DUR` é a duração do **vídeo base**, só dele | `public/index.html:1324`, atribuído em `:3890` | Não serve às tracks de clipe: cada clipe aponta para um arquivo próprio. |
| `ensureMiniWave(path)` decodifica o arquivo, guarda o `AudioBuffer` em `audioBufCache` e 200 colunas de pico do **arquivo inteiro** em `miniWaveCache` | `public/index.html:1807-1829` | Duas caches com a mesma informação: as 200 colunas são deriváveis do buffer. |
| `drawPeaksToCanvas` mapeia `x/w` sobre o array **inteiro** | `public/index.html:1831-1843` | É esta linha que estica o arquivo na largura do clipe. |
| A mini-waveform é **só de áudio** (`if (isAudio)`); B-ROLL recebe thumbnail via `ensureThumbnail` | `public/index.html:2545-2554` | O item da waveform vale para TRILHA e SFX. Nessas tracks o `AudioBuffer` está sempre em memória. |
| `startClipTrim` calcula `lo = 0, hi = DURATION`, mais o vizinho no B-ROLL; a borda **esquerda** já trava na mídia (`lo = Math.max(lo, origStart - origSrcIn)`) | `public/index.html:3555-3576` | A trava do lado direito é o espelho de uma trava que já existe. A assimetria é o defeito. |
| A duração da mídia de um clipe existe em `assets[].info.duration`, e `const assets = []` é **só da sessão** | `public/index.html:981-982`, `:2519` | Clipe vindo do sidecar não tem duração. O clipe não a copia e o sidecar não a salva. |
| `POST /api/probe` devolve `mediaInfo(resolveInput(input))` de qualquer caminho | `server.js:229-232` | A duração é obtenível sem mudança de backend e sem mudança no sidecar. |
| `markSfxPeak` escreve `title` **só** quando `over` | `public/index.html`, bloco do B6 | Pico abaixo do limiar é invisível. É o achado 4 acima. |
| `updateMeterPeak` põe só o número em `#bt-meter-peak` (`el.textContent = fmtDb(pk)`) | `public/index.html`, bloco do B5 | O que ele significa está só no `title`. É o achado 5 acima. |
| Caches de mídia são limpas em dois pontos: por caminho quando o último clipe daquele arquivo sai, e todas no `loadVideo` | `public/index.html:1628`, `:1637` | Há onde pendurar a cache nova, sem inventar ciclo de vida. |
| `renderClipTrack` roda a cada frame de arraste (`onMove` o chama) | `public/index.html`, `startClipTrim`/`startClipDrag` | Qualquer cálculo novo por render tem de ter custo limitado. Ver decisão 2. |

## Decisões tomadas no brainstorm

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Fonte da duração da mídia | **`POST /api/probe`, uma vez por caminho, em cache** (abordagem B). Descartada a alternativa de tirar do `AudioBuffer` decodificado para áudio e do registro de assets para vídeo: a trava só existiria depois do decode, e depois de recarregar um projeto o registro de assets pode estar vazio — a borda ficaria solta justamente ao abrir projeto salvo. Uniforme vence esperto: um acessador, uma fonte, um caminho de código. O cache é semeado com `asset.info.duration` quando o clipe nasce de um asset, então o probe só acontece para clipe vindo do sidecar. |
| 2 | Picos da janela | **Calcular os picos de `[srcIn, srcIn+dur]` a partir do `AudioBuffer`**, com **teto de amostras visitadas** por janela. Descartado fatiar as 200 colunas do arquivo: um efeito de 0,8 s num arquivo de 3 minutos cai em uma coluna e um clipe de TRILHA de 3 s cai em três — viraria bloco sólido. O teto existe porque `renderClipTrack` roda a cada frame de arraste e o `dur` muda em todo frame: sem ele, esticar uma cama de 10 minutos varreria 26 milhões de amostras por frame. |
| 3 | Trim direito além da mídia | **Para dura**, como a track VÍDEO já faz e como o Premiere faz. Descartados o loop (mudaria `lib/timeline.js`, porque o conform teria de gerar o áudio repetido) e o "deixa passar e marca" como permissão para criar novos excessos. |
| 4 | Clipe salvo mais longo que a mídia | **Não encurtar na carga.** O precedente do `normalizeSegments` vale para a VÍDEO, onde segmentos são consecutivos e encurtar um empurra os seguintes. Nas tracks de clipe o `start` é absoluto: encurtar não moveria outro clipe nem mudaria uma amostra de áudio (o trecho removido é silêncio). Ainda assim, encurtar decidiria pelo usuário — ele pode ter esticado o clipe como marcador visual. Projeto salvo abre exatamente como foi salvo. |
| 5 | O excesso existente | **Mostrar, não corrigir.** O trecho além da mídia aparece **esmaecido com borda tracejada**. Fecha a assimetria que a decisão 4 deixaria: a trava impede criar o problema, a marcação torna o existente legível e corrigível com um gesto. Descartada a hachura diagonal: em clipe de 26 px de altura vira sujeira visual. O dado já está pago pela decisão 1. |
| 6 | Pico do clipe de SFX no `title` | **Sempre**, não só acima do limiar. A frase de aviso continua só acima de −10. É o que explica por que meio decibel de atenuação apaga a marca. |
| 7 | Número do medidor | **Prefixo na própria linha** (`projeto −9,3`), não legenda em linha separada: a coluna do medidor tem 44 px de largura e uma linha a mais come altura de barra. |
| 8 | Teste nas duas rotas de preview | **Só regressão na rota canvas, não o ciclo completo.** As etapas B0, B2, B3, B5 e B6 exigiram as duas porque mexiam em como o som toca, e as rotas tocam de formas diferentes. O B7 não toca em nenhuma das duas engines: waveform, trava, `title` e rótulo são DOM e canvas, idênticos nas duas. |

## Objetivo

O clipe na tela passa a dizer a verdade sobre a mídia que ele usa: a waveform mostra o trecho usado, a borda direita não passa do fim do arquivo, e o que já passa aparece marcado. Mais duas correções de legibilidade herdadas do B6.

Nada muda no conform, no export, no sidecar ou no servidor. Nenhum arquivo de `lib/` é tocado.

## Modelo de dados — a duração da mídia

Uma cache nova, ao lado das que já existem na TIMELINE:

```js
const mediaDur = new Map();   // path -> segundos | 'pending' | null
```

- `mediaDurOf(path) → número > 0 | null` — acessador síncrono. `null` para desconhecido, pendente, não-mídia ou probe falho.
- `ensureMediaDur(path)` — assíncrono, no formato do `ensureMiniWave` ao lado: sai se a cache já tem a chave, marca `'pending'`, chama `POST /api/probe` com o caminho do clipe **sem alterá-lo**, guarda `info.duration || null`, e no fim chama `renderBrollTrack()`, `renderMusicTrack()` e `renderSfxTrack()` — as três, porque a trava e a marcação valem nas três tracks de clipe — para elas enxergarem o valor que chegou.
- **Quem chama:** `renderClipTrack`, no mesmo laço de markup onde `ensureMiniWave(c.path)` e `ensureThumbnail(c.path)` já são chamados — um por clipe, e a cache descarta a repetição. Isso cobre de graça os dois casos que importam (projeto aberto do sidecar e clipe recém-criado) sem gancho novo no `loadVideo`, seguindo o padrão que as outras duas caches de mídia já estabeleceram.
- **Semeadura:** ao criar clipe a partir de um asset, a cache recebe `asset.info.duration` e nenhum probe acontece.
- **Limpeza:** `mediaDur.delete(path)` no mesmo ponto onde `audioBufCache.delete(path)` roda (`:1628`), e `mediaDur.clear()` no `loadVideo` (`:1637`).
- **`null` é resposta, não falha.** Quem consome trata `null` como "sem trava, sem janela, sem marcação" — o comportamento de hoje. A etapa degrada para o atual, nunca bloqueia edição esperando um probe.

O caminho enviado é o que o clipe já guarda, e é o `resolveInput` do servidor que decide se é legítimo — a mesma fronteira que o `POST /api/probe` já aplica a todo chamador.

## Mini-waveform da janela usada (TRILHA e SFX)

Uma função pura nova, com nome e assinatura estáveis para poder ser testada fora do navegador:

`windowPeaks(buf, srcIn, dur, cols) → Float32Array(cols)`

- Recorta `[srcIn, srcIn+dur]` em amostras, limitado por `buf.length`; devolve `cols` zeros quando a janela é vazia, negativa ou fora do buffer.
- Visita as amostras com um passo que mantém o total visitado sob um teto fixo, independente do tamanho da janela: **no máximo 256 amostras por coluna**, ou seja 51 200 visitas com as 200 colunas de hoje. O passo é `max(1, floor(amostrasDaColuna / 256))`. O pico de cada coluna é o pico das amostras visitadas — para uma waveform de 26 px de altura, indistinguível do pico exato.
- `cols` segue as 200 de hoje: já é mais fino que o passo de 2 px do desenho.

O resultado é memoizado por `path|srcIn|dur`, com `srcIn` e `dur` arredondados a 3 casas (milissegundo) para o memo não errar por ruído de ponto flutuante. Durante um arraste o `dur` muda a cada frame e o memo erra de propósito, o que é o caso que o teto de amostras existe para tornar barato.

**Simplificação que vem de brinde:** hoje `audioBufCache` e `miniWaveCache` guardam a mesma informação. Depois desta etapa sobra uma fonte — o `AudioBuffer` — e um memo da janela. O `miniWaveCache`, que hoje também serve de portão para mostrar o canvas, é substituído nessa função por "o `audioBufCache` tem buffer".

**Gancho de teste:** o canvas carrega a janela que desenhou em `data-win`, no formato `"<srcIn>,<dur>"` com 3 casas, e o check do probe compara com o `srcIn`/`dur` do clipe. Sem isso, "a waveform parece certa" não é critério verificável.

## Trava do trim direito

Em `startClipTrim`, lado direito, junto do `hi` que já existe:

```
mediaDur conhecido → hi = Math.min(hi, Math.max(origEnd, origStart + (mediaDur - origSrcIn)))
```

O `Math.max(origEnd, …)` veio de uma medição no Step 7 da Task 1: com a fórmula simples, pegar a borda direita de um clipe legado de 4 s sobre um arquivo de 0,8 s a levava de 240 px para 48 px num arraste de 60 px — a trava apagava 3,2 s no primeiro movimento. Isso contraria a decisão 4 (não mexer em projeto salvo sem o usuário pedir), então o teto passa a ser o maior entre o fim atual do clipe e o fim da mídia: impede crescer, deixa encurtar, e volta a ser o fim da mídia assim que o clipe cabe.

É o espelho exato da trava esquerda (`lo = Math.max(lo, origStart - origSrcIn)`) e a mesma forma do `Math.min(MEDIA_DUR, …)` da track VÍDEO. Vale nas três tracks de clipe: B-ROLL, TRILHA e SFX.

`hi` é calculado uma vez, no início do arraste. Se a duração ainda não chegou, aquele arraste sai sem trava e o próximo já tem — a etapa não bloqueia edição esperando rede.

## Excesso além da mídia, visível

Quando `mediaDurOf(path)` é conhecido e `srcIn + dur > mediaDur`, o clipe ganha uma sobreposição no trecho excedente: **esmaecida, com borda tracejada**, sem capturar mouse (a edição do clipe continua igual). A largura vem de `dur - (mediaDur - srcIn)` convertida em pixels pela mesma escala do clipe.

Só aparece em clipe salvo antes desta etapa ou editado sem a duração em cache: com a trava valendo, não há como criar um novo.

## Pico sempre no `title` do clipe de SFX

`markSfxPeak` passa a escrever `title` sempre que o pico é conhecido: o valor em dBFS, e a frase de aviso acrescentada só acima de `SFX_PEAK_MAX`. Pico desconhecido continua sem `title`. A classe `over`, o `▲` e o `data-peak` não mudam de regra.

## Rótulo no número do medidor

`#bt-meter-peak` passa a mostrar `projeto −9,3` em vez de `−9,3` — o prefixo literal `projeto ` antes do número, dizendo que aquilo é o pico do projeto inteiro e não uma leitura ao vivo. Sem pico conhecido, continua `—` sozinho, sem prefixo. O `title` existente continua, com a explicação longa. As classes de zona (`z-green`/`z-yellow`/`z-red`) e o `data-peak` não mudam: o probe e a checagem estática do B5 leem o `dataset`, não o texto.

## Etapas

| Etapa | O que entrega | Arquivos |
| --- | --- | --- |
| **B7a** | A cache de duração, a trava do trim direito e a marcação do excesso | `public/index.html`, `public/dev/ui-probe.js` |
| **B7b** | A mini-waveform da janela usada, com a simplificação das duas caches | `public/index.html`, `public/dev/ui-probe.js` |
| **B7c** | As duas correções de legibilidade do B6 (pico no `title`, rótulo no medidor) | `public/index.html`, `public/dev/ui-probe.js` |

Três etapas porque B7a e B7b têm risco diferente: a primeira mexe em edição, a segunda troca o desenho e mexe em cache. B7c é pequena e independente das outras duas — pode ir antes se convier.

## Verificação

**Checagem estática** (`jobs/checks/b7-static.js`, na família das existentes): âncoras dos pontos de código, invariantes do sub-projeto A (piso de 11px, sem duração literal de transição, scripts inline compilam) e **teste de unidade da parte pura**, extraindo `windowPeaks` do HTML e rodando contra um `AudioBuffer` falso:

- janela no começo, no meio e no fim do arquivo, contra picos calculados à mão;
- janela que passa do fim do buffer, `dur` zero e `dur` negativo → array de zeros, sem exceção e sem leitura fora do array;
- o teto de amostras valendo: uma janela de 10 minutos custa o mesmo que uma de 1 s (conta de chamadas ou tempo, não inspeção).

**Probe** (estágio `B7`): a janela desenhada no canvas conferida contra `srcIn`/`dur` do clipe; a trava conferida dirigindo eventos de mouse reais no puxador direito e vendo o `dur` parar no fim da mídia; a sobreposição do excesso presente e com as medidas certas num clipe montado de propósito além do fim.

**Rotas:** o teste novo roda na rota Player; a rota canvas recebe uma passada de regressão (`uiProbe.run('B7')` e o checklist), não o ciclo completo (decisão 8).

**Checklist manual:** itens 1–12 do sub-projeto A com o item 8 na forma da Task 4 do plano do B, mais: cortar um clipe de TRILHA ao meio e ver as duas metades com desenhos diferentes; esticar a borda direita de um efeito curto e ela parar no fim do arquivo; abrir um projeto antigo com clipe esticado demais e ver o trecho excedente esmaecido; passar o mouse num clipe de SFX abaixo de −10 e ler o pico; e o número do medidor deixando claro que é o do projeto.

## Fora de escopo

- **A track VÍDEO.** Já faz certo as duas coisas; é a referência desta etapa, não o alvo.
- **Waveform em B-ROLL.** Mostra thumbnail, não waveform.
- **Loop ao esticar além do fim** (decisão 3).
- **Encurtar clipe salvo na carga** (decisão 4). Se vier a ser desejável, é outra etapa e com aviso na tela, não silenciosa.
- **Qualquer mudança em `lib/`, `server.js` ou no sidecar.** A etapa é de interface e usa uma rota que já existe.

## Guardrails

1. `null` de duração nunca bloqueia edição: sem o dado, o comportamento é o de hoje.
2. Nenhum cálculo novo por render sem custo limitado — `renderClipTrack` roda a cada frame de arraste.
3. O caminho do clipe vai ao `POST /api/probe` sem alteração; a fronteira de path-safety segue sendo o `resolveInput` do servidor.
4. O `data-peak` e as classes de zona do medidor não mudam: são a superfície que o probe e as checagens do B5 e do B6 leem.
5. Projeto salvo abre como foi salvo. Nenhum saneamento silencioso de `dur` ou `srcIn` nas tracks de clipe.
6. A etapa não toca em `lib/timeline.js`: o que o conform exporta hoje continua igual, byte a byte, para a mesma timeline.

## Riscos

| Risco | Mitigação |
| --- | --- |
| O probe por clipe atrasa a abertura de projeto com muitos clipes | Um probe por **caminho distinto**, em paralelo com o resto da carga, e a UI não espera por ele: a trava e a marcação aparecem quando o valor chega. |
| O teto de amostras esconde um pico curto na waveform | É uma waveform de 26 px de altura, decorativa e de orientação. O pico que importa para decisão — o do clipe de SFX — vem do `regionPeak` do B6, que varre a janela inteira sem teto. |
| Trocar o portão do canvas de `miniWaveCache` para `audioBufCache` muda quando a waveform aparece | A checagem estática fixa os dois pontos, e o probe compara a janela desenhada. O `ensureMiniWave` continua sendo quem decodifica, então a ordem de chegada não muda. |
| A sobreposição do excesso confundir com a seleção do clipe | Contorno de seleção é sólido e no clipe inteiro; o excesso é tracejado e só no trecho final. O `▲` do B6 já estabeleceu o precedente de distinguir aviso de seleção. |
