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
| `server.js` | `captionStyleOf()` exato; rota `GET /api/caption-styles`; campo `hl` em `POST /api/captions/word` | 4, 9, 11 |
| `lib/keywords.js` | **novo** — escolha da palavra-chave: heurística offline, camada LLM, validação | 5, 6 |
| `lib/assemble.js` | chama a escolha atrás da porta de canal; loga a fonte pedida | 7 |
| `lib/timeline.js` | `remapWords()` preserva a marca através dos cortes | 8 |
| `public/index.html` | select do ASSEMBLE a partir da rota; overlay lendo tokens; toggle manual | 10, 11 |

---

# Task 1 — Extrair `llmChat` para `lib/llm.js`

Refactor puro, sem mudança de comportamento. Existe para que `lib/keywords.js` (Task 6) dependa de infraestrutura e não de uma feature.

**Files:**
- Create: `lib/llm.js`
- Modify: `lib/clipper.js:98-128` (remove o comentário + a função), `lib/clipper.js:10-11` (imports que ficam órfãos), topo (import novo)

**Interfaces:**
- Produz: `llmChat(messages) -> Promise<string>` — `messages` no formato Chat Completions (`[{role, content}]`), resolve com o texto de `choices[0].message.content`. Rejeita com `Error` em timeout, erro de rede ou parse.
- Consome: nada.

- [ ] **Step 1: Capturar o corpo atual para comparação**

```powershell
$sc = "$env:TEMP\etapa3"; New-Item -ItemType Directory -Force $sc | Out-Null
(Get-Content lib/clipper.js)[98..127] | Set-Content "$sc\llmchat-antes.txt"
Get-Content "$sc\llmchat-antes.txt" -TotalCount 2
```

Esperado: `function llmChat(messages) {` seguido de `return new Promise((resolve, reject) => {`. O índice `[98..127]` é 0-based, então captura as linhas 99–128 — a função exata, **sem** o comentário que fica acima dela. (O comentário é apagado no Step 3, mas não precisa entrar na cópia.)

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

**Atenção — há um falso positivo conhecido, e seguir o plano ao pé da letra sem ele leva ao erro.** A linha 30 é `if (/^https?:\/\//i.test(input)) {`. Isso é um teste de esquema de URL dentro de um literal de regex — **não** é uso do módulo `https`. Ela aparece na busca e deve ser ignorada.

Esperado, depois de remover `llmChat`: exatamente três linhas — os dois `require` das linhas 10–11 (que você vai remover) e a regex da linha 30. Se aparecer **qualquer outra** linha, aí sim é uso real de módulo: mantenha o import correspondente e registre no `## Status`.

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
const path = require('path');
const { buildAss } = require(path.resolve('lib/captions'));
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

Esperado: dois arquivos `.golden.ass` com tamanho > 0. **Guarde-os — são a referência do resto da task, e a Task 3 os reusa.**

> **Duas armadilhas de ambiente, já pagas uma vez.** (a) O `gen.js` é gravado em `$env:TEMP`, mas `require` resolve caminho relativo contra o **arquivo**, não contra o cwd — daí o `path.resolve('lib/captions')` acima, que resolve contra o cwd (a raiz do repo, de onde você chama `node`). Um `require('./lib/captions')` falha com `MODULE_NOT_FOUND`. (b) `Get-FileHash` pode não existir no `powershell` 5.1; se faltar, use `pwsh` (PowerShell 7) para os Steps 6 e 7.

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
const path = require('path');
const { buildAss } = require(path.resolve('lib/captions'));
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

# Task 12 — Pontuação fora do destaque

Achado em dados reais: a heurística acerta a palavra, mas o token vem com a pontuação colada e ela sai pintada junto — `ARREPENDER.`, `TRANQUILO,`, `ESPECIAL?`, `200.` aparecem com o ponto/vírgula em laranja.

**Files:**
- Modify: `lib/captions.js` (só o ramo `channel === 'keyword'` de `buildAss`)

**Interfaces:** nenhuma mudança de assinatura.

**Restrição dura:** o ramo `'spoken'` **não pode ser tocado**. `impact` e `clean` continuam byte-a-byte idênticos aos goldens em `$env:TEMP\etapa3`. Se o golden se mexer, o fix está errado.

- [ ] **Step 1: Separar borda do miolo no ramo `keyword`**

Substitua o corpo do ramo `if (channel === 'keyword')` por:

```js
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
```

O miolo é lazy, então a busca para no primeiro ponto em que o resto casa a classe de pontuação final. Para `R$` a classe não aceita `$`, então o miolo fica `R$` inteiro e a moeda é destacada junto — que é o desejado.

- [ ] **Step 2: Verificar que `impact`/`clean` não se moveram**

```powershell
$sc = "$env:TEMP\etapa3"
node --check lib/captions.js
node "$sc\gen.js" "$sc"
Compare-Object (Get-Content "$sc\impact.golden.ass") (Get-Content "$sc\impact.ass")
Compare-Object (Get-Content "$sc\clean.golden.ass")  (Get-Content "$sc\clean.ass")
```

Esperado: **nenhuma** linha de diferença nos dois. Qualquer diferença significa que o ramo `spoken` foi tocado.

- [ ] **Step 3: Verificar a separação no ramo `keyword`**

Gere um `.ass` com `realce` a partir de palavras marcadas cobrindo cada forma de pontuação, e inspecione as linhas `Dialogue`. Confira item a item:

- `ARREPENDER` dentro das tags de cor e o `.` **fora**, depois da tag que volta ao primário
- idem para `TRANQUILO` + `,`, `ESPECIAL` + `?`, `200` + `.`
- `R$` **inteiro dentro** da cor — a moeda faz parte da palavra, não é pontuação de borda
- uma palavra sem `hl` continua sem nenhuma tag de cor

- [ ] **Step 4: Token só de pontuação não quebra**

Gere `.ass` com `realce` para tokens marcados que são só pontuação (`...`, `—`, `?!`). Esperado: nenhum deles produz par de tags de cor vazio (`{\c...}{\c...}` sem nada entre); o token volta como estava.

---

# Task 13 — `R$` colado: normalizar token de símbolo puro

Achado em dados reais (`jobs/a881f2218ce0/transcript.json`): o Whisper emite `R$` como dois tokens, e o `$` sai com **duração zero**.

```
[75] "R"    start=28.34 end=28.54
[76] "$"    start=28.54 end=28.54   <- duração zero
[77] "200." start=28.54 end=28.72
```

A legenda renderiza `R $ 200.` com espaço no meio. A moeda tem que ficar colada.

**Files:**
- Modify: `lib/transcribe.js` (função nova, aplicação nos dois caminhos de saída, export)

**Interfaces:**
- Produz: `mergeSymbolTokens(words) -> words` — array novo, tokens de símbolo puro com duração zero fundidos no vizinho anterior.

**Base empírica da regra:** varredura dos transcripts reais em `jobs/` — 136 palavras, exatamente **1** token sem letra nem dígito e exatamente **1** com duração zero, e são o mesmo `$`. A regra atinge esse caso e nada mais na amostra. A amostra é pequena (2 transcripts), então a regra exige **as duas** condições juntas, de propósito.

- [ ] **Step 1: Acrescentar a função**

Logo antes de `viaOpenaiWhisper`:

```js
// O Whisper às vezes emite um símbolo isolado como token próprio, com duração
// zero — "R$" vira ["R", "$"] e a legenda renderiza "R $ 200". Símbolo puro
// (sem letra nem dígito) COM duração zero é artefato de tokenização, não fala:
// funde no vizinho anterior. As duas condições juntas são de propósito — um
// símbolo com duração real foi pronunciado e fica como token próprio.
function mergeSymbolTokens(words) {
  const out = [];
  for (const w of words || []) {
    const isSymbol = !/[\p{L}\p{N}]/u.test(String(w.word || ''));
    const zeroDur = !(w.end > w.start);
    if (isSymbol && zeroDur && out.length) {
      const prev = out[out.length - 1];
      prev.word += w.word;
      prev.end = Math.max(prev.end, w.end);
      continue;
    }
    out.push({ ...w });
  }
  return out;
}
```

Funde para **trás** porque é o que produz `R$` a partir de `["R","$"]`. Um símbolo na primeira posição não tem vizinho anterior e é preservado como está.

- [ ] **Step 2: Aplicar nos dois caminhos**

