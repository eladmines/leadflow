/**
 * F30: the script a business pastes on its own website. Plain ES5 (runs on any site), no
 * dependencies. It remembers where the visitor came from (ad click, UTM, referrer) in
 * localStorage for 30 days, and posts every `<form data-simplecatch>` to SimpleCatch with it.
 * Fields are found by name: name, phone, email, message, consent (a checkbox the visitor ticks),
 * and the same names Shopify's contact form uses (`contact[name]`, `contact[body]`…).
 * F32: it also counts what visitors do (page, landing page, device, taps on phone/WhatsApp/email
 * links, scroll depth, a form started), never who they are.
 * Options, on the form or on the script tag: `data-consent-implied` (the form's own text already asks
 * for consent), `data-passthrough` (after sending, the form is submitted normally too, e.g. to
 * Shopify). On the script tag, `data-forms="<css selector>"` binds forms that can't carry attributes.
 */
export const EMBED_SCRIPT = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var key = s.getAttribute('data-key');
  if (!key) return;
  var origin = s.src.replace(/^(https?:\\/\\/[^\\/]+).*$/, '$1');
  var endpoint = origin + '/api/v1/embed/lead';
  var STORE = 'sc_src';
  var DAYS = 30;
  var TRACKED = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid','ttclid','msclkid'];

  function read() {
    try { var v = JSON.parse(localStorage.getItem(STORE) || 'null'); if (v && v.t > Date.now() - DAYS * 864e5) return v; } catch (e) {}
    return null;
  }
  function write(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) {} }

  // On landing: an ad click or tagged link replaces what is stored; otherwise the first visit stays.
  function remember() {
    var q = {}, any = false, i, m;
    var re = /[?&]([^=&#]+)=([^&#]*)/g;
    while ((m = re.exec(location.search))) {
      var k = decodeURIComponent(m[1]);
      if (TRACKED.indexOf(k) >= 0) { try { q[k] = decodeURIComponent(m[2].replace(/\\+/g, ' ')); } catch (e) {} any = true; }
    }
    var ref = '';
    try { if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer; } catch (e) {}
    var old = read();
    if (any) write({ t: Date.now(), params: q, referrer: ref, landing: location.href.split(/[?#]/)[0] });
    else if (!old && ref) write({ t: Date.now(), params: {}, referrer: ref, landing: location.href.split(/[?#]/)[0] });
  }
  remember();

  // One visit per browser session (tab), counted under the same source a lead sent now would get.
  function visit() {
    try { if (sessionStorage.getItem('sc_v')) return false; sessionStorage.setItem('sc_v', '1'); } catch (e) { return false; }
    var src = read() || {};
    var x = new XMLHttpRequest();
    x.open('POST', origin + '/api/v1/embed/visit');
    x.setRequestHeader('Content-Type', 'text/plain');
    x.send(JSON.stringify({
      key: key, params: src.params, referrer: src.referrer, landing: src.landing,
      page: location.href.split(/[?#]/)[0]
    }));
    return true;
  }
  var firstOfSession = visit();

  // F32: what the visitor does on the page, as counts (no visitor id, no page sequence).
  var path = location.pathname;
  function emit(events, beacon) {
    var data = JSON.stringify({ key: key, events: events });
    var url = origin + '/api/v1/embed/event';
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([data], { type: 'text/plain' }))) return;
    } catch (e) {}
    var x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'text/plain');
    x.send(data);
  }
  var first = [{ k: 'page', l: path }];
  if (firstOfSession) {
    var w = window.innerWidth || 1024;
    first.push({ k: 'landing', l: path }, { k: 'device', l: w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop' });
  }
  emit(first, false);

  // Taps on phone, WhatsApp and email links (sent at once: the page may be left right after).
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentNode;
    var href = el && el.getAttribute ? (el.getAttribute('href') || '') : '';
    var kind = /^tel:/i.test(href) ? 'phone'
      : /^mailto:/i.test(href) ? 'email'
      : /^(whatsapp:|https?:\\/\\/(wa\\.me|api\\.whatsapp\\.com|web\\.whatsapp\\.com)\\b)/i.test(href) ? 'whatsapp' : '';
    if (kind) emit([{ k: 'click', l: kind }], true);
  }, true);

  // A form started: the first field the visitor touches in a form SimpleCatch listens to.
  var started = false;
  document.addEventListener('input', function (e) {
    var f = e.target && e.target.form;
    if (started || !f || !f.__sc) return;
    started = true;
    emit([{ k: 'form', l: 'start' }], true);
  }, true);

  // How far down the page they got, sent once when they leave. A page that fits the screen counts as seen.
  var depth = 0;
  function measure() {
    var doc = document.documentElement;
    var total = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    var seen = (window.pageYOffset || doc.scrollTop || 0) + (window.innerHeight || doc.clientHeight || 0);
    var pct = total > 0 ? seen / total * 100 : 100;
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
    if (ev.length) emit(ev, true);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);

  function uid() {
    var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', r = '';
    for (var i = 0; i < 24; i++) r += a.charAt(Math.floor(Math.random() * a.length));
    return r;
  }

  function send(fields, done) {
    var src = read() || {};
    var body = {
      key: key, id: fields._id || uid(),
      name: fields.name, phone: fields.phone, email: fields.email, message: fields.message,
      consent: fields.consent, website: fields.website,
      params: src.params, referrer: src.referrer, landing: src.landing,
      page: location.href.split(/[?#]/)[0]
    };
    var x = new XMLHttpRequest();
    x.open('POST', endpoint);
    x.setRequestHeader('Content-Type', 'text/plain');
    x.onload = function () {
      var r = {}; try { r = JSON.parse(x.responseText); } catch (e) {}
      done(!!r.ok, r.errors || []);
    };
    x.onerror = function () { done(false, []); };
    x.send(JSON.stringify(body));
  }

  var PHONE = ['phone', 'contact[phone]', 'contact[Phone]'];
  // The first field found among the candidate names (ours, then Shopify's).
  function val(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.elements[names[i]];
      if (!el) continue;
      if (el.type === 'checkbox') return el.checked ? 'on' : '';
      return el.value;
    }
    return undefined;
  }
  function opt(form, name) { return form.hasAttribute(name) || s.hasAttribute(name); }

  function bind(form) {
    if (form.__sc) return;
    form.__sc = true;
    var id = uid(), busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true;
      var btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      var passthrough = opt(form, 'data-passthrough');
      send({
        _id: id,
        name: val(form, ['name', 'contact[name]', 'contact[Name]']),
        phone: val(form, PHONE),
        email: val(form, ['email', 'contact[email]', 'contact[Email]']),
        message: val(form, ['message', 'contact[body]', 'contact[message]', 'contact[Message]']),
        consent: opt(form, 'data-consent-implied') ? 'on' : val(form, ['consent', 'contact[consent]']),
        website: val(form, ['website'])
      }, function (ok, errors) {
        busy = false;
        if (btn) btn.disabled = false;
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent(ok ? 'simplecatch:sent' : 'simplecatch:error', true, false, { errors: errors });
        form.dispatchEvent(ev);
        // The form's own destination still gets it (it was only paused to send ours first).
        if (passthrough) { HTMLFormElement.prototype.submit.call(form); return; }
        if (ok) {
          var note = document.createElement('p');
          note.textContent = form.getAttribute('data-success') || 'Thank you! We will be in touch.';
          form.parentNode.replaceChild(note, form);
        } else {
          alert(errors.length ? errors.join('\\n') : (form.getAttribute('data-error') || 'Sending failed. Please try again.'));
        }
      });
    });
  }

  function bindAll() {
    var sel = 'form[data-simplecatch]';
    var extra = s.getAttribute('data-forms');
    if (extra) sel += ',' + extra;
    var f = document.querySelectorAll(sel);
    for (var i = 0; i < f.length; i++) {
      // A form picked only by the selector must have a phone field: a newsletter box can't be a lead.
      if (!f[i].hasAttribute('data-simplecatch') && !val(f[i], PHONE)) continue;
      bind(f[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();

  // For a form builder that can't carry attributes: SimpleCatch.send({ name, phone, ... }, callback).
  window.SimpleCatch = { send: send };
})();
`;
