// voiceover.js — local TTS. Primary engine: Voicebox (MIT, on-device, voice
// cloning capable) — a desktop app that must already be running, reached via
// its local REST API. Fallbacks: piper, espeak-ng, macOS `say` — so the
// pipeline still produces a scratch narration on any machine.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const VOICEBOX_URL = process.env.VOICEBOX_URL || 'http://127.0.0.1:17493';
// Studio default: pt-BR. Kokoro's "p" voice prefix is Brazilian Portuguese
// (Kokoro-82M language codes: a=US English, b=UK English, p=Brazilian
// Portuguese, ...) — verified against /profiles/presets/kokoro, which lists
// pf_dora/pm_alex/pm_santa as the pt voices.
const VOICEBOX_LANGUAGE = process.env.VOICEBOX_LANGUAGE || 'pt';
const VOICEBOX_DEFAULT_ENGINE = 'kokoro';
const VOICEBOX_DEFAULT_VOICE = 'pm_alex';
// The 3 pt-BR preset voices Kokoro ships (from /profiles/presets/kokoro) —
// listed here so the UI can offer a picker without round-tripping to
// Voicebox first.
const VOICEBOX_PT_VOICES = [
  { id: 'pf_dora', name: 'Dora', gender: 'female' },
  { id: 'pm_alex', name: 'Alex', gender: 'male' },
  { id: 'pm_santa', name: 'Santa', gender: 'male' },
];
// Profile name encodes engine+voice so picking a different voice, or
// changing the default above, provisions its own profile instead of
// reusing one created for a different voice.
const voiceboxProfileName = voiceId => `ai-video-studio-${VOICEBOX_DEFAULT_ENGINE}-${voiceId}`;