Em `viaOpenaiWhisper`, no `return`, troque `words` por `mergeSymbolTokens(words)`.
Em `viaWhisperCpp`, no `return`, faça o mesmo.

Os dois precisam, senão o comportamento passa a depender de qual engine está instalado.

- [ ] **Step 3: Exportar para teste**

Acrescente `mergeSymbolTokens` ao `module.exports` de `lib/transcribe.js`, preservando o que já está exportado. Sem isso os Steps seguintes não rodam.

- [ ] **Step 4: Verificar contra a forma real do dado**

Rode `mergeSymbolTokens` sobre exatamente a sequência que existe no transcript real:

```
[{word:'de',start:28.1,end:28.34},{word:'R',start:28.34,end:28.54},{word:'$',start:28.54,end:28.54},{word:'200.',start:28.54,end:28.72}]
```

Esperado: 4 palavras viram 3, e o token da moeda vira `{"word":"R$","start":28.34,"end":28.54}` — o `start` do `R` preservado, o `end` sendo o maior dos dois.

- [ ] **Step 5: Casos de borda**

Verifique, um a um:

| Entrada | Esperado | Por quê |
|---|---|---|
| `[{word:'$',start:0,end:0}]` | `["$"]` | símbolo sozinho, sem vizinho anterior — preservado |
| `[{word:'a',...0→1},{word:'!',...1→1.4}]` | `["a","!"]` | símbolo com duração real foi pronunciado, não funde |
| `[]` | `[]` | array vazio não quebra |
| `[{word:'x',0→1},{word:'-',1→1},{word:'y',1→2}]` | `["x-","y"]` | hífen de duração zero funde para trás |

- [ ] **Step 6: Não muta a entrada**

Chame `mergeSymbolTokens` sobre um array e confirme que o array original continua idêntico depois (serialize antes e depois e compare). A função devolve estrutura nova; mutar a entrada quebraria quem reusa o array.

---

# Task 14 — Quantificadores em STOPWORDS

Achado em dados reais: `"vão durar por [MUITOS] anos"` — a heurística escolheu `MUITOS`. Quantificador não é palavra-chave; `anos` ou `durar` seriam melhores.

**Files:**
- Modify: `lib/keywords.js` (lista `STOPWORDS`)

- [ ] **Step 1: Acrescentar à lista**

No `Set` `STOPWORDS`, acrescente uma linha mantendo o estilo das existentes:

```js
  'muito','muita','muitos','muitas','todo','toda','todos','todas','cada','bastante','bastantes',
```

As flexões de gênero e número entram junto porque o português as exige — marcar só `muitos` deixaria `muitas` passar.

- [ ] **Step 2: Verificar o caso real**

Rode `pickOffline` sobre o segmento real `"E além de serem peças que vão durar por muitos anos"`. Esperado: a escolha **não** é `muitos`. Com `muitos` fora, a regra de palavra longa (≥6 caracteres, não-stopword) passa a mandar.

- [ ] **Step 3: Não quebrou os casos nomeados**

Re-rode os 5 casos do Step 2 da Task 5 e os 3 de regressão dos fix rounds. Esperado, sem alteração: `80%`; `resultado`; `0`; `2`; `OK`; e `["risco"]`, `[]`, `["detalhadamente"]`.

- [ ] **Step 4: Conferir o efeito na fala real**

Rode `pickOffline` contra os `transcript.json` que já existem em `jobs/` e compare a escolha de cada segmento com a de antes desta task. Registre no relatório o antes/depois de cada segmento que mudou — é o dado que o usuário vai julgar.

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

_(propriedade do Executor)_

### Task 1 — Extrair `llmChat` para `lib/llm.js` — DONE (2026-09-13)

- Criado `lib/llm.js` (cópia literal do corpo de `llmChat`, linhas 99-128 de `lib/clipper.js`
  antes da extração, mais requires de `http`/`https` e `module.exports`).
- `lib/clipper.js`: removidos os requires órfãos de `http`/`https`, removido o comentário +
  a função `llmChat` (o falso positivo da regex `if (/^https?:\/\//i.test(input))` em
  `resolveSource` foi identificado e ignorado, como o brief antecipava), e adicionado
  `const { llmChat } = require('./llm');` ao bloco de imports.
- Todas as verificações do Step 5 do brief passaram: `node --check` limpo em ambos os
  arquivos, `llm.js exporta: function`, `clipper carrega sem erro`, contagem de
  `function llmChat` em `clipper.js` = `0`. Comparação linha a linha (`Compare-Object`)
  confirmou que o corpo copiado para `llm.js` é idêntico ao original.
- Detalhe menor sem impacto no resultado: os números de linha exatos citados no brief para
  os requires órfãos (9-10) e a função a remover (98-128) estavam com off-by-one em relação
  ao arquivo real antes da edição (eram 10-11 e 98-128 respectivamente — a função batia, os
  requires estavam deslocados em 1 linha). Segui o conteúdo e a confirmação via Step 4, não
  o número absoluto, como o próprio brief instruía. Ver
  `.superpowers/sdd/captions-karaoke-highlight/task-1-report.md` para a saída completa dos
  comandos e o diff.

### Task 2 — Presets como dado (`styles/captions.json`), byte-a-byte — DONE (2026-09-13)

- Golden capturado ANTES de qualquer edição (Step 1): `impact.golden.ass` (1467 bytes) e
  `clean.golden.ass` (1461 bytes) em `%TEMP%\etapa3`, confirmados como não apagados —
  ficam para a Task 3 reusar.
- Criado `styles/captions.json` com os dois presets (`impact`, `clean`), valores
  copiados literalmente do brief.
- `lib/captions.js` reescrito conforme o brief: bloco `STYLES` hardcoded (linhas 7-17)
  substituído por `STYLES_FILE`/`FALLBACK_IMPACT`/`loadStyles()`/`resolveStyle()`/
  `assColor()`/`styleNames()`; `buildAss` passou a usar `resolveStyle(style)` +
  `maxW`/`upper` derivados de `S.layout`; cor do destaque e da linha `Style:` convertidas
  via `assColor()`; `Bold`/`Italic`/`Alignment` deixaram de ser literais (`S.bold ? -1 : 0`,
  `S.italic ? -1 : 0`, `S.position.align`); exports trocaram `STYLES` por `resolveStyle`,
  `styleNames`, `assColor`.
- Step 5 (busca por outros consumidores de `STYLES`): só ocorrências dentro do próprio
  `lib/captions.js` — nenhum outro arquivo importa `STYLES`.
- Step 6 (prova byte-a-byte): **`impact: IDENTICO`** e **`clean : IDENTICO`** via
  `Get-FileHash`, na primeira tentativa após a reescrita — não foi preciso nenhum ajuste
  de `Bold`/`Italic`/`Alignment` além do que o brief já continha verbatim.
- Step 7 (conversão de cor isolada): `todas as conversoes OK` para as 5 amostras
  (`#FFFFFF`, `#FFFF00`, `#FFD700`, `#FF5200`, `#000000`).
- Dois desvios técnicos, sem impacto no resultado, documentados em
  `.superpowers/sdd/captions-karaoke-highlight/task-2-report.md`: (1) o `gen.js` do
  Step 1/6, copiado literalmente do brief, usa `require('./lib/captions')` — resolvido
  relativo ao próprio `gen.js` (em `%TEMP%\etapa3`), não ao cwd; como escrito, falha com
  `MODULE_NOT_FOUND`. Corrigido trocando para um require de caminho absoluto ao
  `lib/captions.js` do repo, sem alterar a lista de palavras nem a lógica de geração —
  só o mecanismo de resolução do módulo. (2) `Get-FileHash` não estava disponível via
  `powershell` (Windows PowerShell 5.1) neste ambiente (módulo não carregou, causa não
  investigada); usado `pwsh` (PowerShell 7, também presente no PATH) só para os comandos
  dos Steps 6/7 que dependiam de `Get-FileHash` — mesma lógica, mesmo resultado.

