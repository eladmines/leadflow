(function () {
  var s = document.currentScript;
  if (!s || !window.XMLHttpRequest) return;
  // The script sits at <site base>/__sc.js: the base is '/' on a site's own address, '/s/<name>/' under a path.
  var base = (s.getAttribute('src') || '').replace(/__sc[.]js$/, '');
  var endpoint = base + '__sc';
  var path = '/' + location.pathname.slice(base.length).replace(/^[/]+/, '');
  
  function clickKind(href) {
    if (/^tel:/i.test(href)) return 'phone';
    if (/^mailto:/i.test(href)) return 'email';
    if (/^(whatsapp:|https?:[/][/](wa[.]me|api[.]whatsapp[.]com|web[.]whatsapp[.]com)([/?#]|$))/i.test(href)) return 'whatsapp';
    return '';
  }

  function watchSections(items, onSeen) {
    if (!window.IntersectionObserver || !items.length) return;
    var done = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var it = null;
        for (var i = 0; i < items.length; i++) if (items[i].el === en.target) it = items[i];
        if (!it || done[it.key]) return;
        var vh = (en.rootBounds && en.rootBounds.height) || window.innerHeight || 1;
        var seen = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= vh * 0.5);
        if (seen && !it.timer) {
          it.timer = setTimeout(function () { done[it.key] = 1; io.unobserve(it.el); onSeen(it.key); }, 500);
        } else if (!seen && it.timer) {
          clearTimeout(it.timer);
          it.timer = 0;
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    items.forEach(function (it) { io.observe(it.el); });
  }

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
