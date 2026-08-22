# Design — Sensação de uso na timeline (camada A)

**Status:** design aprovado em brainstorm, aguardando revisão do usuário antes do plano de implementação.
**Data:** 2026-08-21
**Escopo:** camada A de três (ver "Decomposição" abaixo).
**Arquivo alvo:** `public/index.html` — exclusivamente. `server.js` e `lib/` não são tocados.
**Base:** commit `fd3ee70` (2313 linhas em `public/index.html`).

---

## 1. Objetivo

Aproximar o painel `04 TIMELINE` da sensação de uso de um editor não-linear real — especificamente o vocabulário de interação "CapCut-style" que o usuário identificou na referência [Timeline Studio](https://github.com/MartinDelophy/ai-video-editor) — sem alterar o pipeline de render nem a arquitetura do projeto.

O critério declarado pelo usuário: *"me atrai mais pela sensação de uso na timeline de edição, mas que seja compatível com o que já estou construindo"*.

## 2. Decomposição (contexto)

O pedido original abrangia três camadas cumulativas. Esta spec cobre **apenas a camada A**.

| Camada | Escopo | Modelo de dados | Pipeline `lib/` |
| --- | --- | --- | --- |
| **A** (esta spec) | Sensação de uso: snap magnético, guia de alinhamento, menu de contexto, dividir/duplicar/deletar clipe | Adição mínima e retrocompatível (`srcIn`) | Não toca |
| B (futuro) | Pista `VÍDEO` vira sequência editável de segmentos | Sim | Não toca |
| C (futuro) | Timeline vira fonte da verdade do render | Sim | Sim |

**Fato que motiva a decomposição, registrado para não se perder:** `grep -rn "beats" lib/*.js` não retorna nada. Nenhum módulo do pipeline lê o sidecar `.beats.json`. Os clipes de B-ROLL e TRILHA compositam **apenas no canvas de preview do browser**; o arquivo exportado por `lib/encode.js` não os contém. A camada A melhora a ferramenta de revisão; ela não faz a timeline chegar ao arquivo final. Isso é a camada C.

## 3. Referência estudada

A referência é React + TypeScript + Vite + WebCodecs — arquitetonicamente incompatível com este projeto (Node puro sem npm, SPA de arquivo único, vanilla JS). Portável é o **vocabulário de interação**, não a implementação.

Do mapa de capacidades da referência, o conjunto que define a sensação: *"CapCut-style snapping, alignment guides, clip menus, split/duplicate/delete, timeline zoom, undo/redo"*.

Comparação de modelos de pista — cinco das seis pistas já coincidem:

| Timeline Studio | Este projeto |
| --- | --- |
| Visuals (sequência **editável**) | `VÍDEO` (V1, clipe base **só-leitura**) — a única diferença estrutural; é a camada B |
| Overlays (PiP temporizado) | `B-ROLL` (V2) |
| Captions | `LEGENDA` |
| Voiceover / source audio | `ÁUDIO` |
| Music | `TRILHA` |
| — | `MARKERS` (beats narrativos) — não tem equivalente na referência |

Uma nota de campo dos docs da referência, que justifica priorizar o menu de contexto: após dividir um clipe muito curto, a seleção pela toolbar fica ambígua, e o menu de botão direito é o caminho confiável para operações com escopo de clipe.

## 4. Lacunas identificadas no código atual

| # | Lacuna | Evidência |
| --- | --- | --- |
| 1 | Guia de alinhamento nunca aparece | `.bt-snap-guide` existe em `public/index.html:331` e **não é referenciada em nenhum lugar do JS** |
| 2 | Snap ignora clipes e playhead | `snapTargets()` (`:1070`) devolve só `0`, `DURATION`, fronteiras de beat, `inPoint`, `outPoint` |
| 3 | Só a borda inicial do clipe é testada no arrasto | `startClipMove` (`:2003`) faz `snapTime(origStart + dx)` — a cauda nunca encaixa |
| 4 | Arrasto de grupo não tem snap nenhum | `startClipGroupMove` (`:2098`) só faz clamp, sem chamar `snapTime` |
| 5 | Sem menu de contexto | Nenhum listener de `contextmenu` no arquivo |
| 6 | Sem duplicar | Nenhuma operação de duplicação |
| 7 | Sem dividir clipe | `splitBeatAt` existe, mas só para beats |
| 8 | **Trim-in não apara a fonte** | `compositeTick:1650` faz `t - active.start`; sem offset de fonte, arrastar a borda esquerda apenas atrasa o clipe e ele segue tocando do zero |

A lacuna 8 é um **defeito pré-existente**, não uma ausência de recurso, e bloqueia a lacuna 7: um split sem offset de fonte produziria um jump cut de volta ao início da mídia.

## 5. Decisões tomadas no brainstorm

| Decisão | Escolha | Justificativa |
| --- | --- | --- |
| Alvo do menu de contexto | **Só clipes** (`B-ROLL`, `TRILHA`) | Beats ladrilham a duração inteira sem lacuna; "deletar" viraria "fundir com o vizinho" e "duplicar" não teria sentido. `MARKERS` mantém o fluxo atual (duplo-clique, `S`, `M`) |
| Sofisticação do snap | **Borda dupla + prioridade** | É o que produz a sensação magnética; testar só a cabeça deixa metade dos gestos de encaixe sem grudar |
| `srcIn` | **Entra na camada A** | Sem ele o DIVIDIR não pode funcionar corretamente, e o defeito 8 permaneceria. Adição mínima e retrocompatível |
| Desempate do snap | **Mais próximo vence; prioridade só desempata** (recomendação do orquestrador, aceita implicitamente) | Prioridade estrita faria uma fronteira a 1px perder para um playhead a 7px — ruim na mão. **Reversível na revisão desta spec** |
| Snap no arrasto de grupo | **Entra** (recomendação do orquestrador, aceita implicitamente) | Arrastar dois clipes selecionados não grudar em nada, enquanto arrastar um gruda, é exatamente o tipo de inconsistência que quebra a sensação. **Reversível na revisão desta spec** |

## 6. Arquitetura

Cinco unidades, cada uma com uma responsabilidade e uma fronteira clara. Todas vivem no IIFE da timeline em `public/index.html`, seguindo o padrão do arquivo — o projeto não tem bundler e a SPA é deliberadamente um arquivo só.

### 6.1 Motor de snap

**Responsabilidade:** dado um instante e um contexto, dizer a qual alvo ele deve grudar.

Hoje `snapTime(t)` (`:1077`) devolve só o tempo ajustado, o que impede saber *se* houve encaixe e *onde* desenhar a guia. A refatoração separa consulta de aplicação:

```js
// NOVO — devolve o alvo e a distância, ou null se nada estiver ao alcance
snapCandidate(t, opts) → { t: number, d: number, rank: number } | null

// snapTime vira casca fina sobre snapCandidate; comportamento padrão inalterado
snapTime(t, opts) → number
```

`snapTargets(opts)` passa a aceitar alvos **condicionais**. Sem `opts`, devolve exatamente a lista de hoje:

```js
snapTargets()                                     // idêntico ao atual
snapTargets({ clipEdges: true, playhead: true,
              exclude: new Set(['broll:2']) })    // arrasto de clipe
```

Cada alvo carrega um `rank` de prioridade: `playhead` = 0, borda de clipe = 1, fronteira de beat / `IN`/`OUT` / `0` / `DURATION` = 2.

**Regra de seleção:** vence o alvo de menor distância. Quando dois alvos estão a menos de `SNAP_TIE_PX` (2px, convertido para segundos por `PX_PER_SEC`) um do outro, vence o de menor `rank`.

**Por que os alvos são condicionais e não globais:** se o playhead entrasse na lista global, arrastar o próprio playhead o faria grudar em si mesmo e o scrub ficaria pegajoso. Régua (`onRulerMouseDown`), `onFlagMouseDown`, `splitBeatAt`, `startTrim` (beats), `markIn` e `markOut` continuam chamando `snapTime(t)` sem `opts` e mantêm comportamento **idêntico ao atual**.

**Auto-exclusão:** o clipe sendo arrastado precisa sair da lista de alvos, senão gruda nas próprias bordas e trava. Daí `exclude`, um `Set` de chaves `clipKey(track, i)` (`:965`).

### 6.2 Encaixe de borda dupla

**Responsabilidade:** durante o arrasto, escolher entre encaixar a cabeça ou a cauda do clipe.

Em `startClipMove` (`:2003`), a posição bruta `raw = origStart + dx` gera duas consultas:

```js
head = snapCandidate(raw, opts)            // posição resultante: head.t
tail = snapCandidate(raw + dur, opts)      // posição resultante: tail.t - dur
```

Vence o de menor `d` (com o desempate de rank da seção 6.1). O resultado passa pelo clamp de colisão `lo`/`hi` que já existe. **Se o clamp alterar o valor encaixado, o encaixe é descartado e a guia não aparece** — a guia nunca mente sobre onde o clipe vai parar.

Em `startClipGroupMove` (`:2098`), o mesmo mecanismo aplicado ao conjunto: a cabeça do clipe mais à esquerda e a cauda do mais à direita são os candidatos, e o deslocamento vencedor é aplicado a todos. Todos os clipes do grupo entram em `exclude`.

Em `startClipTrim` (`:2034`) não há borda dupla a escolher — cada alça já move a sua própria borda —, mas o trim passa a usar o **mesmo conjunto de alvos** (`clipEdges`, `playhead`, com auto-exclusão) e a **mesma guia**. Com bordas de clipe virando alvos, um trim que não grudasse nelas ficaria destoante do arrasto que gruda.

### 6.3 Guia de alinhamento

**Responsabilidade:** mostrar onde o encaixe aconteceu.

Reusa `.bt-snap-guide` (`:331`), hoje CSS morto. Um único elemento, criado no `mousedown` do arrasto e removido no `mouseup`:

```js
showSnapGuide(t)   // posiciona em 192 + timeToX(t), top 0, bottom 0, dentro de #bt-inner
hideSnapGuide()    // remove o elemento
```

O `192` é a largura fixa da coluna de rótulos, número mágico já repetido em `renderPlayhead`, `renderInOut`, `zoomAt` e `startBeatDrag`. **Não é refatorado nesta spec** — seria mudança ortogonal e ampliaria o risco.

### 6.4 Menu de contexto

**Responsabilidade:** expor operações com escopo de clipe.

Um listener de `contextmenu` em `#bt-tracks`:

```js
function onClipContextMenu(e) {
  const clipEl = e.target.closest('.bt-clip');
  if (!clipEl) return;              // sem preventDefault: menu nativo do Chrome segue funcionando
  e.preventDefault();
  // seleciona o clipe, depois abre o menu ancorado no cursor
}
```

**Só chama `preventDefault()` quando o alvo é um clipe.** Botão direito na régua, no fundo de uma pista, na pista `VÍDEO` ou em `MARKERS` continua abrindo o menu nativo do navegador.

Reusa a infraestrutura `.bt-pop` — mesma classe, mesmo ciclo de vida (`closePopover()` em `:1818`), mesma animação de entrada, mesma dispensa por clique fora. Três popovers já usam esse padrão (`openPopover`, `openAddClipPopover` em `:1562`, popover de palavra). Um componente novo seria mais código com sensação diferente.

Itens, nesta ordem:

| Item | Ação | Desabilitado quando |
| --- | --- | --- |
| `DIVIDIR NO PLAYHEAD` | `splitClipAt(track, i, video.currentTime)` | o playhead não está dentro do clipe com margem `MIN_BEAT_DUR` nas duas pontas |
| `DUPLICAR` | `duplicateClip(track, i)` | não há espaço livre (só B-ROLL, que não admite sobreposição) |
| `DELETAR` | reusa `deleteSelection()` (`:2084`) | nunca |

Item desabilitado é renderizado esmaecido e não clicável, não omitido — posição estável ensina o menu mais rápido do que um menu que muda de tamanho.

**Regra de seleção ao abrir o menu** (necessária porque `deleteSelection()` age sobre a multi-seleção quando ela existe, e sobre `selectedClip` quando não): se o clipe clicado **já pertence** à multi-seleção, ela é preservada e `DELETAR` remove o conjunto inteiro; se **não pertence**, a multi-seleção é limpa e só o clipe clicado passa a estar selecionado. É o comportamento padrão de NLE e evita o pior caso — botão direito num clipe apagar silenciosamente outros clipes fora de vista. `DIVIDIR` e `DUPLICAR` agem **sempre e só** sobre o clipe clicado, mesmo com multi-seleção ativa.

### 6.5 Offset de fonte (`srcIn`)

**Responsabilidade:** desacoplar "onde o clipe está na timeline" de "de onde ele toca na mídia".

Modelo do clipe passa de `{ path, name, start, dur }` (+ `volume` na trilha) para:

```js
{ path, name, start, dur, srcIn }        // B-ROLL
{ path, name, start, dur, volume, srcIn } // TRILHA
```

`srcIn` é o instante, em segundos, dentro do arquivo de origem em que o clipe começa. Default `0` — que reproduz exatamente o comportamento de hoje.

**Compositor** — **duas** linhas, uma por pista. `compositeTick` calcula tempo na fonte em dois pontos independentes, e ambos precisam do offset:

```js
// ramo do B-ROLL (`:1650`)
const target = (active.srcIn || 0) + (t - active.start);
// laço MUSIC.forEach (mais abaixo na mesma função)
const target = (c.srcIn || 0) + (t - c.start);
```

Os dois são obrigatórios porque `startClipTrim`, `splitClipAt` e `duplicateClip` são **código compartilhado** entre B-ROLL e TRILHA: um trim-in ou um split num clipe de música grava `srcIn` corretamente, e sem a segunda linha o áudio continuaria tocando a fonte a partir do zero — o defeito 8 reintroduzido só para a TRILHA.

> **Correção pós-revisão.** A primeira versão desta spec dizia "uma linha" e citava só o ramo do B-ROLL, porque os dois pontos usam nomes de variável diferentes (`active.start` e `c.start`). O plano herdou o furo, a asserção de verificação checava só a primeira variante, e o defeito passou pela execução. Foi encontrado na revisão do diff e corrigido.

**Trim-in passa a aparar de verdade.** Em `startClipTrim` (`:2034`), no ramo `side === 'left'`:

```js
c.start = t;
c.dur = origEnd - t;
c.srcIn = origSrcIn + (t - origStart);   // NOVO
```

com o limite inferior do arrasto elevado para `Math.max(lo, origStart - origSrcIn)` — não se pode esticar o clipe para antes do início da mídia, como em qualquer NLE.

**Split fica contínuo:**

```js
arr.splice(i, 1,
  { ...c, dur: d1 },
  { ...c, start: t, dur: c.dur - d1, srcIn: (c.srcIn || 0) + d1 });
```

**Limitação assumida e declarada:** o clipe não armazena a duração da mídia de origem, então não há como impedir que o trim da borda direita ultrapasse o fim do arquivo. Isso já é verdade hoje e **não é resolvido nesta spec**; resolver exigiria sondar e persistir `srcDur`, o que pertence à camada B.

## 7. Fluxo de dados e persistência

```
mousedown no clipe
   └─> startClipMove / startClipGroupMove / startClipTrim
         └─> snapCandidate(raw, {clipEdges, playhead, exclude})
               └─> snapTargets(opts) ── alvos com rank
         └─> clamp lo/hi (colisão, já existente)
         └─> showSnapGuide(alvo) | hideSnapGuide()
         └─> renderClipTrack()
mouseup
   └─> hideSnapGuide()
   └─> snapshot()          ← entra no undo/redo existente
```

**Undo/redo não muda.** `snapshot()` serializa com `JSON.parse(JSON.stringify(...))` e `applyHistEntry` (`:1035-1036`) clona os arrays inteiros — `srcIn` viaja junto automaticamente.

**O `server.js` não muda.** O handler `POST /api/beats` repassa `b.broll` e `b.music` como arrays inteiros, sem inspecionar os campos.

**Seis mapeamentos de cliente precisam do campo.** Este é o ponto de falha silenciosa mais provável de todo o design: cada um faz whitelist explícita de campos e descartaria `srcIn` sem erro, produzindo o sintoma "funciona na sessão, some ao recarregar".

| Local | Linha (em `fd3ee70`) | Direção |
| --- | --- | --- |
| `saveBeats` — broll | 1251 | escrita |
| `saveBeats` — music | 1252 | escrita |
| `applySavedBeats` — broll | 1260 | leitura |
| `applySavedBeats` — music | 1261 | leitura |
| `loadVideo` — broll | 2248 | leitura |
| `loadVideo` — music | 2249 | leitura |

Nas leituras: `srcIn: c.srcIn || 0`. **Retrocompatibilidade:** sidecar gravado antes desta mudança não tem o campo, lê como `0`, e o comportamento é idêntico ao atual. Sidecar novo lido por versão antiga do app ignora o campo — degradação suave, sem erro.

`addClipAt` (`:1479`) passa a criar clipes com `srcIn: 0` explícito.

## 8. Tratamento de erro

O painel não tem exceções esperadas — todas as operações são locais e síncronas. As condições de contorno são tratadas por prevenção, não por captura:

| Condição | Tratamento |
| --- | --- |
| Dividir com playhead fora do clipe | Item desabilitado no menu; `splitClipAt` também valida e retorna sem efeito |
| Dividir gerando fragmento menor que `MIN_BEAT_DUR` (0.15s) | Mesma validação — margem exigida nas duas pontas |
| Duplicar sem espaço livre no B-ROLL | Item desabilitado; se acionado por outro caminho, `stage('sem espaço livre…', true)` — mesmo padrão de `addClipAt` (`:1484`) |
| Trim-in tentando ir antes do início da mídia | Clamp `srcIn ≥ 0` |
| Pista travada (`lockedTracks`) | Guarda já existente no início de cada handler de arrasto; o menu de contexto ganha a mesma guarda |
| Clipe removido enquanto o menu está aberto | `closePopover()` no início de cada ação, e as ações revalidam o índice antes de mutar |

## 9. Verificação

O projeto não tem suíte de testes (nem frontend nem backend) e não terá uma introduzida por esta camada — seria uma decisão de infraestrutura ortogonal ao objetivo. A verificação segue o padrão estabelecido no ciclo anterior (`docs/plans/timeline-markers-track.md`), que se mostrou eficaz: asserções programáticas sobre o próprio HTML, mais checklist manual de browser com resultados esperados explícitos.

**Asserções programáticas** — para cada tarefa do plano, um bloco `node -e` verificando presença das funções novas, ausência dos padrões antigos, e as invariantes que não podem quebrar (`snapTime(t)` sem `opts` continua existindo; `server.js` intocado; CRLF preservado).

**Verificação de sintaxe** — `new Function` sobre o `<script>` inline, que compila sem executar.

**Checklist de browser** — os comportamentos que asserção estática não alcança, com resultado esperado item a item:

1. Arrastar clipe de B-ROLL até perto da cauda de outro: gruda, guia amarela aparece.
2. Arrastar até que a **cauda** encoste na cabeça de outro: gruda (é a lacuna 3).
3. Arrastar até perto do playhead: gruda em qualquer das duas bordas.
4. Arrastar um clipe sozinho no meio da timeline: não gruda em si mesmo, não trava.
5. Arrastar com Shift-seleção múltipla: o grupo gruda, mantendo os espaçamentos internos.
6. Arrastar até o limite de colisão: clipe para, e a guia **não** aparece.
7. Botão direito num clipe: menu abre; em régua/`VÍDEO`/`MARKERS`/fundo de pista: menu do Chrome.
8. `DIVIDIR NO PLAYHEAD` com playhead dentro: gera dois clipes; **o preview atravessa o corte sem salto** (valida `srcIn`).
9. `DIVIDIR` com playhead fora: item esmaecido.
10. `DUPLICAR`: cópia na próxima lacuna livre; sem lacuna, item esmaecido.
11. `DELETAR`: remove; `Ctrl+Z` restaura.
12. Arrastar a borda **esquerda** de um clipe de B-ROLL: o preview passa a entrar mais adiante na mídia (valida o conserto da lacuna 8), e não é possível esticar antes do início.
13. `SALVAR BEATS` → recarregar → `CARREGAR`: `srcIn` sobrevive; inspecionar o `.beats.json` e confirmar o campo.
14. Carregar um `.beats.json` **gravado antes desta mudança**: abre sem erro, clipes com `srcIn` 0.
15. Régua, `MARKERS`, `IN`/`OUT`, `SPLIT`/`MERGE` de beat, JKL, zoom: comportamento idêntico ao de antes.
16. Console do browser: sem erros novos.

O item 15 é o mais importante: ele verifica que a refatoração de `snapTime` não vazou para os chamadores que deveriam permanecer inalterados.

## 10. Fora de escopo

- Renderizar b-roll/trilha no arquivo exportado (camada C).
- Tornar a pista `VÍDEO` editável (camada B).
- Persistir a duração da mídia de origem (`srcDur`) e travar o trim no fim do arquivo.
- Ripple, roll, slip e slide; transições; pistas dinâmicas.
- Refatorar o número mágico `192`, extrair o JS/CSS inline, ou introduzir suíte de testes.
- Alterar atalhos de teclado existentes, a pista `MARKERS`, ou o comportamento padrão de `snapTime(t)`.
- Corrigir o defeito pré-existente do `requestAnimationFrame` sobre `popEl` já nulo em `openPopover` / `openAddClipPopover` / popover de palavra — registrado, mas ortogonal.

## 11. Riscos

| Risco | Mitigação |
| --- | --- |
| A refatoração de `snapTime` vazar para régua/beats/IN-OUT | `opts` opcional com default que reproduz a lista de hoje; item 15 do checklist verifica explicitamente |
| `srcIn` sumir na persistência | Os seis mapeamentos estão enumerados na seção 7; itens 13 e 14 do checklist verificam |
| Guia visual divergir de onde o clipe realmente para | Guia só aparece quando o encaixe sobrevive ao clamp; item 6 do checklist |
| Menu de contexto sequestrar o botão direito da página | `preventDefault()` condicionado ao alvo ser `.bt-clip`; item 7 do checklist |
| Clipe grudar em si mesmo | `exclude` com a chave do clipe arrastado; item 4 do checklist |
