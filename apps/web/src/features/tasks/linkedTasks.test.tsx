import {
  apiPaths,
  businessWebPaths,
  taskMessages,
  type Appointment,
  type Business,
  type Lead,
  type Quote,
  type Task,
} from '@simplecatch/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  choose,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testStages,
  testUser,
} from '../../test/utils';
import { toDateInput } from '../appointments/api';

/** F35: tasks linked to a quote or an appointment, automatic follow-ups and their switches. */

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const tp = apiPaths.tasks;
const meKey = `GET ${apiPaths.auth.me}`;
const leadId = '5c000000-0000-4000-8000-000000000001';
const quoteId = '7d000000-0000-4000-8000-000000000001';
const apptId = '9e000000-0000-4000-8000-000000000001';
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const asRole = (role: Business['role']) => ({
  [`GET ${apiPaths.businesses.detail(id)}`]: () =>
    json(200, { business: { ...testBusiness, role } }),
});

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `9b000000-0000-4000-8000-0000000000${String((n += 1) % 100).padStart(2, '0')}`,
  title: 'משימה',
  notes: null,
  dueAt: hours(2),
  status: 'OPEN',
  remind: true,
  completedAt: null,
  assignee: { id: testUser.id, name: 'דנה כהן' },
  lead: { id: leadId, name: 'רון לוי' },
  subject: null,
  autoKind: null,
  createdAt: new Date().toISOString(),
  ...over,
});
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: leadId,
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'רון לוי',
    phone: null,
    email: null,
  },
  stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' },
  source: 'manual',
  sourceUrl: null,
  message: null,
  owner: null,
  value: { won: 0, open: 0 },
  nextTask: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});
const quote = (over: Partial<Quote> = {}): Quote => ({
  id: quoteId,
  number: 12,
  title: 'שיפוץ',
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
  sentAt: hours(-1),
  decidedAt: null,
  createdAt: hours(-2),
  updatedAt: hours(-1),
  ...over,
});
const appt = (over: Partial<Appointment> = {}): Appointment =>
  ({
    id: apptId,
    startsAt: '2030-02-12T08:00:00.000Z',
    endsAt: '2030-02-12T08:30:00.000Z',
    status: 'CONFIRMED',
    notes: null,
    source: 'manual',
    service: null,
    staff: { id: testUser.id, name: 'דנה כהן' },
    customer: { id: '9c000000-0000-4000-8000-000000000001', name: 'רון לוי', phone: null },
    lead: { id: leadId, name: 'רון לוי' },
    createdAt: hours(-1),
    ...over,
  }) as Appointment;

const tasksPage = businessWebPaths.section(id, 'tasks');

