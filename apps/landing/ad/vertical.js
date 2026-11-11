/* LeadFlow vertical ad (9:16): a pure function of time, `window.render(t)`, plus a synthesized soundtrack, `window.audioWav()`. */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'en' ? 'en' : 'he';
const RTL = LANG === 'he';
const DUR = 22.5;
// A calmer pace: the whole timeline, its motions and its music are stretched by this factor.
const K = Number(params.get('k') ?? 1.4);
const $ = (id) => document.getElementById(id);

const TX = {
  he: {
    n1: 'לקוח חדש',
    n2: 'היי, אפשר תור להיום?',
    h1: 'לקוח כתב לכם.',
    h2: 'לא הספקתם לענות.',
    h3: 'הוא כבר אצל המתחרה.',
    c2: 'המערכת <span class="brandc">עונה בשבילכם.</span>',
    c3: 'ומקבעת <span class="brandc">תור לבד.</span>',
    c4: 'והכול <span class="brandc">במקום אחד.</span>',
    c5: 'ורואים <span class="brandc">מה עובד.</span>',
    stText: 'במפגש עד 18:00',
    phName: 'סלון שירן',
    phSub: 'עסק',
    m1t: 'היי, אפשר תור להיום?',
    m2t: 'היי! כאן סלון שירן 💇‍♀️ אנחנו במפגש עד 18:00 וחוזרים אליכם בהקדם.',
    m3t: 'בינתיים, הציצו בעבודות שלנו 👇',
    m3l: 'הצצה לעבודות שלנו ↗',
    m4t: 'רוצים לקבוע תור?',
    m4b: '📅 לקביעת תור',
    phName3: 'סלון שירן',
    phSub3: 'עסק',
    q1t: 'מתי נוח לכם?',
    tm1: 'מחר ב־09:00',
    tm2: 'מחר ב־10:30',
    tm3: 'היום ב־18:30',
    q3t: 'מחר ב־09:00',
    q4t: 'קבענו לכם תור למחר ב־09:00 ✅',
    ta1: 'תור חדש ביומן',
    ta2: 'דנה כהן · מחר ב־09:00',
    tb1: 'ליד חדש נוצר',
    tb2: 'דנה כהן · מוואטסאפ',
    cAt: 'תיבת שיחות',
    cA1: 'דנה כהן',
    cA1s: 'אפשר תור להיום?',
    cA2: 'יוסי לוי',
    cA2s: 'כמה עולה צבע?',
    cA3: 'מיכל אברהם',
    cA3s: 'הצעת מחיר לאירוע',
    cAnew: 'חדש',
    cBt: 'משימות להיום',
    tk1t: 'להתקשר לדנה כהן',
    tk1s: 'תזכורת לפני התור',
    tk2t: 'לשלוח הצעת מחיר',
    tk2s: 'אירוע בחולון',
    cCt: 'לקוחות',
    cC1: 'דנה כהן',
    cC1s: 'תור מחר ב־09:00',
    cCp: 'ליד',
    cC2: 'רון שמש',
    cC2s: 'קנה · ₪2,400',
    cCq: 'לקוח',
    av1: 'ד',
    av2: 'ר',
    k1l: 'פניות חדשות',
    k2l: 'תורים',
    k3l: 'נסגרו',
    site: 'האתר',
    google: 'גוגל',
    fb: 'פייסבוק',
    f2: 'מנהלים את כל העסק<br />במקום אחד.',
    cta: 'התחילו עכשיו',
  },
  en: {
    n1: 'New customer',
    n2: 'Hi, can I book today?',
    h1: 'A customer wrote.',
    h2: 'You couldn’t reply.',
    h3: 'Now they’re at a competitor.',
    c2: 'The system <span class="brandc">answers for you.</span>',
    c3: 'And books <span class="brandc">the appointment.</span>',
    c4: 'All in <span class="brandc">one place.</span>',
    c5: 'See <span class="brandc">what works.</span>',
    stText: 'In a session until 6 pm',
    phName: 'Shiran Salon',
    phSub: 'Business',
    m1t: 'Hi, can I book today?',
    m2t: 'Hi! Shiran Salon here 💇‍♀️ We’re in a session until 6 pm and will get back to you shortly.',
    m3t: 'Meanwhile, take a look at our work 👇',
    m3l: 'A peek at our work ↗',
    m4t: 'Want to book an appointment?',
    m4b: '📅 Book an appointment',
    phName3: 'Shiran Salon',
    phSub3: 'Business',
    q1t: 'When suits you?',
    tm1: 'Tomorrow at 09:00',
    tm2: 'Tomorrow at 10:30',
    tm3: 'Today at 18:30',
    q3t: 'Tomorrow at 09:00',
    q4t: 'You’re booked for tomorrow at 09:00 ✅',
    ta1: 'New appointment',
    ta2: 'Dana Cohen · tomorrow at 09:00',
    tb1: 'New lead created',
    tb2: 'Dana Cohen · from WhatsApp',
    cAt: 'Inbox',
    cA1: 'Dana Cohen',
    cA1s: 'Can I book today?',
    cA2: 'Yossi Levi',
    cA2s: 'How much is a colour?',
    cA3: 'Michal Avraham',
    cA3s: 'A quote for an event',
    cAnew: 'New',
    cBt: 'Today’s tasks',
    tk1t: 'Call Dana Cohen',
    tk1s: 'Reminder before the appointment',
    tk2t: 'Send a quote',
    tk2s: 'Event in Holon',
    cCt: 'Customers',
    cC1: 'Dana Cohen',
    cC1s: 'Appointment tomorrow 09:00',
    cCp: 'Lead',
    cC2: 'Ron Shemesh',
    cC2s: 'Bought · ₪2,400',
    cCq: 'Customer',
    av1: 'D',
    av2: 'R',
    k1l: 'New inquiries',
    k2l: 'Appointments',
    k3l: 'Closed',
    site: 'Website',
    google: 'Google',
    fb: 'Facebook',
    f2: 'Run your whole business<br />in one place.',
    cta: 'Get started',
  },
}[LANG];
document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';
for (const [k, v] of Object.entries(TX)) {
  const el = $(k);
  if (el) el.innerHTML = v;
}
$('cta').textContent = TX.cta;
if (!RTL) for (const id of ['status']) $(id).style.left = '190px';

