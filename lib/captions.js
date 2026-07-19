// captions.js — word-by-word captions, the retention pattern from EDITING-CRAFT:
// each word pops exactly when spoken. Rendered as ASS and burned in with ffmpeg.
'use strict';
const fs = require('fs');
const path = require('path');

const STYLES = {
  // name → ASS style line fragments (1080x1920 canvas)
  impact: {
    font: 'Arial Black', size: 88, primary: '&H00FFFFFF', outline: '&H00000000',
    outlineW: 6, shadow: 0, bold: -1, marginV: 560, accent: '&H0088FF00', // BGR: #00ff88
  },
  clean: {
    font: 'Arial', size: 72, primary: '&H00FFFFFF', outline: '&H00000000',
    outlineW: 4, shadow: 1, bold: -1, marginV: 520, accent: '&H0000D7FF',
  },
};

function assTime(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60), cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Group words into short lines (<= maxWords), show line with the current word
// highlighted — one Dialogue event per word for exact-beat timing.
function buildAss(words, { style = 'impact', maxWords = 4, uppercase = true } = {}) {
  const S = STYLES[style] || STYLES.impact;
  const lines = [];
  for (let i = 0; i < words.length; i += maxWords) lines.push(words.slice(i, i + maxWords));

  let ev = '';
  for (const line of lines) {
    for (let wi = 0; wi < line.length; wi++) {
      const w = line[wi];
      const end = wi + 1 < line.length ? line[wi + 1].start : w.end + 0.12;
      const text = line.map((x, j) => {
        let t = x.word.replace(/[{}\\]/g, '');
        if (uppercase) t = t.toUpperCase();
        return j === wi
          ? `{\\c${S.accent}\\fscx108\\fscy108}${t}{\\c${S.primary}\\fscx100\\fscy100}`
          : t;
      }).join(' ');
      ev += `Dialogue: 0,${assTime(w.start)},${assTime(end)},Word,,0,0,0,,${text}\n`;
    }
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,${S.font},${S.size},${S.primary},&H000000FF,${S.outline},&H64000000,${S.bold},0,0,0,100,100,0,0,1,${S.outlineW},${S.shadow},2,60,60,${S.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev}`;
}

function writeAss(words, outDir, opts) {
  const file = path.join(outDir, 'captions.ass');
  fs.writeFileSync(file, buildAss(words, opts), 'utf8');
  return file;
}

// ffmpeg filter path escaping for subtitles=
function subFilter(assPath) {
  const esc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return `subtitles='${esc}'`;
}

module.exports = { buildAss, writeAss, subFilter, STYLES };
