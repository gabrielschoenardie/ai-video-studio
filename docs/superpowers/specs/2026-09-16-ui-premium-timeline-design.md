# Design — UI Premium da TIMELINE (sub-projeto A)

**Data:** 2026-09-16
**Origem:** `ui-premium-upgrade.md` (plano escrito pelo usuário, não versionado) e `UI_Premium_Mockup.dc.html` (mockup interativo antes/depois). Esta spec é o resultado de verificar os dois contra o código e decompor o plano.
**Arquivos-alvo:** `public/index.html` (tokens, tipografia, contraste, largura da coluna de rótulos, controles de track, playhead, transporte, folha de atalhos, microinterações, loader do probe), `public/dev/ui-probe.js` (novo), `server.js` (rota estática `GET /dev/*.js`).
**Base:** `main` em `3f47ec9`. Todo número de linha citado aqui se refere a esse commit.
**Revisão R1 (2026-09-16), decisão do usuário:** **densidade única, compacta** (`--tap` 30px, `--tap-sm` 24px, `--gap-ctl` 2px, `--bt-labelw` 204px). O toggle `compact`/`comfortable` (G1) chegou a ser implementado e medido no E2 — os dois modos passaram no probe e no checklist —, mas foi removido antes do commit. Sem `data-density`, sem `studio.density`, sem evento `studio:density`, sem check `density` no probe. As seções abaixo já refletem a revisão; o plano (`docs/plans/ui-premium-timeline.md`, Task 3, Revisão R1) guarda o registro do que foi feito e desfeito.

---

## Contexto e problema

O plano original propunha elevar `public/index.html` de "ferramenta que funciona" para "editor de desktop premium" em 14 achados (D1–D14) e 20+ tasks distribuídas em quatro levas de prioridade. O objetivo declarado pelo usuário: **subir o nível da UI sem quebrar o funcionamento atual**.

Ao ler o código no brainstorm, três problemas estruturais apareceram:

1. **Várias afirmações do plano não batem com o código.** Algumas descrevem um estado anterior do app (markers abaixo da régua), outras apontam para coisas inexistentes (`@media 1200px`, `--bt-labelw`, harness `repo-visual-check.html`). Um Executor seguindo o plano literalmente faria trabalho já feito ou quebraria algo.
2. **O plano mistura quatro projetos de risco muito diferente.** Trocar ícone de botão (CSS/markup) e acrescentar uma trilha de SFX (sidecar, conform, bundle do Player) não cabem na mesma unidade de validação.
3. **Os critérios de aceite não são executáveis pelo fluxo do repo.** O subagente `validator` não tem navegador, e os probes de DOM do plano usam seletores que não existem.

---

## Verificação do plano original contra o código

Registrada aqui porque os sub-projetos B, C e D vão precisar dela.

