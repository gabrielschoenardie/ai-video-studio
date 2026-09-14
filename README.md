# 🎬 AI Video Studio

**Uma janela, tudo local.** Corta, monta, edita na timeline, dubla, legenda e exporta pra Instagram Reels — $0 por uso, nada sobe pra nuvem.

Backend em Node puro (`http`, zero dependências npm), servindo uma SPA única. Todo o trabalho pesado é delegado a engines externos (ffmpeg, Whisper, yt-dlp, Voicebox) via `child_process` — cada um opcional, cada um degradando sozinho. O encode de entrega segue a **Metodologia Gabriel** (VBV obrigatório, perfil por duração medida, validação de conformidade pós-encode).

---

## Rodando

```bash
node server.js
# abre http://localhost:4870
```

O servidor escuta em `127.0.0.1` — não fica exposto na rede. Node ≥ 18, sem build step, sem bundler, sem `npm install` no backend.

Variáveis de ambiente opcionais vão num `.env` na raiz (lido por `lib/loadEnv.js`, nunca commitado). Copie de `.env.example`.

```bash
cp .env.example .env     # PORT, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
```

---

## Engines (instale o que for usar)

| Engine | Etapa | Instalação | Licença |
| --- | --- | --- | --- |
| **ffmpeg / ffprobe** | tudo | <https://ffmpeg.org/download.html> | LGPL/GPL |
| **Whisper** | legendas palavra-a-palavra, clipper | `pip install openai-whisper` (ou compile whisper.cpp) | MIT |
| **Voicebox** | voiceover (engine primário) | baixe em <https://voicebox.sh> e deixe o app aberto — API local em `127.0.0.1:17493` | MIT |
| `piper` / `espeak-ng` / `say` | voiceover (fallback, scratch track) | opcional — o primeiro disponível vence | MIT / GPL / macOS |
| **yt-dlp** | DOWNLOAD e clipper (URLs) | `pip install yt-dlp` | Unlicense |
| **python3 + OpenCV** | reframe 9:16 do clipper (tracking de rosto/movimento) | `pip install opencv-python` | BSD |
| **Remotion** | VISUALS (motion graphics). O player da TIMELINE **não** precisa disto — o bundle vem commitado | `cd remotion && npm install` | ver `remotion/` |
| **libvmaf** (parte do ffmpeg) | métrica de qualidade do EXPORT | build do ffmpeg com `--enable-libvmaf` | BSD-2-Clause — sem esse flag só perde a métrica, o encode continua |
| **zscale** (parte do ffmpeg) | LUT 3D em precisão float + dither RPDF nativo no EXPORT | build do ffmpeg com `--enable-libzimg` | BSD-2-Clause — sem esse flag cai pra rota `swscale` (LUT 8-bit, dither aproximado), o encode continua |
| **Montserrat Black Italic** (fonte do sistema) | legendas — é a família que os presets pedem | <https://fonts.google.com/specimen/Montserrat> — instale o `.ttf` no sistema | SIL OFL |

> **A fonte é a única dependência que não degrada graciosamente.** Diferente dos engines, libass não avisa quando a família pedida não existe — ele substitui por outra e queima a legenda assim mesmo, sem erro e sem log. Se a legenda sair com a aparência errada, confira primeiro se **Montserrat Black Italic** está instalada no sistema.

Atalho pras dependências Python (Whisper, yt-dlp, OpenCV) de uma vez só:

```bash
pip install -r requirements.txt
```

ffmpeg/ffprobe, Voicebox e o Remotion ficam de fora do `requirements.txt` (não são pacotes PyPI) — instale conforme a tabela.

Cheque tudo de uma vez: `node clipper/check-deps.js` (ou veja o painel **ENGINES** na barra lateral do app, que já sonda ao abrir — mesma fonte, `GET /api/deps`).

---

## Pipeline (5 steps)

```text
VISUALS → VOICE → ASSEMBLE → TIMELINE → EXPORT
```

1. **VISUALS** — sobe seu footage (drag-and-drop) ou renderiza uma composição Remotion (`AutoKillReel`, `NeuralIntro`) em ProRes HQ.
2. **VOICE** — cola o roteiro, a narração é gerada no seu hardware. Voicebox primeiro (com picker de vozes pt-BR); piper / espeak-ng / `say` como fallback.
3. **ASSEMBLE** — funde visual + voz e transcreve as legendas palavra-por-palavra (Whisper word timestamps) num **mezanino visualmente lossless (CRF 12, 4:4:4)**. A legenda **não** é queimada aqui: o mezanino carrega só vídeo + voz, e o `.ass` viaja ao lado, pronto pro EXPORT queimar *depois* da LUT.
4. **TIMELINE** — editor multi-track estilo Premiere (detalhes abaixo). Opcional: pule direto pro EXPORT se não precisa cortar.
5. **EXPORT** — encode de entrega Instagram (Metodologia Gabriel). Perfil VBV escolhido pela duração *medida*, stack x264 premium, BT.709, GOP ≤ 60, `+faststart`. Score de risco de recompressão antes, validação de conformidade completa depois (APROVADO/REPROVADO), e VMAF do encode contra o mezanino que o alimentou.