describe('task rows show their subject and the automatic badge', () => {
  it('a quote chip, an appointment chip (business time zone), none, and "אוטומטית"', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () =>
        json(200, {
          tasks: [
            task({
              title: 'לחזור לגבי הצעה #12',
              subject: { kind: 'quote', id: quoteId, number: 12, status: 'SENT' },
              autoKind: 'quote_followup',
            }),
            task({
              title: 'לאשר את התור',
              dueAt: hours(3),
              // 08:00 UTC = 10:00 in Israel (winter).
              subject: {
                kind: 'appointment',
                id: apptId,
                startsAt: '2030-02-12T08:00:00.000Z',
                status: 'CANCELLED',
              },
            }),
            task({ title: 'להתקשר', dueAt: hours(4) }),
          ],
        }),
    });
    renderApp(tasksPage);
    const quoteLink = await screen.findByRole('link', { name: 'על הצעה #12, נשלחה' });
    expect(quoteLink).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'quotes')}/${quoteId}`,
    );
    expect(quoteLink).toHaveTextContent('הצעה #12');
    const apptLink = screen.getByRole('link', { name: 'על התור ב־12/02 10:00, בוטל' });
    expect(apptLink.getAttribute('href')).toBe(
      `${businessWebPaths.section(id, 'appointments')}?view=day&date=${toDateInput(new Date('2030-02-12T08:00:00.000Z'))}&appointment=${apptId}`,
    );
    // The badge says it in words, explanation included.
    const auto = screen.getByText('אוטומטית');
    expect(auto.closest('span')).toHaveTextContent(/תיסגר מעצמה כשההצעה תאושר או תידחה/);
    expect(screen.getAllByText('אוטומטית')).toHaveLength(1);
    const plain = screen.getByText('להתקשר').closest('li')!;
    expect(within(plain).queryByRole('link', { name: /^על / })).not.toBeInTheDocument();
  });

  it('the type filter keeps quote follow-ups, appointment confirmations or manual tasks', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () =>
        json(200, {
          tasks: [
            task({ title: 'מעקב הצעה', autoKind: 'quote_followup' }),
            task({ title: 'משימת אישור תור', autoKind: 'appointment_confirm' }),
            task({ title: 'ידנית' }),
          ],
        }),
    });
    const { user, location } = renderApp(tasksPage);
    await screen.findByText('ידנית');
    const filter = screen.getByLabelText('סוג משימה');
    await choose(user, filter, 'מעקב אחרי הצעות');
    expect(location()).toBe(`${tasksPage}?type=quote_followup`);
    expect(screen.getByText('מעקב הצעה')).toBeInTheDocument();
    expect(screen.queryByText('ידנית')).not.toBeInTheDocument();
    await choose(user, filter, 'אישור תורים');
    expect(screen.getByText('משימת אישור תור')).toBeInTheDocument();
    expect(screen.queryByText('מעקב הצעה')).not.toBeInTheDocument();
    await choose(user, filter, 'ידניות');
    expect(screen.getByText('ידנית')).toBeInTheDocument();
    expect(screen.queryByText('משימת אישור תור')).not.toBeInTheDocument();
  });

  it('a type with no open tasks says so', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () => json(200, { tasks: [task({ title: 'ידנית' })] }),
    });
    renderApp(`${tasksPage}?type=quote_followup`);
    expect(
      await screen.findByRole('heading', { name: 'אין משימות פתוחות מהסוג הזה' }),
    ).toBeInTheDocument();
  });
});

describe('linking a task to a quote or an appointment', () => {
  const leadPage = `${businessWebPaths.section(id, 'leads')}/${leadId}`;
  const linkable = {
    [`GET ${apiPaths.quotes.list(id)}`]: () => json(200, { quotes: [quote()] }),
    [`GET ${apiPaths.appointments.list(id)}`]: () => json(200, { appointments: [appt()] }),
  };

  it('"קשור ל…" offers the lead\'s quotes and appointments, one at most', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
        json(200, { lead: lead(), activities: [], relatedLeads: [] }),
      ...linkable,
      [`POST ${tp.list(id)}`]: () => json(201, { task: task() }),
    });
    const { user } = renderApp(leadPage);
    const next = await screen.findByRole('region', { name: 'הפעולה הבאה' });
    await user.click(within(next).getByRole('button', { name: '+ משימה' }));
    const form = within(next).getByRole('form', { name: 'משימה חדשה' });
    await user.type(within(form).getByRole('textbox', { name: 'משימה חדשה' }), 'לשלוח תזכורת');
    const picker = within(form).getByLabelText('קשור ל…');
    await waitFor(() => expect(picker).toBeEnabled());
    // One choice: picking the appointment replaces the quote.
    await choose(user, picker, /^הצעה #12/);
    await choose(user, picker, /^תור 12\/02/);
    expect(picker).toHaveTextContent(/תור 12\/02/);
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', tp.list(id))[0]).toMatchObject({
        title: 'לשלוח תזכורת',
        leadId,
        quoteId: null,
        appointmentId: apptId,
      }),
    );
  });

  it("puts the server's refusal under the link", async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
        json(200, { lead: lead(), activities: [], relatedLeads: [] }),
      ...linkable,
      [`POST ${tp.list(id)}`]: () =>
        apiError(400, 'VALIDATION_ERROR', 'הנתונים אינם תקינים', {
          leadId: taskMessages.subjectOtherLead,
        }),
    });
    const { user } = renderApp(leadPage);
    const next = await screen.findByRole('region', { name: 'הפעולה הבאה' });
    await user.click(within(next).getByRole('button', { name: '+ משימה' }));
    const form = within(next).getByRole('form', { name: 'משימה חדשה' });
    await user.type(within(form).getByRole('textbox', { name: 'משימה חדשה' }), 'לבדוק');
    const picker = within(form).getByLabelText('קשור ל…');
    await waitFor(() => expect(picker).toBeEnabled());
    await choose(user, picker, /^הצעה #12/);
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    expect(await within(form).findByText(taskMessages.subjectOtherLead)).toBeInTheDocument();
  });

  it('editing a task can change its link; another lead drops it', async () => {
    const linked = task({
      title: 'לחזור לרון',
      subject: { kind: 'quote', id: quoteId, number: 12, status: 'SENT' },
    });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () => json(200, { tasks: [linked] }),
      ...linkable,
      [`PATCH ${tp.task(id, linked.id)}`]: () => json(200, { task: linked }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(tasksPage);
    await user.click(await screen.findByRole('button', { name: 'עריכת המשימה: לחזור לרון' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת משימה' });
    const picker = within(dialog).getByLabelText('קשור ל…');
    await waitFor(() => expect(picker).toHaveTextContent(/הצעה #12/));
    await choose(user, picker, /^תור 12\/02/);
    await user.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', tp.task(id, linked.id))[0]).toMatchObject({
        leadId,
        quoteId: null,
        appointmentId: apptId,
      }),
    );
  });

  it('saving without touching the link leaves it alone (an automatic task stays automatic)', async () => {
    const auto = task({
      title: 'לחזור לגבי הצעה #12',
      subject: { kind: 'quote', id: quoteId, number: 12, status: 'SENT' },
      autoKind: 'quote_followup',
    });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () => json(200, { tasks: [auto] }),
      ...linkable,
      [`PATCH ${tp.task(id, auto.id)}`]: () => json(200, { task: auto }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(tasksPage);
    await user.click(
      await screen.findByRole('button', { name: 'עריכת המשימה: לחזור לגבי הצעה #12' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'עריכת משימה' });
    await user.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(callsTo(fetchMock, 'PATCH', tp.task(id, auto.id))).toHaveLength(1));
    const body = callsTo(fetchMock, 'PATCH', tp.task(id, auto.id))[0];
    expect(body).not.toHaveProperty('quoteId');
    expect(body).not.toHaveProperty('appointmentId');
  });
});

describe('the quote and the appointment list their tasks', () => {
  it('the quote view: its tasks and "+ משימה" linked to it', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.quotes.quote(id, quoteId)}`]: () => json(200, { quote: quote() }),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
        json(200, { lead: lead(), activities: [], relatedLeads: [] }),
      [`GET ${tp.list(id)}`]: () =>
        json(200, { tasks: [task({ title: 'לחזור לגבי הצעה #12', autoKind: 'quote_followup' })] }),
      [`POST ${tp.list(id)}`]: () => json(201, { task: task() }),
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'quotes')}/${quoteId}`);
    const list = await screen.findByRole('list', { name: 'משימות על ההצעה' });
    expect(within(list).getByText('לחזור לגבי הצעה #12')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u) === `${tp.list(id)}?quoteId=${quoteId}`),
    ).toBe(true);
    const section = list.closest('section')!;
    await user.click(within(section).getByRole('button', { name: '+ משימה' }));
    const form = within(section).getByRole('form', { name: 'משימה חדשה' });
    // Linked already: no picker.
    expect(within(form).queryByLabelText('קשור ל…')).not.toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'משימה חדשה' }), 'לשלוח דוגמאות');
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', tp.list(id))[0]).toMatchObject({
        title: 'לשלוח דוגמאות',
        leadId,
        quoteId,
        appointmentId: null,
      }),
    );
  });

  it('an empty list says so; a failed one offers to retry', async () => {
    let fail = true;
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.quotes.quote(id, quoteId)}`]: () => json(200, { quote: quote() }),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
        json(200, { lead: lead(), activities: [], relatedLeads: [] }),
      [`GET ${tp.list(id)}`]: () =>
        fail ? apiError(500, 'INTERNAL_ERROR', 'משהו השתבש') : json(200, { tasks: [] }),
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'quotes')}/${quoteId}`);
    expect(await screen.findByText('משהו השתבש')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'נסו שוב' }));
    expect(await screen.findByText('אין משימות על ההצעה הזו.')).toBeInTheDocument();
  });

  it('the appointment opens from a task link and lists its tasks; a change refreshes them', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.appointments.list(id)}`]: () => json(200, { appointments: [appt()] }),
      [`GET ${tp.list(id)}`]: () =>
        json(200, { tasks: [task({ title: 'לאשר את התור', autoKind: 'appointment_confirm' })] }),
      [`PATCH ${apiPaths.appointments.appointment(id, apptId)}`]: () =>
        json(200, { appointment: appt({ status: 'CANCELLED' }) }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const date = toDateInput(new Date(appt().startsAt));
    const { user } = renderApp(
      `${businessWebPaths.section(id, 'appointments')}?view=day&date=${date}&appointment=${apptId}`,
    );
    const dialog = await screen.findByRole('dialog', { name: 'רון לוי' });
    const list = await within(dialog).findByRole('list', { name: 'משימות על התור' });
    expect(within(list).getByText('לאשר את התור')).toBeInTheDocument();
    const taskCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u) === `${tp.list(id)}?appointmentId=${apptId}`)
        .length;
    const before = taskCalls();
    await user.click(within(dialog).getByRole('button', { name: 'ביטול התור' }));
    await waitFor(() =>
      expect(
        callsTo(fetchMock, 'PATCH', apiPaths.appointments.appointment(id, apptId)),
      ).toHaveLength(1),
    );
    // The confirm task closes on the server; the tasks are fetched again.
    await waitFor(() => expect(taskCalls()).toBeGreaterThan(before));
  });
});

