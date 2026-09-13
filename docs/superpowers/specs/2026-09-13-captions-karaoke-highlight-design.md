# Design — Legendas karaokê com highlight semântico (Etapa 3)

**Data:** 2026-09-13
**Arquivos-alvo:** `styles/captions.json` (novo), `lib/captions.js` (presets viram dado, canal de destaque), `lib/keywords.js` (novo), `lib/llm.js` (novo — extração), `lib/clipper.js` (passa a importar `llmChat`), `lib/assemble.js` (passo de keyword + log de fonte), `lib/timeline.js` (`remapWords()` passa a preservar a marca), `server.js` (rota `GET /api/caption-styles`, `captionStyleOf()` corrigido, `POST /api/captions/word` com `hl`), `public/index.html` (select do ASSEMBLE, overlay do preview, toggle de keyword).
**Pré-requisito:** Etapas 0 a 2 de `docs/plans/remotion-player-and-tribe-removal.md` executadas e mergeadas (`fec460d`). O preview da TIMELINE roda no `@remotion/player`, a edição de palavra existe (`POST /api/captions/word`), e o overlay de legenda ao vivo (`.bt-cap-overlay`) é DOM, fora da composição Remotion — decisão da Etapa 2 que esta spec mantém.

---

## Contexto e problema

O roadmap de `remotion-player-and-tribe-removal.md` (seção "Etapas 3 a 5", marcada como não-executável) descreve legendas no estilo Hormozi/Submagic: 1–2 palavras por vez, sans pesada em itálico, fill branco com **uma palavra-chave por frase em laranja** (`#FF5200`), pop de escala por palavra.

Três obstáculos, levantados durante o brainstorm ao ler o código:

1. **O highlight já existe, mas é posicional.** `lib/captions.js:46` já pinta a palavra corrente com `S.accent` e aplica `\fscx108\fscy108`. Isso responde "qual destas quatro está sendo falada". O roadmap quer outra coisa — "qual destas é a importante" — que é julgamento semântico, não posição. São dois canais diferentes, e com 1 palavra na tela o posicional perde a função: não há contra o que contrastar.

2. **Estilo é código, não dado.** `STYLES` (`lib/captions.js:7-17`) é um objeto com dois presets hardcoded, e a UI do ASSEMBLE tem as opções escritas à mão no HTML com valores legados (`value="1"` = impact, `value="0"` = off). Acrescentar um preset hoje exige editar dois arquivos e o select continua fixo.

3. **A detecção de preset é heurística e quebra com presets novos.** `captionStyleOf()` (`server.js:281`) descobre qual estilo um `.ass` usou farejando o nome da fonte: `Arial Black` → `impact`, `Style: Word,Arial,` → `clean`, e qualquer outra coisa cai num `return 'impact'`. É usada em três lugares — ler legenda (`:294`), re-renderizar após editar palavra (`:310`) e o conform (`:344-358`). Com presets arbitrários, editar uma palavra num vídeo com preset novo re-renderizaria a legenda no estilo errado.

O terceiro não é escopo acrescentado: sem resolvê-lo, a feature nasce quebrada na interação que já existe.

---

## Objetivo

- Highlight **semântico** por frase: uma palavra-chave em `#FF5200`, escolhida por julgamento, renderizada deterministicamente.
- Presets de legenda viram **dado** (`styles/captions.json`), incluindo estrutura e não só paleta — acrescentar um preset passa a ser editar um JSON.
- **`impact` e `clean` não mudam.** Continuam existindo, `impact` continua sendo o default, e o `.ass` gerado para eles sai byte-a-byte igual ao de hoje.
- O preview da TIMELINE lê os mesmos tokens, para não divergir do que o export queima.

**Fora de escopo (deliberado):**

