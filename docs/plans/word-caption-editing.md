# Plan — Edição manual de palavras na legenda (BEATS)

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Spec aprovada:** `docs/superpowers/specs/2026-08-12-word-caption-editing-design.md`
(commit `7d9c939`) — leia antes de implementar, é o contrato completo de
formato de request/response e comportamento de erro. Este plano traduz a
spec em edições literais de arquivo; onde houver qualquer dúvida, a spec
manda.

**Pré-requisito:** `docs/plans/beats-track-height-fix.md` já executado e
commitado (`8cdc623`) — a track LEGENDA já existe e renderiza word-chips
(`.bt-word`) a partir do array `words`.

## Escopo

`server.js` (2 rotas novas + 1 helper) e `public/index.html` (troca de
`loadLegend()`, popover de edição de palavra na track LEGENDA). **Não
mexer** em `lib/captions.js` (só é consumido, `writeAss()` é chamada sem
mudar assinatura) nem em nenhum outro arquivo de `lib/`. Nenhuma mudança
de timing de palavra, nenhuma integração com undo/redo, nenhuma edição a
partir do overlay de preview (`.bt-cap-overlay`) — só a track LEGENDA.

## Files

- **Modify:** `server.js`
- **Modify:** `public/index.html`

## Task 1 — `server.js`: helper + rotas de captions

### 1a. Import de `writeAss`

Perto dos outros `require('./lib/...')` (linha ~16-20), adicionar:

```js
const { writeAss } = require('./lib/captions');
```

### 1b. Helper `jobDirForVideo` + rotas

Inserir logo depois do bloco de rotas `/api/beats` existente (depois da
linha 201, `}` que fecha o handler `POST /api/beats`, antes do comentário
`// Step 4 — voiceover` na linha 203):

```js

    // Captions — resolve o job dir de um vídeo montado (mesma convenção
    // de nome já usada por /api/assemble: output/assembled-<id>.mp4 ↔
    // jobs/<id>/). Usado pra ler/corrigir o transcript.json que alimenta
    // o .ass, sem depender de estado de sessão no cliente.
    function jobDirForVideo(videoRelPath) {
      const m = path.basename(String(videoRelPath || '')).match(/^assembled-([a-f0-9]+)\.mp4$/);
      if (!m) return null;
      const dir = path.join(JOBS_DIR, m[1]);
      return fs.existsSync(path.join(dir, 'transcript.json')) ? dir : null;
    }
    function captionStyleOf(dir) {
      try {
        const assText = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
        if (/Arial Black/.test(assText)) return 'impact';
        if (/Style:\s*Word,Arial,/.test(assText)) return 'clean';
      } catch (e) { /* fall through */ }
      return 'impact';
    }
    if (req.method === 'GET' && p === '/api/captions') {
      const video = url.searchParams.get('video') || '';
      const dir = jobDirForVideo(video);
      if (!dir) return send(res, 200, { words: [], style: null });
      const words = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8')).words;
      return send(res, 200, { words, style: captionStyleOf(dir) });
    }
    if (req.method === 'POST' && p === '/api/captions/word') {
      const b = await readJson(req);
      const dir = jobDirForVideo(b.video);
      if (!dir) return send(res, 404, { error: 'sem legenda para este vídeo' });
      const txPath = path.join(dir, 'transcript.json');
      const tx = JSON.parse(fs.readFileSync(txPath, 'utf8'));
      const w = tx.words[b.index];
      if (!w || Math.abs(w.start - b.start) > 0.01) {
        return send(res, 409, { error: 'legenda mudou desde que a página carregou — recarregue' });
      }
      const newWord = String(b.newText || '').trim();
      if (!newWord) return send(res, 400, { error: 'palavra não pode ficar vazia' });
      w.word = newWord;
      fs.writeFileSync(txPath, JSON.stringify(tx, null, 2));
      writeAss(tx.words, dir, { style: captionStyleOf(dir) });
      return send(res, 200, { words: tx.words });
    }
```

