import { CLICK_KIND_JS, WATCH_SECTIONS_JS } from './script-parts';

/**
 * F32: the one script on SimpleCatch's own sites (D-192): first-party (served from the site's own
 * address, CSP `script-src 'self'`), no cookies, no storage, no visitor id. It reports to the same
 * address (`__sc`), as counts: taps on phone/WhatsApp/email links, taps inside each section, a form started, how far they
 * scrolled and which sections were on screen. Pages, entry pages and devices are counted by the server
 * from the request itself, so they are not sent from here. Plain ES5.
 */
export const SITE_SCRIPT = `(function () {
  var s = document.currentScript;
  if (!s || !window.XMLHttpRequest) return;
  // The script sits at <site base>/__sc.js: the base is '/' on a site's own address, '/s/<name>/' under a path.
  var base = (s.getAttribute('src') || '').replace(/__sc[.]js$/, '');
  var endpoint = base + '__sc';
  var path = '/' + location.pathname.slice(base.length).replace(/^[/]+/, '');
  ${CLICK_KIND_JS}${WATCH_SECTIONS_JS}
  function emit(body, beacon) {
    var data = JSON.stringify(body);
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([data], { type: 'text/plain' }))) return;
    } catch (e) {}
    var x = new XMLHttpRequest();
    x.open('POST', endpoint);
    x.setRequestHeader('Content-Type', 'text/plain');
    x.send(data);
  }

  // A tap or click: on a contact link (which kind), and inside which section (its element id).
  document.addEventListener('click', function (e) {
    var el = e.target, link = null, section = '';
    while (el && el.nodeType === 1) {
      if (!link && el.tagName === 'A') link = el;
      if (!section && el.id && el.id.indexOf('s-') === 0 && (el.tagName === 'SECTION' || el.tagName === 'HEADER')) section = el.id;
      el = el.parentNode;
    }
    var kind = link ? clickKind(link.getAttribute('href') || '') : '';
    if (!kind && !section) return;
    var body = { p: path, ev: kind ? [{ k: 'click', l: kind }] : [] };
    if (section) body.clk = section;
    emit(body, true);
  }, true);

  var started = false;
  document.addEventListener('input', function (e) {
    if (started || !e.target || !e.target.form) return;
    started = true;
    emit({ p: path, ev: [{ k: 'form', l: 'start' }] }, true);
  }, true);

  // Sections: the hero and every section of the page (their ids are the section ids).
  var seen = [];
  var nodes = document.querySelectorAll('main [id^="s-"], header[id^="s-"]');
  var items = [];
  for (var i = 0; i < nodes.length; i++) items.push({ el: nodes[i], key: nodes[i].id });
  watchSections(items, function (id) { seen.push(id); });

  var depth = 0;
  function measure() {
    var doc = document.documentElement;
    var total = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    var pos = (window.pageYOffset || doc.scrollTop || 0) + (window.innerHeight || doc.clientHeight || 0);
    var pct = total > 0 ? pos / total * 100 : 100;
    if (pct > depth) depth = pct;
  }
  window.addEventListener('scroll', measure, { passive: true });
  measure();
  var left = false;
  function leave() {
    if (left) return;
    left = true;
    measure();
    var ev = [];
    if (depth >= 50) ev.push({ k: 'scroll', l: '50' });
    if (depth >= 90) ev.push({ k: 'scroll', l: '90' });
    if (ev.length || seen.length) emit({ p: path, ev: ev, sec: seen.slice(0, 20) }, true);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);
})();
`;