Fora da esteira, três ferramentas no mesmo rail: **AUTO-CLIPPER**, **DOWNLOAD** e **LIBRARY**.

---

## TIMELINE — o editor (step 04)

Seis tracks, todas desenhadas sobre a mesma régua com zoom e snapping:

| Track | O que faz |
| --- | --- |
| **MARKERS** | beats narrativos (HOOK, CONTEXTO, CTA…) — rótulo, não corte |
| **B-ROLL** | clipes sobrepostos ao plate na janela deles (áudio do B-ROLL é descartado de propósito — o export bate com o que você ouviu na prévia) |
| **VÍDEO** | o corte de verdade: cada segmento é `{srcIn, dur}`, arrastável e trimável. **Deletar faz ripple** — a timeline encurta |
| **LEGENDA** | as palavras do Whisper, editáveis uma a uma (corrige o `transcript.json` e reescreve o `.ass`). No preset `realce`, o popover da palavra ganha um botão **MARCAR/REMOVER DESTAQUE** — some nos presets `spoken`, onde `hl` é ignorado e o botão mentiria sobre o `.ass` entregue |
| **ÁUDIO** | a faixa base (voz/som direto do plate) |
| **TRILHA** | música, com trim, ganho e delay, mixada sob a base (`amix` com `normalize=0`, pra não abaixar a voz em 1/N) |

