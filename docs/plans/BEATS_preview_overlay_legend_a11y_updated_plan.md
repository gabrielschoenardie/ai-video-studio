# Plano — BEATS: preview overlay, coluna de legenda, responsividade e acessibilidade dos controles de track

**Owner (Orquestrador):** todas as seções exceto `## Status`.  
**Executor:** `## Status` apenas.

## Pré-requisito

Todos os planos de BEATS anteriores devem estar executados e commitados até:

`14f8e94`

Incluindo:

- `beat-timeline-editor`
- `beats-premium-polish`
- `beats-track-height-fix`
- `beats-timeline-zoom-resize`
- `beats-timeline-thumbnails-multiselect`
- `beats-broll-compositor`
- `word-caption-editing`
- `beats-codec-fallback-message`

Este plano é **cosmético, responsivo e de acessibilidade**. Não altera modelo de dados, rotas, persistência nem mecânica de edição.

---

## Auditoria — evidência medida no DOM real

A auditoria visual foi realizada renderizando `public/index.html` do repositório, com harness offline que serve `/api/probe`, `/api/captions`, `/api/beats` e `/files/*` sintéticos.

Cenário auditado:

- `duration = 28.4s`
- 6 beats
- 33 palavras
- 3 clipes de B-ROLL
- 1 clipe de TRILHA
- zero erros de console durante a auditoria
- as 5 tracks, régua, waveform, playhead, zoom, popover, thumbnails, overlay de legenda e linha ativa da lista de papéis renderizaram e funcionaram

### Defeitos medidos

#### 1. Legenda ao vivo colide com o timecode do preview

Com o playhead em `t=10.2`:

- `.bt-cap-overlay` mede `right: 468px`
- `.bt-preview-time` começa em `left: 415px`
- as caixas se sobrepõem verticalmente (`bottom` 239 vs 245)

Visualmente, a última palavra da legenda pode ficar atrás ou na mesma faixa do `00:10.2`.

Causa atual:

- `.bt-cap-overlay` usa `width:90%`, `bottom:14px`
- `.bt-preview-time` usa `bottom:8px`

#### 2. `.bt-preview` não quebra em telas estreitas

Medição atual:

```js
getComputedStyle(document.querySelector('.bt-preview')).flexWrap === 'nowrap'
```

Estrutura atual:

- `.bt-video-wrap`: `width:220px; flex:0 0 auto`
- `.bt-legend`: `min-width:200px`

Logo, em container estreito, vídeo + legenda + gap exigem aproximadamente `220px + 200px + 14px`, gerando overflow horizontal em vez de empilhamento.

#### 3. A coluna da lista de papéis não tem teto de largura

Em viewport largo:

- `.bt-legend` mediu **1665px**
- `.bt-legend-row .bar` mediu aproximadamente **1583px**
- a lista é um índice curto de papéis e não deve crescer indefinidamente

#### 4. Os 14 controles de track não são acessíveis

`document.querySelectorAll('.bt-tctl')` encontra **14 botões**:

- BEATS: 2
- ÁUDIO: 2
- LEGENDA: 2
- B-ROLL: 3
- TRILHA: 5

Total: **14**

Todos estão atualmente sem `aria-label` e com caixa de aproximadamente **15×15px**.

Importante: estes 14 controles existentes devem ser preservados exatamente. Este plano **não adiciona, remove ou reordena controles**.

#### 5. A coluna de track label tem geometria crítica

A coluna `.bt-track-label` possui largura fixa de **192px**.

A régua também usa essa geometria, portanto **não é permitido aumentar, reduzir ou deslocar essa coluna** como solução para os controles maiores.

As alturas iniciais das tracks são:

```js
{
  beats: 44,
  audio: 44,
  legend: 44,
  broll: 44,
  music: 44
}
```

com `TRACK_MIN_H = 44`.

---

# Escopo

**Modificar somente:**

`public/index.html`

**Não tocar:**

- `server.js`
- `lib/`
- modelo de dados
- rotas
- persistência
- mecânica de edição
- handlers de split/merge/trim/drag/snap/undo/redo/zoom/multiselect/thumbnails/compositing

