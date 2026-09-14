// captions.js — word-by-word captions, the retention pattern from EDITING-CRAFT:
// each word pops exactly when spoken. Rendered as ASS and burned in with ffmpeg.
'use strict';
const fs = require('fs');
const path = require('path');

const STYLES_FILE = path.join(__dirname, '..', 'styles', 'captions.json');

// Usado só quando styles/captions.json some ou está corrompido. Declarado
// ANTES de loadStyles() de propósito — é o que ela usa no catch.
const FALLBACK_IMPACT = {
  font: 'Arial Black', size: 88, bold: true, italic: false,
  primary: '#FFFFFF', outline: '#000000', outlineW: 6, shadow: 0,
  layout: { maxWords: 4, uppercase: true },
  position: { align: 2, marginV: 560 },
  highlight: { channel: 'spoken', color: '#FFFF00', scale: 108 },
};

// Presets são dado, não código. Lidos uma vez e cacheados — um preset novo no
// JSON exige reiniciar o servidor, o que é aceitável para arquivo de config.
let STYLES = null;
function loadStyles() {
  if (STYLES) return STYLES;
  try {
    STYLES = JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8'));
  } catch (e) {
    // Fail-soft: sem o arquivo, a legenda ainda sai no preset embutido em vez de
    // derrubar o ASSEMBLE inteiro. Mas falhar em silêncio faz TODO preset virar
    // `impact` sem aviso — inclusive `clean`, que é válido. O log é o que torna a
    // corrupção diagnosticável.
    console.error(`[captions] ${STYLES_FILE} ilegível (${e.message}) — caindo no preset impact embutido; presets do JSON ficam indisponíveis`);
    STYLES = { impact: FALLBACK_IMPACT };
  }
  return STYLES;
}

function resolveStyle(name) {
  const all = loadStyles();
  // Mesmo filtro de styleNames(): `_` é metadado do arquivo, nunca preset.
  // Sem isto, resolveStyle('_nameNote') devolve a STRING da nota e a linha
  // Style sai com `undefined` em quatro campos — e o nome chega aqui vindo
  // do marcador `; studio-style: (S+)` do .ass, que casa `_nameNote`.
  const key = typeof name === 'string' && !name.startsWith('_') ? name : null;
  return (key && all[key]) || all.impact || FALLBACK_IMPACT;
}

// ASS usa &HAABBGGRR — ordem invertida em relação a #RRGGBB, e é onde erro
// silencioso de cor mora.
function assColor(hex) {
  const h = String(hex || '#FFFFFF').replace('#', '').trim();
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return ('&H00' + b + g + r).toUpperCase();
}

// `_` no nome da chave é convenção de metadado (ex. `_nameNote`, `_fontNote`),
// nunca preset — filtrado aqui para não vazar como opção falsa na UI.
function styleNames() { return Object.keys(loadStyles()).filter(k => !k.startsWith('_')); }

function assTime(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60), cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Group words into short lines (<= maxWords), show line with the current word
// highlighted — one Dialogue event per word for exact-beat timing.
function buildAss(words, { style = 'impact', maxWords, uppercase } = {}) {
  const S = resolveStyle(style);
  // Preset é dado escrito à mão: um bloco aninhado ausente não pode derrubar a
  // legenda inteira. Ausência vira default, não TypeError.
  const P = S.position || {};
  // Precedência: o que o chamador passa explicitamente vence o preset, e o preset
  // vence o default embutido. Sem default na desestruturação de propósito — com ele
  // não dá para distinguir "não passou" de "passou o mesmo valor do default".
  const maxW = maxWords != null ? maxWords : ((S.layout && S.layout.maxWords) || 4);
  const upper = uppercase != null ? uppercase : (S.layout ? S.layout.uppercase !== false : true);
  const lines = [];
  for (let i = 0; i < words.length; i += maxW) lines.push(words.slice(i, i + maxW));

  let ev = '';
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const nextStart = li + 1 < lines.length ? lines[li + 1][0].start : null;
    for (let wi = 0; wi < line.length; wi++) {
      const w = line[wi];
      let end = wi + 1 < line.length ? line[wi + 1].start : w.end + 0.12;
      // Don't let the trailing padding overlap the next line — overlapping
      // Dialogue events make libass stack them, causing a visible jump.
      if (wi === line.length - 1 && nextStart !== null) end = Math.min(end, nextStart);
      const channel = S.highlight ? (S.highlight.channel || 'spoken') : 'none';
      const text = line.map((x, j) => {
        let t = x.word.replace(/[{}\\]/g, '');
        if (upper) t = t.toUpperCase();
        if (channel === 'none') return t;
        if (channel === 'keyword') {
          // Semântico: a marca da palavra decide, não a posição. Nenhum
          // tratamento posicional é aplicado, qualquer que seja maxWords.
          if (!x.hl) return t;
          // Pontuação de borda fica FORA da cor: "ARREPENDER." destaca a
          // palavra, não o ponto. Símbolo de moeda e hífen NÃO entram nesta
          // lista de propósito — fazem parte da palavra ("R$", "pós-venda").
          const m = /^([¿¡"'«(\[]*)([\s\S]*?)([.,!?;:…"'»)\]]*)$/u.exec(t);
          const pre = m[1], core = m[2], post = m[3];
          if (!core) return t;   // token só de pontuação: não há o que destacar
          return `${pre}{\\c${assColor(S.highlight.color)}}${core}{\\c${assColor(S.primary)}}${post}`;
        }
        // 'spoken' — comportamento histórico, intocado
        return j === wi
          ? `{\\c${assColor(S.highlight.color)}\\fscx${S.highlight.scale}\\fscy${S.highlight.scale}}${t}{\\c${assColor(S.primary)}\\fscx100\\fscy100}`
          : t;
      }).join(' ');
      // Duas formas de posicionar, e a presença de x/y decide: coordenada
      // exata via \pos (preciso, necessário para 63% da altura) ou MarginV na
      // linha Style (caminho histórico, o que preserva o byte-a-byte).
      let pre = '';
      if (P.x != null && P.y != null) pre += `{\\an${P.align || 5}\\pos(${P.x},${P.y})}`;
      if (S.enter && S.enter.fromScale != null) {
        const f = S.enter.fromScale, ms = S.enter.ms || 180;
        pre += `{\\fscx${f}\\fscy${f}\\t(0,${ms},\\fscx100\\fscy100)}`;
      }
      ev += `Dialogue: 0,${assTime(w.start)},${assTime(end)},Word,,0,0,0,,${pre}${text}\n`;
    }
  }

  return `[Script Info]
ScriptType: v4.00+
; studio-style: ${style}
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,${S.font},${S.size},${assColor(S.primary)},&H000000FF,${assColor(S.outline)},&H64000000,${S.bold ? -1 : 0},${S.italic ? -1 : 0},0,0,100,100,0,0,1,${S.outlineW},${S.shadow},${P.align != null ? P.align : 2},60,60,${P.marginV != null ? P.marginV : 0},1

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

// End time of the last word, in seconds (0 for an empty array). Used by the
// Export step to sanity-check for desync once burning moved out of Assemble.
function assDuration(words) {
  if (!words || !words.length) return 0;
  return words[words.length - 1].end;
}

module.exports = { buildAss, writeAss, subFilter, assDuration, resolveStyle, styleNames, assColor };
