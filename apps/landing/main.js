/**
 * LeadFlow landing page: Hebrew (RTL) and English (LTR) with a switch, and the links into the app.
 * The page is written in Hebrew; the English texts live here. No build step, no dependencies.
 */

// Where the sign-up and sign-in buttons lead. Change this one line when the app moves.
const APP_URL = 'https://leadflow-55gt.onrender.com';
const STORAGE_KEY = 'leadflow.landing.lang';

const en = {
  title: 'LeadFlow — your website, leads and conversations in one place',
  description:
    'LeadFlow brings every inquiry together: from your website, WhatsApp, Facebook and email. Each one becomes a lead, you answer fast, book appointments and close deals.',
  skip: 'Skip to main content',
  navFeatures: 'Features',
  navHow: 'How it works',
  navFaq: 'FAQ',
  signIn: 'Sign in',
  register: 'Sign up',
  start: 'Get started',
  seeHow: 'How it works',
  heroEyebrow: 'One system for your website, leads and conversations',
  heroTitle: 'Never lose a customer to a missed message.',
  heroText:
    'LeadFlow brings every inquiry together: from your website, WhatsApp, Facebook and email. Each one becomes a lead, you answer fast, book appointments and close deals — all in one place.',
  heroNote: 'In English and Hebrew, left-to-right and right-to-left, and made for phones too.',
  mockN1: 'Dana Cohen',
  mockM1: 'Can I book Thursday?',
  mockN2: 'Yossi Levi',
  mockM2: 'How much is a colour?',
  mockN3: 'Michal Avraham',
  mockM3: 'A quote for an event',
  mockNew: 'New',
  mockIn: 'Hi, can I book Thursday?',
  mockOut: 'Hi Dana! We have 10:00, 12:30 and 17:00 free.',
  mockAuto: 'Automatic reply',
  mockIn2: '12:30 works 🙏',
  mockOut2: 'You’re booked for Thursday at 12:30 ✅',
  toastTitle: 'New lead created',
  toastText: 'Dana Cohen · from WhatsApp',
  channelsTitle: 'Inquiries from everywhere land in one place',
  chSite: 'Website',
  chFb: 'Facebook',
  chMail: 'Email',
  soon: 'soon',
  featEyebrow: 'All in one place',
  featTitle: 'Everything you need not to lose an inquiry',
  f1t: 'A website in minutes',
  f1p: 'Pick a template, edit the text and photos, and publish. The form on your site feeds your leads directly.',
  f2t: 'One inbox',
  f2p: 'WhatsApp, Facebook and email in one place. Answer from the same screen, and the team sees what’s handled.',
  f3t: 'Leads and customers',
  f3p: 'Stages, tags, notes and history for every lead. Anyone who bought or booked shows up under customers.',
  f4t: 'Auto-replies and booking',
  f4p: 'A status message that follows your day, and customers pick a time or book an appointment themselves on WhatsApp.',
  f5t: 'Tasks, appointments and quotes',
  f5p: 'Follow-up reminders, a calendar with free hours, and quotes your customer approves in one tap.',
  f6t: 'Reports and sources',
  f6p: 'See how many inquiries came in, from where (Google, Facebook, your site), and how many closed.',
  howEyebrow: 'How it works',
  howTitle: 'Three steps, no manual sorting',
  s1t: 'Connect',
  s1p: 'Build a website, and connect your WhatsApp, Facebook or email.',
  s2t: 'Every inquiry becomes a lead',
  s2p: 'Whoever writes lands in the inbox and in your leads, with the source they came from.',
  s3t: 'Answer and close',
  s3p: 'Reply fast, book an appointment, send a quote and follow up until the deal closes.',
  stagesLabel: 'Lead stages: New, Contacted, Quote, Won',
  st1: 'New',
  st2: 'Contacted',
  st3: 'Quote',
  st4: 'Won ✓',
  teamEyebrow: 'For the whole team',
  teamTitle: 'Everyone sees what fits them',
  teamText:
    'Owners, managers and employees, each with permissions for their role. Every business’s data is kept apart from all others.',
  t1: 'Permissions by role: owner, manager and employee',
  t2: 'Employees only see the leads assigned to them',
  t3: 'Alerts for a new inquiry and for a customer’s message',
  t4: 'English and Hebrew, on any device',
  faqEyebrow: 'FAQ',
  faqTitle: 'What you wanted to know',
  q1: 'Do I need a website to start?',
  a1: 'No. You can build a website in LeadFlow, or start straight from WhatsApp, Facebook and email.',
  q2: 'Which channels can I connect?',
  a2: 'A form on your website, WhatsApp, Facebook (messages to your Page) and email. Instagram is on the way.',
  q3: 'Is it in Hebrew and English?',
  a3: 'Yes. Switch language any time, and the screen flips between right-to-left and left-to-right.',
  q4: 'How do I start?',
  a4: 'Sign up, set up your business details, then build a website or connect a channel. From there every inquiry arrives by itself.',
  finalTitle: 'Ready not to miss a single inquiry?',
  finalText: 'Open an account and see every inquiry of your business in one place.',
  navLabel: 'Main navigation',
  langLabel: 'Language',
  mockLabel: 'A view of the LeadFlow inbox',
  footLabel: 'Links',
};

const he = {};
const texts = { he, en };
const nodes = [...document.querySelectorAll('[data-i18n]')];
const ariaNodes = [...document.querySelectorAll('[data-i18n-aria]')];
// What the page says now is the Hebrew version: keep it so switching back needs no copy here.
for (const el of nodes) he[el.dataset.i18n] = el.textContent.trim().replace(/\s+/g, ' ');
for (const el of ariaNodes) he[el.dataset.i18nAria] = el.getAttribute('aria-label');
he.title = document.title;
he.description = document.querySelector('meta[name="description"]').content;

const readSaved = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const save = (lang) => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
};

function apply(lang) {
  const dict = texts[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  for (const el of nodes) el.textContent = dict[el.dataset.i18n] ?? he[el.dataset.i18n];
  for (const el of ariaNodes) el.setAttribute('aria-label', dict[el.dataset.i18nAria]);
  document.title = dict.title;
  document.querySelector('meta[name="description"]').content = dict.description;
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
}

for (const a of document.querySelectorAll('[data-app]')) a.href = APP_URL + a.dataset.app;
for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    save(b.dataset.lang);
    apply(b.dataset.lang);
  });
}
document.getElementById('year').textContent = String(new Date().getFullYear());

// First visit: Hebrew for Hebrew browsers, English for everyone else.
const saved = readSaved();
const wanted =
  saved === 'he' || saved === 'en' ? saved : /^he\b/i.test(navigator.language) ? 'he' : 'en';
if (wanted !== 'he') apply(wanted);
