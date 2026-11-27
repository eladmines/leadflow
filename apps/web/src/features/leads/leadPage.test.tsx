import {
  apiPaths,
  businessWebPaths,
  type Appointment,
  type Lead,
  type LeadDetailResponse,
  type Quote,
  type Task,
} from '@simplecatch/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { choose } from '../../test/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testStages,
  testUser,
} from '../../test/utils';

/**
 * D-211: the simpler lead page. Header, next action, "מה ביקשו" and the conversation/notes tabs are
 * open; quotes, appointments and "עוד פרטים" are folded one-line sections.
 */

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const lp = apiPaths.leads;
const meKey = `GET ${apiPaths.auth.me}`;
const leadsPath = businessWebPaths.section(id, 'leads');
const leadId = '5c000000-0000-4000-8000-000000000001';
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: leadId,
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'רון לוי',
    phone: '+972521112233',
    email: null,
  },
  stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' },
  source: 'manual',
  sourceUrl: null,
  message: 'מבקש הצעת מחיר לשיפוץ מטבח',
  owner: null,
  value: { won: 0, open: 0 },
  nextTask: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});
const detail = (l = lead()) => json(200, { lead: l, activities: [] } satisfies LeadDetailResponse);
const page = `${leadsPath}/${leadId}`;

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `9b000000-0000-4000-8000-0000000000${String((n += 1) % 100).padStart(2, '0')}`,
  title: 'משימה',
  notes: null,
  dueAt: hours(1),
  status: 'OPEN',
  remind: true,
  completedAt: null,
  assignee: { id: testUser.id, name: 'דנה כהן' },
  lead: { id: leadId, name: 'רון לוי' },
  createdAt: new Date().toISOString(),
  ...over,
});
const quote = (over: Partial<Quote> = {}): Quote => ({
  id: '7d000000-0000-4000-8000-000000000001',
  number: 1001,
  title: 'שיפוץ מטבח',
  items: [{ description: 'עבודה', quantity: 1, unitPrice: 100000 }],
  discount: 0,
  vatRate: 18,
  notes: '',
  validUntil: null,
  status: 'SENT',
  expired: false,
  totals: { subtotal: 100000, discount: 0, vat: 18000, total: 118000 },
  lead: { id: leadId },
  customer: { name: 'רון לוי', phone: '+972521112233', email: null },
  publicUrl: null,
  sentAt: hours(-2),
  decidedAt: null,
  createdAt: hours(-3),
  updatedAt: hours(-2),
  ...over,
});
const svc = (name: string) => ({ id: '9f000000-0000-4000-8000-000000000001', name });
const appt = (over: Partial<Appointment> = {}): Appointment =>
  ({
    id: '9e000000-0000-4000-8000-000000000001',
    startsAt: hours(24),
    endsAt: hours(25),
    status: 'CONFIRMED',
    notes: null,
    source: 'manual',
    service: { id: '9f000000-0000-4000-8000-000000000001', name: 'מדידה' },
    staff: { id: testUser.id, name: 'דנה כהן' },
    customer: {
      id: '9c000000-0000-4000-8000-000000000001',
      name: 'רון לוי',
      phone: '+972521112233',
    },
    lead: { id: leadId, name: 'רון לוי' },
    createdAt: hours(-1),
    ...over,
  }) as Appointment;

const activities: LeadDetailResponse['activities'] = [
  {
    id: '7a000000-0000-4000-8000-000000000003',
    type: 'lead.note',
    data: { text: 'ביקש לחזור אחרי 17:00' },
    actor: { id: testUser.id, name: 'דנה כהן' },
    createdAt: hours(-1),
  },
  {
    id: '7a000000-0000-4000-8000-000000000002',
    type: 'lead.stage_changed',
    data: { from: 'חדש', to: 'נוצר קשר' },
    actor: { id: testUser.id, name: 'דנה כהן' },
    createdAt: hours(-2),
  },
  {
    id: '7a000000-0000-4000-8000-000000000001',
    type: 'lead.created',
    data: { source: 'manual' },
    actor: null,
    createdAt: hours(-3),
  },
];
const withActivities = (l = lead()) =>
  json(200, { lead: l, activities } satisfies LeadDetailResponse);
const fold = (name: RegExp) => screen.getByRole('button', { name });

