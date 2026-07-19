// transcribe.js — Whisper wrapper. Supports openai-whisper CLI and whisper.cpp.
// Output is normalized to: { text, words: [{word, start, end}], segments: [...] }
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runFfmpeg } = require('./ffmpeg');

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

async function extractWav(input, outDir) {
  const wav = path.join(outDir, 'audio-16k.wav');
  await runFfmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  return wav;
}

// openai-whisper: whisper audio.wav --model base --word_timestamps True --output_format json
async function viaOpenaiWhisper(wav, workDir, model, language, onLog) {
  const args = [wav, '--model', model, '--word_timestamps', 'True',
    '--output_format', 'json', '--output_dir', workDir];
  if (language) args.push('--language', language);
  await run('whisper', args, onLog);
  const jsonPath = path.join(workDir, path.basename(wav).replace(/\.wav$/, '.json'));
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const words = [];
  for (const seg of j.segments || []) {
    for (const w of seg.words || []) {
      words.push({ word: w.word.trim(), start: w.start, end: w.end });
    }
  }
  return { text: (j.text || '').trim(), words, segments: (j.segments || []).map(s => ({
    start: s.start, end: s.end, text: s.text.trim() })) };
}

// whisper.cpp: whisper-cli -m model.bin -ojf -of out audio.wav
async function viaWhisperCpp(wav, workDir, model, language, onLog) {
  const of = path.join(workDir, 'wcpp');
  const args = ['-f', wav, '-ojf', '-of', of];
  if (process.env.WHISPER_CPP_MODEL) args.push('-m', process.env.WHISPER_CPP_MODEL);
  if (language) args.push('-l', language);
  await run('whisper-cli', args, onLog);
  const j = JSON.parse(fs.readFileSync(of + '.json', 'utf8'));
  const words = [], segments = [];
  for (const seg of j.transcription || []) {
    segments.push({
      start: seg.offsets.from / 1000, end: seg.offsets.to / 1000, text: seg.text.trim(),
    });
    for (const t of seg.tokens || []) {
      if (t.text && !t.text.startsWith('[_')) {
        words.push({ word: t.text.trim(), start: t.offsets.from / 1000, end: t.offsets.to / 1000 });
      }
    }
  }
  return { text: segments.map(s => s.text).join(' '), words, segments };
}

async function transcribe(input, { model = 'base', language = null, workDir = null, onLog } = {}) {
  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'studio-tx-'));
  const wav = await extractWav(input, dir);
  try {
    return await viaOpenaiWhisper(wav, dir, model, language, onLog);
  } catch (e1) {
    try {
      return await viaWhisperCpp(wav, dir, model, language, onLog);
    } catch (e2) {
      throw new Error(
        'No Whisper engine available.\n' +
        `openai-whisper: ${e1.message.split('\n')[0]}\n` +
        `whisper.cpp: ${e2.message.split('\n')[0]}\n` +
        'Install one: pip install openai-whisper');
    }
  }
}

module.exports = { transcribe };
