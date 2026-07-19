import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

// NeuralIntro — the kit's detail rule applied:
// many SMALL, SHARP, GLOWING elements layered in DEPTH (not big soft blobs),
// fog + depth-falloff + controlled bloom + film grain + a moving camera.

const W = 1080;
const H = 1920;

type Node = {x: number; y: number; z: number; r: number; phase: number};
type Link = {a: number; b: number; phase: number};

// deterministic PRNG — same network every render
function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNetwork(count: number, seed: number) {
  const rnd = mulberry32(seed);
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: (rnd() - 0.5) * 2.4,           // world space, camera-relative
      y: (rnd() - 0.5) * 3.6,
      z: 0.35 + rnd() * 2.4,            // depth 0.35 (near) → 2.75 (far)
      r: 1.2 + rnd() * 2.6,             // small, sharp
      phase: rnd() * Math.PI * 2,
    });
  }
  const links: Link[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.8);
      if (d < 0.46 && rnd() < 0.55) links.push({a: i, b: j, phase: rnd()});
    }
  }
  return {nodes, links};
}

export const NeuralIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;

  const {nodes, links} = useMemo(() => buildNetwork(240, 20260715), []);

  // moving camera: slow dolly-in + drift + gentle roll
  const camZ = interpolate(frame, [0, durationInFrames], [0, 0.9]);
  const camX = Math.sin(t * 0.35) * 0.10;
  const camY = Math.cos(t * 0.27) * 0.08;
  const roll = Math.sin(t * 0.2) * 1.6; // degrees

  const project = (n: Node) => {
    const z = Math.max(n.z - camZ, 0.18);
    const s = 1 / z;
    return {
      sx: W / 2 + (n.x - camX) * s * (W * 0.42),
      sy: H / 2 + (n.y - camY) * s * (H * 0.30),
      s,
      z,
    };
  };

  const title = interpolate(frame, [durationInFrames * 0.55, durationInFrames * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: 'radial-gradient(120% 90% at 50% 42%, #101613 0%, #0a0a0a 55%, #050505 100%)'}}>
      <div style={{position: 'absolute', inset: 0, transform: `rotate(${roll}deg) scale(1.06)`}}>
        <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
          <defs>
            <filter id="bloom" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="5" result="b1" />
              <feGaussianBlur stdDeviation="14" result="b2" />
              <feMerge>
                <feMergeNode in="b2" /><feMergeNode in="b1" /><feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* links, depth-sorted far→near, fog by depth */}
          {links.map((l, i) => {
            const A = project(nodes[l.a]);
            const B = project(nodes[l.b]);
            const depth = (A.z + B.z) / 2;
            const fog = Math.max(0, 1 - depth / 2.9);
            const o = 0.05 + fog * 0.22;
            // traveling signal pulse along the link
            const p = (t * 0.5 + l.phase) % 1;
            const px = A.sx + (B.sx - A.sx) * p;
            const py = A.sy + (B.sy - A.sy) * p;
            return (
              <g key={i}>
                <line x1={A.sx} y1={A.sy} x2={B.sx} y2={B.sy}
                  stroke="#00ff88" strokeOpacity={o} strokeWidth={Math.max(0.5, 1.4 * fog)} />
                {fog > 0.35 && (
                  <circle cx={px} cy={py} r={1.6 + fog * 1.8}
                    fill="#aaffdd" opacity={0.5 + fog * 0.4} filter="url(#bloom)" />
                )}
              </g>
            );
          })}

          {/* nodes — small, sharp cores with controlled bloom halo */}
          {[...nodes]
            .sort((a, b) => b.z - a.z)
            .map((n, i) => {
              const P = project(n);
              const fog = Math.max(0, 1 - P.z / 2.9);
              const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + n.phase);
              const r = n.r * P.s * 0.9 * pulse;
              if (P.sx < -40 || P.sx > W + 40 || P.sy < -40 || P.sy > H + 40) return null;
              return (
                <g key={i}>
                  <circle cx={P.sx} cy={P.sy} r={r * 2.6}
                    fill="#00ff88" opacity={0.10 * fog} filter="url(#bloom)" />
                  <circle cx={P.sx} cy={P.sy} r={Math.max(r, 0.7)}
                    fill={fog > 0.6 ? '#eafff4' : '#7dffc4'} opacity={0.35 + fog * 0.65} />
                </g>
              );
            })}
        </svg>
      </div>

      {/* fog layer — depth haze, not a blob */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(90% 60% at 50% 55%, rgba(10,14,12,0) 30%, rgba(8,10,9,0.55) 100%)',
      }} />

      {/* title */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div style={{
          opacity: title,
          transform: `translateY(${(1 - title) * 24}px)`,
          textAlign: 'center',
          fontFamily: "'Segoe UI', sans-serif",
        }}>
          <div style={{
            fontSize: 30, letterSpacing: '0.55em', color: '#5aa886',
            textTransform: 'uppercase', marginBottom: 14,
          }}>Signal in</div>
          <div style={{
            fontSize: 92, fontWeight: 800, color: '#eafff4',
            textShadow: '0 0 24px rgba(0,255,136,.55), 0 0 90px rgba(0,255,136,.25)',
            letterSpacing: '0.02em',
          }}>THE NETWORK</div>
          <div style={{fontSize: 26, color: '#7f8f88', marginTop: 16}}>wakes up.</div>
        </div>
      </AbsoluteFill>

      {/* film grain — animated, subtle */}
      <div style={{
        position: 'absolute', inset: '-50%',
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/><feColorMatrix type=\'saturate\' values=\'0\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>")',
        opacity: 0.05,
        transform: `translate(${(frame % 7) * 3}px, ${(frame % 5) * -4}px)`,
        mixBlendMode: 'overlay',
        pointerEvents: 'none',
      }} />

      {/* vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        boxShadow: 'inset 0 0 260px 90px rgba(0,0,0,0.85)',
      }} />
    </AbsoluteFill>
  );
};