// captions: one span per word, so they can come in word by word
function words(id) {
  const el = $(id);
  const out = [];
  const make = (txt, cls) =>
    txt
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => {
        const s = document.createElement('span');
        s.className = 'w ' + (cls || '');
        s.textContent = w;
        return s;
      });
  const frag = document.createDocumentFragment();
  for (const n of [...el.childNodes]) {
    const list = n.nodeType === 3 ? make(n.textContent) : make(n.textContent, n.className);
    for (const s of list) {
      frag.appendChild(s);
      frag.appendChild(document.createTextNode(' '));
      out.push(s);
    }
  }
  el.innerHTML = '';
  el.appendChild(frag);
  return out;
}
const caps = { c2: words('c2'), c3: words('c3'), c4: words('c4'), c5: words('c5') };

// bars
const bars = [
  [TX.site, 78, 9],
  ['WhatsApp', 62, 7],
  [TX.fb, 40, 5],
  [TX.google, 28, 3],
];
$('bars').innerHTML = bars
  .map(
    ([l, w, n]) =>
      `<div class="bar2"><span>${l}</span><div class="track"><div class="fill" style="--w:${w}%"></div></div><em>${n}</em></div>`,
  )
  .join('');

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
const capIn = (key, t0) => {
  caps[key].forEach((w, i) => {
    tw(w, 'o', t0 + i * 0.09, t0 + i * 0.09 + 0.3, 0, 1);
    tw(w, 'y', t0 + i * 0.09, t0 + i * 0.09 + 0.5, 50, 0, 'back');
  });
  sfx(t0, 'pop2');
};

const W = [3.05, 8.75, 12.95, 16.25, 18.95]; // the wipe covers the screen here: scenes swap
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
W.forEach((w) => {
  tw('wipe', 'y', w - 0.32, w, 1920, 0, 'io');
  tw('wipe', 'y', w, w + 0.32, 0, -1920, 'io');
  sfx(w - 0.4, 'whoosh');
  sfx(w, 'thud');
});

// 1: the hook
tw('notif', 'y', 0.1, 0.6, -420, 0, 'back');
sfx(0.15, 'pop');
tw('badge', 's', 0.5, 0.8, 0, 1, 'back');
sfx(0.55, 'pop2');
pop('h1', 0.75, 0.45, 70);
sfx(0.75, 'pop');
pop('h2', 1.3, 0.45, 70);
sfx(1.3, 'pop');
pop('h3', 1.9, 0.55, 90);
sfx(1.9, 'pop2');
tw('notif', 'o', 1.9, 2.4, 1, 0.25);
sfx(0.2, 'riser', 2.85);

