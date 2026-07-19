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

async function detect() {
  const [ffmpeg, ffprobe, ytdlp, whisper, whisperCpp, voxcpm, python] =
    await Promise.all([
      probe('ffmpeg', ['-version']),
      probe('ffprobe', ['-version']),
      probe('yt-dlp', ['--version']),
      probe('whisper', ['--help']),          // openai-whisper CLI
      probe('whisper-cli', ['--help']),      // whisper.cpp
      probe('voxcpm', ['--help']),           // VoxCPM CLI (voiceover engine)
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