describe('lead page layout (D-211)', () => {
  it('opens with the header, next action, what they asked and two tabs; the rest is folded', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => withActivities() });
    renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    // Header: stage, call and WhatsApp.
    await waitFor(() => expect(screen.getByLabelText('שלב')).toHaveTextContent('חדש'));
    expect(screen.getByRole('link', { name: /052-111-2233|052-1112233/ })).toHaveAttribute(
      'href',
      'tel:+972521112233',
    );
    // WhatsApp isn't connected here: wa.me in a new tab.
    const wa = screen.getAllByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })[0]!;
    expect(wa).toHaveAttribute('href', 'https://wa.me/972521112233');
    expect(screen.getByRole('region', { name: 'הפעולה הבאה' })).toBeInTheDocument();
    const asked = screen.getByRole('region', { name: 'מה ביקשו' });
    expect(within(asked).getByText('מבקש הצעת מחיר לשיפוץ מטבח')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['WhatsApp', 'הערות']);
    // Folded, with a count or summary.
    for (const name of [/^הצעות מחיר/, /^תורים/, /^עוד פרטים/]) {
      expect(fold(name)).toHaveAttribute('aria-expanded', 'false');
    }
    await waitFor(() => expect(fold(/^הצעות מחיר \(0\)/)).toHaveTextContent(/0.*פתוח.*0.*נסגר/));
    expect(fold(/^עוד פרטים/)).toHaveTextContent('ללא אחראי');
    // D-207 / D-209: no typed value and no next-action date.
    expect(screen.queryByLabelText(/ערך משוער/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('תאריך טיפול הבא')).not.toBeInTheDocument();
  });

  it('"הערות" shows only notes; system events are in the history under "עוד פרטים"', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => withActivities() });
    const { user } = renderApp(page);
    const notes = await screen.findByRole('list', { name: 'הערות' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(1);
    expect(within(notes).getByText('ביקש לחזור אחרי 17:00')).toBeInTheDocument();
    expect(screen.queryByText('השלב שונה מ"חדש" ל"נוצר קשר"')).not.toBeInTheDocument();

    const more = fold(/^עוד פרטים/);
    more.focus();
    await user.keyboard('{Enter}');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const history = screen.getByRole('list', { name: 'היסטוריית הליד' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(3);
    expect(within(history).getByText('השלב שונה מ"חדש" ל"נוצר קשר"')).toBeInTheDocument();
    expect(within(history).getByText('הליד נוצר ידנית')).toBeInTheDocument();
    expect(screen.getByLabelText('אחראי')).toBeInTheDocument();
    expect(screen.getByLabelText('תגיות')).toBeInTheDocument();
    await user.keyboard(' ');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('the stage in the header saves at once', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`PATCH ${lp.detail(id, leadId)}`]: () => json(200, { lead: lead() }),
    });
    const { user } = renderApp(page);
    await choose(user, await screen.findByLabelText('שלב'), testStages[1]!.name);
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', lp.detail(id, leadId))).toEqual([
        { stageId: testStages[1]!.id },
      ]),
    );
  });

  it('the quotes section shows the value, statuses and totals, and "+ הצעה"', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(lead({ value: { won: 2360, open: 1180 } })),
      [`GET ${apiPaths.quotes.list(id)}`]: () =>
        json(200, {
          quotes: [
            quote(),
            quote({
              id: '7d000000-0000-4000-8000-000000000002',
              number: 1000,
              status: 'ACCEPTED',
              totals: { subtotal: 200000, discount: 0, vat: 36000, total: 236000 },
              sentAt: hours(-30),
              createdAt: hours(-31),
            }),
          ],
        }),
    });
    const { user } = renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const button = await waitFor(() => fold(/^הצעות מחיר \(2\)/));
    expect(button).toHaveTextContent(/1,180.*פתוח.*2,360.*נסגר/);
    await user.click(button);
    const section = screen.getByRole('region', { name: /^הצעות מחיר/ });
    expect(within(section).getByText('נסגר (הצעות שאושרו)').nextElementSibling).toHaveTextContent(
      /2,360/,
    );
    const rows = within(
      within(section).getByRole('list', { name: 'הצעות המחיר של הליד' }),
    ).getAllByRole('listitem');
    // Newest first.
    expect(rows[0]).toHaveTextContent(/מס׳ 1001.*1,180.*נשלחה/);
    expect(rows[1]).toHaveTextContent(/מס׳ 1000.*2,360.*אושרה/);
    expect(within(section).getByRole('link', { name: '+ הצעה' })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'quotes')}/new?leadId=${leadId}`,
    );
  });

  it('the appointments section lists upcoming ones first and "+ תור" opens the booking form', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.appointments.list(id)}`]: () =>
        json(200, {
          appointments: [
            appt({
              id: '9e000000-0000-4000-8000-000000000002',
              startsAt: hours(-24),
              service: svc('ביקור קודם'),
            }),
            appt({
              id: '9e000000-0000-4000-8000-000000000003',
              startsAt: hours(72),
              service: svc('התקנה'),
            }),
            appt({ service: svc('מדידה') }),
          ],
        }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const button = await waitFor(() => fold(/^תורים \(3\)/));
    expect(button).toHaveTextContent('2 קרובים');
    await user.click(button);
    const section = screen.getByRole('region', { name: /^תורים/ });
    const rows = within(within(section).getByRole('list', { name: 'תורי הליד' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('מדידה'),
      expect.stringContaining('התקנה'),
      expect.stringContaining('ביקור קודם'),
    ]);
    await user.click(within(section).getByRole('button', { name: '+ תור' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a list that fails says so and can retry; a refusal reads as no permission', async () => {
    let fail = true;
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.tasks.list(id)}`]: () =>
        fail ? apiError(500, 'INTERNAL_ERROR', 'משהו השתבש') : json(200, { tasks: [] }),
      [`GET ${apiPaths.quotes.list(id)}`]: () =>
        apiError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו'),
    });
    const { user } = renderApp(page);
    const next = await screen.findByRole('region', { name: 'הפעולה הבאה' });
    await user.click(within(next).getByRole('button', { name: /^כל המשימות/ }));
    expect(await within(next).findByRole('alert')).toBeInTheDocument();
    fail = false;
    await user.click(within(next).getByRole('button', { name: 'נסו שוב' }));
    expect(await within(next).findByText('אין משימות פתוחות לליד הזה.')).toBeInTheDocument();
    await user.click(fold(/^הצעות מחיר/));
    expect(
      await screen.findByText('אין לך הרשאה לראות את הצעות המחיר של הליד הזה.'),
    ).toBeInTheDocument();
  });

  it('on phones a bar offers call, WhatsApp and "+ משימה"', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => detail() });
    const { user } = renderApp(page);
    const bar = await screen.findByRole('navigation', { name: 'פעולות מהירות' });
    expect(bar).toHaveClass('fixed', 'lg:hidden');
    expect(within(bar).getByRole('link', { name: 'התקשרות' })).toHaveAttribute(
      'href',
      'tel:+972521112233',
    );
    expect(within(bar).getByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })).toHaveAttribute(
      'href',
      'https://wa.me/972521112233',
    );
    await user.click(within(bar).getByRole('button', { name: '+ משימה' }));
    const next = screen.getByRole('region', { name: 'הפעולה הבאה' });
    expect(within(next).getByRole('textbox', { name: 'משימה חדשה' })).toHaveFocus();
  });
});

describe('next action = the nearest open task (D-209, D-211)', () => {
  const nextTask = {
    id: '9b000000-0000-4000-8000-0000000000f1',
    title: 'להתקשר לגבי ההצעה',
    dueAt: hours(-2),
    assignee: { id: '6e000000-0000-4000-8000-000000000001', name: 'יוסי מזרחי' },
  };

  it('shows the title, due time, assignee and "overdue" in words; "בוצע" completes it', async () => {
    let current = lead({ nextTask });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(current),
      [`PATCH ${apiPaths.tasks.task(id, nextTask.id)}`]: () => {
        current = lead();
        return json(200, { task: task({ id: nextTask.id, status: 'DONE' }) });
      },
    });
    const { user } = renderApp(page);
    const next = await screen.findByRole('region', { name: 'הפעולה הבאה' });
    expect(within(next).getByText('להתקשר לגבי ההצעה')).toBeInTheDocument();
    expect(within(next).getByText(/באיחור/)).toBeInTheDocument();
    expect(within(next).getByText('יוסי מזרחי')).toBeInTheDocument();
    await user.click(within(next).getByRole('button', { name: 'סימון כבוצעה: להתקשר לגבי ההצעה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', apiPaths.tasks.task(id, nextTask.id))).toEqual([
        { status: 'DONE' },
      ]),
    );
    // The lead is fetched again, and with no open task the empty state shows.
    expect(await within(next).findByText(/אין פעולה הבאה/)).toBeInTheDocument();
  });

  it('"כל המשימות (N)" shows the open tasks nearest first; "+ משימה" opens the form', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.tasks.list(id)}`]: () =>
        json(200, {
          tasks: [
            task({ title: 'בעוד שבוע', dueAt: hours(24 * 7) }),
            task({ title: 'באיחור', dueAt: hours(-5) }),
            task({ title: 'בוצעה', status: 'DONE', dueAt: hours(-48) }),
            task({ title: 'מחר', dueAt: hours(24) }),
          ],
        }),
    });
    const { user } = renderApp(page);
    const next = await screen.findByRole('region', { name: 'הפעולה הבאה' });
    expect(next).toHaveTextContent('אין פעולה הבאה');
    const all = await within(next).findByRole('button', { name: 'כל המשימות (3)' });
    expect(all).toHaveAttribute('aria-expanded', 'false');
    await user.click(all);
    const titles = within(within(next).getByRole('list', { name: 'משימות הליד' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('p')?.textContent);
    expect(titles).toEqual(['באיחור', 'מחר', 'בעוד שבוע']);

    const add = within(next).getByRole('button', { name: '+ משימה' });
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    expect(within(next).getByRole('textbox', { name: 'משימה חדשה' })).toHaveFocus();
  });
});

