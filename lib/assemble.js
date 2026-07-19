// assemble.js — stitch animation + voiceover + captions into one MP4
// (Step 5 of STUDIO-PROCESS). Output is a CRF-18 mezzanine; the delivery
// encode (VBV, Metodologia Gabriel) is the Export step.
'use strict';
const fs = require('fs');
const path = require('path');
const { transcribe } = require('./transcribe');
const { writeAss, subFilter } = require('./captions');
const { runFfmpeg, mediaInfo } = require('./ffmpeg');

async function assemble({ visual, voiceover = null, workDir, output,
  captions = true, captionStyle = 'impact', whisperModel = 'base',
  language = null, onLog = () => {}, onStage = () => {} }) {

  fs.mkdirSync(workDir, { recursive: true });
  const vInfo = await mediaInfo(visual);

  const vf = ['scale=1080:1920:flags=lanczos', 'fps=30'];
  let words = null;

  if (captions) {
    const capSource = voiceover || visual; // caption whatever carries the speech
    onStage('captions', 'Transcribing for word-timed captions');
    try {
      const tx = await transcribe(capSource, { model: whisperModel, language, workDir, onLog });
      words = tx.words;
      if (words.length) vf.push(subFilter(writeAss(words, workDir, { style: captionStyle })));
      fs.writeFileSync(path.join(workDir, 'transcript.json'), JSON.stringify(tx, null, 2));
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
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', output);

  await runFfmpeg(args, { onLog });
  return { output, duration: vInfo.duration, captionedWords: words ? words.length : 0 };
}

module.exports = { assemble };
