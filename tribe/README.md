# TRIBE v2 runner (self-install)

This directory holds **glue only** — `tribe_runner.py`, the wrapper the app's
Score step calls. **The TRIBE v2 model is not here and is never bundled.**

TRIBE v2 (Algonauts 2025 brain-response model) is released under a
**NON-COMMERCIAL research license**. Per [`../LICENSES.md`](../LICENSES.md) this
project never ships it or auto-downloads it. You install it yourself, from the
official source, and evaluate it under its own terms — including deciding
whether your use is within that license.

## Setup

1. **Install TRIBE v2 yourself.** Find the official repository, create a venv,
   `pip install` its requirements, and download its weights from the official
   release. (This project bundles none of that.)

2. **Wire the runner to your install.** Open `tribe_runner.py` and fill in the
   two `TODO` sections — `load_model()` (load weights, once) and
   `infer_curve()` (run inference → one value in `[0,1]` per second).

3. **Point the app at it.** In your `.env` (never committed):

   ```
   STUDIO_TRIBE_CMD=python C:/Users/Usuario/Documents/GitHub/ai-video-studio/tribe/tribe_runner.py
   ```

   Use your venv's interpreter if you made one, e.g.
   `.../venv/Scripts/python.exe`. On Windows the app spawns the runner through
   `sh -c` (`lib/score.js`), so Git Bash's `sh` must be on `PATH` — it already
   is in this environment.

4. **Restart** `node server.js` and run the Score step. When the runner
   succeeds, the result's `kind` is `"tribe"` instead of `"proxy"`; if it errors
   for any reason, the app silently falls back to the built-in local proxy
   curve, so nothing breaks while you're still wiring it up.

## The contract (what the app requires)

- Invoked as `python tribe_runner.py "<video_path>"` — the video path is
  `sys.argv[1]`.
- **STDOUT must be exactly one JSON object and nothing else:**
  `{"curve":[{"t":0,"v":0.42}, ...]}` — `t` = integer second, `v` in `[0,1]`.
- Send all logging/progress/warnings to **STDERR**. Any stray STDOUT (a torch
  banner, a tqdm bar) corrupts the JSON and forces the proxy fallback.
- Exit `0` on success; non-zero (or empty/invalid STDOUT) triggers the fallback.

You can sanity-check the plumbing before TRIBE is installed:

```
python tribe/tribe_runner.py "some_clip.mp4"
```

Right now that prints a "not wired up yet" message to STDERR and exits 1 (clean
STDOUT) — exactly the shape the app treats as "fall back to proxy."
