# Plan — Corrigir colapso de altura das tracks do BEATS

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Pré-requisito:** `docs/plans/beats-premium-polish.md` já executado e commitado
(`ea10eab`). Este plano corrige um bug estrutural pré-existente (não
introduzido pelo polish) revelado ao comparar o app real
(`docs/plans/timeline_app_atual.png`) com o mockup de referência
(`docs/plans/timeline_mockup.png`).

## Diagnóstico

`.bt-track-row` (flex container) e `.bt-track-content` (`public/index.html`
linhas ~281-294) não têm altura explícita. As tracks BEATS, LEGENDA, B-ROLL
e TRILHA só contêm filhos com `position:absolute` (`.bt-beat`, `.bt-word`,
`.bt-clip` — ver linhas ~296, 308, 339), que são removidos do fluxo normal
e não contribuem para a altura intrínseca do container. A única track que
hoje aparenta altura correta é ÁUDIO, porque `drawWaveform()` (linha ~1069)
seta `<canvas id="bt-wave" height="44">` dentro de `.bt-track-content`, e
esse canvas participa do fluxo normal.

Resultado visível no app real: a row BEATS fica fina demais para mostrar o
rótulo do beat corretamente, a row LEGENDA vira um amontoado de palavras
sobrepostas (porque `.bt-word{top:4px;bottom:4px}` não tem uma altura de
referência definida no pai), e B-ROLL/TRILHA ficam com os clipes
praticamente invisíveis. Nenhuma lógica de dados está errada — é
puramente um bug de layout CSS.

Gap secundário (cosmético, também visível no mockup): o painel de papéis
narrativos ao lado do preview (`.bt-legend`) não tem um rótulo de seção;
no mockup aparece "BEATS · PAPÉIS NARRATIVOS" acima da lista de beats.

## Escopo

Só `public/index.html` (CSS + o HTML estático de `buildDom()`). **Não
tocar** `server.js` nem qualquer arquivo em `lib/`. Nenhuma mudança de
lógica/dados — `renderTracks()`, `renderLegendList()`,
`updatePreviewOverlay()` e as demais funções JS continuam exatamente como
estão.

## Files

- **Modify:** `public/index.html`

## Task 1 — Altura definida para as tracks (CSS)

Em `.bt-track-row` (linha ~282), adicionar `min-height:44px` (mesmo valor
já usado pelo canvas da waveform em `drawWaveform()`, para manter as 5
tracks visualmente uniformes):

```css
.bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft)}
```

Isso é suficiente porque `.bt-track-row` é um flex container com
`align-items` padrão (`stretch`): ao dar altura definida ao container, os
filhos flex (`.bt-track-label` e `.bt-track-content`) esticam para
preencher essa altura, e `.bt-track-content` passa a ter uma altura
definida contra a qual `top`/`bottom` dos filhos absolutos (`.bt-beat`,
`.bt-word`, `.bt-clip`) resolvem corretamente.

**Acceptance:** com as 5 tracks visíveis, todas têm a mesma altura visual
(~44px) mesmo quando vazias; a track LEGENDA mostra as palavras lado a
lado sem sobreposição; B-ROLL/TRILHA mostram os pills de clipe (quando
houver clipes) com altura cheia da row, igual ao mockup.

## Task 2 — Rótulo de seção no painel de papéis narrativos

No CSS, adicionar (perto do bloco `.bt-legend*`, por exemplo logo após a
regra `.bt-legend{...}` na linha ~262):

```css
.bt-legend-head{font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim);
  padding:2px 6px 4px}
```

Em `buildDom()`, onde hoje está (linha ~1182):

```html
<div class="bt-legend" id="bt-legend-list"></div>
```

Trocar por um wrapper com o rótulo estático e o container de rows
separado (o `id="bt-legend-list"` precisa continuar existindo, pois
`renderLegendList()` faz `$q('#bt-legend-list').innerHTML = …`):

