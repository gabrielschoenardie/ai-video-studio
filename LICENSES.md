# Licenças — em português simples

Este documento resume, em linguagem direta, o que você pode e não pode fazer com cada parte do stack. Não é aconselhamento jurídico — quando em dúvida, confira a licença oficial de cada projeto na fonte.

---

## 1. Código deste app

Tudo em `server.js`, `lib/`, `public/`, `clipper/`, `remotion/src/` (exceto `AutoKillReel.tsx`, ver nota abaixo) foi escrito pra este projeto. Use, modifique e comercialize livremente.

## 2. Engines de terceiros — uso comercial liberado

| Engine | Licença | Uso comercial? |
|---|---|---|
| ffmpeg / ffprobe | LGPL/GPL (depende do build) | ✅ Sim |
| Whisper (openai-whisper) | MIT | ✅ Sim |
| whisper.cpp | MIT | ✅ Sim |
| Voicebox | MIT | ✅ Sim |
| yt-dlp | Unlicense (domínio público) | ✅ Sim |
| OpenCV (python3-opencv) | BSD/Apache | ✅ Sim |
| Remotion | ver `remotion/` — licença própria (verifique termos comerciais no site oficial antes de vender vídeos renderizados em escala) | ⚠️ Confirmar termos |

## 3. TRIBE v2 — a única peça restrita

O modelo de resposta cerebral (scorer "de verdade" da etapa SCORE) é um **modelo de pesquisa licenciado apenas para uso não-comercial** pelos autores originais.

Por isso:
- **Não está embutido** neste app.
- A etapa Score mostra um painel com instruções de auto-instalação — você baixa a fonte oficial e avalia sob os termos dela.
- Sem ele, o app usa um **proxy heurístico local** (energia de áudio + densidade de cortes + densidade de fala) — não é o modelo científico, é um primeiro filtro honesto de "onde a atenção provavelmente cai".
- **Antes de qualquer uso comercial do TRIBE v2**, leia a licença oficial dele. Se seu uso é comercial, ou você respeita os termos não-comerciais, ou negocia licença com os autores, ou fica só no proxy local.

## 4. Fontes e assets

Fontes web (Unica One, Red Hat Mono) carregadas via Google Fonts — licença Open Font License, uso comercial livre.

Qualquer LUT `.cube`, footage de referência ou asset que você mesmo sobe é seu — o app não envia nada disso a lugar nenhum.

---

*Resumo de uma frase: o app e os engines de vídeo/voz/legenda são livres pra vender. A única coisa que exige atenção é o modelo de resposta cerebral (TRIBE v2) — não-comercial, auto-instalável, nunca embutido.*
