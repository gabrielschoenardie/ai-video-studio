// llm.js — cliente Chat Completions compatível com OpenAI, usado por qualquer
// passo que precise de julgamento de LLM. Infraestrutura opcional: quem chama
// decide o que fazer quando LLM_BASE_URL não está setado.
'use strict';
const http = require('http');
const https = require('https');

function llmChat(messages) {
  return new Promise((resolve, reject) => {
    const base = process.env.LLM_BASE_URL.replace(/\/$/, '');
    const url = new URL(base + '/chat/completions');
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages, temperature: 0.3,
    });
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).choices[0].message.content); }
        catch (e) { reject(new Error('LLM response parse failed: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LLM timeout')));
    req.end(body);
  });
}

module.exports = { llmChat };
