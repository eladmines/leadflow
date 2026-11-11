/* LeadFlow story ad (9:16): "a day in the life of a business owner". A pure function of time,
   `window.render(t)`, plus a synthesized soundtrack, `window.audioWav()`.
   Generated pieces: see build-story.mjs (engine and audio are shared with vertical.js). */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'en' ? 'en' : 'he';
const RTL = LANG === 'he';
const DUR = 28;
const K = Number(params.get('k') ?? 1.15);
const $ = (id) => document.getElementById(id);

const TX = {
  he: {
    t1: 'שלוש בצהריים.',
    h1: '14 הודעות שלא נענו.',
    pbt: 'הודעה חדשה',
    h2: 'וואטסאפ. אינסטגרם.<br />מייל. פייסבוק.',
    h2b: 'ואף אחד לא עונה.',
    n: [
      ['דנה כהן', 'אפשר תור למחר?'],
      ['רון שמש', 'כמה עולה צבע?'],
      ['הצעת מחיר', 'לאירוע בחולון'],
      ['מיכל אברהם', 'יש מקום להיום?'],
    ],
    h3a: 'ואתה?',
    h3b: 'אתה באמצע עבודה.',
    h3c: 'ובינתיים, הלקוחות מחפשים<br />מישהו שיענה.',
    h4: 'אותו רגע.<br /><span class="brandc">הפעם LeadFlow עונה.</span>',
    chn: 'דנה כהן',
    m1: 'היי, אפשר תור למחר?',
    m2: 'היי! כאן סלון שירן 💇‍♀️ אשמח לעזור. מתי נוח לך?',
    tms: ['מחר ב־09:00', 'מחר ב־10:30', 'היום ב־18:30'],
    m4: 'מחר ב־09:00',
    m5: 'קבענו תור למחר ב־09:00 ✅',
    h5: 'בזמן שעבדת',
    ap: [
      ['דנה כהן', 'מחר 09:00'],
      ['יוסי לוי', 'מחר 10:30'],
      ['מיכל אברהם', 'מחר 12:00'],
      ['רון שמש', 'מחרתיים 09:30'],
      ['נועה בר', 'מחרתיים 11:00'],
    ],
    h5b: 'תורים חדשים נקבעו לבד.',
    f2: 'כל ליד נתפס.',
    cta: 'נסו בחינם',
  },
  en: {
    t1: 'Three in the afternoon.',
    h1: '14 messages unanswered.',
    pbt: 'New message',
    h2: 'WhatsApp. Instagram.<br />Email. Facebook.',
    h2b: 'And nobody replies.',
    n: [
      ['Dana Cohen', 'Can I book tomorrow?'],
      ['Ron Shemesh', 'How much is a colour?'],
      ['Quote request', 'Event in Holon'],
      ['Michal Avraham', 'Any room today?'],
    ],
    h3a: 'And you?',
    h3b: 'You’re mid-job.',
    h3c: 'Meanwhile, customers are looking<br />for someone who will answer.',
    h4: 'Same moment.<br /><span class="brandc">This time LeadFlow answers.</span>',
    chn: 'Dana Cohen',
    m1: 'Hi, can I book tomorrow?',
    m2: 'Hi! Shiran Salon here 💇‍♀️ Happy to help. When suits you?',
    tms: ['Tomorrow at 09:00', 'Tomorrow at 10:30', 'Today at 18:30'],
    m4: 'Tomorrow at 09:00',
    m5: 'You’re booked for tomorrow at 09:00 ✅',
    h5: 'While you were working',
    ap: [
      ['Dana Cohen', 'Tomorrow 09:00'],
      ['Yossi Levi', 'Tomorrow 10:30'],
      ['Michal Avraham', 'Tomorrow 12:00'],
      ['Ron Shemesh', 'Fri 09:30'],
      ['Noa Bar', 'Fri 11:00'],
    ],
    h5b: 'new appointments, booked automatically.',
    f2: 'Every lead, caught.',
    cta: 'Try it free',
  },
}[LANG];
document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';
for (const id of [
  't1',
  'h1',
  'pbt',
  'h2',
  'h2b',
  'h3a',
  'h3b',
  'h3c',
  'h4',
  'chn',
  'm1',
  'm2',
  'm4',
  'm5',
  'h5',
  'h5b',
  'f2',
  'cta',
])
  $(id).innerHTML = TX[id];
TX.tms.forEach((t, i) => (document.querySelectorAll('.slot')[i].textContent = t));
if (!RTL) $('h5b').textContent = '5 ' + TX.h5b;
else $('h5b').textContent = TX.h5b;
$('bign').dataset.n = '5';

