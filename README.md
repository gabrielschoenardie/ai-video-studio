# 🎬 AI Video Studio

**One janela, tudo local.** Clip, score, anima, dubla, legenda e exporta pra Instagram Reels — $0 por uso, nada sobe pra nuvem.

Construído a partir do kit `ai-video-studio-kit` (blueprint + Metodologia Gabriel para o encode de entrega).

---

## Rodando

```bash
node server.js
# abre http://localhost:4870
```

Sem dependências npm no backend — só Node ≥18 + os engines abaixo (cada um opcional, o app degrada graciosamente quando falta um).

---

## Engines (instale o que for usar)

| Engine | Etapa | Instalação | Licença |
| --- | --- | --- | --- |
| **ffmpeg / ffprobe** | tudo | <https://ffmpeg.org/download.html> | LGPL/GPL |
| **Whisper** | captions, clipper | `pip install openai-whisper` (ou compile whisper.cpp) | MIT |
| **Voicebox** | voiceover | baixe em <https://voicebox.sh> (deixe aberto rodando) | MIT |
| **yt-dlp** | clipper (URLs) | `pip install yt-dlp` | Unlicense |
| **python3 + OpenCV** | clipper (reframe 9:16) | `pip install opencv-python` | BSD |
| **Remotion** | visuals (motion graphics) | `cd remotion && npm install` | ver `remotion/` |

Atalho pras dependências Python (Whisper, yt-dlp, OpenCV) de uma vez só:

```bash
pip install -r requirements.txt
```

ffmpeg/ffprobe e o Remotion ficam de fora do `requirements.txt` (não são pacotes PyPI) — instale conforme a tabela acima.

Cheque tudo de uma vez: `node clipper/check-deps.js` (ou clique **ENGINES** no app — a barra lateral já mostra o status ao abrir).

---

## Auto-Clipper (roda hoje, sem GUI)

```bash
cd clipper
node check-deps.js         # uma vez
node clip.js                # interativo — cola uma URL ou caminho de arquivo
node clip.js --mode ai --reframe   # picking de momentos via LLM + reframe 9:16
```

Sem API key? O **hook-detector offline** entra automaticamente (regex de perguntas, contraste, números, payoff markers + densidade de energia). Pra ligar o picking via IA:

Pra usar sua própria chave da Anthropic (Claude), a camada de compatibilidade OpenAI da Anthropic aceita o mesmo formato Chat Completions que o clipper já fala — não precisa mudar nada no código:

```bash
export LLM_BASE_URL="https://api.anthropic.com/v1"
export LLM_API_KEY="sk-ant-..."          # sua API key da Anthropic
export LLM_MODEL="claude-opus-4-8"       # ou claude-sonnet-5 / claude-haiku-4-5 (mais barato)
```

Detalhes importantes dessa camada de compatibilidade (não é a API nativa da Anthropic): é voltada pra teste/avaliação, não é a via recomendada pra produção; `temperature` fica travado entre 0–1; sem suporte a prompt caching. Pra esse uso de "escolher os melhores momentos do vídeo", `claude-haiku-4-5` costuma ser rápido e barato o suficiente.

---

## Pipeline (o app automatiza isso)

```text
BRIEF → VISUALS → VOICE → ASSEMBLE → SCORE → EXPORT
```

1. **Brief** — a ideia + roteiro (3–6 linhas), salvo localmente e injetado na etapa Voice.
2. **Visuals** — sobe seu footage ou renderiza uma composição Remotion (`AutoKillReel`, `NeuralIntro`).
3. **Voice** — Voicebox gera a narração no seu hardware, sem custo por palavra.
4. **Assemble** — funde visual + voz + legendas palavra-por-palavra (Whisper word timestamps) num MP4 mezzanine (CRF 18).
5. **Score** — curva de atenção segundo a segundo. Proxy local por padrão (energia de áudio + densidade de cortes + densidade de fala); ver seção TRIBE v2 abaixo pro modelo de resposta cerebral.
6. **Export** — encode de entrega Instagram: perfil VBV por duração, stack x264 premium, BT.709, GOP ≤60, `validate_encode.sh`-equivalente embutido (APROVADO/REPROVADO).

---

## Licenciamento — leia antes de uso comercial

O código do app (`server.js`, `lib/`, `public/`, `clipper/`) é seu, sem restrição adicional.

Os **engines** usados são de licença permissiva (Apache-2.0, MIT, LGPL/GPL do ffmpeg) — uso comercial livre.

O **TRIBE v2** (modelo de resposta cerebral, scorer "de verdade" por trás da etapa Score) é licenciado **apenas para uso não-comercial** pelo autor original. Por isso **não vem embutido** neste app. A etapa Score expõe instruções de auto-instalação (botão/painel "TRIBE V2 — BRAIN MODEL") apontando pra fonte oficial — baixe você mesmo, sob os termos dele. Sem isso, o app usa um **proxy local de atenção** (heurística honesta: energia de áudio + cortes + fala), que não é o modelo científico, só um primeiro filtro de "onde está monótono".

Veja `LICENSES.md` para detalhes completos.

---

## Estrutura

```text
ai-video-studio/
├── server.js              # backend HTTP, zero deps, job bus SSE
├── lib/                    # deps, ffmpeg, transcribe, captions, voiceover,
│                           # clipper, assemble, score, encode (Metodologia Gabriel)
├── public/index.html       # UI de janela única
├── clipper/                # CLI do auto-clipper (clip.js, check-deps.js)
├── remotion/                # projeto Remotion (AutoKillReel, NeuralIntro)
├── jobs/                    # scratch (uploads, transcripts, tracks) — não versionar
└── output/                  # entregas finais
```
