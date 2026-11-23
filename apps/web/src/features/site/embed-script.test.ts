import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The script is plain ES5 text served by the API; run it here the way a browser would.
import { EMBED_SCRIPT } from '../../../../api/src/modules/embed/script';
import { SITE_SCRIPT } from '../../../../api/src/modules/embed/site-script';

const SRC = 'https://app.example.com/api/v1/embed/sc.js';
const sent: { url: string; body: Record<string, unknown> }[] = [];

class FakeXhr {
  url = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  responseText = '{"ok":true}';
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send(body: string) {
    sent.push({ url: this.url, body: JSON.parse(body) });
    queueMicrotask(() => this.onload?.());
  }
}

/** Runs the script as if a `<script src=… data-…>` tag had just loaded on the page. */
function load(attrs: Record<string, string> = {}) {
  const tag = document.createElement('script');
  tag.setAttribute('src', SRC);
  tag.setAttribute('data-key', 'KEY');
  for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v);
  Object.defineProperty(document, 'currentScript', { value: tag, configurable: true });
  new Function(EMBED_SCRIPT)();
}

/** A stand-in for IntersectionObserver: the test decides what is on screen. */
type Entry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
  intersectionRect: { height: number };
  rootBounds: { height: number };
};
const observers: { cb: (e: Entry[]) => void; seen: Element[] }[] = [];
class FakeObserver {
  seen: Element[] = [];
  constructor(public cb: (e: Entry[]) => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.seen.push(el);
  }
  unobserve() {}
}
/** `el` is on screen: this much of it, and this many pixels of a 800px-high screen. */
const show = (el: Element, ratio: number, px: number) =>
  observers.forEach((o) =>
    o.cb([
      {
        target: el,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
        intersectionRect: { height: px },
        rootBounds: { height: 800 },
      },
    ]),
  );

/** Runs the script that sits on SimpleCatch's own sites, loaded from `src`. */
function loadSite(src: string) {
  const tag = document.createElement('script');
  tag.setAttribute('src', src);
  Object.defineProperty(document, 'currentScript', { value: tag, configurable: true });
  new Function(SITE_SCRIPT)();
}