Nenhuma classe fora do prefixo `bt-` deve ser criada ou alterada.

Exceções permitidas:

- adicionar `aria-label` aos 14 botões `.bt-tctl` existentes
- alterar apenas CSS existente com prefixo `bt-` relacionado às quatro correções

### Regra crítica

**Não alterar a largura da coluna `.bt-track-label`: ela deve permanecer em 192px.**

Não criar uma nova coluna de controles, não mover a régua, não alterar `margin-left:192px` da régua e não alterar `left:-192px` do canto da régua.

---

# Task 1 — Separar visualmente legenda e timecode

## Objetivo

Garantir que a legenda ao vivo nunca compartilhe a mesma faixa vertical do timecode.

## Alteração CSS

Substituir:

```css
.bt-preview-time{position:absolute;bottom:8px;right:8px;font:400 9.5px var(--mono);color:var(--dim);
  background:rgba(0,0,0,.5);padding:2px 6px;border-radius:3px;z-index:3}
.bt-cap-overlay{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);width:90%;text-align:center;
  font:400 13px 'Unica One',sans-serif;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.85);z-index:3}
```

por:

```css
.bt-preview-time{position:absolute;bottom:8px;right:8px;font:400 9.5px var(--mono);color:var(--dim);
  background:rgba(0,0,0,.5);padding:2px 6px;border-radius:3px;z-index:4}
.bt-cap-overlay{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);width:90%;text-align:center;
  font:400 13px 'Unica One',sans-serif;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.85);z-index:3}
```

## Regra de comportamento

Não alterar:

- conteúdo das legendas
- lógica de `updatePreviewOverlay()`
- cálculo da palavra ativa
- timecode
- `z-index` de outros elementos

## Acceptance

Com o playhead em uma palavra ativa:

```js
const a = $q('#bt-cap-overlay').getBoundingClientRect();
const b = $q('.bt-preview-time').getBoundingClientRect();
a.bottom < b.top
```

deve resultar em:

```text
true
```

Executar esse teste em pelo menos:

- legenda de 1 linha
- legenda de 2 linhas
- legenda de 3 linhas
- estado sem legenda visível

O resultado esperado é que a legenda não se sobreponha verticalmente ao timecode.

---

# Task 2 — `.bt-preview` responsivo e coluna de legenda limitada

## Objetivo

Eliminar overflow horizontal em container estreito e impedir que a coluna de papéis cresça indefinidamente.

## Alteração 1 — preview

Substituir:

```css
.bt-preview{display:flex; gap:14px}
```

por:

```css
.bt-preview{display:flex; gap:14px; flex-wrap:wrap}
```

## Alteração 2 — vídeo não pode ultrapassar o container

A regra atual:

```css
.bt-video-wrap{width:220px; flex:0 0 auto; ...}
```

deve preservar o máximo visual de 220px, mas permitir redução quando o próprio container for menor.

Usar:

```css
.bt-video-wrap{width:min(220px,100%); flex:0 0 auto; background:#000; border:1px solid var(--line);
  border-radius:var(--radius-sm); overflow:hidden; aspect-ratio:9/16}
```

Não alterar:

- proporção 9:16
- `object-fit:contain`
- comportamento do vídeo

## Alteração 3 — legenda

Substituir:

```css
.bt-legend{flex:1; display:flex; flex-direction:column; gap:6px; min-width:200px}
```

por:

```css
.bt-legend{flex:1 1 200px; display:flex; flex-direction:column; gap:6px;
  min-width:200px; max-width:420px}
```

O `max-width:420px` resolve o crescimento indefinido da lista e limita a largura das barras de progresso.

## Acceptance — responsividade

Com o container do preview abaixo de aproximadamente 440px:

```js
const p = $q('.bt-preview');
p.scrollWidth <= p.clientWidth
```

deve ser:

```text
true
```

Além disso:

```js
const video = $q('.bt-video-wrap');
const preview = $q('.bt-preview');

video.getBoundingClientRect().width <=
preview.getBoundingClientRect().width
```

deve ser:

```text
true
```

Em viewport largo (>=1600px):

