# Plan — Legendas karaokê com highlight semântico (Etapa 3)

> **Para workers agênticos:** este plano segue o fluxo do `CLAUDE.md` deste repo — Orquestrador → subagente `executor` → subagente `validator` → `git-workflow`. Steps usam checkbox (`- [ ]`).

**Owner (Orquestrador):** todas as seções exceto `## Status`. **Executor:** `## Status` apenas.

**Goal:** Legendas com destaque semântico — uma palavra-chave por frase em `#FF5200` — e presets de legenda como dado editável, sem alterar em nada o visual dos presets existentes.

**Architecture:** Os presets saem de `lib/captions.js` e viram `styles/captions.json`, carregando estrutura além de paleta. Um campo `highlight.channel` decide se o destaque é posicional (`spoken`, comportamento atual) ou semântico (`keyword`). A escolha da palavra roda no ASSEMBLE por uma cadeia LLM → heurística offline, grava uma marca `hl` por palavra no `transcript.json`, e o render ASS lê essa marca.

**Tech Stack:** Node ≥18 CommonJS, zero dependência npm nova. ASS/libass via ffmpeg. Cliente LLM já existente (Chat Completions compatível).

**Spec:** `docs/superpowers/specs/2026-09-13-captions-karaoke-highlight-design.md` — leia junto; este plano argumenta a partir dela.

---

## Global Constraints

Valem para toda task, implicitamente.

1. **Zero npm no backend.** Nada de `require` de pacote npm em `server.js` ou `lib/*`. Só `remotion/` tem projeto npm.
2. **O Executor NÃO commita.** O fluxo do projeto é Executar → Validar → Git, e git passa pelo subagente `git-workflow` em fases com aprovação do usuário. Não rode `git add`, `git commit` ou `git push` em nenhuma task. Ao terminar, atualize `## Status` e devolva ao Orquestrador.
3. **Não há suite de testes, runner nem pasta de fixtures.** Verificação neste projeto é comando + saída. Use `node --check`, `node -e`, `curl`, `ffprobe`. Arquivos temporários de verificação vão para o diretório de scratchpad da sessão, nunca para o repo.
4. **Path-safety.** Nenhum path vindo de cliente pode chegar a `fs`/`ffmpeg` sem `resolveInput()`/`insideRoot()`/`safeName()`.
5. **Contrato do job bus.** Funções de pipeline em `lib/*` recebem `onLog`/`onStage`/`onProgress`.
6. **Ordem canônica do filtergraph do EXPORT** (`lib/encode.js`) é invariante. Nenhuma task aqui a toca.
7. **`impact` e `clean` não mudam de aparência.** Critério duro, verificado byte-a-byte na Task 2.
8. **Windows.** O ambiente de desenvolvimento é PowerShell. Comandos de verificação abaixo usam sintaxe PowerShell; adapte se rodar em POSIX.

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `lib/llm.js` | **novo** — cliente Chat Completions, extraído do clipper. Infraestrutura, não feature. | 1 |
| `lib/clipper.js` | passa a importar `llmChat` em vez de defini-lo | 1 |
| `styles/captions.json` | **novo** — presets como dado (paleta + estrutura) | 2, 3 |
| `lib/captions.js` | resolve preset do JSON, converte cor, ramifica canal de destaque, grava marca do preset no `.ass` | 2, 3 |
| `server.js` | `captionStyleOf()` exato; rota `GET /api/caption-styles`; campo `hl` em `POST /api/captions/word` | 4, 8, 10 |
| `lib/keywords.js` | **novo** — escolha da palavra-chave: heurística offline, camada LLM, validação | 5, 6 |
| `lib/assemble.js` | chama a escolha atrás da porta de canal; loga a fonte pedida | 7 |
| `lib/timeline.js` | `remapWords()` preserva a marca através dos cortes | 8 |
| `public/index.html` | select do ASSEMBLE a partir da rota; overlay lendo tokens; toggle manual | 9, 10, 11 |

---

# Task 1 — Extrair `llmChat` para `lib/llm.js`

Refactor puro, sem mudança de comportamento. Existe para que `lib/keywords.js` (Task 6) dependa de infraestrutura e não de uma feature.

**Files:**
- Create: `lib/llm.js`
- Modify: `lib/clipper.js:99-128` (remove a função), `lib/clipper.js:9-10` (imports que ficam órfãos), topo (import novo)

**Interfaces:**
- Produz: `llmChat(messages) -> Promise<string>` — `messages` no formato Chat Completions (`[{role, content}]`), resolve com o texto de `choices[0].message.content`. Rejeita com `Error` em timeout, erro de rede ou parse.
- Consome: nada.

- [ ] **Step 1: Capturar o corpo atual para comparação**

```powershell
$sc = "$env:TEMP\etapa3"; New-Item -ItemType Directory -Force $sc | Out-Null
(Get-Content lib/clipper.js)[98..127] | Set-Content "$sc\llmchat-antes.txt"
Get-Content "$sc\llmchat-antes.txt" -TotalCount 2
```

Esperado: as duas primeiras linhas são o comentário `// ------...LLM moment picking` e `function llmChat(messages) {`.

- [ ] **Step 2: Criar `lib/llm.js`**

```js
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
```

O corpo é cópia literal de `lib/clipper.js:99-128`. Não reescreva, não "melhore".

- [ ] **Step 3: Remover do clipper e importar**

Em `lib/clipper.js`, apague o comentário `// --------------------------------------------------- LLM moment picking` e a função `llmChat` inteira (linhas 98–128), deixando `llmMoments` logo abaixo.

Acrescente ao bloco de imports do topo:

```js
const { llmChat } = require('./llm');
```

