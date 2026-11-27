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

/** D-209: the lead page in cards (tasks, appointments, quotes), the next action on top, two tabs. */

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

describe('lead page layout (D-209)', () => {
  it('has two tabs only, and the tasks, appointments and quotes cards are always shown', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => detail() });
    renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['WhatsApp', 'הערות והיסטוריה']);
    for (const name of ['משימות', 'תורים', 'הצעות מחיר']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    // The empty states.
    expect(await screen.findByText('אין משימות פתוחות לליד הזה.')).toBeInTheDocument();
    expect(await screen.findByText('אין תורים קרובים.')).toBeInTheDocument();
    expect(
      await screen.findByText('אין עדיין הצעות. ערך הליד נקבע לפי הצעות המחיר שלו.'),
    ).toBeInTheDocument();
    // D-207 / D-209: no typed value and no next-action date any more.
    expect(screen.queryByLabelText(/ערך משוער/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('תאריך טיפול הבא')).not.toBeInTheDocument();
  });

  it('the tasks card shows the 3 nearest open tasks and the rest on "show all"', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.tasks.list(id)}`]: () =>
        json(200, {
          tasks: [
            task({ title: 'בעוד שבוע', dueAt: hours(24 * 7) }),
            task({ title: 'באיחור', dueAt: hours(-5) }),
            task({ title: 'בעוד שעה', dueAt: hours(1) }),
            task({ title: 'בוצעה', status: 'DONE', dueAt: hours(-48) }),
            task({ title: 'מחר', dueAt: hours(24) }),
            task({ title: 'בעוד יומיים', dueAt: hours(48) }),
          ],
        }),
    });
    const { user } = renderApp(page);
    const card = await screen.findByRole('region', { name: 'משימות' });
    const list = await within(card).findByRole('list', { name: 'משימות הליד' });
    const titles = () =>
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('p')?.textContent);
    expect(titles()).toEqual(['באיחור', 'בעוד שעה', 'מחר']);
    const more = within(card).getByRole('button', { name: 'הצג הכול (5)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(titles()).toEqual(['באיחור', 'בעוד שעה', 'מחר', 'בעוד יומיים', 'בעוד שבוע']);
    await user.click(within(card).getByRole('button', { name: 'הצגת פחות' }));
    expect(titles()).toHaveLength(3);
  });

  it('the quotes card shows status and total, and the lead value from quotes', async () => {
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
    renderApp(page);
    const card = await screen.findByRole('region', { name: 'הצעות מחיר' });
    expect(within(card).getByText('ערך הליד, לפי הצעות המחיר')).toBeInTheDocument();
    expect(within(card).getByText('נסגר (הצעות שאושרו)').nextElementSibling).toHaveTextContent(
      /2,360/,
    );
    expect(
      within(card).getByText('פתוח (ההצעה האחרונה שנשלחה)').nextElementSibling,
    ).toHaveTextContent(/1,180/);
    const list = await within(card).findByRole('list', { name: 'הצעות המחיר של הליד' });
    const rows = within(list).getAllByRole('listitem');
    // Newest first.
    expect(rows[0]).toHaveTextContent(/מס׳ 1001.*1,180.*נשלחה/);
    expect(rows[1]).toHaveTextContent(/מס׳ 1000.*2,360.*אושרה/);
    expect(within(card).getByRole('link', { name: '+ הצעה' })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'quotes')}/new?leadId=${leadId}`,
    );
  });

  it('the appointments card lists upcoming ones first and "+ תור" opens the booking form', async () => {
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
    const card = await screen.findByRole('region', { name: 'תורים' });
    const list = await within(card).findByRole('list', { name: 'תורי הליד' });
    // Upcoming, nearest first; then the past one.
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('מדידה'),
      expect.stringContaining('התקנה'),
      expect.stringContaining('ביקור קודם'),
    ]);
    await user.click(within(card).getByRole('button', { name: '+ תור' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a card that fails to load says so and can retry; a refusal reads as no permission', async () => {
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
    const tasks = await screen.findByRole('region', { name: 'משימות' });
    expect(await within(tasks).findByRole('alert')).toBeInTheDocument();
    fail = false;
    await user.click(within(tasks).getByRole('button', { name: 'נסו שוב' }));
    expect(await within(tasks).findByText('אין משימות פתוחות לליד הזה.')).toBeInTheDocument();
    const quotes = screen.getByRole('region', { name: 'הצעות מחיר' });
    expect(
      await within(quotes).findByText('אין לך הרשאה לראות את הצעות המחיר של הליד הזה.'),
    ).toBeInTheDocument();
  });
});

describe('next action = the nearest open task (D-209)', () => {
  it('shows the title, due time, assignee and "overdue" in words', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () =>
        detail(
          lead({
            nextTask: {
              id: '9b000000-0000-4000-8000-0000000000f1',
              title: 'להתקשר לגבי ההצעה',
              dueAt: hours(-2),
              assignee: { id: '6e000000-0000-4000-8000-000000000001', name: 'יוסי מזרחי' },
            },
          }),
        ),
    });
    renderApp(page);
    const next = await screen.findByRole('group', { name: 'הפעולה הבאה' });
    expect(next).toHaveTextContent('הפעולה הבאה: להתקשר לגבי ההצעה');
    expect(within(next).getByText(/באיחור/)).toBeInTheDocument();
    expect(within(next).getByText('יוסי מזרחי')).toBeInTheDocument();
    expect(within(next).getByRole('button', { name: '+ משימה' })).toBeInTheDocument();
  });

  it('without one, "+ משימה" opens the form in the tasks card; completing a task refreshes the lead', async () => {
    const open = task({ title: 'לשלוח הצעת מחיר', dueAt: hours(3) });
    let current = lead();
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(current),
      [`GET ${apiPaths.tasks.list(id)}`]: () => json(200, { tasks: [open] }),
      [`PATCH ${apiPaths.tasks.task(id, open.id)}`]: () => {
        current = lead();
        return json(200, { task: { ...open, status: 'DONE' } });
      },
    });
    const { user } = renderApp(page);
    const next = await screen.findByRole('group', { name: 'הפעולה הבאה' });
    expect(next).toHaveTextContent('אין פעולה הבאה');
    await user.click(within(next).getByRole('button', { name: '+ משימה' }));
    const card = screen.getByRole('region', { name: 'משימות' });
    const form = within(card).getByRole('form', { name: 'משימה חדשה' });
    expect(within(form).getByLabelText('משימה חדשה')).toHaveFocus();
    expect(within(card).getByRole('button', { name: '+ משימה' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const before = callsTo(fetchMock, 'GET', lp.detail(id, leadId)).length;
    await user.click(
      await within(card).findByRole('checkbox', { name: 'סימון כבוצעה: לשלוח הצעת מחיר' }),
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, 'GET', lp.detail(id, leadId)).length).toBeGreaterThan(before),
    );
  });
});

describe('old tab links land on the cards (D-209)', () => {
  it.each([
    ['tasks', 'משימות'],
    ['appointments', 'תורים'],
    ['quotes', 'הצעות מחיר'],
  ])('?tab=%s focuses the %s card and drops the parameter', async (tab, name) => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => detail() });
    const { location } = renderApp(`${page}?tab=${tab}`);
    const card = await screen.findByRole('region', { name });
    await waitFor(() => expect(within(card).getByRole('heading', { name })).toHaveFocus());
    await waitFor(() => expect(location()).toBe(page));
    // The page still shows its two tabs, on the default one.
    expect(screen.getByRole('tab', { name: 'הערות והיסטוריה' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
