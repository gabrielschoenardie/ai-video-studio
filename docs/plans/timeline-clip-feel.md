# Sensação de uso na timeline (camada A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` (ou o subagente `executor` deste projeto) para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para tracking. A seção `## Status` no fim é de propriedade exclusiva do Executor.

**Goal:** Dar ao painel `04 TIMELINE` o vocabulário de interação de um editor não-linear — snap magnético de borda dupla com guia visual, menu de contexto no clipe, e dividir/duplicar/deletar — corrigindo de passagem um defeito pré-existente do trim-in.

**Architecture:** Tudo em `public/index.html`, dentro do IIFE da timeline, seguindo o padrão do arquivo (SPA de arquivo único, sem bundler, vanilla JS). Cinco unidades: um motor de snap que separa *consultar* o alvo de *aplicar* o encaixe; um encaixe de borda dupla que testa cabeça e cauda do clipe arrastado; uma guia visual que reusa CSS já existente e nunca instanciado; um menu de contexto que reusa a infraestrutura `.bt-pop` de três popovers existentes; e um campo `srcIn` no clipe que desacopla "onde está na timeline" de "de onde toca na mídia".

**Tech Stack:** HTML/CSS/JS vanilla inline em `public/index.html`. Sem npm, sem transpilação, sem test runner. Node ≥18 apenas para servir (`node server.js` → http://localhost:4870).

**Spec:** `docs/plans/timeline-clip-feel-design.md` — leia antes de começar. Ela explica *por quê* de cada decisão; este plano só diz *o quê* e *como*.

---

## Global Constraints

- **Arquivo único:** todas as edições ocorrem em `public/index.html`. `server.js` e `lib/` **não são tocados** — o handler `POST /api/beats` repassa `broll`/`music` como arrays inteiros e não precisa saber do campo novo.
- **Sem dependências novas:** backend é Node puro sem npm; o frontend não usa bibliotecas. Não adicionar nenhuma.
- **Quebras de linha:** `public/index.html` é **CRLF de ponta a ponta**. Preserve. Verificação após cada tarefa: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');console.log('CRLF',(s.match(/\r\n/g)||[]).length,'LF-solto',(s.match(/[^\r]\n/g)||[]).length)"` deve reportar `LF-solto 0`.
- **`snapTime(t)` sem `opts` tem de continuar com comportamento idêntico ao atual.** Régua, `onFlagMouseDown`, `splitBeatAt`, `startTrim` (beats), `markIn` e `markOut` chamam assim. Esta é a invariante mais importante do plano.
- **`srcIn` é retrocompatível:** ausente lê como `0`, que reproduz o comportamento de hoje. Sidecar antigo abre sem erro.
- **Não tocar:** atalhos de teclado existentes (exceto acrescentar `Escape`), pista `MARKERS`, pista `VÍDEO`, compositor além da única linha especificada, `snapshot()`/undo/redo, `findGapAt`, `deleteSelection`, o número mágico `192`.
- **Comentários em código:** PT-BR, seguindo o padrão do bloco da timeline.
- **Git:** **não execute nenhum comando git.** Os passos "Commit" de cada tarefa existem por convenção do template, mas neste projeto o git passa pelo subagente `git-workflow` com aprovação do usuário entre fases. Deixe tudo no working tree sem stage.
- **Números de linha** referem-se ao commit `fd3ee70`. Eles se deslocam conforme as edições — **localize sempre pelo texto-âncora**, nunca pelo número.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | O que muda |
| --- | --- | --- |
| `public/index.html` | SPA inteira: markup, CSS e JS inline | 1 constante, 2 regras CSS novas, 3 funções reescritas, 7 funções novas, 8 pontos pontuais |

Nenhum arquivo é criado. A spec justifica manter tudo em um arquivo: o projeto não tem bundler e a SPA de arquivo único é decisão deliberada registrada no `CLAUDE.md`.

### Mapa das regiões editadas

| Região (linha em `fd3ee70`) | Tarefa | Mudança |
| --- | --- | --- |
| 331 — `.bt-snap-guide` | 2 | nenhuma (CSS já existe; passa a ser instanciado pelo JS) |
| 347 — fim do bloco `.bt-pop` | 5 | acrescentar `.bt-pop.bt-menu` e `.bt-menu-item` |
| 956 — `const SNAP_PX = 8;` | 1 | acrescentar `SNAP_TIE_PX` |
| 960–961 — comentários de `BROLL`/`MUSIC` | 4 | documentar `srcIn` |
| 1070–1082 — `snapTargets` / `snapTime` | 1 | reescritas + `snapCandidate` nova |
| 1251–1252 — `saveBeats` broll/music | 4 | persistir `srcIn` |
| 1260–1261 — `applySavedBeats` broll/music | 4 | restaurar `srcIn` |
| 1479–1497 — `addClipAt` | 4 | criar clipes com `srcIn: 0` |
| 1514 — `renderMusicTrack` (âncora) | 5 | inserir `splitClipAt`, `canSplitClip`, `duplicateTargetStart`, `duplicateClip` |
| 1650 — `compositeTick` | 4 | `const target = (active.srcIn \|\| 0) + (t - active.start);` |
| 1818 — `closePopover` (âncora) | 2 e 5 | inserir guia (T2) e `openClipMenu`/`onClipContextMenu` (T5) |
| 2003–2033 — `startClipMove` | 2 | encaixe de borda dupla + guia |
| 2034–2083 — `startClipTrim` | 4 | trim-in ajusta `srcIn` |
| 2098–2120 — `startClipGroupMove` | 3 | encaixe de borda dupla + guia |
| ~2248–2249 — `loadVideo` broll/music | 4 | restaurar `srcIn` |
| `wireTracks` — listeners | 5 | `contextmenu` em `#bt-tracks` |
| keydown — `switch` | 5 | `Escape` fecha popover |

---

## Contexto que o implementador precisa saber

1. **O `192` é a largura fixa da coluna de rótulos.** Número mágico repetido em `renderPlayhead`, `renderInOut`, `zoomAt` e `startBeatDrag`, e agora também na guia de snap. **Não refatore** — é ortogonal e ampliaria o risco.

2. **`snapTime` é chamado por seis caminhos que não podem mudar.** Régua (`onRulerMouseDown`), bandeira do playhead (`onFlagMouseDown`), `splitBeatAt`, `startTrim` de beat, `markIn`, `markOut`, e `addClipAt`. Todos chamam `snapTime(t)` sem segundo argumento. A assinatura nova mantém `opts` opcional, e com `opts` ausente a lista de alvos e a regra de escolha são **provadamente idênticas** às de hoje — o Step 4 da Tarefa 1 verifica isso empiricamente em 20000 casos.

3. **Por que o playhead não pode ser alvo global.** Se entrasse na lista padrão, `onFlagMouseDown` — que arrasta o próprio playhead — o faria grudar em si mesmo, e o scrub ficaria travado na posição atual. Daí `opts.playhead`.

4. **Por que o clipe arrastado precisa sair dos alvos.** Sem `exclude`, o clipe gruda nas próprias bordas e não sai do lugar. `exclude` é um `Set` de chaves `clipKey(track, i)`.

5. **B-ROLL não admite sobreposição; TRILHA admite.** `startClipMove` calcula `lo`/`hi` de colisão só quando `track === 'broll'`; `findGapAt` idem. Preserve essa assimetria.

6. **O compositor toca a fonte sempre do zero.** `compositeTick` faz `bv.currentTime = t - active.start`. É isso que a Tarefa 4 conserta. Enquanto a Tarefa 4 não rodar, **não implemente `DIVIDIR`** — um split sem `srcIn` produz jump cut de volta ao início da mídia. Por isso a Tarefa 5 vem depois da 4.

7. **Seis mapeamentos fazem whitelist de campos do clipe.** Dois em `saveBeats`, dois em `applySavedBeats`, dois em `loadVideo`. Qualquer campo novo que não seja adicionado nos seis **some silenciosamente ao recarregar** — sintoma "funciona na sessão, some depois". Undo/redo não precisa de mudança: `applyHistEntry` usa clone JSON profundo.

8. **Existe um defeito pré-existente de popover** — `requestAnimationFrame(() => popEl.classList.remove('enter'))` roda depois de `closePopover()` ter zerado `popEl`, em três popovers. **Não conserte os três** (fora de escopo), mas o código novo da Tarefa 5 **não deve reproduzi-lo**: use `if (popEl)` dentro do rAF.

### Fora de escopo (não faça)

- Renderizar b-roll/trilha no arquivo exportado; tornar a pista `VÍDEO` editável; persistir `srcDur`.
- Ripple, roll, slip, slide; transições; pistas dinâmicas.
- Refatorar o `192`, extrair JS/CSS inline, introduzir suíte de testes.
- Consertar os três `requestAnimationFrame` pré-existentes.
- Alterar `MARKERS`, `VÍDEO`, ou o comportamento padrão de `snapTime(t)`.

---

### Task 1: Motor de snap — separar consulta de aplicação

**Files:**
- Modify: `public/index.html:956` (constante nova)
- Modify: `public/index.html:1070-1082` (`snapTargets`, `snapTime`; `snapCandidate` nova)

**Interfaces:**
- Consumes: `SNAP_PX` (8), `PX_PER_SEC`, `DURATION`, `BEATS`, `beatStart(i)`, `inPoint`, `outPoint`, `clipsFor(track)`, `clipKey(track, i)`, `video`.
- Produces:
  - `snapTargets(opts?) → Array<{t: number, rank: number}>` — antes devolvia `number[]`; **o formato mudou**, e `snapCandidate` é o único consumidor.
  - `snapCandidate(t, opts?) → {t: number, d: number, rank: number} | null` — `null` quando nada está dentro do limiar.
  - `snapTime(t, opts?) → number` — assinatura estendida, comportamento padrão inalterado.
  - `opts = { clipEdges?: boolean, playhead?: boolean, exclude?: Set<string> }`.

- [ ] **Step 1: Acrescentar a constante de desempate**

Localize:

```js
  const SNAP_PX = 8;
```

Substitua por:

```js
  const SNAP_PX = 8;
  // Dois alvos a menos que isso de distância contam como empate; aí a prioridade
  // (playhead > borda de clipe > o resto) desempata. Prioridade estrita ficaria
  // ruim na mão: uma fronteira a 1px perderia para um playhead a 7px.
  const SNAP_TIE_PX = 2;
```

- [ ] **Step 2: Reescrever `snapTargets` e `snapTime`, e criar `snapCandidate`**

Localize o bloco inteiro:

```js
  function snapTargets() {
    const t = [0, DURATION];
    for (let i = 0; i <= BEATS.length; i++) t.push(beatStart(i));
    if (inPoint != null) t.push(inPoint);
    if (outPoint != null) t.push(outPoint);
    return t;
  }
  function snapTime(t) {
    const thr = SNAP_PX / PX_PER_SEC;
    let best = t, bestD = thr;
    snapTargets().forEach(c => { const d = Math.abs(c - t); if (d < bestD) { bestD = d; best = c; } });
    return Math.max(0, Math.min(DURATION, best));
  }
```

Substitua por:

```js
  /* Alvos de encaixe. Sem `opts`, a lista é exatamente a de sempre — é assim que
     régua, beats, IN/OUT e addClipAt continuam chamando, e o comportamento deles
     não muda. Bordas de clipe e playhead são condicionais de propósito: se o
     playhead fosse alvo global, arrastar a própria bandeira o faria grudar em si
     mesmo e o scrub ficaria pegajoso.
     rank = prioridade no desempate: 0 playhead, 1 borda de clipe, 2 o resto. */
  function snapTargets(opts) {
    const o = opts || {};
    const out = [{ t: 0, rank: 2 }, { t: DURATION, rank: 2 }];
    for (let i = 0; i <= BEATS.length; i++) out.push({ t: beatStart(i), rank: 2 });
    if (inPoint != null) out.push({ t: inPoint, rank: 2 });
    if (outPoint != null) out.push({ t: outPoint, rank: 2 });
    if (o.clipEdges) {
      ['broll', 'music'].forEach(track => clipsFor(track).forEach((c, i) => {
        if (o.exclude && o.exclude.has(clipKey(track, i))) return;
        out.push({ t: c.start, rank: 1 }, { t: c.start + c.dur, rank: 1 });
      }));
    }
    if (o.playhead && video) out.push({ t: video.currentTime, rank: 0 });
    return out;
  }
  /* Devolve QUAL alvo pegou, não só o tempo — a guia de alinhamento precisa saber
     onde desenhar, e o encaixe de borda dupla precisa comparar duas consultas.
     Regra: mais próximo vence; rank menor só ganha se estiver praticamente à mesma
     distância. Com `opts` ausente todos os ranks são 2, os dois primeiros ramos
     nunca disparam, e sobra `d < best.d` — idêntico ao código anterior. */
  function snapCandidate(t, opts) {
    const thr = SNAP_PX / PX_PER_SEC;
    const tie = SNAP_TIE_PX / PX_PER_SEC;
    let best = null;
    snapTargets(opts).forEach(c => {
      const d = Math.abs(c.t - t);
      if (d >= thr) return;
      if (!best) { best = { t: c.t, d: d, rank: c.rank }; return; }
      if (c.rank < best.rank && d <= best.d + tie) { best = { t: c.t, d: d, rank: c.rank }; return; }
      if (c.rank > best.rank && best.d <= d + tie) return;
      if (d < best.d) best = { t: c.t, d: d, rank: c.rank };
    });
    return best;
  }
  function snapTime(t, opts) {
    const s = snapCandidate(t, opts);
    return Math.max(0, Math.min(DURATION, s ? s.t : t));
  }
```

- [ ] **Step 3: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('SNAP_TIE_PX declarada', h.includes('const SNAP_TIE_PX = 2;'));
ck('snapCandidate definida', h.includes('function snapCandidate(t, opts)'));
ck('snapTargets aceita opts', h.includes('function snapTargets(opts)'));
ck('snapTime aceita opts', h.includes('function snapTime(t, opts)'));
ck('alvos carregam rank', h.includes('{ t: 0, rank: 2 }'));
ck('bordas de clipe condicionais', h.includes('if (o.clipEdges)'));
ck('playhead condicional', h.includes('if (o.playhead && video)'));
ck('exclusao do proprio clipe', h.includes('o.exclude.has(clipKey(track, i))'));
ck('implementacao antiga removida', !h.includes('let best = t, bestD = thr;'));
"
```

Esperado: **9 linhas `PASS`, nenhum `FAIL`.**

- [ ] **Step 4: Provar que o comportamento padrão não mudou**

Este é o passo mais importante da tarefa. Extrai as duas implementações — a antiga (colada aqui) e a nova (lida do arquivo) — e compara as saídas em milhares de casos aleatórios.

**Atenção ao harness:** `PX_PER_SEC` é passado *por valor* para o `new Function`, então a implementação nova precisa ser **reconstruída para cada nível de zoom**. Uma versão que mute uma variável externa produz `FAIL` falso — este script já está na forma correta e foi validado contra uma cópia com a Tarefa 1 aplicada.

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const SNAP_PX=8, SNAP_TIE_PX=2;
const DURATION=8.01, inPoint=null, outPoint=null;
const BEATS=[{dur:2.1},{dur:1.4},{dur:3.0},{dur:1.51}];
const beatStart=i=>{let s=0;for(let k=0;k<i;k++)s+=BEATS[k].dur;return s;};
const clipsFor=()=>[]; const clipKey=(t,i)=>t+':'+i; const video=null;
// NOVA — extraída literalmente do arquivo, por contagem de chaves
const grab=(sig)=>{const i=h.indexOf(sig);if(i<0)throw new Error('nao achei '+sig);
  let d=0;for(let k=h.indexOf('{',i);k<h.length;k++){if(h[k]==='{')d++;else if(h[k]==='}'){d--;if(!d)return h.slice(i,k+1);}}};
const src=grab('function snapTargets(opts)')+'\n'+grab('function snapCandidate(t, opts)')+'\n'+grab('function snapTime(t, opts)')+'\nreturn snapTime;';
const make=px=>new Function('PX_PER_SEC','DURATION','inPoint','outPoint','SNAP_PX','SNAP_TIE_PX','BEATS','beatStart','clipsFor','clipKey','video',src)
  (px,DURATION,inPoint,outPoint,SNAP_PX,SNAP_TIE_PX,BEATS,beatStart,clipsFor,clipKey,video);
// ANTIGA — reimplementada aqui, também parametrizada por px
const oldSnapFor=px=>t=>{const thr=SNAP_PX/px;let best=t,bestD=thr;
  const tg=[0,DURATION];for(let i=0;i<=BEATS.length;i++)tg.push(beatStart(i));
  tg.forEach(c=>{const d=Math.abs(c-t);if(d<bestD){bestD=d;best=c;}});
  return Math.max(0,Math.min(DURATION,best));};
let diff=0,n=0;
for(const px of [4,15,60,140,400]){
  const nf=make(px), of=oldSnapFor(px);
  for(let k=0;k<4000;k++){const t=Math.random()*DURATION*1.1-0.05;n++;
    if(Math.abs(of(t)-nf(t))>1e-12)diff++;}
}
console.log((diff===0?'PASS':'FAIL')+' — snapTime(t) sem opts: '+n+' casos, '+diff+' divergencias');
"
```

Esperado: `PASS — snapTime(t) sem opts: 20000 casos, 0 divergencias`.

Se aparecer qualquer divergência, **pare e reporte** — a invariante mais importante do plano foi quebrada.

- [ ] **Step 5: Verificar que o JS inline ainda parseia**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const m=h.match(/<script>([\s\S]*)<\/script>/);
if(!m){console.log('FAIL — bloco <script> nao encontrado');process.exit(1);}
new Function(m[1]);
console.log('PASS — script inline parseia sem erro de sintaxe');
"
```

Esperado: `PASS`. Rode também a verificação de CRLF das Global Constraints; esperado `LF-solto 0`.

- [ ] **Step 6: Verificar no browser que nada regrediu**

`node server.js`, abra http://localhost:4870, vá em `04 TIMELINE`, escolha um vídeo.

| Verificar | Esperado |
| --- | --- |
| Clicar/arrastar na régua | scrub gruda em fronteiras de beat como antes |
| Arrastar a bandeira do playhead | scrub fluido, **não** trava na posição atual |
| `S` (split de beat) | divide no playhead, com snap |
| Arrastar a borda de um beat | gruda como antes |
| `I` e `O` | marcam IN/OUT com snap |
| Arrastar clipe de B-ROLL | funciona como antes (ainda sem borda dupla — vem na Tarefa 2) |
| Console | sem erros novos |

- [ ] **Step 7: Commit**

**PULE ESTE PASSO.** Ver Global Constraints — git é do subagente `git-workflow`.

---

### Task 2: Guia de alinhamento e encaixe de borda dupla no arrasto simples

**Files:**
- Modify: `public/index.html:1818` (âncora `closePopover`; inserir a guia antes dela)
- Modify: `public/index.html:2003-2033` (`startClipMove`)

**Interfaces:**
- Consumes: `snapCandidate(t, opts)` e `clipKey(track, i)` da Tarefa 1; `timeToX`, `$q`, `PX_PER_SEC`, `clipsFor`, `lockedTracks`, `renderClipTrack`, `snapshot`.
- Produces:
  - `showSnapGuide(t: number): void` — posiciona a guia em `192 + timeToX(t)`.
  - `hideSnapGuide(): void` — remove a guia; idempotente.
  - `snapDragStart(rawStart: number, dur: number, opts) → {start: number, guide: number} | null` — testa cabeça e cauda e devolve o início resultante mais o alvo que pegou.

- [ ] **Step 1: Criar a guia e o helper de borda dupla**

Localize:

```js
  function closePopover() { if (popEl) { popEl.remove(); popEl = null; } }
```

Insira **imediatamente antes** dessa linha:

```js
  /* Guia de alinhamento. O CSS .bt-snap-guide já existia no arquivo e nunca havia
     sido instanciado. A guia só aparece quando o encaixe sobrevive ao clamp de
     colisão — ela nunca mente sobre onde o clipe vai realmente parar. */
  let snapGuideEl = null;
  function showSnapGuide(t) {
    if (!snapGuideEl) {
      const inner = $q('#bt-inner');
      if (!inner) return;
      snapGuideEl = document.createElement('div');
      snapGuideEl.className = 'bt-snap-guide';
      inner.appendChild(snapGuideEl);
    }
    snapGuideEl.style.left = (192 + timeToX(t)) + 'px';
    snapGuideEl.style.top = '0';
    snapGuideEl.style.bottom = '0';
  }
  function hideSnapGuide() {
    if (snapGuideEl) { snapGuideEl.remove(); snapGuideEl = null; }
  }
  /* Testa as DUAS bordas do clipe arrastado e devolve a que estiver mais perto de
     um alvo. É isto que faz encostar a CAUDA de um clipe na cabeça de outro
     funcionar — antes só o início era testado, e metade dos gestos não grudava. */
  function snapDragStart(rawStart, dur, opts) {
    const head = snapCandidate(rawStart, opts);
    const tail = snapCandidate(rawStart + dur, opts);
    if (head && tail) {
      return head.d <= tail.d
        ? { start: head.t, guide: head.t }
        : { start: tail.t - dur, guide: tail.t };
    }
    if (head) return { start: head.t, guide: head.t };
    if (tail) return { start: tail.t - dur, guide: tail.t };
    return null;
  }
```

- [ ] **Step 2: Usar borda dupla e guia em `startClipMove`**

Localize, dentro de `startClipMove`:

```js
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      arr[i].start = Math.max(lo, Math.min(hi, snapTime(origStart + dx)));
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
    }
