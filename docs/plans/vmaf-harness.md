# VMAF Harness + Correção de Perda de Geração — Implementation Plan

> **Para agentic workers:** implemente task-por-task, em ordem. Steps usam checkbox (`- [ ]`). Este projeto **não tem suíte de testes** (backend Node puro, zero-dep, sem runner) — a verificação de cada task é feita por script `node` runnable, comando `ffprobe`/`ffmpeg`, e/ou `POST /api/export`, mais inspeção. Não há `pytest`/`jest`.

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Goal:** Duas coisas, na mesma passada, porque uma valida a outra.

1. **Instrumentação (Fase 0)** — criar `lib/vmaf.js` e ligar o campo `vmafTarget` que `selectProfile()` já retorna e que hoje **nenhum módulo lê**. O Export deixa de responder só "está dentro do spec" e passa a responder "está dentro do spec **e** preservou X de qualidade perceptual".
2. **Fechar as fugas de geração (Fase 1)** — hoje um Reel que passa por Remotion → Assemble → Export sofre **três compressões lossy** antes da recompressão do Instagram. Reduzir para uma.

**Architecture:** `lib/vmaf.js` é um módulo novo, autocontido, no mesmo idioma dos outros (`'use strict'`, CommonJS, `child_process`, degradação suave). `lib/encode.js` ganha a chamada de VMAF no fim de `encodeReel()` e exporta `buildFit` para o Assemble consumir. `lib/assemble.js` para de reencodar em lossy e para de esticar. `server.js` passa a pedir ProRes ao Remotion e a repassar `sourceKind`/`reference` ao Export. `public/index.html` ganha um card VMAF. Nenhuma assinatura pública existente é quebrada — todo campo novo é aditivo.

**Tech Stack:** Node ≥18 CommonJS; `ffmpeg`/`ffprobe` via `child_process`; `libvmaf` (filtro nativo do ffmpeg, não é dependência npm); DOM vanilla no front. Zero npm no backend.

---

## Nota de decisão — modelo VMAF não-NEG

Este plano usa o modelo **`vmaf_v0.6.1`** (padrão), **não** o `vmaf_v0.6.1neg`. Isso é uma decisão deliberada do Orquestrador e o Executor **não deve trocar**.

Consequência a registrar, porque afeta a leitura dos números: o modelo padrão **não** aplica *no-enhancement-gain*, ou seja, ele pode **recompensar** ganho de nitidez e contraste introduzido pelo encode em vez de tratá-lo como desvio da referência. Na prática, no pipeline deste app:

- Comparações **A/B de rate control** (target/maxrate/bufsize, x264 params) continuam válidas e comparáveis entre si.
- Comparações onde a **LUT 3D ou o denoise mudam entre as duas rodadas** não são comparáveis — o modelo padrão pode subir a nota por causa do realce, não por causa da preservação.

Regra operacional para quem for usar a métrica: **a referência do VMAF é sempre o mezzanine que alimentou aquele encode**, nunca a fonte original bruta. Se a LUT mudou, o mezzanine mudou, e as duas notas medem coisas diferentes.

---

## Global Constraints

- **Zero dependência npm** no backend. `libvmaf` vem compilado no ffmpeg do usuário; se não vier, o app degrada (ver Task 2).
- **Degradação suave obrigatória.** VMAF ausente/falhando **nunca** pode derrubar o Export. `encodeReel()` deve retornar o encode válido com `vmaf: { available:false, ... }`.
- **Assinaturas públicas intactas:** `lib/encode.js` continua exportando `{ selectProfile, riskScore, buildArgs, buildX264Params, validate, encodeReel }` — `buildFit` é **adicionado**, nada é removido. `lib/assemble.js` continua exportando `{ assemble }`.
- **Contrato do job bus preservado:** toda função de pipeline continua aceitando `onLog`/`onStage`/`onProgress`.
- **NÃO reiniciar o servidor** e **não rodar `node server.js`** — o Orquestrador cuida do restart e da verificação no browser. Mudanças em `lib/*.js` e `server.js` exigem restart manual (sem hot-reload).
- **NÃO commitar.** Ao terminar todas as tasks, deixe as mudanças no working tree para o ciclo `git-workflow` (inspecionar → commit → push) com aprovação do usuário, conforme `CLAUDE.md`. Nenhuma task deste plano roda `git commit`.
- **Estilo:** indentação 2 espaços, `'use strict'`, aspas simples, idioma `run()`/`runFfmpeg()` existente com captura de tail de stderr para mensagem de erro.
- **Constantes nomeadas** no topo de `lib/vmaf.js`: `VMAF_MODEL`, `VMAF_TIMEOUT_MS`, `VMAF_LOW_PERCENTILE`.
- **Não tocar** em nenhum arquivo fora da lista abaixo. Não adicionar regra ao `.gitignore`.

