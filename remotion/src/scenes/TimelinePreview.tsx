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
  sfx: Clip[];
  hidden: { broll?: boolean };
  /* Quem soa, calculado pelo app (`audibleNow()` em public/index.html). A
     composição só obedece: a regra de mudo/solo mora num lugar só deste lado,
     e o conform (lib/timeline.js) aplica a mesma ao arquivo exportado. */
  audible: { audio: boolean; music: boolean; sfx: boolean };
};

export const EMPTY_TIMELINE: TimelineProps = {
  src: '', segments: [], broll: [], music: [], sfx: [], hidden: {},
  audible: { audio: true, music: true, sfx: true },
};

// Um Sequence com 0 frames não renderiza e o Remotion reclama de duração
// inválida; o piso de 1 frame mantém um clipe curtíssimo visível em vez de
// derrubar a composição inteira.
const atLeastOneFrame = (seconds: number, fps: number) =>
  Math.max(1, Math.round((seconds || 0) * fps));

export const TimelinePreview: React.FC<TimelineProps> = ({
  src, segments, broll, music, sfx, hidden, audible,
}) => {
  const { fps } = useVideoConfig();
  const frames = (s: number) => atLeastOneFrame(s, fps);
  const from = (s: number) => Math.max(0, Math.round((s || 0) * fps));

  // TRILHA e SFX tocam igual: um <Audio> por clipe, na janela dele. Track que
  // não soa não monta <Audio> nenhum (não toca com volume 0): cada <Audio>
  // montado ocupa uma das numberOfSharedAudioTags do Player.
  const bed = (clips: Clip[], key: string) => clips.map((c, i) => (
    <Sequence key={`${key}${i}`} from={from(c.start)} durationInFrames={frames(c.dur)}>
      <Audio src={c.path} startFrom={from(c.srcIn || 0)} volume={Math.max(0, Math.min(1, c.volume ?? 1))} />
    </Sequence>
  ));

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
              <Video src={src} startFrom={from(seg.srcIn)} muted={!audible.audio} style={fit} />
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

      {audible.music && bed(music, 'm')}
      {audible.sfx && bed(sfx, 'x')}
    </AbsoluteFill>
  );
};
