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
  autoTitle: 'Every inquiry gets a reply, even while you’re at work',
  autoSub:
    'Everything between the inquiry and the appointment runs automatically, and you step in only when needed.',
  mascotHi: 'Welcome to LeadFlow! 👋',
  mascotMsg: 'Want to see how it works?',
  mascotLabel: 'The LeadFlow helper: how it works',
  flAuto: 'Automatic',
  flYou: 'You',
  fl1t: 'The inquiry is recorded',
  fl1p: 'From your website, WhatsApp, Facebook or email, together with the source it came from.',
  fl2t: 'The customer gets a reply',
  fl2p: 'An instant reply based on your status, with a look at your business’s work.',
  fl3t: 'The customer books',
  fl3p: 'They pick a service and a free time from your calendar, and the appointment is added to your schedule.',
  fl4t: 'Your team is alerted',
  fl4p: 'To every new inquiry, message and appointment, with an email reminder when a task is due.',
  fl5t: 'You step in',
  fl5p: 'When a customer asks to speak with someone, the conversation comes to you and the automatic reply stops.',
  autoNote: 'Every automation has a switch: turn it on or off and edit the messages at any time.',
  q12: 'What does the system do automatically?',
  a12: 'Records every inquiry, replies to customers by your status, sends a look at your work, books appointments from your calendar, hands a customer who asks for a person over to you, and sends reminders and alerts.',
  q13: 'Can I turn the automatic reply off?',
  a13: 'Yes. Every automation has a switch: turn it off or edit the messages at any time. When someone on your team writes in a conversation, the automatic reply stops.',
  navLabel: 'Main navigation',
  langLabel: 'Language',
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
    '.section-head, .flow-step, .auto-note, .cards .card, .steps li, .an-card, .an-copy, .chips li, .channels-title, .faq details, .final .wrap > *',
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

// The helper greets a visitor once per visit, not on every page load.
{
  const mascot = document.querySelector('.mascot');
  try {
    if (sessionStorage.getItem('lf-greeted')) mascot?.classList.add('quiet');
    else sessionStorage.setItem('lf-greeted', '1');
  } catch {
    // Storage blocked: it just greets every time.
  }
}