| Item do plano | Plano afirma | Código real (`3f47ec9`) | Destino |
|---|---|---|---|
| D5 / R3 | Banda de beats é track comum **abaixo** da régua | Já está **acima**: `.bt-tracks-top` → `.bt-ruler-corner` → `.bt-ruler` → `.bt-tracks` (`index.html:1683-1694`, commit `fd3ee70`). Playhead já é instância única `top:0; bottom:0` em `#bt-inner` (`:1734`). Falta só timecode na flag e nome no rótulo de MARKERS. | A (reduzida) |
| R3 step 2 | `left: calc(labelw + (100% − labelw) * pos)` | Timeline é px/s com scroll horizontal: `192 + timeToX(t)` (`:2193`). Fórmula proporcional descolaria o playhead no zoom. | A (descartada) |
| R3 step 3 | Pointer Events | 11 handlers de arraste, 34 pontos de listener `mouse*` (`:2681-3113`). | Sub-projeto próprio |
| D13 | `S` aparece em track que não é de áudio | M/S existem **só** em TRILHA (`:1726-1727`). ÁUDIO tem só `H L`, VÍDEO só `L`. Solo da TRILHA = silenciar o áudio do vídeo base (`:3091`). | A (ícones); B (M/S em ÁUDIO) |
| D1 | `.bt-tbtn` 48×30 | Confirmado: `height:28px` em `content-box` (efeito de `all:unset`) + borda 1px; `min-width:30px` + padding 16 + borda 2. | A |
| D3 | `--faint` 3,11:1 | Calculado: 3,10 sobre `--panel`, 2,92 sobre `--panel2`, 3,41 sobre `--bg`. `#7b80ad` dá 4,80 / 4,53 / 5,29. | A |
| R1 | `@media (max-width:1200px)` existente | Só existem 900px e 540px (`:270`, `:288`). Grupos propostos omitiam `SALVAR BEATS` e `CONFORMAR → EXPORT` (`:1660-1661`). | A (corrigido) |
| O3 | Atalhos `1…5`, `⇧ roda` (mockup) | Não existem. Handler é escopado a `#step-beats.on` (`:3220`); zoom por roda é **Ctrl**+roda (`:3134`); `Home`, `End`, `Delete/Backspace` existem e o mockup não lista. | A (corrigido) |
| R5 | Sidecar v2 ganha `sfx` | Sidecar é **v3** (`server.js:275-282`), montado campo a campo — `sfx` seria descartado em silêncio. Conform lê só `tl.music` (`server.js:366-389`). Preview via Player exige `TimelinePreview.tsx` + `player-entry.tsx` + `npm run build:player`; rota canvas (`:2175`), undo (`:1277`), `saveBeats` (`:1565`), `applySavedBeats` (`:1601`) também. | B |
| R5 critério | Export bate com o preview | H/M/S são só de preview: o conform recebe a TRILHA inteira. Precisa de decisão explícita preview × export. | B |
| O2 step 3 | `api()` devolve `{ok, error, hint}` | `api()` lança (`:845`); todo chamador usa `try/catch` e passaria a tratar falha como sucesso. `lib/deps.js` expõe `install`, não `hint`; erro de job não carrega dica de engine. | C |
| O1 step 3 | `styleSample(tokens)` compartilhado | `CAPTION_STYLES` vive dentro do closure da TIMELINE (`:1138`). Amostra CSS usa fonte web; libass usa fonte do sistema (`_fontNote` do preset `realce`). | C |
| D10 | Uma chave em `localStorage` | Confirmado: `studio-side-collapsed` (`:736`), hoje do rodapé colapsável. | C |
| Y3 | Passo LIBRARY novo | LIBRARY já existe (`:688-692`, assets da sessão). "Revelar pasta" = spawn por SO; "apagar" = rota destrutiva que precisa validar id por regex como `mJob` (`server.js:545`). | D |
| Verificação | `repo-visual-check.html`; probes em `.bt-track`, `.bt-markers` | Harness não está no repo. Seletores reais: `.bt-track-row`, `.bt-tracks-top`. | A (`ui-probe.js`) |

**Contradições internas do plano original:** R2 impõe piso de 11px, mas O3 pede `<kbd>` de 10px (mockup: 9,5px); a leva 1 põe R1/R2 por último "porque são tokens que as demais consomem"; Y1 põe `transition` no playhead, que atrasaria durante o play; o piso de 11px contradiz "LEGENDA, ÁUDIO e TRILHA ficam como estão"; D6 e a legenda 🔴 argumentam com toque num escopo desktop-only. No mockup, a métrica de ícones aponta R3 (é R4), "Y2 rail" é O2 step 4, e o ESC de 44px viola o guardrail 7.

---

## Decomposição

| Sub-projeto | Tasks do plano original | Toca | Status |
|---|---|---|---|
| **A. UI da TIMELINE** | R1, R2, R3 reduzida, R4 (ícone + estado), O3, Y1 (só timeline); G1 retirado na Revisão R1 | `index.html`, `ui-probe.js`, rota `/dev/` | **Esta spec** |
| **B. Mixagem de áudio** | R5, M/S em ÁUDIO/SFX, solo exclusivo, preview × export | `server.js`, `lib/timeline.js`, `remotion/` + bundle | Pendente |
| **C. Voz do sistema** | O1, O2, Y2, Y1 (job, asset, skeleton) | `index.html` + contrato de erro no servidor | Pendente |
| **D. Biblioteca de jobs** | Y3 | Rotas novas, ação destrutiva | Pendente |
| — | R3 step 3 (Pointer Events) | 11 handlers de arraste | Sub-projeto próprio |
| — | Y4, G2–G7 | — | Depois |

---

## Objetivo (sub-projeto A)

- Alvos de clique com folga de mira numa densidade única de desktop, compacta: 30px nos botões do transporte, 24px nos controles de track (Revisão R1).
- Nenhum texto de interface abaixo de 11px e todo texto de hierarquia baixa com contraste ≥ 4,5:1.
- Controles de track que dizem o que fazem e se estão ativos, com semântica de botão de dois estados.
- Playhead com timecode legível; rótulo de MARKERS nomeado.
- Transporte agrupado por função, sem perder os botões de salvar e conformar.
- Atalhos descobríveis sem hover.
- Movimento que responde ao trabalho (clipe entrando, split, seek), tokenizado.
- **Tudo verificável por medição**, com a refatoração provada neutra antes de qualquer mudança visual.