const shopifyForm = `
  <form action="/contact#ContactForm" method="post" id="shop">
    <input name="contact[name]" value="דנה כהן">
    <input name="contact[email]" value="dana@example.com">
    <input name="contact[phone]" value="052-7654321">
    <textarea name="contact[body]">מעוניינת בהצעה</textarea>
    <button type="submit">Send</button>
  </form>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The script listens on `document` and `window`; a real page loads it once, so undo it per test. */
const added: [EventTarget, string, EventListenerOrEventListenerObject, unknown][] = [];
function trackListeners() {
  for (const target of [document, window] as EventTarget[]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
      added.push([target, type, fn as EventListener, opts]);
      original(type, fn as EventListener, opts as AddEventListenerOptions);
    });
  }
}
function untrackListeners() {
  for (const [target, type, fn, opts] of added.splice(0)) {
    target.removeEventListener(type, fn, opts as EventListenerOptions);
  }
}

describe('embed script (F30, F31)', () => {
  beforeEach(() => {
    trackListeners();
    sent.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    untrackListeners();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('counts one visit per session, with the ad it came from', () => {
    history.replaceState(null, '', '/sale?gclid=SECRET&utm_campaign=summer&junk=1');
    load();
    load(); // a second page in the same tab
    const visits = sent.filter((s) => s.url.endsWith('/api/v1/embed/visit'));
    expect(visits).toHaveLength(1);
    expect(visits[0]!.body).toMatchObject({
      key: 'KEY',
      params: { gclid: 'SECRET', utm_campaign: 'summer' },
      page: `${location.origin}/sale`,
    });
    expect(visits[0]!.body.params).not.toHaveProperty('junk');
  });

  it("sends a Shopify contact form's fields with the ad, then lets Shopify have it too", async () => {
    history.replaceState(null, '', '/?utm_source=google&utm_medium=cpc&utm_campaign=summer');
    document.body.innerHTML = shopifyForm;
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    load({
      'data-forms': "form[action*='/contact']",
      'data-consent-implied': '',
      'data-passthrough': '',
    });
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const lead = sent.find((s) => s.url.endsWith('/api/v1/embed/lead'))!;
    expect(lead.body).toMatchObject({
      key: 'KEY',
      name: 'דנה כהן',
      email: 'dana@example.com',
      phone: '052-7654321',
      message: 'מעוניינת בהצעה',
      consent: 'on',
      params: { utm_campaign: 'summer', utm_source: 'google' },
    });
    expect(String(lead.body.id)).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(submit).toHaveBeenCalledTimes(1);
    // The form is kept, not replaced by a thank-you.
    expect(document.querySelector('form#shop')).not.toBeNull();
  });

  it("leaves a form without a phone field alone (a newsletter box on Shopify's /contact address)", async () => {
    document.body.innerHTML = `<form action="/contact#footer" method="post"><input name="contact[email]" value="a@b.co"><button type="submit">Join</button></form>`;
    load({ 'data-forms': "form[action*='/contact']", 'data-passthrough': '' });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const ev = new Event('submit', { cancelable: true });
    document.querySelector('form')!.dispatchEvent(ev);
    await flush();
    expect(ev.defaultPrevented).toBe(false);
    expect(sent.some((s) => s.url.endsWith('/lead'))).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('a form with data-simplecatch sends our field names and shows the thank-you', async () => {
    document.body.innerHTML = `
      <div><form data-simplecatch data-success="תודה!">
        <input name="name" value="דנה"><input name="phone" value="0527654321">
        <input type="checkbox" name="consent" checked>
        <button type="submit">Send</button>
      </form></div>`;
    load();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const lead = sent.find((s) => s.url.endsWith('/lead'))!;
    expect(lead.body).toMatchObject({ name: 'דנה', phone: '0527654321', consent: 'on' });
    expect(document.querySelector('form')).toBeNull();
    expect(document.body.textContent).toContain('תודה!');
  });

  it('a form with no tick box at all: sending it is asking to be contacted, so consent is on', async () => {
    document.body.innerHTML = `<form data-simplecatch><input name="name" value="דנה"><input name="phone" value="0527654321"></form>`;
    load();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(sent.find((s) => s.url.endsWith('/lead'))!.body.consent).toBe('on');
  });

  describe('sections (F32)', () => {
    beforeEach(() => {
      observers.length = 0;
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());
    const leave = () => window.dispatchEvent(new Event('pagehide'));
    it('counts a named section once, after half a second with half of it on screen', () => {
      document.body.innerHTML = `<section id="p" data-sc-section="pricing"></section><section id="f"></section><section id="x" data-sc-section="seen-too-short"></section>`;
      history.replaceState(null, '', '/sale/');
      load({ 'data-track-sections': '#f=faq; [[bad=oops' });
      const [pricing, faq, short] = ['p', 'f', 'x'].map((id) => document.getElementById(id)!);
      show(pricing!, 0.3, 100); // not enough of it
      vi.advanceTimersByTime(600);
      show(pricing!, 0.6, 300); // half of it
      show(faq!, 0.2, 500); // a tall section: more than half the screen counts
      show(short!, 1, 300);
      vi.advanceTimersByTime(300);
      show(short!, 0, 0); // gone before half a second
      vi.advanceTimersByTime(600);
      show(pricing!, 1, 300); // again: not counted twice
      vi.advanceTimersByTime(600);
      leave();
      expect(sent.filter((s) => s.url.endsWith('/event')).at(-1)!.body.events).toEqual(
        expect.arrayContaining([
          { k: 'section', l: '/sale/#pricing' },
          { k: 'section', l: '/sale/#faq' },
        ]),
      );
      const sections = sent
        .flatMap((s) => (s.body.events as { k: string; l: string }[] | undefined) ?? [])
        .filter((e) => e.k === 'section');
      expect(sections).toHaveLength(2);
    });

    it('on a SimpleCatch site: reports section ids, scroll and taps to its own address, under a path too', () => {
      document.body.innerHTML = `<header id="s-hero"></header><main><section id="s-abc"></section><section id="s-def"></section></main><a id="t" href="tel:+972501234567">Call</a><a id="w" href="https://wa.me/9725">W</a><a id="o" href="https://wa.me.evil.example/">no</a>`;
      history.replaceState(null, '', '/s/salon/about');
      loadSite('/s/salon/__sc.js');
      const els = ['s-hero', 's-abc', 's-def'].map((id) => document.getElementById(id)!);
      show(els[1]!, 1, 700);
      vi.advanceTimersByTime(600);
      show(els[0]!, 1, 700);
      vi.advanceTimersByTime(600);
      document.getElementById('t')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.getElementById('w')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.getElementById('o')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      leave();
      expect(sent.map((s) => s.url)).toEqual(['/s/salon/__sc', '/s/salon/__sc', '/s/salon/__sc']);
      expect(sent[0]!.body).toEqual({ p: '/about', ev: [{ k: 'click', l: 'phone' }] });
      expect(sent[1]!.body).toEqual({ p: '/about', ev: [{ k: 'click', l: 'whatsapp' }] });
      expect(sent[2]!.body).toEqual({
        p: '/about',
        ev: [
          { k: 'scroll', l: '50' },
          { k: 'scroll', l: '90' },
        ],
        sec: ['s-abc', 's-hero'],
      });
    });

    it('counts a tap inside a section, for a SimpleCatch site and for a section the owner named', () => {
      // SimpleCatch: the section's own element id, with the contact kind in the same request.
      document.body.innerHTML = `<main><section id="s-abc"><p id="p">Text</p><a id="t" href="tel:+972501234567">Call</a></section></main><a id="out" href="/">Home</a>`;
      history.replaceState(null, '', '/');
      loadSite('/__sc.js');
      document.getElementById('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.getElementById('t')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.getElementById('out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(sent.map((s) => s.body)).toEqual([
        { p: '/', ev: [], clk: 's-abc' },
        { p: '/', ev: [{ k: 'click', l: 'phone' }], clk: 's-abc' },
      ]);

      // An external site: a section the owner named.
      sent.length = 0;
      document.body.innerHTML = `<div id="faq" data-sc-section="faq"><button id="b">Open</button></div><p id="x">x</p>`;
      history.replaceState(null, '', '/help');
      load();
      sent.length = 0;
      document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.getElementById('x')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(
        sent
          .filter((s) => s.url.endsWith('/api/v1/embed/event'))
          .flatMap((s) => s.body.events as { k: string; l: string }[]),
      ).toEqual([{ k: 'sclick', l: '/help#faq' }]);
    });

    it('on a SimpleCatch site at its own address the path is the page path', () => {
      document.body.innerHTML = `<main><section id="s-abc"></section></main>`;
      history.replaceState(null, '', '/');
      loadSite('/__sc.js');
      show(document.getElementById('s-abc')!, 1, 700);
      vi.advanceTimersByTime(600);
      leave();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ url: '/__sc', body: { p: '/', sec: ['s-abc'] } });
    });
  });

  describe('behavior (F32)', () => {
    const events = () =>
      sent
        .filter((s) => s.url.endsWith('/api/v1/embed/event'))
        .flatMap((s) => s.body.events as { k: string; l?: string }[]);

    it('counts the page, and for a first page also the landing page and the device', () => {
      history.replaceState(null, '', '/sale/');
      load();
      expect(events()).toEqual([
        { k: 'page', l: '/sale/' },
        { k: 'landing', l: '/sale/' },
        { k: 'device', l: 'desktop' },
      ]);
      sent.length = 0;
      load(); // the next page in the same session
      expect(events()).toEqual([{ k: 'page', l: '/sale/' }]);
    });

    it('counts a tap on phone, WhatsApp and email links, and nothing else', () => {
      document.body.innerHTML = `
        <a id="t" href="tel:+972501234567"><span id="in">Call</span></a>
        <a id="w" href="https://wa.me/972501234567">WhatsApp</a>
        <a id="m" href="mailto:a@b.co">Mail</a>
        <a id="o" href="https://example.org/">Other</a>`;
      load();
      sent.length = 0;
      for (const id of ['in', 'w', 'm', 'o']) {
        document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      expect(events()).toEqual([
        { k: 'click', l: 'phone' },
        { k: 'click', l: 'whatsapp' },
        { k: 'click', l: 'email' },
      ]);
    });

    it('counts the buttons the owner named, by attribute or by selector (even from an inner element)', () => {
      document.body.innerHTML = `
        <button id="a" data-sc-click="book-appointment"><span id="in">Book</span></button>
        <button id="b" class="buy">Buy</button>
        <button id="c" type="submit" name="go">Not counted</button>
        <div data-sc-click="card"><button id="d" data-sc-click="inner">Nested</button></div>`;
      load({
        'data-track': '#b=buy; button[type=submit][name=go]=; [[broken=oops; .buy=buy-again',
      });
      sent.length = 0;
      for (const id of ['in', 'b', 'c', 'd']) {
        document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      expect(events()).toEqual([
        { k: 'cta', l: 'book-appointment' },
        { k: 'cta', l: 'buy' },
        { k: 'cta', l: 'buy-again' },
        { k: 'cta', l: 'inner' },
        { k: 'cta', l: 'card' },
      ]);
    });

    it('counts a form started once, only in a form the script listens to', () => {
      document.body.innerHTML = `
        <form data-simplecatch><input id="a" name="name"><input id="b" name="phone"></form>
        <form><input id="c" name="q"></form>`;
      load();
      sent.length = 0;
      for (const id of ['c', 'a', 'b']) {
        document.getElementById(id)!.dispatchEvent(new Event('input', { bubbles: true }));
      }
      expect(events()).toEqual([{ k: 'form', l: 'start' }]);
    });

    it('reports how far they scrolled once, when leaving (a page that fits counts as seen)', () => {
      load();
      sent.length = 0;
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pagehide'));
      expect(events()).toEqual([
        { k: 'scroll', l: '50' },
        { k: 'scroll', l: '90' },
      ]);
    });
  });

  describe('forms we did not write: fields found by type, name and label', () => {
    const leadBody = () => sent.find((x) => x.url.endsWith('/api/v1/embed/lead'))!.body;
    const submit = async (form: HTMLFormElement) => {
      const ev = new Event('submit', { cancelable: true, bubbles: true });
      form.dispatchEvent(ev);
      await flush();
      return ev;
    };
    const fill = (root: ParentNode, values: Record<string, string>) => {
      for (const [sel, v] of Object.entries(values)) {
        (root.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement).value = v;
      }
    };

    // A real customer form: short names (n, p, d, e), a date, a trap field, its own way of sending.
    const customerForm = `
      <form id="f" class="rv in" style="--d: 0.08s;">
        <label>שם מלא<input name="n" required="" autocomplete="name"></label>
        <label>מספר טלפון<input name="p" type="tel" required="" autocomplete="tel"></label>
        <label>תאריך האירוע (אופציונלי)<input name="d" type="date"></label>
        <label>פרטי האירוע<textarea name="e" rows="4" required=""></textarea></label>
        <input type="text" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
        <button class="btn" type="submit">שליחת פרטים במייל</button>
        <p id="fmsg" role="status" aria-live="polite"></p>
      </form>`;

    it("reads a customer's own form, adds the other fields to the message, and leaves the page alone", async () => {
      document.body.innerHTML = customerForm;
      // Bound while still empty: a phone field counts by being there, not by having a value.
      load({ 'data-forms': '#f', 'data-copy': '' });
      const form = document.getElementById('f') as HTMLFormElement;
      fill(form, {
        '[name=n]': 'דנה כהן',
        '[name=p]': '052-7654321',
        '[name=d]': '2026-12-15',
        '[name=e]': 'חתונה בגן, כ-120 אורחים',
      });
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      const ev = await submit(form);
      expect(leadBody()).toMatchObject({
        name: 'דנה כהן',
        phone: '052-7654321',
        // The date is none of the standard fields: it rides inside the message, with its label.
        message: 'חתונה בגן, כ-120 אורחים\n\nתאריך האירוע: 2026-12-15',
        // No tick box in the form: sending it is asking to be contacted.
        consent: 'on',
        // The trap field is empty, so this is a person.
        website: '',
      });
      expect(leadBody().email).toBeUndefined();
      // A copy: the form's own handler still runs, nothing is replaced, nothing is shown.
      expect(ev.defaultPrevented).toBe(false);
      expect(document.getElementById('f')).not.toBeNull();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('passes a filled trap field on, so the server drops the bot', async () => {
      document.body.innerHTML = customerForm;
      load({ 'data-forms': '#f', 'data-copy': '' });
      const form = document.getElementById('f') as HTMLFormElement;
      fill(form, { '[name=n]': 'Bot', '[name=p]': '0501234567', '[name=_honey]': 'http://spam' });
      await submit(form);
      expect(leadBody().website).toBe('http://spam');
    });

    it('Contact Form 7 style names, and a Hebrew form with no names at all', async () => {
      document.body.innerHTML = `
        <form id="cf7">
          <input name="your-name"><input name="your-email" type="email"><input name="tel-1" type="tel">
          <textarea name="your-message"></textarea>
          <input type="checkbox" name="acceptance-1"> <button type="submit">Send</button>
        </form>
        <form id="he">
          <label>שם פרטי<input name="f1"></label><label>שם משפחה<input name="f2"></label>
          <label>נייד<input name="f3"></label><label>דואר אלקטרוני<input name="f4"></label>
          <textarea name="f5" aria-label="הודעה"></textarea>
          <label><input type="checkbox" name="f6"> קראתי ואני מאשר/ת את התנאים</label>
          <label><input type="checkbox" name="f7"> שלחו לי עדכונים</label>
        </form>`;
      load({ 'data-forms': '#cf7, #he' });
      const cf7 = document.getElementById('cf7') as HTMLFormElement;
      fill(cf7, {
        '[name=your-name]': 'Dana Cohen',
        '[name=your-email]': 'dana@example.com',
        '[name=tel-1]': '0527654321',
        '[name=your-message]': 'Hello',
      });
      (cf7.querySelector('[name=acceptance-1]') as HTMLInputElement).checked = true;
      await submit(cf7);
      expect(leadBody()).toMatchObject({
        name: 'Dana Cohen',
        email: 'dana@example.com',
        phone: '0527654321',
        message: 'Hello',
        consent: 'on',
      });

      sent.length = 0;
      const he = document.getElementById('he') as HTMLFormElement;
      fill(he, {
        '[name=f1]': 'דנה',
        '[name=f2]': 'כהן',
        '[name=f3]': '0527654321',
        '[name=f4]': 'd@example.com',
        '[name=f5]': 'שלום',
      });
      (he.querySelector('[name=f6]') as HTMLInputElement).checked = true;
      await submit(he);
      expect(leadBody()).toMatchObject({
        name: 'דנה כהן',
        phone: '0527654321',
        email: 'd@example.com',
        message: 'שלום',
        consent: 'on',
      });
      // The second tick box (updates) is neither the consent nor an extra field.
      expect(String(leadBody().message)).not.toContain('עדכונים');
    });

    it('an unticked consent box is not consent, and names we ask for still come first', async () => {
      document.body.innerHTML = `
        <form data-simplecatch>
          <input name="name" value="דנה"><input name="phone" value="0527654321">
          <input name="p" type="tel" value="000"><label><input type="checkbox" name="agree"> אני מאשר</label>
        </form>`;
      load();
      await submit(document.querySelector('form') as HTMLFormElement);
      expect(leadBody()).toMatchObject({ name: 'דנה', phone: '0527654321', consent: '' });
    });

    it('leaves a newsletter box alone, even when the script is pointed at it', async () => {
      document.body.innerHTML = `<form id="nl"><input name="em" type="email" value="a@b.co"><button type="submit">Join</button></form>`;
      load({ 'data-forms': '#nl' });
      const ev = await submit(document.getElementById('nl') as HTMLFormElement);
      expect(ev.defaultPrevented).toBe(false);
      expect(sent.some((x) => x.url.endsWith('/lead'))).toBe(false);
    });
  });
});
