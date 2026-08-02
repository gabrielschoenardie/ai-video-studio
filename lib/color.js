// color.js — builds the color-managed segment of the Export filtergraph
// (grade + dither + captions helpers). The LUT touches only the plate,
// never the graphics: this module returns the filter chain that sits
// between `fps=30` and `subtitles=` in the canonical vf order (see
// lib/encode.js). Dither is mandatory before any quantization back to
// 8-bit — a bare `lut3d` into `format=yuv420p` bands visibly on flat
// gradients (e.g. the NeuralIntro composition).
//
// Pure module: no `child_process`, no `fs`, no I/O. Takes parameters,
// returns filter strings/arrays — this is what lets it be tested with
// `node -e` and no media file.
'use strict';
const path = require('path');
const { subFilter } = require('./captions');

const LUT_INTERP = 'tetrahedral';   // pinned — don't trust the ffmpeg build's default
const DITHER_MODES = ['random', 'error_diffusion', 'none'];
// `alls` on ffmpeg's `noise` filter is a 0–100 intensity/probability scale,
// not a literal 8-bit LSB amplitude — confirmed empirically (Task 9 smoke
// test, ffmpeg 7.1.1-full_build-www.gyan.dev): alls=1 produced zero
// measurable pixel change across 60 frames of a static gradient (identical
// SHA256 framehashes); alls=2 is the minimum that shows any effect.
const NOISE_LSB = 2;

// Same escape recipe as lib/encode.js / lib/captions.js — the ffmpeg
// filtergraph parser breaks on backslashes and on the Windows drive-letter
// colon, so every inserted path goes through this before hitting a filter.
function escPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function normalizeDither(dither) {
  return DITHER_MODES.includes(dither) ? dither : 'random';
}

// Builds the grade+dither segment. Returns [] if no LUT is given — nothing
// to promote precision for. Two routes, chosen by the zscale probe:
//   zscale (preferred): float RGB planar, native RPDF dither (`d=random`)
//   swscale (fallback): 8-bit, approximate RPDF via `noise=alls=2:allf=t+u`
function buildGrade({ lut, dither = 'random', zscale = false } = {}) {
  if (!lut) return [];
  const d = normalizeDither(dither);
  const escLut = escPath(lut);

  if (zscale) {
    return [
      // Limited-range BT.709 YUV → RGB planar float. Matrix and range are
      // explicit: without this ffmpeg auto-inserts a conversion guessing
      // the matrix from the file's tags, and a mistagged mezzanine grades
      // wrong without any warning. `m=gbr` (not `rgb`) is zscale's enum
      // value for "no matrix, this is RGB" — confirmed against `ffmpeg -h
      // filter=zscale` (Task 9 smoke test); `m=rgb` is rejected outright.
      'zscale=min=bt709:tin=bt709:pin=bt709:rin=limited:m=gbr:t=bt709:p=bt709:r=full:f=lanczos:d=none',
      'format=gbrpf32le',
      `lut3d='${escLut}':interp=${LUT_INTERP}`,
      // Back to YUV 4:4:4 8-bit — this is where dither happens, the only
      // precision reduction on the grade path.
      `zscale=m=bt709:t=bt709:p=bt709:r=limited:f=lanczos:d=${d === 'none' ? 'none' : d}`,
      'format=yuv444p',
    ];
  }

  // swscale fallback: LUT interpolates in 8-bit.
  return [
    'format=yuv444p',
    `lut3d='${escLut}':interp=${LUT_INTERP}`,
    // `allf=t+u` is what makes this RPDF instead of gaussian: `u` = uniform
    // (rectangular) distribution, `t` = temporal. Do not swap for `allf=t`
    // alone — without the `u` the filter defaults to gaussian, which is
    // TPDF-ish and smears the gradient instead of dissolving the band.
    ...(d === 'none' ? [] : [`noise=alls=${NOISE_LSB}:allf=t+u`]),
  ];
}

// Builds the subtitles segment. Empty if no .ass path — graphics-only
// exports (grade: 'none' or no captions) simply skip this. Reuses
// captions.js:subFilter instead of duplicating the escape/original_size
// logic here.
function buildCaptions(assPath) {
  if (!assPath) return [];
  return [subFilter(assPath)];
}

function describe({ lut, dither, zscale, captions } = {}) {
  const d = normalizeDither(dither);
  return {
    lut: lut ? path.basename(lut) : null,
    interp: lut ? LUT_INTERP : null,
    route: zscale ? 'zscale (float RGB)' : 'swscale (8-bit)',
    dither: lut ? d : 'none',
    ditherKind: zscale ? 'RPDF (zimg random)' : `RPDF aproximado (noise t+u, alls=${NOISE_LSB})`,
    captions: !!captions,
    precisionNote: zscale ? null : 'LUT aplicada em 8-bit — instale ffmpeg com libzimg para precisão float',
  };
}

module.exports = { buildGrade, buildCaptions, describe, DITHER_MODES, LUT_INTERP };
