// voiceover.js — local TTS. Primary engine: VoxCPM (Apache-2.0, on-device,
// voice cloning capable). Fallbacks: piper, espeak-ng, macOS `say` — so the
// pipeline still produces a scratch narration on any machine.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// PYTHONIOENCODING=utf-8 avoids a crash on Windows: Python defaults its
// stdout to the console's codepage (cp1252), which can't encode all
// characters VoxCPM (Python) may print.
function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let tail = '';
    const grab = b => { const s = b.toString(); tail = (tail + s).slice(-4000); if (onLog) onLog(s); };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    p.on('error', reject);
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}\n${tail}`)));
  });
}

async function generate(script, outDir, { refVoice = null, onLog } = {}) {
  const wav = path.join(outDir, 'voiceover.wav');
  const txt = path.join(outDir, 'vo-script.txt');
  fs.writeFileSync(txt, script, 'utf8');

  const attempts = [];

  // 1) VoxCPM CLI
  attempts.push(async () => {
    const args = ['--text', script, '--output', wav];
    if (refVoice) args.push('--prompt-audio', refVoice);
    await run('voxcpm', args, onLog);
    return { engine: 'voxcpm', file: wav };
  });

  // 2) piper (fast local neural TTS)
  attempts.push(async () => {
    await run('sh', ['-c',
      `piper --output_file ${JSON.stringify(wav)} < ${JSON.stringify(txt)}`], onLog);
    return { engine: 'piper', file: wav };
  });

  // 3) espeak-ng (robotic, but proves the pipeline)
  attempts.push(async () => {
    await run('espeak-ng', ['-f', txt, '-w', wav, '-s', '155'], onLog);
    return { engine: 'espeak-ng (scratch quality — install VoxCPM for the real voice)', file: wav };
  });

  // 4) macOS say
  attempts.push(async () => {
    const aiff = wav.replace(/\.wav$/, '.aiff');
    await run('say', ['-f', txt, '-o', aiff], onLog);
    await run('ffmpeg', ['-hide_banner', '-y', '-i', aiff, wav], onLog);
    return { engine: 'macOS say (scratch quality)', file: wav };
  });

  const errors = [];
  for (const fn of attempts) {
    try { return await fn(); } catch (e) { errors.push(e.message.split('\n')[0]); }
  }
  throw new Error('No TTS engine found. Install VoxCPM (pip install voxcpm).\n' + errors.join('\n'));
}

module.exports = { generate };
