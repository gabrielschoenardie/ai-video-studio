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
    // `temperature` só vai quando LLM_TEMPERATURE está setado. Os modelos
    // Claude atuais (Sonnet 5, Opus 5, ...) REJEITAM sampling com 400
    // (`temperature is deprecated for this model`), e mandar o parâmetro
    // quebrava a chamada inteira. Provedores que ainda aceitam (DeepSeek,
    // Ollama, LM Studio, modelos OpenAI antigos) continuam atendidos via env.
    const temp = process.env.LLM_TEMPERATURE;
    const body = JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages,
      ...(temp !== undefined && temp !== '' ? { temperature: Number(temp) } : {}),
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
        let j;
        try { j = JSON.parse(data); }
        catch (e) {
          return reject(new Error(`LLM resposta não é JSON (HTTP ${res.statusCode}): ${data.slice(0, 300)}`));
        }
        // Erro da API chega como JSON VÁLIDO: chamar isso de "parse failed"
        // manda o diagnóstico para o lado errado — foi o que aconteceu com o
        // `temperature` rejeitado. Mostre a mensagem que o provedor mandou.
        if (j.error) {
          const m = j.error.message || JSON.stringify(j.error);
          return reject(new Error(`LLM erro da API (HTTP ${res.statusCode}): ${m}`));
        }
        const content = j.choices && j.choices[0] && j.choices[0].message
          && j.choices[0].message.content;
        if (typeof content !== 'string') {
          return reject(new Error(`LLM resposta sem choices[0].message.content (HTTP ${res.statusCode}): ${data.slice(0, 300)}`));
        }
        resolve(content);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LLM timeout')));
    req.end(body);
  });
}

module.exports = { llmChat };
