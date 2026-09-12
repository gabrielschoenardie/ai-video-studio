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

## 3. Fontes e assets

Fontes web (Unica One, Red Hat Mono) carregadas via Google Fonts — licença Open Font License, uso comercial livre.

Qualquer LUT `.cube`, footage de referência ou asset que você mesmo sobe é seu — o app não envia nada disso a lugar nenhum.

---

*Resumo de uma frase: o app e os engines de vídeo/voz/legenda são livres pra vender; o único ponto de atenção é confirmar os termos comerciais do Remotion antes de vender vídeos renderizados em escala.*
