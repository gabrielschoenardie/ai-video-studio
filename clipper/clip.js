#!/usr/bin/env node
// clipper/clip.js — the runnable auto-clipper (CLI face of lib/clipper.js).
//   node clip.js                       interactive — paste a URL or file
//   node clip.js --mode ai --reframe   AI moment-picking + vertical reframe
//   node clip.js <input> [--count 3] [--min 15] [--max 45] [--no-captions]
'use strict';
const path = require('path');
const readline = require('readline');
const { clip } = require('../lib/clipper');

function parseArgs(argv) {
  const o = { mode: 'auto', reframe: false, count: 3, min: 15, max: 45,
    captions: true, model: 'base', input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') o.mode = argv[++i];
    else if (a === '--reframe') o.reframe = true;
    else if (a === '--no-reframe') o.reframe = false;
    else if (a === '--count') o.count = parseInt(argv[++i], 10);
    else if (a === '--min') o.min = parseInt(argv[++i], 10);
    else if (a === '--max') o.max = parseInt(argv[++i], 10);
    else if (a === '--no-captions') o.captions = false;
    else if (a === '--model') o.model = argv[++i];
    else if (!a.startsWith('--')) o.input = a;
  }
  return o;
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(r => rl.question(q, r));
  rl.close();
  return ans.trim();
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  console.log('\n  ✂  AI VIDEO STUDIO — auto-clipper (100% local)\n');

  if (!o.input) {
    o.input = await ask('  paste a URL or a video file path → ');
    if (!o.input) { console.error('  nothing to clip.'); process.exit(1); }
    if (o.mode === 'auto') {
      const m = await ask('  mode [auto/ai/offline] (auto) → ');
      if (m) o.mode = m;
    }
    const rf = await ask('  reframe to 9:16 with subject-follow crop? [y/N] → ');
    o.reframe = /^y/i.test(rf);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workDir = path.join(__dirname, '..', 'jobs', 'cli-' + stamp);
  const outDir = path.join(__dirname, '..', 'output', 'clips-' + stamp);

  if (process.env.LLM_BASE_URL) {
    console.log(`  LLM moment-picking: ON  (${process.env.LLM_MODEL || 'model from server default'})`);
  } else {
    console.log('  LLM moment-picking: off — offline hook-detector will run.');
    console.log('  (optional: export LLM_BASE_URL / LLM_API_KEY / LLM_MODEL — DeepSeek, OpenAI, Ollama, LM Studio…)');
  }

  try {
    const r = await clip(o.input, {
      workDir, outDir, mode: o.mode, reframe: o.reframe,
      count: o.count, minLen: o.min, maxLen: o.max,
      captions: o.captions, whisperModel: o.model,
      onLog: () => {},
      onStage: (_s, label) => console.log('  » ' + label),
    });
    console.log(`\n  picker: ${r.picker}` +
      (r.reframed ? `  ·  9:16 ${r.tracked ? 'subject-follow' : 'center'} crop` : ''));
    console.log('  ────────────────────────────────────────────');
    for (const m of r.moments) {
      console.log(`  ${path.basename(m.file)}  [${m.start.toFixed(1)}s → ${m.end.toFixed(1)}s]`);
      console.log(`     why: ${m.reason}`);
      if (m.hookText) console.log(`     “${m.hookText}”`);
    }
    console.log(`\n  done → ${outDir}\n`);
  } catch (e) {
    console.error('\n  ✗ ' + e.message + '\n');
    process.exit(1);
  }
})();