**Fix round 1/5 (review) — DONE (2026-09-13):** dois achados Important, ambos no código
verbatim do brief. (1) `catch` de `loadStyles()` mudo: adicionado `console.error` com
arquivo/causa/consequência antes do fallback para `impact`; semântica fail-soft mantida
(sem exceção, sem duplicar `clean` no `FALLBACK_IMPACT`). (2) override de
`maxWords`/`uppercase` do chamador era descartado (preset sempre vencia): removidos os
defaults da desestruturação de `buildAss`, precedência corrigida para
chamador > preset > default embutido. Reverificado: `node --check` limpo; Step 6
re-rodado, `impact: IDENTICO` e `clean : IDENTICO` de novo; comparação antigo
(`snap-before-task-2`) vs. novo em 5 casos (incluindo 3 com override explícito) deu
`TODOS IDENTICOS`; corrupção forçada de `styles/captions.json` (renomeado e restaurado)
confirmou o `console.error` disparando e o arquivo restaurado íntegro depois. Detalhes e
saída literal completa em
`.superpowers/sdd/captions-karaoke-highlight/task-2-report.md`.

### Task 3 — Preset `realce` e o canal `keyword` — DONE (2026-09-13)

- `styles/captions.json`: acrescentado o preset `realce` (Step 1 do brief, verbatim) —
  `Montserrat Black`/96/italic, `layout.maxWords: 1`, `position.align/x/y: 5/540/1210`,
  `highlight.channel: keyword` cor `#FF5200`, `enter.fromScale: 80` / `ms: 180`.
- `lib/captions.js`: `line.map(...)` ramificado por `channel` (`none` | `keyword` | o
  `spoken` histórico, intocado); bloco `pre` novo antes da `Dialogue` que emite
  `\an{align}\pos(x,y)` quando `position.x`/`.y` existem e
  `\fscx{f}\fscy{f}\t(0,{ms},\fscx100\fscy100)` quando `enter.fromScale` existe — para
  `impact`/`clean`, nenhuma das duas dispara, `pre` fica `''`; linha
  `; studio-style: ${style}` acrescentada ao `[Script Info]` (usa o parâmetro `style`
  que `buildAss` já recebia, sem variável nova).
- Step 5 (`realce.ass` gerado a partir de 3 palavras, uma com `hl: true`): todos os 5
  itens do checklist confirmados — marca `; studio-style: realce` presente; `Style:`
  com `Montserrat Black`/`96`/Italic(9º campo)=`-1`; os 3 eventos `Dialogue` trazem
  `{\an5\pos(540,1210)}` e `{\fscx80\fscy80\t(0,180,\fscx100\fscy100)}`; só `sucesso`
  traz `{\c&H000052FF}` (as outras sem tag `\c`); nenhuma palavra em caixa alta.
  `assColor('#FF5200')` = `&H000052FF`, como esperado.
- Step 6 (goldens `impact`/`clean` regerados e comparados via `Compare-Object` contra a
  cópia da Task 2): **exatamente uma linha de diferença em cada um**, marcada `=>` — a
  linha de marca (`; studio-style: impact` / `; studio-style: clean`). Nenhuma outra
  divergência. Goldens promovidos (`impact.golden.ass` 1490 bytes, `clean.golden.ass`
  1483 bytes) em `%TEMP%\etapa3`, passam a ser a referência das próximas tasks; os
  antigos preservados como `*.golden.prev.ass` no mesmo diretório, não apagados.
- Dois desvios sem impacto no resultado, documentados em
  `.superpowers/sdd/captions-karaoke-highlight/task-3-report.md`: (1) rodar o Step 5 via
  um `.ps1` sem BOM contendo um here-string com acento (`não`) corrompeu o texto na
  decodificação do PowerShell 5.1 do próprio script — problema de tooling, não de
  `lib/captions.js`; contornado escrevendo `gen-realce.js` via heredoc UTF-8 do Bash e
  rodando `node` direto, o que resolveu. (2) o campo MarginV da linha `Style:` de
  `realce` sai `undefined` (`...,5,60,60,undefined,1`) porque o preset posiciona via
  `position.x`/`.y` (→ `\pos()` no evento) em vez de `position.marginV`, e o template da
  linha `Style:` sempre interpola `${S.position.marginV}`; não afeta o posicionamento
  real (`\pos()` sobrescreve) nem está no checklist do Step 5 — não alterado, fora do
  escopo pedido pelo brief; sinalizado para o Orquestrador avaliar limpeza futura.

**Fix round 1/5 (Task 3) — DONE (2026-09-13):** o Orquestrador confirmou a preocupação
nº 2 como defeito real, não cosmético — o campo MarginV da linha `Style:` saía como a
string literal `undefined` para qualquer preset sem `marginV` (escondido em `realce`
porque `\pos()` sobrescreve, mas latente para presets futuros escritos à mão sem
`marginV` e sem `position.x`/`.y`). Corrigido só no template (`lib/captions.js`, não em
`styles/captions.json`), com guarda `!= null` consistente com a disciplina já usada para
`maxWords`/`uppercase`: `${S.position.marginV != null ? S.position.marginV : 0}`.
Verificado: `node --check` limpo; as 3 linhas `Style:` (`realce`/`impact`/`clean`) sem
`undefined`, `realce` terminando em `,60,60,0,1`; `impact`/`clean` regerados e
comparados (`diff`/`Compare-Object`) contra os goldens promovidos no Step 6 da Task 3 —
**nenhuma diferença**, confirmando que o fix não tocou os dois presets com `marginV`
explícito; `realce.ass` corrigido queimado via `ffmpeg n6.1.3` (`subtitles=`,
`subFilter()`) — encode concluiu com sucesso, nenhum erro de parse de estilo no stderr
de libass (só a substituição de fonte esperada, já documentada como risco conhecido).
Detalhes e saída literal completa em
`.superpowers/sdd/captions-karaoke-highlight/task-3-report.md`.

### Task 4 — `captionStyleOf()` exato — DONE (2026-09-13)

- `server.js`: `captionStyleOf(dir)` substituída verbatim conforme o Step 1 do brief —
  antes de cair no fallback heurístico (`Arial Black` → `impact`, `Style:\s*Word,Arial,`
  → `clean`, ambos intocados, com o comentário explicando que são heurísticos e não
  devem ser estendidos a presets novos), a função agora tenta primeiro a marca exata
  `/^;\s*studio-style:\s*(\S+)\s*$/m` gravada pela Task 3 no `[Script Info]` do `.ass` e,
  se casar, devolve o nome do preset direto (`m[1]`) — resolve `realce` (que usa
  Montserrat, não Arial/Arial Black) sem precisar estender o sniff de fonte. Assinatura
  (`dir` único parâmetro), `path.join(dir, 'captions.ass')`, indentação de 4 espaços
  (função aninhada dentro do handler) e o `return 'impact'` final preservados sem
  alteração — nenhum dos 3 outros call-sites (`/api/captions`, `/api/captions/word`, e
  um terceiro em `captionStyle = captionStyleOf(capDir)`) precisou de ajuste, todos
  continuam passando `dir`/`capDir` já derivado de `jobDirForVideo()`.
- Divergência de numeração sem impacto: o brief cita `server.js:281-289`; o bloco real
  da função, antes da edição, ocupava 281-288 (a 289 já era o próximo handler). Edição
  feita por conteúdo exato (`old_string`/`new_string`), não por número de linha.
- Step 2 do brief (três casos: `.ass` novo com marca, `.ass` legado sem marca simulado
  filtrando a linha de marca de `impact.golden.ass`, string vazia) rodou com o resultado
  esperado exato: `realce`, `impact`, `impact`. `node --check server.js` limpo.
- Limitação documentada do próprio Step 2: ele testa uma **cópia duplicada** da lógica
  da regex num `node -e` isolado, não a função real (aninhada, não exportável sem
  refatorar `server.js`, fora de escopo). Verificação extra feita para reduzir a
  lacuna — grep confirmando a regex presente em `server.js` na linha editada, e leitura
  completa do bloco confirmando equivalência byte-a-byte (exceto comentários e o
  `try/catch` já existente) entre a cópia testada e o código real. Isso foi conferido
  por leitura, não por execução — não é o mesmo que testar `captionStyleOf` de
  `server.js` diretamente.
