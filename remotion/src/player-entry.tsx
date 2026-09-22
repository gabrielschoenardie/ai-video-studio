// player-entry.tsx — ponte entre o Remotion Player (React) e o app, que é JS
// puro sem build step.
//
// esbuild empacota este arquivo (React + ReactDOM + @remotion/player + a
// composição) num IIFE auto-contido em `public/vendor/studio-player.js`, servido
// por `GET /vendor/…`. `public/index.html` carrega com um <script> comum e fala
// só com a API imperativa exposta em `window.StudioPlayer` — nenhum JSX, nenhum
// módulo, nenhum bundler do lado do app.
//
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelinePreview, EMPTY_TIMELINE, type TimelineProps } from './scenes/TimelinePreview';

export type { Segment, Clip, TimelineProps } from './scenes/TimelinePreview';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

const EMPTY = EMPTY_TIMELINE;

// A timeline é a soma dos segmentos. 1 frame é o mínimo que o Player aceita e
// evita um crash enquanto as props ainda estão vazias (antes do primeiro
// update, ou num vídeo que falhou ao sondar).
function durationInFrames(props: TimelineProps): number {
  const total = (props.segments || []).reduce((s, g) => s + (g.dur || 0), 0);
  return Math.max(1, Math.round(total * FPS));
}

type Listener = (payload?: unknown) => void;
type EventName = 'timeupdate' | 'play' | 'pause' | 'ended';

let root: Root | null = null;
let host: HTMLElement | null = null;
let current: TimelineProps = EMPTY;
let rate = 1;   // shuttle J/K/L — o Player aceita negativo e toca de ré nativo
let playerRef: PlayerRef | null = null;
const listeners: Record<EventName, Set<Listener>> = {
  timeupdate: new Set(), play: new Set(), pause: new Set(), ended: new Set(),
};

function emit(ev: EventName, payload?: unknown) {
  for (const cb of listeners[ev]) {
    try { cb(payload); } catch { /* um listener quebrado não derruba os outros */ }
  }
}

// O ref do Player só existe depois da montagem; reassinar a cada render
// duplicaria os handlers, então a assinatura acontece uma vez por ref novo.
let boundRef: PlayerRef | null = null;
function bind(ref: PlayerRef | null) {
  playerRef = ref;
  if (!ref || ref === boundRef) return;
  boundRef = ref;
  ref.addEventListener('frameupdate', (e) => emit('timeupdate', e.detail.frame / FPS));
  ref.addEventListener('play', () => emit('play'));
  ref.addEventListener('pause', () => emit('pause'));
  ref.addEventListener('ended', () => emit('ended'));
}

function render() {
  if (!root) return;
  root.render(
    <Player
      ref={bind}
      component={TimelinePreview}
      inputProps={current}
      durationInFrames={durationInFrames(current)}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      fps={FPS}
      playbackRate={rate}
      // O transporte é a toolbar que a TIMELINE já tem (J/K/L, espaço, ,/.),
      // não os controles do Player — dois transportes competindo pelo mesmo
      // playhead é confusão garantida.
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      // Cada <Audio> montado ao mesmo tempo ocupa uma destas tags; o padrão é 5 e
      // o sexto lança erro e derruba o preview. A SFX empilha efeitos, então o
      // teto sobe — e public/index.html (PLAYER_AUDIO_MAX) nunca manda mais que isto.
      numberOfSharedAudioTags={16}
      style={{ width: '100%', height: '100%' }}
      acknowledgeRemotionLicense
    />,
  );
}

const StudioPlayer = {
  mount(el: HTMLElement, props?: Partial<TimelineProps>) {
    if (root && host === el) return StudioPlayer.update(props || {});
    if (root) StudioPlayer.unmount();
    host = el;
    root = createRoot(el);
    current = { ...EMPTY, ...(props || {}) };
    render();
    return StudioPlayer;
  },
  update(props: Partial<TimelineProps>) {
    current = { ...current, ...(props || {}) };
    render();
    return StudioPlayer;
  },
  seek(seconds: number) {
    playerRef?.seekTo(Math.max(0, Math.round((seconds || 0) * FPS)));
  },
  play() { playerRef?.play(); },
  pause() { playerRef?.pause(); },
  // taxa de shuttle; negativo toca de ré. Re-renderiza porque `playbackRate` é
  // prop do <Player>, não método do ref.
  setRate(n: number) {
    const next = Number(n) || 1;
    if (next === rate) return;
    rate = next;
    render();
  },
  getRate(): number { return rate; },
  getTime(): number {
    return playerRef ? playerRef.getCurrentFrame() / FPS : 0;
  },
  isPlaying(): boolean { return playerRef ? playerRef.isPlaying() : false; },
  on(ev: EventName, cb: Listener) {
    listeners[ev]?.add(cb);
    return () => listeners[ev]?.delete(cb);
  },
  unmount() {
    // O unmount do React 18 não pode rodar dentro do ciclo de render; o app só
    // chama isto em troca de vídeo, fora de render, então é seguro direto.
    root?.unmount();
    root = null; host = null; playerRef = null; boundRef = null;
    for (const s of Object.values(listeners)) s.clear();
  },
};

declare global {
  interface Window { StudioPlayer?: typeof StudioPlayer }
}
window.StudioPlayer = StudioPlayer;

export default StudioPlayer;