```

Substitua por:

```js
    const snapOpts = { clipEdges: true, playhead: true, exclude: new Set([clipKey(track, i)]) };
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      const raw = origStart + dx;
      const pick = snapDragStart(raw, dur, snapOpts);
      const want = pick ? pick.start : raw;
      const next = Math.max(lo, Math.min(hi, want));
      arr[i].start = next;
      // guia só quando o encaixe realmente vingou: se o clamp de colisão puxou o
      // clipe para outro lugar, a linha some em vez de apontar para uma mentira
      if (pick && Math.abs(next - want) < 1e-6) showSnapGuide(pick.guide);
      else hideSnapGuide();
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hideSnapGuide();
      snapshot();
    }
```

- [ ] **Step 3: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('showSnapGuide definida', h.includes('function showSnapGuide(t)'));
ck('hideSnapGuide definida', h.includes('function hideSnapGuide()'));
ck('snapDragStart definida', h.includes('function snapDragStart(rawStart, dur, opts)'));
ck('guia usa a classe do CSS existente', h.includes(\"snapGuideEl.className = 'bt-snap-guide'\"));
ck('startClipMove usa borda dupla', h.includes('const pick = snapDragStart(raw, dur, snapOpts);'));
ck('startClipMove exclui o proprio clipe', h.includes('exclude: new Set([clipKey(track, i)])'));
ck('guia escondida no mouseup', /hideSnapGuide\(\);\s*\n\s*snapshot\(\);/.test(h));
ck('snapTime antigo removido do move', !h.includes('Math.min(hi, snapTime(origStart + dx))'));
"
```

