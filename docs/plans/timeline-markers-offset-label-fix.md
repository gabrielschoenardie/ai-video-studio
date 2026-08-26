# Plano — TIMELINE: offset da MARKERS e coluna de rótulos

> Papel: escrito pelo Orquestrador. A seção `## Status` no fim é de propriedade exclusiva do Executor.

**Goal:** Corrigir dois defeitos medidos introduzidos pelos planos `timeline-markers-track.md` e `timeline-clip-feel.md` (commit `3c7688cda8c6`): a CSS var `--bt-markers-h` nunca é publicada no fluxo normal do app, deixando o canto da régua e a alça de scrub 44px acima do lugar; e a coluna de rótulos voltou a truncar `TRILHA`.

**Architecture:** Duas edições pontuais em `public/index.html`. Nenhuma função nova, nenhum listener novo, nenhum observer. A primeira troca a fonte da medida de altura (layout → estado); a segunda ajusta duas propriedades CSS.

**Tech Stack:** HTML/CSS/JS vanilla inline em `public/index.html`. Sem npm, sem build.

---

## Global Constraints

- **Arquivo único:** só `public/index.html`. `server.js`, `lib/`, `clipper/`, `remotion/` não são tocados.
- **CRLF:** `public/index.html` é CRLF de ponta a ponta. Preserve. Verificação: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');console.log('CRLF',(s.match(/\r\n/g)||[]).length,'LF-solto',(s.match(/[^\r]\n/g)||[]).length)"` → `LF-solto 0`.
- **Não tocar:** `TRACK_MIN_H`/`TRACK_MAX_H`, o número mágico `192`, `startRowResize`, `renderTracks`, `applyTrackVisibility`, `goStep`, qualquer coisa de `srcIn`/snap/menu de contexto, e a largura `.bt-track-label{width:192px}`.
- **Não** adicionar `ResizeObserver`, `IntersectionObserver`, `setTimeout` de re-render, nem chamar `renderTracks()` de `goStep`. As duas primeiras trazem ciclo de vida novo para um problema que é de fonte de dado; a terceira re-renderiza a timeline inteira a cada navegação.
- **Git:** nenhum comando git. O git deste projeto passa pelo subagente `git-workflow` com aprovação do usuário entre fases. Deixe no working tree, sem stage.
- **Números de linha e âncoras** referem-se ao commit `3c7688cda8c6` — o estado atual do repositório. Localize sempre pelo texto-âncora, nunca pelo número. As três correções já foram aplicadas e medidas no espelho deste projeto de design, que por isso **não** casa mais com os âncoras; a fonte da verdade para execução é o repositório.

---

## Diagnóstico (como os dois defeitos foram medidos)

Harness offline (`repo-visual-check.html`) envolvendo o próprio `public/index.html` de `3c7688cda8c6`, com `/api/*` stubado; duração 28.4s, 6 beats, 33 palavras, 3 clipes de B-ROLL, 1 de TRILHA. Zero erros de console.

### Defeito 1 — `--bt-markers-h` nunca é publicada

`syncMarkersOffset()` mede `row.offsetHeight` e tem o guard `if (h > 0)`, documentado como "Altura 0 (painel oculto) é ignorada para não zerar um valor bom". O guard está certo; o que falta é alguém re-sincronizar **depois** de o painel ficar visível.

No fluxo normal do app, `renderTracks()` roda quando o vídeo é carregado — e nesse instante `#step-beats` costuma estar `display:none` (o usuário está em 03 ASSEMBLE e só depois clica em 04). `offsetHeight` é 0, o guard salta, e **nada mais chama `syncMarkersOffset()`** até o usuário arrastar a alça de resize da linha MARKERS — que é justamente o gesto que ninguém faz para consertar um layout que não sabe estar torto.

Medido, com o painel já visível e a var ainda não publicada:

```text
inline --bt-markers-h              (unset)
#step-beats display                block
altura da linha MARKERS            44px
.bt-ruler-corner top               849   ← topo de #bt-inner (sobre a linha MARKERS)
#bt-ruler top                      893
.bt-playhead-flag top              849   ← a alça de scrub, 44px fora da régua
```

