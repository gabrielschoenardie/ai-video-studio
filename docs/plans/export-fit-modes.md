# Plan — Export FIT modes (aspect-preserving, no stretch)

**Owner (Orquestrador):** non-Status sections. **Executor:** `## Status` only.

## Goal

Fix the Export step distorting non-9:16 sources. `lib/encode.js` currently does
`scale=1080:1920` which **force-stretches** any source to the delivery frame,
squishing landscape footage vertically. Replace it with an **aspect-preserving
fit** with a user-chosen mode, exposed as a new **FIT** dropdown in the Export
panel. Default = `blur` (sharp video centered over a blurred, zoomed copy).

Three modes (all output exactly 1080×1920, all proven with ffmpeg on a 320×176
source → 1080×1920, no error, no distortion):
- `blur` — foreground fit + blurred zoomed background fill (Reels look).
- `crop` — fill the frame, center-crop the overflow.
- `pad`  — letterbox: whole frame, black bars.

For a source that is **already 9:16**, every mode is a visual no-op (scales
edge-to-edge, nothing to crop/pad, blur fully covered) — so the normal pipeline
(clipper/Remotion 1080×1920 output) is unaffected.

## Global constraints

- **Zero npm deps.** Plain Node / ffmpeg only.
- **Do NOT restart the server** or run `node server.js` — the Orquestrador does
  restart + browser verification.
- **Do NOT commit** — git is handled separately.
- **Sensitive file:** `lib/encode.js` is the "Metodologia Gabriel" delivery
  encoder. Change ONLY the video-filter (`vf`) construction. Do **not** touch
  rate-control (`-b:v`/`-maxrate`/`-bufsize`), `-x264-params`, the color flags
  (`-color_primaries`/`-color_trc`/`-colorspace`/`-color_range`), audio, or
  `-movflags`. The post-encode `validate()` must keep passing on a real 9:16
  source.
- Match surrounding code style. Touch only the 3 files below.

## Files
- **Modify:** `lib/encode.js` (add `fit` option + fit-aware `vf`; a small helper)
- **Modify:** `server.js` (pass `fit` through the `/api/export` route)
- **Modify:** `public/index.html` (FIT `<select>` + send it from `doExport`)

---

## Task 1 — `lib/encode.js`: aspect-preserving fit

**1a.** Add a `buildFit` helper. Insert it immediately BEFORE `function buildArgs`
(currently line 55):

