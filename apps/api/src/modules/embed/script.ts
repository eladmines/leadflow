/**
 * F30: the script a business pastes on its own website. Plain ES5 (runs on any site), no
 * dependencies. It remembers where the visitor came from (ad click, UTM, referrer) in
 * localStorage for 30 days, and posts every `<form data-simplecatch>` to SimpleCatch with it.
 * Fields are found by name: name, phone, email, message, consent (a checkbox the visitor ticks;
 * `data-consent-implied` on the form means the form's own text already asks for it).
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
    try { if (sessionStorage.getItem('sc_v')) return; sessionStorage.setItem('sc_v', '1'); } catch (e) { return; }
    var src = read() || {};
    var x = new XMLHttpRequest();
    x.open('POST', origin + '/api/v1/embed/visit');
    x.setRequestHeader('Content-Type', 'text/plain');
    x.send(JSON.stringify({
      key: key, params: src.params, referrer: src.referrer, landing: src.landing,
      page: location.href.split(/[?#]/)[0]
    }));
  }
  visit();

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

  function val(form, name) {
    var el = form.elements[name];
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked ? 'on' : '';
    return el.value;
  }

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
      send({
        _id: id, name: val(form, 'name'), phone: val(form, 'phone'), email: val(form, 'email'),
        message: val(form, 'message'), consent: form.hasAttribute('data-consent-implied') ? 'on' : val(form, 'consent'),
        website: val(form, 'website')
      }, function (ok, errors) {
        busy = false;
        if (btn) btn.disabled = false;
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent(ok ? 'simplecatch:sent' : 'simplecatch:error', true, false, { errors: errors });
        form.dispatchEvent(ev);
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
    var f = document.querySelectorAll('form[data-simplecatch]');
    for (var i = 0; i < f.length; i++) bind(f[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();

  // For a form builder that can't carry attributes: SimpleCatch.send({ name, phone, ... }, callback).
  window.SimpleCatch = { send: send };
})();
`;
