#!/usr/bin/env node
// PreToolUse hook (Edit|Write): block edits to .env / secrets files.
'use strict';
const path = require('path');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { return process.exit(0); }
  const file = input?.tool_input?.file_path;
  if (!file) return process.exit(0);
  const base = path.basename(file);
  const isEnvFile = base === '.env' || /^\.env\./.test(base) || /\.env$/.test(base) || /\.env\./.test(base);
  if (!isEnvFile) return process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'Blocked: .env / secrets files are protected from edits by project hook policy (.claude/settings.json).',
    },
  }));
});
