// loadEnv.js — minimal .env loader, zero deps (keeps the project's
// zero-npm-dependency backend promise). Reads KEY=VALUE lines from a .env
// file at the project root into process.env. Real environment variables
// always win — this only fills in keys that aren't already set.
'use strict';
const fs = require('fs');
const path = require('path');

function loadEnv(root = path.join(__dirname, '..')) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

module.exports = { loadEnv };