**Fora de escopo (deliberado):** tudo que está em B, C, D e na linha de Pointer Events da tabela acima; mudanças em `lib/*`, `remotion/`, `public/vendor/`; formato do sidecar; lógica de arraste, `saveBeats`, `doConform`.

---

## Decisões tomadas no brainstorm

| Questão | Decisão |
|---|---|
| Decomposição | Quatro sub-projetos; A primeiro |
| Densidade | Única, `compact` (Revisão R1 — a decisão original era `compact` padrão com toggle G1 persistido em `studio.density`); largura da coluna de rótulos vira token `--bt-labelw` |
| Piso de 11px dentro das lanes | Vale para toda a interface; **`.bt-word` e `.bt-clip.music` isentos** (dado em escala de tempo, como a waveform), com a exclusão declarada no probe |
| Pointer Events | Fora do A; entra só a área de pega em CSS |
| Verificação | `validator` estático + probe de runtime rodado pelo Orquestrador via Chrome + `public/dev/ui-probe.js` reutilizável (`?probe=1`) + checklist manual do usuário |
| Execução | Estágios E0 → E1 → E2 → E3a → E3b, separando refatoração (E1, zero pixel) de mudança de valor (E2) e de componentes novos (E3) |
| Valores dos tokens de duração | 150 / 200 / 300 / 450ms (casam com o existente), não 120 / 200 / 320 / 560 |
| `aria-label` dos controles de track | Fixo; estado em `aria-pressed` (diverge do mockup, que trocava o label) |
| Área de pega das handles | 4px **para dentro** do clipe |
| Flash do split | 2px, `--dur-3` (não 1px / `--dur-1`, invisível) |
| Folha de atalhos | `<dialog>` nativo; `SHORTCUTS` só com atalhos que o handler registra |

---

## Abordagem escolhida

### Condições de medição (valem para todos os estágios)

- `node server.js`, janela com viewport de **1280×800**.
- Na TIMELINE, um vídeo montado com transcript, para a lane LEGENDA ter chips: `output/assembled-<id>.mp4` com `jobs/<id>/transcript.json` (fixture local atual: `assembled-4545f906507a.mp4`). Zoom 100% (60 px/s).
- URL `http://localhost:4870/?probe=1`.

### E0 — Probe e baseline

**`server.js`** — rota espelhando a de `/vendor/` (`server.js:191-198`):

```js
const DEV_DIR = path.join(ROOT, 'public', 'dev');
// ...
const mDev = /^\/dev\/([A-Za-z0-9._-]+\.js)$/.exec(p);
if (req.method === 'GET' && mDev) {
  const abs = path.resolve(DEV_DIR, mDev[1]);
  if (!abs.startsWith(DEV_DIR + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  return serveFile(req, res, abs);
}
```

Allowlist por regex, sem `..` possível, só leitura, nenhum path vindo de corpo de requisição.

**`public/index.html`** — loader imediatamente antes do `<script>` principal (`:705`): se `new URLSearchParams(location.search).has('probe')`, instala `window.__probeErrors = []` com listeners de `error` e `unhandledrejection`, e injeta `<script src="/dev/ui-probe.js">`. Sem `?probe`, nada acontece.

**`public/dev/ui-probe.js`** — IIFE sem dependências, só DOM e CSSOM (não enxerga o closure da TIMELINE). Expõe `window.uiProbe.run(stage)`, com `stage ∈ {'E0','E1','E2','E3a','E3b'}`. Saída: uma linha `PASS` / `FAIL` / `SKIP` por check com medido × esperado, um `console.table`, e o objeto de resultados como retorno (é por ele que o Orquestrador lê via Chrome). Checks de TIMELINE dão `SKIP` se `#bt-root` não foi construído. Checks que alteram estado (clicar controle, tocar, abrir folha) **restauram** o estado ao terminar.