---

## Files to create / modify

| Ação | Path | O que muda |
|:--|:--|:--|
| **Create** | `lib/vmaf.js` | Módulo novo: mede VMAF do output contra o mezzanine |
| **Modify** | `lib/encode.js` | Exporta `buildFit`; `riskScore` ganha `sourceKind`; `encodeReel` chama VMAF; comentário de Level 4.0 |
| **Modify** | `lib/assemble.js` | Mezzanine visualmente lossless; usa `buildFit` em vez de scale esticado |
| **Modify** | `lib/deps.js` | Sonda `libvmaf` no ffmpeg instalado |
| **Modify** | `server.js` | Remotion render em ProRes HQ; `/api/export` repassa `sourceKind` |
| **Modify** | `public/index.html` | Card VMAF no resultado do Export; chip `libvmaf` em ENGINES; `sourceKind` no POST |
| **Modify** | `CLAUDE.md` | Corrigir a descrição de `assemble.js` (não é mais CRF-18) e documentar `lib/vmaf.js` |
| **Modify** | `README.md` | Atualizar o passo 4 do pipeline e a tabela de engines |

---

## Task 1 — Criar `lib/vmaf.js`

- [x] Criar o arquivo com header de comentário no padrão dos outros módulos, explicando: mede VMAF do encode de entrega contra o mezzanine que o alimentou; modelo padrão (não-NEG) por decisão de projeto; degrada suave.

- [x] Constantes no topo:

```js
const VMAF_MODEL = 'vmaf_v0.6.1';   // modelo padrão — NÃO trocar para *neg (ver plano)
const VMAF_TIMEOUT_MS = 15 * 60 * 1000;
const VMAF_LOW_PERCENTILE = 1;      // p1 — o pior 1% dos frames
```

- [x] `async function hasLibvmaf()` — roda `ffmpeg -hide_banner -filters` via `execFile` (timeout 8000, `maxBuffer: 8 * 1024 * 1024`) e resolve `true` se o stdout contiver a string `libvmaf`. Qualquer erro → `false`, **nunca** rejeita.

- [x] `function escPath(p)` — mesma receita de escape que `lib/encode.js` (`buildArgs`, caminho da LUT) e `lib/captions.js` (`subFilter`) já usam, porque o filtergraph do ffmpeg quebra com backslash e com o dois-pontos da letra de drive no Windows:

```js
function escPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
```

  Não inventar outro esquema de escape. Reutilizar exatamente este.

- [x] `async function measure(distorted, reference, { target = null, onLog } = {})`, retornando **sempre** um objeto, nunca lançando:

  1. Se `!(await hasLibvmaf())` → retorna `{ available: false, reason: 'ffmpeg sem libvmaf compilado', install: 'instale um build do ffmpeg com --enable-libvmaf' }`.
  2. Se `reference` for `null`/inexistente (`fs.existsSync`) → `{ available: true, skipped: true, reason: 'sem arquivo de referência' }`.
  3. `mediaInfo()` nos dois arquivos (importar de `./ffmpeg`). Se `width`/`height` diferirem → `{ available: true, skipped: true, reason: 'geometria divergente — VMAF exige mesma resolução' }` com os dois valores no texto. **Não** escalar a referência para forçar a comparação: escalar corrompe a nota.
  4. Monta o filtergraph. `[0:v]` é o **distorted**, `[1:v]` é o **reference** — libvmaf usa o primeiro input como distorcido, a ordem importa:

```js
const logPath = path.join(os.tmpdir(), `vmaf-${Date.now()}.json`);
const threads = Math.max(1, os.cpus().length - 1);
const filter =
  '[0:v]settb=AVTB,setpts=PTS-STARTPTS[dist];' +
  '[1:v]settb=AVTB,setpts=PTS-STARTPTS[ref];' +
  `[dist][ref]libvmaf=model='version=${VMAF_MODEL}'` +
  `:n_threads=${threads}:log_fmt=json:log_path='${escPath(logPath)}'`;
```

  5. Executa via `spawn('ffmpeg', ['-hide_banner','-nostats','-i', distorted, '-i', reference, '-lavfi', filter, '-f','null','-'])`, capturando tail de stderr (últimos 4000 chars) para mensagem de erro, repassando para `onLog` se houver, com `VMAF_TIMEOUT_MS` (mata o processo e resolve `{ available:true, skipped:true, reason:'timeout' }`).
  6. Exit code ≠ 0 → `{ available: true, skipped: true, reason: 'ffmpeg exit N', detail: tail.slice(-400) }`.
  7. Lê e faz `JSON.parse` do `logPath`, depois **apaga o arquivo** (`fs.unlinkSync` dentro de `try/catch`).

