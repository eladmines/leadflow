/**
 * LeadFlow landing page: Hebrew (RTL) and English (LTR) with a switch, and the links into the app.
 * The page is written in Hebrew; the English texts live here. No build step, no dependencies.
 */

// Where the sign-up and sign-in buttons lead. Change this one line when the app moves.
document.documentElement.classList.add('js');

const APP_URL = 'https://leadflow-55gt.onrender.com';
const STORAGE_KEY = 'leadflow.landing.lang';

const en = {
  title: 'LeadFlow — run your whole business in one place',
  description:
    'LeadFlow is one system to run your business: a website, customers and leads, conversations from WhatsApp, Facebook and email, appointments, tasks, quotes and reports.',
  skip: 'Skip to main content',
  navFeatures: 'Features',
  navHow: 'How it works',
  navFaq: 'FAQ',
  signIn: 'Sign in',
  register: 'Sign up',
  start: 'Get started',
  seeHow: 'How it works',
  heroEyebrow: 'One platform to run your business',
  heroTitle: 'Run your whole business in one place.',
  heroText:
    'Website, customers, conversations, appointments, tasks and quotes in one system for the whole team. Every inquiry is recorded automatically, and replies, bookings and reminders run without manual effort.',
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
  channelsTitle: 'Every inquiry, from every channel, in one inbox',
  chSite: 'Website',
  chFb: 'Facebook',
  chMail: 'Email',
  soon: 'soon',
  featEyebrow: 'Capabilities',
  featTitle: 'Every management tool your business needs, in one place',
  f1t: 'Customer and inquiry management',
  f1p: 'A central customer database with sales stages, tags and notes, and a complete activity history for every contact.',
  f2t: 'Unified inbox',
  f2p: 'WhatsApp, Facebook and email on one screen. Reply on every channel from the same inbox, shared across the team.',
  f3t: 'Calendar and appointments',
  f3p: 'Manage services, availability and appointments per team member, with self-service booking for customers and approval in the system.',
  f4t: 'Tasks and follow-up',
  f4p: 'Tasks with an owner and a due date, automatic reminders and a link to the relevant customer.',
  f5t: 'Quotes',
  f5p: 'Create a quote from the customer’s record, send it as a link and receive digital approval.',
  f6t: 'Business website',
  f6p: 'Build a site from ready-made templates, publish in one click and receive inquiries straight into the system through the contact form.',
  f7t: 'Automatic replies and booking',
  f7p: 'Instant WhatsApp replies based on your business status, and self-service booking by customers.',
  f8t: 'Reports and source analysis',
  f8p: 'Analyse inquiries by source and campaign, with close rate, response time and a comparison to the previous period.',
  f9t: 'Team and permissions',
  f9p: 'Role-based permissions (owner, manager, employee) and strict separation between businesses’ data.',
  howEyebrow: 'How it works',
  howTitle: 'Three steps, and the system does the rest',
  stepOnce: 'One time',
  stepAuto: 'Automatic',
  stepYou: 'You’re in control',
  sc1: 'Instant reply',
  sc2: 'Booking',
  sc3: 'Reminders',
  sc4: 'Customer record',
  s1t: 'Set up your business',
  s1p: 'Enter your details, services and opening hours, then build a website or connect WhatsApp, Facebook and email. This is the only manual stage.',
  s2t: 'The rest is automatic',
  s2p: 'Every inquiry is recorded as a customer with its source, receives a reply, books an appointment and gets a reminder, even while you’re working.',
  s3t: 'Run the business and track results',
  s3p: 'Carry on as usual: tick off tasks, send quotes and track in the reports what works.',
  faqEyebrow: 'FAQ',
  faqTitle: 'Everything worth knowing',
  q1: 'Do I need a website to start?',
  a1: 'No. You can build a website in LeadFlow, or start directly from WhatsApp, Facebook and email.',
  q2: 'Which channels can I connect?',
  a2: 'A website form, WhatsApp, Facebook (messages to your business page) and email. Instagram is in development.',
  q3: 'Is it in Hebrew and English?',
  a3: 'Yes. Switch language at any time, and the interface flips automatically between right-to-left and left-to-right.',
  q4: 'How do I start?',
  a4: 'Sign up, set your business details, then build a website or connect a channel. From there, every inquiry is recorded automatically.',
  q5: 'How do I connect my business’s WhatsApp number?',
  a5: 'The number is connected through Meta’s official API. A dedicated business number is recommended; a number registered in the regular WhatsApp app must be freed from it first.',
  q6: 'How do customers’ emails reach the system?',
  a6: 'Each business gets its own address in the system. Emails sent to it arrive in the inbox, and you can reply from that same address.',
  q7: 'Can a whole team work in the system?',
  a7: 'Yes. Invite employees and managers by email, and each user receives permissions according to their role. Employees see only the inquiries and appointments assigned to them.',
  q8: 'Can customers book an appointment themselves?',
  a8: 'Yes. On WhatsApp, customers see free times from your calendar and choose one, and you decide whether the booking is confirmed immediately or waits for your approval.',
  q9: 'What happens to an inquiry when I’m not available?',
  a9: 'The automatic reply answers the customer according to the status you chose, and the inquiry is kept in the inbox, waiting for you.',
  q10: 'Who can see my business’s data?',
  a10: 'Each business runs in a separate environment. Customer data and conversations are available only to that business’s team members, according to their permissions.',
  q11: 'Can I export my data?',
  a11: 'Yes. Business owners can export the inquiry list to a CSV file that opens in Excel.',
  finalTitle: 'Ready to run your business from one place?',
  finalText:
    'Open an account and get a complete view of your business’s customers, conversations, appointments and tasks.',
  tourLabel: 'A short tour of the product',
  tabChats: 'Chats',
  tabAppts: 'Appointments',
  tabTasks: 'Tasks',
  tabReports: 'Reports',
  apDay: 'Thursday',
  apSub: 'Appointments and free hours',
  apFree: 'Free',
  apSvc: 'Haircut · 30 min',
  apN2: 'Ron Shemesh',
  apSvc2: 'Consultation · 45 min',
  apOk: 'Confirmed',
  tkTitle: 'Today’s tasks',
  tkSub: 'Customer follow-up',
  tk1: 'Call Dana Cohen',
  tk1s: 'Reminder before the appointment',
  tk2: 'Send a quote',
  tk2s: 'Event in Holon',
  tk3: 'Approve an appointment request',
  tk3s: 'Waiting for approval',
  rpTitle: 'Last 7 days',
  rpSub: 'Inquiries by source',
  rp1: 'New inquiries',
  rp2: 'Appointments booked',
  rp3: 'Closed',
  rpGoogle: 'Google',
  pipeInLabel: 'Where inquiries come from',
  pipeHubText: 'Every inquiry in one place',
  anEyebrow: 'Analytics',
  anTitle: 'Know where your customers come from, and what drives them',
  anText:
    'Every inquiry is recorded with its source: your website, WhatsApp, Facebook, Google or a specific ad. See what works and decide where to invest.',
  an1: 'Automatic source detection: Google and Facebook ads, your website and campaigns',
  an2: 'Close rate and deal value by source and campaign',
  an3: 'Comparison with the previous period and a trend over time',
  an4: 'Average response time: how quickly you reply to customers',
  anLabel: 'A sample lead analysis report',
  anCardT: 'Inquiries by source',
  anCardS: 'Last 30 days',
  anK1: 'New inquiries',
  anK2: 'Close rate',
  anK3: 'Response time',
  anK3v: '12 min',
  anCamp: 'Campaign',
  anLeads: 'Inquiries',
  anWon: 'Closed',
  anVal: 'Value',
  anC1: 'Summer campaign · Google',
  anC2: 'Friends offer · Facebook',
  anC3: 'Website form',
  anNote: 'Sample data',
  navAuto: 'Automation',
  autoEyebrow: 'Automation',
  autoTitle: 'Automation that works for you, even when you’re busy',
  autoSub:
    'Repetitive work runs on its own: replying to customers, booking appointments, recording inquiries and sending reminders.',
  autoBadge: 'Automatic',
  autoWhen: 'WHEN',
  autoThen: 'THEN',
  a1t: 'A customer reaches out',
  a1r: 'The inquiry is recorded',
  a1p: 'Every inquiry from your website, WhatsApp, Facebook or email is recorded automatically, together with the source it came from.',
  a2t: 'You’re unavailable',
  a2r: 'A reply based on your status',
  a2p: 'A status message, such as “At an event until 6 pm”, goes to every customer who reaches out, and they choose when suits them to talk.',
  a3t: 'After the reply',
  a3r: 'A look at your work',
  a3p: 'A link, photos and a video from your business are sent to the customer automatically, at most once a day.',
  a4t: 'A customer asks to book',
  a4r: 'Automatic booking',
  a4p: 'The customer picks a service, a day and a free time from your calendar. The appointment is booked as confirmed, or waits for your approval.',
  a5t: 'A person is needed',
  a5r: 'A seamless handover',
  a5p: 'When a customer asks to speak with someone, the conversation comes to you immediately, and the automatic reply stops as soon as a team member responds.',
  a6t: 'A deadline arrives',
  a6r: 'Reminders and alerts',
  a6p: 'Tasks that reach their due date arrive as an email reminder, and the team is alerted to every new inquiry and message.',
  autoNote: 'Every automation has a switch: turn it on or off and edit the messages at any time.',
  q12: 'What does the system do automatically?',
  a12: 'Records every inquiry, replies to customers by your status, sends a look at your work, books appointments from your calendar, hands a customer who asks for a person over to you, and sends reminders and alerts.',
  q13: 'Can I turn the automatic reply off?',
  a13: 'Yes. Every automation has a switch: turn it off or edit the messages at any time. When someone on your team writes in a conversation, the automatic reply stops.',
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

// Things ease in as they scroll into view.
const revealed = [
  ...document.querySelectorAll(
    '.section-head, .auto-card, .auto-note, .cards .card, .steps li, .an-card, .an-copy, .chips li, .channels-title, .faq details, .final .wrap > *',
  ),
];
revealed.forEach((el) => {
  el.classList.add('reveal');
  const group = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
  el.style.setProperty('--i', String(group % 6));
});
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  revealed.forEach((el) => io.observe(el));
} else {
  revealed.forEach((el) => el.classList.add('in'));
}