```js
// Aspect-preserving fit of any source into the 1080×1920 delivery frame.
// `sopt` = the scale-filter suffix (flags + optional range conversion).
// For a source already 9:16 every branch is a visual no-op.
const FIT_W = 1080, FIT_H = 1920;
function buildFit(fit, sopt) {
  const size = `${FIT_W}:${FIT_H}`;
  if (fit === 'pad')   // letterbox — whole frame, black bars
    return `scale=${size}:force_original_aspect_ratio=decrease${sopt},pad=${size}:(ow-iw)/2:(oh-ih)/2`;
  if (fit === 'crop')  // fill — cover the frame, center-crop the overflow
    return `scale=${size}:force_original_aspect_ratio=increase${sopt},crop=${size}`;
  // 'blur' (default) — sharp video centered over a blurred, zoomed copy
  return `split=2[bg][fg];` +
    `[bg]scale=${size}:force_original_aspect_ratio=increase${sopt},crop=${size},gblur=sigma=40[bg];` +
    `[fg]scale=${size}:force_original_aspect_ratio=decrease${sopt}[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
}
```

> Note: the reused `[bg]`/`[fg]` labels are intentional and verified working in
> ffmpeg's `-vf` — do not "clean them up" to new names.

**1b.** Change the `buildArgs` signature to accept `fit` (default `'blur'`).
Replace line 55:
```js
function buildArgs(input, output, profile, { lut = null, denoise = null, x264 = {}, fullRangeSource = false } = {}) {
```
with:
```js
function buildArgs(input, output, profile, { lut = null, denoise = null, x264 = {}, fullRangeSource = false, fit = 'blur' } = {}) {
```

**1c.** Replace the scale/fps construction. The current lines 65–70 are:
```js
  // Instagram delivery requires broadcast (TV/limited) range. A full-range
  // (PC) source must be rescaled here, not just relabeled — ffmpeg carries
  // the source range through untouched otherwise, so `-pix_fmt yuv420p`
  // alone still probes back as yuvj420p and fails post-encode validation.
  const scaleRange = fullRangeSource ? ':in_range=full:out_range=limited' : '';
  vf.push(`scale=1080:1920:flags=lanczos${scaleRange}`, 'fps=30');
```
Replace those six lines with:
```js
  // Instagram delivery requires broadcast (TV/limited) range. A full-range
  // (PC) source must be rescaled here, not just relabeled — ffmpeg carries
  // the source range through untouched otherwise, so `-pix_fmt yuv420p`
  // alone still probes back as yuvj420p and fails post-encode validation.
  const scaleRange = fullRangeSource ? ':in_range=full:out_range=limited' : '';
  const sopt = `:flags=lanczos${scaleRange}`;
  // Aspect-preserving fit into 1080×1920 (never a raw stretch), then 30fps.
  vf.push(buildFit(fit, sopt), 'fps=30');
```

Everything else in `buildArgs` (the `-vf`, vf.join(','), and all encoder args)
stays byte-for-byte the same. `vf.join(',')` still works: the blur branch's
internal `;`/labels live inside a single vf element, and `,fps=30` appends after
the overlay output — verified valid.

**1d.** Thread `fit` through `encodeReel`. Change line 132:
```js
async function encodeReel(input, output, { lut = null, denoise = null, x264 = {}, onProgress, onLog } = {}) {
```
to:
```js
async function encodeReel(input, output, { lut = null, denoise = null, x264 = {}, fit = 'blur', onProgress, onLog } = {}) {
```
And change line 137:
```js
  const args = buildArgs(input, output, profile, { lut, denoise, x264, fullRangeSource: info.colorRange === 'pc' });
```
to:
```js
  const args = buildArgs(input, output, profile, { lut, denoise, x264, fullRangeSource: info.colorRange === 'pc', fit });
```

**Acceptance (Task 1):**
- `node --check lib/encode.js` exits 0.
- Verify the three vf strings build correctly (no encode needed):
```
node -e "const m=require('./lib/encode.js'); console.log(typeof m.encodeReel)"
```
  → prints `function` (module loads).
- The three fit filtergraphs are already proven to encode a 320×176 source to
  1080×1920 with no error (Orquestrador verified). No new ffmpeg run required
  here; the Orquestrador re-verifies end-to-end after wiring.

---

## Task 2 — `server.js`: pass `fit` to the encoder

In the `/api/export` route (currently lines 266–272), add `fit` to the
`encodeReel` options. Change:
```js
        const r = await encodeReel(input, out, {
          lut: b.lut ? resolveInput(b.lut) : null,
          denoise: b.denoise || null,
          x264: b.x264 || {},
          onLog: s => jlog(job, s),
          onProgress: pr => emit(job, 'progress', pr),
        });
```
to:
```js
        const r = await encodeReel(input, out, {
          lut: b.lut ? resolveInput(b.lut) : null,
          denoise: b.denoise || null,
          x264: b.x264 || {},
          fit: b.fit || 'blur',
          onLog: s => jlog(job, s),
          onProgress: pr => emit(job, 'progress', pr),
        });
```

**Acceptance:** `node --check server.js` exits 0; grep shows one `fit: b.fit || 'blur'`.

---

## Task 3 — `public/index.html`: FIT dropdown + send it

**3a.** Add the FIT `<select>` as a third column in the INPUT/LUT row. The
current row (lines 374–377) is:
```html
      <div class="row">
        <div><label for="exp-input">INPUT</label><select id="exp-input"></select></div>
        <div><label for="exp-lut">LUT 3D .CUBE (OPTIONAL)</label><select id="exp-lut"><option value="">— none —</option></select></div>
      </div>
```
Replace it with:
```html
      <div class="row">
        <div><label for="exp-input">INPUT</label><select id="exp-input"></select></div>
        <div><label for="exp-lut">LUT 3D .CUBE (OPTIONAL)</label><select id="exp-lut"><option value="">— none —</option></select></div>
        <div><label for="exp-fit">FIT (SE NÃO FOR 9:16)</label><select id="exp-fit">
          <option value="blur" selected>fundo desfocado</option>
          <option value="crop">preencher e cortar</option>
          <option value="pad">encaixar (barras)</option></select></div>
      </div>
```

**3b.** Send `fit` from `doExport`. Change the `api('/api/export', …)` call
(currently lines 730–731):
```js
    const { job } = await api('/api/export', {
      input: $('#exp-input').value, lut: $('#exp-lut').value || null, x264 });
```
to:
```js
    const { job } = await api('/api/export', {
      input: $('#exp-input').value, lut: $('#exp-lut').value || null, fit: $('#exp-fit').value, x264 });
```

**Acceptance:** grep shows one each of `id="exp-fit"` and `fit: $('#exp-fit').value`.

---

## Overall acceptance criteria

1. `node --check lib/encode.js` and `node --check server.js` exit 0.
2. `buildFit('crop'|'pad'|'blur', …)` produces the three filtergraphs above;
   `buildArgs`/`encodeReel` accept and forward `fit` (default `'blur'`).
3. Rate-control, x264-params, color flags, audio, movflags in `buildArgs` are
   unchanged (diff touches only the vf lines + signatures).
4. `/api/export` forwards `fit` (default `'blur'`); Export panel has the FIT
   select; `doExport` sends it.
5. No new npm dep; only the 3 listed files changed; nothing committed.

## Status

_(propriedade do Executor)_

**Executado em 2026-07-24 — Executor.**

Todas as 3 tarefas do plano implementadas ao pé da letra, conferindo âncoras de
linha antes de cada edição (bateram exatamente com o conteúdo real dos
arquivos).

Arquivos alterados:
- `lib/encode.js` — adicionado `buildFit()` (const `FIT_W`/`FIT_H` + 3 branches
  `pad`/`crop`/`blur`) antes de `buildArgs`; `buildArgs` ganhou `fit = 'blur'`
  na assinatura e a construção do `vf` agora usa `buildFit(fit, sopt)` no lugar
  do `scale=1080:1920:flags=lanczos...` fixo; `encodeReel` ganhou `fit = 'blur'`
  na assinatura e repassa `fit` para `buildArgs`. Nenhuma linha de rate-control
  (`-b:v`/`-maxrate`/`-bufsize`), `-x264-params`, flags de cor, áudio ou
  `-movflags` foi tocada — confirmado via `git diff` (essas linhas não aparecem
  no diff).
- `server.js` — rota `/api/export`: adicionada `fit: b.fit || 'blur',` nas
  options passadas a `encodeReel`.
- `public/index.html` — adicionado `<select id="exp-fit">` com opções
  `blur`/`crop`/`pad` (default `blur` selecionado) como terceira coluna na row
  INPUT/LUT; `doExport()` agora envia `fit: $('#exp-fit').value` no corpo de
  `/api/export`.

Comandos de aceite (todos passaram):
- `node --check lib/encode.js` → exit 0.
- `node --check server.js` → exit 0.
- `node -e "const m=require('./lib/encode.js'); console.log(typeof m.encodeReel)"`
  → imprimiu `function`.
- `grep` no `server.js` por `fit: b.fit || 'blur'` → 1 ocorrência (linha 270).
- `grep` no `public/index.html` por `id="exp-fit"` → 1 ocorrência (linha 377).
- `grep` no `public/index.html` por `fit: $('#exp-fit').value` → 1 ocorrência
  (linha 735).

Observação (não é desvio do meu trabalho, é achado): o repositório já tinha,
antes desta execução, mudanças não commitadas em `public/index.html` e
`server.js`/`lib/encode.js` implementando uma feature separada de "biblioteca
de LUTs" (`LUTS_DIR`, rota `GET /api/luts`, escaping de path do `lut3d` no
Windows, auto-carregamento de LUTs no painel de export). Essas mudanças já
estavam no working tree antes de eu tocar nos arquivos (confirmado lendo o
conteúdo original antes de editar) e não fazem parte deste plano — não as
toquei, não as revertive, apenas apliquei minhas edições em cima delas sem
conflito. `git diff --stat` mostra isso refletido nos 3 arquivos; o Orquestrador
deve estar ciente ao revisar o diff completo antes do commit.

Nenhum arquivo além dos 3 listados no plano foi tocado. Nenhum `npm install`
rodado. Servidor não foi reiniciado. Nenhum commit feito.
