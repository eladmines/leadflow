/* LeadFlow "two endings" ad (9:16): the same WhatsApp chat twice, without and with LeadFlow.
   A pure function of time, `window.render(t)`, plus a synthesized soundtrack. Engine and audio are shared with vertical.js. */
const DUR = 43;
const K = 1.1;
const $ = (id) => document.getElementById(id);

/* ---------- timeline engine ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const EASE = {
  out: (p) => 1 - Math.pow(1 - p, 4),
  io: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
  back: (p) => {
    const c = 1.2;
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

EASE.soft = (p) => 1 - Math.pow(1 - p, 3);
// slow, gentle in-and-out for fades and camera drift
const rise = (id, t0, d = 0.8, dy = 36) => {
  tw(id, 'o', t0, t0 + d * 0.6, 0, 1, 'soft');
  tw(id, 'y', t0, t0 + d, dy, 0, 'soft');
};
const fade = (id, t0, d = 0.4) => tw(id, 'o', t0, t0 + d, 1, 0, 'soft');
const W = [11]; // the beat (and the music) starts when the second half does
const SWAP = 11;
const END = 37.9;

tw('s1', 'o', 0, 0.001, 1, 1, 'lin');
tw('s1', 'o', END, END + 0.001, 1, 0, 'lin');
tw('s2', 'o', END, END + 0.001, 0, 1, 'lin');
for (const w of [END]) {
  tw('wipe', 'y', w - 0.45, w, 1920, 0, 'io');
  tw('wipe', 'y', w, w + 0.45, 0, -1920, 'io');
  sfx(w - 0.55, 'whoosh');
  sfx(w, 'thud');
}

// typing: the text appears letter by letter, the bubble keeps its final size, the header says "typing…"
const typed = (id, t0, t1, bar) => {
  const el = $(id);
  const full = Array.from(el.firstChild.textContent);
  const a = document.createElement('span');
  const b = document.createElement('span');
  b.style.color = 'transparent';
  b.textContent = full.join('');
  el.replaceChild(b, el.firstChild);
  el.insertBefore(a, b);
  const sub = document.querySelector('#' + bar + ' small');
  const idle = sub.textContent;
  fn(
    t0,
    t1,
    (p) => {
      const n = Math.round(full.length * p);
      a.textContent = full.slice(0, n).join('');
      b.textContent = full.slice(n).join('');
    },
    'lin',
  );
  fn(
    t0 - 0.5,
    t1 + 0.3,
    (p) => {
      const on = p > 0 && p < 1;
      sub.textContent = on ? 'מקליד…' : idle;
      sub.style.color = on ? '#16a34a' : '';
    },
    'lin',
  );
  for (let t = t0; t < t1; t += 0.22) sfx(t, 'tick');
};

// ---------- part A: without LeadFlow (cold, quiet); the owner's phone ----------
rise('ph', 0.3, 1.1, 120);
tw('ph', 's', 0.3, 11, 0.98, 1.03, 'lin');
msgIn('a1', 0.9, 0.4, false);
typed('a1', 1.1, 2.1, 'barA');
msgIn('a1m', 2.4, 0.5, false);
tw('clk', 'o', 2.2, 2.8, 0, 1, 'soft');
tw('clk', 'y', 2.2, 2.8, 40, 0, 'soft');
document.getElementById('ticks').innerHTML = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  const r1 = i % 3 ? 41 : 38;
  return `<line x1="${50 + 44 * Math.sin(a)}" y1="${50 - 44 * Math.sin(Math.PI / 2 - a)}" x2="${50 + r1 * Math.sin(a)}" y2="${50 - r1 * Math.sin(Math.PI / 2 - a)}" stroke-width="${i % 3 ? 1.6 : 3}"/>`;
}).join('');
fn(
  2.8,
  5.0,
  (p) => {
    const m = 1142 + (1300 - 1142) * p;
    $('hh').setAttribute('transform', `rotate(${((m / 60) % 12) * 30} 50 50)`);
    $('hm').setAttribute('transform', `rotate(${(m % 60) * 6} 50 50)`);
    // the second hand jumps once per tick, like a real clock
    $('hs').setAttribute('transform', `rotate(${Math.floor((p * 2.2) / 0.4) * 30} 50 50)`);
  },
  'io',
);
for (let i = 0; i < 6; i++) sfx(2.8 + i * 0.4, 'tick');
fade('a1m', 5.1, 0.4);
fade('clk', 5.1, 0.5);
msgIn('aR', 5.1, 0.6);
msgIn('a2', 5.9, 0.4, false);
typed('a2', 6.0, 7.0, 'barA');
sfx(7.05, 'thud');

// the owner installs LeadFlow
tw('inst', 'o', 8.1, 8.6, 0, 1, 'soft');
tw('icn', 's', 8.1, 8.8, 0.5, 1, 'back');
sfx(8.2, 'pop2');
fn(
  8.8,
  9.9,
  (p) => {
    $('instF').style.width = p * 100 + '%';
  },
  'io',
);
for (let i = 0; i < 5; i++) sfx(8.85 + i * 0.22, 'tick');
fn(
  9.9,
  9.91,
  (p) => {
    $('instT').textContent = p > 0.5 ? 'הותקן ✓' : 'מתקין…';
    $('instT').style.color = p > 0.5 ? '#16a34a' : '#475569';
  },
  'lin',
);
sfx(9.95, 'chime');
tw('icn', 's', 10.2, 10.8, 1, 1.35, 'soft');
tw('inst', 'o', 10.4, 11.0, 1, 0, 'soft');
sfx(10.3, 'sparkle');

// the second half arrives: the colours warm up under the closing install screen
tw('bgA', 'o', 10.3, 11.0, 1, 0, 'lin');
tw('bgB', 'o', 10.3, 11.0, 0, 1, 'lin');
tw('chatA', 'o', 10.3, 10.31, 1, 0, 'lin');
tw('barB', 'o', 10.3, 10.31, 0, 1, 'lin');
tw('chatB', 'o', 10.3, 10.31, 0, 1, 'lin');
fn(
  8.1,
  9.0,
  (p) => {
    $('ph').style.filter = `saturate(${0.2 + 0.8 * p})`;
  },
  'lin',
);

// ---------- part B: with LeadFlow (warm, alive): the helper works, and says what it does ----------
tw('ph', 's', SWAP, 24.7, 1.0, 1.04, 'lin');
msgIn('b1', 11.4, 0.4, false);
typed('b1', 11.6, 12.5, 'barB');
const helperClone = (prefix, size, host, mirror) => {
  const c = $('hlp').querySelector('svg').cloneNode(true);
  c.querySelectorAll('[id]').forEach((e) => (e.id = prefix + e.id));
  c.setAttribute('width', size);
  c.setAttribute('height', size);
  c.style.cssText = 'overflow:visible' + (mirror ? ';transform:scaleX(-1)' : '');
  host.appendChild(c);
};
helperClone('i_', 250, $('ihost'), false);
helperClone('c_', 84, $('chlp'), true);
// the agent introduces itself, then settles into the reply box
pop('intro', 12.7, 0.8, 80);
sfx(12.75, 'sparkle');
tw('intro', 'x', 14.0, 14.55, 0, 210, 'io');
tw('intro', 'y', 14.0, 14.55, 0, 470, 'io');
tw('intro', 's', 14.0, 14.55, 1, 0.2, 'io');
tw('intro', 'o', 14.2, 14.55, 1, 0, 'lin');
fn(
  0,
  36,
  (p) => {
    const t = p * 36;
    for (const [pre, wave0] of [
      ['i_', 12.95],
      ['c_', 15.1],
    ]) {
      const g = (id) => document.getElementById(pre + id);
      g('hf').setAttribute('transform', `translate(0 ${Math.sin(t * 2.2) * 1.2})`);
      g('hBob').setAttribute('transform', `rotate(${Math.sin(t * 3.4) * 8} 28 17)`);
      const blink = (t * 0.9) % 1 < 0.07 ? 0.1 : 1;
      g('hEyes').setAttribute('transform', `translate(0 30) scale(1 ${blink}) translate(0 -30)`);
      const w = t >= wave0 && t <= wave0 + 1.2 ? Math.sin((t - wave0) * 15) * 24 : 0;
      g('hWave').setAttribute('transform', `rotate(${w} 12 35)`);
      const happy = t >= 18.5;
      g('hEyes').setAttribute('opacity', happy ? 0 : 1);
      g('hHappy').setAttribute('opacity', happy ? 1 : 0);
      g('hSmile').setAttribute('opacity', happy ? 0 : 1);
      g('hSmile2').setAttribute('opacity', happy ? 1 : 0);
    }
  },
  'lin',
);
pop('chlp', 14.3, 0.6, 20);
sfx(14.35, 'pop');
// the reply is typed into the box, then sent into the chat
const COMPOSE = [
  ['aR', 4.3, 4.95, 5.1],
  ['b2', 14.45, 15.0, 15.1],
  ['b5', 18.45, 18.95, 19.05],
  ['b7', 22.3, 22.9, 23.0],
].map(([id, t0, t1, clear]) => ({ t0, t1, clear, full: Array.from($(id).firstChild.textContent) }));
fn(
  0,
  36,
  (p) => {
    const t = p * 36;
    const w = COMPOSE.find((c) => t >= c.t0 && t < c.clear);
    $('cph').style.display = w ? 'none' : 'flex';
    $('ctxt').style.display = w ? 'block' : 'none';
    if (w) {
      const n = Math.round(w.full.length * Math.min(1, (t - w.t0) / (w.t1 - w.t0)));
      $('ctxt').textContent = w.full.slice(0, n).join('');
    }
  },
  'lin',
);
for (const { t0, t1 } of COMPOSE) for (let t = t0; t < t1; t += 0.1) sfx(t, 'tick');
msgIn('b2', 15.1, 0.6);
msgIn('sl', 16.3, 0.7);
fn(0, 1, () => {
  const t = $('tap');
  const tm = $('tm1');
  t.style.left = tm.offsetLeft + tm.offsetWidth * 0.5 - 60 + 'px';
  t.style.top = 196 + tm.offsetTop + tm.offsetHeight / 2 - 60 + 'px';
});
fn(
  17.2,
  17.8,
  (p) => {
    $('tap').style.opacity = String(Math.sin(p * Math.PI) * 0.9);
    $('tap').style.transform = `scale(${0.6 + p * 0.7})`;
    $('tm1').style.background = p > 0.35 ? '#dbeafe' : '#fff';
  },
  'lin',
);
sfx(17.4, 'tick');
msgIn('b4', 17.85, 0.35, false);
typed('b4', 17.95, 18.35, 'barB');
msgIn('b5', 19.05, 0.55, false);
sfx(19.1, 'chime');
// the slots are done: fold them away to make room
fn(
  18.9,
  19.4,
  (p) => {
    if (p > 0) {
      $('sl').style.maxHeight = (1 - p) * 300 + 'px';
      $('sl').style.opacity = String(1 - p);
    }
  },
  'out',
);
// a free-text question: the AI drafts an answer, the owner approves with one tap
msgIn('b6', 21.0, 0.4, false);
typed('b6', 21.2, 21.9, 'barB');
msgIn('b7', 23.0, 0.5, true);
fade('ph', 24.6, 0.4);

const SH = 6.9; // the closing card follows the feature list
const riseS = (id, t0, ...r) => rise(id, t0 + SH, ...r);
const sfxS = (t, ...r) => sfx(t + SH, ...r);
const twS = (id, p, t0, t1, ...r) => tw(id, p, t0 + SH, t1 + SH, ...r);
const fnS = (t0, t1, ...r) => fn(t0 + SH, t1 + SH, ...r);

// ---------- the feature list: everything the system does ----------
const FEATS = [
  ['🌐', '#dbeafe', 'אתר אישי לעסק', 'בונים מתבנית, מפרסמים בלחיצה'],
  ['📝', '#dcfce7', 'טופס פנייה באתר', 'הפניות נכנסות ישר למערכת'],
  ['💬', '#e0e7ff', 'שיחות', 'וואטסאפ, מייל ועוד'],
  ['👥', '#fef9c3', 'לקוחות', 'כל הפרטים והיסטוריה'],
  ['📅', '#fee2e2', 'יומן ותורים', 'קביעה אוטומטית'],
  ['⚡', '#ffedd5', 'אוטומציות', 'מענה והודעות לבד'],
  ['✅', '#dcfce7', 'משימות', 'תזכורות לצוות'],
  ['📄', '#dbeafe', 'הצעות מחיר', 'שליחה ואישור דיגיטלי'],
  ['📊', '#e0e7ff', 'דוחות וניתוחים בזמן אמת', 'מה עובד ומאיפה'],
  ['✨', '#ede9fe', 'עוזר AI', 'מציע תשובות'],
  ['👤', '#f1f5f9', 'צוות והרשאות', 'כל אחד רואה את שלו'],
  ['🌍', '#fef9c3', 'עברית ואנגלית', 'מערכת ואתר בשתי שפות'],
];
$('feats').innerHTML = FEATS.map(
  ([e, bg, t, sub], i) =>
    `<div class="fc" id="fc${i}" style="left:${i % 2 ? 80 : 552}px;top:${370 + Math.floor(i / 2) * 218}px${i < 2 ? ';border:4px solid #2563eb' : ''}"><div class="ic" style="background:${bg}">${e}</div><div><b>${t}</b><small>${sub}</small></div></div>`,
).join('');
rise('ftitle', 24.7, 0.8);
sfx(24.7, 'pop2');
FEATS.forEach((_, i) => {
  rise('fc' + i, 25.3 + i * 0.28, 0.7, 60);
  sfx(25.3 + i * 0.28, 'pop');
});
for (const id of ['ftitle', ...FEATS.map((_, i) => 'fc' + i)]) fade(id, 30.7, 0.4);

// ---------- growth: no customer lost, the numbers climb ----------
$('s1').insertAdjacentHTML(
  'beforeend',
  `<div id="grow" style="position:absolute;inset:0;opacity:0">
    <p class="hl" id="gt" style="top:160px;font-size:92px">כשלא מפספסים לקוחות,<br /><span class="brandc">העסק גדל.</span></p>
    <div id="gbig" style="position:absolute;left:80px;top:470px;width:920px;height:380px;background:#fff;border-radius:48px;box-shadow:0 28px 60px -28px rgba(15,23,42,.4);text-align:center;padding-top:34px">
      <div style="font-size:42px;font-weight:700;color:#475569">לקוחות בעסק</div>
      <div id="gnum" style="font-size:250px;font-weight:900;line-height:1.1;color:#2563eb;font-variant-numeric:tabular-nums">0</div>
    </div>
    <svg id="gch" viewBox="0 0 920 480" style="position:absolute;left:80px;top:890px;width:920px;height:480px;overflow:visible">
      <defs>
        <linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity=".28" /><stop offset="1" stop-color="#2563eb" stop-opacity="0" /></linearGradient>
        <clipPath id="gclip"><rect id="gcr" x="0" y="-20" width="0" height="520" /></clipPath>
      </defs>
      <path d="M0 460H920" stroke="#cbd5e1" stroke-width="3" />
      <path id="garea" d="M0 430C120 420 200 370 300 345S480 290 580 215S780 110 920 40V460H0Z" fill="url(#gfill)" clip-path="url(#gclip)" />
      <path id="gline" d="M0 430C120 420 200 370 300 345S480 290 580 215S780 110 920 40" fill="none" stroke="#2563eb" stroke-width="9" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
      <circle id="gdot" r="17" fill="#f2564a" stroke="#fff" stroke-width="6" opacity="0" />
    </svg>
    <div id="gc1" style="position:absolute;left:80px;top:1440px;width:448px;height:210px;background:#fff;border-radius:40px;padding:30px 36px;box-shadow:0 28px 60px -28px rgba(15,23,42,.4);font-size:36px;font-weight:700;color:#475569">לקוחות חדשים החודש<b id="gn1" style="display:block;direction:ltr;text-align:right;unicode-bidi:isolate;margin-top:6px;font-size:100px;line-height:1;font-weight:900;color:#16a34a">+0</b></div>
    <div id="gc2" style="position:absolute;left:552px;top:1440px;width:448px;height:210px;background:#fff;border-radius:40px;padding:30px 36px;box-shadow:0 28px 60px -28px rgba(15,23,42,.4);font-size:36px;font-weight:700;color:#475569">תורים שנקבעו<b id="gn2" style="display:block;margin-top:6px;font-size:100px;line-height:1;font-weight:900;color:#0f172a">0</b></div>
    <p id="gfoot" style="position:absolute;inset-inline:0;top:1760px;text-align:center;font-size:30px;color:#94a3b8">נתוני המחשה</p>
  </div>`,
);
const G0 = 31.2;
tw('grow', 'o', G0, G0 + 0.4, 0, 1, 'soft');
rise('gt', G0 + 0.1, 0.8);
sfx(G0 + 0.1, 'pop2');
rise('gbig', G0 + 0.5, 0.8, 70);
sfx(G0 + 0.5, 'pop');
fn(G0 + 0.9, G0 + 3.1, (p) => ($('gnum').textContent = Math.round(248 * p)), 'out');
for (let i = 0; i < 22; i++) sfx(G0 + 0.9 + i * 0.1, 'tick');
sfx(G0 + 3.1, 'chime');
const gl = $('gline');
const glen = gl.getTotalLength();
fn(
  G0 + 1.2,
  G0 + 4.0,
  (p) => {
    gl.setAttribute('stroke-dashoffset', 1 - p);
    $('gcr').setAttribute('width', 920 * p);
    const pt = gl.getPointAtLength(glen * p);
    $('gdot').setAttribute('cx', pt.x);
    $('gdot').setAttribute('cy', pt.y);
    $('gdot').setAttribute('opacity', p > 0.02 ? 1 : 0);
  },
  'io',
);
rise('gc1', G0 + 3.6, 0.7, 60);
rise('gc2', G0 + 3.9, 0.7, 60);
sfx(G0 + 3.6, 'pop');
sfx(G0 + 3.9, 'pop');
fn(G0 + 3.8, G0 + 5.0, (p) => ($('gn1').textContent = '+' + Math.round(37 * p)), 'out');
fn(G0 + 4.1, G0 + 5.3, (p) => ($('gn2').textContent = Math.round(112 * p)), 'out');
for (let i = 0; i < 10; i++) sfx(G0 + 3.8 + i * 0.12, 'tick');
tw('grow', 'o', G0 + 5.9, G0 + 6.3, 1, 0, 'soft');

// ---------- end card ----------
twS('app6', 's', 31.3, 32.2, 0.6, 1, 'soft');
twS('app6', 'o', 31.3, 31.8, 0, 1, 'soft');
sfxS(31.4, 'sparkle');
riseS('f1', 31.8, 0.8, 60);
riseS('f2', 32.3, 0.8, 60);
riseS('cta', 32.8, 0.8, 60);
sfxS(32.8, 'chime');
fnS(
  33.6,
  36,
  (p) => {
    $('cta').style.transform = `scale(${1 + 0.035 * Math.sin(p * Math.PI * 3)})`;
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