| id | Mede | Desde |
|---|---|---|
| `text-floor` | Nós folha com texto e `fontSize < 11`, fora de `.bt-word` e `.bt-clip.music`; os isentos em contador separado, com tamanho computado | E0 |
| `contrast` | `--faint` e `--dim` sobre `--bg`, `--panel`, `--panel2`, lidos das variáveis computadas | E0 |
| `tap-targets` | Menor altura renderizada de `.bt-tbtn`; menor lado de `.bt-tctl`. Até E1 = baseline; a partir de E2 = 30 / 24 (densidade única) | E0 |
| `transport-overflow` | `scrollWidth <= clientWidth` em `.bt-transport` | E0 |
| `track-order` | `[...'.bt-track-row'].map(dataset.track)` = `beats, broll, video, legend, audio, music` | E0 |
| `label-truncate` | Nenhum `.bt-track-label` com `scrollWidth > clientWidth` | E0 |
| `labelw-sync` | Largura de `.bt-track-label` = `margin-left` de `#bt-ruler` = `--bt-labelw` | E1 |
| `markers-above-ruler` | `.bt-tracks-top` precede `#bt-ruler` (`compareDocumentPosition`) | E0 |
| `playhead` | Uma instância de `.bt-playhead`; altura cobre `#bt-inner` (±1px) | E0 |
| `tctl-a11y` | Todos com `aria-label`, contagem ≥ 15; a partir de E3a: nenhum com texto, `aria-pressed` em todos exceto `[data-act="add"]`, valor correto após clicar e clicar de novo | E0 / E3a |
| `motion-literals` | Regras do CSSOM com `transition`/`animation` de duração literal; isentos `drift`, `blink`, `bt-pulse` e o `.001ms` do reduced-motion | E0 |
| `aria-live` | Contagem de `[aria-live]` = 1 | E0 |
| `console-errors` | `window.__probeErrors.length` = 0 | E0 |
| `playhead-tc` | Texto de `.bt-playhead-tc` = parte corrente de `#bt-time` | E3a |
| `transport-ids` | Os 21 IDs da tabela de grupos do E3b presentes; `#bt-play` mantém `.bt-kbd` após play/pause | E3b |
| `shortcut-sheet` | `?` sintético abre `dialog[open]`; linhas = `window.SHORTCUTS.length`; `.close()` devolve o foco ao gatilho | E3b |

**Baseline:** o Executor entrega o script com `EXPECT.baseline = null`. `run('E0')` só mede e imprime o JSON dos valores. O Orquestrador roda contra o app atual e grava esse JSON em `EXPECT.baseline` (edição de dado, commitada junto com o E0). Os demais estágios comparam contra `EXPECT[stage]`, que referencia o baseline onde o valor não deve mudar.

### E1 — Tokenização sem mudança visual

Regra: **nenhum pixel muda.**

1. **`--bt-labelw`.** `:root{--bt-labelw:192px}`. CSS: `.bt-ruler{margin-left:var(--bt-labelw)}`, `.bt-ruler-corner{left:calc(-1 * var(--bt-labelw)); width:var(--bt-labelw)}`, `.bt-track-label{width:var(--bt-labelw)}`. JS: os 8 literais `192` do closure da TIMELINE (`:1264, 1273, 1802, 2193, 2201, 2426, 2749, 2798`) passam a usar `LABEL_W`, variável do closure preenchida por `readLabelW()` — `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bt-labelw'))`, com fallback 192 — chamada em `buildDom()`. Caminhos por frame (`advancePlayhead`, snap guide) usam o valor em cache, nunca `getComputedStyle`.
2. **Alvos.** `:root{--tap:30px; --tap-sm:24px; --gap-ctl:2px}`. `.bt-tbtn{height:calc(var(--tap) - 2px)}` com comentário (`all:unset` → `content-box`, borda 1px; trocar para `border-box` mudaria também o `min-width` e encolheria `+`/`−` de 48 para 30px). `.bt-tctl{width:var(--tap-sm); height:var(--tap-sm)}`. `.bt-track-label{gap:var(--gap-ctl)}`.
3. **Durações.** `:root{--dur-1:150ms; --dur-2:200ms; --dur-3:300ms; --dur-4:450ms}`. Substituições: `.15s`, `.16s` → `--dur-1`; `.18s`, `.2s` → `--dur-2`; `.28s` → `--dur-3`; `.4s`, `.5s` → `--dur-4`. Declarados e ainda não consumidos: `--ease-out:cubic-bezier(.16,1,.3,1)`, `--ease-in-out:cubic-bezier(.65,0,.35,1)`, `--ease-spring:cubic-bezier(.34,1.56,.64,1)`. Os `ease` existentes não mudam. Isentos: `drift 26s`, `blink 1.4s`/`1.2s`, `bt-pulse 1.6s`, `.001ms`.
4. **Fontes não entram no E1.** Um token por tamanho existente seria renomear literal; a escala entra no E2, onde a mudança é intencional e medida.

### E2 — Piso tipográfico e contraste (densidade única)

