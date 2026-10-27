import { describe, expect, it } from 'vitest';
import { defaultOpeningHours } from './business';
import { FORM_TOKEN_PLACEHOLDER, LEAD_FORM_PATH, leadSubmissionSchema } from './leads';
import { renderSiteMessagePage, renderSitePage } from './site-render';
import { buildTemplateDraft, type SiteBusinessInfo } from './site-templates';

const business: SiteBusinessInfo = {
  name: 'מספרת שירן',
  industry: 'beauty',
  phone: '+972501234567',
  address: 'הרצל 10, חיפה',
  serviceAreas: [],
  openingHours: defaultOpeningHours,
};

describe('lead submission schema', () => {
  it('normalises phone and email, blanks optional fields to null', () => {
    expect(
      leadSubmissionSchema.parse({
        name: ' דנה ',
        phone: '050-1234567',
        email: ' Dana@X.com ',
        message: '',
        consent: 'on',
        extra: 'x',
      }),
    ).toEqual({
      name: 'דנה',
      phone: '+972501234567',
      email: 'dana@x.com',
      message: null,
      consent: 'on',
    });
  });

  it.each([
    [{ name: 'דנה', phone: '050-1234567' }, 'consent'],
    [{ name: 'ד', phone: '050-1234567', consent: 'on' }, 'name'],
    [{ name: 'דנה', phone: '123', consent: 'on' }, 'phone'],
    [{ name: 'דנה', phone: '050-1234567', email: 'nope', consent: 'on' }, 'email'],
    [{ name: 'דנה', phone: '050-1234567', message: 'א'.repeat(1001), consent: 'on' }, 'message'],
  ])('rejects %j on %s with a Hebrew message', (input, field) => {
    const r = leadSubmissionSchema.safeParse(input);
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path[0] === field);
    expect(issue?.message).toMatch(/[֐-׿]/);
  });
});

describe('lead form rendering', () => {
  it('renders an accessible form with token placeholder, honeypot and consent', () => {
    const html = renderSitePage(buildTemplateDraft('beauty', business), business);
    expect(html).toContain(`action="${LEAD_FORM_PATH}"`);
    expect(html).toContain(`value="${FORM_TOKEN_PLACEHOLDER}"`);
    expect(html).toContain('name="website"');
    expect(html).toMatch(/<input type="checkbox" name="consent" required>/);
    expect(html).toContain('pattern="[0-9+()\\s\\-]{9,20}"');
    expect(html).not.toMatch(/<script/i);
  });

  it('omits the form and optional fields when disabled', () => {
    const draft = buildTemplateDraft('beauty', business);
    const contact = draft.sections.find((s) => s.type === 'contact');
    if (contact?.type !== 'contact') throw new Error('no contact section');
    contact.form = { ...contact.form, askEmail: false, askMessage: false };
    let html = renderSitePage(draft, business);
    expect(html).toContain('name="phone"');
    expect(html).not.toContain('name="email"');
    expect(html).not.toContain('name="message"');
    contact.form = { ...contact.form, enabled: false };
    html = renderSitePage(draft, business);
    expect(html).not.toContain(LEAD_FORM_PATH);
  });

  it('renders an escaped, noindex message page in the site theme', () => {
    const html = renderSiteMessagePage(
      { palette: 'rose', font: 'rubik' },
      { name: '<b>x</b>' },
      {
        title: 'תודה!',
        text: '<script>',
        items: ['<i>'],
        backLabel: 'חזרה',
      },
    );
    expect(html).toContain('noindex');
    expect(html).not.toMatch(/<script|<b>|<i>/);
    expect(html).toContain('#9b2f52');
  });
});
