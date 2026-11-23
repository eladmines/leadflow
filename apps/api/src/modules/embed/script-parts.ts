/**
 * JavaScript shared by the two page scripts (plain ES5, as text): the one for other websites
 * (script.ts, F30) and the one for SimpleCatch's own sites (site-script.ts, F32). No backslashes or
 * backticks in here: it is pasted into a template string.
 */

/**
 * Which kind of contact link a href is: 'phone', 'email', 'whatsapp' or ''. Taps on those are counted
 * (never their number or address).
 */
export const CLICK_KIND_JS = `
  function clickKind(href) {
    if (/^tel:/i.test(href)) return 'phone';
    if (/^mailto:/i.test(href)) return 'email';
    if (/^(whatsapp:|https?:[/][/](wa[.]me|api[.]whatsapp[.]com|web[.]whatsapp[.]com)([/?#]|$))/i.test(href)) return 'whatsapp';
    return '';
  }
`;

/**
 * watchSections(items, onSeen): items are { el, key }. A section counts once per page view, when at
 * least half of it (or half the screen, for a tall one) has been on screen for half a second.
 */
export const WATCH_SECTIONS_JS = `
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
`;
