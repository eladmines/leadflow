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
import { allFields } from '../../test/leadFields';
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
 * D-220: the lead's name, then one row of tabs — "מידע" (the facts, "תקשורת", "פרטים", related
 * leads and history; selected by default), conversation, notes, tasks, quotes, appointments — each
 * always shown with its count, and a "+" menu. One column on every screen.
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

const tabByName = (name: RegExp) => screen.getByRole('tab', { name });
const openInfo = async (user: { click: (el: Element) => Promise<void> }) =>
  user.click(screen.getByRole('tab', { name: 'מידע' }));

describe('lead page tabs (D-219)', () => {
  it('shows every tab, with counts read out; "מידע" is first and selected', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () =>
        withActivities(lead({ value: { won: 0, open: 1180 } })),
      [`GET ${apiPaths.tasks.list(id)}`]: () =>
        json(200, { tasks: [task({ title: 'להתקשר' }), task({ title: 'לשלוח' })] }),
      [`GET ${apiPaths.quotes.list(id)}`]: () => json(200, { quotes: [quote()] }),
    });
    renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    // D-220: every tab is shown, even empty ones, each with its count.
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(6));
    const labels = screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining([
        'הערות, 1',
        'משימות, 2 פתוחות',
        expect.stringMatching(/^הצעות, 1 · .*1,180.* פתוח$/),
      ]),
    );
    expect(tabByName(/^תורים/)).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'חלקי הליד' })).toBeInTheDocument();
    // "מידע" is first, selected, without a count; no next-action block, header or side panel.
    const info = screen.getAllByRole('tab')[0]!;
    expect(info).toHaveAccessibleName('מידע');
    expect(info).toHaveTextContent(/^מידע$/);
    expect(info).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'הפעולה הבאה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'מאפייני הליד' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^עוד/ })).not.toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    // The conversations are in "תקשורת" (D-221), not in "מידע".
    expect(within(panel).queryByRole('region', { name: 'תקשורת' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'הליד' })).toBeInTheDocument();
  });

  it('arrow keys move between tabs in the reading direction; the tab goes into the address', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => withActivities(),
      [`GET ${apiPaths.tasks.list(id)}`]: () => json(200, { tasks: [task()] }),
      [`GET ${apiPaths.quotes.list(id)}`]: () => json(200, { quotes: [quote()] }),
    });
    const { user, location } = renderApp(page);
    const tasksTab = await screen.findByRole('tab', { name: /^משימות/ });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(6));
    tasksTab.focus();
    // Hebrew is right to left: the next tab is to the left (order: info, communication, tasks,
    // quotes, appointments, notes).
    await user.keyboard('{ArrowLeft}');
    expect(tabByName(/^הצעות/)).toHaveFocus();
    expect(tabByName(/^הצעות/)).toHaveAttribute('aria-selected', 'true');
    expect(location()).toBe(`${page}?tab=quotes`);
    await user.keyboard('{End}');
    expect(tabByName(/^הערות/)).toHaveFocus();
    await user.keyboard('{Home}');
    const first = screen.getAllByRole('tab')[0];
    expect(first).toHaveFocus();
    expect(first).toHaveAccessibleName('מידע');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(tabByName(/^הצעות/)).toHaveAttribute('tabindex', '-1');
  });

  it('"הערות" holds notes only; system events are in the history', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => withActivities() });
    const { user } = renderApp(`${page}?tab=notes`);
    const notes = await screen.findByRole('list', { name: 'הערות' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('השלב שונה מ"חדש" ל"נוצר קשר"')).not.toBeInTheDocument();
    await openInfo(user);
    const history = screen.getByRole('list', { name: 'היסטוריית הליד' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
    expect(within(history).queryByText('ביקש לחזור אחרי 17:00')).not.toBeInTheDocument();
  });

  it('the "+" menu adds a note, a task, a quote, an appointment and opens its tab', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
      [`GET ${apiPaths.appointments.services(id)}`]: () => json(200, { services: [] }),
      [`POST ${apiPaths.tasks.list(id)}`]: () => json(201, { task: task() }),
    });
    const { user, location } = renderApp(page);
    await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    const plus = await screen.findByRole('button', { name: 'הוספה לליד' });
    expect(plus).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(plus);
    expect(screen.getByRole('menuitem', { name: 'הערה' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(plus).toHaveFocus();
    await user.click(plus);
    await user.click(screen.getByRole('menuitem', { name: 'הערה' }));
    expect(tabByName(/^הערות/)).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('הוספת הערה')).toHaveFocus());

    await user.click(plus);
    await user.click(screen.getByRole('menuitem', { name: 'משימה' }));
    expect(tabByName(/^משימות/)).toHaveAttribute('aria-selected', 'true');
    const form = screen.getByRole('form', { name: 'משימה חדשה' });
    expect(within(form).getByRole('textbox', { name: 'משימה חדשה' })).toHaveFocus();
    await user.type(within(form).getByRole('textbox', { name: 'משימה חדשה' }), 'להתקשר');
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', apiPaths.tasks.list(id))).toHaveLength(1),
    );

    await user.click(plus);
    await user.click(screen.getByRole('menuitem', { name: 'תור' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(tabByName(/^תורים/)).toHaveAttribute('aria-selected', 'true');

    await user.click(plus);
    await user.click(screen.getByRole('menuitem', { name: 'הצעת מחיר' }));
    await waitFor(() =>
      expect(location()).toBe(`${businessWebPaths.section(id, 'quotes')}/new?leadId=${leadId}`),
    );
  });

  it('the quotes tab: statuses and totals, "+ הצעה"; the value is at the top of this tab', async () => {
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
    const { user } = renderApp(`${page}?tab=quotes`);
    const list = await screen.findByRole('list', { name: 'הצעות המחיר של הליד' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/מס׳ 1001.*1,180.*נשלחה/);
    expect(rows[1]).toHaveTextContent(/מס׳ 1000.*2,360.*אושרה/);
    expect(screen.getByRole('link', { name: '+ הצעה' })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'quotes')}/new?leadId=${leadId}`,
    );
    // The value sits at the top of the quotes tab only, not in "מידע".
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/1,180.*פתוח · .*2,360.*נסגר/);
    await openInfo(user);
    expect(screen.queryByText('ערך לפי הצעות מחיר')).not.toBeInTheDocument();
  });

  it('the appointments tab lists upcoming ones first and "+ תור" opens the booking form', async () => {
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
    const { user } = renderApp(`${page}?tab=appointments`);
    const tab = await screen.findByRole('tab', { name: 'תורים, 2 קרובים' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    const rows = within(await screen.findByRole('list', { name: 'תורי הליד' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('מדידה'),
      expect.stringContaining('התקנה'),
      expect.stringContaining('ביקור קודם'),
    ]);
    await user.click(screen.getByRole('button', { name: '+ תור' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a list that fails says so and can retry; a refusal reads as no permission', async () => {
    let fail = true;
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.tasks.list(id)}`]: () =>
        fail ? apiError(500, 'INTERNAL_ERROR', 'משהו השתבש') : json(200, { tasks: [] }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'הוספה לליד' }));
    await user.click(screen.getByRole('menuitem', { name: 'משימה' }));
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByRole('alert')).toBeInTheDocument();
    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'נסו שוב' }));
    expect(await within(panel).findByText('אין משימות פתוחות לליד הזה.')).toBeInTheDocument();
  });

  it('a 403 on quotes reads as no permission', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => detail(),
      [`GET ${apiPaths.quotes.list(id)}`]: () =>
        apiError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו'),
    });
    // A tab asked for in the address stays to show its error or no-permission state.
    renderApp(`${page}?tab=quotes`);
    expect(
      await screen.findByText('אין לך הרשאה לראות את הצעות המחיר של הליד הזה.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^הצעות/ })).toHaveAttribute('aria-selected', 'true');
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
    await user.click(within(bar).getByRole('button', { name: '+ משימה' }));
    expect(tabByName(/^משימות/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'משימה חדשה' })).toHaveFocus();
  });
});