```js
Math.round($q('.bt-legend').getBoundingClientRect().width) <= 420
```

deve ser:

```text
true
```

E a barra:

```js
$q('.bt-legend-row .bar')
```

deve acompanhar a largura limitada do item da legenda, sem atravessar a viewport inteira.

---

# Task 3 — `aria-label` nos 14 controles existentes

## Objetivo

Dar nome acessível e contextual a cada botão para leitores de tela.

## Regra crítica

Existem exatamente **14 `.bt-tctl`**.

**Não adicionar, remover ou reordenar nenhum controle.**

Apenas adicionar `aria-label` aos botões existentes.

A distribuição obrigatória é:

```text
BEATS      2
ÁUDIO      2
LEGENDA    2
B-ROLL     3
TRILHA     5
TOTAL     14
```

## Labels obrigatórios

### BEATS

```html
<button class="bt-tctl" data-act="hide"
  title="ocultar"
  aria-label="Ocultar track BEATS">H</button>

<button class="bt-tctl" data-act="lock"
  title="travar"
  aria-label="Travar track BEATS">L</button>
```

### ÁUDIO

```html
<button class="bt-tctl" data-act="hide"
  title="ocultar"
  aria-label="Ocultar track ÁUDIO">H</button>

<button class="bt-tctl" data-act="lock"
  title="travar"
  aria-label="Travar track ÁUDIO">L</button>
```

### LEGENDA

```html
<button class="bt-tctl" data-act="hide"
  title="ocultar"
  aria-label="Ocultar track LEGENDA">H</button>

<button class="bt-tctl" data-act="lock"
  title="travar"
  aria-label="Travar track LEGENDA">L</button>
```

### B-ROLL

```html
<button class="bt-tctl" data-act="add"
  title="adicionar clipe"
  aria-label="Adicionar clipe à track B-ROLL">+</button>

<button class="bt-tctl" data-act="hide"
  title="ocultar"
  aria-label="Ocultar track B-ROLL">H</button>

<button class="bt-tctl" data-act="lock"
  title="travar"
  aria-label="Travar track B-ROLL">L</button>
```

### TRILHA

```html
<button class="bt-tctl" data-act="add"
  title="adicionar clipe"
  aria-label="Adicionar clipe à track TRILHA">+</button>

<button class="bt-tctl" data-act="mute"
  title="mudo"
  aria-label="Silenciar trilha TRILHA">M</button>

<button class="bt-tctl" data-act="solo"
  title="solo"
  aria-label="Ativar solo da trilha TRILHA">S</button>

<button class="bt-tctl" data-act="hide"
  title="ocultar"
  aria-label="Ocultar track TRILHA">H</button>

<button class="bt-tctl" data-act="lock"
  title="travar"
  aria-label="Travar track TRILHA">L</button>
```

Não remover os `title` existentes.

## Acceptance — quantidade e nomes

Executar:

```js
const controls = [...document.querySelectorAll('.bt-tctl')];

({
  total: controls.length,
  missingLabels: controls.filter(
    b => !b.getAttribute('aria-label')?.trim()
  ).length,
  duplicateLabels:
    controls.length -
    new Set(controls.map(
      b => b.getAttribute('aria-label')
    )).size
})
```

Resultado obrigatório:

```js
{
  total: 14,
  missingLabels: 0,
  duplicateLabels: 0
}
```

Também verificar:

```js
controls.every(b => b.getAttribute('title'))
```

Resultado:

```text
true
```

---

# Task 4 — Aumentar o alvo clicável sem alterar a geometria da timeline

## Objetivo

Eliminar os alvos extremamente pequenos de 15×15px.

## Regra de segurança

**Não aumentar, reduzir ou deslocar a `.bt-track-label`.**

Ela deve permanecer:

```css
width:192px;
```

A posição da régua e do conteúdo da timeline deve permanecer inalterada.

## Tamanho dos controles

Substituir a regra atual:

```css
.bt-tctl{all:unset; flex:0 0 auto; cursor:pointer; color:var(--faint); font:700 8.5px var(--mono);
  width:15px; height:15px; border-radius:3px; display:flex; align-items:center; justify-content:center}
```