- [x] Extração das métricas do JSON do libvmaf 2.x:

```js
const pooled = j.pooled_metrics?.vmaf || {};
const per = (j.frames || [])
  .map(f => f.metrics?.vmaf)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const p1 = per.length ? per[Math.floor((VMAF_LOW_PERCENTILE / 100) * (per.length - 1))] : null;
```

- [x] Retorno final (arredondar as notas para 2 casas):

```js
{
  available: true,
  skipped: false,
  model: VMAF_MODEL,
  neg: false,
  frames: per.length,
  mean: <pooled.mean>,
  harmonicMean: <pooled.harmonic_mean>,
  min: <pooled.min>,
  p1: <p1>,
  target: <target ?? null>,
  passed: <target == null ? null : harmonicMean >= target>
}
```

  **`passed` é decidido pela média harmônica, não pela aritmética.** A aritmética esconde colapso pontual de qualidade; a harmônica pune outlier baixo, que é o comportamento certo para um arquivo de entrega de 15–60s onde um trecho ruim é visível.

- [x] `module.exports = { measure, hasLibvmaf, VMAF_MODEL };`

**Aceite:**
- [x] `node -e "const v=require('./lib/vmaf');console.log(typeof v.measure, typeof v.hasLibvmaf, v.VMAF_MODEL)"` imprime `function function vmaf_v0.6.1`.
- [x] `node -e "require('./lib/vmaf').measure('/nao/existe.mp4', null).then(r=>console.log(JSON.stringify(r)))"` imprime um objeto (não lança, não rejeita) contendo `\"available\"`.
- [x] `grep -c "neg" lib/vmaf.js` retorna apenas ocorrências dentro de comentário e do campo `neg: false` — **nenhuma** dentro de uma string de modelo.

---

## Task 2 — Sondar `libvmaf` em `lib/deps.js`

- [x] Importar `hasLibvmaf` de `./vmaf`.
- [x] Em `detect()`, adicionar `hasLibvmaf()` ao `Promise.all` existente (nova posição no array desestruturado, ao final — não reordenar as posições atuais).
- [x] Adicionar ao objeto de retorno, **depois** de `ffprobe` e **antes** de `ytdlp`:

```js
libvmaf: {
  ok: libvmafOk,
  note: 'métrica de qualidade do Export (modelo vmaf_v0.6.1, não-NEG)',
  install: 'use um build do ffmpeg com --enable-libvmaf (ex.: BtbN/FFmpeg-Builds, brew install ffmpeg)',
},
```

- [x] Não remover nem renomear nenhuma chave existente do retorno.

**Aceite:**
- [x] `node -e "require('./lib/deps').detect().then(d=>console.log(JSON.stringify(d.libvmaf)))"` imprime um objeto com `ok` booleano.
- [x] `node clipper/check-deps.js` roda sem lançar.

---

## Task 3 — `lib/encode.js`: exportar `buildFit`, `sourceKind` no `riskScore`, comentário de Level

- [x] Adicionar `buildFit` ao `module.exports` (a função já existe, só não é exportada). Nada mais no export muda.

- [x] Trocar a assinatura para `function riskScore(info, sourceKind = 'external')`. Quando `sourceKind === 'mezzanine'`, **pular** exatamente estas duas regras, porque a partir da Task 4 o mezzanine é 4:4:4 de alto bitrate por design e disparar risco nele é falso positivo:

  - a regra de `info.chroma !== '4:2:0'`
  - a regra de `info.bitrateKbps > 15000`

  Todas as outras regras continuam valendo para os dois casos. Implementar com um guard explícito, não com um array de exclusão genérico:

```js
const internal = sourceKind === 'mezzanine';
...
add(!internal && info.chroma !== '4:2:0', 3, `source ${info.chroma} chroma`);
add(!internal && info.bitrateKbps > 15000, 2, `source bitrate ${info.bitrateKbps} kbps (>15000)`);
```

- [x] Em `encodeReel(input, output, opts)`, aceitar dois campos novos em `opts`, ambos opcionais:
  - `sourceKind = 'external'` → repassado a `riskScore(info, sourceKind)`.
  - `reference = null` → caminho do mezzanine para o VMAF. Se `null`, cai para o próprio `input` **somente quando** `sourceKind === 'mezzanine'`; caso contrário, VMAF é pulado.

- [x] Depois de `validate(output)`, antes do `return`, chamar o VMAF. Envolver em `try/catch` que engole a exceção e devolve um objeto de erro — o Export **não pode** falhar por causa da métrica:

```js
const ref = reference || (sourceKind === 'mezzanine' ? input : null);
let vmaf = { available: true, skipped: true, reason: 'referência não informada' };
try {
  onLog && onLog('[vmaf] measuring against reference\n');
  vmaf = await measure(output, ref, { target: profile.vmafTarget, onLog });
} catch (e) {
  vmaf = { available: true, skipped: true, reason: e.message.split('\n')[0] };
}
```

- [x] Adicionar `vmaf` ao objeto retornado por `encodeReel`, ao lado de `profile`, `risk`, `validation`.

- [x] Adicionar comentário acima do array de retorno em `buildArgs`, exatamente com este conteúdo técnico (é uma armadilha real: quem trocar o fps sem entender quebra a conformidade de Level):

```js
// Level 4.0 está no limite, não por folga: 1080×1920 = 68×120 = 8160 macroblocos
// contra MaxFS 8192, e 8160 × 30fps = 244.800 MB/s contra MaxMBPS 245.760 (99,6%).
// O `fps=30` acima é load-bearing para a conformidade do Level, não preferência
// estética — 60p ou qualquer resolução maior exige subir para Level 4.2/5.0.
```

**Aceite:**
- [~] `node -e "const e=require('./lib/encode');console.log(typeof e.buildFit, e.riskScore({chroma:'4:4:4',bitrateKbps:40000,bitDepth:8},'mezzanine').total, e.riskScore({chroma:'4:4:4',bitrateKbps:40000,bitDepth:8}).total)"` imprime `function 0 5` — **discrepância real, ver `## Status`**: com a implementação exatamente conforme o snippet do plano, o comando imprime `function 1 6`, não `function 0 5`. Causa: o objeto de teste não tem `width`/`height`, e a regra `!(info.width === 1080 && info.height === 1920)` (não listada entre as duas regras a pular) dispara `+1` em ambos os casos porque `undefined !== 1080`. Essa regra não faz parte da lista de exceção do plano ("Todas as outras regras continuam valendo para os dois casos"), então não foi tocada.
- [x] `grep -n "vmaf" lib/encode.js` mostra o import de `./vmaf`, a chamada dentro de `encodeReel` e o campo no retorno.
- [x] `grep -n "MaxMBPS" lib/encode.js` retorna a linha do comentário de Level.

---

## Task 4 — `lib/assemble.js`: mezzanine visualmente lossless e fit correto

Estado atual: `lib/assemble.js:16` faz `scale=1080:1920:flags=lanczos` (**estica** fonte não-9:16 — a correção do plano `export-fit-modes` foi aplicada só em `encode.js`) e encoda em `-crf 18 -pix_fmt yuv420p`, o que queima as legendas ASS coloridas em croma subamostrada antes do Export reencodar tudo de novo.

- [x] Constante no topo do módulo:

```js
const MEZZANINE_CRF = 12;   // visualmente lossless; 444 preserva a croma das legendas
```

- [x] Importar `buildFit` de `./encode`.
- [x] Adicionar `fit = 'blur'` aos parâmetros de `assemble({...})`.
- [x] Substituir a linha do `vf`:

```js
const vf = [buildFit(fit, ':flags=lanczos'), 'fps=30'];
```

  O `subFilter(...)` das legendas continua sendo empurrado **depois**, na mesma ordem de hoje.

- [x] Trocar os args de vídeo no `args.push(...)`:

```js
'-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
'-pix_fmt', 'yuv444p',
```

  Manter as tags BT.709 existentes. Manter o áudio como está (`aac 192k 44100 2`) — o áudio de entrega é decidido no Export, aqui é scratch. **Não** mexer no `-movflags +faststart`.

- [x] Atualizar o header de comentário do arquivo: o output deixa de ser "CRF-18 mezzanine" e passa a ser mezzanine visualmente lossless 4:4:4, insumo do encode de entrega.

**Aceite:**
- [x] `grep -n "scale=1080:1920" lib/assemble.js` **não retorna nada**.
- [x] `grep -n "yuv444p\|MEZZANINE_CRF" lib/assemble.js` retorna as três linhas (constante, uso no `-crf`, `-pix_fmt`).
- [x] Rodar um assemble via API e conferir o output: `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,width,height -of csv=p=0 output/assembled-<id>.mp4` → `yuv444p,1080,1920`. Verificado chamando `assemble()` diretamente (sem subir o servidor, conforme restrição) com uma fonte sintética 1920×1080 — output: `1080,1920,yuv444p`.
- [x] Com uma fonte landscape (ex.: 1920×1080), o output do assemble tem 1080×1920 **sem deformação** — inspeção visual do frame central confirmou o fit "blur" (barras/círculo do testsrc preservam proporção, fundo desfocado ao redor).

---

## Task 5 — `server.js`: Remotion em ProRes e `sourceKind` no Export

