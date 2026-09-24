/* ui-probe.js — instrumento de medição da TIMELINE.
   Sub-projeto A (E0–E3b): docs/plans/ui-premium-timeline.md
     spec docs/superpowers/specs/2026-09-16-ui-premium-timeline-design.md
   Sub-projeto B (B2, B3, B5): docs/plans/mixagem-audio.md
     spec docs/superpowers/specs/2026-09-21-mixagem-audio-design.md
   Carregado só com ?probe na URL (loader no <head> de public/index.html).
   Só lê DOM/CSSOM — não enxerga o closure da TIMELINE. Uso, no console:
     await uiProbe.load('output/assembled-4545f906507a.mp4')
     await uiProbe.run('E1')
   Checks que alteram estado (controles de track, play, folha de atalhos)
   desfazem o que fizeram; o de play move o playhead ~1s. */
(function () {
  'use strict';

  const ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'B2', 'B3', 'B5', 'B6', 'B7']; // o B4 não mexe na TIMELINE
  // Isentos do piso de 11px: dado desenhado em escala de tempo (spec A, decisão 2;
  // a SFX segue a TRILHA — spec B, decisão 11).
  const EXEMPT_TEXT = ['.bt-word', '.bt-clip.music', '.bt-clip.sfx'];
  // Classes de estado mudam com playhead/seleção e não dizem nada sobre fonte.
  const STATE_CLASSES = new Set(['on', 'active', 'selected', 'hidden', 'locked', 'done', 'run', 'err',
    'dragging', 'flip', 'hot', 'over', 'enter', 'collapsed', 'bt-enter', 'bt-split', 'bt-seek', 'silent']);
  // Loops de ambiente: não são resposta a ação, mantêm duração literal.
  const AMBIENT = /\b(drift|blink|bt-pulse)\b/;
  const TIME_LITERAL = /(?:^|[\s,(])(\d*\.?\d+m?s)(?![\w-])/g;
  const TRACK_ORDER = ['beats', 'broll', 'video', 'legend', 'audio', 'music'];
  const TRACK_ORDER_B = TRACK_ORDER.concat('sfx'); // lane SFX abaixo da TRILHA, do B2 em diante
  // Controles por track do B3 em diante (spec B, tabela da seção "B3: controles de áudio").
  const TRACK_ACTS_B3 = { beats: ['hide', 'lock'], broll: ['add', 'hide', 'lock'], video: ['lock'],
    legend: ['hide', 'lock'], audio: ['mute', 'solo', 'lock'], music: ['add', 'mute', 'solo', 'lock'],
    sfx: ['add', 'mute', 'solo', 'lock'] };
  const AUDIO_TRACKS = ['audio', 'music', 'sfx'];
  const TRANSPORT_IDS = ['bt-play', 'bt-time', 'bt-rate', 'bt-j', 'bt-k', 'bt-l', 'bt-frameback',
    'bt-frameforward', 'bt-markin', 'bt-markout', 'bt-split', 'bt-merge', 'bt-rename', 'bt-undo',
    'bt-redo', 'bt-zoomout', 'bt-zoomlevel', 'bt-zoomin', 'bt-zoomfit', 'bt-save', 'bt-conform'];
  const TOGGLE_ACTS = ['hide', 'lock', 'mute', 'solo'];

  // Preenchido pelo Orquestrador na Task 1 com o JSON impresso por run('E0'). Não editar à mão.
  const BASELINE = {"textFloor":{"offenders":["button#bt-conform.bt-toggle@10.5","button#bt-save.bt-toggle@10.5","button#side-toggle@10","button.bt-tctl@9","button@10","div.bt-legend-head@9.5","h3@10","h3@10.5","label#clip-len-lbl@10.5","label@10.5","span#bt-preview-time.bt-preview-time@9.5","span#bt-zoomlevel.bt-zoomlevel@10.5","span#port.tag@10.5","span.bt-preview-tag@8.5","span.chip.no@10","span.chip.ok@10","span.dur@8.5","span.ic@9.5","span.lbl@9.5","span.meta@10","span.nm@9.5","span.rec@10.5","span.tag@8.5","span@9","th@9.5"],"exempt":[".bt-word@9.5"]},"contrast":{"--faint/--bg":3.41,"--faint/--panel":3.1,"--faint/--panel2":2.92,"--dim/--bg":8.06,"--dim/--panel":7.32,"--dim/--panel2":6.91},"ariaLive":1,"motionLiterals":["nav button → color 0.18s, background 0.18s | 0.18s, 0.18s | unset",".step.on → 0.28s ease 0s 1 normal both running rise | 0.28s","input[type=\"text\"], input[type=\"number\"], textarea, select → border-color 0.18s, box-shadow 0.18s | 0.18s, 0.18s",".btn → transform 0.16s, filter 0.16s, box-shadow 0.16s | 0.16s, 0.16s, 0.16s | unset",".btn::after → transform 0.5s | 0.5s",".drop → border-color 0.2s, color 0.2s, background 0.2s, transform 0.2s | 0.2s, 0.2s, 0.2s, 0.2s",".asset → border-color 0.18s, background 0.18s | 0.18s, 0.18s",".asset button → background 0.15s | 0.15s | unset","aside → height 0.2s | 0.2s","#prog i → width 0.4s | 0.4s",".bt-tctl → color 0.15s, background 0.15s | 0.15s, 0.15s | unset",".bt-tbtn, .bt-tctl, .bt-toggle → color 0.15s, border-color 0.15s, box-shadow 0.15s | 0.15s, 0.15s, 0.15s",".bt-beat → transform 0.15s, filter 0.15s, box-shadow 0.15s | 0.15s, 0.15s, 0.15s",".bt-pop → transform 0.16s, opacity 0.16s | 0.16s, 0.16s",".bt-legend-row → background 0.15s | 0.15s"],"consoleErrors":[],"tapTargets":{"tbtnMinH":30,"tctlMinSide":24},"transportOverflow":false,"trackOrder":["beats","broll","video","legend","audio","music"],"labelTruncate":[],"labelwSync":{"token":null,"label":192,"ruler":192,"playheadDelta":0,"tolerance":4},"markersAboveRuler":true,"playhead":{"count":1,"heightDelta":0},"tctl":{"count":15,"missingLabel":0,"withText":15,"missingPressed":13}};

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function waitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('[uiProbe] timeout esperando a TIMELINE');
  }
  function timelineReady() {
    const step = document.getElementById('step-beats');
    return !!(step && step.classList.contains('on') && $('#bt-inner') && $('.bt-transport'));
  }

  /* ---------------- carregar a fixture ---------------- */
  async function load(path) {
    if (typeof window.addAsset !== 'function' || typeof window.goStep !== 'function')
      throw new Error('[uiProbe] addAsset/goStep não encontrados no escopo global');
    const sel = document.getElementById('bt-visual');
    if (![...sel.options].some(o => o.value === path))
      window.addAsset({ path, name: path.split(/[\\/]/).pop(), kind: 'video', source: 'probe' });
    window.goStep('beats');
    sel.value = path;
    sel.dispatchEvent(new Event('change'));
    await waitFor(() => $('#bt-track-legend .bt-word, #bt-track-legend .empty'), 30000);
    // Chips de #engines chegam via /api/deps (~3s, sem cache) e contam no text-floor.
    await waitFor(() => $('#engines .chip'), 30000);
    await sleep(500);
    return timelineReady();
  }

  /* ---------------- medições que não alteram estado ---------------- */
  function signature(el) {
    const cls = [...el.classList].filter(c => !STATE_CLASSES.has(c)).sort().join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  }
  function textFloor() {
    const offenders = new Set(), exempt = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!(size < 11)) continue;
      const ex = EXEMPT_TEXT.find(sel => el.closest(sel));
      if (ex) exempt.add(ex + '@' + size); else offenders.add(signature(el) + '@' + size);
    }
    return { offenders: [...offenders].sort(), exempt: [...exempt].sort() };
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast() {
    const out = {};
    for (const fg of ['--faint', '--dim']) for (const bg of ['--bg', '--panel', '--panel2']) {
      const a = hexRgb(cssVar(fg)), b = hexRgb(cssVar(bg));
      if (!a || !b) { out[fg + '/' + bg] = null; continue; }
      const la = luminance(a), lb = luminance(b);
      out[fg + '/' + bg] = round((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
    }
    return out;
  }
  function ariaLive() { return $$('[aria-live]').length; }
  function consoleErrors() { return (window.__probeErrors || []).slice(); }
  function motionLiterals() {
    const hits = new Set();
    const scan = (where, text) => {
      // A extensão Claude in Chrome injeta na página, enquanto o agente age, uma borda
      // animada e um cursor fantasma (#claude-agent-glow-border…, #claude-phantom-cursor).
      // Não são do app: sem este filtro, o check falha depois de qualquer tecla ou clique.
      if (!text || AMBIENT.test(text) || /#claude-/.test(where)) return;
      if ([...text.matchAll(TIME_LITERAL)].some(m => parseFloat(m[1]) > 0)) hits.add(where + ' → ' + text);
    };
    const walk = rules => {
      for (const r of rules) {
        if (r.conditionText && /prefers-reduced-motion/.test(r.conditionText)) continue;
        if (r.style) {
          const text = ['transition', 'transition-duration', 'animation', 'animation-duration']
            .map(p => r.style.getPropertyValue(p)).filter(Boolean).join(' | ');
          scan(r.selectorText || r.keyText || '@rule', text);
        }
        if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // folha cross-origin (Google Fonts)
      walk(rules);
    }
    for (const el of $$('[style]'))
      scan(signature(el) + ' [style]', [el.style.transition, el.style.animation].filter(Boolean).join(' | '));
    return [...hits];
  }
  function tapTargets() {
    const h = $$('.bt-tbtn').map(e => e.getBoundingClientRect().height);
    const s = $$('.bt-tctl').map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });
    return { tbtnMinH: h.length ? round(Math.min(...h), 1) : null, tctlMinSide: s.length ? round(Math.min(...s), 1) : null };
  }
  function transportOverflow() { const t = $('.bt-transport'); return t.scrollWidth > t.clientWidth; }
  function trackOrder() { return $$('.bt-track-row').map(r => r.dataset.track); }
  function labelTruncate() {
    const bad = [];
    for (const row of $$('.bt-track-row')) {
      const label = $('.bt-track-label', row), nm = label && $('.nm', label);
      if (!label) continue;
      if (label.scrollWidth > label.clientWidth || (nm && nm.scrollWidth > nm.clientWidth)) bad.push(row.dataset.track);
    }
    return bad;
  }
  function parseTimecode(s) { const m = /(\d+):(\d+(?:\.\d+)?)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 0; }
  function labelwSync() {
    const token = parseFloat(cssVar('--bt-labelw'));
    const label = round($('.bt-track-label').getBoundingClientRect().width, 1);
    const ruler = round(parseFloat(getComputedStyle($('#bt-ruler')).marginLeft), 1);
    // left do playhead deve ser labelw + t·px. t vem de #bt-time (0,1s); px do readout de zoom (100% = 60 px/s).
    const time = $('#bt-time');
    const t = parseTimecode(time && time.firstChild ? time.firstChild.textContent : '');
    const px = 60 * parseFloat($('#bt-zoomlevel').textContent) / 100;
    const base = Number.isFinite(token) ? token : label;
    const delta = Math.abs(parseFloat($('#bt-playhead').style.left) - (base + t * px));
    return { token: Number.isFinite(token) ? token : null, label, ruler,
      playheadDelta: round(delta, 1), tolerance: round(px * 0.05 + 1, 1) };
  }
  function syncOk(s) {
    return !!s && s.token != null && Math.abs(s.label - s.token) <= 0.5 &&
      Math.abs(s.ruler - s.token) <= 0.5 && s.playheadDelta <= s.tolerance;
  }
  function markersAboveRuler() {
    const top = $('.bt-tracks-top'), ruler = $('#bt-ruler');
    return !!(top && ruler && (top.compareDocumentPosition(ruler) & Node.DOCUMENT_POSITION_FOLLOWING));
  }
  function playhead() {
    const all = $$('.bt-playhead');
    const h = all[0] ? all[0].getBoundingClientRect().height : 0;
    return { count: all.length, heightDelta: round(Math.abs(h - $('#bt-inner').getBoundingClientRect().height), 1) };
  }
  function tctl() {
    const all = $$('.bt-tctl');
    return {
      count: all.length,
      missingLabel: all.filter(b => !b.getAttribute('aria-label')).length,
      withText: all.filter(b => b.textContent.trim()).length,
      missingPressed: all.filter(b => b.dataset.act !== 'add' && !b.hasAttribute('aria-pressed')).length,
    };
  }
  function sfxLane() {
    const order = trackOrder(), row = $('.bt-track-row[data-track="sfx"]');
    return { afterMusic: order.indexOf('sfx') === order.indexOf('music') + 1,
      acts: row ? $$('.bt-tctl', row).map(b => b.dataset.act) : [],
      host: !!$('#bt-track-sfx'), token: cssVar('--sfx') };
  }
  function playheadTc() {
    const tc = $('.bt-playhead-tc'), time = $('#bt-time');
    return { chip: tc ? tc.textContent.trim() : null,
      time: time && time.firstChild ? time.firstChild.textContent.trim() : null };
  }

  /* ---------------- medições que alteram estado (e desfazem) ---------------- */
  function tctlToggles() {
    const bad = [];
    for (const btn of $$('.bt-tctl').filter(b => TOGGLE_ACTS.includes(b.dataset.act))) {
      const before = btn.getAttribute('aria-pressed');
      btn.click();
      const flipped = btn.getAttribute('aria-pressed') === String(before !== 'true');
      btn.click();
      if (!flipped || btn.getAttribute('aria-pressed') !== before) bad.push(btn.getAttribute('aria-label'));
    }
    return bad;
  }
  function trackActs() {
    const o = {};
    for (const r of $$('.bt-track-row')) o[r.dataset.track] = $$('.bt-tctl', r).map(b => b.dataset.act);
    return o;
  }
  const audioBtn = (t, act) => $(`.bt-track-row[data-track="${t}"] .bt-tctl[data-act="${act}"]`);
  const pressed = el => !!el && el.getAttribute('aria-pressed') === 'true';
  function mixState() {
    return { mute: AUDIO_TRACKS.filter(t => pressed(audioBtn(t, 'mute'))),
      solo: AUDIO_TRACKS.find(t => pressed(audioBtn(t, 'solo'))) || null };
  }
  // Leva M/S ao estado pedido clicando nos botões, como o usuário faria.
  function setMix(mute, solo) {
    for (const t of AUDIO_TRACKS) if (pressed(audioBtn(t, 'mute')) !== mute.includes(t)) audioBtn(t, 'mute').click();
    const cur = mixState().solo;
    if (cur !== solo) (solo ? audioBtn(solo, 'solo') : audioBtn(cur, 'solo')).click();
  }
  function soloExclusive() {
    const start = mixState();
    const soloed = () => $$('.bt-tctl[data-act="solo"]').filter(pressed).map(b => b.closest('.bt-track-row').dataset.track);
    const steps = [];
    setMix(start.mute, null);
    audioBtn('audio', 'solo').click(); steps.push(soloed());
    audioBtn('sfx', 'solo').click(); steps.push(soloed());
    audioBtn('sfx', 'solo').click(); steps.push(soloed());
    setMix(start.mute, start.solo);
    return { steps, ok: same(steps, [['audio'], ['sfx'], []]) };
  }
  function silentLanes() {
    const start = mixState();
    const combos = [[[], null], [['music'], null], [['audio', 'sfx'], null], [[], 'sfx'], [['music'], 'music'], [['sfx'], 'audio']];
    const bad = [];
    for (const [mute, solo] of combos) {
      setMix(mute, solo);
      for (const t of AUDIO_TRACKS) {
        const want = !(!mute.includes(t) && (solo === null || solo === t));
        const got = $(`.bt-track-row[data-track="${t}"]`).classList.contains('silent');
        if (want !== got) bad.push({ mute, solo, track: t, silent: got });
      }
    }
    setMix(start.mute, start.solo);
    return { combos: combos.length, bad };
  }
  // B6: em todo clipe de SFX com pico conhecido, a marca segue o limiar de −10 dBFS;
  // sem pico conhecido (arquivo ainda decodificando), nenhuma marca. Só lê.
  function sfxPeak() {
    const clips = $$('#bt-track-sfx .bt-clip'), bad = [];
    let known = 0;
    clips.forEach((c, i) => {
      const over = c.classList.contains('over'), title = !!c.getAttribute('title');
      if (!('peak' in c.dataset)) { if (over || title) bad.push({ i, peak: null, over, title }); return; }
      known++;
      const want = parseFloat(c.dataset.peak) > -10;
      if (over !== want || title !== want) bad.push({ i, peak: c.dataset.peak, over, title });
    });
    return { clips: clips.length, known, bad };
  }
  // Espera o primeiro render do master (até 10 s) e mede o lugar do medidor.
  async function meter() {
    const m = $('#bt-meter'), s = $('.bt-scroll');
    if (!m || !s) return { present: false };
    for (let i = 0; i < 100 && m.dataset.state === 'pending'; i++) await sleep(100);
    const rm = m.getBoundingClientRect(), rs = s.getBoundingClientRect();
    return { present: true, rightOfTracks: rm.left >= rs.right - 1, heightDelta: round(Math.abs(rm.height - rs.height), 1),
      state: m.dataset.state, peak: m.dataset.peak, token: cssVar('--meter-ok') };
  }
  /* B7: o trecho marcado como excesso não pode escapar do clipe, e clipe que cabe na
     mídia não pode ter marcação. Só lê DOM — a duração da mídia mora no closure da
     TIMELINE e o probe não a enxerga, então a afirmação é geométrica. */
  function clipBounds() {
    const bad = [];
    for (const track of ['broll', 'music', 'sfx']) {
      for (const el of $$(`#bt-track-${track} .bt-clip`)) {
        const ov = $('.bt-clip-over', el);
        if (!ov) continue;
        const w = el.getBoundingClientRect().width, ow = ov.getBoundingClientRect().width;
        if (ow > w + 1) bad.push({ track, idx: el.dataset.idx, clipe: round(w, 1), excesso: round(ow, 1) });
        if (getComputedStyle(ov).pointerEvents !== 'none') bad.push({ track, idx: el.dataset.idx, pointerEvents: 'não é none' });
      }
    }
    return { marcados: $$('.bt-clip-over').length, bad };
  }
  async function transportIds() {
    const missing = TRANSPORT_IDS.filter(id => !document.getElementById(id));
    const ungrouped = TRANSPORT_IDS.filter(id => {
      const el = document.getElementById(id);
      return el && !el.closest('.bt-tgroup');
    });
    const play = document.getElementById('bt-play');
    const kbdKept = [], playLabels = [];
    if (play) for (let i = 0; i < 2; i++) {
      play.click();
      await sleep(600);
      kbdKept.push(!!$('.bt-kbd', play));
      const lbl = $('.lbl', play);
      playLabels.push(lbl ? lbl.textContent : null);
    }
    return { missing, ungrouped, kbdKept, playLabels };
  }
  async function shortcutSheet() {
    const dlg = document.getElementById('shortcuts-sheet'), opener = document.getElementById('shortcuts-btn');
    if (!dlg || !opener) return { present: false };
    opener.focus();
    opener.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await sleep(80);
    const opened = dlg.open, modal = dlg.matches(':modal');
    const rows = $$('.sc-row', dlg).length, expected = (window.SHORTCUTS || []).length;
    if (dlg.open) dlg.close();
    await sleep(80);
    return { present: true, opened, modal, rows, expected, focusReturned: document.activeElement === opener };
  }

  /* ---------------- execução ---------------- */
  async function run(stage) {
    if (!ORDER.includes(stage)) throw new Error('[uiProbe] estágio inválido: ' + stage + ' — use ' + ORDER.join(' | '));
    const at = s => ORDER.indexOf(stage) >= ORDER.indexOf(s);
    const tl = timelineReady();
    if (window.innerWidth !== 1280) console.warn('[uiProbe] viewport ' + window.innerWidth + 'px — a referência é 1280px');
    if (!tl) console.warn('[uiProbe] TIMELINE não visível — rode `await uiProbe.load(<vídeo>)`. Checks da TIMELINE darão SKIP.');

    const snap = { textFloor: textFloor(), contrast: contrast(), ariaLive: ariaLive(),
      motionLiterals: motionLiterals(), consoleErrors: consoleErrors() };
    if (tl) Object.assign(snap, { tapTargets: tapTargets(), transportOverflow: transportOverflow(),
      trackOrder: trackOrder(), labelTruncate: labelTruncate(), labelwSync: labelwSync(),
      markersAboveRuler: markersAboveRuler(), playhead: playhead(), tctl: tctl() });

    if (stage === 'E0') {
      console.log('[uiProbe] E0 — baseline. Grave este JSON em BASELINE (public/dev/ui-probe.js):');
      console.log(JSON.stringify(snap));
      return { stage, ok: true, results: [], snapshot: snap };
    }

    const R = [];
    const add = (id, ok, measured, expected, note) =>
      R.push({ id, status: ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL', measured, expected, note: note || '' });
    const b = BASELINE || {};
    if (!BASELINE) add('baseline', false, null, 'BASELINE gravado', 'rode run("E0") no app antes das mudanças');

    // Do B2 em diante há clipes de TRILHA/SFX na tela conforme o teste: toda
    // isenção vale se o seletor estiver em EXEMPT_TEXT (o baseline não tinha clipes).
    const exemptOk = at('B2') ? snap.textFloor.exempt.every(e => EXEMPT_TEXT.includes(e.split('@')[0]))
      : same(snap.textFloor.exempt, (b.textFloor || {}).exempt);
    if (at('E2')) add('text-floor', snap.textFloor.offenders.length === 0 && exemptOk,
      snap.textFloor, { offenders: [], exempt: at('B2') ? 'seletores de EXEMPT_TEXT' : (b.textFloor || {}).exempt });
    else add('text-floor', same(snap.textFloor, b.textFloor), snap.textFloor, b.textFloor);

    const ratios = Object.values(snap.contrast).filter(v => v != null);
    if (at('E2')) add('contrast', ratios.length === 6 && Math.min(...ratios) >= 4.5, snap.contrast, '≥ 4.5 nos 6 pares');
    else add('contrast', same(snap.contrast, b.contrast), snap.contrast, b.contrast);

    add('aria-live', snap.ariaLive === 1, snap.ariaLive, 1);
    add('motion-literals', snap.motionLiterals.length === 0, snap.motionLiterals, []);
    add('console-errors', snap.consoleErrors.length === 0, snap.consoleErrors, []);

    if (!tl) {
      ['tap-targets', 'transport-overflow', 'track-order', 'label-truncate', 'labelw-sync',
        'markers-above-ruler', 'playhead', 'tctl-a11y'].forEach(id => add(id, null, null, null, 'TIMELINE não carregada'));
    } else {
      // Alvo único (compacto) desde a revisão R1 da Task 3: do E2 em diante, tbtn 30 · tctl 24.
      if (at('E2')) add('tap-targets', snap.tapTargets.tbtnMinH === 30 && snap.tapTargets.tctlMinSide === 24,
        snap.tapTargets, { tbtnMinH: 30, tctlMinSide: 24 });
      else add('tap-targets', same(snap.tapTargets, b.tapTargets), snap.tapTargets, b.tapTargets);
      if (at('E2')) add('transport-overflow', snap.transportOverflow === false, snap.transportOverflow, false);
      else add('transport-overflow', snap.transportOverflow === b.transportOverflow, snap.transportOverflow, b.transportOverflow);
      const wantOrder = at('B2') ? TRACK_ORDER_B : TRACK_ORDER;
      add('track-order', same(snap.trackOrder, wantOrder), snap.trackOrder, wantOrder);
      if (at('E2')) add('label-truncate', snap.labelTruncate.length === 0, snap.labelTruncate, []);
      else add('label-truncate', same(snap.labelTruncate, b.labelTruncate), snap.labelTruncate, b.labelTruncate);
      add('labelw-sync', syncOk(snap.labelwSync), snap.labelwSync, 'token = rótulo = margin-left da régua; playheadDelta ≤ tolerance');
      add('markers-above-ruler', snap.markersAboveRuler === true, snap.markersAboveRuler, true);
      add('playhead', snap.playhead.count === 1 && snap.playhead.heightDelta <= 1, snap.playhead, { count: 1, heightDelta: '≤ 1' });

      const t = snap.tctl;
      if (at('E3a')) {
        const failed = tctlToggles();
        add('tctl-a11y', t.count >= 15 && t.missingLabel === 0 && t.withText === 0 && t.missingPressed === 0 && failed.length === 0,
          Object.assign({}, t, { togglesFailed: failed }),
          { count: '≥ 15', missingLabel: 0, withText: 0, missingPressed: 0, togglesFailed: [] });
      } else {
        const bt = b.tctl || {};
        add('tctl-a11y', t.count === bt.count && t.missingLabel === 0 && t.withText === bt.withText, t,
          { count: bt.count, missingLabel: 0, withText: bt.withText });
      }

      if (at('E3a')) {
        const p = playheadTc();
        add('playhead-tc', !!p.chip && p.chip === p.time, p, 'chip === texto corrente de #bt-time');
      }
      if (at('E3b')) {
        const ti = await transportIds();
        add('transport-ids', ti.missing.length === 0 && ti.ungrouped.length === 0 && ti.kbdKept.length === 2 && ti.kbdKept.every(Boolean),
          ti, { missing: [], ungrouped: [], kbdKept: [true, true] },
          ti.playLabels[0] !== '❚❚' ? 'o play não trocou o rótulo — o vídeo da fixture toca neste navegador?' : '');
        const sc = await shortcutSheet();
        add('shortcut-sheet', sc.present && sc.opened && sc.modal && sc.expected > 0 && sc.rows === sc.expected && sc.focusReturned,
          sc, { opened: true, modal: true, rows: 'SHORTCUTS.length', focusReturned: true });
      }
      if (at('B5')) {
        const mt = await meter();
        add('meter', mt.present && mt.rightOfTracks && mt.heightDelta <= 2 && mt.state === 'ok' && mt.token === '#34d399' &&
          /^-?\d+\.\d$/.test(mt.peak || ''), mt, { rightOfTracks: true, heightDelta: '≤ 2', state: 'ok', token: '#34d399', peak: 'dBFS, uma casa' });
      }
      if (at('B7')) {
        const cb = clipBounds();
        add('clip-bounds', cb.bad.length === 0, cb, { bad: [] });
      }
      if (at('B6')) {
        const sp = sfxPeak();
        add('sfx-peak', sp.bad.length === 0, sp, { bad: [] });
      }
      if (at('B3')) {
        const acts = trackActs();
        add('audio-controls', same(acts, TRACK_ACTS_B3), acts, TRACK_ACTS_B3);
        const se = soloExclusive();
        add('solo-exclusive', se.ok, se.steps, [['audio'], ['sfx'], []]);
        const sl = silentLanes();
        add('silent-lanes', sl.bad.length === 0, sl, { combos: 6, bad: [] });
      }
      if (at('B2')) {
        const s = sfxLane();
        add('sfx-lane', s.afterMusic && s.host && s.token === '#22d3ee' && s.acts.includes('add') && s.acts.includes('lock'),
          s, { afterMusic: true, host: true, token: '#22d3ee', acts: 'inclui add e lock' });
      }
    }

    for (const r of R)
      console.log(r.status.padEnd(4) + ' ' + r.id + ' — medido: ' + JSON.stringify(r.measured) +
        ' · esperado: ' + JSON.stringify(r.expected) + (r.note ? ' · ' + r.note : ''));
    console.table(R.map(r => ({ id: r.id, status: r.status, note: r.note })));
    const ok = R.every(r => r.status !== 'FAIL');
    console.log('[uiProbe] ' + stage + ': ' + (ok ? 'PASS' : 'FAIL') + ' (' + R.filter(r => r.status === 'FAIL').length + ' falha(s))');
    return { stage, ok, results: R, snapshot: snap };
  }

  window.uiProbe = { load, run };
  console.info('[uiProbe] carregado — await uiProbe.load(<vídeo>); await uiProbe.run("E0"…"E3b" | "B2" | "B3" | "B5")');
})();