Publicando a var manualmente, os dois voltam ao lugar (`corner.top === ruler.top`, alça dentro da faixa da régua). Ou seja: o CSS e a função estão certos; só a fonte da medida é frágil.

**Correção escolhida:** medir de `trackHeights.beats` em vez de `offsetHeight`. É o mesmo número — `applyTrackVisibility()` escreve `row.style.height = trackHeights[track]` e `startRowResize` atualiza `trackHeights[track]` **antes** de chamar `syncMarkersOffset()` — mas é estado, não layout: existe com o painel oculto, não força reflow, e nunca é 0. Com isso o guard e a necessidade de re-sync desaparecem juntos.

### Defeito 2 — `TRILHA` truncando na coluna de rótulos

`.bt-track-label` está com `gap:4px; padding:0 6px` — os valores intermediários que a execução anterior descartou. A linha TRILHA tem 5 botões de 24px:

```text
padding 6+6=12 · gap 4×6=24 · ícone 11 · 5 botões × 24 = 120 · .nm precisa 39
soma necessária                    206px
.bt-track-label largura             192px
.nm da TRILHA                       24px de 39px  → elipse em "TRILHA"
```

Com `gap:2px; padding:0 3px`: `6 + 12 + 11 + 120 + 39 = 188 ≤ 192`. Nenhuma das 5 outras linhas regride (todas têm 2 ou 3 botões e folga maior).

---

## Task 1: `syncMarkersOffset` lê o estado, não o layout

**Files:** Modify `public/index.html:1829-1835`

**Interfaces:**
- Consumes: `trackHeights` (objeto, chave `beats`), `TRACK_MIN_H` (44), `$q`.
- Produces: nada novo. `syncMarkersOffset(): void` mantém assinatura e nome; muda só de onde tira o número. Deixa de depender de `row.offsetHeight` e de o painel estar visível.

- [ ] **Step 1: Trocar a fonte da medida**

Localize:

```js
  function syncMarkersOffset() {
    const inner = $q('#bt-inner');
    const row = $q('.bt-track-row[data-track="beats"]');
    if (!inner || !row) return;
    const h = row.offsetHeight;
    if (h > 0) inner.style.setProperty('--bt-markers-h', h + 'px');
  }
```

Substitua por:

```js
  function syncMarkersOffset() {
    const inner = $q('#bt-inner');
    if (!inner) return;
    // trackHeights é a fonte da verdade da altura da linha, e não o layout:
    // offsetHeight é 0 enquanto #step-beats está display:none — e é exatamente
    // esse o estado no fluxo normal (o vídeo carrega em 03, o usuário só depois
    // abre o 04). Medindo o estado, a var sai certa mesmo com o painel oculto,
    // sem reflow e sem precisar de re-sync quando ele aparece.
    const h = trackHeights.beats || TRACK_MIN_H;
    inner.style.setProperty('--bt-markers-h', h + 'px');
  }
```

O `const row` sai porque não é mais usado. `startRowResize` continua chamando esta função sem alteração — ele já atualiza `trackHeights[track]` na linha anterior.