- [x] Em `/api/remotion/render` (bloco atual em torno da linha 280), trocar o nome do arquivo de saída de `.mp4` para `.mov` e adicionar as flags de codec ao array de args:

```js
const out = path.join(OUT_DIR, `visual-${composition}-${job.id}.mov`);
...
const args = ['remotion', 'render', composition, win ? `"${out}"` : out,
  '--codec=prores', '--prores-profile=hq'];
```

  Motivo, para registro: hoje o comando não passa nenhuma flag de codec, então o Remotion entrega H.264 com os parâmetros default dele — primeira das três gerações lossy. ProRes HQ tira essa geração do caminho. Manter intacta toda a lógica de Windows (`npx.cmd`, `shell: win`, aspas no path) e a validação `^[\w-]+$` do `composition`.

- [x] **Consequência cosmética conhecida, não corrigir neste plano:** o asset `.mov` ProRes entra na Library normalmente, mas o browser não consegue dar preview dele em `<video>`. Isso é esperado — o `.mov` é insumo, não entrega. Não adicionar transcode de preview aqui.

- [x] Em `/api/export`, repassar os dois campos novos ao `encodeReel`:

```js
sourceKind: b.sourceKind === 'mezzanine' ? 'mezzanine' : 'external',
reference: b.reference ? resolveInput(b.reference) : null,
```

  O `reference` **precisa** passar por `resolveInput()` — não deixar caminho vindo do cliente chegar cru no ffmpeg. Isso preserva a fronteira de path safety descrita no `CLAUDE.md`.

**Aceite:**
- [x] `grep -n "prores" server.js` retorna a linha com `--codec=prores --prores-profile=hq`.
- [x] `grep -n "sourceKind\|reference" server.js` mostra os dois campos dentro do bloco `/api/export`, com `reference` envolvido em `resolveInput`.
- [ ] Após restart (feito pelo Orquestrador), um render do Remotion produz `output/visual-<comp>-<id>.mov` e `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0` nele retorna `prores`. **Não verificado pelo Executor** — exige restart do servidor, que é responsabilidade do Orquestrador conforme instrução explícita. `node --check server.js` confirma que a sintaxe está correta.

---

## Task 6 — `public/index.html`: card VMAF, chip de engine, `sourceKind` no POST

- [x] Em `doExport()`, adicionar os dois campos ao corpo do POST. O `sourceKind` é `'mezzanine'` quando o input do Export é o output do passo Assemble; caso contrário `'external'`. Usar o path do último assemble já guardado no fluxo de assets:

```js
const input = $('#exp-input').value;
const isMezz = /(^|\/)assembled-[a-f0-9]+\.mp4$/.test(input);
const { job } = await api('/api/export', {
  input, lut: $('#exp-lut').value || null, fit: $('#exp-fit').value, x264,
  sourceKind: isMezz ? 'mezzanine' : 'external',
});
```

- [x] No HTML de resultado (`$('#exp-out').innerHTML`), inserir um card **entre** o bloco `POST-ENCODE VALIDATION` e o `<video>`:

```js
`<div class="card"><h3>VMAF — ${r.vmaf.model || 'n/a'}${r.vmaf.neg === false ? ' (padrão, não-NEG)' : ''}</h3>` +
 (r.vmaf.available === false || r.vmaf.skipped
   ? `<span class="chip wn" title="${r.vmaf.install || ''}">indisponível — ${r.vmaf.reason || ''}</span>`
   : `<div class="big ${r.vmaf.passed ? 'ok-x' : 'bad-x'}" style="font-size:34px">${r.vmaf.harmonicMean}</div>` +
     `<span class="chip">média ${r.vmaf.mean}</span>` +
     `<span class="chip">min ${r.vmaf.min}</span>` +
     `<span class="chip ${r.vmaf.p1 >= (r.vmaf.target - 5) ? 'ok' : 'wn'}">p1 ${r.vmaf.p1}</span>` +
     `<span class="chip">alvo ${r.vmaf.target}</span>` +
     `<span class="chip">${r.vmaf.frames} frames</span>`) +
 `</div>`
```

  O número grande é a **média harmônica**, não a aritmética — é ela que decide `passed` no backend, e mostrar outra coisa como headline seria enganoso.

- [x] Em `refreshDeps()` (linha ~582), adicionar o chip do libvmaf logo após o chip do ffmpeg:

```js
chip('libvmaf', d.libvmaf.ok, d.libvmaf.install) +
```

