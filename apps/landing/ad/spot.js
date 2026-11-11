/* LeadFlow TV spot (9:16, ~15s): one idea. Engine and audio are copied from vertical.js. */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'en' ? 'en' : 'he';
const RTL = LANG === 'he';
const DUR = 15;
const K = Number(params.get('k') ?? 1.1);
const $ = (id) => document.getElementById(id);
const TX = {
  he: {
    c1: 'לקוח כתב.',
    c2: 'מישהו ענה?',
    c3: 'LeadFlow ענה.',
    b1t: 'היי, אפשר תור למחר?',
    no: 'לא.',
    clk: ['עברו 10 דקות', 'עברה שעה', 'עברו 3 שעות'],
    fastt: 'תוך 3 שניות',
    b2t: 'היי! כאן סלון שירן 💇‍♀️ מתי נוח לך?',
    ok: 'קבענו לך תור<br />למחר ב־09:00 ✅',
    f2: 'כל ליד נתפס.',
    cta: 'נסו בחינם',
  },
  en: {
    c1: 'A customer wrote.',
    c2: 'Did anyone reply?',
    c3: 'LeadFlow did.',
    b1t: 'Hi, can I book tomorrow?',
    no: 'No.',
    clk: ['10 minutes later', '1 hour later', '3 hours later'],
    fastt: 'In 3 seconds',
    b2t: 'Hi! Shiran Salon here 💇‍♀️ When suits you?',
    ok: 'You’re booked for<br />tomorrow at 09:00 ✅',
    f2: 'Every lead, caught.',
    cta: 'Try it free',
  },
}[LANG];
document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';
for (const id of ['c1', 'c2', 'c3', 'b1t', 'no', 'fastt', 'b2t', 'ok', 'f2', 'cta'])
  $(id).innerHTML = TX[id];
$('clkt').textContent = TX.clk[0];