1. **Escala.** `:root{--fs-micro:11px; --fs-sm:12.5px; --fs-body:13.5px; --fs-lead:15px}`.

   | Declaração hoje | Vira |
   |---|---|
   | 8,5 / 9 / 9,5 / 10 / 10,5 / 11px | `--fs-micro` |
   | 11,5 / 12px | `--fs-sm` |
   | 13 / 13,5px | `--fs-body` |
   | 15px | `--fs-lead` |
   | ≥ 22px (h1, h2, display) | literal |

   **Frases vão para `--fs-sm` mesmo abaixo de 11,5px:** `.bt-pop .msg`, `#console` (mantém `line-height:1.55`), `#bt-word-pop-err` (inline, `:2615`), os `.sub` inline de `:538` e `:1019`. A varredura cobre estilos inline em template strings do JS.

   **Isentos (comentário `/* isento: lane intocada — sub-projeto A, decisão 2 */`):** `.bt-word` (9,5px); `.bt-clip.music .nm{font-size:9.5px}` e `.bt-clip.music .tag{font-size:8.5px}` como overrides, já que `.bt-clip .nm`/`.tag` são compartilhadas com B-ROLL e VÍDEO; `.bt-cap-overlay` (13px Unica One — representa a legenda queimada, é display).

2. **Coluna de rótulos.** Com rótulo a 11px, "TRILHA" com 5 controles não cabe em 192px (≈43px disponíveis para ≈50px de texto). Valor de partida: `--bt-labelw:204px`. Regra: o menor valor em passos de 4px que faz `label-truncate` passar — o Orquestrador ajusta o número se o probe reprovar. (Medido no E2: 204px passou sem ajuste.)

3. **Contraste.** `--faint:#7b80ad`. `.btn[disabled]` usa `--faint` como fundo e pareceria habilitado com o tom mais claro: passa a usar `--disabled-bg:#5c6190`.

4. **Densidade (Revisão R1): única, compacta.** Os alvos ficam nos valores do E1 (`--tap` 30px, `--tap-sm` 24px, `--gap-ctl` 2px) e só `--bt-labelw` muda (204px, item 2). Não há `data-density`, script no `<head>`, botão no header, `studio.density` nem evento `studio:density`. `readLabelW()` continua lendo o token no início de `buildDom()`. A classe `.hdr-btn` entra no E2 sem variante `[aria-pressed]`, para o botão `? ATALHOS` do E3b.
   - *Registro:* a versão original tinha `html[data-density="comfortable"]{--tap:36px; --tap-sm:28px; --gap-ctl:4px; --bt-labelw:248px}`, leitura de `studio.density` no `<head>`, `#density-toggle` no header e o evento `studio:density` relendo `LABEL_W`. Foi implementada, passou no probe (36/28, 248px sem corte) e no checklist, e foi removida por decisão do usuário antes do commit do E2.

### E3a — Controles de track e playhead

1. **Ícones de dois estados (R4).**
   - Conjunto inalterado: MARKERS `H L` · B-ROLL `+ H L` · VÍDEO `L` · LEGENDA `H L` · ÁUDIO `H L` · TRILHA `+ M S H L` (15).
   - Sprite: `<svg width="0" height="0" style="position:absolute" aria-hidden="true">` no início do `<body>`, com `<symbol viewBox="0 0 24 24">` para `i-eye`, `i-eye-off`, `i-lock-open`, `i-lock`, `i-spk`, `i-spk-off`, `i-solo`, `i-plus` (paths do mockup), `fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round`. Ícone com 60% de `--tap-sm`.
   - Markup: `<button class="bt-tctl" data-act="hide" aria-pressed="false" aria-label="Ocultar track B-ROLL" title="…"><svg aria-hidden="true"><use href="#i-eye"></use></svg></button>`. `+` sem `aria-pressed`.
   - `applyTrackVisibility()` (`:2253`) passa a sincronizar `aria-pressed` e o `href` do `<use>` além de `.on`. `aria-label` não muda com o estado.
   - Cor ativa: `hide`, `mute` → `--bad`; `lock` → `--warn`; `solo` → `--go`.
   - `title`: H "ocultar no preview — não altera o export"; L "travar edição"; M "mudo no preview — não altera o export"; S "solo da TRILHA: silencia o áudio do vídeo no preview — não altera o export"; `+` "adicionar clipe".
   - `.bt-track-row.locked .bt-track-content` ganha hachura `repeating-linear-gradient(45deg, …)`; oculta continua `opacity:.2`.