Esperado: **8 linhas `PASS`.** Rode também o check de sintaxe e o de CRLF (Global Constraints).

- [ ] **Step 4: Verificar no browser**

Precisa de pelo menos **dois** clipes de B-ROLL. Adicione com o botão `+` da pista.

| Verificar | Esperado |
| --- | --- |
| Arrastar clipe até a **cabeça** dele perto da cauda de outro | gruda; linha amarela vertical aparece no ponto de encaixe |
| Arrastar até a **cauda** dele perto da cabeça de outro | **gruda** — é a lacuna que esta tarefa fecha |
| Arrastar qualquer borda até perto do playhead | gruda no playhead |
| Arrastar um clipe isolado pelo meio da timeline | não gruda em si mesmo, não trava |
| Empurrar o clipe contra o vizinho até o limite de colisão | clipe para na colisão e a guia **some** |
| Soltar o botão | a guia desaparece sempre |
| `Ctrl+Z` após arrastar | volta à posição anterior |
| Console | sem erros novos |

- [ ] **Step 5: Commit**

**PULE ESTE PASSO.** Ver Global Constraints.

---

### Task 3: Encaixe de borda dupla no arrasto de grupo

**Files:**
- Modify: `public/index.html:2098-2120` (`startClipGroupMove`)

**Interfaces:**
- Consumes: `snapCandidate`, `clipKey` (Tarefa 1); `showSnapGuide`, `hideSnapGuide` (Tarefa 2); `DURATION`, `PX_PER_SEC`, `renderBrollTrack`, `renderMusicTrack`, `snapshot`, `renderTracks`.
- Produces: nada novo. Só corrige a inconsistência de o arrasto de grupo não ter snap enquanto o arrasto simples tem.