- [ ] **Step 2: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('le de trackHeights', h.includes('const h = trackHeights.beats || TRACK_MIN_H;'));
ck('offsetHeight removido da funcao', !h.includes('const h = row.offsetHeight;'));
ck('guard de altura zero removido', !h.includes(\"if (h > 0) inner.style.setProperty\"));
ck('var publicada sem condicao', h.includes(\"inner.style.setProperty('--bt-markers-h', h + 'px');\"));
ck('lookup do row removido da funcao', !/function syncMarkersOffset\(\)[\s\S]*?\}/.exec(h)[0].includes('.bt-track-row'));
ck('chamada no resize preservada', h.includes(\"if (track === 'beats') syncMarkersOffset();\"));
ck('chamada em renderTracks preservada', /applyTrackVisibility\(\);\s*\n\s*syncMarkersOffset\(\);/.test(h));
ck('CSS consome a var', h.includes('.bt-ruler-corner{position:absolute; left:-192px; top:var(--bt-markers-h,0px)') && h.includes('.bt-playhead-flag{position:absolute; top:var(--bt-markers-h,0px)'));
"
```

Esperado: **8 `PASS`.** Rode também o check de sintaxe inline e o de CRLF.

- [ ] **Step 3: Verificar no browser — o caminho que estava quebrado**

O teste tem de começar **em outro passo**, senão o defeito não aparece.

| Verificar | Esperado |
| --- | --- |
| Abrir o app, ir em **03 ASSEMBLE**, escolher o vídeo, e só **então** clicar em `04 TIMELINE` | o canto da régua e o pentágono do playhead estão **sobre a régua**, não sobre a linha MARKERS |
| Inspecionar `#bt-inner` no DevTools | `--bt-markers-h: 44px` presente desde o primeiro render |
| Arrastar a alça de resize da linha MARKERS até ~200px | régua e alça descem junto, sem sobreposição e sem lag de um frame |
| Arrastar de volta até o mínimo | voltam para 44px |
| Ocultar a linha MARKERS com `H`, navegar para 05 EXPORT e voltar | régua e alça continuam alinhadas |
| Arrastar o pentágono do playhead | scrub funciona — a alça está onde o cursor a procura |
| Trocar de vídeo no seletor | painel se reconstrói já alinhado |
| Console | sem erros novos |

- [ ] **Step 4: Commit** — **PULE.** Ver Global Constraints.

---

## Task 2: Coluna de rótulos cabe TRILHA sem elipse

**Files:** Modify `public/index.html` — regra `.bt-track-label`

**Interfaces:** Consumes/produces nada. Ajuste interno da regra; `width:192px` e a origem da régua ficam intactas.

- [ ] **Step 1: Apertar gap e padding**

Localize:

```css
  display:flex; align-items:center; gap:4px; padding:0 6px; background:var(--panel);
```

Substitua por:

```css
  display:flex; align-items:center; gap:2px; padding:0 3px; background:var(--panel);
```

Os 5 botões de 24px da linha TRILHA (`+ M S H L`) mais o ícone e o rótulo somam 206px com os valores antigos, contra os 192px da coluna. Com estes, 188px.

- [ ] **Step 2: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('gap e padding apertados', h.includes('gap:2px; padding:0 3px; background:var(--panel);'));
ck('valores antigos removidos', !h.includes('gap:4px; padding:0 6px; background:var(--panel);'));
ck('largura da coluna intacta', h.includes('width:192px'));
ck('botoes seguem 24px', h.includes('width:24px; height:24px;'));
"
```

Esperado: **4 `PASS`.** Mais sintaxe e CRLF.

- [ ] **Step 3: Verificar no browser**

| Verificar | Esperado |
| --- | --- |
| Rótulo da linha `TRILHA` | lê **TRILHA** inteiro, sem `…` |
| Rótulos `MARKERS`, `B-ROLL`, `VÍDEO`, `LEGENDA`, `ÁUDIO` | inteiros, sem elipse |
| Os 5 botões da linha TRILHA (`+ M S H L`) | todos visíveis, nenhum cortado, ainda clicáveis a 24×24 |
| Foco por `Tab` nos botões | anel de foco visível e não recortado pela borda da coluna |
| Régua e as 6 linhas | começam todas no mesmo X de antes |
| Console | sem erros novos |

- [ ] **Step 4: Commit** — **PULE.**

---

---

## Task 3: Rótulo da linha MARKERS sem texto e sem ícone

**Files:** Modify `public/index.html` — a `.bt-track-label` da linha `data-track="beats"`

**Interfaces:** Consumes/produces nada. Remoção de dois `<span>` de apresentação. `data-track="beats"`, `id="bt-track-beats"`, os dois `data-act` e os dois `aria-label` ficam intactos.

**Por quê:** a linha acima da régua não é uma pista de mídia — é o brief de onde os cortes acontecem, marcado com os papéis `HOOK`, `CONTEXTO`, `TENSÃO`, `VIRADA`, `PROVA`, `CTA`. É a faixa de marcadores do Premiere, que também não leva nome de pista. Os próprios marcadores já dizem o que a faixa é; um rótulo `MARKERS` mais um ícone `▤` só repetem isso e a fazem parecer uma sexta pista.

Os dois `aria-label` ("Ocultar track MARKERS" / "Travar track MARKERS") **permanecem** — sem texto visível, eles passam a ser o único nome acessível dos botões `H`/`L`.

- [ ] **Step 1: Remover o ícone e o texto**

Localize (dentro da linha `data-track="beats"`, em `#bt-tracks-top`):

```html
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">MARKERS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track MARKERS">H</button>
```

Substitua por:

```html
              <div class="bt-track-label">
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track MARKERS">H</button>
```

Só os dois `<span>` saem. Nenhuma outra linha de track é tocada — as outras cinco mantêm ícone e nome.

- [ ] **Step 2: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('texto MARKERS removido', !h.includes('<span class=\"nm\">MARKERS</span>'));
ck('icone da linha removido', !/<div class=\"bt-track-label\"><span class=\"ic\">▤<\/span>/.test(h));
ck('aria-labels preservados', h.includes('aria-label=\"Ocultar track MARKERS\"') && h.includes('aria-label=\"Travar track MARKERS\"'));
ck('data-track e id preservados', h.includes('data-track=\"beats\"') && h.includes('id=\"bt-track-beats\"'));
ck('as outras 5 linhas mantem nome', ['B-ROLL','VÍDEO','LEGENDA','ÁUDIO','TRILHA'].every(t=>h.includes('<span class=\"nm\">'+t+'</span>')));
ck('5 rotulos de pista com icone+nome', (h.match(/<div class=\"bt-track-label\"><span class=\"ic\">/g)||[]).length === 5);
ck('rotulo da linha de marcadores sem span', /data-track=\"beats\">\s*<div class=\"bt-track-label\">\s*<button/.test(h));
"
```

Esperado: **7 `PASS`.** Mais sintaxe e CRLF.

> Cuidado com a contagem: `class="nm"` aparece **7 vezes** no arquivo — os 5 rótulos de pista mais dois templates de JS (`renderClipTrack` e `renderVideoTrack`, que usam `.nm` para o nome do arquivo dentro do clipe). Uma asserção do tipo `match(/<span class="nm">/g).length === 5` dá `FAIL` mesmo com a tarefa correta. Daí contar `.bt-track-label` com ícone, não `.nm` solto.

- [ ] **Step 3: Verificar no browser**

| Verificar | Esperado |
| --- | --- |
| Coluna de rótulos da linha acima da régua | vazia, só os botões `H` e `L` |
| Os beats na faixa | continuam mostrando os papéis (`HOOK`, `CONTEXTO`, …) e a duração |
| `H` e `L` da linha | ocultar e travar seguem funcionando |
| Duplo-clique num beat | popover `PAPEL NARRATIVO` abre e salva |
| Arrastar, trimar, reordenar beat | inalterados |
| As outras 5 linhas | ícone e nome intactos |
| Régua e as 6 linhas | mesmo X de antes |
| Console | sem erros novos |

- [ ] **Step 4: Commit** — **PULE.**

## Critérios de aceite (checáveis)

1. Asserções da Task 1: 8 `PASS`, 0 `FAIL`. Task 2: 4 `PASS`, 0 `FAIL`. Task 3: 7 `PASS`, 0 `FAIL`.
2. `node -e` de sintaxe do `<script>` inline: `PASS` após cada task.
3. CRLF: `LF-solto 0` após cada task.
4. Com o painel 04 aberto **a partir de outro passo**, `getComputedStyle(document.querySelector('#bt-inner')).getPropertyValue('--bt-markers-h')` devolve `44px`, e `.bt-ruler-corner`/`.bt-playhead-flag` têm `top` igual ao `top` de `#bt-ruler` (tolerância 1px).
5. No DOM, `document.querySelectorAll('.bt-track-label .nm')` devolve **5** elementos (a linha acima da régua não tem), e nenhum deles com `scrollWidth > clientWidth`.
6. `.bt-track-label` continua com 192px em todas as 6 linhas, e nenhuma tem `scrollWidth > clientWidth`.
7. Régua e as 6 linhas de track partem do mesmo X de antes da mudança (desvio 0px).
8. `git status` mostra **apenas** `public/index.html` modificado.
9. Regressão manual: split/merge/trim de beat, drag-reorder, snap com guia, menu de contexto (dividir/duplicar/deletar), trim-in com `srcIn`, undo/redo, zoom, multi-seleção, SALVAR/CARREGAR — todos sem mudança de comportamento. Nenhuma função JS de interação é tocada por este plano.

---

# Status

**Executado em 2026-08-26. Tasks 1, 2 e 3 concluídas — 19/19 asserções `PASS`, sintaxe OK, CRLF `LF-solto 0`.**

Verificação no browser, pelo caminho que estava quebrado (entrar em 04 vindo de outro passo, com `#step-beats` em `display:none` no momento do `renderTracks()`):

| Medida | Resultado |
| --- | --- |
| `--bt-markers-h` no primeiro render | `44px` |
| `.bt-ruler-corner` top / `#bt-ruler` top / `.bt-playhead-flag` top | `865 / 865 / 865` (desvio 0px) |
| `.bt-track-label .nm` no DOM | 5 elementos, nenhum com `scrollWidth > clientWidth` |
| `.bt-track-label` com overflow | 0 |
| Console | sem erros |

Desvios do plano, todos por consequência direta das tarefas:

- **Task 1** — o comentário acima de `syncMarkersOffset()` perdeu a frase "Altura 0 (painel oculto) é ignorada para não zerar um valor bom": ela descrevia o guard que a própria Task 1 removeu.
- **Task 4 (Commit)** — pulada nas três tasks, conforme Global Constraints. Nada em stage.

## Trabalho adicional pedido na mesma sessão (fora do escopo original deste plano)

1. **Bug pré-existente do popover** — os três `requestAnimationFrame(() => popEl.classList.remove('enter'))` sem guard. Resolvidos na classe, não caso a caso: um helper `mountPopover(el)` captura o elemento numa `const` em vez de reler `popEl`, o que cobre tanto o `TypeError` (popover fechado antes do frame) quanto o bug que o guard `if (popEl)` não pegava — tirar o `enter` do popover *errado* quando outro abre no mesmo frame. Os 4 pontos de montagem passaram a usar o helper.
2. **Camada B — pista VÍDEO editável (EDL com ripple)** — `VIDEO = [{srcIn,dur}]`, sem campo `start`: a posição é a soma das durações anteriores, então deletar/reordenar/trimar já rippla. `DURATION` passou a ser derivada, `MEDIA_DUR` guarda a duração da fonte, e `playhead` (tempo de TIMELINE) virou o relógio mestre — o `<video>` o segue via `tlToSrc()`. Régua, beats, waveform, legenda e o compositor de preview leem o mapa de segmentos.
3. **Camada C — a timeline alimenta o export** — `lib/timeline.js` (novo) + `POST /api/timeline/conform` + botão `CONFORMAR → EXPORT`. Achata cortes de V1, B-ROLL e TRILHA num mezanino 4:4:4 CRF-12 e reprojeta o transcript num `.ass` novo. Sidecar subiu para v3 (campo `segments`).

Verificado no app real, ponta a ponta: corte com ripple (timeline 6.0s → fonte 15.98s), reprodução atravessando a emenda, trim/reorder/delete/undo/redo, save/load do sidecar, e o arquivo conformado conferido quadro a quadro contra a fonte. Export a partir do conformado: validação pós-encode **APROVADA** (0 checks reprovados), risco `0 · MINIMAL`, VMAF média 99.39.