2. **R3 reduzida.**
   - `beats` ganha `<span class="ic">◆</span><span class="nm">MARKERS</span>` antes dos controles.
   - `#bt-playhead` ganha filho `<span class="bt-playhead-tc">`, `pointer-events:none`, `top:var(--bt-markers-h)`, à direita da linha, `--fs-micro` mono sobre `--go`. Texto via `fmt(playhead)` no mesmo ponto que atualiza `#bt-time` (`:2208`). Classe `.flip` (chip à esquerda da linha) quando `playheadLeft + chipWidth > #bt-inner.clientWidth`.
   - O triângulo `.bt-playhead-flag` continua sendo a pega de scrub, com o mesmo handler.

3. **Área de pega.** `.bt-handle::before{content:''; position:absolute; top:0; bottom:0}` com `right:-4px` na handle esquerda e `left:-4px` na direita (para dentro do clipe). `.bt-clip{overflow:hidden}` impede expansão para fora, e em VÍDEO os segmentos encostam.

### E3b — Transporte, atalhos, movimento

1. **Grupos do transporte (R1).** Remover `.bt-tsep` e `.bt-spacer`; IDs inalterados.

   | `<div class="bt-tgroup" role="group" aria-label>` | Conteúdo |
   |---|---|
   | Reprodução | `#bt-play`, `#bt-time`, `#bt-rate` |
   | Navegação | `#bt-j`, `#bt-k`, `#bt-l`, `#bt-frameback`, `#bt-frameforward`, `#bt-markin`, `#bt-markout` |
   | Edição | `#bt-split`, `#bt-merge`, `#bt-rename`, `#bt-undo`, `#bt-redo` |
   | Zoom | `#bt-zoomout`, `#bt-zoomlevel`, `#bt-zoomin`, `#bt-zoomfit` |
   | Projeto (`margin-left:auto`) | `#bt-save`, `#bt-conform` |

   - Rótulos: texto visível sem a letra (`◀◀ J` → `◀◀`, `L ▶▶` → `▶▶`), mais `<kbd class="bt-kbd">` de `--fs-micro`: Espaço, J, K, L, `,`, `.`, I, O, S, M, R, `Ctrl+Z`, `Ctrl+⇧+Z`, `-`, `+`, `\`.
   - `.bt-kbd{position:absolute; bottom:calc(100% + 4px); opacity:0}`, visível em `:hover`/`:focus-visible` — sem deslocar layout.
   - `#bt-play` passa a `<span class="lbl">▶</span><kbd class="bt-kbd">Espaço</kbd>`; os quatro `textContent` de `:3149, 3150, 3156, 3157` passam a escrever em `#bt-play .lbl`.

2. **Folha de atalhos (O3).**
   - `window.SHORTCUTS` no escopo global do script, `{keys:[...], desc, group}`, exatamente: **Reprodução** Espaço, J, K, L, `,`, `.`, Home, End · **Edição** I, O, S, M, R, Delete/Backspace, Ctrl+Z, Ctrl+⇧+Z · **Zoom** `+`/`=`, `-`, `\`, Ctrl+roda · **Geral** `?`, Esc.
   - `<dialog id="shortcuts-sheet" aria-labelledby="shortcuts-title">`, renderizado a partir de `SHORTCUTS` na primeira abertura; cabeçalho informa "atalhos da TIMELINE valem na etapa 04". Abre com `showModal()`; guarda `document.activeElement` ao abrir e o restaura no evento `close`.
   - Gatilhos: listener global de `keydown` para `e.key === '?'`, ignorando alvo `INPUT`/`TEXTAREA`/`SELECT`/`isContentEditable` e dialog já aberto; botão `? ATALHOS` no header, antes de `#port`.
   - Única alteração no handler da TIMELINE (`:3220`): `if (document.querySelector('dialog[open]')) return;` no topo.

3. **Microinterações (Y1, só timeline).**
   - **Clipe entrando:** `addClipAt(track, asset)` (`:1913`) e `duplicateClip` (`:2017`), os dois caminhos que fazem um clipe surgir na timeline, gravam `justAdded = {track, idx}`; o próximo `renderTracks()` aplica `.bt-enter` a esse clipe e zera a marca. `@keyframes bt-clip-in{from{opacity:0; transform:scale(.96)}}`, `var(--dur-2) var(--ease-out)`. A marca de uso único é necessária porque `renderTracks` reconstrói por `innerHTML`.
   - **Split:** `splitBeatAt` (`:1395`) e `splitClipAt` (`:1987`) gravam `justSplit = {track, idx}` da peça da direita; `.bt-split` anima `box-shadow: inset 2px 0 0 var(--go)` → transparente em `var(--dur-3) linear`.
   - **Seek:** `seekTo(t, opts)` aceita `{animate:true}`, usado **só** por `onRulerMouseDown` (`:3068`), Home/End (`:3238-3239`) e o `onclick` de `.bt-legend-row` (`:1888`). Liga `.bt-seek` (`transition:left var(--dur-1) var(--ease-in-out)`) em `#bt-playhead`, removida em `transitionend`. Chamadas sem `opts` (play, scrub, J/K/L, frame a frame) seguem sem transição.

