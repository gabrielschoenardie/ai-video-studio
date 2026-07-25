// download.js — fetch a video from a URL at the best available resolution
// via yt-dlp. Standalone source-acquisition tool (the auto-clipper caps at
// 1080p and always cuts; this keeps the full-resolution file as an asset).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Same spawn helper shape as lib/clipper.js: streams stdout+stderr to onLog,
// keeps a 4000-char tail for the error message, resolves only on exit 0.
function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let tail = '';
    const grab = b => { const s = b.toString(); tail = (tail + s).slice(-4000); if (onLog) onLog(s); };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    p.on('error', reject);
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}\n${tail}`)));
  });
}

// yt-dlp format selector per requested quality. 'best' is uncapped (true best
// available); the caps are convenience escape hatches for large 4K/8K sources.
const FORMATS = {
  best: 'bv*+ba/b',
  '1080': 'bv*[height<=1080]+ba/b[height<=1080]/b',
  '720': 'bv*[height<=720]+ba/b[height<=720]/b',
};

// download(url, opts) -> { file }  (absolute path to the produced .mp4)
//   opts: { outDir, quality='best', onLog, onProgress }
//   onProgress receives { pct:Number, speed:String|null } scraped from yt-dlp.
async function download(url, { outDir, quality = 'best', onLog, onProgress } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('download() needs an http(s) URL');
  fs.mkdirSync(outDir, { recursive: true });
  const fmt = FORMATS[quality] || FORMATS.best;
  const base = 'dl-' + path.basename(outDir);          // deterministic, ASCII-safe
  const out = path.join(outDir, base + '.%(ext)s');

  // Wrap onLog so it forwards raw text AND scrapes [download] NN% progress.
  const rx = /\[download\]\s+([\d.]+)%(?:.*?at\s+(\S+))?/;
  const tap = s => {
    if (onLog) onLog(s);
    if (onProgress) {
      const m = rx.exec(s);
      if (m) onProgress({ pct: parseFloat(m[1]), speed: m[2] || null });
    }
  };

  await run('yt-dlp', ['-f', fmt, '--merge-output-format', 'mp4', '-o', out, url], tap);

  const found = fs.readdirSync(outDir).find(f => f.startsWith(base + '.'));
  if (!found) throw new Error('yt-dlp finished but no file was produced');
  return { file: path.join(outDir, found) };
}

module.exports = { download };
