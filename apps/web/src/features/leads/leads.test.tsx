import {
  apiPaths,
  buildTemplateDraft,
  businessWebPaths,
  type Business,
  type Lead,
  type Site,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { siteBusinessInfo } from '../site/api';
import { timeAgo } from './api';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const leadsKey = `GET ${apiPaths.leads.list(id)}`;
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: crypto.randomUUID(),
  contact: {
    id: crypto.randomUUID(),
    name: 'דנה כהן',
    phone: '+972527654321',
    email: 'dana@example.com',
  },
  stage: { id: crypto.randomUUID(), name: 'חדש', kind: 'OPEN' },
  source: 'website_form',
  sourceUrl: 'http://salon.lvh.me:4100/',
  message: 'אשמח לתור ליום חמישי',
  owner: null,
  expectedValue: null,
  nextActionAt: null,
  tags: [],
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});
const liveSite: Site = {
  id: '7e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  subdomain: 'salon',
  publicUrl: 'http://salon.lvh.me:4100',
  publicDomain: 'lvh.me:4100',
  published: {
    versionId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
    number: 1,
    revision: 0,
    publishedAt: new Date().toISOString(),
  },
  ...buildTemplateDraft('beauty', siteBusinessInfo(testBusiness)),
  pages: [],
  revision: 0,
  status: 'PUBLISHED',
  updatedAt: new Date().toISOString(),
};

describe('leads page', () => {
  it('lists website leads with name, message, call link and source', async () => {
    mockApi({
      [meKey]: me(testUser),
      [leadsKey]: () =>
        json(200, {
          leads: [
            lead(),
            lead({ contact: { ...lead().contact, name: 'רון לוי', email: null }, message: null }),
          ],
        }),
    });
    renderApp(`${businessWebPaths.section(id, 'leads')}?view=list`);
    const list = await screen.findByRole('list', { name: 'פניות' });
    const cards = within(list).getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole('heading', { name: 'דנה כהן' })).toBeInTheDocument();
    expect(within(cards[0]!).getByText('אשמח לתור ליום חמישי')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('link', { name: /052-7654321/ })).toHaveAttribute(
      'href',
      'tel:+972527654321',
    );
    expect(within(cards[0]!).getByText(/טופס באתר/)).toBeInTheDocument();
    expect(within(cards[0]!).getByText('לפני 5 דקות')).toBeInTheDocument();
    expect(within(cards[1]!).queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
  });

  it('previews the latest WhatsApp message instead of the first one', async () => {
    const lastWhatsApp = {
      body: 'שלום, אני רוצה לקבוע תור דחוף',
      direction: 'IN' as const,
      createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    };
    mockApi({
      [meKey]: me(testUser),
      [leadsKey]: () =>
        json(200, {
          leads: [
            lead({ source: 'whatsapp', message: 'בדיקה', lastWhatsApp }),
            lead({
              source: 'whatsapp',
              message: 'היי',
              lastWhatsApp: { ...lastWhatsApp, direction: 'OUT', body: 'בטח, מחר ב-10?' },
            }),
          ],
        }),
    });
    renderApp(`${businessWebPaths.section(id, 'leads')}?view=list`);
    const cards = within(await screen.findByRole('list', { name: 'פניות' })).getAllByRole(
      'article',
    );
    expect(within(cards[0]!).getByText('שלום, אני רוצה לקבוע תור דחוף')).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/הודעה אחרונה מהלקוח/)).toHaveTextContent('לפני 2 דקות');
    expect(within(cards[0]!).queryByText('בדיקה')).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText(/התשובה האחרונה שלכם/)).toBeInTheDocument();
    expect(within(cards[1]!).getByText('בטח, מחר ב-10?')).toBeInTheDocument();
  });

  it('"רענון" reloads the leads now', async () => {
    let calls = 0;
    mockApi({
      [meKey]: me(testUser),
      [leadsKey]: () => {
        calls += 1;
        return json(200, { leads: calls > 1 ? [lead({ message: 'פנייה שהגיעה עכשיו' })] : [] });
      },
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'leads')}?view=list`);
    await screen.findByRole('heading', { name: 'עדיין אין פניות' });
    // Secondary actions sit behind "More" (D-138).
    await user.click(screen.getByRole('button', { name: 'עוד' }));
    await user.click(screen.getByRole('button', { name: 'רענון' }));
    expect(await screen.findByText('פנייה שהגיעה עכשיו')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('עודכן');
  });

  it('empty state points to the live address when the site is published', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.site.site(id)}`]: () => json(200, { site: liveSite }),
    });
    renderApp(businessWebPaths.section(id, 'leads'));
    expect(await screen.findByRole('heading', { name: 'עדיין אין פניות' })).toBeInTheDocument();
    expect(await screen.findByText('salon.lvh.me:4100')).toBeInTheDocument();
  });

  it('empty state has no build-the-site button when nothing is published', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(businessWebPaths.section(id, 'leads'));
    expect(await screen.findByRole('heading', { name: 'עדיין אין פניות' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'לבניית האתר' })).not.toBeInTheDocument();
  });

  it('employees are told they see their assigned leads', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' } as Business }),
    });
    renderApp(businessWebPaths.section(id, 'leads'));
    expect(await screen.findByText('הפניות שהוקצו לך.')).toBeInTheDocument();
    expect(await screen.findByText('כשיוקצו לך פניות, הן יופיעו כאן.')).toBeInTheDocument();
  });
});

describe('contact form settings in the editor', () => {
  it('turns the email field off and autosaves it', async () => {
    const site = { ...liveSite, published: null, status: 'DRAFT' as const };
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.site.site(id)}`]: () => json(200, { site }),
      [`PUT ${apiPaths.site.draft(id)}`]: (body) =>
        json(200, { site: { ...site, ...(body as object), revision: 1 } }),
    });
    const { user } = renderApp(businessWebPaths.section(id, 'site'));
    await user.click(await screen.findByRole('button', { name: /^יצירת קשר/ }));
    expect(screen.getByRole('checkbox', { name: 'הצגת טופס פנייה באתר' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'שדה אימייל' }));
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', apiPaths.site.draft(id)).length).toBe(1), {
      timeout: 3000,
    });
    const sent = callsTo(fetchMock, 'PUT', apiPaths.site.draft(id))[0];
    expect(sent.sections.find((s: { type: string }) => s.type === 'contact').form.askEmail).toBe(
      false,
    );
  });
});

describe('timeAgo', () => {
  it('formats recent times relatively and old ones as dates', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(timeAgo('2026-10-27T11:59:30Z', now)).toBe('עכשיו');
    expect(timeAgo('2026-10-27T10:00:00Z', now)).toBe('לפני שעתיים');
    expect(timeAgo('2026-10-26T12:00:00Z', now)).toBe('אתמול');
    expect(timeAgo('2026-10-27T11:59:00Z', now)).toBe('לפני דקה');
    expect(timeAgo('2026-10-27T07:00:00Z', now)).toBe('לפני 5 שעות');
    expect(timeAgo('2026-10-24T12:00:00Z', now)).toBe('לפני 3 ימים');
    expect(timeAgo('2026-09-01T12:00:00Z', now)).toMatch(/2026/);
  });
});
