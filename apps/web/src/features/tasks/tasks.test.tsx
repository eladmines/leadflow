import {
  apiPaths,
  businessWebPaths,
  type Business,
  type LeadDetailResponse,
  type Task,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { dueLabel, groupTasks } from './api';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const tp = apiPaths.tasks;
const meKey = `GET ${apiPaths.auth.me}`;
const tasksPath = businessWebPaths.section(id, 'tasks');
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `9b000000-0000-4000-8000-00000000000${(n += 1) % 10}`,
  title: 'משימה',
  notes: null,
  dueAt: hours(1),
  status: 'OPEN',
  remind: true,
  completedAt: null,
  assignee: { id: testUser.id, name: 'דנה כהן' },
  lead: null,
  createdAt: new Date().toISOString(),
  ...over,
});

describe('tasks page', () => {
  it('groups open tasks by urgency and marks overdue ones', async () => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 0, 0, 0);
    const tasks = [
      task({
        title: 'להתקשר לרון',
        dueAt: hours(-2),
        lead: { id: '5c000000-0000-4000-8000-000000000001', name: 'רון לוי' },
      }),
      task({
        title: 'לשלוח הצעה',
        dueAt: endOfDay.getTime() > Date.now() + 60_000 ? endOfDay.toISOString() : hours(0.02),
      }),
      task({ title: 'פגישה בשבוע הבא', dueAt: hours(24 * 6) }),
    ];
    mockApi({ [meKey]: me(testUser), [`GET ${tp.list(id)}`]: () => json(200, { tasks }) });
    renderApp(tasksPath);
    const overdue = await screen.findByRole('list', { name: 'באיחור' });
    expect(within(overdue).getByText('להתקשר לרון')).toBeInTheDocument();
    expect(within(overdue).getByText(/באיחור/)).toBeInTheDocument();
    expect(within(overdue).getByRole('link', { name: 'רון לוי' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'היום' })).getByText('לשלוח הצעה'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'בהמשך' })).getByText('פגישה בשבוע הבא'),
    ).toBeInTheDocument();
  });

  it('quick-adds a task with an ISO due time', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`POST ${tp.list(id)}`]: () => json(201, { task: task() }),
    });
    const { user } = renderApp(tasksPath);
    const form = await screen.findByRole('form', { name: 'משימה חדשה' });
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    expect(await within(form).findByText('יש לכתוב מה צריך לעשות')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('משימה חדשה'), 'להתקשר לרונית');
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', tp.list(id))).toHaveLength(1));
    const body = callsTo(fetchMock, 'POST', tp.list(id))[0];
    expect(body).toMatchObject({ title: 'להתקשר לרונית', leadId: null });
    expect(new Date(body.dueAt).getHours()).toBe(9); // default: tomorrow 09:00 local
  });

  it('ticks a task done (optimistic) and saves it', async () => {
    const t = task({ title: 'לשלוח הצעה' });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () => json(200, { tasks: [t] }),
      [`PATCH ${tp.task(id, t.id)}`]: () => json(200, { task: { ...t, status: 'DONE' } }),
    });
    const { user } = renderApp(tasksPath);
    await user.click(await screen.findByRole('checkbox', { name: 'סימון כבוצעה: לשלוח הצעה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', tp.task(id, t.id))).toEqual([{ status: 'DONE' }]),
    );
  });

  it('managers switch between "mine" and the whole team', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'MANAGER' } as Business }),
    });
    const { user } = renderApp(tasksPath);
    await user.click(await screen.findByRole('button', { name: 'של כל הצוות' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === tp.list(id))).toBe(true),
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u) === `${tp.list(id)}?assigneeId=me`)).toBe(
      true,
    );
  });
});

describe('tasks elsewhere', () => {
  it('the lead page lists the lead tasks and adds new ones linked to it', async () => {
    const leadId = '5c000000-0000-4000-8000-000000000001';
    const detail: LeadDetailResponse = {
      lead: {
        id: leadId,
        contact: {
          id: '5d000000-0000-4000-8000-000000000001',
          name: 'רון לוי',
          phone: null,
          email: 'ron@example.com',
        },
        stage: { id: '0a000000-0000-4000-8000-000000000001', name: 'חדש', kind: 'OPEN' },
        source: 'manual',
        sourceUrl: null,
        message: null,
        owner: null,
        expectedValue: null,
        nextActionAt: null,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      activities: [],
    };
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () => json(200, detail),
      [`GET ${tp.list(id)}`]: () => json(200, { tasks: [task({ title: 'לחזור לרון' })] }),
      [`POST ${tp.list(id)}`]: () => json(201, { task: task() }),
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'leads')}/${leadId}`);
    const list = await screen.findByRole('list', { name: 'משימות הליד' });
    expect(within(list).getByText('לחזור לרון')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'משימה חדשה' });
    await user.type(within(form).getByLabelText('משימה חדשה'), 'לשלוח הצעת מחיר');
    await user.click(within(form).getByRole('button', { name: 'הוספה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', tp.list(id))[0]).toMatchObject({
        title: 'לשלוח הצעת מחיר',
        leadId,
      }),
    );
  });

  it('the dashboard shows my overdue and today tasks', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${tp.list(id)}`]: () =>
        json(200, { tasks: [task({ title: 'דחוף', dueAt: hours(-1) })] }),
    });
    renderApp(businessWebPaths.home(id));
    const list = await screen.findByRole('list', { name: 'המשימות שלי להיום' });
    expect(within(list).getByText('דחוף')).toBeInTheDocument();
    expect(screen.getByText('1 באיחור')).toBeInTheDocument();
  });
});

describe('task helpers', () => {
  it('groups and labels by local day', () => {
    const now = new Date(2026, 9, 27, 12, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
    const g = groupTasks(
      [
        task({ dueAt: at(27, 9) }),
        task({ dueAt: at(27, 18) }),
        task({ dueAt: at(28, 9) }),
        task({ status: 'DONE', dueAt: at(26, 9) }),
      ],
      now,
    );
    expect([g.overdue.length, g.today.length, g.upcoming.length, g.done.length]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(dueLabel(at(27, 18), now)).toMatch(/^היום/);
    expect(dueLabel(at(28, 9), now)).toMatch(/^מחר/);
    expect(dueLabel(at(26, 9), now)).toMatch(/^אתמול/);
  });
});