**Atalhos:** `J/K/L` shuttle · `espaço` play/pause · `,`/`.` frame a frame · `Home`/`End` · `I`/`O` mark in/out · `S` split · `M` merge · `R` rename · `Del` deleta (ripple) · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `+`/`−` zoom · `\` fit.

**Persistência:** tudo vai num sidecar `<video>.beats.json` (v3) ao lado do vídeo — `SALVAR BEATS`. Nada é destrutivo até você conformar.

**O preview** roda no `@remotion/player`: o corte da pista VÍDEO vira um `<Series>` declarativo, então o ripple e o mapa timeline→fonte saem do próprio Remotion, e B-ROLL e TRILHA entram como `<Sequence>` sincronizadas. O bundle (`public/vendor/studio-player.js`) vem commitado — nada a instalar. Se ele faltar, o passo 04 cai sozinho no compositor de canvas anterior, que segue no código: é o mesmo padrão de degradação graciosa dos engines. Para **alterar** o player: `cd remotion && npm install && npm run build:player`.

**`CONFORMAR → EXPORT`** achata a timeline num arquivo real: `lib/timeline.js` lê o sidecar, aplica os cortes do VÍDEO, sobrepõe o B-ROLL, mixa a TRILHA, **reprojeta as palavras da legenda pelo mapa de cortes** (senão a legenda dessincroniza exatamente pelo corte) e escreve um mezanino 4:4:4 CRF 12. Esse mezanino é o único caminho pelo qual a timeline chega ao arquivo exportado — o compositor do navegador é prévia, não render. O EXPORT o recebe como `sourceKind: 'mezzanine'` e o usa também como referência do VMAF.

### Presets de legenda

Os presets vivem em `styles/captions.json` — dado, não código: fonte, cor, posição, `maxWords` e caixa alta saem do arquivo, e acrescentar um preset é acrescentar uma chave (o servidor relê no restart).

| Preset | Layout | Destaque |
| --- | --- | --- |
| `impact` | 4 palavras, CAIXA ALTA, rodapé | **posicional** — pinta de amarelo a palavra sendo falada naquele instante (karaokê); toda palavra é pintada na sua vez |
| `clean` | idem | idem, dourado |
| `realce` | 1 palavra por vez, minúscula, centralizada | **semântico** — só UMA palavra por segmento é pintada de laranja, escolhida por conteúdo; as outras passam em branco |

A diferença entre os dois canais é *o que decide a cor*: em `spoken` é a posição no tempo (quem está sendo falado agora), em `keyword` é a marca semântica da palavra — a posição não conta, e a maioria das palavras nunca é pintada.

No `realce` a escolha sai da heurística offline (`lib/keywords.js`: stopwords, prioridade pra número com substância, palavra longa como fallback). Um LLM pode assumir a escolha quando `LLM_BASE_URL`/`LLM_API_KEY` estão configurados — **só nesse preset**, e se ele falhar a legenda sai pela heurística, nunca sem legenda. `impact` e `clean` não acionam LLM em hipótese nenhuma, então quem os usa não paga nada.

**Nome de preset é um token só, sem espaço.** O nome viaja num comentário do `.ass` (`; studio-style: <nome>`) que é como o servidor descobre, na releitura, qual preset gerou aquele arquivo. A regex que o lê é `(\S+)`, então um nome com espaço não sobrevive ao round-trip e cai em silêncio no `impact`. Chave começando com `_` é metadado do arquivo, nunca preset.

---

## EXPORT — Metodologia Gabriel

**Perfis VBV (selecionados pela duração medida, nunca chutada):**

| Perfil | Target | Maxrate | Bufsize | vbv-init | Alvo VMAF |
| --- | --- | --- | --- | --- | --- |
| Maximum Quality ≤ 30s | 10000k | 11200k | 15000k | 0.90 | ≥ 93 |
| Transition 30–40s | 9000k | 9000k | 12500k | 0.90 | ≥ 90 |
| Safe Premium ≥ 40s | 8000k | 9000k | 12500k | 0.90 | ≥ 90 |

**Controles da UI:** LUT 3D `.cube` (da pasta `luts/`), FIT pra fontes que não são 9:16 (`fundo desfocado` / `preencher e cortar` / `encaixar com barras`), GRADE (`plate` aplica a LUT / `none` pula), DITHER (`RPDF` / `error diffusion` / `none`) e campos opcionais de `psy-rd` e `deblock` (vírgula, nunca dois-pontos).

**Ordem canônica do filtergraph** (não reordenar): denoise opcional → fit em 1080×1920 → `fps=30` → grade (LUT 3D, `interp=tetrahedral`) → dither → `subtitles=` → `format=yuv420p`. A legenda vem **depois** da grade por duas razões: a LUT não deve gradar gráfico/texto, só o plate; e libass é 8-bit-only, então só roda depois do dither. Isso é restrição de filtro, não estilo.

**Validação:** depois do encode, o arquivo é re-sondado com `ffprobe` — codec, profile, level, `pix_fmt`, resolução, tags de cor, teto de bitrate, áudio e espaçamento de GOP. É essa checagem, não o `buildArgs()`, que diz se o encode bateu a spec.

**VMAF:** modelo padrão `vmaf_v0.6.1` (**não** a variante NEG, decisão deliberada do projeto). O veredito usa a **média harmônica**, não a aritmética — ela pune um trecho ruim que uma boa média esconderia. O ramo de referência recebe o mesmo `refFilter` (grade + legenda) do encode, senão a LUT e as legendas queimadas entrariam na conta como distorção pura.

Coloque suas LUTs `.cube` em `luts/` — elas aparecem sozinhas no seletor do EXPORT.

---

## AUTO-CLIPPER

Na UI (step ✂) ou por CLI:

```bash
node clipper/check-deps.js         # uma vez
node clipper/clip.js               # interativo — cola uma URL ou caminho de arquivo
node clipper/clip.js --mode ai --reframe   # picking de momentos via LLM + reframe 9:16
```

Baixa (yt-dlp) → transcreve (Whisper) → escolhe os momentos → reenquadra pra 9:16 com crop móvel que segue o sujeito (tracker OpenCV, suavizado por EMA pra não tremer) → corta e queima as legendas.

Sem API key? O **hook-detector offline** entra automaticamente (regex de perguntas, contraste, números, payoff markers + densidade de energia). Pra ligar o picking via IA, no `.env`:

```bash
LLM_BASE_URL="https://api.anthropic.com/v1"
LLM_API_KEY="sk-ant-..."
LLM_MODEL="claude-sonnet-5"      # ou claude-opus-5 (mais capaz) / claude-haiku-4-5 (metade do preço)
```

Detalhes dessa camada de compatibilidade OpenAI da Anthropic (não é a API nativa): é voltada pra teste/avaliação, não é a via recomendada pra produção; `temperature` fica travado entre 0–1; sem prompt caching. Preço por milhão de tokens (entrada/saída): `claude-haiku-4-5` $1/$5 — dá conta de "escolher os melhores momentos"; `claude-sonnet-5` $2/$10; `claude-opus-5` $5/$25, o mais capaz. Qualquer endpoint compatível com Chat Completions serve (DeepSeek, Ollama, etc.).

---

## DOWNLOAD e LIBRARY

**DOWNLOAD** (step ⬇) puxa uma URL na melhor resolução disponível via yt-dlp — sem o teto de 1080p do clipper, e sem cortar nada. O arquivo cai na Library, pronto pra qualquer step.

**LIBRARY** (step ▤) lista tudo que foi produzido ou subido na sessão; qualquer asset pode ser mandado direto pro ASSEMBLE ou pro EXPORT.

---

## Como o backend funciona

**Sem framework, sem router.** `server.js` é um único handler com `if`s contra `req.method` + `url.pathname`.

**Job bus assíncrono.** Trabalho longo (transcrever, encodar, clipar, conformar, dublar, renderizar) roda via `runJob(kind, fn)`, que devolve um `job.id` na hora. O cliente acompanha por `GET /api/jobs/:id` ou pelo stream SSE `GET /api/jobs/:id/events` (eventos `stage`, `log`, `progress`, `done`/`error`).

**Fronteira de path.** `resolveInput()` só aceita caminhos que já existem ou caem dentro de `jobs/` e `output/`, mais URLs `http(s)://` (que vão pro yt-dlp). Uploads passam por `safeName()`. Os clipes listados num `.beats.json` são reresolvidos no servidor — o sidecar é escrito pelo navegador, logo é tão não-confiável quanto um body de request.