**Nota de segurança:** `video` só é usado para extrair `<id>` via regex —
o path real lido/escrito (`JOBS_DIR/<id>/...`) é sempre construído a
partir de `JOBS_DIR` no servidor, nunca do valor cru do cliente. Mesma
lógica que `resolveInput()`/`insideRoot()` já protegem em outras rotas,
mas aqui nem precisa delas porque não existe path arbitrário vindo do
cliente — só um id extraído por regex `[a-f0-9]+`.

**Acceptance:**
- `GET /api/captions?video=output/assembled-<id>.mp4` (para um `<id>` com
  `jobs/<id>/transcript.json` existente) devolve `{words: [...], style:
  "impact"|"clean"}` com o array de palavras igual ao `transcript.json`.
- `GET /api/captions?video=qualquercoisa.mp4` (sem match) devolve `200
  {words: [], style: null}`, nunca erro.
- `POST /api/captions/word` com `index`/`start` batendo com o
  `transcript.json` atual atualiza a palavra, regrava
  `jobs/<id>/transcript.json` e `jobs/<id>/captions.ass`, devolve `{words:
  [...]}` atualizado.
- `POST /api/captions/word` com `start` que não bate (diferença > 0.01)
  devolve `409` e não escreve nada em disco.
- `POST /api/captions/word` com `newText` vazio/só espaços devolve `400` e
  não escreve nada em disco.
- `node --check server.js` → exit 0.

## Task 2 — `public/index.html`: CSS do word-chip editável

Em `.bt-word` (linha ~312), adicionar `cursor:pointer` (mesmo tratamento
visual de "isto é clicável" que outros elementos interativos do BEATS já
usam):

```css
.bt-word{position:absolute; top:4px; bottom:4px; border-radius:3px; background:var(--panel2);
  border:1px solid var(--line); display:flex; align-items:center; justify-content:center;
  font:400 9.5px var(--mono); color:var(--dim); padding:0 3px; white-space:nowrap; overflow:hidden;
  cursor:pointer}
```

(Só essa propriedade `cursor:pointer` é nova — o resto da regra já existe
e deve permanecer idêntico.)

**Acceptance:** passar o mouse sobre uma palavra na track LEGENDA mostra
cursor de mão/pointer.

## Task 3 — `public/index.html`: `loadLegend()` usa o endpoint novo

Substituir o bloco inteiro, comentário de cabeçalho incluído (linhas
1092-1117 — do comentário `/* ---------------- legend (real words parsed
from the .ass) */` até o `}` que fecha `loadLegend()`), por este (o
comentário de cabeçalho novo substitui o antigo; não duplicar comentário).
Isso é o trecho imediatamente antes do comentário
`/* ---------------- persistence */` e de `async function fetchBeats(path)
{`, que continuam intocados logo em seguida:

```js
  /* ---------------- legend (palavras reais, resolvidas no servidor a
     partir do vídeo selecionado — não depende de lastAss de sessão) */
  async function loadLegend() {
    words = [];
    if (!currentPath) return;
    try {
      const r = await fetch('/api/captions?video=' + encodeURIComponent(currentPath));
      const j = await r.json();
      if (!r.ok) return;
      words = (j.words || []).map(w => ({ start: w.start, end: w.end, text: w.word }));
    } catch (e) { words = []; }
  }
```

Note que o `words` do cliente continua com o campo `text` (não `word`) —
`updatePreviewOverlay()`, `renderLegendTrack()` e `highlightActiveWord()`
já leem `w.text`, então mapear `w.word` (formato do servidor/
`transcript.json`) para `w.text` aqui é o que evita ter que tocar em mais
nenhuma dessas três funções.

A variável global `lastAss` (linha ~648) e o lugar que a seta depois do
Assemble (linha ~802) **não são removidos** — `lastAss` continua sendo
usado pelo EXPORT (`captions: lastAss` na linha ~819) para saber qual
`.ass` queimar. Só o BEATS para de depender dela para popular a legenda.

