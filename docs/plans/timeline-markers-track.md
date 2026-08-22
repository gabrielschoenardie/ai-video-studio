# TIMELINE / MARKERS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` (ou o subagente `executor` deste projeto) para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para tracking. A seção `## Status` no fim é de propriedade exclusiva do Executor.

**Goal:** Reorganizar o painel 04 no modelo de timeline do Premiere Pro: renomear o passo para `TIMELINE` e a track `BEATS` para `MARKERS`, mover MARKERS para **acima** da régua, subir `B-ROLL` para o topo das pistas, introduzir uma pista `VÍDEO` (V1) só-leitura com o vídeo principal, e reordenar tudo em grupo visual (vídeo/legenda) acima de grupo sonoro (áudios) — sem quebrar nenhuma interação existente do painel.

**Architecture:** Toda a mudança vive em um único arquivo (`public/index.html`) — o app é uma SPA de arquivo único, sem bundler, sem framework, sem build step. A track de marcadores sai de dentro de `#bt-tracks` e passa a viver em um novo container irmão `#bt-tracks-top`, posicionado antes de `.bt-ruler-corner`/`#bt-ruler` dentro de `#bt-inner`. Dois elementos que hoje assumem que o ruler começa em `y=0` (o canto do ruler e a bandeira do playhead) passam a ser deslocados por uma CSS custom property `--bt-markers-h`, sincronizada em JS porque a altura da linha é redimensionável pelo usuário (44–240px). As pistas restantes são reordenadas e ganham uma pista `VÍDEO` nova, puramente de apresentação: ela **lê** `currentPath`/`DURATION` e não introduz estado novo — nada de novo array, nada de novo campo no sidecar `.beats.json`, nada de mudança no compositor.

