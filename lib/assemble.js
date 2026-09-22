// assemble.js — stitch animation + voiceover + captions into one MP4
// (Step 5 of STUDIO-PROCESS). Output is a visually-lossless 4:4:4 mezzanine
// (CRF 12), the working input for the delivery encode (VBV, Metodologia
// Gabriel) done in the Export step — not the delivery encode itself. The
// mezzanine now carries video + voice only; captions travel alongside as a
// `.ass` file, burned by the Export step *after* the color grade (LUT must
// never touch graphics) unless `burnCaptions: true` restores the old
// behavior for callers that use this step in isolation.
//
// The voice leaves this step at the Reel target level (-16 LUFS integrated,
// true peak -2 dBTP, the master limiter's ceiling in lib/timeline.js, so the
// voice alone never triggers it): the TIMELINE sets music and SFX relative to it, and the
// voice the pipeline produces comes out 6 to 11 LU below that. Two loudnorm
// passes — measure, then apply the measured values with linear=true (a fixed
// gain when it fits under the ceiling; loudnorm falls back to its dynamic mode
// on its own when it does not). Never fatal: without a usable measurement the
// file is assembled un-normalized and `voice.reason` says why.
'use strict';
const fs = require('fs');
const path = require('path');
const { transcribe } = require('./transcribe');
const { writeAss, subFilter, assDuration, resolveStyle } = require('./captions');
const { pickKeywords, applyHighlights } = require('./keywords');
const { runFfmpeg, mediaInfo } = require('./ffmpeg');
const { buildFit } = require('./encode');

const MEZZANINE_CRF = 12;   // visualmente lossless; 444 preserva a croma das legendas
const VOICE_TARGET = 'I=-16:TP=-2:LRA=9';

// loudnorm prints its measurement as a JSON block on stderr, after a
// "[Parsed_loudnorm_0 @ …]" line. The last block wins (the apply pass prints one too).
function parseLoudnormJson(stderr) {
  const blocks = String(stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) return null;
  try { return JSON.parse(blocks[blocks.length - 1]); } catch (e) { return null; }
}
async function measureVoice(src) {
  let log = '';
  try {
    await runFfmpeg(['-nostats', '-i', src, '-map', '0:a:0',
      '-af', `loudnorm=${VOICE_TARGET}:print_format=json`, '-f', 'null', '-'],
      { onLog: s => { log += s; } });
  } catch (e) { return null; }
  return parseLoudnormJson(log);
}