```html
<div class="bt-legend">
  <div class="bt-legend-head">BEATS · PAPÉIS NARRATIVOS</div>
  <div id="bt-legend-list"></div>
</div>
```

Não é necessário alterar `renderLegendList()` — ela já faz
`$q('#bt-legend-list')` e continua funcionando sem mudança, pois o id
permanece no mesmo lugar lógico (agora um filho do `.bt-legend`, antes o
próprio `.bt-legend`).

**Acceptance:** o painel ao lado do preview mostra o rótulo "BEATS ·
PAPÉIS NARRATIVOS" acima da lista de beats; clicar numa linha ainda
seleciona e faz seek, como antes.

## Task 3 — Waveform canvas herda estilo genérico de `canvas{}` (achado em teste ao vivo)

Verificação ao vivo no navegador (com um vídeo real de 8s + `.ass` real
carregados na sessão) confirmou a Task 1/2 funcionando — todas as 5 tracks
com 44px, palavras lado a lado sem sobreposição. Mas revelou um segundo bug
pré-existente (não introduzido por este plano, mas parte da mesma
discrepância "as 4 tracks abaixo de BEATS não batem com o mockup"): a track
ÁUDIO mede ~199px de altura, não 44px como as demais.

Causa: a regra genérica `canvas{width:100%; height:180px; ...; margin-top:12px}`
(linha ~202, pensada para outros canvases do app — ex. Export/Score) não
tem escopo — ela também estiliza `#bt-wave` dentro de `.bt-track-content`,
sobrescrevendo o tamanho real do canvas (`canvas.width`/`canvas.height`
setados em `drawWaveform()`, linha ~1074, para `contentWidth() × 44`). O
canvas de preview (`#bt-canvas`) não sofre disso porque já tem um override
específico: `.bt-video-wrap canvas{position:absolute; inset:0; width:100%; height:100%}`
(linha ~340). `#bt-wave` não tem override equivalente.

**Fix (v2 — corrigido após medição ao vivo):** a primeira tentativa
(`width:100%; height:100%` em fluxo normal) foi testada ao vivo no
navegador via `getBoundingClientRect()` e melhorou o bug (199px → 51.6px)
mas não zerou — `height:100%` dentro de um flex item cujo próprio tamanho
vem de `align-items:stretch` cria uma resolução circular de porcentagem
que os browsers não garantem resolver para o valor exato do stretch.
A correção verificada é tirar o canvas do fluxo normal também (mesmo
padrão que `.bt-beat`/`.bt-word`/`.bt-clip` já usam, e que `.bt-video-wrap
canvas` já usa na linha ~340):

```css
.bt-track-content canvas{position:absolute; inset:0; width:100%; height:100%;
  margin-top:0; background:none; border-radius:0; outline:none}
```

Adicionar perto do bloco `.bt-track-content{...}` (linha ~292). Isso tem
especificidade maior que a regra genérica `canvas{}` (0,2,0,1 vs 0,0,0,1),
então vence independente da ordem no arquivo, sem alterar o comportamento
de nenhum outro canvas do app (Export, Score, etc. continuam usando a
regra genérica). Com `position:absolute`, o canvas resolve sua altura
contra `.bt-track-content` do mesmo jeito que os outros filhos absolutos
já resolvem — testado ao vivo: `.bt-track-row[data-track="audio"]` mede
exatamente 44px, idêntico às outras 4 tracks, waveform desenhada sem
distorção.

**Acceptance:** a track ÁUDIO mede a mesma altura (44px, medido via
`getBoundingClientRect()`) que as outras 4 tracks; a waveform continua
visível e desenhada corretamente (não fica esticada nem cortada).

## Task 4 — Nomes das tracks cortados (LEGENDA/B-ROLL/TRILHA) — achado em teste ao vivo

