# Ordem do Color Pipeline + Dither RPDF — Implementation Plan (Fase 2)

> **Para agentic workers:** implemente task-por-task, em ordem. Steps usam checkbox (`- [ ]`). Este projeto **não tem suíte de testes** (backend Node puro, zero-dep, sem runner) — a verificação de cada task é feita por script `node` runnable, comando `ffmpeg`/`ffprobe`, e/ou `POST /api/export`, mais inspeção. Não há `pytest`/`jest`.

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Pré-requisito:** o plano `docs/plans/vmaf-harness-and-generation-loss.md` (Fase 1) precisa estar **executado e commitado** antes desta Fase 2. Este plano assume que `lib/vmaf.js` existe, que `buildFit` já é exportado por `lib/encode.js`, e que `lib/assemble.js` já produz mezzanine `yuv444p` CRF 12. Se qualquer um desses não for verdade, **pare e devolva ao Orquestrador**.

---

## Goal

Três defeitos de color science que hoje se reforçam:

1. **A LUT grada os gráficos.** O `lut3d` vive no Export, mas o Assemble já queimou as legendas ASS antes. Resultado: a LUT está gradando o texto branco das legendas e o `#FFB800` do `AutoKillReel`. Branco puro vira creme, o dourado desloca de matiz.
2. **A LUT roda em 8-bit e sem dither.** O `lut3d` recebe o mezzanine 8-bit, interpola em 8-bit, e o resultado vai direto para `yuv420p` sem dither nenhum. Gradiente chapado — exatamente o que o `NeuralIntro` produz — banda de forma visível, e o x264 depois gasta bits codificando a borda de banda.
3. **A legenda atravessa duas subamostragens de croma.** Assemble compõe o texto e o Export subamostra de novo. Texto colorido em 4:2:0 duas vezes é franja de croma acumulada.

Ao fim desta fase: **a LUT toca só o plate, o dither existe, e a legenda passa por uma única quantização.**

## Architecture

Módulo novo `lib/color.js`, autocontido, que constrói **o segmento color-managed do filtergraph** e nada mais — ele não roda ffmpeg, só devolve strings de filtro. `lib/encode.js` passa a montar o `vf` na ordem correta consumindo esse módulo. `lib/assemble.js` deixa de queimar legenda e passa a **entregar o caminho do `.ass`** no seu retorno, que a UI repassa ao Export. `lib/vmaf.js` ganha um `refFilter` para que a referência receba as mesmas transformações criativas do output (ver "Consequência sobre o VMAF" abaixo — isso não é opcional).

Caminho de precisão com duas rotas, escolhidas por sonda, no mesmo padrão de degradação suave do resto do app:

| Rota | Condição | Precisão da LUT | Dither |
|:--|:--|:--|:--|
| **zscale** (preferida) | ffmpeg com `--enable-libzimg` | float RGB planar | `d=random` — RPDF nativo do zimg |
| **swscale** (fallback) | sem zscale | 8-bit | `noise=alls=1:allf=t+u` — RPDF aproximado, ±1 LSB temporal uniforme |

**Tech Stack:** Node ≥18 CommonJS; `ffmpeg`/`ffprobe` via `child_process`; `lut3d`, `zscale`/`swscale`, `noise`, `subtitles` (libass) — todos filtros nativos do ffmpeg, nenhuma dependência npm. DOM vanilla no front.

---

## Nova ordem canônica do `vf` no Export

Esta ordem é a decisão central do plano. O Executor **não deve reordenar**.

```text
1. denoise            (opcional, domínio YUV, na resolução da fonte)
2. buildFit(fit)      → 1080×1920, aspect-preserving, com in_range/out_range
3. fps=30
4. ── GRADE ──        promove precisão → lut3d=interp=tetrahedral        ← só o PLATE
5. ── DITHER ──       volta para 8-bit 4:4:4 com dither RPDF
6. subtitles(.ass)    ← GRÁFICOS entram aqui, depois da LUT, sem grade
7. format=yuv420p     ← única subamostragem de croma de todo o pipeline
```

Três mudanças de ordem em relação ao estado atual, cada uma com um motivo específico:

- **LUT depois do fit, não antes.** Grada menos pixels (mais rápido) e a interpolação de escala não gera valores intermediários que a LUT depois amplifica de forma inconsistente.
- **Legenda depois da LUT.** É o item 1 do Goal. O `subtitles`/libass do ffmpeg só opera em 8-bit, então ele **tem** que vir depois do dither, não antes — não é preferência, é restrição do filtro.
- **`format=yuv420p` uma única vez, no fim.** O texto colorido sofre uma subamostragem em vez de duas.

---

## Consequência sobre o VMAF — obrigatório, não opcional

A Fase 1 acabou de construir o harness de VMAF comparando o output contra o mezzanine. **Esta fase quebra essa comparação se nada for feito**: a partir daqui o output tem LUT e legendas que o mezzanine não tem. O VMAF leria isso como distorção massiva e a nota despencaria sem que nada tenha piorado.

Correção: a referência precisa receber **as mesmas transformações criativas** do output — grade + legenda — em precisão alta, sem compressão. Aí a métrica isola o que ela deve isolar: **dano de compressão**, e nada mais.

```text
distorted = mezzanine → fit → fps → grade → dither → legenda → yuv420p → x264 VBV
reference = mezzanine → fit → fps → grade → dither → legenda → yuv420p        (sem encode)
                                    └──────── idêntico ────────┘
```

Isso também é o que mantém a escolha de **modelo não-NEG** (`vmaf_v0.6.1`, fixada na Fase 1) sob controle: com a LUT presente em ambos os lados, o realce introduzido por ela deixa de inflar a nota — ele é comum às duas pontas e se cancela. Se a LUT estivesse só no output, o modelo padrão poderia **subir** a nota por causa do realce, e a métrica viraria ruído.

---

## Global Constraints

