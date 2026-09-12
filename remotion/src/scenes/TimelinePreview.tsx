// TimelinePreview.tsx — o que o passo 04 TIMELINE mostra no preview, espelhando
// o sidecar `.beats.json` v3.
//
// A diferença estrutural em relação ao compositor de canvas que isto substitui:
// aqui o corte é DECLARATIVO. O <Series> abaixo mapeia tempo de timeline →
// tempo de fonte sozinho, então o ripple da pista VÍDEO sai de graça e não há
// mais um laço de rAF empurrando `currentTime` na emenda de cada segmento.
//
// ISTO É PREVIEW, NUNCA RENDER. O arquivo exportado continua saindo de
// lib/timeline.js (`POST /api/timeline/conform`) — frames de browser não entram
// na entrega. Onde os dois discordam, quem manda é o conform.
import React from 'react';
import { AbsoluteFill, Series, Sequence, Video, Audio, useVideoConfig } from 'remotion';

export type Segment = { srcIn: number; dur: number };
export type Clip = { path: string; start: number; dur: number; srcIn?: number; volume?: number };
export type Word = { start: number; end: number; text: string };

export type TimelineProps = {
  src: string;
  segments: Segment[];
  broll: Clip[];
  music: Clip[];
  hidden: { broll?: boolean; music?: boolean };
  trilhaMuted: boolean;
  /* SOLO da TRILHA: silencia o plate para sobrar só a música, espelhando o
     `video.muted = trilhaSolo` da rota de canvas. */
  trilhaSolo: boolean;
};

export const EMPTY_TIMELINE: TimelineProps = {
  src: '', segments: [], broll: [], music: [], hidden: {}, trilhaMuted: false, trilhaSolo: false,
};

// Um Sequence com 0 frames não renderiza e o Remotion reclama de duração
// inválida; o piso de 1 frame mantém um clipe curtíssimo visível em vez de
// derrubar a composição inteira.
const atLeastOneFrame = (seconds: number, fps: number) =>
  Math.max(1, Math.round((seconds || 0) * fps));

export const TimelinePreview: React.FC<TimelineProps> = ({
  src, segments, broll, music, hidden, trilhaMuted, trilhaSolo,
}) => {
  const { fps } = useVideoConfig();
  const frames = (s: number) => atLeastOneFrame(s, fps);
  const from = (s: number) => Math.max(0, Math.round((s || 0) * fps));

  // `contain` copia o que o compositor de canvas fazia (Math.min(cw/vw, ch/vh)),
  // e NÃO o buildFit() do export — que tem fundo desfocado, crop e pad. O
  // preview mostra o corte, não o enquadramento final.
  const fit: React.CSSProperties = { objectFit: 'contain' };

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {segments.length > 0 && (
        <Series>
          {segments.map((seg, i) => (
            <Series.Sequence key={`v${i}`} durationInFrames={frames(seg.dur)}>
              <Video src={src} startFrom={from(seg.srcIn)} muted={trilhaSolo} style={fit} />
            </Series.Sequence>
          ))}
        </Series>
      )}

      {/* B-ROLL entra por cima do plate na janela dele. `muted` não é detalhe:
          lib/timeline.js descarta o áudio de B-ROLL no conform, e o preview
          precisa soar igual ao que vai sair. */}
      {!hidden.broll && broll.map((c, i) => (
        <Sequence key={`b${i}`} from={from(c.start)} durationInFrames={frames(c.dur)}>
          <Video src={c.path} startFrom={from(c.srcIn || 0)} muted style={fit} />
        </Sequence>
      ))}

      {!hidden.music && music.map((c, i) => (
        <Sequence key={`m${i}`} from={from(c.start)} durationInFrames={frames(c.dur)}>
          <Audio
            src={c.path}
            startFrom={from(c.srcIn || 0)}
            volume={trilhaMuted ? 0 : Math.max(0, Math.min(1, c.volume ?? 1))}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