Reportado pelo usuário depois da Task 3, confirmado ao vivo no navegador:
`.bt-track-label` (coluna fixa à esquerda de cada track, linha ~285) é um
flex container de largura fixa `width:120px` contendo ícone + nome + os
botões de controle da track (H/L para todas, +H/L para B-ROLL, +M/S/H/L
para TRILHA). Os botões (`.bt-tctl`) não têm `flex-shrink:0`, então quando
o conteúdo excede 120px (o caso de TRILHA, com 5 botões — o pior caso),
**todos** os itens flex encolhem para caber, inclusive o `<span class="nm">`
(que tem `flex:1`) — medido ao vivo: para TRILHA, `.nm` encolhe para
**0px de largura**, tornando o nome da track literalmente invisível; para
B-ROLL cai para ~21px (de ~40px necessários); para LEGENDA cai para ~42px
(de ~50px necessários). BEATS/ÁUDIO não sofrem porque só têm 2 botões
(H/L) e cabem nos 120px.

**Fix** (verificado ao vivo, com margem de segurança — testado via
`canvas.measureText()` + medição de layout real, não só heurística
scrollWidth/clientWidth, que mascara overflow sub-pixel por causa de
arredondamento):

1. Impedir os botões de encolher — em `.bt-tctl` (linha ~288), adicionar
   `flex:0 0 auto`:

```css
.bt-tctl{all:unset; flex:0 0 auto; cursor:pointer; color:var(--faint); font:700 8.5px var(--mono);
  width:15px; height:15px; border-radius:3px; display:flex; align-items:center; justify-content:center}
```

2. Aumentar a largura da coluna de `120px` para `192px` (folga
   confirmada: TRILHA — pior caso — precisa de ~38.3px de texto e passa a
   ter ~51px disponíveis, ~12.7px de margem; os demais têm folga maior
   ainda). Como `120` está hardcoded em CSS **e** em JS (todo lugar que
   posiciona algo relativo ao início da área de conteúdo das tracks),
   **todas** as ocorrências abaixo precisam mudar juntas para `192`, senão
   o playhead/marcadores desalinham da régua/conteúdo:

   - CSS `public/index.html`:
     - linha ~285: `.bt-track-label{...width:120px...}` → `width:192px`
     - linha ~275: `.bt-ruler{...margin-left:120px...}` → `margin-left:192px`
     - linha ~277: `.bt-ruler-corner{left:-120px; width:120px...}` →
       `left:-192px; width:192px`
   - JS `public/index.html` (são literais numéricos `120` usados como
     "largura da coluna de label" em cálculos de posição — trocar todos
     por `192`, mantendo a lógica idêntica):
     - linha ~1245: `$q('#bt-inner').style.width = (120 + w) + 'px';`
     - linha ~1489: `ph.style.left = (120 + timeToX(...)) + 'px';`
       (playhead)
     - linha ~1497: `el.style.left = (120 + timeToX(a)) + 'px';` (marcador
       IN/OUT)
     - linha ~1700: `marker.style.left = (120 + timeToX(acc)) + 'px';`
       (snap guide)

   Não mexer na linha ~1248 (`DURATION > 120`) — ali `120` é segundos de
   duração do vídeo, não pixels de layout, número coincidente sem relação
   com este bug.

**Acceptance:** com um vídeo real carregado (BEATS + `.ass` real), os 5
rótulos de track (BEATS, ÁUDIO, LEGENDA, B-ROLL, TRILHA) aparecem
completos e legíveis, sem elipse/corte; os botões de cada track mantêm
15×15px (não encolhem); playhead, marcador de IN/OUT e guia de snap
continuam alinhados com o início real da área de conteúdo das tracks
(nenhum desses três se desloca em relação à régua/aos blocos).

## Overall acceptance criteria

1. `node --check server.js` continua exit 0 (arquivo não tocado).
2. `git diff --stat` mostra só `public/index.html`.
3. Nenhuma classe fora do prefixo `bt-` foi criada ou alterada; os outros
   6 steps/tools fora de BEATS continuam idênticos.
