/**
 * F30: the script a business pastes on its own website. Plain ES5 (runs on any site), no
 * dependencies. It remembers where the visitor came from (ad click, UTM, referrer) in
 * localStorage for 30 days, and posts every `<form data-simplecatch>` to SimpleCatch with it.
 * Fields are found by the names we ask for (name, phone, email, message) and Shopify's
 * (`contact[name]`, `contact[body]`…), and otherwise by their type, name, label and placeholder, in
 * Hebrew or English; other filled fields (a date, a service) go into the message as "label: value".
 * F32: it also counts what visitors do (page, landing page, device, taps on phone/WhatsApp/email
 * links and on buttons the owner named, sections seen (data-sc-section), scroll depth, a form started),
 * never who they are.
 * Forms: `data-forms="<css selector>"` on the script tag picks forms that keep sending themselves; we send
 * a copy (a beacon, so it survives the page change) and change nothing. `data-simplecatch` on a form
 * means we take it over instead (we send it and show `data-success`).
 */
import { CLICK_KIND_JS, WATCH_SECTIONS_JS } from './script-parts';

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

${CLICK_KIND_JS}${WATCH_SECTIONS_JS}
  var sectionItems = [];
  // Buttons the owner chose to count: data-sc-click="name" on the element, or on the script tag
  // data-track="selector=name; selector=name" for builders that can't add attributes.
  var TRACK = [];
  (s.getAttribute('data-track') || '').split(';').forEach(function (pair) {
    var i = pair.lastIndexOf('=');
    if (i > 0) TRACK.push([pair.slice(0, i).trim(), pair.slice(i + 1).trim()]);
  });
  function matches(node, sel) {
    var m = node.matches || node.msMatchesSelector || node.webkitMatchesSelector;
    try { return !!m && m.call(node, sel); } catch (e) { return false; }
  }

  // Taps on phone, WhatsApp and email links, and on the buttons above (sent at once: the page may
  // be left right after).
  document.addEventListener('click', function (e) {
    var events = [], named = {};
    for (var node = e.target; node && node.nodeType === 1; node = node.parentNode) {
      var name = node.getAttribute('data-sc-click');
      if (name && !named[name]) { named[name] = 1; events.push({ k: 'cta', l: name }); }
      for (var t = 0; t < TRACK.length; t++) {
        if (TRACK[t][1] && !named[TRACK[t][1]] && matches(node, TRACK[t][0])) {
          named[TRACK[t][1]] = 1;
          events.push({ k: 'cta', l: TRACK[t][1] });
        }
      }
    }
    // A click inside a section the owner named counts for that section (the innermost one).
    for (var q = e.target; q && q.nodeType === 1; q = q.parentNode) {
      var hit = null;
      for (var si = 0; si < sectionItems.length; si++) if (sectionItems[si].el === q) hit = sectionItems[si];
      if (hit) { events.push({ k: 'sclick', l: path + '#' + hit.key }); break; }
    }
    var el = e.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentNode;
    var href = el && el.getAttribute ? (el.getAttribute('href') || '') : '';
    var kind = clickKind(href);
    if (kind) events.unshift({ k: 'click', l: kind });
    if (events.length) emit(events, true);
  }, true);

  // A form started: the first field the visitor touches in a form SimpleCatch listens to.
  var started = false;
  document.addEventListener('input', function (e) {
    var f = e.target && e.target.form;
    if (started || !f || !f.__sc) return;
    started = true;
    emit([{ k: 'form', l: 'start' }], true);
  }, true);

  // Sections the owner named: data-sc-section="name" on the element, or on the script tag
  // data-track-sections="selector=name; selector=name". Counted once per page view when seen.
  var seenSections = [];
  (function () {
    var items = sectionItems, byName = {};
    function add(el, name) { if (el && name && !byName[name]) { byName[name] = 1; items.push({ el: el, key: name }); } }
    var tagged = document.querySelectorAll('[data-sc-section]');
    for (var i = 0; i < tagged.length; i++) add(tagged[i], tagged[i].getAttribute('data-sc-section'));
    (s.getAttribute('data-track-sections') || '').split(';').forEach(function (pair) {
      var j = pair.lastIndexOf('=');
      if (j <= 0) return;
      var name = pair.slice(j + 1).trim();
      try { add(document.querySelector(pair.slice(0, j).trim()), name); } catch (e) {}
    });
    watchSections(items, function (name) { seenSections.push({ k: 'section', l: path + '#' + name }); });
  })();

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
    var ev = seenSections.slice(0, 8);
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

  function send(fields, done, beacon) {
    var src = read() || {};
    var body = {
      key: key, id: fields._id || uid(),
      name: fields.name, phone: fields.phone, email: fields.email, message: fields.message,
      website: fields.website,
      params: src.params, referrer: src.referrer, landing: src.landing,
      page: location.href.split(/[?#]/)[0]
    };
    // A copy of a form that is about to leave the page: a beacon survives the page change.
    if (beacon) {
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([JSON.stringify(body)], { type: 'text/plain' }))) { done(true, []); return; }
      } catch (e) {}
    }
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

  // --- Finding a form's fields when they are not named as we ask ---------------------------------
  // By type (email, tel, textarea, tick box) and by what the field says about itself: its name, id,
  // placeholder, label and autocomplete, in Hebrew or English. That text is only read here, to tell
  // the fields apart; it is never sent (a label is sent only for an extra field's value, below).
  var WORDS = {
    email: /e-?mail|מייל|דוא|אימייל/i,
    phone: /phone|tel|mobile|cell|טלפון|נייד|פלאפון|סלולרי/i,
    name: /name|שם/i,
    honey: /honey|trap|website|url|fax|hp/i
  };
  var SKIP = /^(hidden|submit|button|reset|image|file|password|search|radio|range|color)$/;
  function labelOf(el) {
    var labels = el.labels;
    return labels && labels.length ? labels[0].textContent : '';
  }
  function describe(el) {
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), labelOf(el)].join(' ');
  }
  // A field people don't see, that bots fill: aria-hidden or out of the tab order, named like a trap.
  function isHoney(el) {
    return (el.getAttribute('aria-hidden') === 'true' || el.tabIndex === -1) && WORDS.honey.test(el.name || el.id || '');
  }
  function detect(form) {
    var out = { names: [], phone: null, email: null, message: null, honey: null, used: [] };
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tag = el.tagName, type = (el.type || '').toLowerCase();
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') continue;
      if (SKIP.test(type) || el.name === 'website') continue;
      if (isHoney(el)) { out.honey = el; continue; }
      var d = describe(el);
      if (type === 'checkbox') continue;
      if (tag === 'SELECT') continue;
      if (tag === 'TEXTAREA') { if (!out.message) { out.message = el; out.used.push(el); } continue; }
      if (type === 'email' || WORDS.email.test(d)) { if (!out.email) { out.email = el; out.used.push(el); } continue; }
      if (type === 'tel' || WORDS.phone.test(d)) { if (!out.phone) { out.phone = el; out.used.push(el); } continue; }
      if (WORDS.name.test(d) && out.names.length < 2) { out.names.push(el); out.used.push(el); }
    }
    return out;
  }
  function fieldText(el) { return el ? el.value : undefined; }
  // Fields that are none of the above (an event date, a service, a budget): sent inside the message as
  // "label: value" so nothing the visitor wrote is lost.
  function extras(form, d) {
    var lines = [], els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tag = el.tagName, type = (el.type || '').toLowerCase();
      if (tag !== 'INPUT' && tag !== 'SELECT') continue;
      if (SKIP.test(type) || type === 'checkbox' || el === d.honey || el.name === 'website') continue;
      if (d.used.indexOf(el) >= 0 || !el.value) continue;
      var label = (labelOf(el) || el.placeholder || el.getAttribute('aria-label') || el.name || '')
        .replace(/[(][^)]*[)]/g, '').replace(/\\s+/g, ' ').trim();
      var value = tag === 'SELECT' && el.selectedOptions && el.selectedOptions.length ? el.selectedOptions[0].text : el.value;
      lines.push((label ? label + ': ' : '') + value);
    }
    return lines;
  }
  // What to send for a form: the names we ask for first, then what detect() found.
  function readForm(form) {
    var d = detect(form);
    var name = val(form, ['name', 'contact[name]', 'contact[Name]']);
    if (name === undefined && d.names.length) {
      var parts = [];
      for (var i = 0; i < d.names.length; i++) if (d.names[i].value) parts.push(d.names[i].value);
      name = parts.join(' ');
    }
    var pick = function (names, found) { var v = val(form, names); return v === undefined ? fieldText(found) : v; };
    var message = pick(['message', 'contact[body]', 'contact[message]', 'contact[Message]'], d.message);
    var more = extras(form, d);
    if (more.length) message = (message ? message + '\\n\\n' : '') + more.join('\\n');
    return {
      name: name,
      phone: pick(PHONE, d.phone),
      email: pick(['email', 'contact[email]', 'contact[Email]'], d.email),
      message: message ? message.slice(0, 2900) : message,
      website: val(form, ['website']) || fieldText(d.honey)
    };
  }
  function hasPhone(form) {
    for (var i = 0; i < PHONE.length; i++) if (form.elements[PHONE[i]]) return true;
    return !!detect(form).phone;
  }
  function opt(form, name) { return form.hasAttribute(name) || s.hasAttribute(name); }

  function bind(form) {
    if (form.__sc) return;
    form.__sc = true;
    var id = uid(), busy = false;
    // A form picked with data-forms keeps sending itself (a mailer, a script, a normal post): we only
    // send a copy and change nothing. data-simplecatch on the form means we take it over instead.
    var copy = !form.hasAttribute('data-simplecatch') || opt(form, 'data-copy');
    form.addEventListener('submit', function (e) {
      if (!copy) e.preventDefault();
      if (busy) return;
      busy = true;
      var btn = copy ? null : form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      var f = readForm(form);
      send({
        _id: id,
        name: f.name,
        phone: f.phone,
        email: f.email,
        message: f.message,
        website: f.website
      }, function (ok, errors) {
        busy = false;
        id = uid();
        if (btn) btn.disabled = false;
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent(ok ? 'simplecatch:sent' : 'simplecatch:error', true, false, { errors: errors });
        form.dispatchEvent(ev);
        if (copy) return;
        if (ok) {
          var note = document.createElement('p');
          note.textContent = form.getAttribute('data-success') || 'Thank you! We will be in touch.';
          form.parentNode.replaceChild(note, form);
        } else {
          alert(errors.length ? errors.join('\\n') : (form.getAttribute('data-error') || 'Sending failed. Please try again.'));
        }
      }, copy);
    // Capture: a copy is read before the form's own handler can clear it.
    }, copy);
  }

  function bindAll() {
    var sel = 'form[data-simplecatch]';
    var extra = s.getAttribute('data-forms');
    if (extra) sel += ',' + extra;
    var f = document.querySelectorAll(sel);
    for (var i = 0; i < f.length; i++) {
      // A form picked only by the selector must have a phone field: a newsletter box can't be a lead.
      if (!f[i].hasAttribute('data-simplecatch') && !hasPhone(f[i])) continue;
      bind(f[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();

  // For a form builder that can't carry attributes: SimpleCatch.send({ name, phone, ... }, callback).
  window.SimpleCatch = { send: send };
})();
`;