describe('automatic tasks switches (Automations page)', () => {
  const automationsKey = `GET ${tp.automations(id)}`;

  it('an owner turns the quote follow-up off', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [automationsKey]: () =>
        json(200, { settings: { quoteFollowUp: true, appointmentConfirm: true } }),
      [`PUT ${tp.automations(id)}`]: () =>
        json(200, { settings: { quoteFollowUp: false, appointmentConfirm: true } }),
    });
    const { user } = renderApp(businessWebPaths.section(id, 'automations'));
    const card = await screen.findByRole('region', { name: 'משימות אוטומטיות' });
    const quoteSwitch = await within(card).findByRole('switch', { name: 'משימת מעקב אחרי הצעה' });
    // The timing, with the weekend rule, in words.
    expect(
      within(card).getByText(/יומיים אחרי השליחה ב־09:00 \(שישי ושבת עוברים ליום ראשון\)/),
    ).toBeInTheDocument();
    expect(quoteSwitch).toHaveAttribute('aria-checked', 'true');
    await user.click(quoteSwitch);
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PUT', tp.automations(id))).toEqual([
        { quoteFollowUp: false, appointmentConfirm: true },
      ]),
    );
    await waitFor(() => expect(quoteSwitch).toHaveAttribute('aria-checked', 'false'));
  });

  it('a manager may change them too', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER') });
    renderApp(businessWebPaths.section(id, 'automations'));
    const card = await screen.findByRole('region', { name: 'משימות אוטומטיות' });
    expect(await within(card).findByRole('switch', { name: 'משימת אישור תור' })).toBeEnabled();
  });

  it('an employee sees them read-only, with the reason', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('EMPLOYEE'),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'EMPLOYEE' }] }),
    });
    renderApp(businessWebPaths.section(id, 'automations'));
    const card = await screen.findByRole('region', { name: 'משימות אוטומטיות' });
    for (const name of ['משימת מעקב אחרי הצעה', 'משימת אישור תור']) {
      expect(await within(card).findByRole('switch', { name })).toBeDisabled();
    }
    expect(
      within(card).getByText('רק בעלי העסק ומנהלים יכולים לשנות את ההגדרות האלה.'),
    ).toBeInTheDocument();
  });
});