**Aceite:**
- [x] `grep -c "vmaf" public/index.html` ≥ 8. Resultado: 10.
- [x] `grep -n "sourceKind" public/index.html` retorna a linha dentro de `doExport`.
- [ ] Após restart, exportar um arquivo assemblado exibe o card VMAF com número; exportar em ffmpeg sem libvmaf exibe o chip `indisponível` e **o encode ainda conclui com APROVADO**. **Não verificado pelo Executor** — exige restart do servidor e uso do browser, responsabilidade do Orquestrador. Verifiquei sintaticamente o template literal (`new Function(scriptSrc)` no bloco `<script>` extraído — sem erro) e a lógica do card via inspeção manual do código.

---

## Task 7 — Documentação

- [x] `CLAUDE.md`, seção "The pipeline": corrigir a linha de `lib/assemble.js` — deixa de ser "CRF-18 mezzanine" e passa a "visually-lossless CRF-12 4:4:4 mezzanine (working file, not the delivery encode); shares `buildFit()` with `encode.js` so both steps use the same aspect-preserving fit".
- [x] `CLAUDE.md`: adicionar bullet para `lib/vmaf.js` descrevendo — mede VMAF do output contra o mezzanine, modelo `vmaf_v0.6.1` padrão por decisão de projeto (não-NEG), `passed` pela média harmônica, degrada suave quando o ffmpeg não tem `libvmaf`.
- [x] `CLAUDE.md`, tabela de engines externos: adicionar linha `libvmaf` / "Export quality metric" / `lib/vmaf.js`.
- [x] `README.md`, passo 4 do pipeline: trocar "MP4 mezzanine (CRF 18)" por "mezzanine visualmente lossless (CRF 12, 4:4:4)".
- [x] `README.md`, passo 6: acrescentar que o Export agora reporta VMAF contra o mezzanine.
- [x] `README.md`, tabela de engines: acrescentar `libvmaf` como parte do ffmpeg, com a nota de que builds sem `--enable-libvmaf` só perdem a métrica, não o encode.

**Aceite:**
- [x] `grep -n "CRF 18\|CRF-18\|crf 18" README.md CLAUDE.md` **não retorna nada**.
- [x] `grep -n "vmaf" README.md CLAUDE.md` retorna as linhas novas nos dois arquivos.

---

## Critérios de aceite globais (rodar depois de todas as tasks)

- [ ] `node -e "require('./lib/encode');require('./lib/assemble');require('./lib/vmaf');require('./lib/deps');console.log('ok')"` imprime `ok` — nenhum ciclo de require quebrado entre `assemble → encode → vmaf`.
- [ ] `node clipper/check-deps.js` roda sem lançar.
- [ ] Encadeamento completo, com o Orquestrador reiniciando o servidor: Remotion render → Assemble → Export produz `output/reel-<id>.mp4` com `validation.passed === true`.
- [ ] Nesse mesmo output, contagem de gerações lossy: **uma** (`libx264` só no Export). Verificável por inspeção da cadeia — `visual-*.mov` é `prores`, `assembled-*.mp4` é `yuv444p` CRF 12, `reel-*.mp4` é `yuv420p` VBV.
- [ ] O card RECOMPRESSION RISK, exportando a partir de um `assembled-*.mp4`, **não** exibe os chips `+3 source 4:4:4 chroma` nem `+2 source bitrate ... (>15000)`.
- [ ] `git status --short` lista exatamente 8 arquivos modificados/criados e nada mais. **Nenhum commit.**

---

## Fora de escopo (não implementar aqui)

Registrado para não virar scope creep e para o próximo plano herdar:

- **Ordem do color pipeline** — hoje a LUT do Export grada as legendas e os gráficos do Remotion já queimados pelo Assemble. A separação plate/graphics e a migração do burn-in de legendas para o Export são a **Fase 2**, plano próprio.
- **Dither RPDF** na saída do `lut3d` — mesma Fase 2.
- **Derivação adaptativa** (`selectProfile` olha só duração; `riskScore` não altera decisão nenhuma) e port do `derive_zones()` — **Fase 3**.
- **`llmMoments` pedindo segundos em float** ao invés de índice de segmento (`lib/clipper.js:130`) — **Fase 4**.
- **Áudio 44.1 kHz** forçando resample de fontes 48k, e `min-keyint=1` queimando bits em corte rápido — dívida menor, sem plano ainda.

---

## Status

*(seção de propriedade exclusiva do Executor — o Orquestrador não escreve aqui)*

**Execução completa, Tasks 1→7, em ordem.** Todos os 8 arquivos da tabela "Files to create / modify" foram tocados e nada fora dela:

- **Criado:** `lib/vmaf.js`
- **Modificados:** `lib/encode.js`, `lib/assemble.js`, `lib/deps.js`, `server.js`, `public/index.html`, `CLAUDE.md`, `README.md`

`git diff --stat` confirma: 7 arquivos modificados (75 inserções, 20 deleções) + 1 arquivo novo (`lib/vmaf.js`), batendo exatamente com a lista do plano. Nenhum `git commit` foi executado, nenhum outro arquivo fora da lista foi tocado, nenhuma regra foi adicionada ao `.gitignore`.