4. Nenhuma função JS de mecânica de edição (split/merge/trim/drag-reorder/
   snap/undo/redo/hide/lock/mute/solo, `renderTracks`, `renderLegendList`,
   `drawWaveform`) foi reescrita — só a estrutura HTML/CSS ao redor delas
   mudou.
5. Abrir o BEATS com um vídeo que tenha `.ass`/words carregado: a track
   LEGENDA mostra as palavras como chips distintos e legíveis, sem
   sobreposição, igual ao mockup `docs/plans/timeline_mockup.png`.

## Status

_(propriedade do Executor)_

**Executado em 2026-08-12.**

### O que foi feito

- **Task 1** — `public/index.html` linha 282 (agora): `.bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft)}`
  (adicionado `min-height:44px`, exatamente como especificado).
- **Task 2** — `public/index.html`:
  - Linha 262-263: adicionada a regra `.bt-legend-head{font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim); padding:2px 6px 4px}` logo após `.bt-legend{...}`.
  - Linha ~1184 (dentro de `buildDom()`): `<div class="bt-legend" id="bt-legend-list"></div>` trocado por
    `<div class="bt-legend"><div class="bt-legend-head">BEATS · PAPÉIS NARRATIVOS</div><div id="bt-legend-list"></div></div>`
    (id `bt-legend-list` preservado, agora como filho).

Ambos os blocos foram aplicados literalmente conforme o texto do plano, sem
nenhum desvio de conteúdo.

### Validação dos critérios de aceite gerais

1. `node --check server.js` → exit 0, saída `OK server.js`. `server.js` não foi tocado (confirmado: não aparece em `git diff --stat`).
2. `git diff --stat` → mostra `public/index.html | 9 +-` (7 inserções, 2 remoções — as duas edições). **Ressalva:** `git status --porcelain` também mostra `D docs/plans/timeline-editor.html`, mas essa deleção é **pré-existente** ao início desta execução (não foi tocada por nenhuma das edições feitas aqui — nenhum `Edit`/`Write` desta sessão referenciou esse arquivo) e está fora do escopo deste plano (não é `public/index.html`, não faz parte das Tasks 1/2). Reportando para o Orquestrador decidir se precisa de tratamento separado.
3. Única classe nova: `.bt-legend-head` — prefixo `bt-` respeitado. Nenhuma classe existente fora do prefixo `bt-` foi alterada. Diff confirmado via `git diff -- public/index.html`: só toca as duas regras CSS de `.bt-track-row`/`.bt-legend-head` e o bloco HTML do `.bt-legend` dentro de `buildDom()` — nenhum outro step/tool do arquivo foi tocado.
4. Nenhuma função JS foi tocada — o diff completo de `public/index.html` contém apenas linhas CSS e um bloco HTML estático; nenhuma linha dentro de `<script>` foi alterada (confirmado por inspeção do diff completo, reproduzido abaixo).
5. Não verificado interativamente (não abri o app no navegador nesta execução) — a verificação visual final (LEGENDA sem sobreposição, comparação com `timeline_mockup.png`) fica pendente de confirmação humana/Validador com o servidor rodando.

### Diff aplicado (completo)