// 2: it answers
capIn('c2', 3.2);
pop('status', 3.75, 0.5, 50);
fn(
  4.15,
  4.5,
  (p) => {
    const on = p > 0.5;
    $('sw').style.background = on ? '#16a34a' : '#cbd5e1';
    $('swk').style.transform = on ? `translateX(${RTL ? -40 : 40}px)` : 'none';
  },
  'out',
);
sfx(4.2, 'tick');
tw('phone2', 'o', 3.5, 3.9, 0, 1);
tw('phone2', 'y', 3.5, 4.2, 320, 0, 'back');
msgIn('m1', 4.7);
msgIn('m2', 5.4);
msgIn('m3', 6.3, 0.5);
msgIn('m4', 7.3);
fn(
  7.9,
  8.5,
  (p) => {
    $('m4b').style.transform = `scale(${1 + 0.06 * Math.sin(p * Math.PI)})`;
  },
  'lin',
);
tw('cam2', 's', 3.2, 8.75, 1, 1.05, 'lin');

// 3: it books
capIn('c3', 8.9);
tw('phone3', 'o', 9.1, 9.4, 0, 1);
tw('phone3', 'y', 9.1, 9.8, 320, 0, 'back');
msgIn('q1', 9.7);
msgIn('q2', 10.2, 0.45);
fn(0, 1, () => {
  const r = $('tm1').getBoundingClientRect();
  const t = $('tap');
  t.style.left = r.left + r.width * 0.55 - 60 + 'px';
  t.style.top = r.top + r.height / 2 - 60 + 'px';
});
fn(
  10.9,
  11.4,
  (p) => {
    const t = $('tap');
    t.style.opacity = String(Math.sin(p * Math.PI) * 0.9);
    t.style.transform = `scale(${0.6 + p * 0.7})`;
    $('tm1').style.background = p > 0.35 ? '#eff6ff' : 'transparent';
  },
  'lin',
);
sfx(11.05, 'tick');
msgIn('q3', 11.45, 0.35);
msgIn('q4', 11.85, 0.4, false);
sfx(11.9, 'chime');
pop('toastA', 12.15, 0.45, 50);
sfx(12.15, 'pop');
pop('toastB', 12.45, 0.45, 50);
sfx(12.45, 'pop2');
tw('cam3', 's', 8.9, 12.95, 1, 1.04, 'lin');

// 4: all in one place
capIn('c4', 13.1);
pop('cardA', 13.45, 0.55, 140);
sfx(13.45, 'pop');
pop('cardB', 13.85, 0.55, 140);
sfx(13.85, 'pop');
pop('cardC', 14.25, 0.55, 140);
sfx(14.25, 'pop');
fn(
  14.95,
  15.3,
  (p) => {
    const b = $('bx1');
    b.style.background = p > 0.4 ? '#16a34a' : 'transparent';
    b.style.borderColor = p > 0.4 ? '#16a34a' : '#cbd5e1';
    b.textContent = p > 0.4 ? '✓' : '';
    $('tk1t').style.textDecoration = p > 0.6 ? 'line-through' : 'none';
    $('tk1t').style.color = p > 0.6 ? '#94a3b8' : '#0f172a';
  },
  'out',
);
sfx(15.05, 'tick');
tw('cam4', 's', 13.1, 16.25, 1.03, 1, 'lin');

// 5: reports
capIn('c5', 16.4);
pop('k1', 16.75, 0.5, 70);
pop('k2', 16.9, 0.5, 70);
pop('k3', 17.05, 0.5, 70);
sfx(16.8, 'pop');
sfx(16.95, 'pop');
sfx(17.1, 'pop');
[
  ['k1v', 24],
  ['k2v', 11],
  ['k3v', 7],
].forEach(([id, n], i) =>
  fn(
    16.85 + i * 0.15,
    17.9 + i * 0.15,
    (p) => {
      $(id).textContent = Math.round(n * p);
    },
    'out',
  ),
);
pop('barsbox', 17.25, 0.55, 110);
sfx(17.3, 'pop');
[...document.querySelectorAll('.fill')].forEach((el, i) =>
  fn(
    17.6 + i * 0.15,
    18.5 + i * 0.15,
    (p) => {
      el.style.width = `calc(var(--w) * ${p})`;
    },
    'out',
  ),
);

// 6: call to action
tw('app6', 's', 19.1, 19.8, 0.5, 1, 'back');
tw('app6', 'o', 19.1, 19.4, 0, 1);
sfx(19.15, 'sparkle');
pop('f1', 19.45, 0.55, 80);
pop('f2', 19.8, 0.55, 80);
pop('cta', 20.2, 0.55, 80);
sfx(20.2, 'chime');
tw('url', 'o', 20.7, 21.2, 0, 1);
fn(
  21.2,
  22.5,
  (p) => {
    const s = 1 + 0.045 * Math.sin(p * Math.PI * 2);
    $('cta').style.transform = `scale(${s})`;
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
