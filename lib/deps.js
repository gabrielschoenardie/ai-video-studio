// deps.js — engine detection. The Studio degrades gracefully: every missing
// engine disables only its own step and the UI tells the user how to get it.
'use strict';
const { execFile } = require('child_process');

// PYTHONIOENCODING=utf-8 avoids a crash on Windows: Python defaults its
// stdout to the console's codepage (cp1252), and whisper/voxcpm --help
// output includes non-Latin-1 characters (e.g. CJK language names).
function probe(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false });
      const out = (stdout || stderr || '').split('\n')[0].trim();
      resolve({ ok: true, version: out.slice(0, 120) });
    });
  });
}

// Voicebox isn't a CLI — it's a local desktop app (Tauri) that exposes a
// REST API on 127.0.0.1:17493 once it's running. Probing it means hitting
// that endpoint rather than execFile-ing a binary.
const VOICEBOX_URL = process.env.VOICEBOX_URL || 'http://127.0.0.1:17493';
async function probeVoicebox() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${VOICEBOX_URL}/profiles`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false };
    return { ok: true, version: VOICEBOX_URL };
  } catch {
    return { ok: false };
  }
}

async function detect() {
  const [ffmpeg, ffprobe, ytdlp, whisper, whisperCpp, voicebox, voxcpm, python] =
    await Promise.all([
      probe('ffmpeg', ['-version']),
      probe('ffprobe', ['-version']),
      probe('yt-dlp', ['--version']),
      probe('whisper', ['--help']),          // openai-whisper CLI
      probe('whisper-cli', ['--help']),      // whisper.cpp
      probeVoicebox(),                       // Voicebox local server (voiceover engine, primary)
      probe('voxcpm', ['--help']),           // VoxCPM CLI (voiceover engine, fallback)
      probe('python3', ['--version']),
    ]);

  return {
    ffmpeg:  { ...ffmpeg,  install: 'https://ffmpeg.org/download.html' },
    ffprobe: { ...ffprobe, install: 'ships with ffmpeg' },
    ytdlp:   { ...ytdlp,   install: 'pip install yt-dlp' },
    whisper: {
      ok: whisper.ok || whisperCpp.ok,
      flavor: whisper.ok ? 'openai-whisper' : (whisperCpp.ok ? 'whisper.cpp' : null),
      install: 'pip install openai-whisper  (or build whisper.cpp)',
    },
    voicebox: { ...voicebox, install: 'download at voicebox.sh — MIT, runs entirely on-device, start the app before generating' },
    voxcpm:  { ...voxcpm,  install: 'pip install voxcpm  — Apache-2.0, runs locally' },
    python:  python,
    llm: {
      ok: !!process.env.LLM_BASE_URL,
      base: process.env.LLM_BASE_URL || null,
      model: process.env.LLM_MODEL || null,
      note: 'optional — set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL for AI moment-picking; offline hook-detector runs otherwise',
    },
  };
}

module.exports = { detect };
