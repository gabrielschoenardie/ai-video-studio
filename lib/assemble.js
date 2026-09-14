// assemble.js — stitch animation + voiceover + captions into one MP4
// (Step 5 of STUDIO-PROCESS). Output is a visually-lossless 4:4:4 mezzanine
// (CRF 12), the working input for the delivery encode (VBV, Metodologia
// Gabriel) done in the Export step — not the delivery encode itself. The
// mezzanine now carries video + voice only; captions travel alongside as a
// `.ass` file, burned by the Export step *after* the color grade (LUT must
// never touch graphics) unless `burnCaptions: true` restores the old
// behavior for callers that use this step in isolation.
'use strict';
const fs = require('fs');
const path = require('path');
const { transcribe } = require('./transcribe');
const { writeAss, subFilter, assDuration, resolveStyle } = require('./captions');
const { pickKeywords, applyHighlights } = require('./keywords');
const { runFfmpeg, mediaInfo } = require('./ffmpeg');
const { buildFit } = require('./encode');

const MEZZANINE_CRF = 12;   // visualmente lossless; 444 preserva a croma das legendas

async function assemble({ visual, voiceover = null, workDir, output,
  captions = true, captionStyle = 'impact', whisperModel = 'base',
  language = null, fit = 'blur', burnCaptions = false,
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

  onStage('mux', 'Assembling MP4');
  const args = ['-i', visual];
  if (voiceover) args.push('-i', voiceover);
  args.push('-vf', vf.join(','));
  if (voiceover) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(MEZZANINE_CRF),
    '-pix_fmt', 'yuv444p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', output);

  await runFfmpeg(args, { onLog });
  return {
    output, duration: vInfo.duration,
    captionedWords: words ? words.length : 0,
    ass: assPath ? path.relative(process.cwd(), assPath) : null,
    assDuration: words ? assDuration(words) : 0,
    burned: burnCaptions,
  };
}

module.exports = { assemble };
