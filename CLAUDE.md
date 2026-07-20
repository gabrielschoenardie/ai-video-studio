# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A one-window local AI video studio: clip, score, animate, voice, caption, and export short-form vertical video (Instagram Reels) entirely on the user's machine — $0 per use, nothing uploaded. The backend is zero-npm-dependency plain Node (`http`, no framework); the only npm project is the optional `remotion/` subproject for motion-graphics rendering. All heavy lifting (transcription, TTS, encoding, clipping) is delegated to external CLI engines invoked via `child_process`.

## Commands

```bash
node server.js              # start the app → http://localhost:4870
node clipper/check-deps.js  # check which engines are installed (also GET /api/deps)
node clipper/clip.js        # interactive auto-clipper CLI
node clipper/clip.js --mode ai --reframe   # AI moment-picking + 9:16 subject-follow reframe
```

There is no build step, bundler, test suite, or linter — the backend is plain CommonJS Node ≥18 run directly. `remotion/` has its own npm project (`cd remotion && npm install`) used only for rendering the Visuals step via `npx remotion render <composition> <out>`.

## External engines (all optional, all invoked via `child_process` except Voicebox, which is a local HTTP API)

The app **degrades gracefully** — each engine is independently probed (`lib/deps.js`, `GET /api/deps`) and only the step that needs it is disabled if missing:

| Engine | Used for | Called from |
|---|---|---|
| `ffmpeg` / `ffprobe` | every media operation | `lib/ffmpeg.js` |
| `whisper` (openai-whisper) or `whisper-cli` (whisper.cpp) | word-timed transcription/captions | `lib/transcribe.js` |
| `voicebox` (primary, local REST API on `127.0.0.1:17493` — app must be running), `voxcpm`, `piper`, `espeak-ng`, macOS `say` (fallback chain) | voiceover TTS | `lib/voiceover.js` |
| `yt-dlp` | downloading clipper source URLs | `lib/clipper.js` |
| `python3` + OpenCV | face/motion tracking for 9:16 reframe crop | `lib/clipper.js` (`TRACKER_PY` inline script) |
| `npx remotion render` | motion-graphics compositions | `server.js` (`/api/remotion/render`) |

When adding a new engine integration, follow the existing pattern: probe it in `lib/deps.js`, spawn it with a `run()`/`runFfmpeg()`-style helper that captures a tail of stdout/stderr for error messages, and make the calling step fail soft with an actionable install hint rather than crashing the server.

## Architecture

**Zero-framework HTTP server** (`server.js`): all routes are `if` checks against `req.method`/`url.pathname` in one big handler — there is no router. A single-page UI (`public/index.html`) drives everything through this API.

**Async job bus**: long-running work (transcribe, encode, clip, voiceover, render) runs via `runJob(kind, fn)`, which creates a job record in the in-memory `jobs` Map and returns a `job.id` immediately. Callers poll `GET /api/jobs/:id` or stream `GET /api/jobs/:id/events` (Server-Sent Events: `stage`, `log`, `progress`, `done`/`error`). Every `lib/*` pipeline function takes `onLog`/`onStage`/`onProgress` callbacks that `server.js` wires into `jlog`/`jstage`/`emit` — preserve this callback contract when adding new pipeline steps.

**Path safety**: `resolveInput()` only allows absolute/relative paths that already exist or fall inside `jobs/` or `output/` (`insideRoot()`), or `http(s)://` URLs (routed to `yt-dlp` in the clipper only). Uploaded files go through `safeName()`. Preserve this boundary when touching file-handling routes — don't let arbitrary filesystem paths reach `fs`/`ffmpeg` calls from client input.

**The pipeline** (`lib/` modules, one per stage, matching the product flow BRIEF → VISUALS → VOICE → ASSEMBLE → SCORE → EXPORT):
- `lib/clipper.js` — full auto-clipper: download (yt-dlp) → transcribe → pick moments (LLM via `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars, or the offline regex-based `HOOK_PATTERNS` hook-detector) → 9:16 reframe (OpenCV face/motion tracker → smoothed piecewise-linear ffmpeg crop expression, EMA-smoothed to avoid jitter) → cut + burn captions. Also has a CLI face at `clipper/clip.js`.
- `lib/voiceover.js` — TTS with an ordered fallback chain (VoxCPM → piper → espeak-ng → macOS `say`), first one available wins.
- `lib/assemble.js` — muxes visual + voiceover + Whisper word-timed captions into a CRF-18 mezzanine MP4. This is a *working* file, not the delivery encode.
- `lib/captions.js` — builds ASS subtitles with one `Dialogue` event per word (word-by-word pop-on style), two style presets (`impact`, `clean`).
- `lib/score.js` — attention curve. Two tiers: TRIBE v2 (external brain-response model, non-commercial license, never bundled — only invoked if `STUDIO_TRIBE_CMD` env var points at a local runner that prints `{"curve":[...]}`) and a built-in local proxy (`proxyCurve`) combining audio RMS energy, scene-cut density, and speech density into a smoothed 1s-resolution curve with dip detection.
- `lib/encode.js` — **"Metodologia Gabriel"**: the final Instagram delivery encode. VBV rate control is mandatory (never bare CRF for delivery); the rate-control profile (`selectProfile`) is chosen strictly from *measured* source duration (≤30s / 30–40s transition / ≥40s bands), never guessed. Includes a `riskScore()` pre-flight (flags 10-bit, HEVC, non-4:2:0 chroma, non-BT.709, high source bitrate, off-spec fps/resolution/audio codec as re-encode risk) and a post-encode `validate()` that re-probes the output file to check codec/profile/level/pix_fmt/resolution/color tags/bitrate ceiling/audio/GOP spacing — treat this as the source of truth for "did the encode actually meet spec," don't assume `buildArgs()` alone guarantees it.
- `remotion/src/scenes/` — `AutoKillReel` and `NeuralIntro` compositions (1080×1920), rendered on demand, not pre-built.

**Licensing boundary** (see `LICENSES.md`): app code and all bundled engines are commercially free to use. TRIBE v2 is the one deliberately-excluded piece (non-commercial research license) — never bundle it or hardcode a fetch of it; the existing self-install-instructions pattern in `lib/score.js` (`TRIBE_INFO`) is intentional and should be preserved for any similar restricted-license integration.