**Remova** `const http = require('http');` e `const https = require('https');` (linhas 9–10) — depois da extração, `llmChat` era o único uso. Confirme com o Step 4 antes de remover.

- [ ] **Step 4: Verificar que `http`/`https` ficaram mesmo órfãos**

```powershell
Select-String -Path lib/clipper.js -Pattern '\bhttps?\b' | ForEach-Object { "L$($_.LineNumber): $($_.Line.Trim())" }
```

Esperado: nenhuma linha além dos próprios `require` que você vai remover. Se aparecer outro uso, **mantenha o import correspondente** e registre no `## Status`.

- [ ] **Step 5: Verificar**

```powershell
node --check lib/llm.js
node --check lib/clipper.js
node -e "const {llmChat}=require('./lib/llm'); console.log('llm.js exporta:', typeof llmChat)"
node -e "require('./lib/clipper'); console.log('clipper carrega sem erro')"
Select-String -Path lib/clipper.js -Pattern 'function llmChat' | Measure-Object | Select-Object -ExpandProperty Count
```

Esperado: `node --check` sem saída nos dois; `llm.js exporta: function`; `clipper carrega sem erro`; contagem `0`.

---

# Task 2 — Presets como dado, com garantia byte-a-byte

A task mais arriscada. Migra `impact`/`clean` para JSON **sem mudar um byte** da saída. `realce` não entra aqui de propósito: isolar a migração torna o `cmp` inequívoco.

**Files:**
- Create: `styles/captions.json`
- Modify: `lib/captions.js:1-17` (imports + remoção de `STYLES`), `:27-28` (resolução), `:42-48` (cor inline), `:62` (linha `Style`), `:88` (exports)

**Interfaces:**
- Produz: `resolveStyle(name) -> objeto de preset normalizado`; `assColor(hex) -> string ASS`. `buildAss(words, opts)` mantém a assinatura atual.
- Consome: nada.

- [ ] **Step 1: Capturar o golden ANTES de tocar no código**

Este é o vermelho do ciclo: sem esta captura não há como provar identidade depois.

```powershell
$sc = "$env:TEMP\etapa3"; New-Item -ItemType Directory -Force $sc | Out-Null
@'
const { buildAss } = require('./lib/captions');
const words = [
  { word: 'Uptime', start: 0.00, end: 0.42 },
  { word: 'não',    start: 0.42, end: 0.61 },
  { word: 'é',      start: 0.61, end: 0.70 },
  { word: 'sucesso',start: 0.70, end: 1.25 },
  { word: 'meça',   start: 1.40, end: 1.78 },
  { word: 'resultados', start: 1.78, end: 2.44 },
  { word: 'reais',  start: 2.44, end: 2.90 },
];
const fs = require('fs');
const out = process.argv[2];
fs.writeFileSync(out + '/impact.ass', buildAss(words, { style: 'impact' }), 'utf8');
fs.writeFileSync(out + '/clean.ass',  buildAss(words, { style: 'clean'  }), 'utf8');
console.log('gerado');
'@ | Set-Content "$sc\gen.js" -Encoding utf8
node "$sc\gen.js" "$sc"
Rename-Item "$sc\impact.ass" "impact.golden.ass" -Force
Rename-Item "$sc\clean.ass"  "clean.golden.ass"  -Force
Get-ChildItem "$sc\*.golden.ass" | Select-Object Name, Length
```

Esperado: dois arquivos `.golden.ass` com tamanho > 0. **Guarde-os — são a referência do resto da task.**

- [ ] **Step 2: Criar `styles/captions.json`**

Os valores vêm literalmente de `lib/captions.js:9-16`. Conferência de cor já feita na spec: `&H00FFFFFF`→`#FFFFFF`, `&H0000FFFF`→`#FFFF00`, `&H0000D7FF`→`#FFD700`.

```json
{
  "impact": {
    "font": "Arial Black", "size": 88, "bold": true, "italic": false,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 6, "shadow": 0,
    "layout":    { "maxWords": 4, "uppercase": true },
    "position":  { "align": 2, "marginV": 560 },
    "highlight": { "channel": "spoken", "color": "#FFFF00", "scale": 108 }
  },
  "clean": {
    "font": "Arial", "size": 72, "bold": true, "italic": false,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 4, "shadow": 1,
    "layout":    { "maxWords": 4, "uppercase": true },
    "position":  { "align": 2, "marginV": 520 },
    "highlight": { "channel": "spoken", "color": "#FFD700", "scale": 108 }
  }
}
```

- [ ] **Step 3: Reescrever o topo de `lib/captions.js`**

Substitua o bloco `const STYLES = { ... }` (linhas 7–17) por:

```js
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
    // Fail-soft: sem o arquivo, a legenda ainda sai no preset embutido em vez
    // de derrubar o ASSEMBLE inteiro.
    STYLES = { impact: FALLBACK_IMPACT };
  }
  return STYLES;
}

function resolveStyle(name) {
  const all = loadStyles();
  return all[name] || all.impact || FALLBACK_IMPACT;
}

// ASS usa &HAABBGGRR — ordem invertida em relação a #RRGGBB, e é onde erro
// silencioso de cor mora.
function assColor(hex) {
  const h = String(hex || '#FFFFFF').replace('#', '').trim();
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return ('&H00' + b + g + r).toUpperCase();
}

function styleNames() { return Object.keys(loadStyles()); }
```

- [ ] **Step 4: Adaptar `buildAss` mantendo a saída idêntica**

Em `buildAss`, troque `const S = STYLES[style] || STYLES.impact;` por:

```js
  const S = resolveStyle(style);
  const maxW = (S.layout && S.layout.maxWords) || maxWords;
  const upper = S.layout ? S.layout.uppercase !== false : uppercase;
```