---

## Alternativas descartadas

- **Uma passada só, validação no fim.** Regressão num arquivo de 3.283 linhas viraria caça ao culpado.
- **Por task na ordem do plano.** Cada task mistura refatoração e mudança visual; o probe não distinguiria "quebrou" de "mudou de propósito".
- **Harness externo (`repo-visual-check.html`) com stubs.** Mede uma cópia, não o app servido; fica fora do repo.
- **Pointer Events no A.** Maior risco de regressão pelo menor ganho de desktop.
- **Tokens de fonte no E1.** Seria renomear oito literais sem ganho.
- **`transition` permanente no playhead.** Atraso visível durante o play.
- **Label que muda com o estado.** Com `aria-pressed`, anuncia a ação duas vezes invertida.
- **Sprite com `hidden`/`display:none`.** Mais frágil para referência por `<use>`.
- **Expansão da área de pega para fora.** Cortada por `overflow:hidden` e sobreporia handles vizinhas em VÍDEO.
- **`<kbd>` inline sempre em `compact`.** ≈16px a mais por botão; ~220px de transporte extra.
- **Refatorar o `switch` de teclado para ser dirigido por `SHORTCUTS`.** Risco em código que funciona; a coerência é garantida por checagem estática.

---

## Guardrails

1. Zero npm. A única mudança em `server.js` é a rota estática `/dev/*.js` com allowlist.
2. Nada em `lib/*`, `remotion/`, `public/vendor/` — sem rebuild do bundle do Player.
3. Handlers de arraste, `saveBeats`, `doConform` e o formato do sidecar intocados. O `switch` de teclado só ganha o guard do dialog.
4. Nenhum ID existente muda.
5. Conteúdo das lanes LEGENDA, ÁUDIO e TRILHA visualmente igual.
6. Regra global de reduced-motion mantida; nenhuma animação nova com duração literal.
7. `localStorage`: nenhuma chave nova (a `studio.density` saiu na Revisão R1); os acessos existentes continuam em `try/catch`.
8. Desktop apenas: nenhum breakpoint de telefone, gesto de toque, `pointer:coarse` ou alvo de 44px.

---

## Limitações conhecidas

- H, M e S continuam só de preview; o `title` passa a dizer isso. Fazer M/S afetarem o export é decisão do sub-projeto B.
- O solo continua sendo "solo da TRILHA" (silencia o vídeo base). Solo exclusivo entre várias tracks de áudio depende de B.
- A folha de atalhos lista atalhos da TIMELINE; outras etapas não têm atalhos hoje.

---

## Riscos declarados

- **Aumentos de 0,5px (12 → 12,5; 13 → 13,5; 11,5 → 12,5)** podem quebrar linha em áreas justas (nav, `.btn`, tabelas). Coberto pelo checklist manual; aceito como consequência da escala.
- **O valor de `--bt-labelw` (204px) era estimativa** de métrica de fonte. O probe decide; ajuste é de uma linha. (Medido no E2: passou sem ajuste.)
- **Eventos sintéticos no probe:** `?` é tratado pelo listener do app; `Esc` nativo do `<dialog>` não é sintetizável, então o probe fecha com `.close()`. O fechamento por `Esc` real fica no checklist.
- **Rota canvas não é a padrão.** O E1 mexe em `192` usados pelas duas rotas; coberta pelo item 12 do checklist.
- **Probe interrompido no meio** pode deixar um controle alternado; recarregar a TIMELINE reseta o estado (`:3185`).

---

## Critérios de aceite (nível de spec)