- [ ] **Step 1: Acrescentar snap ao arrasto de grupo**

Localize, dentro de `startClipGroupMove`:

```js
    const origins = items.map(it => it.clip.start);
    const startX = e.clientX;
    function onMove(ev) {
      const dt = (ev.clientX - startX) / PX_PER_SEC;
      items.forEach((it, k) => {
        it.clip.start = Math.max(0, Math.min(DURATION - it.clip.dur, origins[k] + dt));
      });
      renderBrollTrack(); renderMusicTrack();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
      renderTracks();
    }
```

Substitua por:

```js
    const origins = items.map(it => it.clip.start);
    const startX = e.clientX;
    // O grupo encaixa pelas bordas EXTERNAS: cabeça do clipe mais à esquerda e
    // cauda do mais à direita. Todos os clipes do grupo saem da lista de alvos,
    // senão o conjunto gruda em si mesmo.
    const groupOpts = {
      clipEdges: true, playhead: true,
      exclude: new Set(items.map(it => clipKey(it.track, it.index))),
    };
    const groupHead = Math.min.apply(null, origins);
    const groupTail = Math.max.apply(null, items.map((it, k) => origins[k] + it.clip.dur));
    function onMove(ev) {
      const dtRaw = (ev.clientX - startX) / PX_PER_SEC;
      const head = snapCandidate(groupHead + dtRaw, groupOpts);
      const tail = snapCandidate(groupTail + dtRaw, groupOpts);
      let dt = dtRaw, guide = null;
      if (head && (!tail || head.d <= tail.d)) { dt = head.t - groupHead; guide = head.t; }
      else if (tail) { dt = tail.t - groupTail; guide = tail.t; }
      let intact = true;
      items.forEach((it, k) => {
        const want = origins[k] + dt;
        const next = Math.max(0, Math.min(DURATION - it.clip.dur, want));
        if (Math.abs(next - want) > 1e-6) intact = false;
        it.clip.start = next;
      });
      // se qualquer clipe do grupo bateu no limite, o encaixe não vingou inteiro
      if (guide != null && intact) showSnapGuide(guide);
      else hideSnapGuide();
      renderBrollTrack(); renderMusicTrack();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hideSnapGuide();
      snapshot();
      renderTracks();
    }
```