Troque os usos de `maxWords` e `uppercase` no corpo por `maxW` e `upper`.

Na montagem do texto destacado (linha ~46), troque as cores literais por conversão:

```js
        return j === wi
          ? `{\\c${assColor(S.highlight.color)}\\fscx${S.highlight.scale}\\fscy${S.highlight.scale}}${t}{\\c${assColor(S.primary)}\\fscx100\\fscy100}`
          : t;
```

Na linha `Style:` (linha 62), troque por:

```js
Style: Word,${S.font},${S.size},${assColor(S.primary)},&H000000FF,${assColor(S.outline)},&H64000000,${S.bold ? -1 : 0},${S.italic ? -1 : 0},0,0,100,100,0,0,1,${S.outlineW},${S.shadow},${S.position.align},60,60,${S.position.marginV},1
```

**Atenção aos campos que hoje são literais:** `Bold` era `${S.bold}` com valor `-1`; agora é `S.bold ? -1 : 0`. `Italic` era `0` fixo; agora `S.italic ? -1 : 0`. `Alignment` era `2` fixo; agora `S.position.align`. Para `impact`/`clean` os três resultam nos mesmos caracteres — é isso que o Step 6 prova.

- [ ] **Step 5: Atualizar exports**

```js
module.exports = { buildAss, writeAss, subFilter, assDuration, resolveStyle, styleNames, assColor };
```

`STYLES` sai dos exports. Confirme que ninguém mais o importa:

```powershell
Select-String -Path server.js,lib/*.js,clipper/*.js -Pattern 'STYLES' | ForEach-Object { "$($_.Filename):$($_.LineNumber)  $($_.Line.Trim())" }
```

Esperado: só ocorrências dentro de `lib/captions.js`. Se houver outro consumidor, **pare e reporte** — o plano não previu.

- [ ] **Step 6: O verde — provar identidade byte-a-byte**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/captions.js
node "$sc\gen.js" "$sc"
"impact: " + $(if ((Get-FileHash "$sc\impact.ass").Hash -eq (Get-FileHash "$sc\impact.golden.ass").Hash) {'IDENTICO'} else {'DIFERENTE'})
"clean : " + $(if ((Get-FileHash "$sc\clean.ass").Hash  -eq (Get-FileHash "$sc\clean.golden.ass").Hash)  {'IDENTICO'} else {'DIFERENTE'})
```

Esperado: **`IDENTICO` nos dois.** Se der `DIFERENTE`, rode `Compare-Object (Get-Content "$sc\impact.ass") (Get-Content "$sc\impact.golden.ass")` para ver a linha divergente. Não prossiga para a Task 3 com diferença pendente.

- [ ] **Step 7: Verificar a conversão de cor isoladamente**

```powershell
node -e "const {assColor}=require('./lib/captions'); const t=[['#FFFFFF','&H00FFFFFF'],['#FFFF00','&H0000FFFF'],['#FFD700','&H0000D7FF'],['#FF5200','&H000052FF'],['#000000','&H00000000']]; let ok=true; for(const [h,e] of t){const g=assColor(h); if(g!==e){ok=false;console.log('FALHOU',h,'esperado',e,'veio',g)}} console.log(ok?'todas as conversoes OK':'HA FALHAS')"
```

Esperado: `todas as conversoes OK`.

---

# Task 3 — Preset `realce` e o canal `keyword`

**Files:**
- Modify: `styles/captions.json` (entrada nova), `lib/captions.js` (ramificação de canal, `\pos`, animação de entrada, linha de marca)

**Interfaces:**
- Consome: `resolveStyle`, `assColor` (Task 2).
- Produz: `.ass` com `; studio-style: <nome>` em `[Script Info]`; palavras com `w.hl === true` pintadas em `highlight.color`.

- [ ] **Step 1: Acrescentar `realce` ao JSON**

```json
  "realce": {
    "font": "Montserrat Black", "size": 96, "bold": true, "italic": true,
    "primary": "#FFFFFF", "outline": "#000000", "outlineW": 4, "shadow": 1,
    "layout":    { "maxWords": 1, "uppercase": false },
    "position":  { "align": 5, "x": 540, "y": 1210 },
    "highlight": { "channel": "keyword", "color": "#FF5200", "scale": 100 },
    "enter":     { "fromScale": 80, "ms": 180 },
    "_fontNote": "Requer Montserrat Black Italic instalada no sistema. Sem ela, libass substitui em silencio."
  }
```

- [ ] **Step 2: Ramificar o canal em `buildAss`**

Substitua o `line.map(...)` que monta o texto por:

```js
      const channel = (S.highlight && S.highlight.channel) || 'spoken';
      const text = line.map((x, j) => {
        let t = x.word.replace(/[{}\\]/g, '');
        if (upper) t = t.toUpperCase();
        if (channel === 'none') return t;
        if (channel === 'keyword') {
          // Semântico: a marca da palavra decide, não a posição. Nenhum
          // tratamento posicional é aplicado, qualquer que seja maxWords.
          return x.hl
            ? `{\\c${assColor(S.highlight.color)}}${t}{\\c${assColor(S.primary)}}`
            : t;
        }
        // 'spoken' — comportamento histórico, intocado
        return j === wi
          ? `{\\c${assColor(S.highlight.color)}\\fscx${S.highlight.scale}\\fscy${S.highlight.scale}}${t}{\\c${assColor(S.primary)}\\fscx100\\fscy100}`
          : t;
      }).join(' ');
