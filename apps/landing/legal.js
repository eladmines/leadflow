// Language for the legal pages: the same choice as the landing page (Hebrew on .co.il or for Hebrew
// browsers, English for everyone else; a language picked earlier always wins).
const STORAGE_KEY = 'simplecatch.landing.lang';

const read = () => {
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
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  for (const d of document.querySelectorAll('.doc')) d.hidden = d.lang !== lang;
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
  const title = document.querySelector(`.doc[lang="${lang}"] h1`)?.textContent;
  if (title) document.title = `${title} — SimpleCatch`;
}

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    save(b.dataset.lang);
    apply(b.dataset.lang);
  });
}

const saved = read();
const wanted =
  saved === 'he' || saved === 'en'
    ? saved
    : /\.co\.il$/i.test(location.hostname) || /^he\b/i.test(navigator.language)
      ? 'he'
      : 'en';
apply(wanted);
for (const el of document.querySelectorAll('#year'))
  el.textContent = String(new Date().getFullYear());