- **Item 5 do roadmap (zoom-punch sincronizado à keyword).** Não é ASS — é mudança no filtergraph de `lib/encode.js`, cuja ordem canônica é invariante documentado. Risco de natureza diferente; merece spec própria.
- **Item 2 (banner de gancho no topo).** Também é ASS e caberia tecnicamente, mas é elemento visual distinto (fundo arredondado, wrap de 2 linhas, camada própria). Engordaria a spec sem necessidade.
- **Botão "re-sugerir destaques" na TIMELINE.** A seleção roda só no ASSEMBLE. Consequência declarada em "Limitações conhecidas".
- **Legendas dentro da composição Remotion.** A Etapa 2 deixou o overlay em DOM de propósito, para não criar dois renderizadores reais. Esta spec mantém.
- **Detecção de fonte instalada.** Ver "Riscos declarados".

---

## Decisões tomadas no brainstorm

| Questão | Decisão |
|---|---|
| Rota técnica | **ASS estendido** — não asset com alpha do Remotion |
| Escopo | Itens 1 + 8 (legendas + tokens); zoom-punch e banner fora |
| Quem escolhe a keyword | **LLM quando configurado → heurística offline → override manual** |
| Quando roda | **No ASSEMBLE**, junto do transcript |
| Fidelidade do preview | Overlay DOM honrando os mesmos tokens |
| Estrutura dos presets | **O preset decide a estrutura** — `impact`/`clean` intactos, `realce` novo |
| Fonte do `realce` | **Montserrat Black Italic**, com requisito de instalação declarado |

---

## Abordagem escolhida

### 1. Modelo de dados

**`styles/captions.json`** — versionado no repo, editável pelo usuário. Carrega estrutura, não só cores:

```json
{
  "impact": {
    "font": "Arial Black", "size": 88, "bold": true, "italic": false,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 6, "shadow": 0,
    "layout":    { "maxWords": 4, "uppercase": true },
    "position":  { "align": 2, "marginV": 560 },
    "highlight": { "channel": "spoken", "color": "#FFFF00", "scale": 108 }
  },
  "clean": {
    "font": "Arial", "size": 72, "bold": true, "italic": false,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 4, "shadow": 1,
    "layout":    { "maxWords": 4, "uppercase": true },
    "position":  { "align": 2, "marginV": 520 },
    "highlight": { "channel": "spoken", "color": "#FFD700", "scale": 108 }
  },
  "realce": {
    "font": "Montserrat Black", "size": 96, "bold": true, "italic": true,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 4, "shadow": 1,
    "layout":    { "maxWords": 1, "uppercase": false },
    "position":  { "align": 5, "x": 540, "y": 1210 },
    "highlight": { "channel": "keyword", "color": "#FF5200", "scale": 100 },
    "enter":     { "fromScale": 80, "ms": 180 }
  }
}
```

`highlight.channel` é o interruptor estrutural — `spoken` (comportamento atual), `keyword` (semântico), `none` (sem destaque). É o campo que mantém os presets antigos intactos sem ramificação no código chamador.

Cores em **hex RGB**, convertidas para BGR do ASS na montagem. Ninguém escreve `&H000052FF` à mão; é onde erro silencioso mora.

**A marca no transcript.** As palavras de `jobs/<id>/transcript.json` (`{word, start, end}`, produzidas por `lib/transcribe.js:42`) ganham um campo **opcional** `hl: true`. Opcional é load-bearing: ausência significa "sem destaque", que é o comportamento atual.

Fica aí, e não em outro lugar, por duas razões concretas:
- `remapWords()` de `lib/timeline.js` já leva as palavras pelos cortes do conform, então a marca viaja pelo caminho que já existe, sem orquestração nova;
- `POST /api/captions/word` já edita esse arquivo — o toggle manual cai no lugar que existe.

**Atenção — não é de graça.** `remapWords()` (`lib/timeline.js`) monta as palavras de saída explicitamente:

```js
out.push({ word: w.word, start: ..., end: ... });
```

Campos extras **não** são copiados, então `hl` seria descartado em silêncio no conform — a legenda perderia os destaques exatamente nos vídeos editados na TIMELINE. A função precisa propagar a marca. É mudança de uma linha, mas precisa estar no plano; o critério de aceite 7 existe para provar que foi feita.

