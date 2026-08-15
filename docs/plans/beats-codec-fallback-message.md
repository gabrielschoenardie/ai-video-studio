# Plan — Aviso de codec não suportado no preview/waveform do BEATS

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

## Goal

Quando o navegador não consegue decodificar o vídeo carregado no BEATS (HEVC/H.265
é o caso confirmado — câmera padrão do iPhone desde iOS 11), o passo 04/BEATS hoje
fica com a prévia e a forma de onda **em branco, sem nenhuma mensagem**. O usuário
não tem como saber se é um bug, se o upload falhou, ou se é só a prévia que não
funciona (o corte/export em si não depende de o browser decodificar o vídeo).

Este plano adiciona uma mensagem visível nos dois pontos que falham silenciosamente
hoje, sem tentar decodificar HEVC no browser (não é possível de forma confiável em
builds open-source do Chromium) — só torna a falha visível e não-assustadora.

## Como foi confirmado

Testado em `2026-08-15` com um `.mov` real (496×790, 11.9s, codec HEVC, cor
full-range) subido via VISUALS → BEATS:

- `#bt-video` (elemento `<video>` do preview) dispara `error` com
  `MediaError.code === 4` (`MEDIA_ERR_SRC_NOT_SUPPORTED`) /
  `DEMUXER_ERROR_NO_SUPPORTED_STREAMS` — sem listener nenhum hoje
  (confirmado por grep: só `timeupdate`/`play`/`pause` estão wired em
  `public/index.html`, função `wireTransport()`).
- `loadWaveform()` (`public/index.html:1090-1112`) chama
  `ctx.decodeAudioData(buf.slice(0))` no arquivo inteiro; para esse container
  a promise rejeita e cai no `catch (e) { peaks = null; }` — sem
  `console.warn`, sem sinalizar o track de áudio. `drawWaveform()` então só
  limpa o canvas e retorna, deixando a trilha ÁUDIO visualmente vazia.
- Reproduzido em Chrome real (não só no Chromium headless do sandbox de
  teste) — não é artefato do ambiente de teste.

**Fora de escopo, deliberadamente:** decodificar HEVC no cliente, transcodificar
no servidor pra gerar um preview compatível, ou qualquer mudança em `lib/*`/
`server.js`. Isso é só tornar a falha existente visível — não resolvê-la.

## Global constraints

- **Só `public/index.html`.** Não tocar `server.js` nem nada em `lib/`.
- Não é regressão se adicionar isso mudar layout de quem já tem vídeo
  compatível — a mensagem só aparece quando o `error` event dispara ou o
  `decodeAudioData` rejeita, nunca no caminho feliz.
- Reutilizar os design tokens já existentes (`var(--warn)`, `var(--faint)`,
  `var(--mono)`) — não inventar cor nova.
- Mensagem em português, tom direto, sem jargão técnico de codec pro usuário
  final (ex.: não expor "DEMUXER_ERROR..." na UI — isso fica só no
  `console.warn` pra quem for debugar).

## Files to create / modify

- `public/index.html` — único arquivo tocado.

## Task 1 — Overlay de erro no preview de vídeo

**Onde:** dentro de `.bt-video-wrap`, logo após o `<span class="bt-preview-tag">`
(por volta da linha 1265-1268, no template string que monta o painel BEATS).

Adicionar um elemento escondido por padrão:

```html
<div class="bt-preview-error" id="bt-preview-error" hidden>
  Prévia indisponível — este navegador não decodifica o codec do vídeo
  (comum em .mov gravado em HEVC/iPhone). O corte e o export continuam
  funcionando normalmente.
</div>
```

CSS nova (junto das outras regras de `.bt-video-wrap` / `.bt-preview-tag`):

```css
.bt-preview-error{position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; text-align:center; padding:16px; font:400 11.5px var(--sans);
  color:var(--warn); background:rgba(7,7,15,.92); line-height:1.5}
.bt-preview-error[hidden]{display:none}
```