**Acceptance:** selecionar, no dropdown VÍDEO do BEATS, um vídeo montado
via ASSEMBLE **em qualquer sessão anterior** (não precisa ter acabado de
montar nesta aba) já mostra a track LEGENDA populada e o overlay de
preview funcionando — sem precisar rodar ASSEMBLE de novo.

## Task 4 — `public/index.html`: editar uma palavra (dblclick → popover → salvar)

### 4a. `data-idx` no word-chip

Em `renderLegendTrack()` (linha ~1280-1291), adicionar `data-idx` ao
template do `.bt-word` (é o índice desse item dentro do array `words`,
necessário pro popover saber qual palavra foi clicada e pro POST validar
contra o servidor):

```js
  function renderLegendTrack() {
    const host = $q('#bt-track-legend');
    if (!host) return;
    host.style.width = contentWidth() + 'px';
    if (!words.length) {
      host.innerHTML = '<div class="empty" style="padding:8px 10px">Sem legenda nesta sessão — rode ASSEMBLE com captions ligados.</div>';
      return;
    }
    host.innerHTML = words.map((w, i) =>
      `<div class="bt-word" data-idx="${i}" data-start="${w.start}" data-end="${w.end}" title="Duplo-clique para corrigir" style="left:${timeToX(w.start)}px;width:${Math.max(4, timeToX(w.end - w.start))}px">${escapeHtml(w.text)}</div>`
    ).join('');
  }
```

(Só a assinatura do `.map` ganhando o índice `i`, o atributo `data-idx`, e
o `title=` são novos — o resto da função é idêntico ao que já existe.)

### 4b. Dispatch de dblclick

Em `onTracksDblClick()` (linha ~1807-1810), adicionar o branch de
`.bt-word` antes do branch de `.bt-beat` (a ordem não importa
funcionalmente já que os dois seletores nunca coincidem no mesmo
elemento, mas mantém o padrão de "mais específico primeiro" já usado):

```js
  function onTracksDblClick(e) {
    const wordEl = e.target.closest('.bt-word');
    if (wordEl) { openWordPopover(+wordEl.dataset.idx, wordEl); return; }
    const beatEl = e.target.closest('.bt-beat');
    if (beatEl) openPopover(+beatEl.dataset.idx, beatEl);
  }
```

### 4c. `openWordPopover()`

Nova função, adicionada logo depois de `openPopover()` (depois da linha
1647, `}` que fecha `openPopover`, antes do comentário
`/* ---------------- pointer interactions on the tracks area ---------------- */`).
Segue o mesmo padrão visual de `openPopover()`/`openAddClipPopover()`
(reaproveita `.bt-pop`, a transição `.enter`, a estrutura de
`row2`/botões), mas com um único campo de texto e tratamento de erro
inline em vez de fechar a popover:

```js
  function openWordPopover(idx, anchorEl) {
    closePopover();
    if (idx < 0 || idx >= words.length) return;
    const w = words[idx];
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : { left: 100, bottom: 100 };
    popEl = document.createElement('div');
    popEl.className = 'bt-pop';
    popEl.style.left = Math.max(6, Math.min(window.innerWidth - 226, rect.left)) + 'px';
    popEl.style.top = (rect.bottom + 6) + 'px';
    popEl.innerHTML = `<div class="t">CORRIGIR PALAVRA</div>
      <input type="text" id="bt-word-pop-input" value="${escapeHtml(w.text)}" placeholder="palavra correta…">
      <div id="bt-word-pop-err" style="display:none;color:var(--bad);font:400 10px var(--sans);margin-top:5px"></div>
      <div class="row2"><button id="bt-word-pop-cancel">CANCELAR</button><button class="primary" id="bt-word-pop-save">SALVAR</button></div>`;
    document.body.appendChild(popEl);
    popEl.classList.add('enter');
    requestAnimationFrame(() => popEl.classList.remove('enter'));
    const input = $q('#bt-word-pop-input', popEl);
    input.focus(); input.select();
    $q('#bt-word-pop-cancel', popEl).onclick = closePopover;
    async function save() {
      const val = input.value.trim();
      const errEl = $q('#bt-word-pop-err', popEl);
      errEl.style.display = 'none';
      if (!val) { errEl.textContent = 'palavra não pode ficar vazia'; errEl.style.display = ''; return; }
      const saveBtn = $q('#bt-word-pop-save', popEl);
      saveBtn.textContent = 'SALVANDO…';
      try {
        const r = await fetch('/api/captions/word', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video: currentPath, index: idx, start: w.start, newText: val }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || String(r.status));
        words = j.words.map(x => ({ start: x.start, end: x.end, text: x.word }));
        renderLegendTrack();
        updatePreviewOverlay();
        closePopover();
      } catch (e) {
        errEl.textContent = String(e.message || e);
        errEl.style.display = '';
        saveBtn.textContent = 'SALVAR';
      }
    }
    $q('#bt-word-pop-save', popEl).onclick = save;
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
    setTimeout(() => document.addEventListener('mousedown', onDocClick, { capture: true }), 0);
    function onDocClick(ev) {
      if (popEl && !popEl.contains(ev.target) && !(anchorEl && anchorEl.contains(ev.target))) {
        closePopover();
        document.removeEventListener('mousedown', onDocClick, { capture: true });
      }
    }
  }
```