por:

```css
.bt-tctl{all:unset; flex:0 0 auto; cursor:pointer; color:var(--faint); font:700 9px var(--mono);
  width:24px; height:24px; border-radius:3px; display:flex; align-items:center; justify-content:center;
  transition:color .15s ease, background .15s ease}
.bt-tctl:focus-visible{outline:2px solid var(--go); outline-offset:1px}
```

## Ajuste interno permitido

Se os 5 controles da TRILHA não couberem confortavelmente dentro dos 192px, ajustar **somente o espaçamento interno** da própria `.bt-track-label`.

É permitido reduzir o `gap` e/ou os paddings internos, por exemplo:

```css
.bt-track-label{
  gap:4px;
  padding:0 6px;
}
```

Somente aplicar o ajuste necessário para acomodar os controles.

### É proibido:

- alterar `width:192px`
- criar outra coluna
- deslocar os controles para fora da coluna
- alterar a origem da régua
- alterar `margin-left:192px`
- alterar `left:-192px`
- alterar `trackHeights` apenas para acomodar os botões
- criar overflow horizontal oculto como “solução”

## Validação de dimensões

Executar:

```js
const controls = [...document.querySelectorAll('.bt-tctl')];

controls.map(b => {
  const r = b.getBoundingClientRect();
  return {
    width: Math.round(r.width),
    height: Math.round(r.height)
  };
})
```

Os 14 controles devem retornar:

```text
24 × 24
```

todos eles.

## Validação de overflow

Executar:

```js
[...document.querySelectorAll('.bt-track-label')]
  .every(el => el.scrollWidth <= el.clientWidth)
```

Resultado:

```text
true
```

A largura da coluna deve permanecer:

```js
Math.round(
  $q('.bt-track-label').getBoundingClientRect().width
) === 192
```

Resultado:

```text
true
```

## Validação da geometria da timeline

Antes e depois da mudança, registrar:

```js
const before = {
  ruler: $q('.bt-ruler').getBoundingClientRect().x,
  beats: $q('#bt-track-beats').getBoundingClientRect().x,
  audio: $q('#bt-track-audio').getBoundingClientRect().x,
  legend: $q('#bt-track-legend').getBoundingClientRect().x,
  broll: $q('#bt-track-broll').getBoundingClientRect().x,
  music: $q('#bt-track-music').getBoundingClientRect().x
};
```

Depois da mudança:

```js
const after = {
  ruler: $q('.bt-ruler').getBoundingClientRect().x,
  beats: $q('#bt-track-beats').getBoundingClientRect().x,
  audio: $q('#bt-track-audio').getBoundingClientRect().x,
  legend: $q('#bt-track-legend').getBoundingClientRect().x,
  broll: $q('#bt-track-broll').getBoundingClientRect().x,
  music: $q('#bt-track-music').getBoundingClientRect().x
};
```

Todos os valores devem permanecer iguais, dentro de uma tolerância máxima de **1px**.

---

# Task 5 — Foco e navegação por teclado

## Objetivo

Garantir que o ganho de acessibilidade não fique apenas no `aria-label`.

Os 14 controles continuam sendo elementos `<button>`.

## Acceptance

Com teclado:

1. `Tab` deve alcançar os 14 controles.
2. Cada controle deve apresentar foco visível.
3. `Enter`/`Space` deve continuar acionando o comportamento existente.
4. Não criar handlers JavaScript novos para substituir o comportamento nativo dos `<button>`.

Validar também que o foco não fique invisível após as mudanças.

---

# Restrições de implementação

Durante este plano:

### Pode alterar

- CSS de `.bt-preview`
- CSS de `.bt-video-wrap`
- CSS de `.bt-legend`
- CSS de `.bt-preview-time`
- CSS de `.bt-cap-overlay`
- CSS de `.bt-tctl`
- eventualmente `gap`/`padding` interno de `.bt-track-label`
- `aria-label` dos 14 botões `.bt-tctl`

### Não pode alterar