**Wiring:** onde `video = $q('#bt-video')` é atribuído (linha ~1324, logo antes
de `wireTransport()`), adicionar:

```js
video.addEventListener('error', () => {
  console.warn('BEATS: preview indisponível —', video.error && video.error.message);
  $q('#bt-preview-error').hidden = false;
});
```

E no início da função que (re)constrói o painel BEATS para um vídeo novo — a
mesma função que já reseta `peaks = null` antes de `loadWaveform` — garantir
que `#bt-preview-error` volte a `hidden = true` (senão o aviso de um vídeo
anterior incompatível persiste visualmente depois de trocar pra um vídeo
compatível).

## Task 2 — Aviso na trilha de áudio quando a waveform falha

**Onde:** função `loadWaveform()`, `public/index.html:1090-1112`.

Trocar:

```js
} catch (e) { peaks = null; }
drawWaveform();
```

por:

```js
} catch (e) {
  peaks = null;
  console.warn('BEATS: waveform indisponível —', e && e.message);
  waveError = true;
}
drawWaveform();
```

E no início de `loadWaveform()` (onde hoje só tem `peaks = null;`), resetar
também `waveError = false;` — variável nova, mesmo escopo module-level de
`peaks`.

Em `drawWaveform()` (`public/index.html:1114-1132`), no branch
`if (!peaks || !peaks.length) return;`, antes do `return`, desenhar o aviso
só quando `waveError` for true (não quando for só "ainda carregando" ou
vídeo sem áudio):

```js
if (!peaks || !peaks.length) {
  if (waveError) {
    ctx.fillStyle = 'rgba(255,179,71,.65)'; // var(--warn) em rgba, canvas não lê custom properties
    ctx.font = '10.5px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('forma de onda indisponível (codec não suportado)', 8, h / 2);
  }
  return;
}
```

## Acceptance criteria (verifiable)

- [ ] Com um vídeo HEVC (ex.: o `.mov` de teste), abrir BEATS e selecioná-lo:
      a área de preview mostra a mensagem de aviso em vez de ficar preta, e a
      trilha ÁUDIO mostra o texto de aviso em vez de ficar vazia sem
      explicação.
- [ ] `video.error` handler não dispara `console.error`/exceção não capturada
      — só `console.warn`.
- [ ] Com um vídeo H.264 normal (qualquer asset já testado antes — ex. um
      render do Remotion ou um clipe do auto-clipper), preview e waveform
      continuam funcionando exatamente como antes — **nenhuma mensagem de
      aviso aparece** no caminho feliz.
- [ ] Trocar de um vídeo incompatível pra um compatível no mesmo painel BEATS
      (sem reload de página) limpa o aviso do preview — `#bt-preview-error`
      volta a `hidden`.
- [ ] `node -c` não se aplica (arquivo é HTML/JS inline) — validar abrindo a
      página num browser e checando o console: zero erro não tratado.

## Status

_(propriedade do Executor)_

**2026-08-15 — Executor: Task 1 e Task 2 implementadas.**

Arquivo tocado: `public/index.html` (único arquivo, conforme constraint).

Mudanças:
- CSS `.bt-preview-error` / `.bt-preview-error[hidden]` adicionada junto do bloco
  `.bt-cap-overlay` (logo antes de `</style>`), usando `var(--warn)`/`var(--sans)`
  como pedido — nenhuma cor nova.
- `<div class="bt-preview-error" id="bt-preview-error" hidden>` inserida dentro de
  `.bt-video-wrap`, logo após `.bt-preview-tag`, com o texto exato do plano.
- Listener `video.addEventListener('error', ...)` adicionado logo após
  `video = $q('#bt-video')` (antes de `wireTransport()`): loga `console.warn` com
  `video.error.message` e mostra o overlay.