**Tech Stack:** HTML/CSS/JS vanilla inline em `public/index.html`. Sem npm, sem transpilação, sem test runner. Node ≥18 apenas para servir (`node server.js` → http://localhost:4870).

**Spec:** duas fontes.

1. `docs/plans/anydesk00000.png` — screenshot anotado à mão pelo usuário. As três anotações em vermelho são: (a) `04 BEATS` riscado com `TIMELINE` escrito ao lado, na navegação lateral; (b) `BEATS` riscado com `MARKERS` escrito ao lado, no rótulo da primeira track; (c) seta da primeira track apontando para cima com o texto *"MOVER ANTIGO BEATS PARA ACIMA DO TIMELINE RULER"*. → Tarefas 1–3.
2. Pedido subsequente do usuário em conversa: *"mover B-ROLL para cima de AUDIO, e usar ele como o video principal da TIMELINE como na timeline da Adobe Premiere Pro usa"*, refinado em duas escolhas explícitas: **(i)** duas pistas de vídeo — `B-ROLL` (V2) acima de uma pista `VÍDEO` (V1) só-leitura com o clipe principal, em vez de fundir as duas numa linha só; **(ii)** ordem final agrupando visual em cima e som embaixo. → Tarefas 4–5.

**Layout final alvo:**

```
── MARKERS ─────────────────────────  (acima da régua)
══ régua de tempo ══════════════════
   B-ROLL    (V2)
   VÍDEO     (V1, só-leitura)
   LEGENDA
   ÁUDIO     (A1)
   TRILHA    (A2)
```

---

## Global Constraints

- **Arquivo único:** todas as edições ocorrem em `public/index.html`. Nenhum outro arquivo do projeto é criado ou modificado.
- **Sem dependências novas:** o backend é Node puro sem npm; o frontend não usa bibliotecas. Não adicionar nenhuma.
- **Identificadores internos não mudam.** Renomear é uma mudança de *rótulo visível*, não de contrato. Permanecem exatamente como estão hoje: `data-step="beats"`, `id="step-beats"`, `id="bt-track-beats"`, `data-track="beats"`, `data-act`, a variável JS `BEATS`, as chaves `trackHeights.beats` / `hiddenTracks.beats` / `lockedTracks.beats`, o endpoint `/api/beats` e o formato do sidecar `*.beats.json`. Trocar qualquer um deles quebraria persistência e/ou dezenas de call sites, sem ganho visível.
- **Textos que contêm "BEATS" e NÃO devem ser alterados** (o usuário não os marcou; eles se referem ao *dado* "beats", não ao passo do pipeline): `BEATS SALVOS` (linha 510), `SALVAR BEATS` (linha 1283), `BEATS · REVISÃO` (linha 1287), `BEATS · PAPÉIS NARRATIVOS` (linha 1297), o parágrafo `<p class="sub">` da seção 04 (linhas 504–507), e as strings de log `beats salvos: …` / `beats carregados` / `nenhum beats.json salvo para este vídeo`.
- **Números de linha** neste plano referem-se ao commit `cc5c9e7`. Eles se deslocam conforme as edições são aplicadas — **sempre localize pelo texto-âncora citado**, não pelo número.
- **Nenhuma suíte de testes existe** neste projeto (nem frontend nem backend). A verificação é feita por (a) asserções programáticas com `node -e` sobre o próprio HTML e (b) um checklist manual no browser com resultados esperados explícitos. Ambos são obrigatórios antes do commit de cada tarefa.
- **Comentários em código:** em PT-BR, seguindo o padrão já usado no bloco BEATS de `public/index.html`.
- **Quebras de linha:** `public/index.html` é **CRLF de ponta a ponta** (2245 linhas, zero LF isolado). Preserve isso — não normalize o arquivo para LF nem deixe as linhas novas em LF, senão o diff vira o arquivo inteiro e o review fica ilegível. Verificação: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');console.log('CRLF',(s.match(/\r\n/g)||[]).length,'LF-solto',(s.match(/[^\r]\n/g)||[]).length)"` deve reportar `LF-solto 0` depois de cada tarefa.
- **Este plano foi validado por dry-run.** Todas as 23 substituições foram aplicadas numa cópia descartável fora do repositório: cada âncora citada existe e é **única** (as de `trackHeights` aparecem 2× de propósito), o resultado passa em todas as asserções e o `<script>` inline parseia. Se um âncora não casar exatamente durante a execução, o arquivo divergiu do commit `cc5c9e7` — **pare e reporte**, não improvise um âncora parecido.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | O que muda |
| --- | --- | --- |
| `public/index.html` | SPA inteira: markup, CSS e JS inline | 3 rótulos visíveis, 1 mapa de rótulos de navegação, reposicionamento e reordenação de blocos de markup, 1 pista nova, 5 regras CSS, 8 pontos de JS |

Nenhum arquivo é criado. Nenhum arquivo em `lib/`, `server.js`, `clipper/` ou `remotion/` é tocado — a mudança é 100% de apresentação e não atravessa a fronteira HTTP.

### Mapa das regiões editadas em `public/index.html`

| Região (linha em `cc5c9e7`) | Tarefa | Mudança |
| --- | --- | --- |
| 279–280 — `.bt-ruler-corner` | 3 | `top:0` → `top:var(--bt-markers-h,0px)` |
| 285 — `.bt-tracks` | 3 | adicionar regra irmã `.bt-tracks-top{padding-bottom:0}` logo abaixo |
| 326–327 — `.bt-playhead-flag` | 3 | `top:0` → `top:var(--bt-markers-h,0px)` |
| 350–361 — bloco `.bt-clip*` | 5 | adicionar `.bt-clip-base` e seus filhos |
| 422 — botão de navegação | 1 | texto `BEATS` → `TIMELINE` |
| 503 — `<h2>` da seção 04 | 1 | `<em>BEATS</em>` → `<em>TIMELINE</em>` |
| 644–652 — `STEP_ORDER` / rodapés `stepnav` | 1 | novo mapa `STEP_LABELS` + helper `stepLabel()` |
| 954 e 2171 — `trackHeights` (2 ocorrências) | 5 | adicionar a chave `video: 44` |
| 1154–1170 — `ensureThumbnail()` | 5 | re-renderizar também a pista `VÍDEO` quando a thumb fica pronta |
| 1302–1312 — `#bt-inner` / track `beats` | 2 e 3 | rótulo → `MARKERS` (T2); bloco movido para `#bt-tracks-top` antes do ruler (T3) |
| 1313–1344 — rows `audio`/`legend`/`broll`/`music` | 4 | reordenar para `broll`, `legend`, `audio`, `music` |
| (após o row `broll`) | 5 | inserir o row novo `data-track="video"` |
| 1474–1515 — `renderClipTrack()` e vizinhas | 5 | corrigir a thumb `'pending'`; adicionar `renderVideoTrack()` e `baseNameOf()` |
| 1637–1646 — `renderInOut()` | 3 | `el.style.top = '22px'` → `'0'` |
| 1685–1698 — `renderTracks()` | 3 e 5 | chamar `syncMarkersOffset()` no fim (T3) e `renderVideoTrack()` (T5) |
| 1853–1873 — `startRowResize()` | 3 | re-sincronizar o offset ao redimensionar a linha `beats` |
| 2118–2119 — `wireTracks()` | 3 | ligar `mousedown`/`dblclick` também em `#bt-tracks-top` |

---

## Contexto que o implementador precisa saber

Leia esta seção antes da Tarefa 3 — ela explica *por que* cada edição não-óbvia existe.

1. **`#bt-inner` é o offsetParent de tudo.** `.bt-scroll` (com `overflow:auto`) contém `#bt-inner` (`position:relative`), cuja largura é definida em JS por `renderRuler()` como `192 + contentWidth()`. O `192` é a largura fixa da coluna de rótulos (`.bt-track-label`), repetida como número mágico em vários pontos do JS (`renderPlayhead`, `renderInOut`, `zoomAt`, `startBeatDrag`). **Não refatore esse número neste plano** — está fora de escopo e multiplicaria o risco.

2. **O ruler é `position:sticky; top:0; z-index:5`, com fundo opaco (`var(--panel)`).** Isso importa para duas decisões abaixo. Note que `.bt-scroll` não tem altura máxima, então na prática o painel não rola verticalmente hoje — o `sticky` é defensivo. Depois da mudança, se algum dia houver rolagem vertical, a linha MARKERS rola para fora enquanto o ruler gruda no topo. Esse comportamento é aceito e não requer trabalho adicional.

3. **Por que `renderInOut` passa a usar `top:0`.** O overlay de IN/OUT (`#bt-inout`, `z-index:1`) hoje começa em `top:22px` — exatamente a altura do ruler — para cobrir a área de tracks e não o ruler. Com a linha MARKERS acima do ruler, a área a cobrir deixa de ser contígua (MARKERS em cima, ruler no meio, demais tracks embaixo). A solução mais simples e sem cálculo: estender o overlay para `top:0` e deixar o próprio ruler mascarar a sua faixa, já que ele é opaco e tem `z-index:5 > 1`. Visualmente idêntico ao comportamento atual nas tracks de baixo, e com o ganho de a faixa IN/OUT passar a cobrir também a linha MARKERS.

4. **Por que `--bt-markers-h` precisa de JS.** `.bt-ruler-corner` e `.bt-playhead-flag` são `position:absolute` com `top:0` relativo a `#bt-inner`. Com a linha MARKERS acima do ruler, ambos precisam descer pela altura dessa linha — que **não é constante**: `startRowResize()` permite ao usuário arrastar qualquer linha entre `TRACK_MIN_H`(44) e `TRACK_MAX_H`(240). Por isso o offset é publicado como CSS custom property em `#bt-inner` e re-sincronizado a cada render e a cada frame do arrasto de redimensionamento.

5. **A bandeira do playhead continua sobre o ruler.** `.bt-playhead-flag` não é só decoração: `onFlagMouseDown` a usa como alça de scrub (`pointer-events:auto`). Deslocá-la por `--bt-markers-h` mantém a alça exatamente onde o usuário já a conhece (sobre a régua), em vez de jogá-la para o topo absoluto do painel.

6. **`wireTracks()` já é agnóstico de container para quase tudo.** Ele itera `$$q('.bt-track-row')` — seletor global de documento — para aplicar alturas e ligar os botões `H/L/M/S/+` e a alça de resize. Isso continua encontrando a linha movida sem alteração. O mesmo vale para `applyTrackVisibility()`. **O único acoplamento ao container** são os dois listeners delegados em `#bt-tracks` (linhas 2118–2119), que precisam ser ligados também no novo container — sem isso, arrastar/trimar/renomear beats para de funcionar silenciosamente.

7. **O marcador de drop do reordenamento se conserta sozinho.** Em `startBeatDrag()`, `marker.style.top = beatsTrack.offsetTop` usa `#bt-track-beats.offsetTop`, cujo `offsetParent` é a própria `.bt-track-row` (`position:relative`) — ou seja, sempre `0`. O marcador é anexado a `#bt-inner`, então hoje ele aparece no topo de `#bt-inner`, desalinhado da track (bug cosmético pré-existente). Com a linha MARKERS movida para o topo de `#bt-inner`, `top:0` passa a ser o valor correto. **Não altere esse código** — ele fica correto por consequência.

8. **Rodapés de navegação são gerados a partir de `STEP_ORDER`.** Os botões "← 03 ASSEMBLE" / "05 EXPORT →" são construídos com `prev.toUpperCase()` / `next.toUpperCase()` sobre o *id* do passo. Como o id continua `beats`, renomear só a navegação lateral deixaria o rodapé de ASSEMBLE dizendo "04 BEATS →" e o de EXPORT dizendo "← 04 BEATS". Daí o mapa `STEP_LABELS`.

9. **O B-ROLL já é uma pista de vídeo — só não parecia uma.** Em `compositeTick()` (`:1594`), quando `activeBroll(t)` acha um clipe sob o playhead, o canvas do preview desenha o frame *do B-ROLL no lugar do* vídeo principal (`drawFrame(canvas, bv)` no ramo `if (active)`, `drawFrame(canvas, video)` no `else`) — substituição, não sobreposição. E `findGapAt()` (`:1443`) impede clipes de B-ROLL de se sobreporem entre si. Ou seja, o modelo real já é `V2 = B-ROLL` / `V1 = vídeo principal`, exatamente o do Premiere. O que faltava era o V1 **existir visualmente**. As Tarefas 4–5 corrigem só isso.

10. **A pista `VÍDEO` é pura apresentação — não introduz estado.** Ela renderiza a partir de `currentPath` e `DURATION`, que já existem. Não há array `VIDEO`, não entra em `snapshot()`/`undo`/`redo`, não entra no sidecar `.beats.json`, e o compositor **não muda uma linha**. Isso é deliberado: o clipe base representa a espinha da timeline, e mexer nele (mover, trimar, deletar) significaria alterar `DURATION` — de onde saem o `<video>` do preview, a régua, o playhead, os beats e o waveform. Por isso a pista é **só-leitura** e não recebe os controles `H`/`L`: um botão que não faz nada é pior que botão nenhum.

11. **Clicar na pista `VÍDEO` move o playhead.** O clipe base usa a classe `.bt-clip-base`, **não** `.bt-clip`. Isso não é cosmético: `onTracksMouseDown()` (`:2059`) faz `e.target.closest('.bt-clip')` e, se casar, lê `clipEl.dataset.track` e chama `clipsFor(track)` — que retorna `MUSIC` para qualquer valor diferente de `'broll'`, inclusive `undefined`. Um clipe base com a classe `.bt-clip` faria um clique inocente começar a arrastar um clipe de TRILHA inexistente. Com a classe distinta, `closest('.bt-clip')` retorna `null`, o handler cai no ramo final e apenas move o playhead — o comportamento certo para uma pista só-leitura.

12. **Bug pré-existente da thumbnail, corrigido de passagem.** `ensureThumbnail()` grava a string `'pending'` no `thumbCache` antes de decodificar o frame. `renderClipTrack()` testa só `if (t)` — e `'pending'` é truthy — então o primeiro render de cada clipe de B-ROLL emite `<img src="pending">`, que vira um 404 e um ícone de imagem quebrada sobre o clipe até a thumb real chegar. A Tarefa 5 troca o teste por `t && t !== 'pending'`. É correção estrita, na mesma função que a tarefa já toca; não muda nenhum caminho de sucesso.

### Fora de escopo (não faça)

- **Não** torne `.bt-ruler-corner` visível nem adicione o rótulo `TIMECODE` a ela. Ela está hoje em `left:-192px` relativo a `#bt-inner`, ou seja, fora da área visível — um detalhe pré-existente que este plano preserva intencionalmente. (Ver "Discrepância conhecida" abaixo.)
- **Não** faça a linha MARKERS ficar `sticky` junto com o ruler.
- **Não** renomeie identificadores internos nem os textos listados em Global Constraints.
- **Não** extraia o JS/CSS inline para arquivos separados, nem refatore o número mágico `192`.
- **Não** torne o clipe da pista `VÍDEO` arrastável, trimável ou deletável, e **não** adicione a ela os botões `H`/`L`/`+`. Ver item 10 acima.
- **Não** altere `compositeTick()`, `activeBroll()`, `drawFrame()`, `getBrollVideoEl()` nem qualquer parte do compositor. A pista `VÍDEO` só desenha o que já existe; o comportamento de preview não muda.
- **Não** adicione a pista `VÍDEO` a `snapshot()`, ao histórico de undo/redo, ao payload de `POST /api/beats` ou ao parsing de `fetchBeats()`. O formato do sidecar `.beats.json` fica byte-compatível com o de hoje.
- **Não** renomeie a pista `B-ROLL` nem mexa em `BROLL`, `findGapAt`, `addClipAt`, `startClipMove`, `startClipTrim` ou na multi-seleção. Na Tarefa 4 ela **só muda de posição**.

### Discrepância conhecida (informe ao Orquestrador, não resolva sozinho)

O screenshot anotado mostra um box com o texto **`TIMECODE`** no canto superior esquerdo da timeline. Esse texto **não existe em nenhum arquivo deste repositório** (verificável: `grep -r TIMECODE .` não retorna nada) e o `.bt-ruler-corner` do código atual está posicionado fora da tela. Ou seja: a build que o usuário fotografou não é idêntica ao working tree em `cc5c9e7` (o nome do arquivo, `anydesk00000.png`, sugere captura via acesso remoto a outra máquina). Isso **não bloqueia** nenhuma das três mudanças pedidas, que são bem definidas contra o código atual. Se ao rodar o app o Executor vir um canto `TIMECODE` renderizado, deve **parar e reportar** ao Orquestrador em vez de improvisar.

---

### Task 1: Renomear o passo 04 para TIMELINE

**Files:**
- Modify: `public/index.html:422` (botão da navegação)
- Modify: `public/index.html:503` (título da seção)
- Modify: `public/index.html:644-652` (rótulos dos rodapés `stepnav`)
- Test: n/a — projeto sem suíte de testes; verificação por asserção sobre o HTML + checklist no browser

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `STEP_LABELS` (objeto `Record<string,string>` mapeando id de passo → rótulo exibido) e `stepLabel(step: string): string` no escopo do `<script>` principal. Nenhuma tarefa posterior deste plano depende deles.

- [ ] **Step 1: Trocar o rótulo do botão da navegação**

Localize a linha exata:

```html
  <button data-step="beats"><span class="n" aria-hidden="true">04</span>BEATS</button>
```

Substitua por:

```html
  <button data-step="beats"><span class="n" aria-hidden="true">04</span>TIMELINE</button>
```

`data-step="beats"` permanece — é a chave usada por `goStep()`, `markDone()` e pelo listener em `public/index.html:2241`.

- [ ] **Step 2: Trocar o título da seção 04**

Localize:

```html
    <h2>04 / <em>BEATS</em></h2>
```

Substitua por:

```html
    <h2>04 / <em>TIMELINE</em></h2>
```

Não toque no `<p class="sub">` logo abaixo: ele fala de "beats" como conceito narrativo (papéis HOOK/CONTEXTO/CTA), não do nome do passo.

- [ ] **Step 3: Adicionar o mapa de rótulos e usá-lo nos rodapés**

Localize o bloco inteiro:

```js
/* next/prev footers on pipeline steps — guides first-time users through the flow */
const STEP_ORDER = ['visuals', 'voice', 'assemble', 'beats', 'export'];
STEP_ORDER.forEach((s, i) => {
  const prev = STEP_ORDER[i - 1], next = STEP_ORDER[i + 1];
  const d = document.createElement('div'); d.className = 'stepnav';
  d.innerHTML =
    (prev ? `<button class="btn ghost sm" onclick="goStep('${prev}')">← ${String(i).padStart(2,'0')} ${prev.toUpperCase()}</button>` : '<span></span>') +
    (next ? `<button class="btn sm" onclick="goStep('${next}')">${String(i + 2).padStart(2,'0')} ${next.toUpperCase()} →</button>` : '<span></span>');
  $('#step-' + s).appendChild(d);
});
```

Substitua o bloco inteiro por:

```js
/* next/prev footers on pipeline steps — guides first-time users through the flow */
const STEP_ORDER = ['visuals', 'voice', 'assemble', 'beats', 'export'];
/* O id interno do passo 04 continua 'beats' (rota /api/beats, sidecar .beats.json,
   #step-beats), mas o nome exibido é TIMELINE — daí o mapa em vez de toUpperCase(). */
const STEP_LABELS = { visuals: 'VISUALS', voice: 'VOICE', assemble: 'ASSEMBLE', beats: 'TIMELINE', export: 'EXPORT' };
const stepLabel = s => STEP_LABELS[s] || s.toUpperCase();
STEP_ORDER.forEach((s, i) => {
  const prev = STEP_ORDER[i - 1], next = STEP_ORDER[i + 1];
  const d = document.createElement('div'); d.className = 'stepnav';
  d.innerHTML =
    (prev ? `<button class="btn ghost sm" onclick="goStep('${prev}')">← ${String(i).padStart(2,'0')} ${stepLabel(prev)}</button>` : '<span></span>') +
    (next ? `<button class="btn sm" onclick="goStep('${next}')">${String(i + 2).padStart(2,'0')} ${stepLabel(next)} →</button>` : '<span></span>');
  $('#step-' + s).appendChild(d);
});
```

- [ ] **Step 4: Verificar por asserção que os rótulos trocaram e os ids não**

Rode, a partir da raiz do repositório:

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(name,cond)=>console.log((cond?'PASS':'FAIL')+' — '+name);
ck('botao de nav diz TIMELINE', h.includes('aria-hidden=\"true\">04</span>TIMELINE</button>'));
ck('h2 diz TIMELINE', h.includes('<h2>04 / <em>TIMELINE</em></h2>'));
ck('STEP_LABELS mapeia beats->TIMELINE', /STEP_LABELS\s*=\s*\{[^}]*beats:\s*'TIMELINE'/.test(h));
ck('rodapes usam stepLabel()', h.includes('\${stepLabel(prev)}') && h.includes('\${stepLabel(next)}'));
ck('nenhum toUpperCase() sobrou nos rodapes', !h.includes('prev.toUpperCase()') && !h.includes('next.toUpperCase()'));
ck('data-step=\"beats\" preservado', h.includes('data-step=\"beats\"'));
ck('id=\"step-beats\" preservado', h.includes('id=\"step-beats\"'));
ck('textos de dado BEATS preservados', h.includes('BEATS SALVOS') && h.includes('SALVAR BEATS') && h.includes('BEATS · REVISÃO') && h.includes('BEATS · PAPÉIS NARRATIVOS'));
"
```

Esperado: **8 linhas `PASS`, nenhum `FAIL`.**

- [ ] **Step 5: Verificar que o JS inline ainda parseia**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const m=h.match(/<script>([\s\S]*)<\/script>/);
if(!m) { console.log('FAIL — bloco <script> não encontrado'); process.exit(1); }
new Function(m[1]);
console.log('PASS — script inline parseia sem erro de sintaxe');
"
```

Esperado: `PASS — script inline parseia sem erro de sintaxe`. `new Function` compila sem executar, então nada que dependa de `document` roda aqui.

- [ ] **Step 6: Verificar no browser**

Rode `node server.js` e abra http://localhost:4870.

| Verificar | Esperado |
| --- | --- |
| Trilho lateral, item 04 | lê `04 TIMELINE` |
| Clicar em `04 TIMELINE` | a seção abre e o título lê `04 / TIMELINE` |
| Rodapé da seção 03 ASSEMBLE | botão direito lê `04 TIMELINE →` |
| Rodapé da seção 05 EXPORT | botão esquerdo lê `← 04 TIMELINE` |
| Rodapé da seção 04 | `← 03 ASSEMBLE` e `05 EXPORT →` |
| Navegar por todos os 5 botões do rodapé | cada um abre a seção correta |
| Console do browser (F12) | sem erros novos |

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "Rename pipeline step 04 from BEATS to TIMELINE in the UI"
```

---

### Task 2: Renomear a track BEATS para MARKERS

**Files:**
- Modify: `public/index.html:1306-1312` (rótulo e `aria-label`s da linha `data-track="beats"`)
- Test: n/a — verificação por asserção sobre o HTML + checklist no browser

**Interfaces:**
- Consumes: nada da Tarefa 1 (as duas são independentes; esta ordem é só conveniência de revisão).
- Produces: nenhuma API nova. A Tarefa 3 move exatamente este bloco de markup, já com o texto novo.

- [ ] **Step 1: Trocar o rótulo visível e os dois `aria-label`**

Localize:

```html
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">BEATS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track BEATS">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track BEATS">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
```

Substitua por:

```html
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">MARKERS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track MARKERS">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track MARKERS">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
```

Mudam apenas três textos. `data-track="beats"`, `id="bt-track-beats"` e os `data-act` permanecem — são lidos por `wireTracks()`, `applyTrackVisibility()`, `renderBeatsTrack()`, `startTrim()` e `startBeatDrag()`.

- [ ] **Step 2: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(name,cond)=>console.log((cond?'PASS':'FAIL')+' — '+name);
ck('rotulo visivel e MARKERS', h.includes('<span class=\"nm\">MARKERS</span>'));
ck('aria-label ocultar atualizado', h.includes('aria-label=\"Ocultar track MARKERS\"'));
ck('aria-label travar atualizado', h.includes('aria-label=\"Travar track MARKERS\"'));
ck('nenhum aria-label BEATS sobrou', !h.includes('track BEATS'));
ck('data-track=\"beats\" preservado', (h.match(/data-track=\"beats\"/g)||[]).length >= 2);
ck('id=\"bt-track-beats\" preservado', h.includes('id=\"bt-track-beats\"'));
"
```

Esperado: **6 linhas `PASS`.** (`data-track=\"beats\"` aparece 2× aqui — na `.bt-track-row` e na `.bt-row-resize`; a Tarefa 3 acrescenta uma terceira ocorrência num seletor JS, por isso o teste é `>= 2` e não `=== 2`.)

- [ ] **Step 3: Verificar no browser**

Reinicie `node server.js`, abra http://localhost:4870, vá em `04 TIMELINE` e escolha um vídeo em `VÍDEO`.

| Verificar | Esperado |
| --- | --- |
| Rótulo da primeira track | lê `MARKERS` (com o ícone `▤`) |
| Botão `H` da linha MARKERS | clicar esmaece o conteúdo da linha; clicar de novo restaura |
| Botão `L` da linha MARKERS | clicar acende o botão; com ele aceso, arrastar um beat **não** move nada; clicar de novo destrava |
| Leitor de tela / inspeção do DOM | os dois botões expõem "Ocultar track MARKERS" / "Travar track MARKERS" |
| Console do browser | sem erros novos |

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "Rename the BEATS timeline track to MARKERS"
```

---

### Task 3: Mover a track MARKERS para acima do timeline ruler

**Files:**
- Modify: `public/index.html:279-280` (`.bt-ruler-corner` — offset vertical)
- Modify: `public/index.html:285` (adicionar `.bt-tracks-top`)
- Modify: `public/index.html:326-327` (`.bt-playhead-flag` — offset vertical)
- Modify: `public/index.html:1302-1312` (mover o bloco de markup para antes do ruler)
- Modify: `public/index.html:1637-1646` (`renderInOut`)
- Modify: `public/index.html:1685-1698` (`renderTracks`)
- Modify: `public/index.html:1853-1873` (`startRowResize`)
- Modify: `public/index.html:2118-2119` (`wireTracks`)
- Test: n/a — verificação por asserção sobre o HTML + checklist de regressão no browser

**Interfaces:**
- Consumes: o bloco de markup da linha `data-track="beats"` já renomeado para `MARKERS` na Tarefa 2.
- Produces:
  - Elemento DOM `#bt-tracks-top` — `<div class="bt-tracks bt-tracks-top">`, primeiro filho de `#bt-inner`, contendo exatamente a linha `data-track="beats"`.
  - CSS custom property `--bt-markers-h` publicada em `#bt-inner`, valor em `px` (ex.: `"44px"`), consumida por `.bt-ruler-corner` e `.bt-playhead-flag`.
  - `syncMarkersOffset(): void` — função no escopo do IIFE da timeline que lê `offsetHeight` da linha MARKERS e publica `--bt-markers-h`.

- [ ] **Step 1: Adicionar a regra CSS do novo container**

Localize:

```css
.bt-tracks{position:relative; padding-bottom:12px}
```

Substitua por (a nova regra tem de vir **depois** — mesma especificidade, a última vence):

```css
.bt-tracks{position:relative; padding-bottom:12px}
/* Container da track MARKERS, que vive acima do ruler: sem o respiro de rodapé
   que a pilha de tracks de baixo usa. */
.bt-tracks-top{padding-bottom:0}
```

- [ ] **Step 2: Deslocar o canto do ruler pela altura da linha MARKERS**

Localize:

```css
.bt-ruler-corner{position:absolute; left:-192px; top:0; width:192px; height:22px;
  background:var(--panel); border-right:1px solid var(--line); border-bottom:1px solid var(--line); z-index:6}
```

Substitua por:

```css
.bt-ruler-corner{position:absolute; left:-192px; top:var(--bt-markers-h,0px); width:192px; height:22px;
  background:var(--panel); border-right:1px solid var(--line); border-bottom:1px solid var(--line); z-index:6}
```

Só `top` muda. `left:-192px` é preservado deliberadamente (ver "Fora de escopo").

- [ ] **Step 3: Deslocar a bandeira do playhead pela mesma altura**

Localize:

```css
.bt-playhead-flag{position:absolute; top:0; left:-6px; width:13px; height:13px; background:var(--go);
  clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%); pointer-events:auto; cursor:ew-resize}
```

Substitua por:

```css
.bt-playhead-flag{position:absolute; top:var(--bt-markers-h,0px); left:-6px; width:13px; height:13px; background:var(--go);
  clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%); pointer-events:auto; cursor:ew-resize}
```

Existe uma segunda regra `.bt-playhead-flag` na linha 371 (`animation:bt-pulse …`). **Não a toque** — ela não define `top`.

- [ ] **Step 4: Mover o bloco de markup para antes do ruler**

Localize (dentro do template string de `buildDom()`):

```html
        <div class="bt-inner" id="bt-inner">
          <div class="bt-ruler-corner"></div>
          <div class="bt-ruler" id="bt-ruler"></div>
          <div class="bt-tracks" id="bt-tracks">
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">MARKERS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track MARKERS">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track MARKERS">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
            <div class="bt-track-row" data-track="audio">
```

Substitua por:

```html
        <div class="bt-inner" id="bt-inner">
          <div class="bt-tracks bt-tracks-top" id="bt-tracks-top">
            <div class="bt-track-row" data-track="beats">
              <div class="bt-track-label"><span class="ic">▤</span><span class="nm">MARKERS</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track MARKERS">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track MARKERS">L</button></div>
              <div class="bt-track-content" id="bt-track-beats"></div>
              <div class="bt-row-resize" data-track="beats"></div>
            </div>
          </div>
          <div class="bt-ruler-corner"></div>
          <div class="bt-ruler" id="bt-ruler"></div>
          <div class="bt-tracks" id="bt-tracks">
            <div class="bt-track-row" data-track="audio">
```

O restante do bloco (`audio`, `legend`, `broll`, `music`, `#bt-playhead`, `#bt-inout`) fica intacto. Confira que `#bt-tracks` continua fechando corretamente antes de `<div class="bt-playhead" id="bt-playhead">`.

- [ ] **Step 5: Adicionar `syncMarkersOffset()` e chamá-la em `renderTracks()`**

Localize a função `renderTracks` completa:

```js
  function renderTracks() {
    renderRuler();
    renderBeatsTrack();
    drawWaveform();
    renderLegendTrack();
    renderLegendList();
    renderBrollTrack();
    renderMusicTrack();
    renderPlayhead();
    renderInOut();
    updateTimeDisplay();
    highlightActiveWord();
    applyTrackVisibility();
  }
```

Substitua por:

```js
  /* A track MARKERS fica acima do ruler, então o canto do ruler e a bandeira do
     playhead precisam descer pela altura dela — que é redimensionável (44–240px).
     Publicamos essa altura como CSS var em #bt-inner em vez de fixá-la no CSS.
     Altura 0 (painel oculto) é ignorada para não zerar um valor bom. */
  function syncMarkersOffset() {
    const inner = $q('#bt-inner');
    const row = $q('.bt-track-row[data-track="beats"]');
    if (!inner || !row) return;
    const h = row.offsetHeight;
    if (h > 0) inner.style.setProperty('--bt-markers-h', h + 'px');
  }
  function renderTracks() {
    renderRuler();
    renderBeatsTrack();
    drawWaveform();
    renderLegendTrack();
    renderLegendList();
    renderBrollTrack();
    renderMusicTrack();
    renderPlayhead();
    renderInOut();
    updateTimeDisplay();
    highlightActiveWord();
    applyTrackVisibility();
    syncMarkersOffset();
  }
```

- [ ] **Step 6: Re-sincronizar o offset durante o redimensionamento da linha**

Localize, dentro de `startRowResize()`:

```js
    function onMove(ev) {
      const h = Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, startH + (ev.clientY - startY)));
      trackHeights[track] = h;
      row.style.height = h + 'px';
      if (track === 'audio') drawWaveform();
      if (track === 'broll') renderBrollTrack();
      if (track === 'music') renderMusicTrack();
    }
```

Substitua por:

```js
    function onMove(ev) {
      const h = Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, startH + (ev.clientY - startY)));
      trackHeights[track] = h;
      row.style.height = h + 'px';
      if (track === 'audio') drawWaveform();
      if (track === 'broll') renderBrollTrack();
      if (track === 'music') renderMusicTrack();
      if (track === 'beats') syncMarkersOffset();
    }
```

- [ ] **Step 7: Estender o overlay de IN/OUT até o topo**

Localize:

```js
    el.style.top = '22px'; el.style.bottom = '0';
```

Substitua por:

```js
    // Vai até o topo de #bt-inner: o ruler (opaco, z-index 5 > 1) mascara a
    // própria faixa, então a banda cobre MARKERS e as tracks de baixo sem cálculo.
    el.style.top = '0'; el.style.bottom = '0';
```

- [ ] **Step 8: Ligar os listeners delegados também no novo container**

Localize, dentro de `wireTracks()`:

```js
    $q('#bt-tracks').addEventListener('mousedown', onTracksMouseDown);
    $q('#bt-tracks').addEventListener('dblclick', onTracksDblClick);
```

Substitua por:

```js
    // A track MARKERS vive em #bt-tracks-top (acima do ruler); ambos os containers
    // precisam da mesma delegação, senão arrastar/trimar/renomear beat morre em silêncio.
    ['#bt-tracks-top', '#bt-tracks'].forEach(sel => {
      const host = $q(sel);
      if (!host) return;
      host.addEventListener('mousedown', onTracksMouseDown);
      host.addEventListener('dblclick', onTracksDblClick);
    });
```

- [ ] **Step 9: Verificar por asserção a nova ordem do DOM e as edições**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(name,cond)=>console.log((cond?'PASS':'FAIL')+' — '+name);
const iTop=h.indexOf('id=\"bt-tracks-top\"'), iCorner=h.indexOf('class=\"bt-ruler-corner\"'), iRuler=h.indexOf('id=\"bt-ruler\"'), iTracks=h.indexOf('id=\"bt-tracks\"');
ck('#bt-tracks-top existe', iTop > -1);
ck('ordem: tracks-top < ruler-corner < ruler < tracks', iTop > -1 && iTop < iCorner && iCorner < iRuler && iRuler < iTracks);
ck('linha beats esta dentro de #bt-tracks-top', /id=\"bt-tracks-top\"[^]{0,120}data-track=\"beats\"/.test(h));
ck('linha beats saiu de #bt-tracks', (h.slice(h.indexOf('id=\"bt-tracks\"')).match(/data-track=\"(\w+)\"/)||[])[1] !== 'beats');
ck('.bt-tracks-top declarada no CSS', h.includes('.bt-tracks-top{padding-bottom:0}'));
ck('ruler-corner usa a var', h.includes('.bt-ruler-corner{position:absolute; left:-192px; top:var(--bt-markers-h,0px)'));
ck('playhead-flag usa a var', h.includes('.bt-playhead-flag{position:absolute; top:var(--bt-markers-h,0px)'));
ck('syncMarkersOffset definida', h.includes('function syncMarkersOffset()'));
ck('syncMarkersOffset chamada em renderTracks', /applyTrackVisibility\(\);\s*\n\s*syncMarkersOffset\(\);/.test(h));
ck('syncMarkersOffset chamada no resize', h.includes(\"if (track === 'beats') syncMarkersOffset();\"));
ck('inout comeca no topo', h.includes(\"el.style.top = '0'; el.style.bottom = '0';\") && !h.includes(\"el.style.top = '22px'\"));
ck('delegacao nos dois containers', h.includes(\"['#bt-tracks-top', '#bt-tracks'].forEach\"));
ck('sem listener antigo solto', !h.includes(\"\\\$q('#bt-tracks').addEventListener\"));
"
```

Esperado: **13 linhas `PASS`, nenhum `FAIL`.**

- [ ] **Step 10: Verificar que o JS inline ainda parseia**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const m=h.match(/<script>([\s\S]*)<\/script>/);
if(!m) { console.log('FAIL — bloco <script> não encontrado'); process.exit(1); }
new Function(m[1]);
console.log('PASS — script inline parseia sem erro de sintaxe');
"
```

Esperado: `PASS — script inline parseia sem erro de sintaxe`.

- [ ] **Step 11: Checklist de regressão no browser**

Rode `node server.js`, abra http://localhost:4870, vá em `04 TIMELINE` e selecione um vídeo (ex.: o que estiver em `output/`). Percorra **todos** os itens — este é o gate de "não quebrou nada":

**Layout**

| Verificar | Esperado |
| --- | --- |
| Ordem vertical do painel | linha `MARKERS` (com a barra `CORTE`) em cima; régua de tempo (`00:00.0 … 00:05.0`) logo abaixo; depois `ÁUDIO`, `LEGENDA`, `B-ROLL`, `TRILHA` |
| Coluna de rótulos | os 5 rótulos continuam alinhados na mesma coluna de 192px, sem degrau |
| Bandeira do playhead (pentágono amarelo) | está sobre a régua, **não** no topo absoluto do painel |
| Linha vertical do playhead | atravessa a linha MARKERS e todas as tracks de baixo |

**Interações da linha MARKERS**

| Verificar | Esperado |
| --- | --- |
| Clicar num beat | seleciona (contorno amarelo) |
| Duplo-clique num beat | abre o popover `PAPEL NARRATIVO`; escolher `HOOK` e `SALVAR` renomeia |
| Arrastar a alça direita de um beat | ajusta a borda entre dois beats; as durações em `s` atualizam ao vivo |
| Arrastar o corpo de um beat para outra posição | aparece o marcador de drop **alinhado com a linha MARKERS** (não flutuando acima) e soltar reordena |
| Clicar numa área vazia da linha MARKERS | move o playhead para aquele tempo |
| Arrastar a alça de resize (borda inferior da linha) | a linha cresce/encolhe; **a régua e a bandeira do playhead descem/sobem junto**, sem sobreposição |
| Botões `H` / `L` da linha MARKERS | ocultar e travar continuam funcionando (com `L` aceso, arrastar não muda nada) |

**Transporte, zoom e demais tracks**

| Verificar | Esperado |
| --- | --- |
| `▶` / `J K L` / `-1f` `+1f` | reprodução, shuttle e frame-step funcionam; o playhead acompanha |
| Clicar/arrastar na régua | scrub funciona |
| Arrastar a bandeira do playhead | scrub funciona |
| `IN` e `OUT` | a faixa IN/OUT aparece cobrindo a linha MARKERS **e** as tracks de baixo, e **não** pinta por cima da régua |
| `SPLIT`, `MERGE`, `RENAME` | funcionam sobre o beat selecionado |
| `UNDO` / `REDO` | desfazem e refazem as edições acima |
| `+`, `−`, `FIT`, e `Ctrl`+roda do mouse | o zoom muda e MARKERS, régua, waveform, legenda, B-ROLL e trilha permanecem alinhados no mesmo tempo |
| Rolagem horizontal até o fim | régua e todas as tracks continuam alinhadas |
| Tracks `ÁUDIO` / `LEGENDA` / `B-ROLL` / `TRILHA` | waveform desenha, palavras aparecem (ou a mensagem "Sem legenda nesta sessão"), `+` adiciona clipe, `M`/`S` na trilha funcionam |
| `SALVAR BEATS` e depois `CARREGAR` | salva o sidecar e recarrega os mesmos beats |
| Trocar o vídeo no seletor `VÍDEO` | o painel se reconstrói inteiro, já com MARKERS acima da régua |
| Console do browser (F12) | sem erros novos |

- [ ] **Step 12: Commit**

```bash
git add public/index.html
git commit -m "Move the MARKERS track above the timeline ruler"
```

---

### Task 4: Reordenar as pistas — B-ROLL no topo, áudios embaixo

**Files:**
- Modify: `public/index.html:1313-1344` (as quatro `.bt-track-row` dentro de `#bt-tracks`)
- Test: n/a — verificação por asserção sobre o HTML + checklist no browser

**Interfaces:**
- Consumes: a estrutura produzida pela Tarefa 3 — `#bt-tracks` contendo, nesta ordem, as linhas `audio`, `legend`, `broll`, `music`.
- Produces: `#bt-tracks` contendo, nesta ordem, as linhas `broll`, `legend`, `audio`, `music`. A Tarefa 5 insere a linha `video` entre `broll` e `legend`.

Esta é uma **reordenação pura de markup**: nenhum atributo, id, rótulo, classe ou linha de JS muda. É segura porque nada no código depende da ordem das linhas — `renderTracks()` chama cada render por `id`, e `wireTracks()`/`applyTrackVisibility()` iteram `.bt-track-row` como conjunto, não como sequência.

- [ ] **Step 1: Reordenar as quatro linhas**

Localize o bloco das quatro linhas dentro de `<div class="bt-tracks" id="bt-tracks">` (hoje na ordem `audio`, `legend`, `broll`, `music`) e reescreva-o exatamente assim — `broll` primeiro, depois `legend`, `audio` e `music`:

```html
          <div class="bt-tracks" id="bt-tracks">
            <div class="bt-track-row" data-track="broll">
              <div class="bt-track-label"><span class="ic">▭</span><span class="nm">B-ROLL</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe" aria-label="Adicionar clipe à track B-ROLL">+</button>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track B-ROLL">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track B-ROLL">L</button></div>
              <div class="bt-track-content" id="bt-track-broll"></div>
              <div class="bt-row-resize" data-track="broll"></div>
            </div>
            <div class="bt-track-row" data-track="legend">
              <div class="bt-track-label"><span class="ic">T</span><span class="nm">LEGENDA</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track LEGENDA">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track LEGENDA">L</button></div>
              <div class="bt-track-content" id="bt-track-legend"></div>
              <div class="bt-row-resize" data-track="legend"></div>
            </div>
            <div class="bt-track-row" data-track="audio">
              <div class="bt-track-label"><span class="ic">♪</span><span class="nm">ÁUDIO</span>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track ÁUDIO">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track ÁUDIO">L</button></div>
              <div class="bt-track-content" id="bt-track-audio"><canvas id="bt-wave"></canvas></div>
              <div class="bt-row-resize" data-track="audio"></div>
            </div>
            <div class="bt-track-row" data-track="music">
              <div class="bt-track-label"><span class="ic">♫</span><span class="nm">TRILHA</span>
                <button class="bt-tctl" data-act="add" title="adicionar clipe" aria-label="Adicionar clipe à track TRILHA">+</button>
                <button class="bt-tctl" data-act="mute" title="mudo" aria-label="Silenciar trilha TRILHA">M</button>
                <button class="bt-tctl" data-act="solo" title="solo" aria-label="Ativar solo da trilha TRILHA">S</button>
                <button class="bt-tctl" data-act="hide" title="ocultar" aria-label="Ocultar track TRILHA">H</button>
                <button class="bt-tctl" data-act="lock" title="travar" aria-label="Travar track TRILHA">L</button></div>
              <div class="bt-track-content" id="bt-track-music"></div>
              <div class="bt-row-resize" data-track="music"></div>
            </div>
          </div>
```

Compare caractere a caractere com o que estava lá: o conteúdo de cada linha é idêntico ao original, só a ordem dos quatro blocos mudou.

- [ ] **Step 2: Verificar por asserção a nova ordem e que nada mais mudou**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(name,cond)=>console.log((cond?'PASS':'FAIL')+' — '+name);
const order=[...h.matchAll(/<div class=\"bt-track-row\" data-track=\"(\w+)\">/g)].map(m=>m[1]);
ck('ordem das pistas e beats,broll,legend,audio,music', JSON.stringify(order)===JSON.stringify(['beats','broll','legend','audio','music']));
ck('5 linhas de track no total', order.length===5);
ck('todos os ids de conteudo presentes', ['beats','broll','legend','audio','music'].every(t=>h.includes('id=\"bt-track-'+t+'\"')));
ck('canvas do waveform segue na linha audio', h.includes('id=\"bt-track-audio\"><canvas id=\"bt-wave\"></canvas>'));
ck('5 alcas de resize', (h.match(/class=\"bt-row-resize\" data-track=/g)||[]).length===5);
ck('controles da trilha intactos', ['add','mute','solo','hide','lock'].every(a=>h.includes('data-act=\"'+a+'\"')));
"
```

Esperado: **6 linhas `PASS`.** (A linha `beats` aparece primeiro na lista porque vive em `#bt-tracks-top`, acima da régua — é o resultado da Tarefa 3.)

- [ ] **Step 3: Verificar que o JS inline ainda parseia**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const m=h.match(/<script>([\s\S]*)<\/script>/);
if(!m) { console.log('FAIL — bloco <script> não encontrado'); process.exit(1); }
new Function(m[1]);
console.log('PASS — script inline parseia sem erro de sintaxe');
"
```

Esperado: `PASS — script inline parseia sem erro de sintaxe`.

- [ ] **Step 4: Verificar no browser**

Rode `node server.js`, abra http://localhost:4870, vá em `04 TIMELINE` e escolha um vídeo.

| Verificar | Esperado |
| --- | --- |
| Ordem vertical | `MARKERS` (acima da régua), régua, `B-ROLL`, `LEGENDA`, `ÁUDIO`, `TRILHA` |
| Waveform | desenha na linha `ÁUDIO`, na nova posição, alinhado no tempo com as demais |
| Palavras da legenda | aparecem na linha `LEGENDA` (ou a mensagem "Sem legenda nesta sessão"), alinhadas no tempo |
| `+` na linha B-ROLL | abre o popover de assets e adiciona clipe normalmente |
| Arrastar / trimar / multi-selecionar (Shift+clique) clipes de B-ROLL | funcionam como antes |
| `+`, `M`, `S` na linha TRILHA | funcionam como antes |
| Redimensionar cada uma das 5 linhas | cada uma cresce/encolhe independentemente, sem afetar as vizinhas |
| Playhead e faixa IN/OUT | atravessam todas as linhas na ordem nova, sem desalinhamento |
| Console do browser | sem erros novos |

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "Reorder timeline tracks: B-ROLL on top, audio tracks at the bottom"
```

---

### Task 5: Adicionar a pista VÍDEO (V1) só-leitura

**Files:**
- Modify: `public/index.html:350-361` (bloco CSS `.bt-clip*` — adicionar `.bt-clip-base`)
- Modify: `public/index.html:954` e `public/index.html:2171` (`trackHeights` — duas ocorrências)
- Modify: `public/index.html:1154-1170` (`ensureThumbnail`)
- Modify: `public/index.html` — markup: inserir o row `video` entre `broll` e `legend`
- Modify: `public/index.html:1474-1515` (adicionar `baseNameOf` + `renderVideoTrack`, corrigir a thumb `'pending'`)
- Modify: `public/index.html:1685-1698` (`renderTracks`)
- Test: n/a — verificação por asserção sobre o HTML + checklist no browser

**Interfaces:**
- Consumes: a ordem `broll`, `legend`, `audio`, `music` dentro de `#bt-tracks` (Tarefa 4); `currentPath` (string | null) e `DURATION` (number, segundos) do escopo do IIFE; `thumbCache` (`Map<string, string|'pending'|null>`) e `ensureThumbnail(path: string): void`; os helpers `timeToX`, `contentWidth`, `escapeHtml`, `$q`.
- Produces:
  - Elemento DOM `#bt-track-video` dentro de uma `.bt-track-row[data-track="video"]`.
  - `baseNameOf(p: string): string` — último segmento de um caminho, aceitando `/` e `\`.
  - `renderVideoTrack(): void` — desenha o clipe base a partir de `currentPath`/`DURATION`.
  - Classe CSS `.bt-clip-base` (deliberadamente **não** `.bt-clip`).

- [ ] **Step 1: Adicionar o CSS do clipe base**

Localize:

```css
.bt-clip.music{border-left:3px solid var(--warn)}
```

Insira **logo abaixo** dessa linha:

```css
/* Clipe base da pista VÍDEO (V1). Classe própria — nunca .bt-clip — para que
   onTracksMouseDown não o confunda com um clipe editável de B-ROLL/TRILHA. */
.bt-clip-base{position:absolute; top:5px; bottom:5px; border-radius:5px; overflow:hidden;
  display:flex; align-items:center; gap:6px; padding:0 8px; cursor:default;
  border:1px solid var(--line); border-left:3px solid var(--dim); background:var(--panel2)}
.bt-clip-base .nm{position:relative; z-index:1; font:600 9.5px var(--sans); color:var(--dim);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; text-shadow:0 1px 3px rgba(0,0,0,.9)}
.bt-clip-base .tag{position:relative; z-index:1; flex:0 0 auto; font:400 8.5px var(--mono);
  color:var(--faint); letter-spacing:.06em}
```

A regra `.bt-clip-thumb` já existente (`position:absolute; inset:0; …`) é reaproveitada sem alteração.

- [ ] **Step 2: Inserir a linha da pista no markup**

Localize o fim da linha `broll` seguido do início da linha `legend` (resultado da Tarefa 4):

```html
              <div class="bt-track-content" id="bt-track-broll"></div>
              <div class="bt-row-resize" data-track="broll"></div>
            </div>
            <div class="bt-track-row" data-track="legend">
```

Substitua por:

```html
              <div class="bt-track-content" id="bt-track-broll"></div>
              <div class="bt-row-resize" data-track="broll"></div>
            </div>
            <div class="bt-track-row" data-track="video">
              <div class="bt-track-label"><span class="ic">▶</span><span class="nm">VÍDEO</span></div>
              <div class="bt-track-content" id="bt-track-video"></div>
              <div class="bt-row-resize" data-track="video"></div>
            </div>
            <div class="bt-track-row" data-track="legend">
```

Note a ausência deliberada de botões `.bt-tctl` — ver item 10 do contexto. A alça `.bt-row-resize` **fica**: redimensionar a altura da linha é apresentação, não edição do clipe.

- [ ] **Step 3: Registrar a altura padrão da nova pista (duas ocorrências)**

Existem **duas** linhas idênticas que inicializam `trackHeights` — uma na declaração do estado (`:954`) e outra no reset dentro de `loadVideo()` (`:2171`). Ambas precisam da chave nova, senão `wireTracks()` cai no fallback `TRACK_MIN_H` numa e a altura da pista não persiste na troca de vídeo.

Localize (2×):

```js
trackHeights = { beats: 44, audio: 44, legend: 44, broll: 44, music: 44 };
```

e

```js
  let trackHeights = { beats: 44, audio: 44, legend: 44, broll: 44, music: 44 };
```

Substitua ambas mantendo o prefixo de cada uma (`let ` na declaração, sem `let ` no reset), acrescentando `video: 44`:

```js
  let trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44 };
```

```js
    trackHeights = { beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44 };
```

- [ ] **Step 4: Adicionar `baseNameOf` e `renderVideoTrack`, e corrigir a thumb `'pending'`**

Primeiro, corrija o teste da thumbnail. Localize, dentro de `renderClipTrack`:

```js
      if (track === 'broll') {
        ensureThumbnail(c.path);
        const t = thumbCache.get(c.path);
        if (t) media = `<img class="bt-clip-thumb" src="${t}">`;
      }
```

Substitua por:

```js
      if (track === 'broll') {
        ensureThumbnail(c.path);
        const t = thumbCache.get(c.path);
        // 'pending' é truthy: sem o segundo teste, o primeiro render emite
        // <img src="pending"> e pinta um ícone de imagem quebrada sobre o clipe.
        if (t && t !== 'pending') media = `<img class="bt-clip-thumb" src="${t}">`;
      }
```

Depois, localize:

```js
  function renderBrollTrack() { renderClipTrack('broll', 'bt-track-broll'); }
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
```

Substitua por:

```js
  function renderBrollTrack() { renderClipTrack('broll', 'bt-track-broll'); }
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
  function baseNameOf(p) { return String(p || '').split(/[\\/]/).pop(); }
  /* Pista V1: o vídeo principal como clipe base só-leitura, ocupando a timeline
     inteira. Não é editável — DURATION, o <video> do preview, a régua, o playhead
     e os beats saem dele, então mover/trimar aqui seria mexer na espinha da
     timeline. O B-ROLL (V2) cobre trechos dele no compositor; a linha continua
     cheia, como o V1 do Premiere. Classe .bt-clip-base (nunca .bt-clip) para que
     onTracksMouseDown trate um clique aqui como scrub do playhead. */
  function renderVideoTrack() {
    const host = $q('#bt-track-video');
    if (!host) return;
    host.style.width = contentWidth() + 'px';
    if (!currentPath) { host.innerHTML = ''; return; }
    ensureThumbnail(currentPath);
    const t = thumbCache.get(currentPath);
    const media = (t && t !== 'pending') ? `<img class="bt-clip-thumb" src="${t}">` : '';
    host.innerHTML = `<div class="bt-clip-base" style="left:0;width:${Math.max(4, timeToX(DURATION))}px">
        ${media}
        <span class="nm">${escapeHtml(baseNameOf(currentPath))}</span><span class="tag">V1 · BASE</span>
      </div>`;
  }
```

- [ ] **Step 5: Re-renderizar a pista VÍDEO quando a thumbnail ficar pronta**

`ensureThumbnail` hoje avisa só a pista de B-ROLL. Localize, dentro dela:

```js
      thumbCache.set(path, c.toDataURL('image/jpeg', .7));
      v.remove();
      renderBrollTrack();
```

Substitua por:

```js
      thumbCache.set(path, c.toDataURL('image/jpeg', .7));
      v.remove();
      renderBrollTrack();
      renderVideoTrack();
```

Sem isso, a thumb do vídeo principal só apareceria no próximo render disparado por outra causa (zoom, seek, edição de beat).

- [ ] **Step 6: Chamar `renderVideoTrack()` em `renderTracks()`**

Localize, dentro de `renderTracks`:

```js
    renderBrollTrack();
    renderMusicTrack();
```

Substitua por:

```js
    renderBrollTrack();
    renderVideoTrack();
    renderMusicTrack();
```

Não mexa no resto de `renderTracks` — em particular, `syncMarkersOffset()` continua sendo a última chamada da função.

- [ ] **Step 7: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(name,cond)=>console.log((cond?'PASS':'FAIL')+' — '+name);
const order=[...h.matchAll(/<div class=\"bt-track-row\" data-track=\"(\w+)\">/g)].map(m=>m[1]);
ck('ordem final beats,broll,video,legend,audio,music', JSON.stringify(order)===JSON.stringify(['beats','broll','video','legend','audio','music']));
ck('#bt-track-video existe', h.includes('id=\"bt-track-video\"'));
ck('pista VIDEO sem botoes H/L/+', h.includes('<div class=\"bt-track-label\"><span class=\"ic\">▶</span><span class=\"nm\">VÍDEO</span></div>'));
ck('.bt-clip-base declarada no CSS', h.includes('.bt-clip-base{position:absolute;'));
ck('clipe base usa .bt-clip-base', h.includes('<div class=\"bt-clip-base\"'));
ck('renderVideoTrack definida', h.includes('function renderVideoTrack()'));
ck('baseNameOf definida', h.includes('function baseNameOf(p)'));
ck('renderVideoTrack chamada em renderTracks', /renderBrollTrack\(\);\s*\n\s*renderVideoTrack\(\);\s*\n\s*renderMusicTrack\(\);/.test(h));
ck('renderVideoTrack chamada por ensureThumbnail', /renderBrollTrack\(\);\s*\n\s*renderVideoTrack\(\);\s*\n\s*\}, \{ once: true \}\)/.test(h));
ck('trackHeights tem video nas 2 ocorrencias', (h.match(/trackHeights = \{ beats: 44, video: 44, audio: 44, legend: 44, broll: 44, music: 44 \};/g)||[]).length===2);
ck('thumb pending corrigida', h.includes(\"t !== 'pending'\") && !/if \(t\) media = /.test(h));
ck('syncMarkersOffset segue por ultimo em renderTracks', /applyTrackVisibility\(\);\s*\n\s*syncMarkersOffset\(\);/.test(h));
ck('compositor intocado', h.includes('function compositeTick()') && h.includes('function activeBroll(t)') && !h.includes('activeVideo('));
"
```

Esperado: **13 linhas `PASS`, nenhum `FAIL`.**

- [ ] **Step 8: Verificar que o JS inline ainda parseia**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const m=h.match(/<script>([\s\S]*)<\/script>/);
if(!m) { console.log('FAIL — bloco <script> não encontrado'); process.exit(1); }
new Function(m[1]);
console.log('PASS — script inline parseia sem erro de sintaxe');
"
```

Esperado: `PASS — script inline parseia sem erro de sintaxe`.

- [ ] **Step 9: Checklist de regressão no browser**

Rode `node server.js`, abra http://localhost:4870, vá em `04 TIMELINE` e escolha um vídeo. Este é o gate final da feature.

**A pista VÍDEO**

| Verificar | Esperado |
| --- | --- |
| Posição | entre `B-ROLL` (acima) e `LEGENDA` (abaixo) |
| Rótulo | `▶ VÍDEO`, **sem** botões `H`, `L` ou `+` |
| Clipe base | ocupa a timeline inteira, de `00:00` até o fim, com o nome do arquivo e o selo `V1 · BASE` |
| Thumbnail | aparece no clipe base em 1–2s; **nenhum ícone de imagem quebrada** em momento algum |
| Clicar no clipe base | move o playhead para aquele ponto — **não** inicia arrasto, não seleciona nada |
| Arrastar o clipe base | nada acontece além do seek inicial; o clipe não se move nem redimensiona |
| Duplo-clique no clipe base | nada acontece (nenhum popover) |
| Redimensionar a linha VÍDEO | a linha cresce/encolhe; o clipe base acompanha a altura |
| Zoom (`+`, `−`, `FIT`, Ctrl+roda) | o clipe base continua cobrindo exatamente `00:00` até o fim, alinhado com a régua |
| Trocar o vídeo no seletor `VÍDEO` | o clipe base passa a mostrar o novo arquivo e a nova duração |

**Regressão do que já existia**

| Verificar | Esperado |
| --- | --- |
| Clipes de B-ROLL | thumbnail aparece sem passar por imagem quebrada |
| Arrastar / trimar / Shift+clique em clipes de B-ROLL | funcionam como antes |
| Preview: playhead sobre um clipe de B-ROLL | o canvas mostra o frame do B-ROLL |
| Preview: playhead fora de qualquer B-ROLL | o canvas mostra o frame do vídeo principal |
| `H` na linha B-ROLL | com a pista oculta, o preview volta a mostrar o vídeo principal em toda a timeline |
| `SALVAR BEATS` → `CARREGAR` | round-trip idêntico; abra `output/<nome>.beats.json` e confirme que **não** há nenhuma chave nova |
| `UNDO` / `REDO` | continuam desfazendo beats e clipes; a pista VÍDEO nunca muda (ela não tem estado) |
| Transporte, `IN`/`OUT`, `SPLIT`/`MERGE`/`RENAME`, MARKERS, LEGENDA, ÁUDIO, TRILHA | tudo como na Tarefa 3 / Tarefa 4 |
| Console do browser | sem erros novos |

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "Add a read-only VÍDEO (V1) base track to the timeline"
```

---

## Critérios de aceite (checáveis)

1. `node -e` do Step 4 da Tarefa 1 imprime 8 `PASS` e nenhum `FAIL`.
2. `node -e` do Step 2 da Tarefa 2 imprime 6 `PASS` e nenhum `FAIL`.
3. `node -e` do Step 9 da Tarefa 3 imprime 13 `PASS` e nenhum `FAIL`.
4. `node -e` do Step 2 da Tarefa 4 imprime 6 `PASS` e nenhum `FAIL`.
5. `node -e` do Step 7 da Tarefa 5 imprime 13 `PASS` e nenhum `FAIL`.
6. O check de sintaxe (`new Function` sobre o `<script>` inline) imprime `PASS` após cada tarefa.
7. `git diff --stat cc5c9e7..HEAD` mostra **apenas** `public/index.html` alterado (os `.png` em `docs/plans/` e este `.md` são adições à parte).
8. `grep -c 'data-step="beats"\|id="step-beats"\|id="bt-track-beats"\|/api/beats' public/index.html` retorna um número **≥ 4** — os identificadores internos sobreviveram ao rename.
9. O sidecar continua compatível: salve os beats de um vídeo, abra `output/<nome>.beats.json` e confirme que as chaves de topo continuam sendo exatamente `beats`, `broll` e `music` (mais o que já existia), sem nenhuma chave nova.
10. O arquivo continua CRLF puro: o comando de verificação em Global Constraints reporta `LF-solto 0`.
11. Os cinco checklists de browser (T1 Step 6, T2 Step 3, T3 Step 11, T4 Step 4, T5 Step 9) foram percorridos item a item, com todos os "Esperado" confirmados. Qualquer item que falhar é **bloqueante**: pare e reporte ao Orquestrador em vez de improvisar um conserto.

---

## Status

_Seção de propriedade exclusiva do Executor. Registre aqui, incrementalmente, o que já foi feito, o resultado das verificações e qualquer desvio encontrado._

- [x] Task 1 — Renomear o passo 04 para TIMELINE — Step 4: 8 PASS, 0 FAIL. Step 5 (sintaxe): PASS. CRLF: 2249, LF-solto 0. Commit não executado (regra de execução desta rodada).
- [x] Task 2 — Renomear a track BEATS para MARKERS — Step 2: 6 PASS, 0 FAIL. Sintaxe: PASS. CRLF: 2249, LF-solto 0. Commit não executado (regra de execução desta rodada).
- [x] Task 3 — Mover a track MARKERS para acima do timeline ruler — Step 9: 13 PASS, 0 FAIL. Sintaxe: PASS. CRLF: 2275, LF-solto 0. Commit não executado (regra de execução desta rodada).
- [x] Task 4 — Reordenar as pistas (B-ROLL no topo, áudios embaixo) — Step 2: 6 PASS, 0 FAIL. Sintaxe: PASS. CRLF: 2275, LF-solto 0. Commit não executado (regra de execução desta rodada).
- [x] Task 5 — Adicionar a pista VÍDEO (V1) só-leitura — Step 7: 13 PASS, 0 FAIL. Sintaxe: PASS. CRLF: 2313, LF-solto 0. Commit não executado (regra de execução desta rodada).

**Resumo geral desta execução (Executor, rodada única cobrindo Tarefas 1-5):**
Todas as 5 tarefas foram implementadas exatamente conforme os âncoras do plano (todos casaram na primeira tentativa, sem divergência do commit `cc5c9e7`). Todos os blocos `node -e` de asserção programática passaram (8+6+13+6+13 = 46 PASS, 0 FAIL) e o check de sintaxe (`new Function` sobre o `<script>` inline) passou após cada tarefa. CRLF preservado de ponta a ponta em todas as 5 verificações (LF-solto 0 sempre). Verificação extra do critério de aceite 8 (`grep -c` de identificadores internos `data-step="beats"`, `id="step-beats"`, `id="bt-track-beats"`, `/api/beats`) retornou 6, ≥ 4 conforme exigido.
Por instrução explícita desta rodada de execução: nenhum comando git foi executado (todos os Steps de "Commit" foram pulados) e nenhum dos 5 checklists de browser foi percorrido (T1 Step 6, T2 Step 3, T3 Step 11, T4 Step 4, T5 Step 9) — ficam pendentes de verificação manual pelo Orquestrador/usuário antes do commit. Todas as mudanças permanecem no working tree, sem stage.