```

- [ ] **Step 3: Posicionamento e animação de entrada**

Antes de montar a linha `Dialogue`, calcule um prefixo de tags:

```js
      // Duas formas de posicionar, e a presença de x/y decide: coordenada
      // exata via \pos (preciso, necessário para 63% da altura) ou MarginV na
      // linha Style (caminho histórico, o que preserva o byte-a-byte).
      let pre = '';
      const P = S.position || {};
      if (P.x != null && P.y != null) pre += `{\\an${P.align || 5}\\pos(${P.x},${P.y})}`;
      if (S.enter && S.enter.fromScale != null) {
        const f = S.enter.fromScale, ms = S.enter.ms || 180;
        pre += `{\\fscx${f}\\fscy${f}\\t(0,${ms},\\fscx100\\fscy100)}`;
      }
      ev += `Dialogue: 0,${assTime(w.start)},${assTime(end)},Word,,0,0,0,,${pre}${text}\n`;
```

Para `impact`/`clean`, `P.x`/`P.y` são `undefined` e `S.enter` não existe, então `pre` é string vazia e a linha sai idêntica.

- [ ] **Step 4: Gravar a marca do preset no `[Script Info]`**

No template do cabeçalho, logo após `ScriptType: v4.00+`, acrescente:

```
; studio-style: ${style}
```

`style` é o parâmetro que `buildAss` já recebe em `opts` — a assinatura atual é `buildAss(words, { style = 'impact', ... })`, então o default já cobre a ausência. Não introduza variável nova. ASS ignora linhas iniciadas por `;`.

> **Consequência aceita:** isto quebra o byte-a-byte da Task 2, de propósito e só a partir daqui. **Regere os goldens** ao fim desta task, para que as tasks seguintes comparem contra o novo baseline.

- [ ] **Step 5: Verificar `realce`**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/captions.js
@'
const { buildAss } = require('./lib/captions');
const words = [
  { word: 'Uptime', start: 0, end: .42 },
  { word: 'não', start: .42, end: .61 },
  { word: 'sucesso', start: .61, end: 1.2, hl: true },
];
require('fs').writeFileSync(process.argv[2] + '/realce.ass', buildAss(words, { style: 'realce' }), 'utf8');
'@ | Set-Content "$sc\gen-realce.js" -Encoding utf8
node "$sc\gen-realce.js" "$sc"
Get-Content "$sc\realce.ass"
```

Verifique na saída, item a item:
- `; studio-style: realce` presente no `[Script Info]`
- linha `Style:` com `Montserrat Black`, `96`, e **Italic = -1** (nono campo)
- os três eventos `Dialogue` trazem `{\an5\pos(540,1210)}` e `{\fscx80\fscy80\t(0,180,\fscx100\fscy100)}`
- só a palavra `sucesso` traz `{\c&H000052FF}` — as outras saem sem tag de cor
- as palavras **não** estão em caixa alta (`uppercase: false`)

- [ ] **Step 6: Regerar os goldens e confirmar que só a linha de marca mudou**

```powershell
$sc = "$env:TEMP\etapa3"
Copy-Item "$sc\impact.golden.ass" "$sc\impact.golden.prev.ass" -Force
Copy-Item "$sc\clean.golden.ass"  "$sc\clean.golden.prev.ass"  -Force
node "$sc\gen.js" "$sc"
Compare-Object (Get-Content "$sc\impact.golden.prev.ass") (Get-Content "$sc\impact.ass") | Format-Table -AutoSize
Move-Item "$sc\impact.ass" "$sc\impact.golden.ass" -Force
Move-Item "$sc\clean.ass"  "$sc\clean.golden.ass"  -Force
```

Esperado: **exatamente uma** linha de diferença, `; studio-style: impact`, marcada como `=>`. Qualquer outra divergência é regressão — pare e reporte.

---

# Task 4 — `captionStyleOf()` exato

**Files:**
- Modify: `server.js:281-289`

**Interfaces:**
- Consome: a linha `; studio-style:` da Task 3.
- Produz: `captionStyleOf(dir) -> string` — nome do preset.

- [ ] **Step 1: Substituir a função**

```js
    function captionStyleOf(dir) {
      try {
        const assText = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
        // Marca explícita, gravada por buildAss — exata.
        const m = /^;\s*studio-style:\s*(\S+)\s*$/m.exec(assText);
        if (m) return m[1];
        // Fallback para .ass gerados antes da marca existir. Heurístico por
        // construção; não estenda para presets novos.
        if (/Arial Black/.test(assText)) return 'impact';
        if (/Style:\s*Word,Arial,/.test(assText)) return 'clean';
      } catch (e) { /* fall through */ }
      return 'impact';
    }
```

- [ ] **Step 2: Verificar os três caminhos**

```powershell
$sc = "$env:TEMP\etapa3"; $d = "$sc\styleof"; New-Item -ItemType Directory -Force $d | Out-Null
node --check server.js
# (a) .ass novo com marca
Copy-Item "$sc\realce.ass" "$d\captions.ass" -Force
# (b) .ass legado, sem marca — simula arquivo antigo no disco
(Get-Content "$sc\impact.golden.ass") | Where-Object { $_ -notmatch '^; studio-style:' } | Set-Content "$d\legado.ass"
@'
const fs=require('fs'),path=require('path');
function styleOf(text){
  const m=/^;\s*studio-style:\s*(\S+)\s*$/m.exec(text);
  if(m) return m[1];
  if(/Arial Black/.test(text)) return 'impact';
  if(/Style:\s*Word,Arial,/.test(text)) return 'clean';
  return 'impact';
}
const d=process.argv[2];
console.log('com marca (realce) ->', styleOf(fs.readFileSync(path.join(d,'captions.ass'),'utf8')));
console.log('legado sem marca   ->', styleOf(fs.readFileSync(path.join(d,'legado.ass'),'utf8')));
console.log('arquivo vazio      ->', styleOf(''));
'@ | Set-Content "$sc\styleof.js" -Encoding utf8
node "$sc\styleof.js" "$d"
```