```diff
--- a/public/index.html
+++ b/public/index.html
@@ -260,6 +260,8 @@ aside h3{font-size:10px; letter-spacing:.26em; color:var(--faint); margin-bottom
   border-radius:var(--radius-sm); overflow:hidden; aspect-ratio:9/16}
 .bt-video-wrap video{width:100%; height:100%; object-fit:contain; background:#000}
 .bt-legend{flex:1; display:flex; flex-direction:column; gap:6px; min-width:200px}
+.bt-legend-head{font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim);
+  padding:2px 6px 4px}
 .bt-legend-row{display:flex; align-items:center; gap:8px; font:400 12px var(--mono);
   color:var(--dim); cursor:pointer; padding:4px 6px; border-radius:6px}
 .bt-legend-row:hover{background:rgba(129,140,248,.06)}
@@ -279,7 +281,7 @@ aside h3{font-size:10px; letter-spacing:.26em; color:var(--faint); margin-bottom
 .bt-tick span{position:absolute; top:3px; left:4px; font-size:9px; color:var(--faint)}
 .bt-tick.major span{color:var(--dim)}
 .bt-tracks{position:relative; padding-bottom:12px}
-.bt-track-row{display:flex; border-bottom:1px solid var(--line-soft)}
+.bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft)}
 .bt-track-label{position:sticky; left:0; z-index:4; width:120px; flex:0 0 auto;
   display:flex; align-items:center; gap:6px; padding:0 9px; background:var(--panel);
   border-right:1px solid var(--line); font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim)}
@@ -1179,7 +1181,10 @@ window.sendToClipper = (p) => {
           <div class="bt-cap-overlay" id="bt-cap-overlay"></div>
           <span class="bt-preview-time" id="bt-preview-time"></span>
         </div>
-        <div class="bt-legend" id="bt-legend-list"></div>
+        <div class="bt-legend">
+          <div class="bt-legend-head">BEATS · PAPÉIS NARRATIVOS</div>
+          <div id="bt-legend-list"></div>
+        </div>
       </div>
       <div class="bt-scroll" id="bt-scroll">
         <div class="bt-inner" id="bt-inner"></div>
```

### Bloqueios

Nenhum. Implementação concluída conforme o plano.

---

**Task 3 executada em 2026-08-12.**

### O que foi feito (Task 3)

- `public/index.html`, logo após `.bt-track-row.locked .bt-track-content{cursor:not-allowed}`
  (bloco `.bt-track-content{...}`, ~linha 294-296): adicionada a regra

  ```css
  .bt-track-content canvas{width:100%; height:100%; margin-top:0; background:none; border-radius:0; outline:none}
  ```

  aplicada literalmente conforme o texto do plano, sem nenhum desvio de conteúdo.

### Validação dos critérios de aceite gerais (Task 3)

1. `node --check server.js` → exit 0, saída `OK server.js`. `server.js` não aparece em nenhum diff (não foi tocado).
2. `git diff --stat -- public/index.html` → `public/index.html | 10 ++++++++--` (8 inserções, 2 remoções — soma das Tasks 1/2 já existentes + a nova linha da Task 3). `git diff --stat` geral do repo mostra só `public/index.html` modificado além da deleção pré-existente de `docs/plans/timeline-editor.html` (já reportada e fora de escopo na rodada anterior, confirmada novamente aqui via `git status --porcelain` — não foi tocada por esta execução).
3. Única regra nova: seletor `.bt-track-content canvas` — não cria nenhuma classe nova, só qualifica um seletor de elemento (`canvas`) dentro do escopo `.bt-track-content` já existente com prefixo `bt-`. Nenhum outro step/tool fora de BEATS foi tocado.
4. Nenhuma função JS foi tocada — a edição desta rodada é uma única linha CSS; confirmado por inspeção do diff completo (`git diff -- public/index.html`), que mostra apenas o bloco de estilos (Tasks 1/2/3) e o bloco HTML estático do `.bt-legend` (Task 2) — nenhuma linha dentro de `<script>` foi alterada.
5. Não verificado interativamente nesta execução (não abri o app no navegador) — a confirmação visual de que a track ÁUDIO agora mede ~44px e a waveform permanece visível/não distorcida fica pendente de checagem humana/Validador com o servidor rodando, assim como o item 5 pendente da rodada anterior (LEGENDA sem sobreposição comparado a `timeline_mockup.png`).

### Diff aplicado (Task 3, isolado)

```diff
@@ -292,6 +294,7 @@ aside h3{font-size:10px; letter-spacing:.26em; color:var(--faint); margin-bottom
 .bt-track-content{position:relative; background:rgba(10,11,26,.5)}
 .bt-track-row.hidden .bt-track-content{opacity:.2; pointer-events:none}
 .bt-track-row.locked .bt-track-content{cursor:not-allowed}
+.bt-track-content canvas{width:100%; height:100%; margin-top:0; background:none; border-radius:0; outline:none}
 
 .bt-beat{position:absolute; top:5px; bottom:5px; border-radius:5px; cursor:grab;
   display:flex; flex-direction:column; justify-content:center; padding:0 8px; overflow:hidden;
```