- [ ] **Step 2: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('grupo tem opts de snap', h.includes('const groupOpts = {'));
ck('grupo exclui todos os selecionados', h.includes('exclude: new Set(items.map(it => clipKey(it.track, it.index)))'));
ck('bordas externas calculadas', h.includes('const groupHead = Math.min.apply(null, origins);') && h.includes('const groupTail ='));
ck('grupo consulta as duas bordas', h.includes('snapCandidate(groupHead + dtRaw, groupOpts)') && h.includes('snapCandidate(groupTail + dtRaw, groupOpts)'));
ck('guia condicionada a grupo intacto', h.includes('if (guide != null && intact) showSnapGuide(guide);'));
ck('arrasto de grupo sem snap removido', !/const dt = \(ev\.clientX - startX\) \/ PX_PER_SEC;\s*\n\s*items\.forEach/.test(h));
"
```

Esperado: **6 linhas `PASS`.** Rode também o check de sintaxe e o de CRLF.

- [ ] **Step 3: Verificar no browser**

Precisa de **três** clipes de B-ROLL, com uma lacuna livre.

| Verificar | Esperado |
| --- | --- |
| Shift+clique em dois clipes, arrastar o conjunto | os dois se movem juntos, mantendo o espaçamento interno |
| Arrastar o grupo até a borda externa encostar num terceiro clipe | gruda; guia aparece |
| Arrastar o grupo até perto do playhead | gruda |
| Arrastar o grupo até um clipe bater no início/fim da timeline | grupo para e a guia **some** |
| `Ctrl+Z` | todos voltam juntos |
| Arrastar um clipe sozinho | continua funcionando como na Tarefa 2 |
| Console | sem erros novos |

- [ ] **Step 4: Commit**

**PULE ESTE PASSO.** Ver Global Constraints.

---

### Task 4: Campo `srcIn` — trim-in que apara de verdade

**Files:**
- Modify: `public/index.html:960-961` (comentários do modelo)
- Modify: `public/index.html:1251-1252` (`saveBeats`)
- Modify: `public/index.html:1260-1261` (`applySavedBeats`)
- Modify: `public/index.html:1479-1497` (`addClipAt`)
- Modify: `public/index.html:1650` (`compositeTick`)
- Modify: `public/index.html:2034-2083` (`startClipTrim`)
- Modify: `public/index.html` (`loadVideo`, ~2248-2249)

**Interfaces:**
- Consumes: `snapCandidate(t, opts)`, `snapTime(t, opts)` e `clipKey` da **Tarefa 1**; `showSnapGuide(t)` e `hideSnapGuide()` da **Tarefa 2**. O Step 4 usa os cinco — não execute esta tarefa antes das Tarefas 1 e 2.
- Produces: campo `srcIn: number` no modelo de clipe — instante, em segundos, dentro do arquivo de origem onde o clipe começa. Default `0`. A Tarefa 5 depende dele para `splitClipAt`.

**Nota de escopo:** além do `srcIn`, o Step 4 estende o snap do *trim* para incluir bordas de clipe e playhead (`trimOpts`) e mostrar a guia. A spec descreve isso só para o arrasto; incluir no trim é decisão deste plano, pela mesma razão de consistência que motivou a Tarefa 3 — com bordas de clipe virando alvos, um trim que não gruda nelas ficaria destoante do arrasto que gruda.

- [ ] **Step 1: Documentar o campo no modelo**

Localize:

```js
  let BROLL = []; // {path, name, start, dur}
  let MUSIC = []; // {path, name, start, dur, volume}
```

Substitua por:

```js
  // srcIn = instante dentro do arquivo de origem onde o clipe começa (default 0).
  // Desacopla "onde está na timeline" de "de onde toca na mídia": é o que faz o
  // trim da borda esquerda aparar a entrada em vez de só atrasar o clipe, e o que
  // permite dividir um clipe sem que a segunda metade volte ao início da fonte.
  let BROLL = []; // {path, name, start, dur, srcIn}
  let MUSIC = []; // {path, name, start, dur, volume, srcIn}
```

- [ ] **Step 2: Fazer o compositor honrar o offset — nos DOIS pontos**

`compositeTick` calcula tempo na fonte em dois lugares independentes, com nomes de variável diferentes. **Os dois precisam da correção**, porque `startClipTrim`, `splitClipAt` e `duplicateClip` são código compartilhado entre B-ROLL e TRILHA: sem o segundo, um trim-in ou split num clipe de música grava `srcIn` certo e o áudio ignora.

Localize (ramo do B-ROLL):

```js
      const target = t - active.start;
```

Substitua por:

```js
      const target = (active.srcIn || 0) + (t - active.start);
```

Localize (laço `MUSIC.forEach`, mais abaixo na mesma função):

```js
        const target = t - c.start;
```

Substitua por:

```js
        const target = (c.srcIn || 0) + (t - c.start);
```

- [ ] **Step 3: Criar clipes novos com o campo explícito**

Localize, dentro de `addClipAt`:

```js
    const clip = track === 'broll'
      ? { path: asset.path, name: asset.name, start, dur }
      : { path: asset.path, name: asset.name, start, dur, volume: 1 };
```

Substitua por:

```js
    const clip = track === 'broll'
      ? { path: asset.path, name: asset.name, start, dur, srcIn: 0 }
      : { path: asset.path, name: asset.name, start, dur, volume: 1, srcIn: 0 };
```

- [ ] **Step 4: Fazer o trim da borda esquerda aparar a fonte**

Localize o bloco inteiro de `startClipTrim` que vai de `const c = arr[i];` até o fim de `onMove`:

```js
    const c = arr[i];
    const startX = e.clientX;
    const origStart = c.start, origEnd = c.start + c.dur;
    let lo = 0, hi = DURATION;
    if (track === 'broll') {
      arr.forEach((o, j) => {
        if (j === i) return;
        if (side === 'left' && o.start + o.dur <= origStart) lo = Math.max(lo, o.start + o.dur);
        if (side === 'right' && o.start >= origEnd) hi = Math.min(hi, o.start);
      });
    }
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      if (side === 'right') {
        const t = Math.max(origStart + MIN_BEAT_DUR, Math.min(hi, snapTime(origEnd + dx)));
        c.dur = t - origStart;
      } else {
        const t = Math.max(lo, Math.min(origEnd - MIN_BEAT_DUR, snapTime(origStart + dx)));
        c.start = t; c.dur = origEnd - t;
      }
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
```

Substitua por:

```js
    const c = arr[i];
    const startX = e.clientX;
    const origStart = c.start, origEnd = c.start + c.dur;
    const origSrcIn = c.srcIn || 0;
    let lo = 0, hi = DURATION;
    if (track === 'broll') {
      arr.forEach((o, j) => {
        if (j === i) return;
        if (side === 'left' && o.start + o.dur <= origStart) lo = Math.max(lo, o.start + o.dur);
        if (side === 'right' && o.start >= origEnd) hi = Math.min(hi, o.start);
      });
    }
    // não dá para esticar a cabeça para antes do começo da mídia: srcIn não pode
    // ficar negativo. Mesma trava que qualquer NLE aplica ao trim de entrada.
    if (side === 'left') lo = Math.max(lo, origStart - origSrcIn);
    const trimOpts = { clipEdges: true, playhead: true, exclude: new Set([clipKey(track, i)]) };
    function onMove(ev) {
      const dx = (ev.clientX - startX) / PX_PER_SEC;
      if (side === 'right') {
        const t = Math.max(origStart + MIN_BEAT_DUR, Math.min(hi, snapTime(origEnd + dx, trimOpts)));
        c.dur = t - origStart;
        const s = snapCandidate(origEnd + dx, trimOpts);
        if (s && Math.abs(t - s.t) < 1e-6) showSnapGuide(s.t); else hideSnapGuide();
      } else {
        const t = Math.max(lo, Math.min(origEnd - MIN_BEAT_DUR, snapTime(origStart + dx, trimOpts)));
        c.start = t; c.dur = origEnd - t;
        c.srcIn = origSrcIn + (t - origStart);
        const s = snapCandidate(origStart + dx, trimOpts);
        if (s && Math.abs(t - s.t) < 1e-6) showSnapGuide(s.t); else hideSnapGuide();
      }
      renderClipTrack(track, track === 'broll' ? 'bt-track-broll' : 'bt-track-music');
    }