// The product tour in the hero: four scenes that play in turn. A tab (or the arrow keys) picks one;
// it stops while the pointer or keyboard is on it, and doesn't autoplay for reduced motion.
const tour = document.getElementById('tour');
if (tour) {
  const tabs = [...tour.querySelectorAll('[role="tab"]')];
  const scenes = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DURATION = 7000;
  tour.style.setProperty('--dur', DURATION + 'ms');
  let index = 0;
  let timer = null;
  let paused = false;

  const play = () => {
    clearTimeout(timer);
    tour.classList.remove('playing');
    if (paused || reduce || document.hidden) return;
    void tour.offsetWidth; // restart the progress bar
    tour.classList.add('playing');
    timer = setTimeout(() => show((index + 1) % tabs.length), DURATION);
  };
  const show = (i, focus = false) => {
    index = i;
    tabs.forEach((t, n) => {
      const on = n === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      scenes[n].hidden = !on;
      scenes[n].classList.toggle('on', on);
    });
    if (focus) tabs[i].focus();
    play();
  };

  tabs.forEach((t, n) => t.addEventListener('click', () => show(n)));
  tour.addEventListener('keydown', (e) => {
    const rtl = document.documentElement.dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    if (step) show((index + step + tabs.length) % tabs.length, true);
    else if (e.key === 'Home') show(0, true);
    else if (e.key === 'End') show(tabs.length - 1, true);
    else return;
    e.preventDefault();
  });
  const hold = (on) => {
    paused = on;
    play();
  };
  tour.addEventListener('pointerenter', () => hold(true));
  tour.addEventListener('pointerleave', () => hold(tour.matches(':focus-within')));
  tour.addEventListener('focusin', () => hold(true));
  tour.addEventListener('focusout', () => hold(tour.matches(':hover')));
  document.addEventListener('visibilitychange', play);
  show(0);
}