### 2. Seleção de keyword

**Onde:** `lib/assemble.js`, entre `transcribe()` e `writeAss()` (hoje linhas 36–38).

**Atrás de uma porta:** só roda se o preset escolhido tiver `highlight.channel === "keyword"`. Quem usa `impact`/`clean` não paga latência nem chamada de API por um destaque que o preset não desenha — o que preserva o "$0 por uso" do caminho atual.

**A unidade é o segmento do Whisper.** `lib/transcribe.js:45-46` normaliza `segments: [{start, end, text}]`, e `lib/assemble.js:41` grava o objeto inteiro — então as frases já estão persistidas em `transcript.json`. Não há segmentação nova a inventar. Segmento de ≤ 2 palavras não recebe destaque: colorir a única palavra da tela não destaca nada.

**Contrato com o LLM: índices, nunca palavras.** As palavras vão numeradas, a resposta são índices:

```
[0] 0:Uptime 1:não 2:é 3:sucesso
[1] 4:meça 5:resultados 6:reais
→ {"0": 3, "1": 5}
```

Pedir a palavra de volta seria ambíguo assim que uma se repetir na frase, e repetição é comum em fala. Índice é determinístico.

**Validação da resposta** — cada regra cobre uma falha esperada:

| Resposta do LLM | Ação |
|---|---|
| JSON não parseia | cai para a heurística offline (não para "sem destaque") |
| Índice fora do range do segmento | descarta aquele segmento |
| Mais de um índice por segmento | fica o primeiro |
| Índice aponta para stopword | descarta — destaque em "de" é pior que destaque nenhum |

Degradar para o tier de baixo, e não para nada, é o que mantém a cadeia coerente com o resto do app.

**Heurística offline**, por segmento, em ordem de prioridade: número ou numeral (`3x`, `80%`, `2026`) → palavra mais longa com ≥ 6 letras que não seja stopword → última palavra de conteúdo (posição de payoff) → nada. Lista de stopwords pt-BR/en inline, no espírito do `HOOK_PATTERNS` de `lib/clipper.js`.

**Refactor incluído:** `llmChat()` é hoje privado em `lib/clipper.js:99`. Fazer o módulo de legendas importar do clipper seria acoplamento torto — o clipper é uma feature, não biblioteca. Extrair para **`lib/llm.js`** sem alterar o corpo; `lib/clipper.js` passa a importar de lá. Comportamento idêntico, e `lib/keywords.js` depende de infraestrutura.

### 3. Render ASS

`buildAss` resolve o preset e ramifica num ponto só:

```js
const S = resolveStyle(style);
const lines = chunk(words, S.layout.maxWords);
switch (S.highlight.channel) {
  case 'spoken':  /* comportamento de hoje, intocado */
  case 'keyword': /* fill highlight.color se w.hl, primary caso contrário */
  case 'none':    /* sem destaque */
}
```

**Os canais não se misturam.** Com `channel: 'keyword'`, as palavras não marcadas saem em `primary` e a marcada em `highlight.color` — **sem nenhum tratamento posicional**, independente de `maxWords`. Um preset hipotético com `channel: 'keyword'` e `maxWords: 4` mostraria quatro palavras com só a keyword colorida, e nada indicando qual está sendo falada. É comportamento definido, não acidente: quem quer o indicador posicional usa `channel: 'spoken'`.

**Posicionamento tem duas formas, e a presença decide.** Se o preset traz `position.x`/`position.y`, cada evento sai com `\an<align>\pos(x,y)` inline. Se não traz, usa `position.marginV` no campo MarginV da linha `Style` com `Alignment` — que é o caminho de `impact`/`clean` e o que preserva o byte-a-byte.

Com `maxWords: 1` toda palavra fica sozinha na tela, então em `realce` o pop de escala vira animação de entrada:

