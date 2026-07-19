---
name: engine-check
description: Check which optional local engines (ffmpeg, whisper, VoxCPM, yt-dlp, python3+OpenCV) are installed and available to AI Video Studio. Use when asked "are my engines installed?", "what's missing?", "why is a step disabled?", or before relying on a pipeline step that needs an external CLI.
---

# Engine check

AI Video Studio degrades gracefully: every pipeline step depends on an
external CLI engine that is optional and independently probed. This skill
reports what's installed and what's missing, matching the exact detection
logic in `lib/deps.js`.

## Steps

1. Prefer hitting the running server if it's up:
   ```bash
   curl -s http://localhost:4870/api/deps | node -e "process.stdin.pipe(require('fs').createWriteStream('/dev/stdout'))"
   ```
   (or just `curl -s http://localhost:4870/api/deps` and pretty-print the JSON)

2. If the server isn't running, run the standalone check instead:
   ```bash
   node clipper/check-deps.js
   ```
   This calls the same `lib/deps.js` → `detect()` function directly, no server needed.

3. Present results as a table: engine → ok/missing → install hint (from the
   `install` field each probe already returns) → which pipeline step it
   powers (see the table in `CLAUDE.md` under "External engines").

4. For the `llm` entry, note it's judged by whether `LLM_BASE_URL` is set in
   the environment (`process.env.LLM_BASE_URL`), not by probing a binary —
   if unset, the clipper falls back to the offline regex hook-detector
   automatically, so a "missing" LLM entry is not an error, just a mode.

## Notes

- Don't hardcode a duplicate list of engines/install commands — always read
  current values from the `/api/deps` response or `check-deps.js` output, so
  this stays correct if `lib/deps.js` changes.
- If a specific pipeline step is failing, cross-reference its required
  engine(s) from the "External engines" table in `CLAUDE.md` rather than
  guessing.
