#!/usr/bin/env python3
"""
tribe_runner.py — glue between AI Video Studio's Score step and a locally
installed TRIBE v2 (brain-response) model.

  * NOT the model. This is the thin wrapper the app calls. TRIBE v2 itself is a
    NON-COMMERCIAL research release that you install yourself (see LICENSES.md
    and the install notes printed by the Score step). This file bundles nothing.

Contract expected by lib/score.js -> tribeCurve():
  * Invoked as:  python /path/to/tribe_runner.py "<video_path>"
      (the app builds STUDIO_TRIBE_CMD + the JSON-quoted video path and runs it
       via `sh -c`; the video path arrives as sys.argv[1].)
  * MUST print to STDOUT exactly one JSON object and nothing else:
        {"curve":[{"t":0,"v":0.42},{"t":1,"v":0.55}, ...]}
    - t: integer second (0-based)
    - v: attention/engagement in [0.0, 1.0]
  * Exit code 0 on success. Any non-zero exit, empty stdout, or non-JSON stdout
    makes the app silently fall back to the built-in local proxy curve — so
    keep STDOUT clean: send ALL logging / progress / warnings to STDERR.

Wire-up once TRIBE is installed:
  1. pip install TRIBE's requirements into a venv; download its weights.
  2. Fill in the two TODO sections below (load_model + infer_curve).
  3. In .env:  STUDIO_TRIBE_CMD=python C:/Users/Usuario/Documents/GitHub/ai-video-studio/tribe/tribe_runner.py
     (use the venv's python if you made one, e.g. .../venv/Scripts/python.exe)
  4. Restart `node server.js` and run the Score step — score.kind will be
     "tribe" instead of "proxy" when this runner succeeds.
"""

import sys
import os
import json
import subprocess


def log(*a):
    """Diagnostics go to STDERR — STDOUT is reserved for the JSON result."""
    print(*a, file=sys.stderr, flush=True)


def video_duration_seconds(path):
    """Source-of-truth duration via ffprobe (already a project dependency).

    Used to size the curve so it spans the whole clip at 1s resolution, even
    if the model works on a different internal grid.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def load_model():
    """Load TRIBE v2 weights once. Return whatever object infer_curve needs.

    ── TODO (you) ─────────────────────────────────────────────────────────────
    Import TRIBE here and load its weights. Point at the local release you
    downloaded — do NOT fetch anything at runtime. Example shape:

        import torch
        from tribe import TribeV2                      # <- TRIBE's real import
        weights = os.environ.get(
            "TRIBE_WEIGHTS",
            r"C:/models/tribe-v2/weights.pt",          # your downloaded weights
        )
        model = TribeV2.from_pretrained(weights)
        model.eval()
        return model

    Keep every load-time print/tqdm on STDERR (redirect if the library is
    chatty — see the guard in main()).
    ───────────────────────────────────────────────────────────────────────────
    """
    raise NotImplementedError(
        "TRIBE v2 not wired up yet — fill in load_model() with your local "
        "install. See the TODO in tribe/tribe_runner.py."
    )


def infer_curve(model, video_path, duration):
    """Run TRIBE inference and return a list[float] in [0,1], one value/second.

    ── TODO (you) ─────────────────────────────────────────────────────────────
    Call TRIBE on `video_path`, then resample/aggregate its output to one
    scalar per whole second across `duration`. Example shape:

        raw = model.predict(video_path)     # e.g. per-frame or per-TR response
        per_sec = resample_to_1s(raw, duration)   # your aggregation
        return [clamp01(x) for x in per_sec]

    Length should be ceil(duration) values. If TRIBE returns something already
    normalized, just clamp; otherwise min-max normalize across the clip so the
    Score UI's dip detection is comparable to the proxy curve.
    ───────────────────────────────────────────────────────────────────────────
    """
    raise NotImplementedError(
        "TRIBE v2 not wired up yet — fill in infer_curve() with your local "
        "install. See the TODO in tribe/tribe_runner.py."
    )


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else float(x)


def to_contract(values):
    """list[float] -> the JSON the app expects."""
    return {"curve": [{"t": i, "v": round(clamp01(v), 3)} for i, v in enumerate(values)]}


def main():
    if len(sys.argv) < 2:
        log("usage: tribe_runner.py <video_path>")
        return 2

    video_path = sys.argv[1]
    if not os.path.isfile(video_path):
        log(f"video not found: {video_path}")
        return 2

    try:
        duration = video_duration_seconds(video_path)
    except Exception as e:  # ffprobe missing / unreadable file
        log(f"ffprobe failed: {e}")
        return 1

    try:
        model = load_model()
        values = infer_curve(model, video_path, duration)
    except NotImplementedError as e:
        log(str(e))
        return 1
    except Exception as e:
        log(f"TRIBE inference failed: {e}")
        return 1

    if not values:
        log("infer_curve returned no values")
        return 1

    # STDOUT: exactly the JSON, nothing before or after it.
    sys.stdout.write(json.dumps(to_contract(values)))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