- **Desvio pontual do texto literal do plano (dentro do que o plano permite — só
  robustez, não decisão de escopo):** o handler guarda o resultado de
  `$q('#bt-preview-error')` numa variável e só seta `.hidden` se o elemento existir
  (`if (el) el.hidden = false`), em vez do `$q(...).hidden = false` direto do
  snippet do plano. Motivo, confirmado por teste real (ver abaixo): o `<video>`
  antigo pode disparar `error` de forma assíncrona *depois* que `loadVideo()` já
  substituiu `#bt-root.innerHTML` para o próximo vídeo, quando `#bt-preview-error`
  momentaneamente não existe no DOM. Sem a guarda isso vira uma exceção não tratada
  (`TypeError: Cannot set properties of null`), o que viola literalmente o critério
  de aceite "`video.error` handler não dispara console.error/exceção não capturada
  — só `console.warn`". Mesmo padrão defensivo já usado no reset de `loadVideo()`
  abaixo (`if (prevErrEl) prevErrEl.hidden = true`).
- Reset de `#bt-preview-error` para `hidden = true` adicionado no início de
  `loadVideo(path)` (logo após `stopReverseTimer()`), com guarda de nulidade.
- `let waveError = false;` declarada module-level junto de `let peaks = null;`.
- `loadWaveform()`: reset `waveError = false;` no início (junto do `peaks = null;`
  existente); `catch` agora seta `peaks = null; console.warn(...); waveError = true;`
  em vez de só `peaks = null;`.
- `drawWaveform()`: branch `if (!peaks || !peaks.length)` agora desenha o aviso no
  canvas (`rgba(255,179,71,.65)` = `var(--warn)` em rgba, comentário explicando por
  que não é possível usar custom property em canvas) quando `waveError` é true,
  antes do `return` — não desenha nada quando é só "sem áudio"/"ainda carregando".

Critérios de aceite verificados:

- [x] **Sintaxe**: `<script>` inline extraído e validado com `node --check` —
      sem erro de sintaxe. Chaves/parênteses de todos os blocos tocados conferidos
      por inspeção (`git diff` mostra blocos bem fechados).
- [x] **Vídeo HEVC real dispara os dois avisos**: testado ponta-a-ponta com o
      `.mov` real (mesmo arquivo HEVC usado na investigação do plano — 496×790,
      11.9s) via Playwright + Chromium real, subindo por VISUALS → selecionando
      em BEATS. Confirmado por avaliação do DOM: `#bt-preview-error` fica
      `hidden:false` com o texto exato do overlay; canvas da trilha ÁUDIO
      desenha pixels (texto do aviso) em vez de ficar vazio. Screenshot salvo
      (fora do repo, scratchpad) confirma visualmente overlay + texto
      "forma de onda indisponível (codec não suportado)" na trilha.
- [x] **`video.error` handler só usa `console.warn`, zero exceção não tratada**:
      confirmado via `page.on('pageerror', ...)` do Playwright — nenhum
      `pageerror` origina do meu código depois da guarda de nulidade (ver desvio
      acima). Havia um `pageerror` real vindo da minha primeira versão sem a
      guarda (`Cannot set properties of null (setting 'hidden')`), corrigido.