- Confirmado por `Select-String` que os três `.ass` de referência em `%TEMP%\etapa3`
  (`realce.ass`, `impact.golden.ass`, `clean.golden.ass`) trazem a marca esperada, e que
  nada foi apagado desse diretório (só um subdiretório novo `styleof\` e um script novo
  `styleof.js`, ambos criados pelo próprio Step 2, como esperado). Detalhes e saída
  literal completa em
  `.superpowers/sdd/captions-karaoke-highlight/task-4-report.md`.

### Task 5 — `lib/keywords.js`: heurística offline — DONE (2026-09-13)

- Criado `lib/keywords.js` (arquivo novo), verbatim a partir do Step 1 do brief: `STOPWORDS`
  (Set, duplicatas de `'a'`/`'nos'` mantidas — inofensivas por construção, não limpas),
  `NUMERIC`, `MIN_WORDS_PER_SEGMENT`/`MIN_LONG_WORD`, `normalize()` (`\p{L}\p{N}` + flag `u`,
  preservado), `isStop()`, `wordsInSegment()` (comparação por `w.start` com tolerância
  `1e-6`, não trocada por `end`), `pickInSegment()` (prioridade número → palavra longa
  não-stopword → última palavra de conteúdo → `null`, ordem preservada exatamente),
  `pickOffline()`, `applyHighlights()` (novo array via `.map`/spread, não muta a entrada,
  palavra sem destaque sai sem o campo `hl`). Sem nenhum `require` — nem `fs`, `path`, nem
  outro módulo do projeto, conforme pedido (a camada LLM entra só na Task 6).
- `node --check lib/keywords.js`: limpo.
- Step 2 do brief (5 casos nomeados) rodou com resultado exato, linha a linha:
  `1 numero vence -> 80%`, `2 mais longa -> resultado`, `3 segmento curto -> 0`,
  `4 um por segmento -> 2`, `5 imutabilidade -> OK`. Confirmação explícita do caso 5:
  `src[1].hl === undefined` depois da chamada (entrada não mutada), `got[1].hl === true`,
  `got[0].hl === undefined` (ausência do campo, não `hl:false`).
- Único ajuste mecânico: o script de verificação do Step 2, gravado em `%TEMP%\etapa3`,
  usou `require(path.resolve('lib/keywords'))` em vez de `require('./lib/keywords')` do
  brief literal, porque `require` relativo resolveria contra o próprio arquivo em
  `%TEMP%`, não contra o cwd do repo — mesmo padrão já usado nas Tasks 2-4. Nenhuma outra
  linha do script do brief foi alterada.
- Nenhuma divergência entre o comportamento observado e a expectativa do brief — não foi
  necessário investigar defeito na heurística nem ajustar teste algum. Detalhes e saída
  literal completa em
  `.superpowers/sdd/captions-karaoke-highlight/task-5-report.md`.

**Fix round 1/5 (Task 5) — DONE (2026-09-13):** achado `plan-mandated` — a prioridade
"número vence" em `pickInSegment` testava `/[0-9]/` na palavra crua sem exigir
substância e usava `.find()`, então um dígito solto (`"1"`) ou artefato de transcrição
(`"-1-"`) roubava o destaque de uma frase com conteúdo real; defeito no código que o
brief mandou copiar verbatim, não na execução da Task 5. Corrigido conforme
especificação exata do Orquestrador: nova constante `MIN_NUMERIC_LEN = 2` e guarda de
substância na linha do `.find()` (`normalize(words[i].word).length >= MIN_NUMERIC_LEN`),
resto de `pickInSegment` intacto (mesma ordem de prioridade). Verificado: `node --check`
limpo; os 5 casos nomeados do Step 2 continuam passando sem alteração no script
(`80%`, `resultado`, `0`, `2`, `OK` — o caso 1 prova que a guarda não foi longe demais);
os dois cenários do achado agora escolhem a palavra certa (`digito solto -> detalhadamente`,
`artefato -1- -> importante`); os quatro números legítimos continuam vencendo
(`80%`, `3x`, `2024`, `R$50`, todos com `normalize().length >= 2`). Único arquivo
tocado: `lib/keywords.js`. Saída literal completa em
`.superpowers/sdd/captions-karaoke-highlight/task-5-report.md`.

**Fix round 2/5 (Task 5) — DONE (2026-09-13):** o re-review confirmou o fix do round 1
correto, mas achou que o mesmo defeito sobrevivia por outro caminho: o laço de
"última palavra de conteúdo" (fallback) aceitava um número sem substância (`"1"`) por
posição, porque só filtrava stopword — não repetia a checagem numérica já aplicada na
via numérica logo acima. Como consequência, palavras de conteúdo curtas em português
(`risco`, `gasto`, `custo`) nunca chegavam a competir, porque ficam abaixo de
`MIN_LONG_WORD` (6). Julgamento do Orquestrador: buraco no julgamento do próprio round
1 (guarda aplicada só na via numérica), não erro de execução. Corrigido conforme
especificação exata: o laço final passou a pular (`continue`) tokens que são número sem
substância (`NUMERIC.test(w) && normalize(w).length < MIN_NUMERIC_LEN`), mantendo
`isStop` como primeiro filtro e deixando palavra curta NÃO-numérica (`vi`, `ha`, `ir`)
intacta. Nenhuma mudança do round 1 desfeita. Verificado: `node --check` limpo; os 5
casos nomeados do Step 2 continuam passando sem alteração no script (`80%`, `resultado`,
`0`, `2`, `OK`); os três cenários do achado corrigidos (`risco,de,1 -> risco`,
`gasto,de,1 -> gasto`, `de,1,a -> []`); a exclusão não atingiu palavra curta
não-numérica (`ele,ja,vi -> vi`, `isso,nao,ha -> ha`, `que,ele,ir -> ir`); os quatro
números legítimos do round 1 continuam vencendo sem regressão (`80%`, `3x`, `2024`,
`R$50`). Único arquivo tocado: `lib/keywords.js`. Saída literal completa em
`.superpowers/sdd/captions-karaoke-highlight/task-5-report.md`.

### Task 6 — Camada LLM em `lib/keywords.js` — DONE (2026-09-13)

- `lib/keywords.js` (único arquivo tocado): `const { llmChat } = require('./llm');`
  inserido logo abaixo de `'use strict';`, no topo do arquivo (primeiro `require` do
  módulo), conforme a decisão explícita do Orquestrador — não anexado depois do
  `module.exports`. `buildPrompt`, `parseLlmPicks` e `pickKeywords` acrescentados antes
  do `module.exports`, verbatim ao Step 1 do brief, junto das demais funções do módulo.
  `module.exports` substituído (não duplicado) por
  `{ pickKeywords, pickOffline, applyHighlights, parseLlmPicks, STOPWORDS }`. Nada da
  Task 5 foi tocado: `MIN_NUMERIC_LEN`, a guarda de substância na via numérica de
  `pickInSegment`, e as duas condições de `continue` no laço de fallback seguem intactas.
- `node --check lib/keywords.js`: limpo.
- Step 2 do brief (6 casos), rodado a partir de `%TEMP%\etapa3\kw2.js` com
  `require(path.resolve('lib/keywords'))` (mesmo padrão das Tasks 2-5, `require`
  relativo do brief resolveria contra o próprio script em `%TEMP%`, não contra o cwd do
  repo), `delete process.env.LLM_BASE_URL` exercitando o caminho offline sem rede, e os
  outros 5 casos chamando `parseLlmPicks` direto com strings, sem rede: resultado exato,
  linha a linha — `offline / 1` (`source = offline`, `marcados = 1`), `null OK`, `0 OK`,
  `0 OK`, `2 OK`, `1 OK`. Nenhuma divergência entre o comportamento observado e a
  expectativa do brief.
- Verificação adicional pedida pelo Orquestrador — regressão dos dois fixes da Task 5 via
  `pickOffline` (`%TEMP%\etapa3\kw2-regress.js`): `["risco","de","1"] -> ["risco"] OK`,
  `["de","1","a"] -> [] OK`, `["explicamos","1","detalhadamente"] -> ["detalhadamente"] OK`.
  Os dois fixes sobreviveram intactos.
- Nenhuma chamada real a LLM foi feita; nenhuma credencial lida ou inventada; `.env` não
  tocado; nenhum comando git executado por este agente. Detalhes e saída literal completa
  em `.superpowers/sdd/captions-karaoke-highlight/task-6-report.md`.

### Task 12 — Pontuação fora do destaque — DONE (2026-09-13)

- Único arquivo tocado: `lib/captions.js`, só o corpo do `if (channel === 'keyword')`
  dentro de `buildAss` (o `.map((x, j) => {...})` que monta o texto de cada palavra).
  Substituído verbatim pelo trecho do Step 1 do brief: guarda `if (!x.hl) return t;`
  seguida da regex `/^([¿¡"'«(\[]*)([\s\S]*?)([.,!?;:…"'»)\]]*)$/u` que separa
  `pre`/`core`/`post`, guarda `if (!core) return t;` para token só-pontuação, e retorno
  com as tags de cor só ao redor de `core`. O `const pre` desta regex vive dentro do
  callback do `.map`, escopo distinto do `let pre` (prefixo `\pos`/`\t`) declarado mais
  abaixo em `buildAss` — sem shadowing, confirmado por leitura e por `node --check`. Ramo
  `channel === 'spoken'` (mesmo `.map`, ramo seguinte) não foi tocado.
- Step 1/`node --check`: limpo.
- Step 2 (restrição dura do brief): `impact`/`clean` regerados e comparados contra os
  goldens vigentes (os promovidos pela Task 3) por dois caminhos — `diff` (exit 0 nos
  dois) e `Compare-Object` via `pwsh`, comando literal do brief: **vazio nos dois**,
  confirmando que o ramo `spoken` não se moveu.
- Step 3 (separação de borda): `.ass` gerado com preset `realce` (único `channel:
  keyword`) cobrindo `ARREPENDER.`, `TRANQUILO,`, `ESPECIAL?`, `200.`, `R$` (todos com
  `hl: true`) e uma palavra sem `hl`. Os 6 itens do checklist do brief conferidos um a
  um nas linhas `Dialogue`: pontuação de borda (`.`, `,`, `?`) sempre fora da tag de cor,
  logo após a tag que volta ao primário; `R$` inteiro dentro da cor (moeda não é
  pontuação de borda, por desenho); palavra sem `hl` sem nenhuma tag.
- Step 4 (token só-pontuação): `...`, `—`, `?!`, todos com `hl: true`. Nenhum produziu
  par de tags de cor vazio. `...` e `?!` — cujos caracteres casam inteiramente a classe
  de pontuação de borda do brief — voltaram sem nenhuma tag (`core` vazio, guarda
  aplicada). `—` (travessão) não está em nenhuma das duas classes de pontuação definidas
  pelo brief, então é tratado como `core` e recebe a cor — não é um par vazio, e o brief
  só exige ausência de par vazio, não ausência de qualquer tag; comportamento decorre do
  regex fornecido literalmente pelo brief, nenhum ajuste feito.
- Nenhum desvio do brief. Saída literal completa em
  `.superpowers/sdd/captions-karaoke-highlight/task-12-report.md`.

### Task 14 — Quantificadores em STOPWORDS — DONE (2026-09-13)

- Único arquivo tocado: `lib/keywords.js`, só o `Set` `STOPWORDS` — acrescentada a linha
  `'muito','muita','muitos','muitas','todo','toda','todos','todas','cada','bastante','bastantes',`
  verbatim ao Step 1 do brief, na posição indicada (logo após os pronomes
  demonstrativos, antes do bloco de stopwords em inglês). Preservados sem alteração:
  `MIN_NUMERIC_LEN = 2`; a guarda de substância numérica em `pickInSegment`; as duas
  condições de `continue` do laço final de fallback (stopword e número sem substância) —
  nenhuma delas foi tocada por esta task.
- `node --check`: limpo.
- Step 2 (caso real isolado): `pickOffline` sobre `"E além de serem peças que vão durar
  por muitos anos"` escolhe `anos` (≠ `muitos`, como pedido). Com `muitos` fora de
  `STOPWORDS`, nenhuma palavra do segmento chega a `MIN_LONG_WORD` (6), então a regra de
  "última palavra de conteúdo" do fallback decide, e cai em `anos` — uma das duas opções
  que o brief antecipava (`anos` ou `durar`).
- Step 3 (regressão): os 5 casos nomeados da Task 5 Step 2 (`80%`; `resultado`; `0`; `2`;
  `OK`) e os 3 de regressão dos fix rounds (`["risco"]`, `[]`, `["detalhadamente"]`) —
  todos batendo exatamente, sem alteração.
- Step 4 (efeito na fala real, `jobs/`) — o dado que o usuário vai julgar: `pickOffline`
  rodado sobre os 6 `transcript.json` de `jobs/` antes e depois da edição (script
  read-only em `%TEMP%\etapa3\task14\pick-all.js`; `jobs/` confirmado sem alteração via
  `git status --porcelain jobs/`, saída vazia). Os 6 diretórios são só **2 gravações
  distintas** (dedupe por contagem de palavras + prefixo do texto, confirmado por
  igualdade *exata* de `transcript.text`, não só pelo prefixo):
  - Grupo A — `81d51848114d`, `87e24ff6edc3`, `9680c0370b29`, `cb783eda2bd9` ("Venha
    conhecer as peças da marca de jeans...").
  - Grupo B — `a881f2218ce0`, `f7140a2565ba` ("Dúvidas sobre o que comprar para aquela
    pessoa especial?...").

  Sobre os 10 segmentos únicos resultantes (2 do grupo A + 8 do grupo B), **exatamente
  um mudou de escolha** — o caso relatado pelo usuário:

  ```
  segmento (grupo B, si=3): "E além de serem peças que vão durar por muitos anos," : muitos -> anos,
  ```

  Os outros 9 segmentos permaneceram com a mesma escolha antes/depois (confirmado por
  `diff` bruto entre as duas saídas JSON — uma única linha divergente). A vírgula colada
  em `anos,` é tokenização pré-existente do transcript, não introduzida por esta task —
  é a Task 12, endereçada separadamente, quem tira a pontuação de borda da cor no render.
- Nenhum desvio do brief. `jobs/` não foi modificado (só leitura). Saída literal completa
  em `.superpowers/sdd/captions-karaoke-highlight/task-14-report.md`.

### Task 13 — `R$` colado: normalizar token de símbolo puro — DONE (2026-09-13)

- Único arquivo tocado: `lib/transcribe.js`. Acrescentada a função `mergeSymbolTokens`
  (verbatim do Step 1 do brief) logo antes de `viaOpenaiWhisper`; aplicada nos dois
  caminhos de saída — `viaOpenaiWhisper` e `viaWhisperCpp` — trocando `words` por
  `mergeSymbolTokens(words)` no `return` de cada um; `module.exports` passou de
  `{ transcribe }` para `{ transcribe, mergeSymbolTokens }`, preservando `transcribe`.
  Nada mais no arquivo foi tocado (`run()`, `extractWav()`, `PYTHONIOENCODING`, cadeia de
  fallback de engine em `transcribe()`).
- Step 4 (forma real do dado `["de","R","$","200."]`): 4 palavras → 3, token da moeda
  `{"word":"R$","start":28.34,"end":28.54}` — `start` do `R` preservado, `end` o maior dos
  dois. Exato conforme o brief.
- Step 5 (4 casos de borda): `["$"]` (símbolo sozinho, sem vizinho, preservado); `["a","!"]`
  (símbolo com duração real, não funde); `[]` (array vazio, não quebra); `["x-","y"]`
  (hífen de duração zero funde para trás). 4/4 batendo com a tabela do brief.
- Step 6 (não muta a entrada): serialização do array original antes e depois da chamada
  idêntica; `result !== originalArr` confirma retorno de estrutura nova. `prev.word +=
  w.word` escreve em `prev = out[out.length - 1]`, e todo elemento só entra em `out` via
  `out.push({ ...w })` (cópia) — nunca há escrita no objeto original.
- Verificação extra sobre `jobs/a881f2218ce0/transcript.json` completo (só leitura): 101
  palavras → 100. Única fusão: `"R"` (start=28.34, end=28.54) + `"$"` (start=28.54,
  end=28.54, duração zero) → `"R$"` (start=28.34, end=28.54). Reconstrução independente do
  resultado esperado (mesma lógica implementada em segundo script) bateu byte-a-byte com a
  saída real de `mergeSymbolTokens` (`expected === actual output: true`); varredura
  token-a-token confirmou zero divergências em qualquer token fora do par fundido.
  Corresponde exatamente à medição prévia do brief (136 palavras na amostra total de 2
  transcripts, 1 símbolo puro de duração zero, o mesmo `$`).
- Nenhum whisper real executado, nenhuma chamada de LLM, nenhuma escrita em `jobs/`.
  Nenhum desvio do brief. Saída literal completa em
  `.superpowers/sdd/captions-karaoke-highlight/task-13-report.md`.
- **Fix round 1/5:** `prev.word += w.word` (duas linhas abaixo de um `isSymbol` que já se
  defendia com `String(w.word || '')`) queimava a string literal `"undefined"` num token
  sem `word` — inconsistência interna do código do brief, não alcançável pelos caminhos
  reais do Whisper, mas exposta pela função ter sido exportada no Step 3. Corrigido para
  `prev.word += String(w.word || '')`, uma linha só, nada mais tocado. Verificado: `node
  --check` limpo; caso do achado (`word: undefined` e chave ausente) agora produz `["a"]`
  nos dois casos; Steps 4/5/6 do brief e a verificação sobre o transcript real
  (`jobs/a881f2218ce0`, 101→100, única fusão `R$`) repetidos sem nenhuma mudança de
  resultado. Saída literal no mesmo `task-13-report.md`.

### Task 7 — Integrar no `lib/assemble.js` — DONE (2026-09-13)

- Único arquivo tocado: `lib/assemble.js`. Step 1: linha existente de `./captions`
  ganhou `resolveStyle`; acrescentada `const { pickKeywords, applyHighlights } =
  require('./keywords');`. Step 2: corpo do bloco `if (captions) { ... }` substituído
  verbatim pelo bloco do brief — porta de custo (`S.highlight.channel === 'keyword'`)
  entre transcrever e escrever o `.ass`, com `tx.words = words` **antes** do
  `fs.writeFileSync(...transcript.json...)`, na ordem exigida pelo brief.
  `node --check lib/assemble.js` limpo.
- Verificação **substituída** pela orientação desta invocação: em vez de subir
  `node server.js` e usar `POST /api/assemble` (que escreveria em `jobs/`), chamei
  `assemble()` diretamente duas vezes, com `workDir`/`output` no scratchpad da sessão
  (nunca em `jobs/`/`output/`) e `delete process.env.LLM_BASE_URL;` como primeira linha
  de cada script, antes de qualquer `require`. Fonte (só leitura, 47s, fala, aac):
  `jobs/uploads/1784513158301-SnapInsta.to_AQOT7KgLj51cWpOjCHp0rZ560QDVryOgyADMhh7PYGuZl3eAoq9dmWDFrTUwYIPR0X1c0Gfk4FxHzLSq_aL-fj_BnNJCcr8SW_vFpiI.mp4`.
  `git status --porcelain -- jobs/ output/` vazio antes e depois — confirmado que nada
  foi escrito fora do scratchpad.
- **(a) `captionStyle: 'impact'`** — porta de custo fechada, confirmado: log capturado
  via `onLog` contém exatamente `[captions] preset impact — fonte pedida: Arial Black`
  e **nenhuma** linha `[keywords]` (`/\[keywords\]/.test(log)` → `false`).
- **(b) `captionStyle: 'realce'`**, mesmo vídeo — porta de custo aberta e destaque
  persistido, confirmado: `[stage] keywords: Escolhendo palavras-chave`,
  `[keywords] 12 destaque(s) pela heurística local` (LLM desligado → caminho offline,
  como esperado), `[captions] destaque semântico via offline`,
  `[captions] preset realce — fonte pedida: Montserrat Black`. `transcript.json` do
  `workDir`: 157 palavras / 13 segmentos, **12 com `hl: true`** —
  `60`, `inteligente`, `loucura.`, `planejamento,`, `compartilhando`, `execução,`,
  `75%.`, `automaticamente`, `assinatura`, `14`, `completo`, `comenta`. `captions.ass`
  do `workDir`: tag `&H000052FF` presente **12 vezes** (mesma contagem do
  `transcript.json`) e marca `; studio-style: realce` presente. Os três números batendo
  (`[keywords] 12` / `hl count: 12` / `&H000052FF` × 12) é a prova de que a ordem
  `tx.words = words` antes do `writeFileSync` está correta — se estivesse invertida, o
  `.ass` teria as 12 tags mas `transcript.json` sairia com `hl count: 0`.
- Conteúdo transcrito nesta execução (157 palavras/13 segmentos) diverge do exemplo
  ilustrativo do brief (~101/8) porque é conteúdo de fala diferente do vídeo usado como
  referência na escrita do brief — o próprio brief avisa que a contagem varia entre
  execuções do Whisper; 12 destaques está dentro da faixa esperada (nem 0 nem 50).
- Nenhuma chamada de LLM em nenhuma das duas execuções (confirmado pelo log dizer
  "heurística local", nunca "pelo LLM", e por `LLM_BASE_URL at call time: undefined`
  impresso no início de cada script). Nenhum `.env` lido. Nenhum arquivo em `jobs/` ou
  `output/` criado/alterado. Saída literal completa (as duas execuções, log filtrado
  por `keywords|preset|destaque` e evidência de `transcript.json`/`captions.ass`) em
  `.superpowers/sdd/captions-karaoke-highlight/task-7-report.md`.

**Fix round 1/5 (Task 7) — DONE (2026-09-13):** achado de dois revisores independentes —
o bloco de keywords rodava dentro do **mesmo** `try` que envolve `transcribe()` e
`writeAss()`, então uma falha em `pickKeywords`/`applyHighlights` cairia no `catch`
externo e descartaria a legenda **inteira** (nem `.ass` nem `transcript.json` seriam
gravados), inversão errada — falha no enfeite (destaque semântico) derrubando a
funcionalidade principal, da qual a TIMELINE e a UI de edição de palavra dependem.
Nenhum caminho de exceção real existe hoje (`pickKeywords` já captura rede/timeout/parse
internamente); achado preventivo, fechando a porta antes da Task 8. Corrigido só em
`lib/assemble.js`: o bloco `if (S.highlight && S.highlight.channel === 'keyword')` ganhou
um `try/catch` próprio (`onStage('keywords', ...)` continua fora do `try` interno,
`tx.words = words` continua dentro dele antes do `onLog` de sucesso); catch novo loga
`[captions] destaque semântico falhou (...) — legenda segue sem destaque` e deixa a
legenda seguir sem destaque. Nada mais tocado (porta de custo, `onLog` do preset,
`writeAss`, `writeFileSync`, `catch` externo). `node --check lib/assemble.js` limpo.
Verificação **sem whisper real**: `./transcribe` stubado via `require.cache` (entrada
resolvida sobrescrita antes do primeiro `require('./lib/assemble')`) com transcript
sintético de 2 segmentos/6 palavras (mesmos valores dos casos nomeados da Task 5 —
`'80%'` e `'resultado'` são os picks esperados, conhecidos de antemão); `visual` apontou
para um `synth.mp4` de 2s gerado com `ffmpeg testsrc` no scratchpad, só para o passo de
mux ter entrada válida. Item 2 (`captionStyle: 'realce'`, `./keywords` REAL): caminho
feliz não regrediu — `[keywords] 2 destaque(s) pela heurística local`, `[captions]
destaque semântico via offline`, `transcript.json` com `hl count: 2` (`80%`,
`resultado`), `.ass` com 2 ocorrências de `&H000052FF`, contagens batendo. Item 3
(`captionStyle: 'impact'`): porta de custo intacta — nenhuma linha `[keywords]`, só
`[captions] preset impact — fonte pedida: Arial Black`. Item 4, a prova do fix
(`./keywords` também stubado para `pickKeywords` sempre rejeitar com
`Error('boom - simulated failure...')`, e `applyHighlights`/`pickOffline` do stub
lançando se chamados, como sensor de que não são invocados após o `pickKeywords` já ter
lançado — não dispararam): os quatro pontos exigidos, todos confirmados — (1) log traz
`[captions] destaque semântico falhou (boom - simulated failure for fix round 1/5
verification) — legenda segue sem destaque`; (2) log **não** traz `[captions] skipped`;
(3) `captions.ass` **foi gerado**, sem nenhuma tag `&H000052FF`; (4) `transcript.json`
**foi gravado**, com `hl count: 0`. `assemble()` completou normalmente, sem rejeitar a
Promise — antes do fix, os quatro teriam falhado (sem `.ass`, sem `transcript.json`, log
só com `[captions] skipped — boom - simulated failure...`).
`git status --porcelain -- jobs/ output/` vazio antes e depois de todo o round; nenhuma
chamada de LLM, nenhum `.env` lido. Saída literal completa (as três verificações, log
inteiro do item 4) anexada ao mesmo
`.superpowers/sdd/captions-karaoke-highlight/task-7-report.md`.

### Task 8 — `remapWords()` preserva a marca `hl` — DONE (2026-09-13)

- Único arquivo tocado: `lib/timeline.js`, só a linha do `out.push` dentro de
  `remapWords` (linha 92 antes da edição). Trocada pelo bloco literal do brief: `mapped`
  construído com os três campos originais (`word`/`start`/`end`), `if (w.hl) mapped.hl =
  true;` e então `out.push(mapped)` — campo só é acrescentado quando verdadeiro, nunca
  `hl: false`. `git diff -- lib/timeline.js` confirma que nada mais no arquivo mudou.
- Step 2 do brief estava desatualizado (o `remapWords` já está exportado — confirmado em
  `module.exports` na linha 258) — segui a orientação desta invocação: sem servidor, sem
  conform de ponta a ponta, sem escrita em `jobs/`. `node --check lib/timeline.js` limpo;
  `node -e "..."` confirmou `remapWords exportado? function`.
- Os 5 casos pedidos foram verificados via script em `%TEMP%` (`require(path.resolve('lib/timeline'))`
  contra o módulo real). Para o caso 4 (comparação com o estado anterior), como o
  snapshot em `snap-before-task-8/` só contém `lib/timeline.js` isolado (sem `./ffmpeg`,
  `./encode`, `./captions`, então `require()` direto falha com `MODULE_NOT_FOUND`), extraí
  o texto-fonte da função pura `remapWords` (mais `MIN_CLIP`/`num`, dos quais ela depende)
  do snapshot e rodei via `vm.runInNewContext` — função legítima já que `remapWords` não
  toca `fs`/`child_process`. Comparação final via `JSON.stringify` (não
  `assert.deepStrictEqual`, que falha por identidade de protótipo entre realms do `vm`,
  não por conteúdo).
  - **Caso 1** (marca atravessa o corte + gap no meio): `dois` (hl) e `cinco` (hl)
    sobrevivem com `hl: true`; `um` e `quatro` (sem marca) sobrevivem **sem** o campo
    `hl` (`'hl' in um` → `false`).
  - **Caso 2** (palavra marcada cai inteira no trecho descartado): `tres` (hl, dentro do
    gap `[4,6)`) não aparece na saída (`tres === undefined`).
  - **Caso 3** (marca parcial na borda): sobra de `0.2s` (`> MIN_CLIP`) sobrevive com
    `hl: true`; sobra de `0.01s` (`<= MIN_CLIP = 0.02`) é descartada pelo `if (b - a <=
    MIN_CLIP) continue;` já existente — confirmado saída vazia (`[]`).
  - **Caso 4** (tempos inalterados p/ palavras sem `hl`): saída atual e saída extraída do
    snapshot pré-task, `JSON.stringify` idêntico — `alpha`/`beta`/`delta`/`epsilon` com os
    mesmos `start`/`end` em ambas, `gamma` (no gap) ausente em ambas.
  - **Caso 5** (dois segmentos não contíguos): `tlStart` acumula corretamente
    (`srcIn=10,dur=2` → timeline `[0,2)`; `srcIn=50,dur=3` → timeline `[2,5)`); ordem final
    por `start` é `A1, A2, B1, B2` mesmo com a entrada fora de ordem (`B2` antes de `A1`);
    `A1`/`B2` (hl) mantêm `hl: true` após a reordenação, `A2`/`B1` (sem marca) seguem sem o
    campo.
- Todas as asserções (`assert.ok`/`assert.strictEqual`) passaram; script terminou com
  `ALL CASES PASSED.`. Nenhuma chamada de LLM, nenhum `.env` lido, nenhum whisper rodado,
  nada escrito em `jobs/`/`output/` (script só leu `lib/timeline.js` e o snapshot, e
  escreveu apenas no scratchpad da sessão). Saída literal completa do script em
  `.superpowers/sdd/captions-karaoke-highlight/task-8-report.md`.

### Task 9 — Rota `GET /api/caption-styles` — DONE (2026-09-13)

- `server.js`: bloco novo inserido logo após `GET /api/luts`, cópia literal do brief —
  `if (req.method === 'GET' && p === '/api/caption-styles') { const styles =
  require('./lib/captions').styleNames().map(name => ({ name })); return send(res, 200,
  { styles }); }`. Não recebe nenhum parâmetro de cliente; nenhum path chega a `fs`.
- `node --check server.js` limpo. Servidor subido na porta 4870,
  `curl http://localhost:4870/api/caption-styles` retornou
  `{"styles":[{"name":"impact"},{"name":"clean"},{"name":"realce"}]}`, idêntico ao
  esperado. Servidor derrubado ao final (confirmado: tentativa seguinte de `curl`
  retornou código `000`, conexão recusada — nenhum processo órfão).
- Relatório completo em `.superpowers/sdd/captions-karaoke-highlight/task-9-report.md`.

### Task 10 — Select do ASSEMBLE a partir da rota — DONE (2026-09-13)

- `public/index.html`, três pontos, todos cópia literal do brief: (1) markup de
  `#asm-cap` reduzido a `<option value="0">off</option>`; (2) nova IIFE de boot, ao lado
  do bloco de `/api/luts`, que busca `/api/caption-styles`, monta as opções dos presets
  **primeiro** e só depois concatena `off`, então atribui `sel.value = 'impact'` (ordem
  seguida à risca, para que `off` não fique selecionado por padrão caso a atribuição
  falhe); (3) `doAssemble` corrigido de `captionStyle: cap === 'clean' ? 'clean' :
  'impact'` para `captionStyle: cap === '0' ? 'impact' : cap` — o `value` do option agora
  é o nome do preset, não mais o valor legado `1`/`clean`/`0`.
- Step 4 do brief: `node -e "..."` (parse do bloco `<script>`) → `JS parseia OK`;
  contagem de `cap === 'clean'` no arquivo → `0`. Com o servidor no ar, confirmado que
  `GET /api/caption-styles` responde e que as três `<option>` fixas antigas
  (`value="1">word-by-word (impact)`, `value="clean">word-by-word (clean)`) não existem
  mais no HTML.
- **Verificação extra do critério de aceite 12** (preset novo aparece sem tocar código):
  backup de `styles/captions.json` tirado e conferido contra
  `.superpowers/sdd/captions-karaoke-highlight/snap-before-task-12/styles/captions.json`
  (idênticos) antes de qualquer edição; acrescentado um quarto preset `"teste"` só no
  JSON; servidor reiniciado; `GET /api/caption-styles` passou a listar
  `impact`/`clean`/`realce`/`teste` (4 presets) sem nenhuma mudança de `.js`; servidor
  derrubado; `styles/captions.json` restaurado removendo `"teste"` e confirmado
  byte-idêntico tanto ao snapshot de referência quanto ao backup pré-edição via `diff`
  (sem saída em ambos os casos), e `git status --porcelain -- styles/captions.json`
  mostrando só `?? styles/captions.json` (não rastreado, sem mudança de conteúdo
  pendente).
- Verificação de navegador (select populado com `impact` pré-selecionado) fica para o
  Validador, por instrução explícita do Orquestrador. Nenhum processo `node server.js`
  deixado rodando ao final de nenhuma das duas tasks.
- Relatório completo em `.superpowers/sdd/captions-karaoke-highlight/task-10-report.md`.

### Task 11 — Overlay do preview e toggle manual — DONE (2026-09-13)

- **Dois defeitos do brief, corrigidos e não copiados** (identificados pela própria
  invocação, não achados por este agente): (1) `captionStyle` não existia no escopo da
  TIMELINE — a rota `GET /api/captions` devolve `style`, não `captionStyle`, e
  `loadLegend()` descartava o campo; corrigido declarando `let captionStyle = null;` no
  escopo da IIFE da TIMELINE (ao lado de `let words = []`) e capturando
  `captionStyle = j.style || null;` no load. (2) `loadLegend()` descartava `hl` em
  silêncio no `.map` do load inicial — mesmo padrão de bug que `remapWords` tinha antes
  da Task 8; corrigido para `hl: !!w.hl`.
- **Duas correções herdadas da review da Task 10**, aplicadas na mesma IIFE que monta o
  select `#asm-cap`: (A) montagem trocada de `innerHTML` por `document.createElement` +
  `.value`/`.textContent` — um nome de preset com aspas/markup não corrompe mais o select
  (`.value`/`.textContent` nunca interpretam HTML, diferente de `.innerHTML`); (B)
  `sel.value = 'impact'` incondicional trocado por fallback ao primeiro preset da lista
  quando `impact` não existe (`styles.some(...) ? 'impact' : (styles[0]?.name || '0')`).
  Preservados: presets primeiro, `off` por último, `catch` que mantém o `off` do markup
  se a rota falhar.
- `server.js` Step 1: bloco de `POST /api/captions/word` que exigia `newText` substituído
  verbatim pelo trecho do brief — `newText` e `hl` viraram edições independentes
  (`typeof b.newText === 'string'` / `typeof b.hl === 'boolean'`, com `delete w.hl` quando
  `hl: false`). Mantidos intactos: checagem `index`/`start` com 409, `writeFileSync`,
  `writeAss`, resposta `{ words: tx.words }`.
- `server.js` Step 2: rota `GET /api/caption-styles` da Task 9 **substituída inteira**
  (não duplicada) por uma que aceita `?full=1` e devolve `byName` com
  `mod.resolveStyle(n)` por preset, além de `styles` (só nomes) como antes.
- `public/index.html` Step 2: `CAPTION_STYLES` carregado uma vez dentro da IIFE da
  TIMELINE (mesmo escopo de `words`/`captionStyle`/`updatePreviewOverlay`, não no escopo
  top-level do script — é onde a variável é consumida). `updatePreviewOverlay()`
  reescrito verbatim conforme o brief (janela de palavras por `S.layout.maxWords`, `hot`
  decidido pelo canal `keyword` vs. comportamento padrão, `fontStyle`/`textTransform`/
  `color`/`--cap-hot`/posição `top` aplicados quando o preset carrega o token), preservando
  o `if (idx < 0) { el.innerHTML = ''; return; }` que já existia (necessário, o brief não
  o repetiu mas não o removeu). CSS `.bt-cap-overlay b` trocado para
  `color:var(--cap-hot, var(--go))`.
- `public/index.html` Step 3: `toggleWordHighlight(index, start, next)` acrescentada
  verbatim ao brief; integrada ao popover de correção de palavra que já existia
  (`openWordPopover`) via um botão novo (`MARCAR DESTAQUE`/`REMOVER DESTAQUE`, rotulado
  pelo `w.hl` corrente), com tratamento de erro inline no mesmo padrão visual do botão
  SALVAR. `renderLegendTrack()` ganhou a classe `hot` por palavra (`!!words[s.i].hl`),
  cor vinda de `CAPTION_STYLES[captionStyle].highlight.color` (fallback `#FF5200`) setada
  via `--cap-hot` inline no próprio chip. CSS nova: `.bt-word.hot{border-color:var(--cap-hot,
  #FF5200); color:var(--cap-hot, #FF5200); background:rgba(255,82,0,.15)}`.
- **Desvio adicional, não pedido pelo brief, mesma classe do Defeito 2:** `save()` (a
  correção de texto que já existia dentro de `openWordPopover`, tocada por este Step 3)
  também descartava `hl` no `.map` da resposta (`words = j.words.map(x => ({ start,
  end, text }))`). Sem o fix, salvar uma correção de texto apagaria silenciosamente todos
  os `hl` do estado local até a próxima recarga, mesmo com `transcript.json` no servidor
  intacto. Corrigido no mesmo padrão (`hl: !!x.hl`), mesma função que o Step 3 já exigia
  tocar — não é escopo novo, é o mesmo bug pego duas vezes na mesma vizinhança de código.
- Verificação: `node --check server.js` limpo; parse do bloco `<script>` de
  `index.html` via `new Function` OK; `GET /api/caption-styles` (sem e com `?full=1`)
  batendo o esperado — `full=1` devolvendo `byName` com os tokens de `impact`/`clean`/
  `realce`; prova por inspeção+execução do código real (não reimplementado) de que
  `captionStyle` existe e recebe valor, de que o `.map` do load preserva `hl`
  (`hl: !!w.hl`, booleano explícito), e de que a Correção A não permite que um nome de
  preset malicioso (`"><img src=x onerror=alert(1)>`) produza qualquer tag além de
  `option` nem escape de `.value`/`.textContent` (harness `vm.createContext` executando o
  trecho real extraído do arquivo, não uma reimplementação — alcance dessa prova
  documentado como não sendo teste de navegador real, ver
  `task-11-report.md`); `POST /api/captions/word` exercitada com só `hl`, só `newText`,
  os dois juntos, e os dois casos de regressão (400/409) contra uma **cópia em
  scratchpad** de um job real (não `jobs/` real — `JOBS_DIR` é fixo em `<repo>/jobs`,
  então a rota via HTTP sempre miraria dados reais; usado um script que roda o corpo
  literal da rota editada contra a cópia). Servidor subido/derrubado sem deixar processo
  órfão na 4870; `git status --porcelain -- jobs/ output/` vazio antes e depois.
- Verificação de navegador (destaque em laranja/itálico no overlay real, toggle refletindo
  nos três lugares simultaneamente) fica para o Validador — sem navegador disponível nesta
  sessão, como nas tasks anteriores. Relatório completo, com toda a saída literal, em
  `.superpowers/sdd/captions-karaoke-highlight/task-11-report.md`.

**Fix round 1/5 (Task 11) — DONE (2026-09-13):** dois achados da review, ambos dentro do
próprio diff da Task 11 (não do brief). **Achado 1 (Important):** o toggle de destaque e
o chip `hot` funcionavam para qualquer preset, mas `buildAss` só lê `hl` no canal
`keyword` — em `spoken` (`impact`/`clean`, o default, e o preset de todos os 6 jobs
existentes) o `.ass`/export final nunca mudava, apesar do chip/botão prometerem o
contrário; `updatePreviewOverlay` já fazia esse gate corretamente no mesmo diff, só
faltava nos outros dois lugares. Corrigido nos dois pontos indicados pelo Orquestrador:
(a) `renderLegendTrack` ganhou `isKeyword = !!(S && S.highlight && S.highlight.channel
=== 'keyword')`, e `hot` virou `isKeyword && !!words[s.i].hl` (chip só pinta em preset
`keyword`); (b) `openWordPopover` só inclui a linha do botão (`hlRow`) no `innerHTML`
quando `isKeyword`, e o registro do handler (`hlBtn0.onclick = ...`) passou a checar
`if (hlBtn0)` antes de atribuir — sem isso, presets `spoken` (o caso comum) lançariam ao
tentar ler `.onclick` de `null`. Resolve também o Minor da cor do chip, que cai no mesmo
gate. **Achado 2 (Minor):** um corpo sem `newText` nem `hl` retornava 200 e regravava o
`.ass` como efeito colateral de um no-op (acrescentando `; studio-style:` a um `.ass`
legado); voltou a rejeitar com 400 (`'nada para atualizar — informe newText e/ou hl'`),
checado depois de tratar os dois campos e antes do `writeFileSync`, como antes da Task 11.
Verificado: `node --check server.js` limpo; parse do `<script>` de `index.html` OK; gate
do chip provado executando a função `renderLegendTrack` **real** (extraída do arquivo, não
reimplementada) via `vm.createContext` contra `captionStyle='impact'` (canal `spoken`,
`hl:true` → sem classe `hot`) e `'realce'` (canal `keyword`, `hl:true` → com `hot` e
`--cap-hot:#FF5200`); gate do botão provado do mesmo jeito (trecho real de
`openWordPopover` via `vm`) — `spoken`: markup sem `id="bt-word-pop-hl"`, nenhuma exceção
ao pular o registro do handler; `keyword`: markup com o botão, `.onclick` registrado como
função; alcance de ambas as provas documentado como execução de código real contra estado
simulado do módulo, não teste de navegador/DOM real; o 400 provado contra cópia nova em
scratchpad de `jobs/81d51848114d` com a lógica literal pós-fix — só `newText`/só `hl`/os
dois → 200, nenhum dos dois → 400 com `transcript.json`/`captions.ass` byte-a-byte e
`mtime` idênticos antes/depois (confirma que o `return 400` está antes de qualquer
escrita); regressão re-rodada com a lógica atual contra cópia nova do mesmo job — os 5
casos que já passavam continuam passando, e o caso "sem nenhum campo" mudou de 200→400 de
propósito (rotulado como mudança esperada desta rodada, não regressão). `GET
/api/caption-styles` (sem parâmetro e com `?full=1`) re-testado, saída idêntica ao round
anterior. Servidor subido/derrubado sem processo órfão na 4870; `git status --porcelain --
jobs/ output/` vazio antes e depois de todo o round. Saída literal completa (todos os 5
itens) anexada ao mesmo `.superpowers/sdd/captions-karaoke-highlight/task-11-report.md`,
seção "Fix round 1/5".