**Acceptance:**
- Duplo-clique numa palavra da track LEGENDA abre um popover pré-cheio
  com o texto atual, com o mesmo estilo visual (entrada suave, cores) dos
  outros popovers do BEATS.
- Editar o texto e clicar SALVAR (ou apertar Enter): popover fecha, a
  palavra na track LEGENDA e no overlay de preview mostram o texto
  corrigido, sem precisar recarregar a página.
- Rodar EXPORT depois de uma correção: a legenda queimada no vídeo final
  mostra o texto corrigido (confere que `captions.ass` foi regerado no
  disco, não só o estado do navegador).
- Deixar o campo vazio e clicar SALVAR: mensagem de erro aparece dentro
  do popover, popover continua aberto, nada é gravado no servidor
  (confirmar checando que `transcript.json` no disco não mudou).
- Editar a mesma palavra duas vezes seguidas (sem recarregar a página):
  funciona nas duas vezes — o índice/`start` client-side continuam
  válidos porque o timing nunca muda, só o texto.

## Overall acceptance criteria

1. `node --check server.js` → exit 0.
2. `git diff --stat` mostra só `server.js` e `public/index.html`.
3. Nenhuma classe fora do prefixo `bt-` criada/alterada em
   `public/index.html`; nenhuma função de mecânica de edição existente
   (split/merge/trim/drag-reorder/snap/undo/redo/hide/lock/mute/solo)
   reescrita.
4. `lib/captions.js` não é modificado — só importado e chamado
   (`writeAss`) exatamente com a assinatura que já tem hoje.
5. Fluxo completo testado manualmente (ou via browser automation) com um
   vídeo real montado via ASSEMBLE: track LEGENDA mostra palavras →
   duplo-clique → editar → salvar → `jobs/<id>/transcript.json` e
   `jobs/<id>/captions.ass` no disco refletem a correção.
6. Vídeo sem `transcript.json` (upload bruto/clipe do auto-clipper): track
   LEGENDA mostra o estado vazio de sempre ("Sem legenda nesta
   sessão..."), sem erro no console, sem popover disponível (não há
   `.bt-word` pra dar duplo-clique).

## Status

_(propriedade do Executor)_

**Executado em 2026-08-12.** Todas as 4 tasks aplicadas literalmente
conforme os blocos de código do plano, sem desvio de escopo.

### Arquivos tocados
- `server.js` — import de `writeAss`, helpers `jobDirForVideo()`/
  `captionStyleOf()`, rotas `GET /api/captions` e `POST /api/captions/word`
  (inseridos exatamente onde o plano indicou, entre `/api/beats` e o
  comentário `// Step 4 — voiceover`).
- `public/index.html` — `cursor:pointer` em `.bt-word`; `loadLegend()`
  substituída pela versão que busca `/api/captions?video=...`;
  `renderLegendTrack()` ganhou `data-idx`/`title`; `onTracksDblClick()`
  ganhou o branch `.bt-word` → `openWordPopover()`; nova função
  `openWordPopover()` inserida entre `openPopover()` e o comentário
  `/* pointer interactions on the tracks area */`.