### Bloqueios (Task 3)

Nenhum. Implementação concluída conforme o plano.

---

**Task 3 v2 (correção pós-medição ao vivo) executada em 2026-08-12.**

### O que foi feito (Task 3 v2)

- `public/index.html`, linha 297: a regra `.bt-track-content canvas{...}` (v1,
  aplicada na rodada anterior) foi **substituída** pela versão v2 do plano
  (seção "Fix (v2 — corrigido após medição ao vivo)"), que tira o canvas do
  fluxo normal via `position:absolute; inset:0` — igual ao padrão já usado
  por `.bt-video-wrap canvas` (linha ~340) e pelos demais filhos absolutos
  da track (`.bt-beat`/`.bt-word`/`.bt-clip`):

  ```css
  .bt-track-content canvas{position:absolute; inset:0; width:100%; height:100%;
    margin-top:0; background:none; border-radius:0; outline:none}
  ```

  Troca cirúrgica de uma única regra, aplicada literalmente conforme o texto
  do plano (seção "Task 3", v2), sem nenhum desvio de conteúdo. Nenhuma outra
  linha do arquivo foi tocada (Tasks 1 e 2 permanecem exatamente como estavam
  na rodada anterior).

### Validação dos critérios de aceite (Task 3 v2)

1. `node --check server.js` → exit 0, saída `OK server.js`. `server.js` não
   foi tocado (não aparece em nenhum diff).
2. `git diff -- public/index.html` inspecionado por completo: mostra só (a)
   a regra `.bt-legend-head` e o `min-height:44px` de `.bt-track-row` (Tasks
   1/2, já existentes de antes desta rodada) e (b) a regra
   `.bt-track-content canvas{...}` agora na forma v2 (única mudança desta
   rodada) e o bloco HTML do `.bt-legend` (Task 2). Nenhum outro trecho do
   arquivo foi alterado.
3. Nenhuma classe fora do prefixo `bt-` foi criada/alterada; a mudança desta
   rodada só qualifica ainda mais o seletor já existente `.bt-track-content
   canvas`, sem introduzir seletor novo.
4. Nenhuma função JS foi tocada — a edição é puramente CSS (adição de
   `position:absolute; inset:0;` a uma regra já existente).
5. Não verificado interativamente nesta execução (não abri o app no
   navegador) — a medição ao vivo de 44px citada no plano já havia sido
   feita anteriormente pelo Orquestrador/usuário antes de pedir esta
   correção; esta rodada apenas aplicou o CSS já validado ao vivo.
   Confirmação visual final (BEATS aberto com vídeo real) permanece
   pendente de checagem humana/Validador, como já registrado nas rodadas
   anteriores.

### Bloqueios (Task 3 v2)

Nenhum. Implementação concluída conforme o plano.

---

**Task 4 executada em 2026-08-12.**

### O que foi feito (Task 4)

- `public/index.html` linha 290 (`.bt-tctl{...}`): adicionado `flex:0 0 auto;`
  logo após `all:unset;`, impedindo os botões de controle da track de
  encolher quando o conteúdo do `.bt-track-label` excede a largura
  disponível.
