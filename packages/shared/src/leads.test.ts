import { describe, expect, it } from 'vitest';
import { defaultOpeningHours } from './business';
import {
  FORM_TOKEN_PLACEHOLDER,
  LEAD_FORM_PATH,
  agorotToShekels,
  createLeadRequestSchema,
  importCustomerRowSchema,
  leadNextTaskSchema,
  leadSchema,
  leadSubmissionSchema,
  leadValueForStageKind,
  leadValueSchema,
  updateLeadRequestSchema,
} from './leads';
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
      serviceId: null,
      date: null,
      time: null,
    });
  });

  it('an appointment request needs both date and time (F17)', () => {
    const base = { name: 'דנה', phone: '050-1234567', consent: 'on' };
    const half = leadSubmissionSchema.safeParse({ ...base, date: '2030-01-06' });
    expect(half.success).toBe(false);
    expect(half.error?.issues[0]?.message).toMatch(/גם תאריך וגם שעה/);
    expect(
      leadSubmissionSchema.safeParse({ ...base, date: '2030-01-06', time: '25:00' }).success,
    ).toBe(false);
    const ok = leadSubmissionSchema.parse({
      ...base,
      date: '2030-01-06',
      time: '09:30',
      serviceId: 'nope',
    });
    expect(ok).toMatchObject({ date: '2030-01-06', time: '09:30', serviceId: null });
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
      { palette: 'rose', font: 'rubik', logoAssetId: null },
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

describe('D-207/D-209 lead value from quotes, next task', () => {
  const id = '5c000000-0000-4000-8000-000000000001';

  it('rounds agorot to whole shekels, half-up', () => {
    expect(agorotToShekels(0)).toBe(0);
    expect(agorotToShekels(49)).toBe(0);
    expect(agorotToShekels(50)).toBe(1);
    expect(agorotToShekels(123_449)).toBe(1234);
    expect(agorotToShekels(123_450)).toBe(1235);
  });

  it('a board column sums open for OPEN, won for WON and nothing for LOST', () => {
    const v = { won: 700, open: 300 };
    expect(leadValueForStageKind(v, 'OPEN')).toBe(300);
    expect(leadValueForStageKind(v, 'WON')).toBe(700);
    expect(leadValueForStageKind(v, 'LOST')).toBe(0);
  });

  it('the value is read-only: requests drop expectedValue, the import drops value', () => {
    const created = createLeadRequestSchema.parse({
      name: 'דנה',
      phone: '0521234567',
      expectedValue: 1500,
    });
    expect('expectedValue' in created).toBe(false);
    const patch = updateLeadRequestSchema.parse({
      expectedValue: 2000,
      nextActionAt: '2026-11-01T09:00:00.000Z',
      customFields: { [id]: 'x' },
    });
    expect(patch).toEqual({ customFields: { [id]: 'x' } });
    expect(importCustomerRowSchema.parse({ name: 'דנה', value: '1,500' })).toEqual({ name: 'דנה' });
  });

  it('a lead carries its nearest open task, or null', () => {
    const task = {
      id,
      title: 'להתקשר',
      dueAt: '2026-11-01T09:00:00.000Z',
      assignee: { id, name: 'דנה' },
    };
    expect(leadNextTaskSchema.parse(task)).toEqual(task);
    expect(leadSchema.shape.nextTask.parse(null)).toBeNull();
    expect(leadNextTaskSchema.safeParse({ ...task, dueAt: null }).success).toBe(false);
  });

  it('a lead carries a non-negative integer value', () => {
    expect(leadValueSchema.safeParse({ won: 0, open: 1200 }).success).toBe(true);
    expect(leadValueSchema.safeParse({ won: -1, open: 0 }).success).toBe(false);
    expect(leadValueSchema.safeParse({ won: 1.5, open: 0 }).success).toBe(false);
    expect(leadValueSchema.safeParse({ won: 0 }).success).toBe(false);
  });
});