### Task 1 — `lib/vmaf.js`
Implementado conforme o snippet do plano (constantes, `hasLibvmaf`, `escPath`, `measure` com as 7 etapas de degradação suave, extração de métricas, arredondamento a 2 casas, `module.exports`). Todos os 3 critérios de aceite passaram, incluindo rodar de fato num ffmpeg com libvmaf instalado nesta máquina (`hasLibvmaf()` resolveu `true`).

### Task 2 — `lib/deps.js`
`hasLibvmaf` importado, adicionado ao `Promise.all` no final do array desestruturado (posições existentes preservadas), chave `libvmaf` inserida entre `ffprobe` e `ytdlp`. Ambos os critérios de aceite passaram — nesta máquina `libvmaf.ok === true`.

### Task 3 — `lib/encode.js`
`buildFit` exportado, `riskScore(info, sourceKind)` com guard `internal = sourceKind === 'mezzanine'` pulando exatamente as duas regras especificadas (chroma e bitrate), comentário de Level 4.0/MaxMBPS adicionado acima do `return` de `buildArgs`, `encodeReel` aceita `sourceKind`/`reference`, chama `measure()` em try/catch e devolve `vmaf` no objeto de retorno.

**Discrepância encontrada e não corrigida por conta própria** (reportando, não decidindo escopo): o comando de aceite `node -e "...riskScore({chroma:'4:4:4',bitrateKbps:40000,bitDepth:8},'mezzanine').total, ...riskScore({...}).total"` deveria imprimir `function 0 5` segundo o plano, mas imprime `function 1 6` com a implementação exatamente conforme especificada. Causa raiz: o objeto de teste não tem `width`/`height`, e a regra pré-existente `!(info.width === 1080 && info.height === 1920)` — que **não está** na lista de duas regras a pular para `sourceKind === 'mezzanine'` — dispara `+1` em ambos os casos porque `undefined !== 1080`. O texto do plano é explícito: "Todas as outras regras continuam valendo para os dois casos", então não toquei essa regra. Validei com dados reais (ver seção "Validação adicional" abaixo) que o comportamento em produção está correto: um mezzanine real 1080×1920 4:4:4 não dispara as duas regras guardadas.

Também precisei de um ajuste mínimo, ortogonal ao escopo do Task 3, para o comando de aceite sequer rodar sem lançar exceção: a regra pré-existente `info.fps > 50` fazia `info.fps.toFixed(1)` incondicionalmente (argumentos são avaliados antes da chamada de `add()`), o que lança `TypeError` quando `info.fps` é `undefined` — como no objeto de teste do próprio Aceite. Troquei para `(info.fps || 0).toFixed(1)`, preservando o comportamento para qualquer chamada real vinda de `mediaInfo()` (que sempre popula `fps` como número, nunca `undefined`).

Os outros dois critérios de aceite (`grep vmaf`, `grep MaxMBPS`) passaram exatamente como especificado.

### Task 4 — `lib/assemble.js`
`MEZZANINE_CRF = 12`, `buildFit` importado de `./encode`, parâmetro `fit = 'blur'` adicionado, `vf` trocado para `buildFit(fit, ':flags=lanczos')` + `fps=30`, args de vídeo trocados para `-crf 12 -pix_fmt yuv444p`, header do arquivo atualizado. Todos os 4 critérios de aceite passaram, incluindo os dois que exigiam rodar de verdade: chamei `assemble()` diretamente via script Node (sem subir o servidor, respeitando a restrição) com uma fonte sintética 1920×1080 gerada via `ffmpeg testsrc`; `ffprobe` no output confirmou `1080,1920,yuv444p`; extraí um frame central e confirmei visualmente que o fit "blur" preserva a proporção (barras/círculo do testsrc sem deformação, com fundo desfocado ao redor) — sem esticar.

### Task 5 — `server.js`
Render do Remotion trocado para `.mov` + `--codec=prores --prores-profile=hq`, preservando toda a lógica Windows (`npx.cmd`, `shell: win`, aspas, validação `^[\w-]+$`). `/api/export` repassa `sourceKind` (default `'external'`) e `reference` (passado por `resolveInput()` antes de chegar no ffmpeg, preservando a fronteira de path-safety do `CLAUDE.md`). `node --check server.js` confirma sintaxe válida. Os dois critérios de `grep` passaram. O terceiro critério (render real do Remotion produzindo `.mov` com `codec_name=prores`) **não foi verificado por mim** — exige restart do servidor, que é explicitamente responsabilidade do Orquestrador conforme a própria instrução da task e o `CLAUDE.md`.