- `server.js`
- `lib/`
- estrutura do modelo de dados
- rotas
- endpoints
- persistência
- funções de edição
- `wireTracks()`
- `updatePreviewOverlay()`
- handlers de drag/trim/split/merge/snap
- undo/redo
- zoom
- multiselect
- thumbnails
- compositing
- SALVAR BEATS
- CARREGAR

---

# Validação final obrigatória

## 1. Diff

```bash
git diff --stat
```

Esperado:

```text
somente public/index.html
```

Também executar:

```bash
git diff -- public/index.html
```

e confirmar que as alterações correspondem exclusivamente às Tasks 1–5.

## 2. JavaScript do servidor

```bash
node --check server.js
```

Esperado:

```text
exit 0
```

`server.js` não pode ter sido modificado.

## 3. Sintaxe do script da página

Extrair o `<script>` de `public/index.html` e executar:

```js
new Function(scriptText)
```

Esperado:

```text
sem SyntaxError
```

## 4. Zero erros de console

Abrir BEATS e confirmar:

```text
0 erros no console
```

## 5. Preview

Confirmar:

- legenda não encobre timecode
- legenda de 1, 2 e 3 linhas permanece legível
- vídeo e legenda empilham em viewport estreita
- nenhum overflow horizontal no `.bt-preview`
- legenda nunca ultrapassa `420px` em viewport largo

## 6. Controles

Confirmar:

```text
14 controles existentes
14 aria-label
0 aria-label ausentes
0 aria-label duplicados
14 × 24×24
0 overflow na coluna
```

## 7. Geometria da timeline

Confirmar que não mudou:

- largura de `.bt-track-label` = `192px`
- posição X da régua
- posição X das 5 tracks
- alinhamento do playhead
- origem do snap

Tolerância máxima:

```text
1px
```

## 8. Regressão funcional

Verificar manualmente que continuam funcionando como antes:

- split
- merge
- trim
- drag/reorder
- snap
- undo
- redo
- zoom
- multiselect
- thumbnails
- B-ROLL
- TRILHA
- compositing ao vivo
- `SALVAR BEATS`
- `CARREGAR`

Nenhuma dessas mecânicas deve ter sido reescrita.

---

# Critério de conclusão

O plano só pode ser considerado **CONCLUÍDO** quando todos os itens abaixo forem verdadeiros:

```text
[ ] Task 1 concluída
[ ] Task 2 concluída
[ ] Task 3 concluída
[ ] Task 4 concluída
[ ] Task 5 concluída

[ ] 14 controles existentes
[ ] 14 aria-label
[ ] 0 labels ausentes
[ ] 0 labels duplicados
[ ] 14 controles = 24×24
[ ] nenhum overflow dos controles
[ ] coluna = 192px
[ ] preview sem overflow
[ ] legend <= 420px
[ ] legenda não cruza timecode
[ ] foco de teclado visível
[ ] X da timeline preservado
[ ] playhead preservado
[ ] snap preservado
[ ] node --check server.js = 0
[ ] script da página sem SyntaxError
[ ] console = 0 erros
[ ] git diff altera somente public/index.html
[ ] regressão funcional = nenhuma
```

Se qualquer item falhar, **não marcar o plano como concluído**.

---

# Status

_(propriedade do Executor)_

## Execução — 2026-08-21

Arquivo modificado: `public/index.html` (único arquivo tocado, confirmado por `git diff --stat`).

### Tasks