**Rotas principais:**

| Rota | O que faz |
| --- | --- |
| `GET /api/deps` | status de todos os engines |
| `POST /api/upload` · `POST /api/probe` | upload cru + `ffprobe` |
| `GET /api/voices` · `GET /api/luts` | presets pt-BR do Voicebox · `.cube` em `luts/` |
| `GET/POST /api/beats` | sidecar `.beats.json` da timeline |
| `GET /api/captions` · `POST /api/captions/word` | lê/corrige palavras e reescreve o `.ass` |
| `GET /api/caption-styles` | lista os presets de `styles/captions.json` (`?full=1` devolve a definição inteira) |
| `POST /api/timeline/conform` | achata a timeline num mezanino |
| `POST /api/voiceover` · `/api/assemble` · `/api/clip` · `/api/download` · `/api/export` | os steps |
| `POST /api/remotion/render` | renderiza uma composição |
| `POST /api/score` | curva de atenção (ver nota abaixo) |
| `GET /api/jobs/:id[/events]` | estado do job / stream SSE |

> **Nota sobre o SCORE.** A curva de atenção saiu da navegação (a pipeline foi reduzida de 6 pra 5 steps), mas `POST /api/score` e `lib/score.js` continuam intactos no backend — dá pra chamar por `curl` ou reexpor na UI a qualquer momento. Nada na pipeline consumia o resultado, então a remoção foi isolada por construção.

---

## Licenciamento — leia antes de uso comercial

O código do app (`server.js`, `lib/`, `public/`, `clipper/`) é seu, sem restrição adicional.

Os **engines** usados são de licença permissiva (MIT, Unlicense, BSD, LGPL/GPL do ffmpeg) — uso comercial livre. O Remotion tem licença própria: confira os termos comerciais antes de vender vídeos renderizados em escala.

A curva de atenção (`lib/score.js`) é heurística local escrita para este projeto — energia de áudio, densidade de cortes e densidade de fala. Sem modelo de terceiros, sem licença a confirmar. Veja `LICENSES.md` para os detalhes.

---

## Estrutura

```text
ai-video-studio/
├── server.js               # backend HTTP, zero deps, job bus SSE
├── public/index.html       # UI de janela única (SPA, sem build)
├── lib/
│   ├── deps.js             # sonda de engines  → GET /api/deps
│   ├── ffmpeg.js           # helpers de spawn + ffprobe
│   ├── download.js         # yt-dlp na melhor resolução
│   ├── clipper.js          # auto-clipper: download → transcrever → picking → reframe → cortar
│   ├── transcribe.js       # Whisper com word timestamps
│   ├── captions.js         # .ass palavra-a-palavra (presets em styles/captions.json)
│   ├── keywords.js         # escolha da palavra-chave: heurística offline + prompt do LLM
│   ├── llm.js              # cliente HTTP do LLM (compartilhado com o clipper)
│   ├── voiceover.js        # TTS com cadeia de fallback
│   ├── assemble.js         # mezanino 4:4:4 CRF 12 + .ass ao lado
│   ├── timeline.js         # conform: sidecar .beats.json → mezanino de verdade
│   ├── color.js            # grade + dither (puro: sem I/O) — rota zscale ou swscale
│   ├── encode.js           # Metodologia Gabriel: VBV, riskScore(), validate()
│   ├── vmaf.js             # VMAF vmaf_v0.6.1, veredito por média harmônica
│   └── score.js            # curva de atenção (heurística local)
├── clipper/                # CLI do auto-clipper (clip.js, check-deps.js)
├── remotion/               # projeto Remotion (AutoKillReel, NeuralIntro) — npm próprio
├── styles/                 # presets de legenda (captions.json)
├── luts/                   # suas LUTs .cube (aparecem sozinhas no EXPORT)
├── docs/plans/             # planos de implementação (fluxo Orquestrador/Executor)
├── .claude/                # agentes, skills e hooks do projeto
├── jobs/                   # scratch (uploads, transcripts, tracks) — não versionar
└── output/                 # entregas finais
```