Esperado: `realce`, `impact`, `impact`.

---

# Task 5 — `lib/keywords.js`: heurística offline

**Files:**
- Create: `lib/keywords.js`

**Interfaces:**
- Produz:
  - `pickOffline(transcript) -> Set<number>` — índices (no array `words`) das palavras a destacar.
  - `applyHighlights(words, indices) -> words` — devolve **novo** array com `hl: true` nos índices dados; palavras não marcadas saem sem o campo.
  - `STOPWORDS` — `Set<string>`, minúsculas, sem acento removido.
- Consome: nada.

- [ ] **Step 1: Criar o módulo**

```js
// keywords.js — escolhe qual palavra de cada frase recebe o destaque semântico.
// Julgamento aqui, render determinístico em captions.js. A cadeia degrada:
// LLM quando configurado, heurística local caso contrário — nunca "sem destaque".
'use strict';

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','do','da','dos','das','em','no','na','nos','nas',
  'por','pelo','pela','para','pra','com','sem','sob','sobre','ate','até','e','ou','mas','que','se',
  'eu','tu','ele','ela','nos','nós','voce','você','voces','vocês','eles','elas','meu','minha','seu','sua',
  'isso','isto','aquilo','este','esta','esse','essa','aquele','aquela','ao','aos','à','às','já','ja',
  'the','a','an','of','to','in','on','at','for','with','and','or','but','if','is','are','was','were',
  'it','this','that','these','those','you','your','we','our','they','their','be','been','as','so',
]);

const NUMERIC = /[0-9]/;

// Uma palavra-chave por segmento do Whisper. Segmento de <= 2 palavras não
// recebe destaque: colorir a única palavra da tela não destaca nada.
const MIN_WORDS_PER_SEGMENT = 3;
const MIN_LONG_WORD = 6;

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
  const numeric = idxs.find(i => NUMERIC.test(words[i].word));
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
    if (!isStop(words[idxs[k]].word)) return idxs[k];
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

module.exports = { pickOffline, applyHighlights, STOPWORDS };
```

- [ ] **Step 2: Verificar contra casos nomeados**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/keywords.js
@'
const { pickOffline, applyHighlights } = require('./lib/keywords');
const mk = (arr, segs) => ({
  words: arr.map(([w,s,e]) => ({ word:w, start:s, end:e })),
  segments: segs.map(([s,e]) => ({ start:s, end:e, text:'' })),
});
// 1. numero ganha de palavra longa
let t = mk([['aumentamos',0,.5],['em',.5,.6],['80%',.6,1.0]], [[0,1.0]]);
let p = pickOffline(t); console.log('1 numero vence      ->', [...p].map(i=>t.words[i].word).join(','), '(esperado 80%)');
// 2. palavra mais longa nao-stopword
t = mk([['o',0,.2],['resultado',.2,.8],['foi',.8,1.0]], [[0,1.0]]);
p = pickOffline(t); console.log('2 mais longa        ->', [...p].map(i=>t.words[i].word).join(','), '(esperado resultado)');
// 3. segmento curto nao marca
t = mk([['sim',0,.3],['claro',.3,.6]], [[0,.6]]);
p = pickOffline(t); console.log('3 segmento curto    ->', p.size, '(esperado 0)');
// 4. um por segmento
t = mk([['primeiro',0,.5],['argumento',.5,1],['forte',1,1.4],['segundo',1.5,2],['argumento',2,2.5],['fraco',2.5,3]], [[0,1.4],[1.5,3]]);
p = pickOffline(t); console.log('4 um por segmento   ->', p.size, '(esperado 2)');
// 5. applyHighlights nao muta e marca so o indice
const src=[{word:'a',start:0,end:1},{word:'b',start:1,end:2}];
const got=applyHighlights(src,new Set([1]));
console.log('5 imutabilidade     ->', src[1].hl===undefined && got[1].hl===true && got[0].hl===undefined ? 'OK' : 'FALHOU');
'@ | Set-Content "$sc\kw.js" -Encoding utf8
node "$sc\kw.js"
```

Esperado, linha a linha: `80%`; `resultado`; `0`; `2`; `OK`.

---

# Task 6 — Camada LLM em `lib/keywords.js`

**Files:**
- Modify: `lib/keywords.js`

**Interfaces:**
- Consome: `llmChat` (Task 1), `pickOffline` (Task 5).
- Produz: `pickKeywords(transcript, { onLog }) -> Promise<{ indices: Set<number>, source: 'llm'|'offline' }>`.

- [ ] **Step 1: Acrescentar ao módulo**

```js
const { llmChat } = require('./llm');