```

Localize também o `onUp` **de `startClipTrim`** (o que vem logo depois do `onMove` acima):

```js
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      snapshot();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function deleteSelectedClip() {
```

Substitua por:

```js
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hideSnapGuide();
      snapshot();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function deleteSelectedClip() {
```

O âncora inclui `function deleteSelectedClip() {` de propósito: existem vários `onUp` idênticos no arquivo, e essa linha seguinte torna este único.

- [ ] **Step 5: Persistir o campo nos seis mapeamentos**

Localize, em `saveBeats`:

```js
        broll: BROLL.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })),
        music: MUSIC.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume })),
```

Substitua por:

```js
        broll: BROLL.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, srcIn: c.srcIn || 0 })),
        music: MUSIC.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume, srcIn: c.srcIn || 0 })),
```

Agora localize as **duas** ocorrências idênticas de leitura (uma em `applySavedBeats`, outra em `loadVideo`) — o texto é o mesmo nas duas, então aplique a substituição em **ambas**:

```js
    BROLL = Array.isArray(saved.broll) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })) : [];
    MUSIC = Array.isArray(saved.music) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1 })) : [];
```

vira:

```js
    BROLL = Array.isArray(saved.broll) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, srcIn: c.srcIn || 0 })) : [];
    MUSIC = Array.isArray(saved.music) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
```

e a variante de `loadVideo`, que difere só pelo prefixo `(saved && Array.isArray(...))`:

```js
    BROLL = (saved && Array.isArray(saved.broll)) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur })) : [];
    MUSIC = (saved && Array.isArray(saved.music)) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1 })) : [];
```

vira:

```js
    BROLL = (saved && Array.isArray(saved.broll)) ? saved.broll.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, srcIn: c.srcIn || 0 })) : [];
    MUSIC = (saved && Array.isArray(saved.music)) ? saved.music.map(c => ({ path: c.path, name: c.name, start: c.start, dur: c.dur, volume: c.volume != null ? c.volume : 1, srcIn: c.srcIn || 0 })) : [];
```

`c.srcIn || 0` é o que garante a retrocompatibilidade: sidecar gravado antes desta mudança não tem o campo e lê como `0`.

- [ ] **Step 6: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('compositor honra srcIn no B-ROLL', h.includes('const target = (active.srcIn || 0) + (t - active.start);'));
ck('compositor honra srcIn na TRILHA', h.includes('const target = (c.srcIn || 0) + (t - c.start);'));
// os DOIS pontos: a versão original desta asserção checava só o primeiro, e o
// segundo passou batido pela execução inteira até ser pego na revisão do diff
ck('nenhum calculo de fonte sem offset', (h.match(/const target = t - /g)||[]).length === 0);
ck('addClipAt cria com srcIn', (h.match(/srcIn: 0 \}/g)||[]).length >= 2);
ck('trim-in ajusta srcIn', h.includes('c.srcIn = origSrcIn + (t - origStart);'));
ck('trava srcIn >= 0', h.includes(\"if (side === 'left') lo = Math.max(lo, origStart - origSrcIn);\"));
ck('6 mapeamentos com srcIn', (h.match(/srcIn: c\.srcIn \|\| 0/g)||[]).length === 6);
ck('nenhum mapeamento antigo sobrou', !/dur: c\.dur \}\)\) :/.test(h) && !h.includes('dur: c.dur })),'));
ck('modelo documentado', h.includes('let BROLL = []; // {path, name, start, dur, srcIn}'));
ck('server.js intocado', require('fs').readFileSync('server.js','utf8').indexOf('srcIn') === -1);
"
```

Esperado: **9 linhas `PASS`.** O último confirma que `server.js` não precisou mudar. Rode também sintaxe e CRLF.

- [ ] **Step 7: Verificar no browser**

| Verificar | Esperado |
| --- | --- |
| Adicionar clipe de B-ROLL, mover o playhead para dentro dele | preview mostra o b-roll desde o início da mídia |
| Arrastar a borda **esquerda** do clipe para a direita | o preview passa a entrar **mais adiante** na mídia — o quadro no início do clipe mudou. Este é o conserto do defeito |
| Continuar arrastando a borda esquerda para a **esquerda** | o clipe para quando `srcIn` chega a 0; não estica para antes do começo da mídia |
| Arrastar a borda **direita** | encurta/alonga como antes, com guia de snap |
| `SALVAR BEATS`, recarregar a página, escolher o vídeo, `CARREGAR` | o clipe reaparece com o mesmo quadro de entrada |
| Abrir `output/<nome>.beats.json` | os clipes têm o campo `srcIn` |
| Carregar um `.beats.json` gravado **antes** desta mudança | abre sem erro, clipes com `srcIn` 0, comportamento igual ao antigo |
| `Ctrl+Z` após um trim-in | desfaz o `srcIn` junto com a posição |
| Console | sem erros novos |

- [ ] **Step 8: Commit**

**PULE ESTE PASSO.** Ver Global Constraints.

---

### Task 5: Menu de contexto, dividir e duplicar

**Files:**
- Modify: `public/index.html:347` (CSS; após o bloco `.bt-pop`)
- Modify: `public/index.html:1514` (âncora `renderMusicTrack`; inserir operações após)
- Modify: `public/index.html:1818` (âncora `closePopover`; inserir menu antes)
- Modify: `public/index.html` (`wireTracks` — listener novo)
- Modify: `public/index.html` (keydown — `Escape`)

**Interfaces:**
- Consumes: `srcIn` (Tarefa 4) — sem ele `splitClipAt` produz jump cut; `clipsFor`, `findGapAt`, `clipKey`, `MIN_BEAT_DUR`, `DURATION`, `selectedClip`, `selectedClipSet`, `clearMultiSelection`, `deleteSelection`, `snapshot`, `renderTracks`, `renderBrollTrack`, `renderMusicTrack`, `stage`, `popEl`, `closePopover`, `lockedTracks`, `video`.
- Produces:
  - `canSplitClip(track, i, t) → boolean`
  - `splitClipAt(track, i, t) → boolean` — divide em dois clipes contíguos, o segundo com `srcIn` avançado.
  - `duplicateTargetStart(track, i) → number | null` — onde a cópia caberia, ou `null`.
  - `duplicateClip(track, i) → boolean`
  - `openClipMenu(track, i, clientX, clientY): void`
  - `onClipContextMenu(e): void`

- [ ] **Step 1: Acrescentar o CSS do menu**

Localize:

```css
.bt-pop .row2 button.primary{background:var(--go); border-color:var(--go); color:#191100; font-weight:700}
```

Insira **imediatamente abaixo**:

