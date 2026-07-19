---
name: encode-validate
description: Check whether an MP4 file meets the Instagram delivery encode spec ("Metodologia Gabriel") — codec, profile, level, pix_fmt, resolution, BT.709 color tags, bitrate ceiling, audio, and GOP spacing. Use when asked to validate an export, debug a rejected/non-compliant encode, or confirm a file is delivery-ready.
disable-model-invocation: true
---

# Encode validate

`lib/encode.js` defines a formal delivery spec for Instagram Reels exports
(H.264 High profile, level 4.0, yuv420p, 1080×1920, BT.709 tags, AAC 44.1kHz,
GOP ≤ 60 frames / 2.0s, bitrate ceiling by duration-based VBV profile). Its
`validate()` function re-probes an actual output file and checks it against
every one of those requirements — this is the source of truth for
"does this file pass," not `buildArgs()` alone.

## Steps

1. Ask the user for the path to the MP4 to validate if not already given.

2. Run validation directly against `lib/encode.js`'s exported `validate()`,
   don't reimplement the checks:
   ```bash
   node -e "
   const { validate } = require('./lib/encode');
   validate(process.argv[1]).then(r => {
     console.log('PASSED:', r.passed);
     console.log('bitrate:', r.bitrateKbps, 'kbps');
     for (const c of r.checks) console.log((c.ok ? '  OK ' : ' FAIL'), c.label, '->', c.got);
   }).catch(e => { console.error(e.message); process.exit(1); });
   " "<path-to-mp4>"
   ```

3. Report the full checklist (not just pass/fail) — each failing check names
   exactly what was measured (`c.got`) vs. what's required, which is usually
   enough to point at the fix (e.g. wrong `-profile:v`, missing BT.709 tags,
   GOP > 60 frames).

4. If the file was produced by `encodeReel()` (the `/api/export` route),
   also surface `risk.rows` from that call's result if available — it
   flags *why* a source might re-encode poorly (10-bit, HEVC, non-4:2:0
   chroma, non-BT.709 primaries, off-spec fps/resolution/bitrate) before
   the encode even ran.

## Notes

- Requires `ffprobe` on PATH (same dependency as the rest of the app).
- Don't hand-roll ffprobe checks here — always go through `validate()` so
  behavior stays identical to what `/api/export` itself reports.