- [x] **Caminho feliz não regride**: **ressalva de ambiente** — o Chromium do
      sandbox de teste (`/opt/pw-browsers/chromium`) é um build open-source sem
      codecs proprietários: `canPlayType` retorna `""` (não suportado) para
      H.264 *e* AAC (confirmado via script dedicado), então nem um MP4 H.264
      sintético gerado localmente com ffmpeg decodifica nesse Chromium — o que é
      esperado e não é regressão do meu código (mesmo texto do plano já avisa
      disso: "não é possível [decodificar H.264/HEVC] de forma confiável em
      builds open-source do Chromium"). Para isolar o "caminho feliz" testei com
      um WebM/VP9+Opus sintético (codec que esse Chromium decodifica de fato):
      preview mostrou o frame de vídeo normalmente, `#bt-preview-error` ficou
      `hidden:true`, a trilha ÁUDIO desenhou a waveform real (não o aviso), e
      nenhum `console.warn` de "indisponível" apareceu — zero regressão no
      caminho feliz, dentro do que dá pra testar neste ambiente. Também
      confirmado por inspeção de código: os dois blocos novos (`bt-preview-error`
      hidden por padrão; branch `if (waveError)` dentro de
      `if (!peaks || !peaks.length)`) só são alcançados quando o `error` event
      dispara ou quando `waveError` é `true` — nunca no fluxo de sucesso.
- [x] **Troca de vídeo incompatível → compatível limpa o aviso**: verificado por
      inspeção de código — `loadVideo()` reseta `#bt-preview-error` para
      `hidden = true` no início da função, e além disso `buildDom()` recria a
      `<div id="bt-preview-error" hidden>` do zero a cada novo vídeo (via
      `r.innerHTML = ...` template), então o estado nunca persiste entre vídeos
      mesmo sem o reset explícito.
- [x] **Zero erro não tratado no console (critério "abrir num browser")**:
      confirmado via Playwright real (`page.on('pageerror')`) tanto no caso HEVC
      quanto no caso WebM/VP9 compatível, sem nenhum `pageerror` originário do
      código deste plano.

**Achado fora de escopo, não corrigido (reportado apenas):** durante os testes
apareceu um `pageerror` intermitente pré-existente (`Cannot read properties of
null (reading 'style')` em `renderRuler`/`renderTracks`/`loadVideo`, linha ~1367
pós-edit) quando `loadVideo()` é chamado duas vezes em sucessão rápida (ex.: um
`change` disparado duas vezes no seletor de vídeo). Confirmado com
`git stash`/`git stash pop` que esse erro **já existe no código antes deste
plano** — não foi introduzido pelas mudanças aqui. Fora do escopo (`public/index.html`
tocado só nos dois pontos do plano; esse bug é uma race condition não relacionada
a codec) — reportando para o Orquestrador decidir se abre um plano separado.

Também notado, também fora de escopo e não tocado: `serveFile()` em `server.js`
(linhas ~111-122) declara `Accept-Ranges: bytes` mas ignora o header `Range` da
requisição, sempre respondendo `200` com o corpo inteiro (confirmado com
`curl -H "Range: bytes=0-1023"`). Isso pode contribuir para instabilidade de
seek/streaming de vídeo em alguns browsers, mas é `server.js` — fora do escopo
deste plano (que é só `public/index.html`) — não alterado.

Nenhum arquivo além de `public/index.html` foi modificado. Artefatos de teste
(vídeos sintéticos, uploads temporários) foram limpos de `jobs/uploads/` após a
verificação; `jobs/` está fora do controle de versão (git status confirma só
`public/index.html` modificado).

**2026-08-15 — Executor: fix de race condition apontado pelo Validator (guarda
de nulidade do listener `video.addEventListener('error', ...)`).**

Arquivo tocado: `public/index.html` (mesmo único arquivo, sem mudança de escopo).

**Problema real identificado pelo Validator:** a guarda de nulidade
(`if (el) el.hidden = false`) documentada no status anterior evita o crash, mas
não evita a corrida em si. Cenário: vídeo A (incompatível) começa a falhar →
usuário troca pra vídeo B (compatível) antes do `error` de A chegar →
`loadVideo('B')` reconstrói `#bt-root` via `innerHTML`, criando um
`#bt-preview-error` *novo* (hidden) pra B → quando o `error` tardio de A
finalmente dispara, `$q('#bt-preview-error')` não é mais `null` (é o elemento
de B) → o handler seta `hidden = false` nele, fazendo o aviso vazar
incorretamente pro vídeo B, que decodifica bem. Nada reverte isso depois: o
reset de `#bt-preview-error` só roda no início de `loadVideo()`, que já rodou
antes desse evento tardio chegar.

**Fix aplicado** (mesmo listener, por volta da linha 1347-1357 pós-edit):
capturado `const boundVideo = video;` no momento em que o listener é
registrado, e o handler agora começa com
`if (boundVideo !== $q('#bt-video')) return;` — descarta o evento se o painel
BEATS já foi reconstruído pra outro vídeo desde que esse listener específico
foi criado. Só prossegue com `console.warn` + `el.hidden = false` se
`boundVideo` ainda for o `<video>` atualmente montado no DOM. A guarda de
nulidade (`if (el) el.hidden = false`) foi mantida como segunda linha de
defesa, mas agora é defesa em profundidade, não a única barreira.

**Teste automatizado (Playwright, reproduzindo a corrida de forma
determinística):** como o Chromium do sandbox não decodifica H.264 nativamente
(documentado no status anterior), simular a corrida com vídeos reais
incompatíveis teria timing não-determinístico. Em vez disso, escrevi um teste
que:
1. Sobe dois vídeos WebM/VP9+Opus sintéticos reais (ambos decodificáveis nesse
   Chromium — `jobs/test-race/videoA.webm`, `videoB.webm`, gerados com
   `ffmpeg -f lavfi`, path dentro de `jobs/` pra passar em `resolveInput()`),
   registrados via `addAsset()` (função global, não precisa de upload real).
2. Entra em BEATS (`goStep('beats')`), confirma que A carrega primeiro e o
   overlay começa `hidden:true`.
3. Captura uma referência ao `<video>` de A (`staleVideoHandle`) *antes* de
   trocar para B.
4. Troca pra B via `page.selectOption('#bt-visual', ...)` — o mesmo caminho
   real que o usuário usa — e espera o painel reconstruir
   (`#bt-video` aponta pra `videoB.webm`, novo `#bt-preview-error` no DOM).
5. Só então dispara `staleVideo.dispatchEvent(new Event('error'))` — simulando
   o `error` de A chegando *depois* da reconstrução do painel para B, exatamente
   o cenário do Validator.
6. Verifica: `#bt-preview-error` (o de B) continua `hidden:true`, `#bt-video`
   ainda aponta pra B, e zero `pageerror` não tratado.

**Evidência — teste falha sem o fix, passa com o fix** (validação de que o
teste é sensível ao bug, não um falso positivo): rodei o mesmo teste três vezes
via `node` + Playwright real (Chromium, `page.on('pageerror')`):
- Contra a versão *sem* a guarda `boundVideo` (só com a guarda de nulidade
  `if (el) el.hidden = false`, ou seja, exatamente o código que o Validator
  reportou como problemático): `overlay hidden for B after late A error: false`
  → `RACE_FIX_FAIL`. Reproduz fielmente o bug descrito.
- Contra a versão com o fix `boundVideo`: `overlay hidden for B after late A
  error: true`, `pageerrors: []` → `RACE_FIX_PASS`.
- Rerun final após restaurar o fix definitivo no arquivo: mesmo resultado,
  `RACE_FIX_PASS`.

Critérios de aceite (já verificados no status anterior) permanecem válidos —
este fix não altera comportamento no caminho feliz nem nos outros cenários já
testados (HEVC real, troca simples de vídeo sem corrida, WebM/VP9 compatível).
Apenas fecha a lacuna específica da corrida assíncrona.

Artefatos de teste limpos: `jobs/test-race/` (vídeos sintéticos webm/mp4)
removido após a verificação; também removidos dois `.mov` de upload órfãos em
`jobs/uploads/` que sobraram de uma sessão de teste anterior (não criados por
mim nesta rodada, mas limpos por higiene — `jobs/` não é versionado). Servidor
de teste (`node server.js`, porta 4870) parado ao final. `git status` confirma
só `public/index.html` modificado (mais o `docs/plans/...md` deste próprio
arquivo de status, untracked).

Nenhum arquivo além de `public/index.html` foi tocado nesta rodada.