```css
/* Menu de contexto do clipe — variação estreita do popover, reusando o mesmo
   chrome (fundo, borda, sombra, animação de entrada) dos outros três popovers. */
.bt-pop.bt-menu{width:174px; padding:5px}
.bt-menu-item{all:unset; display:block; box-sizing:border-box; width:100%; cursor:pointer;
  font:500 10px var(--sans); letter-spacing:.04em; color:var(--dim); padding:7px 9px; border-radius:5px}
.bt-menu-item:hover:not([disabled]){color:var(--go); background:var(--go-dim)}
.bt-menu-item[disabled]{opacity:.35; cursor:default}
.bt-menu-item:focus-visible{outline:2px solid var(--go); outline-offset:-2px}
```

- [ ] **Step 2: Criar as operações de clipe**

Localize:

```js
  function renderMusicTrack() { renderClipTrack('music', 'bt-track-music'); }
```

Insira **imediatamente abaixo**:

```js
  /* Só é possível dividir com o playhead dentro do clipe e com margem para os dois
     fragmentos — um fragmento menor que MIN_BEAT_DUR seria inarrastável. */
  function canSplitClip(track, i, t) {
    const c = clipsFor(track)[i];
    return !!c && t > c.start + MIN_BEAT_DUR && t < c.start + c.dur - MIN_BEAT_DUR;
  }
  /* A segunda metade avança srcIn pela duração da primeira — é isso que faz o corte
     ser contínuo em vez de saltar de volta ao início da mídia. */
  function splitClipAt(track, i, t) {
    if (!canSplitClip(track, i, t)) return false;
    const arr = clipsFor(track);
    const c = arr[i];
    const d1 = t - c.start;
    arr.splice(i, 1,
      Object.assign({}, c, { dur: d1 }),
      Object.assign({}, c, { start: t, dur: c.dur - d1, srcIn: (c.srcIn || 0) + d1 }));
    clearMultiSelection();
    selectedClip = { track, index: i + 1 };
    snapshot();
    renderTracks();
    return true;
  }
  /* Onde a cópia caberia. B-ROLL não admite sobreposição, então depende de haver
     lacuna com a duração inteira; TRILHA admite, e só precisa caber na timeline. */
  function duplicateTargetStart(track, i) {
    const c = clipsFor(track)[i];
    if (!c) return null;
    if (track === 'broll') {
      const gap = findGapAt('broll', c.start + c.dur, c.dur);
      return gap && gap.dur >= c.dur - 1e-9 ? gap.start : null;
    }
    if (c.dur > DURATION) return null;
    return Math.max(0, Math.min(c.start + c.dur, DURATION - c.dur));
  }
  function duplicateClip(track, i) {
    const c = clipsFor(track)[i];
    const start = duplicateTargetStart(track, i);
    if (!c || start == null) { stage('sem espaço livre para duplicar nesta pista', true); return false; }
    clipsFor(track).push(Object.assign({}, c, { start: start }));
    clearMultiSelection();
    selectedClip = { track, index: clipsFor(track).length - 1 };
    snapshot();
    renderTracks();
    return true;
  }
```

- [ ] **Step 3: Criar o menu de contexto**

Localize:

```js
  function closePopover() { if (popEl) { popEl.remove(); popEl = null; } }
```

Insira **imediatamente antes** dessa linha:

```js
  /* Menu de contexto do clipe. Reusa o chrome de .bt-pop — mesmo ciclo de vida,
     mesma dispensa por clique fora — em vez de um componente novo com sensação
     diferente. Itens indisponíveis ficam esmaecidos em vez de sumirem: posição
     estável ensina o menu mais rápido do que um menu que muda de tamanho. */
  function openClipMenu(track, i, clientX, clientY) {
    closePopover();
    if (lockedTracks[track]) return;
    const t = video ? video.currentTime : 0;
    const canSplit = canSplitClip(track, i, t);
    const canDup = duplicateTargetStart(track, i) != null;
    popEl = document.createElement('div');
    popEl.className = 'bt-pop bt-menu';
    popEl.style.left = Math.max(6, Math.min(window.innerWidth - 180, clientX)) + 'px';
    popEl.style.top = Math.max(6, Math.min(window.innerHeight - 120, clientY)) + 'px';
    popEl.innerHTML =
      `<button class="bt-menu-item" id="bt-menu-split"${canSplit ? '' : ' disabled'}>DIVIDIR NO PLAYHEAD</button>` +
      `<button class="bt-menu-item" id="bt-menu-dup"${canDup ? '' : ' disabled'}>DUPLICAR</button>` +
      `<button class="bt-menu-item" id="bt-menu-del">DELETAR</button>`;
    document.body.appendChild(popEl);
    popEl.classList.add('enter');
    // o guard `if (popEl)` evita o TypeError que os popovers antigos sofrem quando
    // são fechados antes do próximo frame
    requestAnimationFrame(() => { if (popEl) popEl.classList.remove('enter'); });
    $q('#bt-menu-split', popEl).onclick = () => { if (canSplit) { closePopover(); splitClipAt(track, i, t); } };
    $q('#bt-menu-dup', popEl).onclick = () => { if (canDup) { closePopover(); duplicateClip(track, i); } };
    $q('#bt-menu-del', popEl).onclick = () => { closePopover(); deleteSelection(); };
    setTimeout(() => document.addEventListener('mousedown', onDocClick, { capture: true }), 0);
    function onDocClick(ev) {
      if (popEl && !popEl.contains(ev.target)) {
        closePopover();
        document.removeEventListener('mousedown', onDocClick, { capture: true });
      }
    }
  }
  /* Regra de seleção: DELETAR reusa deleteSelection(), que age sobre a
     multi-seleção quando ela existe. Se o clipe clicado já pertence a ela,
     preservamos; se não pertence, limpamos — senão um botão direito num clipe
     apagaria silenciosamente outros clipes fora de vista.
     DIVIDIR e DUPLICAR agem sempre e só sobre o clipe clicado. */
  function onClipContextMenu(e) {
    const clipEl = e.target.closest('.bt-clip');
    if (!clipEl) return; // sem preventDefault: o menu nativo do Chrome segue funcionando
    e.preventDefault();
    const track = clipEl.dataset.track, i = +clipEl.dataset.idx;
    if (lockedTracks[track]) return;
    if (!selectedClipSet.has(clipKey(track, i))) {
      clearMultiSelection();
      selectedClip = { track, index: i };
      renderBrollTrack(); renderMusicTrack();
    }
    openClipMenu(track, i, e.clientX, e.clientY);
  }
```

- [ ] **Step 4: Ligar o listener**

Localize, dentro de `wireTracks`:

```js
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
```

Substitua por:

```js
    // clipes vivem só em #bt-tracks; o handler devolve sem preventDefault quando o
    // alvo não é um clipe, então o menu nativo do navegador continua disponível
    $q('#bt-tracks').addEventListener('contextmenu', onClipContextMenu);
    $q('#bt-ruler').addEventListener('mousedown', onRulerMouseDown);
```

- [ ] **Step 5: Fazer `Escape` fechar o menu**

Localize, no `switch` do handler de teclado:

```js
      case '\\': e.preventDefault(); fitToWindow(); break;
```

Substitua por:

```js
      case '\\': e.preventDefault(); fitToWindow(); break;
      case 'Escape': closePopover(); break;
```