const ICONS = [
  [
    '#25d366',
    '<path d="M12 3.6a8.4 8.4 0 0 0-7.2 12.7l-1.1 4.1 4.2-1.1A8.4 8.4 0 1 0 12 3.6z" stroke="#fff" stroke-width="1.8" fill="none"/><path fill="#fff" d="M9.2 8.4c.2-.5.5-.5.7-.5h.5c.2 0 .4 0 .5.4l.8 1.8c.1.2 0 .4-.1.6l-.4.5c-.1.2-.2.3-.1.5.5 1 1.6 2 2.8 2.5.2.1.4 0 .5-.1l.6-.8c.2-.2.4-.3.6-.1l1.8.9c.3.1.3.3.2.6-.1.8-.9 1.5-1.9 1.5-3.1-.3-6.3-3.4-6.4-6.4 0-.9.3-1.5.5-2z"/>',
  ],
  [
    'linear-gradient(45deg,#f9a03f,#e1306c,#8a3ab9)',
    '<rect x="4.5" y="4.5" width="15" height="15" rx="4.5" stroke="#fff" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="3.6" stroke="#fff" stroke-width="1.8" fill="none"/><circle cx="16.6" cy="7.4" r="1.1" fill="#fff"/>',
  ],
  [
    '#2563eb',
    '<rect x="4" y="6" width="16" height="12" rx="2.4" stroke="#fff" stroke-width="1.8" fill="none"/><path d="M4.8 7.6 12 13l7.2-5.4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  ],
  [
    '#1877f2',
    '<path d="M13.6 20v-6.4h2.2l.4-2.6h-2.6V9.4c0-.8.3-1.3 1.4-1.3h1.3V5.8c-.2 0-1-.1-1.9-.1-2 0-3.3 1.2-3.3 3.4V11H8.9v2.6h2.2V20z" fill="#fff"/>',
  ],
];
$('stack').innerHTML = TX.n
  .map(
    ([a, b], i) =>
      `<div class="nt" id="nt${i}"><div class="ic" style="background:${ICONS[i][0]}"><svg viewBox="0 0 24 24" width="52" height="52">${ICONS[i][1]}</svg></div><div><b>${a}</b><span>${b}</span></div></div>`,
  )
  .join('');
$('appts').innerHTML = TX.ap
  .map(
    ([a, b], i) =>
      `<div class="appt" id="ap${i}" style="top:${760 + i * 168}px"><span class="ck">✓</span>${a}<em>${b}</em></div>`,
  )
  .join('');

// falling hair
const HAIR = Array.from({ length: 16 }, (_, i) => {
  const el = document.createElement('div');
  el.className = 'abs';
  const s = 8 + ((i * 7) % 9);
  el.style.cssText = `width:${s}px;height:${s * 5}px;border-radius:6px;background:#${i % 3 ? 'e2e8f0' : 'c4b5fd'};left:0;top:0`;
  $('hair').appendChild(el);
  return { el, x: 380 + ((i * 53) % 330), ph: (i * 0.37) % 1, a: ((i * 41) % 70) - 35 };
});

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
const msgIn = (id, t0, d = 0.4, sound = true) => {
  fn(
    t0,
    t0 + d,
    (p) => {
      const el = $(id);
      el.style.maxHeight = p * (el.scrollHeight + 6) + 'px';
      el.style.opacity = String(clamp(p * 1.8));
    },
    'out',
  );
  if (sound) sfx(t0, 'pop');
};

const W = [4.0, 8.6, 11.6, 18.6, 23.6]; // the wipe covers the screen here: scenes swap
const SC = [
  ['s1', 0, W[0]],
  ['s2', W[0], W[1]],
  ['s3', W[1], W[2]],
  ['s4', W[2], W[3]],
  ['s5', W[3], W[4]],
  ['s6', W[4], DUR + 1],
];
SC.forEach(([id, a, b], i) => {
  tw(id, 'o', a, a + 0.001, i === 0 ? 1 : 0, 1, 'lin');
  if (i < SC.length - 1) tw(id, 'o', b, b + 0.001, 1, 0, 'lin');
});
W.forEach((w, i) => {
  tw('wipe', 'y', w - 0.32, w, 1920, 0, 'io');
  tw('wipe', 'y', w, w + 0.32, 0, -1920, 'io');
  sfx(w - 0.4, 'whoosh');
  if (i !== 1) sfx(w, 'thud');
});

// 1: three in the afternoon: scissors, hair, a phone that won't stop
pop('t1', 0.2, 0.5, 50);
sfx(0.2, 'pop');
fn(0, 4, (p) => {
  const t = p * 4;
  const a = 3 + 15 * Math.abs(Math.sin(t * 7.5));
  $('blA').setAttribute('transform', `rotate(${a} 100 100)`);
  $('blB').setAttribute('transform', `rotate(${-a} 100 100)`);
  for (const h of HAIR) {
    const q = (t * 0.55 + h.ph) % 1;
    h.el.style.opacity = String(Math.sin(q * Math.PI));
    h.el.style.transform = `translate(${h.x + Math.sin(q * 6 + h.ph * 9) * 40}px, ${620 + q * 330}px) rotate(${h.a + q * 160}deg)`;
  }
  const buzz = (Math.sin(t * 60) * 7 * (Math.sin(t * 9) > 0.1 ? 1 : 0.1)) | 0;
  $('pb').style.transform =
    `translate(${buzz}px, ${p < 0.05 ? 400 * (1 - p / 0.05) : 0}px) rotate(${buzz * 0.12}deg)`;
  $('cnt').textContent = String(
    Math.max(1, Math.round(14 * Math.pow(clamp((t - 0.6) / 2.6), 1.4))),
  );
});
for (let i = 0; i < 6; i++) sfx(0.6 + i * 0.55, 'buzz');
for (let i = 0; i < 7; i++) sfx(0.3 + i * 0.45, 'snip');
pop('h1', 2.3, 0.5, 80);
sfx(2.3, 'pop');
sfx(2.35, 'pop2');

// 2: the pile: four channels
pop('h2', 4.4, 0.5, 70);
sfx(4.4, 'pop2');
for (let i = 0; i < 4; i++) {
  pop('nt' + i, 5.0 + i * 0.5, 0.5, 120);
  sfx(5.0 + i * 0.5, 'buzz');
  sfx(5.05 + i * 0.5, 'pop');
}
pop('h2b', 7.3, 0.5, 80);
sfx(7.3, 'pop2');

// 3: and you?
pop('h3a', 8.8, 0.5, 90);
sfx(8.8, 'pop');
pop('h3b', 9.5, 0.55, 90);
sfx(9.5, 'pop');
pop('h3c', 10.4, 0.5, 60);
sfx(10.4, 'pop2');

// 4: the same moment, answered
pop('h4', 11.8, 0.6, 70);
sfx(11.8, 'pop2');
tw('ph4', 'o', 11.9, 12.3, 0, 1);
tw('ph4', 'y', 11.9, 12.7, 380, 0, 'back');
msgIn('m1', 13.0);
msgIn('m2', 14.2, 0.5);
msgIn('sl', 15.5, 0.55);
fn(0, 1, () => {
  const r = $('tm1').getBoundingClientRect();
  const t = $('tap');
  const host = $('ph4').getBoundingClientRect();
  t.style.left = r.left - host.left - 22 + r.width * 0.5 - 60 + 'px';
  t.style.top = r.top - host.top - 22 + r.height / 2 - 60 + 'px';
});
fn(
  16.6,
  17.1,
  (p) => {
    $('tap').style.opacity = String(Math.sin(p * Math.PI) * 0.9);
    $('tap').style.transform = `scale(${0.6 + p * 0.7})`;
    $('tm1').style.background = p > 0.35 ? '#dbeafe' : '#fff';
  },
  'lin',
);
sfx(16.75, 'tick');
msgIn('m4', 17.15, 0.35);
msgIn('m5', 17.7, 0.45, false);
sfx(17.75, 'chime');
tw('ph4', 's', 12.7, 18.6, 1, 1.04, 'lin');

// 5: while you were working
pop('h5', 19.0, 0.55, 70);
sfx(19.0, 'pop2');
fn(
  19.5,
  20.7,
  (p) => {
    $('bign').textContent = Math.round(5 * p);
  },
  'out',
);
for (let i = 0; i < 5; i++) {
  pop('ap' + i, 19.5 + i * 0.4, 0.5, 120);
  sfx(19.5 + i * 0.4, 'pop');
  sfx(19.7 + i * 0.4, 'tick');
}
pop('h5b', 21.9, 0.55, 80);
sfx(21.95, 'chime');

// 6: call to action
tw('app6', 's', 24.1, 24.8, 0.5, 1, 'back');
tw('app6', 'o', 24.1, 24.4, 0, 1);
sfx(24.15, 'sparkle');
pop('f1', 24.45, 0.55, 80);
pop('f2', 24.9, 0.55, 80);
pop('cta', 25.4, 0.55, 80);
sfx(25.4, 'chime');
tw('url', 'o', 25.9, 26.4, 0, 1);
fn(
  26.3,
  28,
  (p) => {
    $('cta').style.transform = `scale(${1 + 0.045 * Math.sin(p * Math.PI * 2)})`;
  },
  'lin',
);

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