async function assemble({ visual, voiceover = null, workDir, output,
  captions = true, captionStyle = 'impact', whisperModel = 'base',
  language = null, fit = 'blur', burnCaptions = false, normalizeVoice = true,
  onLog = () => {}, onStage = () => {} }) {

  fs.mkdirSync(workDir, { recursive: true });
  const vInfo = await mediaInfo(visual);

  const vf = [buildFit(fit, ':flags=lanczos'), 'fps=30'];
  let words = null;
  let assPath = null;

  if (captions) {
    const capSource = voiceover || visual; // caption whatever carries the speech
    onStage('captions', 'Transcribing for word-timed captions');
    try {
      const tx = await transcribe(capSource, { model: whisperModel, language, workDir, onLog });
      words = tx.words;
      const S = resolveStyle(captionStyle);
      if (words.length) {
        // Porta de custo: só gasta chamada de LLM se o preset realmente
        // desenha destaque semântico. Quem usa impact/clean não paga nada.
        if (S.highlight && S.highlight.channel === 'keyword') {
          onStage('keywords', 'Escolhendo palavras-chave');
          // `try` próprio de propósito: o destaque é enfeite. Se ele falhar, a
          // legenda ainda sai — sem destaque. Deixá-lo no `try` de fora faria
          // uma falha aqui descartar a legenda INTEIRA e o transcript junto.
          try {
            const { indices, source } = await pickKeywords(tx, { onLog });
            words = applyHighlights(words, indices);
            tx.words = words;
            onLog(`[captions] destaque semântico via ${source}\n`);
          } catch (e) {
            onLog(`[captions] destaque semântico falhou (${e.message.split('\n')[0]}) — legenda segue sem destaque\n`);
          }
        }
      }
      // O transcript é o dado, o .ass é derivado — perder o derivado é
      // degradação, perder o dado é perda. Por isso este write vem ANTES do
      // writeAss: uma falha ali (preset malformado, disco cheio) não pode
      // levar o transcript.json junto. Roda nos dois casos (words vazio ou
      // não), então fica fora do `if` seguinte, que só cuida do .ass.
      fs.writeFileSync(path.join(workDir, 'transcript.json'), JSON.stringify(tx, null, 2));
      if (words.length) {
        onLog(`[captions] preset ${captionStyle} — fonte pedida: ${S.font}\n`);
        assPath = writeAss(words, workDir, { style: captionStyle });
        if (burnCaptions) vf.push(subFilter(assPath));
      }
    } catch (e) {
      onLog(`[captions] skipped — ${e.message.split('\n')[0]}\n`);
    }
  }

  // The voice is the narration when there is one, else the visual's own audio.
  const voice = { normalized: false, lufsIn: null, lufsOut: null, mode: null, reason: null };
  const voiceSrc = voiceover || (vInfo.acodec ? visual : null);
  let af = null;
  if (!normalizeVoice) voice.reason = 'desligada';
  else if (!voiceSrc) voice.reason = 'sem faixa de voz';
  else {
    onStage('voice', 'Medindo o nível da voz');
    const m = await measureVoice(voiceSrc);
    const i = m ? parseFloat(m.input_i) : NaN;
    if (!m) voice.reason = 'medição falhou';
    else if (!Number.isFinite(i) || i <= -70) voice.reason = 'voz em silêncio';
    else {
      voice.lufsIn = Math.round(i * 10) / 10;
      af = `loudnorm=${VOICE_TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
        `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}` +
        ':linear=true:print_format=json';
    }
  }

  onStage('mux', 'Assembling MP4');
  // -ar 44100 below also undoes loudnorm's internal 192 kHz resampling.
  const muxArgs = (audioFilter) => {
    const args = ['-i', visual];
    if (voiceover) args.push('-i', voiceover);
    args.push('-vf', vf.join(','));
    if (audioFilter) args.push('-af', audioFilter);
    if (voiceover) {
      args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
      '-pix_fmt', 'yuv444p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', output);
    return args;
  };

  let muxLog = '';
  try {
    await runFfmpeg(muxArgs(af), { onLog: s => { if (af) muxLog += s; onLog(s); } });
  } catch (e) {
    if (!af) throw e;
    // the normalization must never cost the assemble: retry without it
    onLog(`[voice] loudnorm falhou na montagem — ${String(e.message || e).split('\n')[0]}; montando sem normalizar\n`);
    voice.reason = 'loudnorm falhou na montagem';
    af = null;
    await runFfmpeg(muxArgs(null), { onLog });
  }
  if (af) {
    const o = parseLoudnormJson(muxLog);
    const out = o ? parseFloat(o.output_i) : NaN;
    voice.normalized = true;
    voice.lufsOut = Number.isFinite(out) ? Math.round(out * 10) / 10 : null;
    voice.mode = (o && o.normalization_type) || null;
    onLog(`[voice] ${voice.lufsIn} → ${voice.lufsOut} LUFS (${voice.mode})\n`);
  } else {
    onLog(`[voice] sem normalização — ${voice.reason}\n`);
  }
  return {
    output, duration: vInfo.duration,
    captionedWords: words ? words.length : 0,
    ass: assPath ? path.relative(process.cwd(), assPath) : null,
    assDuration: words ? assDuration(words) : 0,
    burned: burnCaptions,
    voice,
  };
}

module.exports = { assemble, parseLoudnormJson, VOICE_TARGET };