describe('old tab links (D-219, D-220)', () => {
  it('?tab=tasks opens the tasks tab when it has tasks', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => withActivities(),
      [`GET ${apiPaths.tasks.list(id)}`]: () => json(200, { tasks: [task()] }),
    });
    renderApp(`${page}?tab=tasks`);
    expect(await screen.findByRole('tab', { name: /^משימות/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it.each(['more', 'history', 'related'])('?tab=%s opens "מידע"', async (old) => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => withActivities() });
    const { location } = renderApp(`${page}?tab=${old}`);
    expect(await screen.findByRole('tab', { name: 'מידע' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('list', { name: 'היסטוריית הליד' })).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe(`${page}?tab=info`));
  });
});

describe('the "מידע" tab (D-220)', () => {
  const threadPath = apiPaths.whatsapp.thread(id, leadId);

  it('wide screens: one column — the facts, "פרטים", related leads, history', async () => {
    asDesktop();
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () =>
        json(200, {
          lead: lead({ tags: ['VIP'], value: { won: 0, open: 1180 } }),
          activities,
          relatedLeads: related,
        }),
      [`GET ${apiPaths.leadFields.list(id)}`]: () => json(200, { fields: allFields }),
      [`GET ${threadPath}`]: () =>
        json(200, {
          connected: true,
          replyUntil: hours(10),
          botPaused: false,
          messages: [
            {
              id: '8a000000-0000-4000-8000-000000000001',
              direction: 'IN',
              body: 'אפשר מחיר?',
              status: 'received',
              sender: null,
              createdAt: hours(-1),
            },
          ],
        }),
    });
    renderApp(page);
    const panel = await screen.findByRole('tabpanel');
    await within(panel).findByRole('heading', { name: 'פרטים' });
    const sections = within(panel)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(sections).toEqual(['הליד', 'פרטים', 'לידים קשורים (2)', 'היסטוריה (2)']);
    expect(screen.queryByRole('complementary', { name: 'מאפייני הליד' })).not.toBeInTheDocument();
    const info = within(panel).getByRole('region', { name: 'הליד' });
    expect(within(info).getByRole('combobox', { name: 'שלב' })).toBeInTheDocument();
    expect(within(info).getByLabelText('אחראי')).toBeInTheDocument();
    expect(within(info).getByText('052-1112233')).toHaveAttribute('dir', 'ltr');
    // No value row and no separate "created" row: when it came is on the source line.
    expect(within(info).queryByText('ערך לפי הצעות מחיר')).not.toBeInTheDocument();
    expect(within(info).queryByText('נוצר')).not.toBeInTheDocument();
    // D-222: no tags, even when the lead still has some.
    expect(within(info).queryByText('VIP')).not.toBeInTheDocument();
    expect(within(info).getByText('מה ביקשו').nextElementSibling).toHaveTextContent(
      'מבקש הצעת מחיר לשיפוץ מטבח',
    );
    // "ממתין לתשובה שלך" moved to "תקשורת" (D-221).
    expect(within(panel).queryByText(/^ממתין לתשובה שלך:/)).not.toBeInTheDocument();
    expect(
      await within(within(panel).getByRole('region', { name: 'פרטים' })).findByLabelText(
        'דגם הרכב',
      ),
    ).toBeInTheDocument();
    // The conversation is in "תקשורת", with the new message counted.
    expect(await screen.findByRole('tab', { name: 'תקשורת, 1 הודעות חדשות' })).toBeInTheDocument();
    const links = within(screen.getByRole('list', { name: 'לידים קשורים' })).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', `${leadsPath}/${related[0]!.id}`);
    expect(links[0]).toHaveTextContent(/נסגר.*3,000/);
    expect(
      within(screen.getByRole('list', { name: 'היסטוריית הליד' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    // No bottom bar on wide screens.
    expect(screen.queryByRole('navigation', { name: 'פעולות מהירות' })).not.toBeInTheDocument();
  });

  it('opening a related lead starts fresh; nothing shows without related leads', async () => {
    const other = lead({ id: related[0]!.id, message: 'הזמנה קודמת' });
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () =>
        json(200, { lead: lead(), activities: [], relatedLeads: related }),
      [`GET ${lp.detail(id, other.id)}`]: () =>
        json(200, { lead: other, activities: [], relatedLeads: [] }),
    });
    const { user, location } = renderApp(page);
    const list = await screen.findByRole('list', { name: 'לידים קשורים' });
    await user.click(within(list).getAllByRole('link')[0]!);
    await waitFor(() => expect(location()).toBe(`${leadsPath}/${related[0]!.id}`));
    expect(await screen.findByText('הזמנה קודמת')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'לידים קשורים' })).not.toBeInTheDocument();
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
    // The phone bar; no wa.me links.
    expect(buttons).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /^WhatsApp/ })).not.toBeInTheDocument();
    // D-220/D-221: "תקשורת" is always there, even before the first message.
    expect(screen.getByRole('tab', { name: 'תקשורת' })).toBeInTheDocument();

    await user.click(buttons[0]!);
    expect(screen.getByRole('tab', { name: 'תקשורת' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('תשובה בוואטסאפ')).toHaveFocus());
    expect(location()).toBe(`${page}?tab=communication&channel=whatsapp`);

    // From the phone bar too, after moving elsewhere.
    await user.click(screen.getByRole('button', { name: 'הוספה לליד' }));
    await user.click(screen.getByRole('menuitem', { name: 'הערה' }));
    expect(screen.getByRole('tab', { name: /^הערות/ })).toHaveAttribute('aria-selected', 'true');
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
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'WhatsApp' })).toHaveFocus());
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
      // The phone bar.
      expect(screen.getAllByRole('link', { name: 'WhatsApp: פתיחה בחלון חדש' })).toHaveLength(1),
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