- [ ] **Step 6: Verificar por asserção**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('public/index.html','utf8');
const ck=(n,c)=>console.log((c?'PASS':'FAIL')+' — '+n);
ck('CSS do menu declarado', h.includes('.bt-pop.bt-menu{width:174px; padding:5px}'));
ck('canSplitClip definida', h.includes('function canSplitClip(track, i, t)'));
ck('splitClipAt definida', h.includes('function splitClipAt(track, i, t)'));
ck('split avanca srcIn', h.includes('srcIn: (c.srcIn || 0) + d1'));
ck('duplicateTargetStart definida', h.includes('function duplicateTargetStart(track, i)'));
ck('duplicateClip definida', h.includes('function duplicateClip(track, i)'));
ck('openClipMenu definida', h.includes('function openClipMenu(track, i, clientX, clientY)'));
ck('onClipContextMenu definida', h.includes('function onClipContextMenu(e)'));
ck('preventDefault condicionado ao clipe', /const clipEl = e\.target\.closest\('\.bt-clip'\);\s*\n\s*if \(!clipEl\) return;[^\n]*\n\s*e\.preventDefault\(\);/.test(h));
ck('regra de selecao aplicada', h.includes('if (!selectedClipSet.has(clipKey(track, i)))'));
ck('listener ligado em #bt-tracks', h.includes(\"\\\$q('#bt-tracks').addEventListener('contextmenu', onClipContextMenu);\"));
ck('Escape fecha popover', h.includes(\"case 'Escape': closePopover(); break;\"));
ck('rAF do menu novo tem guard', h.includes('requestAnimationFrame(() => { if (popEl) popEl.classList.remove(\'enter\'); });'));
ck('tres itens de menu', h.includes('bt-menu-split') && h.includes('bt-menu-dup') && h.includes('bt-menu-del'));
"
```

Esperado: **14 linhas `PASS`.** Rode também sintaxe e CRLF.

- [ ] **Step 7: Verificar no browser**

| Verificar | Esperado |
| --- | --- |
| Botão direito num clipe de B-ROLL | menu com `DIVIDIR NO PLAYHEAD`, `DUPLICAR`, `DELETAR` |
| Botão direito na régua, na pista `VÍDEO`, em `MARKERS`, no fundo de uma pista | **menu nativo do Chrome** |
| Playhead dentro do clipe → `DIVIDIR NO PLAYHEAD` | vira dois clipes contíguos |
| Reproduzir atravessando o corte recém-feito | **o preview passa sem salto** — valida `srcIn` |
| Playhead fora do clipe → abrir o menu | `DIVIDIR` esmaecido e não clicável |
| `DUPLICAR` com lacuna livre à direita | cópia aparece na lacuna e fica selecionada |
| `DUPLICAR` sem lacuna (clipes encostados) | item esmaecido |
| `DELETAR` num clipe **fora** da multi-seleção | apaga **só** ele; os outros permanecem |
| Shift+clique em dois clipes, botão direito num **deles**, `DELETAR` | apaga **os dois** |
| `Ctrl+Z` após dividir / duplicar / deletar | desfaz cada operação |
| `Escape` com o menu aberto | fecha |
| Clicar fora do menu | fecha |
| Botão direito numa pista travada (`L` aceso) | menu não abre |
| Console | sem erros novos, inclusive ao abrir e fechar o menu rapidamente |

- [ ] **Step 8: Commit**

**PULE ESTE PASSO.** Ver Global Constraints.

---

## Critérios de aceite (checáveis)

1. Asserções da Tarefa 1: 9 `PASS`, 0 `FAIL`.
2. **Prova de equivalência da Tarefa 1 (Step 4): `0 divergencias` em 20000 casos.** Este é o critério mais importante — ele garante que a refatoração de `snapTime` não vazou para régua, beats e IN/OUT.
3. Asserções da Tarefa 2: 8 `PASS`. Tarefa 3: 6 `PASS`. Tarefa 4: 9 `PASS`. Tarefa 5: 14 `PASS`.
4. Check de sintaxe (`new Function` sobre o `<script>` inline) passa após cada tarefa.
5. `LF-solto 0` após cada tarefa.
6. `git diff --stat` mostra **apenas** `public/index.html` alterado.
7. `grep -c srcIn server.js` retorna `0` — o backend não precisou mudar.
8. Round-trip do sidecar: salvar com `srcIn`, recarregar, `CARREGAR` → o quadro de entrada do clipe é o mesmo.
9. Retrocompatibilidade: um `.beats.json` gravado antes desta mudança abre sem erro, com `srcIn` 0.
10. Os cinco checklists de browser percorridos item a item. Qualquer item que falhe é **bloqueante**: pare e reporte ao Orquestrador em vez de improvisar um conserto.

---

## Status

_Seção de propriedade exclusiva do Executor. Registre aqui, incrementalmente, o que já foi feito, o resultado das verificações e qualquer desvio encontrado._

- [x] Task 1 — Motor de snap: 9 PASS, 0 FAIL. Prova de equivalência (Step 4): `PASS — snapTime(t) sem opts: 20000 casos, 0 divergencias`. Sintaxe OK, CRLF OK (LF-solto 0). Checklist de browser (Step 6) NÃO executado por instrução explícita do Orquestrador nesta execução — sem ferramenta de browser disponível.
- [x] Task 2 — Guia de alinhamento e borda dupla no arrasto simples: 8 PASS, 0 FAIL. Sintaxe OK, CRLF OK. Checklist de browser (Step 4) não executado (mesma razão).
- [x] Task 3 — Borda dupla no arrasto de grupo: 6 PASS, 0 FAIL. Sintaxe OK, CRLF OK. Checklist de browser (Step 3) não executado (mesma razão).
- [x] Task 4 — Campo `srcIn`: 9 PASS, 0 FAIL (inclui confirmação de que `server.js` segue sem `srcIn`). Sintaxe OK, CRLF OK. Checklist de browser (Step 7) não executado (mesma razão).
- [x] Task 5 — Menu de contexto, dividir e duplicar: 14 PASS, 0 FAIL. Sintaxe OK, CRLF OK. Checklist de browser (Step 7) não executado (mesma razão).

**Resumo:** as cinco tarefas foram implementadas em `public/index.html`, em ordem, respeitando as dependências (T4 usa `snapCandidate`/`snapTime`/`clipKey` da T1 e `showSnapGuide`/`hideSnapGuide` da T2; T5 usa `srcIn` da T4). Todos os âncoras de texto casaram exatamente com o código real (linhas deslocadas em relação ao `fd3ee70` conforme esperado, localizadas por texto). Nenhum comando git foi executado — working tree permanece sem stage. Nenhum arquivo além de `public/index.html` foi tocado; `server.js` e `lib/*` intocados (confirmado por asserção). Os cinco checklists de verificação em browser (Step 6 da T1, Step 4 da T2, Step 3 da T3, Step 7 da T4, Step 7 da T5) ficam pendentes — não executados por não haver ferramenta de browser disponível nesta sessão do Executor; a instrução do Orquestrador foi explícita para pular esses passos e deixá-los para verificação posterior na sessão principal.