/* ---------- timeline engine ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const EASE = {
  out: (p) => 1 - Math.pow(1 - p, 4),
  io: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
  back: (p) => {
    const c = 1.9;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  },
  lin: (p) => p,
};
const tracks = [];
const fns = [];
const SFX = [];
const sfx = (t, type, arg) => SFX.push({ t, type, arg });
const tw = (id, prop, t0, t1, from, to, ease = 'out') =>
  tracks.push({
    el: typeof id === 'string' ? $(id) : id,
    prop,
    t0,
    t1,
    from,
    to,
    ease: EASE[ease],
  });
const fn = (t0, t1, f, ease = 'lin') => fns.push({ t0, t1, f, ease: EASE[ease] });
const pop = (id, t0, d = 0.5, rise = 60) => {
  tw(id, 'o', t0, t0 + d * 0.5, 0, 1);
  tw(id, 'y', t0, t0 + d, rise, 0, 'back');
  tw(id, 's', t0, t0 + d, 0.9, 1, 'back');
};

const W = [4, 8, 12];
tw('s1', 'o', 0, 0.001, 1, 1, 'lin');
tw('s2', 'o', 12, 12.001, 0, 1, 'lin');
tw('s1', 'o', 12, 12.001, 1, 0, 'lin');
tw('wipe', 'y', 11.68, 12, 1920, 0, 'io');
tw('wipe', 'y', 12, 12.32, 0, -1920, 'io');
sfx(11.6, 'whoosh');
sfx(12, 'thud');

// 1: a customer wrote
pop('c1', 0.3, 0.5, 90);
sfx(0.3, 'pop2');
pop('b1', 0.9, 0.55, 150);
sfx(0.9, 'buzz');
sfx(0.95, 'pop');
tw('c1', 'o', 3.6, 3.9, 1, 0);

// 2: did anyone reply?
pop('c2', 4.0, 0.5, 90);
sfx(4.0, 'pop2');
pop('clk', 4.6, 0.45, 70);
sfx(4.6, 'tick');
fn(5.5, 5.51, (p) => ($('clkt').textContent = TX.clk[p > 0.5 ? 1 : 0]), 'lin');
fn(6.4, 6.41, (p) => ($('clkt').textContent = TX.clk[p > 0.5 ? 2 : 1]), 'lin');
sfx(5.5, 'tick');
sfx(6.4, 'tick');
tw('dim', 'o', 4.0, 5.5, 0, 0.55, 'lin');
pop('no', 7.0, 0.4, 90);
sfx(7.0, 'thud');
tw('c2', 'o', 7.8, 8.0, 1, 0);
tw('clk', 'o', 7.8, 8.0, 1, 0);
tw('no', 'o', 7.8, 8.0, 1, 0);
tw('dim', 'o', 7.8, 8.2, 0.55, 0);

// 3: LeadFlow answered
pop('c3', 8.2, 0.5, 90);
sfx(8.2, 'chime');
pop('fast', 8.9, 0.45, 70);
sfx(8.9, 'pop2');
pop('b2', 9.5, 0.5, 120);
sfx(9.5, 'pop');
pop('ok', 10.5, 0.55, 140);
sfx(10.5, 'chime');

// 4: logo
tw('app6', 's', 12.2, 12.9, 0.5, 1, 'back');
tw('app6', 'o', 12.2, 12.5, 0, 1);
sfx(12.25, 'sparkle');
pop('f1', 12.55, 0.55, 80);
pop('f2', 13.0, 0.55, 80);
pop('cta', 13.5, 0.55, 80);
sfx(13.5, 'chime');
tw('url', 'o', 14.0, 14.5, 0, 1);

const DEF = { o: 1, x: 0, y: 0, s: 1 };
function drawAt(t) {
  const byEl = new Map();
  for (const tr of tracks) {
    if (!byEl.has(tr.el)) byEl.set(tr.el, {});
    (byEl.get(tr.el)[tr.prop] ??= []).push(tr);
  }
  for (const [el, props] of byEl) {
    const st = { ...DEF };
    for (const [prop, list] of Object.entries(props)) {
      list.sort((a, b) => a.t0 - b.t0);
      let val = list[0].from;
      for (const tr of list)
        if (t >= tr.t0) {
          const p = clamp((t - tr.t0) / (tr.t1 - tr.t0));
          val = tr.from + (tr.to - tr.from) * tr.ease(p);
        }
      st[prop] = val;
    }
    el.style.opacity = st.o;
    el.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.s})`;
  }
  for (const f of fns) {
    if (t >= f.t0 - 1e-4 && t <= f.t1 + 1e-4) f.f(f.ease(clamp((t - f.t0) / (f.t1 - f.t0))));
    else f.f(t > f.t1 ? 1 : 0);
  }
}
window.render = (t) => drawAt(t / K);
window.DURATION = DUR * K;
drawAt(0);

/* ---------- soundtrack: synthesized in the page with an OfflineAudioContext ---------- */
window.audioWav = async function audioWav() {
  const SR = 44100;
  const D = DUR * K;
  const ctx = new OfflineAudioContext(2, Math.round(SR * D), SR);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);
  master.gain.setValueAtTime(0.85, D - 1.6);
  master.gain.linearRampToValueAtTime(0.0001, D - 0.05);
  const music = ctx.createGain();
  music.gain.value = 0.55;
  music.connect(master);
  const fx = ctx.createGain();
  fx.gain.value = 0.9;
  fx.connect(master);
  // a little room: a short, dark reverb on the music and the effects
  const irLen = Math.floor(SR * 1.4);
  const ir = ctx.createBuffer(2, irLen, SR);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const verbG = ctx.createGain();
  verbG.gain.value = 0.22;
  verb.connect(verbG);
  verbG.connect(master);
  music.connect(verb);
  fx.connect(verb);
  const noiseBuf = ctx.createBuffer(1, SR * 2, SR);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const env = (g, t0, a, peak, d, end = 0.0001) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(end, t0 + a + d);
  };
  const osc = (type, f, t0, t1, dest, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(t0);
    o.stop(t1);
    o.connect(dest);
    return o;
  };
  const noise = (t0, t1, dest) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.start(t0, Math.random());
    n.stop(t1);
    n.connect(dest);
    return n;
  };

  const BPM = 108 / K,
    beat = 60 / BPM,
    bar = beat * 4,
    G = W[0] * K;
  const CH = [
    [57, 60, 64, 45],
    [53, 57, 60, 41],
    [55, 60, 64, 48],
    [55, 59, 62, 43],
  ]; // Am F C G
  // hook: a low drone and a riser into the first wipe, then a boom
  {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(0.32, G - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, G + 0.6);
    g.connect(music);
    osc('sine', 55, 0, G + 0.7, g);
    osc('sine', 110.4, 0, G + 0.7, g);
  }
  // music bed
  for (let b = 0; G + b * bar < D; b++) {
    const t0 = G + b * bar;
    const c = CH[b % 4];
    const end = Math.min(t0 + bar + 0.4, D);
    const pg = ctx.createGain();
    env(pg, t0, 0.3, 0.16, bar - 0.2);
    pg.gain.setValueAtTime(0.16, t0 + bar - 0.05);
    pg.gain.linearRampToValueAtTime(0.0001, end);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.6;
    lp.connect(music);
    pg.connect(lp);
    for (const n of c.slice(0, 3)) {
      for (const d of [-9, 0, 9]) osc('sawtooth', midi(n), t0, end, pg, d);
    }
    const bg = ctx.createGain();
    bg.connect(music);
    for (const off of [0, 2.5 * beat]) {
      const tb = t0 + off;
      const g2 = ctx.createGain();
      env(g2, tb, 0.01, 0.55, 0.42);
      g2.connect(music);
      osc('sine', midi(c[3]), tb, tb + 0.6, g2);
      osc('triangle', midi(c[3] + 12), tb, tb + 0.4, g2);
    }
    for (let k = 0; k < 4; k++) {
      // kick
      const tk = t0 + k * beat;
      if (tk > D - 0.8) continue;
      const g3 = ctx.createGain();
      env(g3, tk, 0.004, 0.85, 0.26);
      g3.connect(music);
      const o = osc('sine', 130, tk, tk + 0.3, g3);
      o.frequency.setValueAtTime(130, tk);
      o.frequency.exponentialRampToValueAtTime(42, tk + 0.2);
    }
    if (b >= 1)
      for (let k = 0; k < 8; k++) {
        // hats on the off-beats, arpeggio on the eighths
        const th = t0 + (k * beat) / 2;
        if (th > D - 0.8) continue;
        if (k % 2 === 1) {
          const hg = ctx.createGain();
          env(hg, th, 0.002, 0.2, 0.05);
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 7500;
          hp.connect(music);
          hg.connect(hp);
          noise(th, th + 0.08, hg);
        }
        const pat = [0, 1, 2, 1, 0, 2, 1, 2][k];
        const ag = ctx.createGain();
        env(ag, th, 0.004, 0.11, 0.32);
        ag.connect(music);
        osc('triangle', midi(c[pat] + 12), th, th + 0.4, ag);
      }
  }
  // sound effects, at the same times as the pictures
  const sound = {
    buzz(t) {
      const g = ctx.createGain();
      env(g, t, 0.005, 0.32, 0.3);
      g.connect(fx);
      osc('sawtooth', 92, t, t + 0.34, g);
      osc('sawtooth', 98, t, t + 0.34, g);
    },
    snip(t) {
      const g = ctx.createGain();
      env(g, t, 0.001, 0.2, 0.05);
      g.connect(fx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5500;
      hp.connect(g);
      noise(t, t + 0.07, hp);
    },
    pop(t) {
      const g = ctx.createGain();
      env(g, t, 0.003, 0.3, 0.12);
      g.connect(fx);
      const o = osc('sine', 980, t, t + 0.16, g);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.1);
    },
    pop2(t) {
      const g = ctx.createGain();
      env(g, t, 0.003, 0.22, 0.16);
      g.connect(fx);
      const o = osc('triangle', 660, t, t + 0.2, g);
      o.frequency.exponentialRampToValueAtTime(1180, t + 0.12);
    },
    tick(t) {
      const g = ctx.createGain();
      env(g, t, 0.001, 0.28, 0.06);
      g.connect(fx);
      osc('square', 1400, t, t + 0.08, g);
    },
    thud(t) {
      const g = ctx.createGain();
      env(g, t, 0.004, 0.9, 0.45);
      g.connect(fx);
      const o = osc('sine', 100, t, t + 0.5, g);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.4);
      const ng = ctx.createGain();
      env(ng, t, 0.002, 0.25, 0.12);
      ng.connect(fx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(ng);
      noise(t, t + 0.2, lp);
    },
    whoosh(t) {
      const d = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.42, t + d * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
      g.connect(fx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + d);
      bp.connect(g);
      noise(t, t + d + 0.15, bp);
    },
    chime(t) {
      for (const [f, v] of [
        [880, 0.22],
        [1318.5, 0.16],
        [1760, 0.1],
      ]) {
        const g = ctx.createGain();
        env(g, t, 0.004, v, 1.1);
        g.connect(fx);
        osc('sine', f, t, t + 1.3, g);
      }
    },
    sparkle(t) {
      [1318.5, 1568, 1975.5, 2637].forEach((f, i) => {
        const tt = t + i * 0.075;
        const g = ctx.createGain();
        env(g, tt, 0.003, 0.16, 0.5);
        g.connect(fx);
        osc('sine', f, tt, tt + 0.6, g);
      });
    },
    riser(t, end) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, end);
      g.gain.linearRampToValueAtTime(0.0001, end + 0.05);
      g.connect(fx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(7000, end);
      bp.connect(g);
      noise(t, end + 0.1, bp);
    },
  };
  for (const e of SFX)
    if (e.t * K < D - 0.3) sound[e.type](e.t * K, e.arg === undefined ? undefined : e.arg * K);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0),
    R = buf.getChannelData(1);
  const n = L.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const wr = (o, s) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  wr(0, 'RIFF');
  out.setUint32(4, 36 + n * 4, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, SR, true);
  out.setUint32(28, SR * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  wr(36, 'data');
  out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