async function voiceboxJson(pathname, method, body) {
  const res = await fetch(`${VOICEBOX_URL}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`voicebox ${method} ${pathname} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Voice cloning needs a transcript of the reference sample (Voicebox's
// /profiles/{id}/samples requires reference_text) — reuse the Studio's own
// whisper wrapper to get one rather than asking the caller for it.
// Returns { id, engine } — a preset profile is locked to the engine it was
// created with (POST /generate rejects any other engine for it), and a
// cloned profile has no such constraint (its default_engine is null, so we
// let Voicebox use its own default rather than forcing one).
async function voiceboxProfileForRefVoice(refVoice, onLog) {
  const name = `clone:${path.basename(refVoice)}`;
  const list = await voiceboxJson('/profiles', 'GET');
  const existing = list.find(p => p.name === name);
  if (existing) return { id: existing.id, engine: existing.default_engine };

  if (onLog) onLog(`voicebox: cloning voice from ${refVoice}...\n`);
  const created = await voiceboxJson('/profiles', 'POST', { name, voice_type: 'cloned' });

  const { transcribe } = require('./transcribe');
  const { text: referenceText } = await transcribe(refVoice, { onLog });

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(refVoice)]), path.basename(refVoice));
  form.append('reference_text', referenceText || '');
  const res = await fetch(`${VOICEBOX_URL}/profiles/${created.id}/samples`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`voicebox sample upload HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { id: created.id, engine: created.default_engine };
}

async function voiceboxPresetProfile(voiceId) {
  const name = voiceboxProfileName(voiceId);
  const list = await voiceboxJson('/profiles', 'GET');
  const existing = list.find(p => p.name === name);
  if (existing) return { id: existing.id, engine: existing.default_engine };

  const presets = await voiceboxJson(`/profiles/presets/${VOICEBOX_DEFAULT_ENGINE}`, 'GET');
  const voice = (presets.voices || []).find(v => v.voice_id === voiceId);
  if (!voice) throw new Error(`voicebox: preset voice "${voiceId}" not available for ${VOICEBOX_DEFAULT_ENGINE}`);

  const created = await voiceboxJson('/profiles', 'POST', {
    name, voice_type: 'preset', language: VOICEBOX_LANGUAGE,
    preset_engine: VOICEBOX_DEFAULT_ENGINE, preset_voice_id: voice.voice_id,
  });
  return { id: created.id, engine: created.default_engine };
}

// /generate is async: it returns status "loading_model"/"generating" first
// (a first-ever call on a preset/engine downloads model weights, which can
// take minutes), so poll /history/:id until "completed"/"failed", then pull
// the bytes from /audio/:id.
async function voiceboxGenerate(script, wav, refVoice, voice, onLog) {
  const profile = refVoice
    ? await voiceboxProfileForRefVoice(refVoice, onLog)
    : await voiceboxPresetProfile(voice || VOICEBOX_DEFAULT_VOICE);

  let gen = await voiceboxJson('/generate', 'POST', {
    profile_id: profile.id, text: script, language: VOICEBOX_LANGUAGE,
    ...(profile.engine ? { engine: profile.engine } : {}),
  });
  const deadline = Date.now() + 5 * 60 * 1000;
  while (gen.status !== 'completed' && gen.status !== 'failed') {
    if (Date.now() > deadline) throw new Error('voicebox generation timed out (model still downloading?)');
    await new Promise(r => setTimeout(r, 2000));
    gen = await voiceboxJson(`/history/${gen.id}`, 'GET');
    if (onLog) onLog(`voicebox: ${gen.status}\n`);
  }
  if (gen.status === 'failed') throw new Error(`voicebox generation failed: ${gen.error || 'unknown error'}`);

  const audioRes = await fetch(`${VOICEBOX_URL}/audio/${gen.id}`);
  if (!audioRes.ok) throw new Error(`voicebox audio fetch HTTP ${audioRes.status}`);
  fs.writeFileSync(wav, Buffer.from(await audioRes.arrayBuffer()));
  if (onLog) onLog('voicebox: generated ' + wav + '\n');
}

// PYTHONIOENCODING=utf-8 avoids a crash on Windows: Python defaults its
// stdout to the console's codepage (cp1252), which can't encode all
// characters some TTS engines (Python-based) may print.
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

async function generate(script, outDir, { refVoice = null, voice = null, onLog } = {}) {
  const wav = path.join(outDir, 'voiceover.wav');
  const txt = path.join(outDir, 'vo-script.txt');
  fs.writeFileSync(txt, script, 'utf8');

  const attempts = [];

  // 1) Voicebox (local desktop app, MIT, must already be running)
  attempts.push({ name: 'voicebox', fn: async () => {
    await voiceboxGenerate(script, wav, refVoice, voice, onLog);
    return { engine: 'voicebox', file: wav };
  }});

  // 2) piper (fast local neural TTS)
  attempts.push({ name: 'piper', fn: async () => {
    await run('sh', ['-c',
      `piper --output_file ${JSON.stringify(wav)} < ${JSON.stringify(txt)}`], onLog);
    return { engine: 'piper', file: wav };
  }});

  // 3) espeak-ng (robotic, but proves the pipeline)
  attempts.push({ name: 'espeak-ng', fn: async () => {
    await run('espeak-ng', ['-f', txt, '-w', wav, '-s', '155'], onLog);
    return { engine: 'espeak-ng (scratch quality — install Voicebox for the real voice)', file: wav };
  }});

  // 4) macOS say
  attempts.push({ name: 'say', fn: async () => {
    const aiff = wav.replace(/\.wav$/, '.aiff');
    await run('say', ['-f', txt, '-o', aiff], onLog);
    await run('ffmpeg', ['-hide_banner', '-y', '-i', aiff, wav], onLog);
    return { engine: 'macOS say (scratch quality)', file: wav };
  }});

  const errors = [];
  for (const { name, fn } of attempts) {
    if (onLog) onLog(`trying ${name}...\n`);
    try {
      return await fn();
    } catch (e) {
      const msg = e.message.split('\n')[0];
      if (onLog) onLog(`${name} failed: ${msg}\n`);
      errors.push(`${name}: ${msg}`);
    }
  }
  throw new Error('No TTS engine found. Install Voicebox (voicebox.sh) and make sure it is running.\n' + errors.join('\n'));
}

module.exports = { generate, VOICEBOX_PT_VOICES };