- **Task 1 (separar legenda do timecode)** — CONCLUÍDA. `.bt-preview-time` passou a `z-index:4`; `.bt-cap-overlay` passou de `bottom:14px` para `bottom:30px`. Bloco substituído exatamente como no plano (linhas antigas 391–395).
- **Task 2 (`.bt-preview` responsivo + coluna de legenda limitada)** — CONCLUÍDA. `.bt-preview` ganhou `flex-wrap:wrap`; `.bt-video-wrap` passou de `width:220px` para `width:min(220px,100%)` (manteve `flex:0 0 auto`, `aspect-ratio:9/16`, sem tocar em `object-fit:contain` do filho `video`); `.bt-legend` passou de `flex:1; ...; min-width:200px` para `flex:1 1 200px; ...; min-width:200px; max-width:420px`.
- **Task 3 (aria-label nos 14 `.bt-tctl`)** — CONCLUÍDA. Os 14 botões estáticos em `public/index.html` (BEATS×2, ÁUDIO×2, LEGENDA×2, B-ROLL×3, TRILHA×5) receberam exatamente os `aria-label` prescritos no plano, preservando `title`, `data-act`, ordem e quantidade. Confirmado que não há geração dinâmica adicional desses botões em JS (busca por `bt-track-label`/`data-act=` no arquivo só retorna o HTML estático) — não há segundo local a atualizar.
- **Task 4 (alvo clicável 24×24 sem alterar geometria)** — CONCLUÍDA. `.bt-tctl` passou de `width:15px;height:15px;font:700 8.5px` para `width:24px;height:24px;font:700 9px`, com `transition` e nova regra `.bt-tctl:focus-visible{outline:2px solid var(--go);outline-offset:1px}` adicionada. Para acomodar os 5 controles da TRILHA dentro dos 192px (cálculo: 5×24px de botões + ícone 11px + gaps/padding antigos ficava com ~7px de sobra para o nome "TRILHA", inaceitável para legibilidade), apliquei o ajuste interno explicitamente permitido pelo plano em `.bt-track-label`: `gap:6px→4px`, `padding:0 9px→0 6px`. **Não** alterei `width:192px` de `.bt-track-label` (permanece igual), não criei coluna nova, não toquei `margin-left:192px` da régua nem `left:-192px` do `.bt-ruler-corner` (nenhuma dessas três regras aparece no diff).

  Observação: já existia uma regra global anterior no CSS (linha ~373-374, fora do escopo deste plano, não tocada) `.bt-tbtn,.bt-tctl,.bt-toggle:focus-visible{outline:2px solid var(--go);outline-offset:2px}`. Como aparece depois no arquivo, ela tem prioridade de cascata sobre a nova regra específica de `.bt-tctl:focus-visible{outline-offset:1px}` adicionada por este plano (mesma especificidade, ordem de origem decide) — resultado prático: outline-offset efetivo é 2px, não 1px. Funcionalmente o foco continua visível (mesma cor/largura de outline), então não bloqueia o critério de aceite "foco visível", mas registro o desvio porque o plano pedia literalmente `outline-offset:1px`. Não alterei a regra global por estar fora do escopo autorizado (só CSS `bt-` listado nas Tasks).

- **Task 5 (foco/navegação por teclado)** — SEM ALTERAÇÃO DE CÓDIGO NECESSÁRIA. Os 14 controles já eram `<button>` nativos antes deste plano; nenhum handler JS novo foi criado, nenhum handler existente foi removido/alterado. `wireTracks()` não foi tocado.

### Validações executadas via shell (evidência)

1. `git diff --stat` → `public/index.html | 47 +++++++++++++++++++++++++----------------------` — **único arquivo alterado**. PASSOU.
2. `git diff -- public/index.html` → inspecionado integralmente; corresponde exatamente às Tasks 1–4 (nenhuma alteração fora do escopo). PASSOU.
3. `git diff --stat -- server.js lib/` e `git status --porcelain server.js lib/` → saída vazia, nenhuma alteração. PASSOU (server.js/lib/ intocados).
4. `node --check server.js` → exit code 0. PASSOU.
5. Extração do único `<script>` de `public/index.html` (77190 caracteres) e `new Function(scriptText)` → sem exceção lançada (sem SyntaxError). PASSOU.
6. Checagem estática (regex, não DOM real) dos 14 botões `.bt-tctl`: total=14, missingLabels=0, uniqueLabels=14/14, missingTitles=0, com a distribuição exata BEATS 2 / ÁUDIO 2 / LEGENDA 2 / B-ROLL 3 / TRILHA 5. PASSOU (nível estático; ver ressalva abaixo sobre DOM real).

### NÃO verificado por este Executor (requer browser/DOM real — documentado conforme instrução, não afirmado como passado)

Os itens abaixo do plano exigem renderização real em navegador (`getBoundingClientRect`, `getComputedStyle`, teclado real) e **não foram executados** nesta sessão, que rodou apenas em shell/Node:

