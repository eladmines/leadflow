import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The script is plain ES5 text served by the API; run it here the way a browser would.
import { EMBED_SCRIPT } from '../../../../api/src/modules/embed/script';

const SRC = 'https://app.example.com/api/v1/embed/lead.js';
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

  it('sends no consent when the form has no tick box and none is declared implied', async () => {
    document.body.innerHTML = `<form data-simplecatch><input name="name" value="דנה"><input name="phone" value="0527654321"></form>`;
    load();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(sent.find((s) => s.url.endsWith('/lead'))!.body.consent).toBeUndefined();
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
});