```
{\an5\pos(540,1210)\fscx80\fscy80\t(0,180,\fscx100\fscy100)}PALAVRA
```

`\pos` em vez de `marginV` porque 63% da altura pede coordenada, não margem. `\t` dá ease-out — ASS não tem spring, então os "~180ms spring" da referência viram ease-out de 180ms.

**Conversão RGB → BGR.** ASS é `&HAABBGGRR`: `#RRGGBB` → `&H00` + `BB` + `GG` + `RR`. Conferido contra os constantes atuais:

| Hoje (`lib/captions.js`) | Hex | Volta como |
|---|---|---|
| `&H00FFFFFF` | `#FFFFFF` | `&H00FFFFFF` ✓ |
| `&H0000FFFF` (impact accent) | `#FFFF00` | `&H0000FFFF` ✓ |
| `&H0000D7FF` (clean accent) | `#FFD700` | `&H0000D7FF` ✓ |
| — | `#FF5200` | `&H000052FF` |

**Detecção de preset.** `buildAss` grava no `[Script Info]`:

```
; studio-style: realce
```

ASS ignora linhas `;`, então não altera render. `captionStyleOf()` lê essa linha primeiro e **mantém o farejamento de fonte como fallback**, para que os `.ass` já existentes no disco sigam reconhecidos.

### 4. Preview e UI

**Rota nova `GET /api/caption-styles`**, espelhando `GET /api/luts`: lê `styles/captions.json` e devolve. `GET /api/captions` já devolve `{words, style}` — o nome do preset chega de graça, falta só o overlay saber o que significa.

**Overlay** (`updatePreviewOverlay()`, `public/index.html` ~2094) passa a usar tokens:

| Token | Efeito |
|---|---|
| `layout.maxWords` | quantas palavras mostrar (hoje fixo: 2 antes + 2 depois) |
| `layout.uppercase`, `italic` | `text-transform`, `font-style` |
| `primary` / `highlight.color` | cor base e cor da palavra marcada |
| `position.y` | `top` proporcional, em vez do `bottom: 30px` fixo |

O preview tem `min(220px, 100%)` de largura, então posição é aproximada por construção — mas passa a estar no lugar certo em vez de sempre no rodapé.

**Select do ASSEMBLE** (`#asm-cap`) passa a ser montado da rota, com os nomes reais dos presets — o que também aposenta os valores legados `1`/`0`. Sem isso, acrescentar um preset ao JSON não apareceria na UI.

**Toggle manual.** `POST /api/captions/word` ganha um campo opcional `hl`. Mesma rota, mesma validação otimista (compara `index` + `start`, devolve 409 se o transcript mudou), mesmo re-render do `.ass` que ela já faz. A afordância na track LEGENDA fica especificada no plano, não aqui — é lá que o Executor precisa do DOM exato.

**Fonte visível.** `lib/assemble.js` loga o nome da fonte resolvida via `onLog`, para aparecer no console do job.

---

## Alternativas descartadas

- **Asset com canal alpha renderizado pelo Remotion, sobreposto após a grade.** Tecnicamente correto (preserva a ordem do filtergraph), mas custa um passo de render a mais, um ramo novo no filtergraph do export, e cria dois renderizadores de legenda que podem divergir. ASS estendido entrega o mesmo visual sem nenhum dos três.
- **Legendas queimadas pelo Remotion dentro do plate.** Descartada na análise do documento de origem: colocaria a legenda **antes** da LUT no filtergraph, e a LUT gradaria o texto — o `#FF5200` viraria outra cor conforme a LUT escolhida.
- **Canal único semântico, substituindo o posicional em todos os presets.** Mais simples, mais próximo da referência, mas mudaria o visual de quem já usa `impact`/`clean` — exports futuros deixariam de parecer com os passados. A opção por preset entrega o mesmo visual novo sem quebrar o antigo.
- **Dois canais simultâneos no mesmo preset** (posicional + semântico em linha de 4 palavras). Duas cores competindo pela mesma atenção, e não é o visual da referência.
- **Escolha de keyword só por LLM.** Quebraria a degradação graciosa: sem `LLM_BASE_URL`, a legenda perderia o destaque em silêncio.
- **Marca de keyword calculada no EXPORT, sem persistir.** Não seria editável nem sobreviveria ao conform, e contradiz a decisão de guardar a marca como dado por palavra.