describe('old tab links open the matching section (D-211)', () => {
  it.each([
    ['tasks', /^כל המשימות/],
    ['appointments', /^תורים/],
    ['quotes', /^הצעות מחיר/],
  ])('?tab=%s opens and focuses it, and drops the parameter', async (tab, name) => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => detail() });
    const { location } = renderApp(`${page}?tab=${tab}`);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const button = screen.getByRole('button', { name });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(button).toHaveFocus());
    await waitFor(() => expect(location()).toBe(page));
    expect(screen.getByRole('tab', { name: 'הערות' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the WhatsApp buttons', () => {
  const threadPath = apiPaths.whatsapp.thread(id, leadId);
  const thread = (over: Record<string, unknown> = {}) => ({
    connected: true,
    messages: [],
    replyUntil: hours(20),
    botPaused: false,
    ...over,
  });

  it('with WhatsApp connected, both open the conversation here and focus the reply box', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${threadPath}`]: () => json(200, thread()),
    });
    const { user, location } = renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const buttons = await screen.findAllByRole('button', { name: 'WhatsApp: מעבר לשיחה בעמוד' });
    // Header and phone bar; no wa.me links.
    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'הערות' })).toHaveAttribute('aria-selected', 'true');

    await user.click(buttons[0]!);
    expect(screen.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('תשובה בוואטסאפ')).toHaveFocus());
    expect(location()).toBe(`${page}?tab=whatsapp`);

    // From the phone bar too, after moving elsewhere.
    await user.click(screen.getByRole('tab', { name: 'הערות' }));
    const bar = screen.getByRole('navigation', { name: 'פעולות מהירות' });
    await user.click(within(bar).getByRole('button', { name: 'WhatsApp: מעבר לשיחה בעמוד' }));
    await waitFor(() => expect(screen.getByLabelText('תשובה בוואטסאפ')).toHaveFocus());
  });

  it('with the reply window closed, the conversation itself gets the focus', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${threadPath}`]: () => json(200, thread({ replyUntil: null })),
    });
    const { user } = renderApp(page);
    await user.click(
      (await screen.findAllByRole('button', { name: 'WhatsApp: מעבר לשיחה בעמוד' }))[0]!,
    );
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveFocus());
  });

  it.each([
    ['not connected', () => json(200, thread({ connected: false }))],
    [
      'connected, but the conversation is on Facebook',
      () => json(200, thread({ channel: 'messenger' })),
    ],
    [
      'no access to the conversation',
      () => apiError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו'),
    ],
  ])('%s: wa.me in a new tab', async (_case, response) => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${threadPath}`]: response,
    });
    renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })).toHaveLength(2),
    );
    for (const link of screen.getAllByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })) {
      expect(link).toHaveAttribute('href', 'https://wa.me/972521112233');
      expect(link).toHaveAttribute('target', '_blank');
    }
    expect(
      screen.queryByRole('button', { name: 'WhatsApp: מעבר לשיחה בעמוד' }),
    ).not.toBeInTheDocument();
  });
});
