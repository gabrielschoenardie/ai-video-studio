#!/usr/bin/env node
// PostToolUse hook (Edit|Write, server.js only): non-blocking warning when a
// newly added fs./spawn(/exec(/execFile( call doesn't route through the
// existing resolveInput()/insideRoot() path-safety helpers in server.js.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { return process.exit(0); }
  const file = input?.tool_input?.file_path;
  if (!file || path.basename(file) !== 'server.js') return process.exit(0);

  let root;
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return process.exit(0); }

  let diff;
  try {
    diff = execFileSync('git', ['diff', '--unified=0', '--', 'server.js'], { cwd: root, encoding: 'utf8' });
  } catch { return process.exit(0); }

  const riskyCall = /\bfs\.\w+\s*\(|\bspawn\s*\(|\bexecFile\s*\(|\bexec\s*\(/;
  const addedLines = diff.split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1));

  const flagged = addedLines.filter(l =>
    riskyCall.test(l) && !/resolveInput|insideRoot/.test(l));

  if (!flagged.length) return process.exit(0);

  process.stdout.write(JSON.stringify({
    systemMessage:
      '⚠ server.js: new fs./spawn(/exec(/execFile( call(s) added outside resolveInput()/insideRoot() ' +
      'path-safety helpers — review before merging:\n' + flagged.map(l => '  ' + l.trim()).join('\n'),
  }));
});