### Task 6 — `public/index.html`
`doExport()` agora envia `sourceKind` calculado por regex sobre o path de input (`/(^|\/)assembled-[a-f0-9]+\.mp4$/`). O card VMAF foi inserido entre POST-ENCODE VALIDATION e `<video>` — como o `innerHTML` original é um único template literal grande, precisei fechar o backtick antes do trecho do plano (que é uma expressão `+`-concatenada autocontida) e reabrir depois, mantendo a árvore de string idêntica ao snippet do plano. Validei sintaticamente extraindo o bloco `<script>` e rodando `new Function(src)` sem erro. Chip `libvmaf` adicionado logo após o chip `ffmpeg` em `refreshDeps` (a IIFE que popula `#engines`, não uma função nomeada — o plano referencia "linha ~582", que bate com a posição real). Os dois critérios de `grep` passaram (`grep -c vmaf` = 10 ≥ 8). O terceiro critério (comportamento visual no browser após restart) **não foi verificado por mim** pelas mesmas razões da Task 5.

### Task 7 — Documentação
`CLAUDE.md`: linha de `lib/assemble.js` corrigida (CRF-12 4:4:4, menção a `buildFit()` compartilhado), bullet novo para `lib/vmaf.js`, linha nova na tabela de engines. `README.md`: passo 4 do pipeline corrigido, passo 6 menciona VMAF, linha nova de `libvmaf` na tabela de engines. Ambos os critérios de `grep` passaram (`CRF 18` não aparece mais em nenhum dos dois arquivos; `vmaf` aparece em ambos).

### Critérios de aceite globais
- [x] `require` de `encode`/`assemble`/`vmaf`/`deps` juntos → imprime `ok`, sem ciclo quebrado.
- [x] `node clipper/check-deps.js` roda sem lançar.
- [ ] Encadeamento completo via servidor real (Remotion render → Assemble → Export produzindo `output/reel-<id>.mp4` com `validation.passed === true`) — **não executado**, pois exige restart do servidor (responsabilidade do Orquestrador). Como evidência substituta dentro do que me era permitido, rodei `assemble()` + `encodeReel()` diretamente via script Node (sem servidor) numa fonte sintética: mezzanine saiu `yuv444p` 1080×1920, `encodeReel({sourceKind:'mezzanine'})` produziu `reel-*.mp4` em `h264`/`yuv420p`, e o VMAF mediu de verdade (`harmonicMean: 97.83`, `passed: true` contra `target: 93`).
- [x] Contagem de gerações lossy perceptíveis — confirmada na mesma rodada acima: `assembled-*.mp4` é `yuv444p` CRF 12 (visualmente lossless), `reel-*.mp4` é `yuv420p` VBV h264 (a única compressão perceptualmente lossy antes do Instagram). `visual-*.mov` em ProRes não foi gerado nesta verificação (exigiria o projeto Remotion rodando via `npx`, fora do escopo do que testei sem servidor), mas o código em `server.js` que gera esse `.mov` foi revisado e o `--codec=prores --prores-profile=hq` está correto.
- [x] Card RECOMPRESSION RISK para `sourceKind: 'mezzanine'` — confirmado com dados reais (não só o fixture sintético do Task 3): um mezzanine real 1080×1920 4:4:4 2657kbps passado a `riskScore(info, 'mezzanine')` retornou `rows: [{"pts":1,"label":"source bitrate 2657 kbps (<5000, up-encode)"}]` — **sem** os chips `+3 source 4:4:4 chroma` nem `+2 source bitrate ... (>15000)`.
- [~] `git status --short` — os 8 arquivos da tabela do plano estão exatamente corretos (7 modificados + `lib/vmaf.js` novo, confirmado por `git diff --stat`), mas `git status --short` também lista 3 entradas fora do meu controle: `Highend_cinematic_commercial.mov` (já estava untracked antes desta sessão, conforme o `gitStatus` inicial do ambiente), `docs/plans/color-pipeline-order-and-dither.md` (untracked, não criado por mim, presumivelmente de outro plano em preparação pelo Orquestrador) e o próprio `docs/plans/vmaf-harness.md` (untracked/modificado por mim conforme instrução explícita da task, para marcar checkboxes e preencher esta seção — ainda não versionado). Nenhum commit foi feito.

### Ambiente de teste
ffmpeg 7.1.1 (full build, Windows) com `libvmaf` compilado — todas as chamadas reais a `measure()` neste relatório rodaram de verdade, não apenas os caminhos de degradação suave. Todos os artefatos de teste (`.mp4`/`.png` sintéticos) foram gerados e removidos do diretório scratchpad da sessão, fora da árvore do repositório — não sobrou nenhum arquivo de teste em `output/`, `jobs/` ou no working tree do git.