// O contrato é por ÍNDICE, nunca por palavra: pedir a palavra de volta seria
// ambíguo assim que uma se repetir na frase, e repetição é comum em fala.
function buildPrompt(words, segments) {
  const blocks = segments.map((seg, si) => {
    const idxs = wordsInSegment(words, seg);
    return `[${si}] ` + idxs.map(i => `${i}:${words[i].word}`).join(' ');
  });
  return blocks.join('\n');
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
```

Atualize os exports:

```js
module.exports = { pickKeywords, pickOffline, applyHighlights, parseLlmPicks, STOPWORDS };
```

- [ ] **Step 2: Verificar a cadeia de degradação**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/keywords.js
@'
const { pickKeywords, parseLlmPicks } = require('./lib/keywords');
const t = {
  words: [['aumentamos',0,.5],['em',.5,.6],['80%',.6,1]].map(([w,s,e])=>({word:w,start:s,end:e})),
  segments: [{start:0,end:1,text:''}],
};
(async () => {
  delete process.env.LLM_BASE_URL;
  const r = await pickKeywords(t, { onLog: s => process.stdout.write('  ' + s) });
  console.log('sem LLM_BASE_URL -> source =', r.source, '| marcados =', r.indices.size, '(esperado offline / 1)');
  const segs = t.segments, w = t.words;
  console.log('json invalido    ->', parseLlmPicks('nao sou json', w, segs) === null ? 'null OK' : 'FALHOU');
  console.log('indice fora      ->', parseLlmPicks('{"0": 99}', w, segs).size === 0 ? '0 OK' : 'FALHOU');
  console.log('stopword         ->', parseLlmPicks('{"0": 1}', w, segs).size === 0 ? '0 OK' : 'FALHOU');
  console.log('array -> primeiro->', [...parseLlmPicks('{"0": [2,0]}', w, segs)][0] === 2 ? '2 OK' : 'FALHOU');
  console.log('cercado de ```   ->', parseLlmPicks('```json\n{"0": 2}\n```', w, segs).size === 1 ? '1 OK' : 'FALHOU');
})();
'@ | Set-Content "$sc\kw2.js" -Encoding utf8
node "$sc\kw2.js"
```

Esperado: `offline / 1`, depois `null OK`, `0 OK`, `0 OK`, `2 OK`, `1 OK`.

---

# Task 7 — Integrar no `lib/assemble.js`

**Files:**
- Modify: `lib/assemble.js:31-45`

**Interfaces:**
- Consome: `pickKeywords`, `applyHighlights` (Tasks 5–6); `resolveStyle` (Task 2).

- [ ] **Step 1: Imports**

```js
const { pickKeywords, applyHighlights } = require('./keywords');
const { writeAss, subFilter, resolveStyle } = require('./captions');
```

(a linha de `./captions` já existe — acrescente `resolveStyle`)

- [ ] **Step 2: Inserir o passo entre transcrever e escrever o `.ass`**

Substitua o corpo do bloco `if (captions) { ... }` (linhas 34–44) por:

```js
    try {
      const tx = await transcribe(capSource, { model: whisperModel, language, workDir, onLog });
      words = tx.words;
      if (words.length) {
        const S = resolveStyle(captionStyle);
        // Porta de custo: só gasta chamada de LLM se o preset realmente
        // desenha destaque semântico. Quem usa impact/clean não paga nada.
        if (S.highlight && S.highlight.channel === 'keyword') {
          onStage('keywords', 'Escolhendo palavras-chave');
          const { indices, source } = await pickKeywords(tx, { onLog });
          words = applyHighlights(words, indices);
          tx.words = words;
          onLog(`[captions] destaque semântico via ${source}\n`);
        }
        onLog(`[captions] preset ${captionStyle} — fonte pedida: ${S.font}\n`);
        assPath = writeAss(words, workDir, { style: captionStyle });
        if (burnCaptions) vf.push(subFilter(assPath));
      }
      fs.writeFileSync(path.join(workDir, 'transcript.json'), JSON.stringify(tx, null, 2));
    } catch (e) {
      onLog(`[captions] skipped — ${e.message.split('\n')[0]}\n`);
    }
```

**Note a ordem:** `tx.words = words` antes do `writeFileSync`, senão a marca não é persistida.

- [ ] **Step 3: Verificar a porta de custo e a persistência**

Requer ffmpeg e whisper instalados. Gere uma fonte curta com fala sintética ou use um MP4 existente com voz.

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/assemble.js
node server.js  # em outra janela; deixe rodando
```

Com o servidor no ar, monte duas vezes o mesmo vídeo, uma por preset:

```powershell
# (a) impact — nao pode haver linha [keywords] no log
$r = Invoke-RestMethod 'http://localhost:4870/api/assemble' -Method Post -ContentType 'application/json' -Body '{"visual":"<um mp4 com fala>","captionStyle":"impact"}'
# acompanhe ate terminar, depois:
(Invoke-RestMethod "http://localhost:4870/api/jobs/$($r.job)").log -split "`n" | Select-String 'keywords|preset'
```

Esperado (a): aparece `[captions] preset impact — fonte pedida: Arial Black`, e **nenhuma** linha `[keywords]`.

```powershell
# (b) realce — tem que haver [keywords] e marcas no transcript
$r = Invoke-RestMethod 'http://localhost:4870/api/assemble' -Method Post -ContentType 'application/json' -Body '{"visual":"<o mesmo mp4>","captionStyle":"realce"}'
# apos terminar, com <id> = $r.job:
node -e "const t=require('./jobs/<id>/transcript.json'); const m=t.words.filter(w=>w.hl); console.log('palavras:',t.words.length,'| marcadas:',m.length,'|',m.map(w=>w.word).join(', '))"
```

Esperado (b): linha `[keywords] N destaque(s) pela heurística local` (ou `pelo LLM` se `LLM_BASE_URL` estiver setado), `[captions] preset realce — fonte pedida: Montserrat Black`, e `marcadas` > 0.

---

# Task 8 — `remapWords()` preserva a marca

Sem isto a legenda perde os destaques exatamente nos vídeos editados na TIMELINE — o caso de uso mais provável do preset novo.

**Files:**
- Modify: `lib/timeline.js` (dentro de `remapWords`)

- [ ] **Step 1: Preservar o campo**

Troque a linha do `out.push`:

```js
        out.push({ word: w.word, start: tlStart + (a - seg.srcIn), end: tlStart + (b - seg.srcIn) });
