# Design — Edição manual de palavras na legenda (BEATS)

**Data:** 2026-08-12
**Arquivos-alvo:** `server.js` (2 rotas novas), `lib/captions.js` (reaproveitado, sem mudança de assinatura), `public/index.html` (track LEGENDA + popover + carregamento de legenda no BEATS).
**Pré-requisito:** `docs/plans/beats-track-height-fix.md` já executado e commitado (`8cdc623`) — a track LEGENDA já existe, renderiza word-chips (`.bt-word`) a partir de um array `words` parseado do `.ass`, e o preview já tem um overlay de legenda ao vivo (`.bt-cap-overlay`).

## Contexto e problema

O Whisper às vezes transcreve uma palavra errada (ex.: "casa" em vez de "caça"). Hoje não há como corrigir isso sem regravar a narração inteira — a legenda queimada no vídeo final carrega o erro adiante. O usuário quer poder corrigir manualmente uma palavra errada diretamente no BEATS.

Dois obstáculos técnicos, descobertos durante o brainstorm:

1. **Onde persistir a correção.** O `.ass` (`jobs/<id>/captions.ass`) não é uma fonte editável razoável — o formato ASS de karaokê word-by-word usado por `lib/captions.js` repete cada palavra em múltiplas linhas `Dialogue` (a linha inteira de contexto de 4 palavras se repete a cada palavra destacada), então editar o texto ali exigiria achar e trocar a mesma palavra em várias linhas, de forma frágil. A fonte de verdade real é `jobs/<id>/transcript.json` (escrito por `assemble()`, formato `{ text, words: [{word,start,end}], segments }`) — é a partir dele que `writeAss()` gera o `.ass`. Corrigir a palavra ali e **regerar o `.ass` do zero** é a operação limpa.
2. **Achar o `transcript.json` certo para o vídeo selecionado.** Hoje o BEATS só sabe onde está a legenda via `lastAss`, uma variável JS em memória, setada só quando o ASSEMBLE acaba de rodar *na mesma aba*. Recarregar a página ou reabrir um vídeo já montado antes quebra isso — é o mesmo bug (relatado separadamente) de "a legenda não aparece no preview do BEATS, só no EXPORT". Como editar uma palavra exige achar esse arquivo de forma confiável (não só na sessão em que foi montado), este design resolve os dois problemas com a mesma mudança.

## Objetivo

- Permitir editar o texto de uma palavra errada na track LEGENDA do BEATS.
- A correção precisa chegar ao vídeo final exportado — regerando `captions.ass`, não só a pré-visualização do BEATS.
- Corrigir, como parte do mesmo trabalho, a busca de legenda no BEATS para não depender mais de `lastAss` (variável de sessão) — passa a resolver a partir do arquivo de vídeo selecionado, do mesmo jeito que `GET /api/beats?video=` já resolve o sidecar de beats hoje.

**Fora de escopo (deliberado):**
- Editar o *timing* (início/fim) da palavra — só o texto. Editar timing mexeria no agrupamento de linhas de 4 palavras e na palavra vizinha; não é o problema relatado ("transcrição errada").
- Vídeos que não passaram pelo ASSEMBLE (upload bruto, clipe do auto-clipper) — esses nunca tiveram `transcript.json`/`captions.ass`, então continuam sem a track LEGENDA populada, como já é hoje.
- Editar a legenda de dentro do overlay de preview ao vivo (`.bt-cap-overlay`) — só a track LEGENDA por enquanto.

## Abordagem escolhida

**Regerar o `.ass` a partir do `transcript.json` corrigido, resolvendo os arquivos por convenção de nome já existente no código** (`output/assembled-<id>.mp4` ↔ `jobs/<id>/`, usada em `server.js` desde o `/api/assemble`).

Duas rotas novas em `server.js`, mesmo estilo das rotas de `/api/beats` já existentes:

- **`GET /api/captions?video=<path>`** — resolve `<id>` a partir do nome do arquivo de vídeo (`assembled-<id>.mp4`), lê `jobs/<id>/transcript.json`, detecta o preset de estilo lendo a linha `Style:` do `captions.ass` já existente (`Fontname` `Arial Black` → `impact`, `Arial` → `clean` — únicos dois presets em `lib/captions.js`), devolve `{ words: [{word,start,end}], style }`. Se o vídeo não segue o padrão `assembled-<id>.mp4` ou não tem `transcript.json`, devolve `{ words: [], style: null }` (sem erro — é um vídeo sem legenda, estado válido).
- **`POST /api/captions/word`** — corpo `{ video, index, start, newText }`. Resolve o mesmo `<id>`, relê `transcript.json`, valida que `words[index].start` bate com o `start` enviado pelo cliente (guarda barata contra dessincronia — ver "Tratamento de erro"), atualiza `words[index].word = newText`, grava `transcript.json` de volta, chama `writeAss(words, jobDir, { style })` (reaproveitado de `lib/captions.js`, sem mudar assinatura) para regerar `captions.ass` inteiro. Responde com a lista `words` atualizada.

Cliente: `loadVideo()` no BEATS passa a chamar `GET /api/captions?video=` em vez de depender de `lastAss` — essa troca sozinha já conserta o bug relatado de "legenda não aparece no preview do BEATS". A resposta alimenta tanto a track LEGENDA quanto o overlay de preview ao vivo, como já faziam a partir do `words` parseado do `.ass` antes.

**Alternativas descartadas:**
- **Editar o texto direto no `.ass` existente (find/replace nas linhas `Dialogue`).** Frágil — a mesma palavra aparece como contexto em até 3 outras linhas vizinhas (agrupamento de 4 palavras por linha), e o texto já vem com tags de cor ASS embutidas (`{\c...}`). Regerar do zero a partir do `transcript.json` elimina essa classe de bug inteira.
- **Guardar as correções num arquivo de "diff" separado (`<video>.captions-edits.json`) e aplicar por cima só na hora do burn-in no EXPORT.** Evita reescrever `.ass` a cada edição, mas cria duas fontes de verdade a reconciliar (preview do BEATS precisa aplicar o diff também, não só o EXPORT), e não bate com a decisão já tomada de salvar na hora e ver refletido imediatamente no preview. Descartada.
- **Manter a resolução do arquivo só via `lastAss`, sem mexer na busca por nome de arquivo.** Resolveria a edição de palavra só para o caso "acabei de montar nesta aba", replicando a mesma fragilidade já relatada como bug — descartada porque o usuário pediu para corrigir isso junto.

## Desenho detalhado

### 1. Resolução do job dir a partir do path do vídeo (`server.js`)

Função helper pequena, reutilizável pelas duas rotas novas:

```js
function jobDirForVideo(videoRelPath) {
  const m = path.basename(videoRelPath).match(/^assembled-([a-f0-9]+)\.mp4$/);
  if (!m) return null;
  const dir = path.join(JOBS_DIR, m[1]);
  return fs.existsSync(path.join(dir, 'transcript.json')) ? dir : null;
}
```

Retorna `null` para vídeos fora do padrão ou sem transcript — as duas rotas tratam `null` como "sem legenda" (200 com `words: []` no GET; 404 com mensagem clara no POST), nunca 500.

### 2. `GET /api/captions?video=`

```js
if (req.method === 'GET' && p === '/api/captions') {
  const video = url.searchParams.get('video') || '';
  const dir = jobDirForVideo(video);
  if (!dir) return send(res, 200, { words: [], style: null });
  const words = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8')).words;
  const assText = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
  const style = /Arial Black/.test(assText) ? 'impact' : /Style:\s*Word,Arial,/.test(assText) ? 'clean' : 'impact';
  return send(res, 200, { words, style });
}
```

`resolveInput`/`insideRoot` não entram aqui porque não há path arbitrário vindo do cliente — `video` só é usado para extrair o `<id>` via regex, o path real lido (`JOBS_DIR/<id>/...`) é sempre construído a partir de `JOBS_DIR` no servidor, nunca do valor cru do cliente. Mesmo padrão de segurança que `resolveInput()` já aplica em outras rotas (nunca deixar o cliente ditar o path final).

### 3. `POST /api/captions/word`