- Trocadas as 6 ocorrências do literal "largura da coluna de label das
  tracks" de `120` para `192`, em 3 regras CSS + 4 literais JS:
  - CSS linha 275: `.bt-ruler{...margin-left:120px...}` → `margin-left:192px`.
  - CSS linha 277: `.bt-ruler-corner{left:-120px; width:120px...}` →
    `left:-192px; width:192px`.
  - CSS linha 285: `.bt-track-label{...width:120px...}` → `width:192px`.
  - JS linha 1245: `$q('#bt-inner').style.width = (120 + w) + 'px';` →
    `(192 + w)`.
  - JS linha 1489: `ph.style.left = (120 + timeToX(...)) + 'px';` (playhead)
    → `(192 + timeToX(...))`.
  - JS linha 1497: `el.style.left = (120 + timeToX(a)) + 'px';` (marcador
    IN/OUT) → `(192 + timeToX(a))`.
  - JS linha 1700: `marker.style.left = (120 + timeToX(acc)) + 'px';` (guia
    de snap) → `(192 + timeToX(acc))`.
  - Linha 1248 (`const step = DURATION > 120 ? 10 : ...`) **não foi tocada**
    — confirmado por inspeção pós-edição, é segundos de duração, não pixels,
    exatamente como o plano descreve.

Todas as edições foram aplicadas literalmente conforme o texto do plano
(seção "Task 4"), sem nenhum desvio de conteúdo.

### Validação dos critérios de aceite gerais (Task 4)

1. `node --check server.js` → exit 0, saída `OK`. `server.js` não foi
   tocado (não aparece em nenhum diff).
2. `git diff --stat -- public/index.html` → `27 +++++++++++++++++----------`
   (17 inserções, 10 remoções — soma cumulativa das Tasks 1/2/3 já
   existentes + as 7 mudanças novas da Task 4). `git status --porcelain`
   geral do repo mostra só `public/index.html` modificado além da deleção
   pré-existente de `docs/plans/timeline-editor.html` (já reportada nas
   rodadas anteriores, não tocada por esta execução) e arquivos novos
   não-rastreados fora do escopo deste plano (`Beats_Timeline-Premium.dc.html`,
   `timeline_app_atual.png`, `timeline_mockup.png` — referenciados pelo
   plano como artefatos de diagnóstico, não criados por esta execução).
3. Verificado via `grep -n "120" public/index.html` pós-edição: sobrou
   apenas a linha 1248 (`DURATION > 120`, segundos) mais as ocorrências
   pré-existentes não relacionadas a este bug (`120%`/`120deg`/`-120%` em
   gradientes/transforms, `≤30s` numa tabela de texto) — nenhuma delas é
   "largura da coluna de label". `grep -n "192"` confirma as 6 ocorrências
   esperadas (3 CSS + 4 JS, note que o `#bt-inner` conta como uma delas: 3
   CSS + 4 JS = 7 linhas porque a linha 1245 também soma; total real
   verificado: 7 linhas com `192`, cobrindo as 3 regras CSS e os 4 literais
   JS do plano). Nenhuma classe fora do prefixo `bt-` foi criada ou
   alterada — a única mudança de seletor foi um valor de propriedade em
   `.bt-tctl` já existente.
4. Nenhuma função JS de mecânica de edição foi reescrita — as 4 mudanças em
   `<script>` são substituições cirúrgicas de um literal numérico (`120` →
   `192`) dentro de expressões de cálculo de posição já existentes
   (`renderRuler`, `renderPlayhead`, `renderInOut`, o handler de drag/snap
   perto da linha 1700); nenhuma linha de lógica foi adicionada, removida
   ou reordenada.
5. Não verificado interativamente nesta execução (não abri o app no
   navegador) — a medição ao vivo de folga (~12.7px para TRILHA, pior caso)
   citada no plano já havia sido feita anteriormente pelo
   Orquestrador/usuário antes de pedir esta correção; esta rodada apenas
   aplicou o CSS/JS já validado ao vivo. Confirmação visual final (5
   rótulos de track completos e legíveis, playhead/marcador IN-OUT/guia de
   snap ainda alinhados com a régua) permanece pendente de checagem
   humana/Validador com o servidor rodando, como já registrado nas rodadas
   anteriores para os itens 5 das Tasks 1/2/3.

### Diff aplicado (Task 4, isolado)