```

por:

```js
        // `hl` (destaque semântico) precisa atravessar o corte: sem isto a
        // marca é descartada em silêncio e o vídeo conformado sai sem destaque.
        const mapped = { word: w.word, start: tlStart + (a - seg.srcIn), end: tlStart + (b - seg.srcIn) };
        if (w.hl) mapped.hl = true;
        out.push(mapped);
```

- [ ] **Step 2: Verificar que a marca sobrevive ao corte**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/timeline.js
node -e "const tl=require('./lib/timeline'); console.log('remapWords exportado?', typeof tl.remapWords)"
```

Se `remapWords` não estiver nos exports, verifique via o conform de ponta a ponta: salve um sidecar com dois segmentos que pulam o meio, rode `POST /api/timeline/conform` num vídeo montado com `realce`, e confirme no `.ass` gerado pelo conform que ainda há tags `{\c&H000052FF}`:

```powershell
Select-String -Path 'jobs/<id do conform>/captions.ass' -Pattern '&H000052FF' | Measure-Object | Select-Object -ExpandProperty Count
```

Esperado: contagem > 0. Antes desta task, seria 0.

---

# Task 9 — Rota `GET /api/caption-styles`

**Files:**
- Modify: `server.js` (rota nova, junto de `GET /api/luts`)

- [ ] **Step 1: Acrescentar a rota**

Logo após o bloco de `GET /api/luts`:

```js
    // Presets de legenda — espelha /api/luts: lê o arquivo de config e devolve
    // o que existe. A UI monta o select a partir disto, então acrescentar um
    // preset ao JSON o faz aparecer sem tocar código.
    if (req.method === 'GET' && p === '/api/caption-styles') {
      const styles = require('./lib/captions').styleNames().map(name => ({ name }));
      return send(res, 200, { styles });
    }
```

- [ ] **Step 2: Verificar**

```powershell
node --check server.js
# com o servidor rodando:
Invoke-RestMethod 'http://localhost:4870/api/caption-styles' | ConvertTo-Json -Depth 4
```

Esperado: `{"styles":[{"name":"impact"},{"name":"clean"},{"name":"realce"}]}`.

---

# Task 10 — Select do ASSEMBLE a partir da rota

**Files:**
- Modify: `public/index.html` (markup do `#asm-cap`, `doAssemble`, e o carregamento inicial)

- [ ] **Step 1: Simplificar o markup**

Troque o `<select id="asm-cap">` e suas opções fixas por:

```html
          <select id="asm-cap"><option value="0">off</option></select>
```

- [ ] **Step 2: Popular da rota no boot**

Junto das outras buscas de inicialização (onde `/api/luts` e `/api/voices` são carregados), acrescente:

```js
(async () => {
  try {
    const { styles } = await (await fetch('/api/caption-styles')).json();
    const sel = $('#asm-cap');
    sel.innerHTML = styles.map(s => `<option value="${s.name}">word-by-word (${s.name})</option>`).join('')
      + '<option value="0">off</option>';
    sel.value = 'impact';
  } catch (e) { /* mantém o 'off' do markup — sem presets, sem legenda */ }
})();
```

- [ ] **Step 3: Corrigir `doAssemble`**

Os valores legados `1`/`clean`/`0` desaparecem. Troque:

```js
        captions: cap !== '0', captionStyle: cap === 'clean' ? 'clean' : 'impact',
```

por:

```js
        captions: cap !== '0', captionStyle: cap === '0' ? 'impact' : cap,
```

- [ ] **Step 4: Verificar**

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('public/index.html','utf8');const m=s.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);try{new Function(m[1]);console.log('JS parseia OK')}catch(e){console.log('SyntaxError:',e.message);process.exit(1)}"
Select-String -Path public/index.html -Pattern "cap === 'clean'" | Measure-Object | Select-Object -ExpandProperty Count
```

Esperado: `JS parseia OK` e contagem `0`.

No navegador, com o servidor rodando: abra o ASSEMBLE e confirme que o select lista `impact`, `clean`, `realce` e `off`, com `impact` selecionado.

---

# Task 11 — Overlay do preview e toggle manual

**Files:**
- Modify: `server.js` (campo `hl` em `POST /api/captions/word`), `public/index.html` (`updatePreviewOverlay`, toggle na track LEGENDA)

- [ ] **Step 1: Aceitar `hl` na rota de edição de palavra**

Em `POST /api/captions/word`, depois da validação de `index`/`start` que já existe e antes do `writeFileSync`:

```js
      // Texto e destaque são edições independentes: o corpo pode trazer uma,
      // outra, ou as duas. `newText` ausente mantém a palavra como está.
      if (typeof b.newText === 'string') {
        const newWord = b.newText.trim();
        if (!newWord) return send(res, 400, { error: 'palavra não pode ficar vazia' });
        w.word = newWord;
      }
      if (typeof b.hl === 'boolean') {
        if (b.hl) w.hl = true; else delete w.hl;
      }
```

Isto substitui o bloco atual que exige `newText`. Mantenha o resto da rota (revalidação, `writeAss`, resposta) intacto.

- [ ] **Step 2: Overlay lendo os tokens**

No módulo da TIMELINE, carregue os presets uma vez:

```js
  let CAPTION_STYLES = {};
  (async () => {
    try {
      const r = await (await fetch('/api/caption-styles?full=1')).json();
      CAPTION_STYLES = r.byName || {};
    } catch (e) { /* overlay cai no visual padrão */ }
  })();
```

E estenda a rota da Task 9. O bloco novo entra **dentro** do `if` da rota, entre a montagem de `styles` e o `return` que já existe:

```js
    if (req.method === 'GET' && p === '/api/caption-styles') {
      const mod = require('./lib/captions');
      const styles = mod.styleNames().map(name => ({ name }));
      // ?full=1 devolve os tokens inteiros — o overlay do preview precisa de
      // cor, itálico e posição, não só dos nomes.
      if (url.searchParams.get('full')) {
        const byName = {};
        for (const n of mod.styleNames()) byName[n] = mod.resolveStyle(n);
        return send(res, 200, { styles, byName });
      }
      return send(res, 200, { styles });
    }