- Task 1: `$q('#bt-cap-overlay').getBoundingClientRect().bottom < $q('.bt-preview-time').getBoundingClientRect().top` para legendas de 1/2/3 linhas e estado sem legenda.
- Task 2: `p.scrollWidth <= p.clientWidth` em container estreito (~440px); `video.width <= preview.width`; `.bt-legend` `<= 420px` em viewport >=1600px; comportamento visual da barra `.bt-legend-row .bar`.
- Task 3: execução real do snippet de contagem/duplicidade de aria-label no DOM (a checagem estática via regex acima é uma aproximação razoável, mas não substitui o DOM real com `getAttribute`).
- Task 4: `getBoundingClientRect()` dos 14 controles confirmando 24×24px reais; `scrollWidth <= clientWidth` de `.bt-track-label`; largura real computada de 192px.
- Task 4 (geometria da timeline): comparação before/after de `.bt-ruler`, `#bt-track-beats/audio/legend/broll/music` `getBoundingClientRect().x` com tolerância de 1px.
- Task 5: navegação real por `Tab`, foco visível, `Enter`/`Space` acionando os botões.
- Validação final item 4: "zero erros de console" ao abrir o BEATS.
- Validação final item 8: regressão funcional manual (split/merge/trim/drag/snap/undo/redo/zoom/multiselect/thumbnails/B-ROLL/TRILHA/compositing/SALVAR/CARREGAR).

Recomendação: essas checagens precisam ser feitas manualmente no navegador (ou por um harness com DOM real, como mencionado na seção "Auditoria" do plano) antes de marcar o plano como CONCLUÍDO pelos critérios da seção "Critério de conclusão".

### Resumo dos itens de "Critério de conclusão"

```text
[x] Task 1 concluída (código)
[x] Task 2 concluída (código)
[x] Task 3 concluída (código)
[x] Task 4 concluída (código)
[x] Task 5 concluída (nenhuma mudança de código necessária)

[x] 14 controles existentes (estático)
[x] 14 aria-label (estático)
[x] 0 labels ausentes (estático)
[x] 0 labels duplicados (estático)
[ ] 14 controles = 24×24 — NÃO VERIFICADO (requer DOM real)
[ ] nenhum overflow dos controles — NÃO VERIFICADO (requer DOM real)
[ ] coluna = 192px — NÃO VERIFICADO (requer DOM real; CSS declara width:192px inalterado)
[ ] preview sem overflow — NÃO VERIFICADO (requer DOM real)
[ ] legend <= 420px — NÃO VERIFICADO (requer DOM real; CSS declara max-width:420px)
[ ] legenda não cruza timecode — NÃO VERIFICADO (requer DOM real; CSS separa bottom:30px vs bottom:8px + z-index)
[ ] foco de teclado visível — NÃO VERIFICADO (requer browser real; ver ressalva sobre outline-offset acima)
[ ] X da timeline preservado — NÃO VERIFICADO (requer DOM real; nenhuma regra de posicionamento da régua/tracks foi tocada)
[ ] playhead preservado — NÃO VERIFICADO (requer DOM real; playhead não foi tocado no diff)
[ ] snap preservado — NÃO VERIFICADO (requer teste funcional; nenhum handler de snap foi tocado)
[x] node --check server.js = 0
[x] script da página sem SyntaxError
[ ] console = 0 erros — NÃO VERIFICADO (requer browser real)
[x] git diff altera somente public/index.html
[ ] regressão funcional = nenhuma — NÃO VERIFICADO (requer teste manual; nenhum handler de edição/undo/redo/zoom/multiselect/thumbnails/compositing/save/load foi tocado no diff)
```

**Conclusão do Executor**: implementação de código concluída conforme as 5 Tasks, dentro do escopo autorizado (somente `public/index.html`, somente CSS `bt-` + `aria-label`). Todas as validações executáveis via shell/Node passaram. O plano **não pode ainda ser marcado como CONCLUÍDO** pelos critérios do Orquestrador porque vários itens de aceite exigem inspeção visual/DOM real em navegador, que está fora do alcance desta sessão — encaminhar para verificação manual/Validador antes do fechamento.