/** Wide screens (≥ lg): jsdom has no layout, so the media query is answered here. */
const asDesktop = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1024px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));

const related = [
  {
    id: '5c000000-0000-4000-8000-000000000002',
    stage: { id: testStages[2]!.id, name: testStages[2]!.name, kind: 'WON' as const },
    createdAt: '2026-03-10T10:00:00.000Z',
    value: { won: 3000, open: 0 },
  },
  {
    id: '5c000000-0000-4000-8000-000000000003',
    stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' as const },
    createdAt: '2026-06-01T10:00:00.000Z',
    value: { won: 0, open: 0 },
  },
];

describe('no header (D-220): the name, then the tabs', () => {
  const threadPath = apiPaths.whatsapp.thread(id, leadId);
  const withContact = (over: Partial<Lead> = {}) =>
    detail(
      lead({
        contact: {
          id: '5d000000-0000-4000-8000-000000000001',
          name: 'רון לוי',
          phone: '+972521112233',
          email: 'ron@example.com',
        },
        ...over,
      }),
    );

  it.each([
    ['WhatsApp not connected: the call is primary', false],
    ['WhatsApp connected: WhatsApp is primary', true],
  ])('wide screens, %s', async (_, connected) => {
    asDesktop();
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () =>
        withContact({
          owner: { id: testUser.id, name: 'דנה כהן' },
          attribution: { source: 'google_ads', campaign: 'חורף', seenAt: new Date().toISOString() },
        }),
      [`GET ${threadPath}`]: () =>
        json(200, { connected, messages: [], replyUntil: null, botPaused: false }),
    });
    renderApp(page);
    const heading = await screen.findByRole('heading', { name: 'רון לוי', level: 1 });
    // Nothing between the name and the tabs: no avatar, icon buttons, stage badge or meta line.
    expect(heading.closest('header')).toBeNull();
    expect(heading.nextElementSibling).toContainElement(screen.getByRole('tablist'));
    expect(screen.queryByText(/^הגיע מ־/)).not.toBeInTheDocument();
    const info = screen.getByRole('region', { name: 'הליד' });
    const call = within(info).getByRole('link', { name: 'התקשרות ל־052-1112233' });
    expect(call).toHaveAttribute('href', 'tel:+972521112233');
    expect(within(info).getByRole('link', { name: 'מייל ל־ron@example.com' })).toHaveAttribute(
      'href',
      'mailto:ron@example.com',
    );
    // Filled = primary; the others are outlined.
    await waitFor(() => expect(call.className.includes('bg-brand-600')).toBe(!connected));
    expect(within(info).getByRole('combobox', { name: 'אחראי' })).toBeInTheDocument();
    expect(within(info).getByText('מקור').nextElementSibling).toHaveTextContent(/Google Ads/);
  });

  it('phone and email are copied from "מידע", and the copy is announced', async () => {
    // user-event puts its own clipboard on `navigator` (readable back below).
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => withContact() });
    const { user } = renderApp(page);
    const section = await screen.findByRole('region', { name: 'הליד' });
    expect(within(section).getByText('ron@example.com')).toHaveAttribute('dir', 'ltr');
    await user.click(within(section).getByRole('button', { name: 'העתקת אימייל' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('ron@example.com');
    expect(await within(section).findByText('הועתק')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'העתקת טלפון' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('052-1112233');
  });
});