```

Isto substitui a rota inteira escrita na Task 9.

Em `updatePreviewOverlay()`, substitua a montagem do HTML por uma que respeite os tokens do preset corrente (`captionStyle`, já devolvido por `GET /api/captions`):

```js
    const S = CAPTION_STYLES[captionStyle] || null;
    const n = S && S.layout ? Math.max(0, Math.floor((S.layout.maxWords - 1) / 2)) : 2;
    const before = words.slice(Math.max(0, idx - n), idx).map(w => w.text).join(' ');
    const after = words.slice(idx + 1, idx + 1 + n).map(w => w.text).join(' ');
    const cur = escapeHtml(words[idx].text);
    const isKeyword = S && S.highlight && S.highlight.channel === 'keyword';
    const hot = isKeyword ? !!words[idx].hl : true;
    el.innerHTML = (before ? before + ' ' : '')
      + (hot ? `<b>${cur}</b>` : cur)
      + (after ? ' ' + after : '');
    if (S) {
      el.style.fontStyle = S.italic ? 'italic' : 'normal';
      el.style.textTransform = (S.layout && S.layout.uppercase) ? 'uppercase' : 'none';
      el.style.color = S.primary;
      el.style.setProperty('--cap-hot', (S.highlight && S.highlight.color) || 'var(--go)');
      if (S.position && S.position.y != null) {
        el.style.top = ((S.position.y / 1920) * 100).toFixed(1) + '%';
        el.style.bottom = 'auto';
      }
    }
```

E no CSS, faça `.bt-cap-overlay b` usar a variável:

```css
.bt-cap-overlay b{color:var(--cap-hot, var(--go));font-weight:400;text-shadow:0 0 10px rgba(251,191,36,.6)}
```

- [ ] **Step 3: Toggle na track LEGENDA**

No popover de edição de palavra que já existe, acrescente um botão que chama a rota com `hl`:

```js
  async function toggleWordHighlight(index, start, next) {
    const r = await api('/api/captions/word', { video: currentPath, index, start, hl: next });
    words = r.words.map(w => ({ start: w.start, end: w.end, text: w.word, hl: !!w.hl }));
    renderLegendTrack(); renderLegendList(); updatePreviewOverlay();
  }
```

O chip da palavra na track ganha a classe `hot` quando `w.hl`, e o CSS a pinta com a cor do preset.

- [ ] **Step 4: Verificar**

```powershell
node --check server.js
node -e "const fs=require('fs');const s=fs.readFileSync('public/index.html','utf8');const m=s.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);new Function(m[1]);console.log('JS parseia OK')"
Invoke-RestMethod 'http://localhost:4870/api/caption-styles?full=1' | ConvertTo-Json -Depth 5 | Select-Object -First 20
```

No navegador, com um vídeo montado em `realce`: abra a TIMELINE, confirme que o overlay mostra 1 palavra por vez, em itálico, e que a palavra marcada aparece em laranja. Alterne o destaque de uma palavra pelo popover e confirme que (a) o chip muda na track, (b) o overlay reflete, (c) `jobs/<id>/transcript.json` ganhou/perdeu o `hl`, e (d) o `.ass` regenerado mudou as tags de cor.

---

## Critérios de aceite do plano

Todos verificáveis por comando; cada um mapeia para a spec.

| # | Critério | Como verificar | Task |
|---|---|---|---|
| 1 | `impact`/`clean` byte-a-byte (antes da marca de preset) | `Get-FileHash` contra golden | 2 |
| 2 | Conversão de cor correta nos 5 casos | `node -e` da Task 2 Step 7 | 2 |
| 3 | Só a linha `; studio-style:` difere após a Task 3 | `Compare-Object` | 3 |
| 4 | `realce` gera `\pos`, itálico, `\t`, cor só na marcada | inspeção do `.ass` | 3 |
| 5 | Detecção exata + fallback legado | `node` da Task 4 | 4 |
| 6 | Heurística offline nos 5 casos nomeados | `node` da Task 5 | 5 |
| 7 | Cadeia degrada em 5 formas de resposta ruim | `node` da Task 6 | 6 |
| 8 | Nenhuma chamada de LLM com preset `impact` | ausência de `[keywords]` no log | 7 |
| 9 | Marca persistida em `transcript.json` | `node -e` contando `w.hl` | 7 |
| 10 | Marca sobrevive ao conform | contagem de `&H000052FF` no `.ass` conformado | 8 |
| 11 | Rota lista os presets do JSON | `Invoke-RestMethod` | 9 |
| 12 | Preset novo no JSON aparece na UI sem tocar código | acrescentar um 4º preset e recarregar | 9, 10 |
| 13 | Toggle manual persiste e reflete nos três lugares | inspeção no navegador | 11 |

---

## Riscos herdados da spec

- **Fonte ausente é substituição silenciosa.** `realce` pede Montserrat Black Italic. A Task 7 loga a fonte pedida; isso torna visível, não detecta. Documentar o requisito no README é parte do fechamento.
- **Preview nunca bate pixel-a-pixel com libass.** O overlay aproxima posição, cor, itálico e ritmo — não tipografia.
- **Marca nasce no ASSEMBLE.** Trocar o preset depois não retro-marca. Procedência (`llm`/`offline`/`manual`) não é gravada; se o botão "re-sugerir" entrar depois, ela vira pré-requisito.

---

## Status

_(propriedade do Executor — ainda não executado)_