---

## Limitações conhecidas

- **A marca nasce no ASSEMBLE.** Montar com `impact` e depois trocar para `realce` produz legenda sem marca nenhuma — todas as palavras brancas. O botão "re-sugerir" da TIMELINE resolveria e foi adiado de propósito; é consequência conhecida, não descuido.
- **Procedência da marca não é gravada** (`llm` / `offline` / `manual`). Como nada re-executa, nada pode atropelar uma marca manual. **Se o botão de re-sugerir entrar depois, procedência vira pré-requisito** — registrado aqui como condição.
- **O itálico é o da fonte, não um ângulo.** A referência cita 8–12° de inclinação; ASS não seta ângulo de shear de forma portável (`\fax` tem suporte variável em libass). Usa-se `Italic: 1` e a face itálica real da fonte.

---

## Riscos declarados

**Fonte ausente, substituição silenciosa.** `realce` pede `Montserrat Black Italic`. Se a fonte não estiver instalada no sistema, libass substitui por outra **sem avisar**, e o vídeo sai com tipografia errada — falha que só aparece depois de publicado.

Decisão tomada: o preset sai com Montserrat mesmo assim, porque o visual da referência é o objetivo, e a spec **declara o requisito de instalação** (README + comentário no próprio JSON). Detecção confiável de fonte instalada em Windows/macOS/Linux é buraco fundo e não vale nesta spec.

Mitigação: `lib/assemble.js` loga o nome da fonte pedida, então o console do job mostra o que foi solicitado. Não é verificação — é tornar visível o que seria invisível.

O mesmo vale para o preview: o CSS pede `Montserrat Black` e o navegador substitui em silêncio se não existir. Ao menos a falha é **consistente** entre preview e export — se o preview parecer errado, o export vai parecer errado igual.

**Divergência preview × libass.** Nenhum preview de navegador bate pixel-a-pixel com libass: métrica de fonte, kerning e quebra de linha diferem. O overlay é aproximação deliberada — mostra posição, cor, itálico e ritmo, não tipografia exata.

---

## Critérios de aceite (nível de spec)

O plano traduz cada um em comando verificável.

1. **Byte-a-byte:** para `impact` e `clean`, o `.ass` gerado a partir de uma lista fixa de palavras é idêntico ao produzido pelo código atual. Verificado por script descartável que gera os dois e roda `cmp` — o projeto não tem suite de testes nem pasta de fixtures, e inventar uma para isto seria escopo não pedido. Evidência colada no `## Status` do plano, que é o método usado nas Etapas 0 a 2.
2. **Default preservado:** sem `captionStyle` no corpo, `POST /api/assemble` continua usando `impact`.
3. **Conversão de cor:** os três constantes atuais voltam idênticos da conversão hex → BGR.
4. **Detecção exata:** um `.ass` gerado com `realce` é reconhecido como `realce` por `captionStyleOf()`; um `.ass` antigo, sem a linha de comentário, continua reconhecido pelo fallback de fonte.
5. **Cadeia de seleção:** sem `LLM_BASE_URL`, as marcas vêm da heurística offline; com resposta de LLM inválida, também.
6. **Porta de custo:** com preset `impact`, nenhuma chamada de LLM é feita.
7. **Marca sobrevive ao corte:** após `POST /api/timeline/conform` num vídeo com cortes, as palavras marcadas continuam marcadas e nos tempos reprojetados.
8. **UI:** o select do ASSEMBLE lista os presets de `styles/captions.json`; acrescentar um quarto preset ao JSON o faz aparecer sem tocar código.