| Estágio | Probe (`uiProbe.run`) | Estático (`validator`) |
|---|---|---|
| E0 | Roda sem exceção; `console-errors` = 0; baseline gravado em `EXPECT.baseline` | Rota `/dev/` com regex e `startsWith`; loader só age com `?probe` |
| E1 | Todos os checks visuais **idênticos ao baseline**; `labelw-sync` PASS; `motion-literals` = 0; `console-errors` = 0 | Nenhum `192` literal no closure da TIMELINE; tokens declarados; nenhuma duração literal fora dos isentos |
| E2 | `text-floor` = 0 e isentos com o tamanho do baseline; `contrast` ≥ 4,5 nos 6 pares; `tap-targets` 30/24; `label-truncate` e `labelw-sync` PASS | Nenhum px < 11 fora dos seletores isentos (CSS e JS); `--fs-*` em ≥ 90% das declarações de 11 a 15px; nenhum resto de densidade (`data-density`, `studio.density`, `#density-toggle`, `studio:density`) |
| E3a | `tctl-a11y` completo; `playhead-tc` PASS; `label-truncate` PASS | Nenhum `.bt-tctl` com texto no markup; `applyTrackVisibility` sincroniza `aria-pressed` e `<use>` |
| E3b | `transport-overflow` PASS; `transport-ids` PASS; `shortcut-sheet` PASS | `case`s do `switch`, os dois ramos Ctrl+Z e o Ctrl+roda ↔ `SHORTCUTS` 1:1; guard do dialog presente; `motion-literals` = 0 |

Em todo estágio: `console-errors` = 0; checklist manual sem regressão.

---

## Checklist manual de regressão (usuário, a cada estágio a partir de E1)

Com o vídeo da fixture carregado na TIMELINE:

1. Preview toca.
2. Espaço, J/K/L, `,`/`.`.
3. Beats: arrastar, trim, `S`, `M`, `R`.
4. B-ROLL: adicionar, mover, trim. TRILHA: adicionar, ajustar volume.
5. VÍDEO: split, trim, reordenar, deletar com ripple.
6. Ctrl+roda, `+`/`−`/FIT, scroll horizontal — playhead alinhado com a régua.
7. Redimensionar altura de track.
8. H/L/M/S refletem no preview.
9. Undo/redo.
10. SALVAR BEATS → recarregar a página → carregar beats.
11. CONFORMAR → EXPORT conclui e o arquivo chega ao EXPORT.
12. Rota canvas: DevTools → Network → *Block request URL* `/vendor/studio-player.js`, repetir 1, 2 e 6.

A partir de E3a, acrescentar: travar B-ROLL e tentar arrastar (não move); trim num segmento de VÍDEO encostado no vizinho (pega o certo). A partir de E3b: adicionar clipe (anima uma vez, não repete ao arrastar); split (flash uma vez); clicar na régua (desliza); play (sem atraso); `?` e fechar com `Esc` real (foco volta); J com a folha aberta (nada acontece).

---

## Processo

Por estágio, na ordem E0 → E1 → E2 → E3a → E3b:

1. `executor` implementa o estágio a partir de `docs/plans/ui-premium-timeline.md`.
2. `validator` faz a checagem estática.
3. Orquestrador roda `uiProbe.run('<estágio>')` via Chrome e registra em `## Verificação` do plano.
4. Usuário roda o checklist manual.
5. `git-workflow` `prepare` → OK do usuário → `publish` (commit, push, PR, merge commit na `main`, limpeza).

Um PR por estágio, em branches `feat/ui-premium-e0` … `feat/ui-premium-e3b` criadas a partir da `main` sincronizada (decisão tomada após o merge do PR #9, que trouxe esta spec e o plano).

---

## Ajustes feitos ao escrever o plano

Decididos ao ler o código linha a linha para `docs/plans/ui-premium-timeline.md`; o plano é a referência executável.

1. **Loader do probe no `<head>`**, e não antes do script principal: o coletor de erros passa a cobrir também o bundle do Player.
2. ~~**Botão de densidade com texto fixo** `DENSIDADE CONFORTÁVEL`; o estado vai só em `aria-pressed` e na cor.~~ Sem efeito desde a Revisão R1: o botão saiu.
3. **Sem override `.bt-clip.music .tag`:** clipes de TRILHA não renderizam `.tag` (só VÍDEO renderiza).
4. **`.bt-beat .lbl` / `.dur` com `line-height:1.3`:** a 11px com o `1.6` herdado, duas linhas não cabem nos 34px internos do beat.
5. **Texto do chip de timecode atualizado em `renderPlayhead()`:** na rota canvas o `compositeTick` chama só essa função por frame.
6. **`duplicateClip` também marca `justAdded`** (corrigido acima).
7. **Barra invertida de FIT escrita como `\` no template literal:** o original `title="\"` virava `title=""`; um `<kbd>\</kbd>` literal quebraria o HTML.