- **Zero dependência npm** no backend. `zscale` é filtro nativo do ffmpeg quando compilado com `libzimg`; ausência dele degrada para a rota swscale, nunca falha.
- **Degradação suave obrigatória.** Sem `zscale` → rota swscale com aviso no log. Sem `.ass` → Export encoda sem legenda. LUT ausente → pula o segmento de grade inteiro (nada de promover precisão para não fazer nada).
- **`lib/color.js` é puro.** Não roda `child_process`, não toca em `fs`, não faz I/O. Recebe parâmetros, devolve strings/arrays. Isso é o que permite testá-lo por `node -e` sem arquivo de mídia.
- **Assinaturas públicas intactas:** `lib/encode.js` continua exportando `{ selectProfile, riskScore, buildArgs, buildX264Params, buildFit, validate, encodeReel }`. `lib/assemble.js` continua exportando `{ assemble }`. `lib/captions.js` continua exportando `{ writeAss, subFilter }` — `assDuration` é **adicionado**. `lib/vmaf.js` continua exportando `{ measure, hasLibvmaf, VMAF_MODEL }`.
- **Compatibilidade retroativa do Assemble:** `assemble({ burnCaptions: true })` precisa continuar queimando legenda no mezzanine, para quem usa o passo isolado. O **default passa a ser `false`**.
- **Contrato do job bus preservado:** `onLog`/`onStage`/`onProgress` em toda função de pipeline.
- **NÃO reiniciar o servidor** e **não rodar `node server.js`** — o Orquestrador cuida do restart e da verificação no browser.
- **NÃO commitar.** Deixe no working tree para o ciclo `git-workflow`.
- **Estilo:** 2 espaços, `'use strict'`, aspas simples, idioma `run()`/`runFfmpeg()` existente com tail de stderr no erro.
- **Escape de path:** toda inserção de caminho em filtergraph (LUT, `.ass`) usa **a receita que já existe** no repo (`\` → `/`, `:` → `\:`, `'` → `\'`). Não inventar outro esquema. `lib/captions.js:subFilter` já faz isso para o `.ass` — reutilizar a função, não reescrever.
- **Não tocar** em arquivo fora da lista. Não adicionar regra ao `.gitignore`.

---

## Files to create / modify

| Ação | Path | O que muda |
|:--|:--|:--|
| **Create** | `lib/color.js` | Constrói o segmento grade+dither do filtergraph; puro, sem I/O |
| **Modify** | `lib/deps.js` | Sonda `zscale` |
| **Modify** | `lib/captions.js` | Adiciona `assDuration()`; fixa `PlayResX/PlayResY` |
| **Modify** | `lib/assemble.js` | Para de queimar legenda por default; retorna `ass` |
| **Modify** | `lib/encode.js` | Nova ordem do `vf`; opts `captions`/`grade`/`dither`; passa `refFilter` ao VMAF |
| **Modify** | `lib/vmaf.js` | Aceita `refFilter` aplicado ao branch da referência |
| **Modify** | `server.js` | `/api/assemble` devolve `ass`; `/api/export` aceita `captions`/`grade`/`dither` |
| **Modify** | `public/index.html` | Guarda o `.ass` do Assemble; selects GRADE e DITHER no Export; card COLOR |
| **Modify** | `CLAUDE.md` | Documenta `lib/color.js`, a nova ordem do `vf` e a mudança de dono da legenda |
| **Modify** | `README.md` | Atualiza os passos 4 e 6 do pipeline |

---

## Task 1 — Criar `lib/color.js`

- [ ] Header de comentário explicando: monta o segmento color-managed do filtergraph do Export; a LUT toca só o plate; o dither é obrigatório antes de qualquer quantização para 8-bit; módulo puro, sem I/O.

- [ ] Constantes no topo:

```js
const LUT_INTERP = 'tetrahedral';   // pinado — não confiar no default da versão do ffmpeg
const DITHER_MODES = ['random', 'error_diffusion', 'none'];
const NOISE_LSB = 1;                // amplitude do dither de fallback, em LSB de 8-bit
```

- [ ] `function escPath(p)` — cópia exata da receita já usada em `lib/encode.js`/`lib/captions.js`.

- [ ] `function buildGrade({ lut, dither = 'random', zscale = false })` → retorna **array de strings de filtro** (vazio se `!lut`).

  Rota **zscale** (`zscale === true`):

```js
[
  // YUV limited BT.709 → RGB planar float. Matriz e range explícitos: sem isso
  // o ffmpeg auto-insere uma conversão que adivinha a matriz pelas tags do
  // arquivo, e um mezzanine mal tagueado grada errado sem avisar.
  'zscale=min=bt709:tin=bt709:pin=bt709:rin=limited:m=rgb:t=bt709:p=bt709:r=full:f=lanczos:d=none',
  'format=gbrpf32le',
  `lut3d='${escPath(lut)}':interp=${LUT_INTERP}`,
  // volta para YUV 4:4:4 8-bit — é aqui que o dither entra, na única redução
  // de precisão do caminho de grade.
  `zscale=m=bt709:t=bt709:p=bt709:r=limited:f=lanczos:d=${dither === 'none' ? 'none' : dither}`,
  'format=yuv444p',
]
```

  Rota **swscale** (fallback, `zscale === false`):

```js
[
  'format=yuv444p',
  `lut3d='${escPath(lut)}':interp=${LUT_INTERP}`,
  ...(dither === 'none' ? [] : [`noise=alls=${NOISE_LSB}:allf=t+u`]),
]
```

  `allf=t+u` é o que faz esse `noise` ser RPDF e não gaussiano: `u` = distribuição uniforme (retangular), `t` = temporal. Amplitude 1 LSB. Não trocar por `allf=t` sozinho — sem o `u` o filtro usa gaussiano, que é TPDF-ish e mancha o gradiente em vez de dissolver a banda.

- [ ] `function buildCaptions(assPath)` → `[]` se `!assPath`; senão `[ subtitles filter ]`. **Importar `subFilter` de `./captions`** em vez de construir a string aqui — a função já resolve escape e `original_size`.

  Se importar `./captions` criar ciclo de require com algum módulo, **não** duplicar a lógica: reporte no `## Status` e devolva ao Orquestrador.

- [ ] `function describe({ lut, dither, zscale, captions })` → objeto para a UI:

```js
{
  lut: lut ? <basename> : null,
  interp: lut ? LUT_INTERP : null,
  route: zscale ? 'zscale (float RGB)' : 'swscale (8-bit)',
  dither: <modo efetivo, ou 'none'>,
  ditherKind: zscale ? 'RPDF (zimg random)' : 'RPDF aproximado (noise t+u, 1 LSB)',
  captions: !!captions,
  precisionNote: zscale ? null : 'LUT aplicada em 8-bit — instale ffmpeg com libzimg para precisão float',
}
```

- [ ] Validar `dither` contra `DITHER_MODES`; valor fora da lista → cai para `'random'` e nada de exceção.

- [ ] `module.exports = { buildGrade, buildCaptions, describe, DITHER_MODES, LUT_INTERP };`

**Aceite:**

- [ ] `node -e "const c=require('./lib/color');console.log(JSON.stringify(c.buildGrade({lut:'/x/y.cube',zscale:true})))"` imprime array de 5 elementos, contendo `gbrpf32le`, `interp=tetrahedral` e `d=random`.
- [ ] `node -e "const c=require('./lib/color');console.log(JSON.stringify(c.buildGrade({lut:'/x/y.cube',zscale:false})))"` imprime array de 3 elementos, o último sendo `noise=alls=1:allf=t+u`.
- [ ] `node -e "const c=require('./lib/color');console.log(c.buildGrade({lut:null,zscale:true}).length)"` imprime `0`.
- [ ] `node -e "const c=require('./lib/color');console.log(JSON.stringify(c.buildGrade({lut:'/x/y.cube',dither:'lixo',zscale:true})[3]))"` contém `d=random` (fallback silencioso, sem lançar).
- [ ] Path com dois-pontos escapa: `node -e "const c=require('./lib/color');console.log(c.buildGrade({lut:'C:\\\\luts\\\\a.cube',zscale:false})[1])"` imprime `lut3d='C\:/luts/a.cube':interp=tetrahedral`.

---

## Task 2 — Sondar `zscale` em `lib/deps.js`

- [ ] Adicionar `async function hasZscale()` seguindo **exatamente** o padrão de `hasLibvmaf` (que a Fase 1 criou em `lib/vmaf.js`): `execFile('ffmpeg', ['-hide_banner','-filters'])`, timeout 8000, `maxBuffer: 8 * 1024 * 1024`, procura a string `zscale` no stdout, qualquer erro → `false`, nunca rejeita.

  Colocar em `lib/deps.js` mesmo (não em `color.js`, que é puro por contrato).

- [ ] Adicionar ao `Promise.all` de `detect()` — **nova posição no fim do array desestruturado**, sem reordenar as existentes.

- [ ] Nova chave no retorno, logo depois de `libvmaf`:

```js
zscale: {
  ok: zscaleOk,
  note: 'precisão float na LUT 3D + dither RPDF nativo no Export',
  install: 'ffmpeg compilado com --enable-libzimg (BtbN/FFmpeg-Builds, brew install ffmpeg)',
},
```

- [ ] Exportar `hasZscale` junto de `detect`: `module.exports = { detect, hasZscale };`

**Aceite:**
- [ ] `node -e "require('./lib/deps').detect().then(d=>console.log(JSON.stringify(d.zscale)))"` imprime objeto com `ok` booleano.
- [ ] `node -e "require('./lib/deps').hasZscale().then(r=>console.log(typeof r))"` imprime `boolean`.
- [ ] `node clipper/check-deps.js` roda sem lançar.

---

## Task 3 — `lib/captions.js`: duração e resolução de autoria

- [ ] Adicionar `function assDuration(words)` → `end` da última palavra (`0` se array vazio). Usada pelo Export para checar dessincronia.

- [ ] Garantir que o header do `.ass` gerado por `writeAss` declare explicitamente:

```
PlayResX: 1080
PlayResY: 1920
```

  Se já estiver lá, não duplicar — só confirmar por inspeção. Isso importa porque a legenda deixa de ser queimada na mesma etapa que a mediu: se o `.ass` não declara resolução de autoria, o libass escala pela resolução do frame e o corpo do texto muda de tamanho entre Assemble e Export.

- [ ] `module.exports = { writeAss, subFilter, assDuration };`

**Aceite:**
- [ ] `node -e "const c=require('./lib/captions');console.log(c.assDuration([{start:0,end:1.5},{start:1.5,end:3.25}]), c.assDuration([]))"` imprime `3.25 0`.
- [ ] `grep -n "PlayResX\|PlayResY" lib/captions.js` retorna as duas linhas com `1080` e `1920`.

---

## Task 4 — `lib/assemble.js`: entregar o `.ass`, não queimá-lo

- [ ] Adicionar `burnCaptions = false` aos parâmetros de `assemble({...})`. Manter `captions = true` com o significado atual — "transcrever e gerar o `.ass`". Os dois são independentes: `captions` decide se **gera**, `burnCaptions` decide se **queima aqui**.

- [ ] No bloco de captions, guardar o path do `.ass` em uma variável (`assPath`), e só empurrar `subFilter(...)` no `vf` **se `burnCaptions === true`**:

```js
if (words.length) {
  assPath = writeAss(words, workDir, { style: captionStyle });
  if (burnCaptions) vf.push(subFilter(assPath));
}
```

- [ ] Manter a escrita de `transcript.json` no `workDir` como está.

- [ ] Adicionar ao retorno, sem remover nada:

```js
return {
  output, duration: vInfo.duration,
  captionedWords: words ? words.length : 0,
  ass: assPath ? path.relative(process.cwd(), assPath) : null,
  assDuration: words ? assDuration(words) : 0,
  burned: burnCaptions,
};
```

  O `ass` sai como path **relativo à raiz do projeto**, no mesmo formato que `server.js` já usa para `output` (`path.relative(ROOT, ...)`) — isso é o que permite ele passar por `resolveInput()` no Export sem furar a fronteira de path safety.

- [ ] Atualizar o header de comentário: o mezzanine agora carrega vídeo + voz, e a legenda viaja **ao lado**, em `.ass`, para ser queimada no Export depois da grade.

**Aceite:**
- [ ] `grep -n "burnCaptions" lib/assemble.js` retorna a linha do parâmetro (default `false`) e a do `if`.
- [ ] Rodar assemble via API e conferir que `output/../jobs/<id>/` contém um `.ass`, e que o JSON do job traz `ass` não-nulo e `burned: false`.
- [ ] `ffprobe` no mezzanine continua `yuv444p,1080,1920` (Fase 1 não regrediu).
- [ ] Inspeção visual do mezzanine: **sem legenda queimada**.
- [ ] Com `burnCaptions: true` no corpo do POST, o mezzanine volta a ter legenda — retrocompatibilidade preservada.

---

## Task 5 — `lib/encode.js`: nova ordem do `vf`

- [ ] Importar `buildGrade`, `buildCaptions`, `describe` de `./color` e `assDuration` de `./captions` (só se for usar; senão dispensar).

- [ ] `buildArgs(input, output, profile, opts)` — novos campos em `opts`, todos opcionais:
  - `captions = null` — path absoluto do `.ass`
  - `grade = 'plate'` — `'plate'` aplica a LUT; `'none'` **ignora a LUT mesmo se `lut` vier preenchido**
  - `dither = 'random'`
  - `zscale = false` — resultado da sonda, injetado por `encodeReel`

- [ ] Reescrever a montagem do `vf` **nesta ordem exata**, substituindo a atual:

```js
const vf = [];
if (denoise) vf.push(denoise);                                  // 1
const scaleRange = fullRangeSource ? ':in_range=full:out_range=limited' : '';
vf.push(buildFit(fit, `:flags=lanczos${scaleRange}`));          // 2
vf.push('fps=30');                                              // 3
const gradeLut = grade === 'none' ? null : lut;
vf.push(...buildGrade({ lut: gradeLut, dither, zscale }));      // 4 + 5
vf.push(...buildCaptions(captions));                            // 6
vf.push('format=yuv420p');                                      // 7
```

  **Remover** o bloco `if (lut) { ... vf.push(\`lut3d='${esc}'\`) }` que existe hoje — a LUT agora é responsabilidade exclusiva de `buildGrade`. Não deixar as duas coisas coexistindo.

- [ ] Manter `-pix_fmt yuv420p` nos args de saída. Ele é redundante com o `format=yuv420p` no fim do `vf`, e essa redundância é **intencional**: o `-pix_fmt` é a garantia que o `validate()` da Fase 1 checa, e um erro no filtergraph não pode silenciosamente produzir outro formato.

- [ ] Em `encodeReel`, antes de chamar `buildArgs`: resolver a sonda uma vez e logar a rota escolhida.

```js
const zscale = await hasZscale();
if (lut && !zscale) onLog && onLog('[color] zscale ausente — LUT em 8-bit, dither por noise t+u\n');
```

- [ ] Em `encodeReel`, **passar `refFilter` ao VMAF** — este é o item que impede a Fase 2 de quebrar a Fase 1. O `refFilter` é o mesmo `vf` do output **sem** o `denoise` e **sem** o `fps`, porque o branch de referência do filtergraph do libvmaf já recebe `settb`/`setpts` e a referência é o próprio mezzanine, já na cadência certa:

```js
const refFilter = [
  buildFit(fit, `:flags=lanczos${info.colorRange === 'pc' ? ':in_range=full:out_range=limited' : ''}`),
  ...buildGrade({ lut: grade === 'none' ? null : lut, dither, zscale }),
  ...buildCaptions(captions),
  'format=yuv420p',
].join(',');

vmaf = await measure(output, ref, { target: profile.vmafTarget, refFilter, onLog });
```

- [ ] Adicionar `color: describe({ lut: grade === 'none' ? null : lut, dither, zscale, captions })` ao objeto retornado por `encodeReel`, ao lado de `profile`, `risk`, `validation`, `vmaf`.

**Aceite:**
- [ ] `node -e "const e=require('./lib/encode');const a=e.buildArgs('i.mp4','o.mp4',e.selectProfile(20),{lut:'/l.cube',captions:'/c.ass',zscale:true});const vf=a[a.indexOf('-vf')+1];console.log(vf)"` — a ordem impressa é: fit, `fps=30`, cadeia zscale/lut3d/dither, `subtitles`, `format=yuv420p`. Nenhum `lut3d` antes do `fps=30`.
- [ ] Mesmo comando com `{grade:'none', lut:'/l.cube'}` → o `vf` **não contém** `lut3d`.
- [ ] `grep -c "lut3d" lib/encode.js` retorna `0` — a construção do filtro migrou inteira para `lib/color.js`.
- [ ] `grep -n "refFilter" lib/encode.js` retorna a construção e a passagem para `measure`.

---

## Task 6 — `lib/vmaf.js`: aplicar `refFilter` no branch da referência

- [ ] Aceitar `refFilter = null` nas options de `measure(distorted, reference, opts)`.

- [ ] Injetar no branch `[1:v]` do filtergraph, **depois** do `settb`/`setpts` e **antes** do label `[ref]`:

```js
const refChain = refFilter ? `,${refFilter}` : '';
const filter =
  '[0:v]settb=AVTB,setpts=PTS-STARTPTS[dist];' +
  `[1:v]settb=AVTB,setpts=PTS-STARTPTS${refChain}[ref];` +
  `[dist][ref]libvmaf=model='version=${VMAF_MODEL}'` +
  `:n_threads=${threads}:log_fmt=json:log_path='${escPath(logPath)}'`;
```

- [ ] A checagem de geometria da Fase 1 (`width`/`height` divergentes → `skipped`) precisa ser **relaxada quando `refFilter` está presente**, porque o filtro é justamente o que traz a referência para 1080×1920. Nova regra: se `refFilter` for informado, **não** comparar geometria — o filtergraph resolve. Se for `null`, mantém a checagem estrita de hoje.

- [ ] Adicionar `refFiltered: !!refFilter` ao objeto de retorno, para a UI poder dizer o que foi medido.

- [ ] Atualizar o header de comentário: a métrica compara output vs. referência **com as mesmas transformações criativas aplicadas**, isolando dano de compressão; sem isso, LUT e legenda entrariam na conta como distorção.

**Aceite:**
- [ ] `grep -n "refFilter\|refFiltered" lib/vmaf.js` retorna as ocorrências nas options, no filtergraph, na regra de geometria e no retorno.
- [ ] Export de um mezzanine **com** LUT e legenda produz `vmaf.skipped === false` e `vmaf.harmonicMean` na faixa esperada do perfil (≥ 90). Se a nota vier abaixo de ~70, o `refFilter` não está sendo aplicado — investigar antes de seguir.
- [ ] Export **sem** LUT e **sem** legenda continua produzindo nota comparável à da Fase 1 (regressão zero no caminho simples).

---

## Task 7 — `server.js`: repassar `.ass`, `grade` e `dither`

- [ ] `/api/assemble`: incluir `ass` no retorno já normalizado para path relativo à raiz, no mesmo estilo do `output`:

```js
return { ...r, output: path.relative(ROOT, r.output),
         ass: r.ass ? path.relative(ROOT, path.resolve(r.ass)) : null };
```

  Aceitar `burnCaptions: b.burnCaptions === true` no corpo (default `false`) e repassar a `assemble()`.

- [ ] `/api/export`: aceitar e repassar três campos novos:

```js
captions: b.captions ? resolveInput(b.captions) : null,
grade: b.grade === 'none' ? 'none' : 'plate',
dither: typeof b.dither === 'string' ? b.dither : 'random',
```

  O `captions` **precisa** passar por `resolveInput()`. É um path vindo do cliente que vai direto para um filtergraph do ffmpeg — sem isso a fronteira de path safety descrita no `CLAUDE.md` fica furada. O `grade` e o `dither` são normalizados aqui e não confiam no cliente.

**Aceite:**
- [ ] `grep -n "resolveInput(b.captions)" server.js` retorna a linha dentro do bloco `/api/export`.
- [ ] `grep -n "burnCaptions" server.js` retorna a linha dentro do bloco `/api/assemble`.
- [ ] `POST /api/export` com `captions: "../../etc/passwd"` é **rejeitado** por `resolveInput` — não chega ao ffmpeg.

---

## Task 8 — `public/index.html`: carregar o `.ass` e expor GRADE/DITHER

- [ ] Em `doAssemble()` (~linha 668), guardar o `.ass` retornado numa variável de módulo (`let lastAss = null;` no escopo do script) e exibir um chip a mais:

```js
lastAss = r.ass || null;
// no innerHTML existente, acrescentar:
(r.ass ? `<span class="chip ok">.ass pronto — queima no Export</span>` : '')
```

- [ ] No painel de Export, adicionar dois selects ao lado do `#exp-fit` existente, seguindo a marcação dos controles vizinhos:

```html
<select id="exp-grade">
  <option value="plate">GRADE: plate (aplica LUT)</option>
  <option value="none">GRADE: none (só gráficos, sem LUT)</option>
</select>
<select id="exp-dither">
  <option value="random">DITHER: RPDF (random)</option>
  <option value="error_diffusion">DITHER: error diffusion</option>
  <option value="none">DITHER: none</option>
</select>
```

- [ ] Em `doExport()`, incluir os três campos no POST:

```js
captions: lastAss, grade: $('#exp-grade').value, dither: $('#exp-dither').value,
```

- [ ] Inserir um card `COLOR` no resultado, **antes** do card `VMAF` que a Fase 1 criou:

```js
`<div class="card"><h3>COLOR PIPELINE</h3>` +
 `<span class="chip ${r.color.lut ? 'ok' : ''}">${r.color.lut ? 'LUT ' + r.color.lut : 'sem LUT'}</span>` +
 (r.color.interp ? `<span class="chip">interp ${r.color.interp}</span>` : '') +
 `<span class="chip">${r.color.route}</span>` +
 `<span class="chip ${r.color.dither === 'none' ? 'wn' : 'ok'}">${r.color.ditherKind}</span>` +
 `<span class="chip ${r.color.captions ? 'ok' : ''}">${r.color.captions ? 'legenda pós-LUT' : 'sem legenda'}</span>` +
 (r.color.precisionNote ? `<span class="chip wn">${r.color.precisionNote}</span>` : '') +
 `</div>`
```

- [ ] No card VMAF (Fase 1), acrescentar um chip quando `r.vmaf.refFiltered` for `true`: `<span class="chip">referência com grade+legenda</span>`. Sem isso a nota fica sem contexto e alguém vai comparar duas medições incomparáveis.

- [ ] Em `refreshDeps()`, adicionar o chip do zscale depois do de libvmaf:

```js
chip('zscale', d.zscale.ok, d.zscale.install) +
```

**Aceite:**
- [ ] `grep -n "exp-grade\|exp-dither\|lastAss" public/index.html` retorna as ocorrências no HTML e no `doExport`.
- [ ] Após restart: Assemble → chip `.ass pronto`; Export → card COLOR mostrando LUT, rota e tipo de dither.
- [ ] Em ffmpeg **sem** libzimg, o card COLOR mostra `swscale (8-bit)` e o chip amarelo de `precisionNote`, e **o encode conclui APROVADO**.

---

## Task 9 — Smoke test empírico do dither (obrigatório)

As strings de filtro deste plano foram escritas contra a documentação, não contra o binário do usuário. Nomes de opção do `zscale` variam entre builds. **O Executor precisa provar que o chain roda antes de declarar as tasks 1 e 5 concluídas** — e, se não rodar, reportar o erro exato no `## Status` em vez de improvisar uma variante.

- [ ] Provar que a cadeia zscale é aceita pelo ffmpeg instalado. Usar uma `.cube` identidade gerada na hora para não depender de asset:

```bash
printf 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n' > /tmp/identity.cube
node -e "console.log(require('./lib/color').buildGrade({lut:'/tmp/identity.cube',zscale:true}).join(','))" > /tmp/chain.txt
ffmpeg -hide_banner -y -f lavfi -i "gradients=s=1080x1920:c0=0x101010:c1=0x303030:speed=0:d=2:r=30" \
  -vf "$(cat /tmp/chain.txt),format=yuv420p" -c:v ffv1 /tmp/dither.mkv
echo "exit=$?"
```

  `exit=0` obrigatório. Erro de opção desconhecida → **não adivinhar**: registrar a mensagem no `## Status`.

- [ ] Provar que o dither **existe de fato**, e não só que a string foi aceita. Sobre gradiente estático, dither temporal faz frames consecutivos diferirem; sem dither eles são idênticos:

```bash
# com dither
ffmpeg -hide_banner -i /tmp/dither.mkv -vf tblend=all_mode=difference,signalstats \
  -metadata -f null - 2>&1 | grep -o "YMAX:[0-9]*" | sort -u | tail -3
# controle: mesmo gradiente, dither=none
node -e "console.log(require('./lib/color').buildGrade({lut:'/tmp/identity.cube',dither:'none',zscale:true}).join(','))" > /tmp/chain0.txt
ffmpeg -hide_banner -y -f lavfi -i "gradients=s=1080x1920:c0=0x101010:c1=0x303030:speed=0:d=2:r=30" \
  -vf "$(cat /tmp/chain0.txt),format=yuv420p" -c:v ffv1 /tmp/nodither.mkv
ffmpeg -hide_banner -i /tmp/nodither.mkv -vf tblend=all_mode=difference,signalstats \
  -metadata -f null - 2>&1 | grep -o "YMAX:[0-9]*" | sort -u | tail -3
```

  Critério: `YMAX > 0` no arquivo **com** dither, `YMAX == 0` no **sem**. Registrar os dois números no `## Status`.

- [ ] Repetir o primeiro comando para a rota swscale (`zscale:false`) e confirmar `exit=0`.

- [ ] Limpar `/tmp/identity.cube`, `/tmp/chain*.txt`, `/tmp/*dither.mkv` ao final.

**Aceite:**
- [ ] As três invocações de ffmpeg retornam `exit=0`.
- [ ] Os dois valores de `YMAX` estão registrados no `## Status` e satisfazem `com_dither > 0 == sem_dither`.

---

## Task 10 — Documentação

- [ ] `CLAUDE.md`, seção "The pipeline": adicionar bullet de `lib/color.js` — monta o segmento grade+dither do filtergraph, puro sem I/O, duas rotas por sonda (zscale float / swscale 8-bit), `interp=tetrahedral` pinado, RPDF obrigatório antes de qualquer quantização.
- [ ] `CLAUDE.md`: reescrever o bullet de `lib/assemble.js` — deixa de queimar legenda por default, produz o `.ass` e o entrega no retorno; `burnCaptions: true` restaura o comportamento antigo.
- [ ] `CLAUDE.md`: no bullet de `lib/encode.js`, registrar a **ordem canônica do `vf`** (os 7 passos) como fonte de verdade, com a nota de que `subtitles`/libass é 8-bit-only e por isso vem obrigatoriamente depois do dither.
- [ ] `CLAUDE.md`: no bullet de `lib/vmaf.js`, registrar o `refFilter` e **por que ele não é opcional** — sem ele a LUT e a legenda entram na medição como distorção.
- [ ] `CLAUDE.md`, tabela de engines: adicionar `zscale` / "float-precision LUT + RPDF dither in Export" / `lib/color.js`.
- [ ] `README.md`, passo 4 do pipeline: a legenda deixa de ser queimada aqui; o mezzanine carrega vídeo + voz e o `.ass` viaja ao lado.
- [ ] `README.md`, passo 6: o Export aplica LUT em precisão float, dither RPDF, e **só então** queima a legenda — motivo em uma linha (a LUT não deve gradar gráfico).
- [ ] `README.md`, tabela de engines: acrescentar `zscale` com a nota de que builds sem `libzimg` perdem precisão e dither nativo, não o encode.

**Aceite:**

- [ ] `grep -n "color.js\|zscale\|refFilter" CLAUDE.md` retorna as linhas novas.
- [ ] `grep -n "zscale\|RPDF" README.md` retorna as linhas novas.
- [ ] `grep -n "burnCaptions" CLAUDE.md` retorna a linha do comportamento retrocompatível.

---

## Critérios de aceite globais (rodar depois de todas as tasks)

- [ ] `node -e "['./lib/color','./lib/encode','./lib/assemble','./lib/vmaf','./lib/captions','./lib/deps'].forEach(m=>require(m));console.log('ok')"` imprime `ok` — nenhum ciclo de require entre `color ↔ captions ↔ encode`.
- [ ] `node clipper/check-deps.js` roda sem lançar.
- [ ] Encadeamento completo (Orquestrador reinicia o servidor): Remotion/footage → Assemble → Export produz `output/reel-<id>.mp4` com `validation.passed === true` **e** `vmaf.skipped === false`.
- [ ] Inspeção visual do output: a legenda está **branca de verdade** (não creme) mesmo com a LUT Hollywood aplicada, e o `#FFB800` dos gráficos não deslocou de matiz.
- [ ] `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,color_primaries,color_transfer,color_space -of csv=p=0` no output → `yuv420p,bt709,bt709,bt709`.
- [ ] Contagem de subamostragens de croma no caminho: **uma** (o `format=yuv420p` final do Export). O mezzanine segue `yuv444p`.
- [ ] Regressão zero na Fase 1: exportar sem LUT e sem legenda dá nota VMAF comparável à medida antes desta fase.
- [ ] `git status --short` lista exatamente **10** arquivos criados/modificados e nada mais. **Nenhum commit.**

---

## Fora de escopo (não implementar aqui)

- **Composição plate + gráficos Remotion no Export.** Esta fase resolve a camada de legenda por completo, e resolve gráfico-puro pela flag `grade: 'none'`. O caso misto — footage gradado **com** overlay Remotion não-gradado por cima — exige o Export receber dois inputs e compor, o que muda a assinatura de `encodeReel` e a rota `/api/export`. Vira **Fase 2b**, plano próprio.
- **Derivação adaptativa** (`selectProfile` olha só duração; `riskScore` não altera decisão nenhuma) e port do `derive_zones()` — **Fase 3**.
- **`llmMoments` pedindo segundos em float** em vez de índice de segmento (`lib/clipper.js:130`) — **Fase 4**.
- **Escolha automática de dither por conteúdo** (gradiente chapado pede `error_diffusion`, movimento pede `random`). Depende da análise adaptativa da Fase 3 — por ora é escolha manual no select.
- **Áudio 44.1 kHz** forçando resample de fontes 48k, e `min-keyint=1` queimando bits em corte rápido — dívida menor, sem plano ainda.

---

## Status

*(seção de propriedade exclusiva do Executor — o Orquestrador não escreve aqui)*

### Execução — 2026-08-02

Todas as 10 tasks foram implementadas exatamente como especificado no plano (nenhum arquivo fora da lista, nenhum reorder dos 7 passos do `vf`, `lib/color.js` puro — zero `child_process`/`fs`). **Porém a Task 9 (smoke test empírico) encontrou dois defeitos reais e reprodutíveis nas strings de filtro literais do plano, neste ambiente (ffmpeg 7.1.1-full_build-www.gyan.dev, Windows, `--enable-libzimg` presente).** Por instrução explícita ("não inventar uma variante, reportar o erro exato"), **não alterei as constantes/strings de filtro em `lib/color.js`** — o código está fiel ao texto do plano. Detalho os dois achados abaixo para a decisão do Orquestrador.

**Tasks 1–8 e 10 — status por task:**

- **Task 1 (`lib/color.js`)** — criado. Todos os 5 critérios de aceite do plano passaram via `node -e` (rodado com script `Write`-gerado para evitar mangling de backslash do Bash tool neste Windows): array de 5 elementos com `gbrpf32le`/`interp=tetrahedral`/`d=random` na rota zscale; array de 3 elementos terminando em `noise=alls=1:allf=t+u` na rota swscale; `lut:null` → `[]`; dither inválido → fallback silencioso pra `random`; escape de path com dois-pontos correto (`lut3d='C\:/luts/a.cube':interp=tetrahedral`). **Código conforme o plano — mas ver defeito #2 abaixo (NOISE_LSB) achado na Task 9.**
- **Task 2 (`lib/deps.js` — sonda zscale)** — `hasZscale()` adicionado seguindo exatamente o padrão de `hasLibvmaf`; `zscale: {ok:true,...}` no `detect()` (neste ambiente `ok:true`, ffmpeg tem libzimg); `hasZscale` exportado. `node clipper/check-deps.js` roda sem lançar. Todos os aceites passaram.
- **Task 3 (`lib/captions.js`)** — `assDuration()` adicionado e exportado; `PlayResX: 1080` / `PlayResY: 1920` já existiam no header do `.ass` gerado por `writeAss` (confirmado por `grep`, não duplicado). `assDuration([{start:0,end:1.5},{start:1.5,end:3.25}])` → `3.25`, `assDuration([])` → `0`. Aceites OK.
- **Task 4 (`lib/assemble.js`)** — `burnCaptions = false` (default), `.ass` sempre gerado quando `captions=true` e há palavras, só é queimado no `vf` se `burnCaptions===true`. Retorno inclui `ass`, `assDuration`, `burned`. Testado **rodando `assemble()` de verdade** (não via API/servidor — instrução explícita de não subir o servidor) contra `clip-01.mp4` (arquivo pré-existente untracked na raiz do repo, não criado por mim, usado só como fixture e depois limpo de `jobs/`): com `burnCaptions:false` → `ass` não-nulo, `burned:false`, mezzanine `yuv444p,1080,1920` inalterado, frame extraído confirma **nenhuma legenda nova queimada** (o texto visível no frame já vinha embutido no arquivo-fonte de um job anterior). Com `burnCaptions:true` → `burned:true`, frame extraído mostra uma **segunda camada de legenda sobreposta** à do arquivo-fonte, confirmando que o `subFilter` volta a ser aplicado — retrocompatibilidade OK. Diretórios de teste (`jobs/test-color-task4*`) removidos ao final.
- **Task 5 (`lib/encode.js`)** — nova ordem canônica do `vf` implementada exatamente como no plano (comentário no código enumera os 7 passos). `grep -c "lut3d" lib/encode.js` → `0` (tive que reescrever um comentário que citava `lut3d` literalmente pra não falsear esse grep — mantive o comentário, só troquei a palavra por "3D LUT"). `grep -n "refFilter"` retorna a construção do `refFilter` em `encodeReel` e a passagem pra `measure()`. Teste via `node -e`: `buildArgs(...)` com LUT+captions+zscale:true produz `vf` na ordem fit → `fps=30` → cadeia zscale/lut3d/dither → `subtitles` → `format=yuv420p`; com `{grade:'none', lut:...}` o `vf` não contém `lut3d`. **Código conforme o plano — mas ver defeito #1 abaixo (`m=rgb`), que faz a rota zscale (a rota default quando `hasZscale()` retorna `true`, como é o caso deste ambiente) falhar de verdade no ffmpeg quando uma LUT é passada.**
- **Task 6 (`lib/vmaf.js`)** — `refFilter` aceito em `measure()`, injetado no branch `[1:v]` antes do label `[ref]`; checagem de geometria relaxada quando `refFilter` está presente; `refFiltered: !!refFilter` no retorno. `grep -n "refFilter\|refFiltered"` retorna as 5 ocorrências esperadas (options, comentário de doc, regra de geometria, filtergraph, retorno). **Não testei fim-a-fim contra um encode real** (exigiria rodar `encodeReel` completo, que por sua vez tropeça no defeito #1 se uma LUT for passada — sem LUT o caminho todo roda limpo, ver Task 9). Fica pendente de validação em pipeline completo pelo Orquestrador.
- **Task 7 (`server.js`)** — `/api/assemble` repassa `burnCaptions` e devolve `ass` relativo à raiz; `/api/export` aceita `captions`/`grade`/`dither`, com `captions` passando por `resolveInput()` (linha confirmada por grep). Não testei o caso `captions: "../../etc/passwd"` via HTTP real (exigiria subir o servidor); a função `resolveInput()` em si não foi alterada por mim — só passei a chamá-la para um novo campo, seguindo o mesmo padrão já usado por `lut`/`voiceover`/`reference` nesse mesmo arquivo. **Nota operacional:** ao rodar `grep`/testes nesta task eu acidentalmente disparei `node server.js` em background por engano (comando de teste mal formado) — percebi imediatamente, matei o processo (`taskkill /F`) e confirmei a porta 4870 livre de novo antes de continuar. Nenhuma outra ação foi tomada nesse processo além de start+kill imediato.
- **Task 8 (`public/index.html`)** — `lastAss` no escopo do módulo, atualizado em `doAssemble()`, chip `.ass pronto` condicional; selects `#exp-grade`/`#exp-dither` adicionados; `doExport()` envia `captions`/`grade`/`dither`; card COLOR inserido antes do card VMAF; chip "referência com grade+legenda" no card VMAF quando `refFiltered`; chip `zscale` em `#engines`, logo depois do `libvmaf`. `grep -n "exp-grade|exp-dither|lastAss"` retorna as ocorrências esperadas. **Não verificado visualmente no browser** — exige o servidor rodando, que é responsabilidade do Orquestrador pós-handoff.
- **Task 9 (smoke test empírico) — DOIS DEFEITOS REAIS ENCONTRADOS, detalhados abaixo.**
- **Task 10 (documentação)** — `CLAUDE.md` e `README.md` atualizados: bullet de `lib/color.js`, bullet de `lib/assemble.js` reescrito (burnCaptions), ordem canônica do `vf` documentada no bullet de `lib/encode.js`, `refFilter`/motivo no bullet de `lib/vmaf.js`, linha `zscale` na tabela de engines de ambos os arquivos, passos 4 e 6 do pipeline atualizados no README. Todos os greps de aceite (`color.js\|zscale\|refFilter` em CLAUDE.md, `zscale\|RPDF` em README.md, `burnCaptions` em CLAUDE.md) retornaram as linhas esperadas.

### Task 9 — achados (bloqueantes para declarar Tasks 1 e 5 empiricamente validadas)

Ambiente: `ffmpeg version 7.1.1-full_build-www.gyan.dev`, build com `--enable-libzimg` e `--enable-libvmaf` (confirmado por `ffmpeg -version` e pela sonda `hasZscale()` retornando `true`).

**Defeito #1 — rota zscale: `m=rgb` é rejeitado por este build.**

Rodei a cadeia exata que `buildGrade({lut, zscale:true})` produz (LUT identidade gerada na hora, gradiente estático 1080×1920, `ffv1` lossless) contra o ffmpeg deste ambiente:

```
zscale=min=bt709:tin=bt709:pin=bt709:rin=limited:m=rgb:t=bt709:p=bt709:r=full:f=lanczos:d=none,format=gbrpf32le,lut3d='...':interp=tetrahedral,zscale=m=bt709:t=bt709:p=bt709:r=limited:f=lanczos:d=random,format=yuv444p,format=yuv420p
```

Resultado: **falha, não `exit=0`**. stderr exato:

```
[Parsed_zscale_0] [Eval] Undefined constant or missing '(' in 'rgb'
[Parsed_zscale_0] Unable to parse option value "rgb"
Error applying option 'm' to filter 'zscale': Invalid argument
Error opening output file dither.mkv.
Error opening output files: Invalid argument
```

Reproduzido igualmente com `dither:'none'` (mesmo erro — não é dependente do dither). `ffmpeg -hide_banner -h filter=zscale` neste build lista os valores aceitos do parâmetro `m` (matrix): `input, 709, unspecified, 470bg, 170m, 2020_ncl, 2020_cl, unknown, gbr, bt709, fcc, bt470bg, smpte170m, smpte240m, ycgco, bt2020nc, bt2020c, chroma-derived-nc, chroma-derived-c, ictcp` — **`rgb` não é um valor válido nesta lista; `gbr` (valor 0) é o equivalente semântico** ("matrix GBR" = identidade/RGB, é o que o filtro usa pra sinalizar "sem matriz, é RGB puro"). Troquei `m=rgb` por `m=gbr` **apenas como diagnóstico isolado, fora do repositório** (script de teste no scratchpad) e a mesma cadeia completa rodou com `exit=0`. **Não apliquei essa troca em `lib/color.js`** — o arquivo do repo continua exatamente como o plano especifica (`m=rgb`), por instrução explícita de não inventar variante e reportar.

Rota swscale (`zscale:false`) rodou com `exit=0` sem alterações, conforme pedido no plano (Task 9, item 3).

**Defeito #2 — rota swscale: `NOISE_LSB = 1` (→ `noise=alls=1:allf=t+u`) não produz efeito mensurável neste build.**

Ao tentar provar a existência do dither via `tblend=all_mode=difference,signalstats` (nota: o comando literal do plano usa `-metadata` como flag solta antes de `-f null -`, que é uma opção de metadata do muxer, não imprime nada — tive que trocar por `,metadata=print` como filtro extra na cadeia pra efetivamente imprimir os valores `lavfi.signalstats.*` no stderr; isso é só um ajuste de comando de teste, não afeta `lib/color.js`), obtive `YMAX=0` em **todos os 59 frames de diff**, tanto no arquivo **com** dither (`chain_sw.txt`, `NOISE_LSB=1`) quanto no controle **sem** dither (`dither:'none'`) — os dois exit=0, mas ambos sem diferença temporal detectável.

Isolando o filtro `noise` sozinho (sem LUT/format round-trip, só `format=yuv420p,noise=alls=1:allf=t+u` sobre o gradiente estático) e comparando hash SHA256 por frame (`ffmpeg -f framehash`): com `alls=1` os **60 frames são byte-idênticos** (1 hash único); com `alls=2` os 60 frames **todos diferem** (60 hashes únicos). `ffmpeg -hide_banner -h filter=noise` documenta `alls`/`all_strength` como "**set component #0 strength (from 0 to 100)**" — ou seja, é uma escala de intensidade/probabilidade 0–100, não um valor literal de amplitude em LSBs de 8-bit como o comentário do plano assume (`NOISE_LSB = 1; // amplitude do dither de fallback, em LSB de 8-bit`). Neste build, `alls=1` está abaixo do limiar que produz qualquer alteração de pixel detectável.

**Não alterei `NOISE_LSB` em `lib/color.js`** — mesmo motivo do defeito #1.

**Resumo do bloqueio:** o critério de aceite global da Task 9 ("as três invocações de ffmpeg retornam `exit=0`" **e** "`YMAX` com dither > 0 == sem dither") **não é satisfeito neste ambiente pelas constantes literais do plano** — rota zscale nem roda (`m=rgb` inválido), rota swscale roda mas o dither de `alls=1` é indetectável. Ambos os achados são deterministicamente reproduzíveis e documentados acima com o comando exato e a saída exata. Devolvo ao Orquestrador a decisão de como corrigir (`m=gbr` e um `NOISE_LSB` mais alto — ou outra abordagem — são só diagnósticos que levantei, não uma correção que apliquei). Até essa decisão, considero **Tasks 1 e 5 implementadas conforme o texto do plano e com os aceites de string/unidade passando, mas não validadas empiricamente em produção** por este bloqueio.

### Verificações globais já possíveis sem servidor

- `node -e "[...].forEach(m=>require(m));console.log('ok')"` → `ok` (sem ciclo de require entre `color ↔ captions ↔ encode ↔ deps ↔ vmaf`).
- `node clipper/check-deps.js` → roda sem lançar.
- `git status --short` → exatamente os 10 arquivos do plano modificados/criados (`lib/color.js` novo; `lib/deps.js`, `lib/captions.js`, `lib/assemble.js`, `lib/encode.js`, `lib/vmaf.js`, `server.js`, `public/index.html`, `CLAUDE.md`, `README.md` modificados) + os untracked pré-existentes que não toquei (`Highend_cinematic_commercial.mov`, `clip-01.mp4`, o próprio `docs/plans/color-pipeline-order-and-dither.md`). Nenhum commit feito.

### Correção aplicada pelo Orquestrador — 2026-08-02

Apliquei os dois ajustes em `lib/color.js` que o Executor diagnosticou mas não aplicou (por instrução de não inventar variante):

1. **`m=rgb` → `m=gbr`** na primeira chamada `zscale=` (linha ~46). Reverificado: a cadeia completa da rota zscale (com LUT identidade, path Windows real `C:\Users\...\identity.cube`) roda com `exit=0` — confirmado via `ffv1` lossless output.
2. **`NOISE_LSB` 1 → 2** (com comentário atualizado documentando o achado empírico do Executor: `alls` é escala 0–100, não LSB literal). Reverificado por `framehash`/SHA256 próprio: `alls=1` → 1 hash único em 60 frames (sem efeito), `alls=2` → 60 hashes únicos (dither temporal presente), reproduzindo o resultado do Executor.

**Achado adicional durante a reverificação, registrado para clareza (não é um terceiro defeito de código):** o dither `d=random` da rota zscale **não varia frame-a-frame** sobre uma fonte estática — 60 frames idênticos tanto com `d=random` quanto `d=none` via framehash, mesmo já com `m=gbr` corrigido. Isso inicialmente pareceu um terceiro bug, mas o teste de framehash temporal (frame N vs frame N+1) é o teste errado para esse filtro: `zscale`'s dither em RGB float→YUV 8-bit só tem o que dispersar quando existe resto fracionário genuíno na quantização, e (a) um roundtrip BT.709 forward+inverse com LUT identidade cancela quase exatamente (erro de float ~1e-6, muito abaixo de 1 LSB) e (b) mesmo quando forcei resto fracionário real (LUT não-identidade, canto branco deslocado ~0.5 LSB), a diferença **espacial** entre o frame com `d=random` e o frame com `d=none` foi grande (`YMAX=105` via `blend=difference` entre os dois PNGs) — ou seja, o dither existe e atua, só não é re-semeado por frame nesta build. Conclusão: código correto, a metodologia de smoke test do plano (diff temporal) não é sensível o suficiente para a rota zscale especificamente; a rota swscale (`noise` filter, RPDF temporal de verdade) segue validada pelo método original.

**Estado final:** ambos os defeitos da Task 9 corrigidos e reverificados empiricamente pelo Orquestrador. Tasks 1 e 5 agora consideradas validadas empiricamente. Pendências 2 e 3 abaixo (teste HTTP fim-a-fim e inspeção visual no browser) seguem para depois do restart do servidor.

### Pendente para o Orquestrador

1. ~~Decidir a correção dos dois defeitos da Task 9~~ — **feito, ver acima.**
2. Reencadeamento completo com servidor rodando (Assemble → Export) pra validar os critérios de aceite globais que dependem de HTTP: `validation.passed===true` e `vmaf.skipped===false`, inspeção visual da legenda branca/`#FFB800` sem deslocar, `ffprobe` do output (`yuv420p,bt709,bt709,bt709`), regressão zero do VMAF sem LUT/legenda.
3. Validação visual do card COLOR / chips / selects no browser (Task 8) — não verificável sem o servidor.