### Critérios de aceite gerais — verificação

1. `node --check server.js` → exit 0 (confirmado).
2. `git diff --stat` → só `server.js` e `public/index.html` (confirmado;
   `docs/plans/*` continuam untracked/fora do diff de código).
3. Nenhuma classe fora do prefixo `bt-` criada: `git diff public/index.html`
   só introduz `class="bt-word"` e reaproveita `class="primary"`,
   `class="row2"`, `class="t"` já existentes no padrão de `openPopover()`.
   Nenhuma função de mecânica de edição (split/merge/trim/drag-reorder/
   snap/undo/redo/hide/lock/mute/solo) foi tocada — grep confirmou zero
   remoções dessas funções no diff.
4. `lib/captions.js` não foi modificado (`git status` não lista o
   arquivo); `writeAss(words, outDir, opts)` é chamado com a assinatura
   exata que já existia (`words`, `outDir`, `{style}`).
5. **Smoke test funcional do backend (sem browser):** subi o servidor
   numa porta alternativa (`PORT=4871 node server.js`, já que a porta
   4870 padrão tinha uma instância antiga do usuário rodando), criei um
   `jobs/<hexid>/transcript.json` sintético e testei as 5 rotas via
   `curl`:
   - `GET /api/captions?video=output/assembled-<hexid>.mp4` → devolveu
     `{words:[...], style:"impact"}` batendo com o `transcript.json`.
   - `GET /api/captions?video=qualquercoisa.mp4` → `200 {words:[],
     style:null}`.
   - `POST /api/captions/word` com `index`/`start` corretos → `200` com
     `words` atualizado; `jobs/<hexid>/transcript.json` e
     `jobs/<hexid>/captions.ass` no disco refletiram a correção
     (inspecionei o `.ass` gerado: a linha `Dialogue` da palavra 0 mudou
     de `helo` para `HELLO`).
   - `POST /api/captions/word` com `start` divergente (diff > 0.01) →
     `409`, sem escrita em disco.
   - `POST /api/captions/word` com `newText` vazio/espaços → `400`, sem
     escrita em disco.
   - Diretório de teste e servidor de teste removidos/encerrados depois
     do smoke test; `git status --short` confirma que só `server.js` e
     `public/index.html` seguem modificados (o `jobs/<hexid>` sintético
     não é rastreado pelo git e foi apagado).
   - Também validei que o JS embutido em `public/index.html` continua
     parseável (`new Function()` sobre o conteúdo do único bloco
     `<script>`, sem erros de sintaxe).

   **Pendente de checagem visual/funcional real** (não coberto nesta
   execução por não haver browser automation disponível neste ambiente):
   fluxo completo na UI — abrir BEATS com um vídeo já montado em sessão
   anterior, confirmar que a track LEGENDA popula sem precisar rodar
   ASSEMBLE de novo (critério da Task 3), dar duplo-clique numa palavra,
   ver o popover abrir com o estilo visual correto, editar, salvar,
   conferir highlight/overlay de preview atualizando sem reload, e rodar
   EXPORT depois para confirmar que a legenda queimada no vídeo final
   reflete a correção. Recomendo o Orquestrador rodar esse teste ao vivo
   (`node server.js` na porta padrão + browser) antes de considerar o
   item 5 do plano totalmente fechado.
6. Vídeo sem `transcript.json`: `jobDirForVideo()` devolve `null` nesse
   caso (confirmado no smoke test com `video=qualquercoisa.mp4` →
   `{words:[], style:null}`), então `loadLegend()` no cliente deixa
   `words=[]` e `renderLegendTrack()` cai no branch já existente do
   estado vazio ("Sem legenda nesta sessão...") sem erro — lógica
   inspecionada, não exercida via browser real nesta execução.

### Desvios do plano
Nenhum. Todos os blocos de código foram inseridos exatamente como
especificado, nos pontos de inserção indicados.
