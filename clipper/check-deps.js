#!/usr/bin/env node
// clipper/check-deps.js — one-time environment check for the auto-clipper.
'use strict';
require('../lib/loadEnv').loadEnv();
const { detect } = require('../lib/deps');

(async () => {
  console.log('\n  ✂  auto-clipper — dependency check\n');
  const d = await detect();
  const row = (name, r, required) => {
    const mark = r.ok ? '✓' : (required ? '✗' : '○');
    const note = r.ok ? (r.version || r.flavor || 'ok') : `missing — ${r.install || ''}`;
    console.log(`  ${mark}  ${name.padEnd(10)} ${note}`);
  };
  row('ffmpeg', d.ffmpeg, true);
  row('ffprobe', d.ffprobe, true);
  row('whisper', d.whisper, true);
  row('yt-dlp', d.ytdlp, false);
  row('python3', d.python, false);
  console.log(d.llm.ok
    ? `  ✓  LLM        ${d.llm.base} (${d.llm.model || 'default model'})`
    : '  ○  LLM        not set — offline hook-detector will run (' + d.llm.note + ')');
  console.log('');
  const ok = d.ffmpeg.ok && d.ffprobe.ok && d.whisper.ok;
  console.log(ok
    ? '  ready. run:  node clip.js\n'
    : '  install the missing ✗ items above, then re-run.\n');
  process.exit(ok ? 0 : 1);
})();
