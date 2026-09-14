// keywords.js — escolhe qual palavra de cada frase recebe o destaque semântico.
// Julgamento aqui, render determinístico em captions.js. A cadeia degrada:
// LLM quando configurado, heurística local caso contrário — nunca "sem destaque".
'use strict';

const { llmChat } = require('./llm');

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','do','da','dos','das','em','no','na','nos','nas',
  'por','pelo','pela','para','pra','com','sem','sob','sobre','ate','até','e','ou','mas','que','se',
  'eu','tu','ele','ela','nos','nós','voce','você','voces','vocês','eles','elas','meu','minha','seu','sua',
  'isso','isto','aquilo','este','esta','esse','essa','aquele','aquela','ao','aos','à','às','já','ja',
  'muito','muita','muitos','muitas','todo','toda','todos','todas','cada','bastante','bastantes',
  'the','a','an','of','to','in','on','at','for','with','and','or','but','if','is','are','was','were',
  'it','this','that','these','those','you','your','we','our','they','their','be','been','as','so',
]);

const NUMERIC = /[0-9]/;

// Uma palavra-chave por segmento do Whisper. Segmento de <= 2 palavras não
// recebe destaque: colorir a única palavra da tela não destaca nada.
const MIN_WORDS_PER_SEGMENT = 3;
const MIN_LONG_WORD = 6;
const MIN_NUMERIC_LEN = 2;   // "1" ou "-1-" não são destaque; "80%", "3x", "2024" são

function normalize(w) {
  return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function isStop(w) { return STOPWORDS.has(normalize(w)); }

// Índices (no array global `words`) que caem dentro de um segmento.
function wordsInSegment(words, seg) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start >= seg.start - 1e-6 && w.start < seg.end - 1e-6) out.push(i);
  }
  return out;
}

// Prioridade: número > palavra longa não-stopword > última de conteúdo > nada.
function pickInSegment(words, idxs) {
  if (idxs.length < MIN_WORDS_PER_SEGMENT) return null;
  const numeric = idxs.find(i => NUMERIC.test(words[i].word)
    && normalize(words[i].word).length >= MIN_NUMERIC_LEN);
  if (numeric != null) return numeric;
  let best = null, bestLen = 0;
  for (const i of idxs) {
    const n = normalize(words[i].word);
    if (n.length >= MIN_LONG_WORD && !isStop(words[i].word) && n.length > bestLen) {
      best = i; bestLen = n.length;
    }
  }
  if (best != null) return best;
  for (let k = idxs.length - 1; k >= 0; k--) {
    const w = words[idxs[k]].word;
    if (isStop(w)) continue;
    // Um número sem substância já foi recusado pela via numérica acima. Deixá-lo
    // vencer aqui, por posição, recria exatamente o defeito que aquela guarda
    // existe para impedir. Palavra curta NÃO-numérica (é, vi, há) segue valendo.
    if (NUMERIC.test(w) && normalize(w).length < MIN_NUMERIC_LEN) continue;
    return idxs[k];
  }
  return null;
}

function pickOffline(transcript) {
  const words = (transcript && transcript.words) || [];
  const segments = (transcript && transcript.segments) || [];
  const out = new Set();
  for (const seg of segments) {
    const hit = pickInSegment(words, wordsInSegment(words, seg));
    if (hit != null) out.add(hit);
  }
  return out;
}

// Novo array — não muta a entrada. Palavra sem destaque sai sem o campo `hl`,
// para que a ausência continue significando "sem destaque".
function applyHighlights(words, indices) {
  return (words || []).map((w, i) => (indices.has(i) ? { ...w, hl: true } : { ...w }));
}

// O contrato é por ÍNDICE, nunca por palavra: pedir a palavra de volta seria
// ambíguo assim que uma se repetir na frase, e repetição é comum em fala.
const PROMPT_MAX_CHARS = 60000;   // mesmo teto do irmão mais antigo: lib/clipper.js:106

function buildPrompt(words, segments) {
  const blocks = segments.map((seg, si) => {
    const idxs = wordsInSegment(words, seg);
    return `[${si}] ` + idxs.map(i => `${i}:${words[i].word}`).join(' ');
  });
  // Teto por BLOCO, não por caractere: cortar no meio de um bloco truncaria o
  // último token (ex. "12:pala"), envenenando o contrato de índice que
  // parseLlmPicks espera (`<índice>:<palavra>` inteiro). Acumula blocos
  // enquanto o total couber em PROMPT_MAX_CHARS e descarta o resto — os
  // índices são absolutos sobre `words`, então descartar blocos finais só
  // significa que aqueles segmentos não recebem destaque (degradação graciosa).
  const out = [];
  let total = 0;
  for (const b of blocks) {
    const sep = out.length ? 1 : 0;   // '\n' que junta este bloco ao anterior
    if (total + sep + b.length > PROMPT_MAX_CHARS) break;
    total += sep + b.length;
    out.push(b);
  }
  return out.join('\n');
}

// Aceita só o que é utilizável; qualquer desvio derruba o segmento, não a
// chamada inteira.
function parseLlmPicks(raw, words, segments) {
  const text = String(raw || '').replace(/```(?:json)?/g, '').trim();
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = new Set();
  for (const [segKey, val] of Object.entries(obj)) {
    const si = Number(segKey);
    if (!Number.isInteger(si) || si < 0 || si >= segments.length) continue;
    const idx = Array.isArray(val) ? val[0] : val;      // mais de um -> fica o primeiro
    if (!Number.isInteger(idx)) continue;
    const allowed = wordsInSegment(words, segments[si]);
    if (!allowed.includes(idx)) continue;               // fora do range do segmento
    if (isStop(words[idx].word)) continue;              // destaque em "de" é pior que nenhum
    out.add(idx);
  }
  return out;
}

async function pickKeywords(transcript, { onLog = () => {} } = {}) {
  const words = (transcript && transcript.words) || [];
  const segments = (transcript && transcript.segments) || [];
  if (!words.length || !segments.length) return { indices: new Set(), source: 'offline' };

  if (process.env.LLM_BASE_URL) {
    try {
      const raw = await llmChat([
        { role: 'system', content:
          'Você marca a palavra mais importante de cada frase de um roteiro curto de vídeo. ' +
          'Escolha o substantivo, número ou termo que carrega o sentido — nunca artigo, preposição ou verbo auxiliar. ' +
          'Responda APENAS com JSON no formato {"<indice do bloco>": <indice da palavra>}, sem texto em volta.' },
        { role: 'user', content: buildPrompt(words, segments) },
      ]);
      const picks = parseLlmPicks(raw, words, segments);
      if (picks && picks.size) {
        onLog(`[keywords] ${picks.size} destaque(s) escolhidos pelo LLM\n`);
        return { indices: picks, source: 'llm' };
      }
      onLog('[keywords] resposta do LLM inutilizável — caindo para heurística local\n');
    } catch (e) {
      onLog(`[keywords] LLM falhou (${e.message.split('\n')[0]}) — caindo para heurística local\n`);
    }
  }
  const off = pickOffline(transcript);
  onLog(`[keywords] ${off.size} destaque(s) pela heurística local\n`);
  return { indices: off, source: 'offline' };
}

module.exports = { pickKeywords, pickOffline, applyHighlights, parseLlmPicks, STOPWORDS };