```diff
@@ -274,26 +274,26 @@
 .bt-inner{position:relative}
-.bt-ruler{position:sticky; top:0; z-index:5; height:22px; margin-left:120px;
+.bt-ruler{position:sticky; top:0; z-index:5; height:22px; margin-left:192px;
   background:var(--panel); border-bottom:1px solid var(--line)}
-.bt-ruler-corner{position:absolute; left:-120px; top:0; width:120px; height:22px;
+.bt-ruler-corner{position:absolute; left:-192px; top:0; width:192px; height:22px;
   background:var(--panel); border-right:1px solid var(--line); border-bottom:1px solid var(--line); z-index:6}
 .bt-tick{position:absolute; top:0; bottom:0; border-left:1px solid var(--line-soft)}
 .bt-tick.major{border-left:1px solid rgba(129,140,248,.28)}
 .bt-tick span{position:absolute; top:3px; left:4px; font-size:9px; color:var(--faint)}
 .bt-tick.major span{color:var(--dim)}
 .bt-tracks{position:relative; padding-bottom:12px}
 .bt-track-row{display:flex; min-height:44px; border-bottom:1px solid var(--line-soft)}
-.bt-track-label{position:sticky; left:0; z-index:4; width:120px; flex:0 0 auto;
+.bt-track-label{position:sticky; left:0; z-index:4; width:192px; flex:0 0 auto;
   display:flex; align-items:center; gap:6px; padding:0 9px; background:var(--panel);
   border-right:1px solid var(--line); font:600 9.5px var(--sans); letter-spacing:.08em; color:var(--dim)}
 .bt-track-label .ic{color:var(--go); width:11px; text-align:center; flex:0 0 auto}
 .bt-track-label .nm{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
-.bt-tctl{all:unset; cursor:pointer; color:var(--faint); font:700 8.5px var(--mono);
+.bt-tctl{all:unset; flex:0 0 auto; cursor:pointer; color:var(--faint); font:700 8.5px var(--mono);
   width:15px; height:15px; border-radius:3px; display:flex; align-items:center; justify-content:center}
 .bt-tctl:hover{color:var(--ink)}
@@ -1242,7 +1242,7 @@
   function renderRuler() {
     const ruler = $q('#bt-ruler');
     const w = contentWidth();
-    $q('#bt-inner').style.width = (120 + w) + 'px';
+    $q('#bt-inner').style.width = (192 + w) + 'px';
     ruler.style.width = w + 'px';
     ruler.innerHTML = '';
     const step = DURATION > 120 ? 10 : (DURATION > 40 ? 5 : 1);
@@ -1486,7 +1486,7 @@
   function renderPlayhead() {
     const ph = $q('#bt-playhead');
     if (!ph) return;
-    ph.style.left = (120 + timeToX(video ? video.currentTime : 0)) + 'px';
+    ph.style.left = (192 + timeToX(video ? video.currentTime : 0)) + 'px';
   }
   function renderInOut() {
     const el = $q('#bt-inout');
@@ -1494,7 +1494,7 @@
     if (inPoint == null || outPoint == null) { el.style.display = 'none'; return; }
     const a = Math.min(inPoint, outPoint), b = Math.max(inPoint, outPoint);
     el.style.display = 'block';
-    el.style.left = (120 + timeToX(a)) + 'px';
+    el.style.left = (192 + timeToX(a)) + 'px';
     el.style.width = timeToX(b - a) + 'px';
     el.style.top = '22px'; el.style.bottom = '0';
   }
@@ -1697,7 +1697,7 @@
       dropIdx = idx;
       const beatsTrack = $q('#bt-track-beats');
       marker.style.display = 'block';
-      marker.style.left = (120 + timeToX(acc)) + 'px';
+      marker.style.left = (192 + timeToX(acc)) + 'px';
       marker.style.top = beatsTrack.offsetTop + 'px';
       marker.style.height = beatsTrack.offsetHeight + 'px';
     }
```

### Bloqueios (Task 4)

Nenhum. Implementação concluída conforme o plano.