describe('"תקשורת" with channel sub-tabs (D-221)', () => {
  const threadPath = apiPaths.whatsapp.thread(id, leadId);
  const msg = (n: number, over: Record<string, unknown> = {}) => ({
    id: `8b000000-0000-4000-8000-00000000000${n}`,
    direction: 'IN',
    body: `הודעה ${n}`,
    status: 'received',
    sender: null,
    createdAt: hours(n - 10),
    ...over,
  });
  const withEmail = () =>
    detail(
      lead({
        contact: {
          id: '5d000000-0000-4000-8000-000000000001',
          name: 'רון לוי',
          phone: '+972521112233',
          email: 'ron@example.com',
        },
      }),
    );

  it("waiting banner on top; opens on the latest message's channel; Facebook only with messages", async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => withEmail(),
      [`GET ${threadPath}`]: () =>
        json(200, {
          connected: true,
          replyUntil: hours(10),
          botPaused: false,
          channel: 'messenger',
          messages: [msg(1), msg(2, { channel: 'messenger', body: 'שאלה מפייסבוק' })],
        }),
    });
    const { user, location } = renderApp(`${page}?tab=communication`);
    const comm = await screen.findByRole('tab', { name: 'תקשורת, 2 הודעות חדשות' });
    expect(comm).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/^ממתין לתשובה שלך:/)).toBeInTheDocument();
    const sub = screen.getByRole('tablist', { name: 'ערוצי תקשורת' });
    expect(
      within(sub)
        .getAllByRole('tab')
        .map((t) => t.getAttribute('aria-label')),
    ).toEqual(['WhatsApp, 1 הודעות חדשות', 'אימייל', 'פייסבוק, 1 הודעות חדשות']);
    // The latest message is on Facebook: its conversation, with the reply box.
    expect(within(sub).getByRole('tab', { name: /^פייסבוק/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('שאלה מפייסבוק')).toBeInTheDocument();
    expect(screen.queryByText('הודעה 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('תשובה בפייסבוק')).toBeInTheDocument();

    // Keyboard: Home → WhatsApp; its messages, no reply box (replies go to Facebook), wa.me.
    within(sub)
      .getByRole('tab', { name: /^פייסבוק/ })
      .focus();
    await user.keyboard('{Home}');
    const wa = within(sub).getByRole('tab', { name: /^WhatsApp/ });
    expect(wa).toHaveFocus();
    expect(wa).toHaveAttribute('aria-selected', 'true');
    expect(location()).toBe(`${page}?tab=communication&channel=whatsapp`);
    expect(screen.getByText('הודעה 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('תשובה בוואטסאפ')).not.toBeInTheDocument();
    expect(screen.getByText(/נשלחת ב־Facebook Messenger/)).toBeInTheDocument();
    // Hebrew is right to left: the next sub-tab is to the left.
    await user.keyboard('{ArrowLeft}');
    expect(within(sub).getByRole('tab', { name: 'אימייל' })).toHaveFocus();
    expect(await screen.findByText('אין עדיין מיילים עם הליד.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ מייל ron@example.com' })).toHaveAttribute(
      'href',
      'mailto:ron@example.com',
    );
  });

  it('?channel= opens that channel; Instagram shows when connected; nothing waiting, no banner', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, leadId)}`]: () => withEmail(),
      [`GET ${apiPaths.channels.list(id)}`]: () =>
        json(200, {
          whatsapp: { channel: 'whatsapp', connected: true, name: null, source: null },
          messenger: { channel: 'messenger', connected: false, name: null, source: null },
          instagram: { channel: 'instagram', connected: true, name: 'shop', source: 'business' },
          gmail: { channel: 'email', connected: false, name: null, source: null },
          email: { channel: 'email', connected: false, name: null, source: null },
          emailInbound: false,
          facebookLogin: true,
          gmailLogin: false,
        }),
      [`GET ${threadPath}`]: () =>
        json(200, {
          connected: true,
          replyUntil: null,
          botPaused: false,
          messages: [msg(1, { direction: 'OUT', status: 'read' })],
        }),
    });
    renderApp(`${page}?tab=communication&channel=email`);
    const sub = await screen.findByRole('tablist', { name: 'ערוצי תקשורת' });
    expect(await within(sub).findByRole('tab', { name: 'Instagram' })).toBeInTheDocument();
    expect(within(sub).queryByRole('tab', { name: /^פייסבוק/ })).not.toBeInTheDocument();
    expect(within(sub).getByRole('tab', { name: 'אימייל' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'תקשורת' })).toBeInTheDocument();
    expect(screen.queryByText(/^ממתין לתשובה שלך:/)).not.toBeInTheDocument();
  });

  it('old ?tab=whatsapp opens "תקשורת" on WhatsApp', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lp.detail(id, leadId)}`]: () => detail() });
    const { location } = renderApp(`${page}?tab=whatsapp`);
    expect(await screen.findByRole('tab', { name: 'תקשורת' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(location()).toBe(`${page}?tab=communication&channel=whatsapp`));
  });
});