```js
if (req.method === 'POST' && p === '/api/captions/word') {
  const b = await readJson(req);
  const dir = jobDirForVideo(b.video || '');
  if (!dir) return send(res, 404, { error: 'sem legenda para este vídeo' });
  const txPath = path.join(dir, 'transcript.json');
  const tx = JSON.parse(fs.readFileSync(txPath, 'utf8'));
  const w = tx.words[b.index];
  if (!w || Math.abs(w.start - b.start) > 0.01) {
    return send(res, 409, { error: 'legenda mudou desde que a página carregou — recarregue' });
  }
  const newWord = String(b.newText || '').trim();
  if (!newWord) return send(res, 400, { error: 'palavra não pode ficar vazia' });
  w.word = newWord;
  fs.writeFileSync(txPath, JSON.stringify(tx, null, 2));
  const assText = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
  const style = /Arial Black/.test(assText) ? 'impact' : 'clean';
  writeAss(tx.words, dir, { style });
  return send(res, 200, { words: tx.words });
}
```

`writeAss` já é importado — reaproveita `lib/captions.js` sem mudar a assinatura da função.

### 4. Cliente (`public/index.html`)

- `loadVideo()`: troca a leitura de `lastAss`/`loadLegend()` (parse do `.ass` via regex) por `fetch('/api/captions?video=' + encodeURIComponent(path))`, guardando `words` e o `style` retornado (o `style` só precisa ficar guardado em memória para reenviar no futuro, se algum dia o cliente regerar o `.ass` inteiro por outro motivo — hoje não é enviado de volta, o servidor já detecta sozinho).
- Track LEGENDA: cada `.bt-word` ganha `ondblclick` abrindo um popover (mesmo componente visual do `openPopover()`/`openAddClipPopover()` já usados para renomear beat e adicionar clipe — reaproveita `.bt-pop`, a transição `.enter`, os botões `row2`), pré-preenchido com a palavra atual, input de texto único.
- Confirmar (Enter ou botão Salvar do popover): `POST /api/captions/word` com `{ video: currentPath, index, start: words[index].start, newText }`. Sucesso → substitui `words` pela resposta, re-renderiza a track LEGENDA (`renderTracks()`) e o overlay de preview (`updatePreviewOverlay()`), fecha o popover. Erro → mantém o popover aberto com o texto digitado, mostra a mensagem de erro do servidor numa linha abaixo do input (sem alert/confirm nativos, que travam a extensão do Chrome usada nos testes deste projeto).

### 5. Tratamento de erro

- **Vídeo sem legenda** (`words: []` do GET): track LEGENDA permanece vazia, sem word-chips — nenhum popover para abrir, comportamento idêntico ao atual para vídeos não montados via ASSEMBLE.
- **Dessincronia entre cliente e servidor** (alguém editou o mesmo vídeo em outra aba, ou o `transcript.json` mudou de outro jeito entre o load e o save): o guard `Math.abs(w.start - b.start) > 0.01` no servidor rejeita com 409; cliente mostra a mensagem e não aplica a mudança local, evitando um `words[]` no cliente dessincronizado do disco.
- **Falha de rede/servidor fora do ar:** popover mostra "não foi possível salvar, tente de novo" e mantém o texto digitado — nunca perde a correção que o usuário já tinha escrito.
- **Texto vazio:** servidor rejeita com 400 ("palavra não pode ficar vazia") em vez de gravar uma palavra em branco — apagar uma palavra inteira (mudando a contagem de palavras da linha) é edição de estrutura, não de texto, e está fora de escopo (ver "Fora de escopo").

## Critérios de aceite

1. Com um vídeo montado via ASSEMBLE nesta ou em sessão anterior (só precisa estar selecionado no dropdown VÍDEO do BEATS, não precisa ter acabado de montar), a track LEGENDA mostra as palavras reais — sem depender de ter rodado ASSEMBLE na mesma aba.
2. Duplo-clique numa palavra abre um popover com o texto atual; editar e salvar atualiza a palavra na track LEGENDA e no overlay de preview imediatamente.
3. Depois de salvar, `jobs/<id>/captions.ass` no disco reflete a correção (conferível reabrindo o arquivo ou rodando EXPORT e checando a legenda queimada no vídeo final).
4. `jobs/<id>/transcript.json` também reflete a correção (é a fonte de verdade — uma segunda edição, ou uma futura regeração, parte do texto já corrigido).
5. Vídeo sem `transcript.json` (upload bruto, clipe): track LEGENDA vazia, sem erro no console, sem popover disponível.
6. Editar uma palavra não altera nenhuma outra (timing de todas as palavras, incluindo a editada, permanece idêntico — só o texto muda).
