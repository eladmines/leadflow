import { apiPaths, businessWebPaths, type Notification } from '@leadflow/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { notificationsKey } from './api';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const np = apiPaths.notifications;
const meKey = `GET ${apiPaths.auth.me}`;
const leadId = '5c000000-0000-4000-8000-0000000000bb';

const note = (over: Partial<Notification> = {}): Notification => ({
  id: crypto.randomUUID(),
  type: 'lead.new',
  data: { leadId, name: 'דנה כהן', source: 'website_form' },
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

const bell = () => screen.getAllByRole('button', { name: /^התראות/ })[0]!;

describe('notification bell (D-097)', () => {
  it('shows the unread count and opens what a notification is about', async () => {
    const first = note();
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${np.list(id)}`]: () =>
        json(200, {
          notifications: [
            first,
            note({ type: 'task.due', data: { title: 'להתקשר' }, readAt: new Date().toISOString() }),
          ],
          unreadCount: 1,
        }),
      [`POST ${np.read(id)}`]: () => new Response(null, { status: 204 }),
    });
    const { user, location } = renderApp(businessWebPaths.home(id));
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 1 חדשות'));
    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'התראות' });
    const items = within(panel).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ליד חדש מהאתר');
    expect(items[0]).toHaveTextContent('דנה כהן');
    expect(items[0]).toHaveTextContent('(חדשה)');
    expect(items[1]).toHaveTextContent('הגיע הזמן למשימה');

    await user.click(within(items[0]!).getByRole('button'));
    expect(callsTo(fetchMock, 'POST', np.read(id))).toEqual([{ ids: [first.id] }]);
    await waitFor(() => expect(location()).toBe(`/b/${id}/leads/${leadId}`));
  });

  it('marks everything read', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${np.list(id)}`]: () => json(200, { notifications: [note(), note()], unreadCount: 2 }),
      [`POST ${np.read(id)}`]: () => new Response(null, { status: 204 }),
    });
    const { user } = renderApp(businessWebPaths.home(id));
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 2 חדשות'));
    await user.click(bell());
    await user.click(await screen.findByRole('button', { name: 'סימון הכול כנקרא' }));
    expect(callsTo(fetchMock, 'POST', np.read(id))).toEqual([{}]);
  });

  it('says so when there are none', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(businessWebPaths.home(id));
    await user.click(await waitFor(() => bell()));
    expect(await screen.findByText(/אין התראות עדיין/)).toBeInTheDocument();
  });
});

describe('notification pop-ups (D-097)', () => {
  function setup() {
    let items: Notification[] = [note({ data: { leadId, name: 'ישנה', source: 'website_form' } })];
    mockApi({
      [meKey]: me(testUser),
      [`GET ${np.list(id)}`]: () =>
        json(200, { notifications: items, unreadCount: items.filter((n) => !n.readAt).length }),
      [`POST ${np.read(id)}`]: () => new Response(null, { status: 204 }),
    });
    const app = renderApp(businessWebPaths.home(id));
    const arrive = async (n: Notification) => {
      items = [n, ...items];
      await act(() => app.queryClient.invalidateQueries({ queryKey: notificationsKey(id) }));
    };
    return { ...app, arrive };
  }

  it('pops up only what arrives after the page opened, with a way to open it', async () => {
    const { user, location, arrive } = setup();
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 1 חדשות'));
    // The notification that was already there doesn't pop up.
    expect(screen.queryByRole('button', { name: 'פתיחה' })).not.toBeInTheDocument();

    await arrive(
      note({ type: 'whatsapp.message', data: { leadId, name: 'נועה', preview: 'יש תור מחר?' } }),
    );
    const toast = await screen.findByText('הודעה מנועה');
    const box = toast.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent('יש תור מחר?');
    await user.click(within(box).getByRole('button', { name: 'פתיחה' }));
    await waitFor(() => expect(location()).toBe(`/b/${id}/leads/${leadId}`));
  });

  it('task reminders stay in the bell, and pop-ups can be turned off', async () => {
    const { user, arrive } = setup();
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 1 חדשות'));
    await arrive(note({ type: 'task.due', data: { title: 'להתקשר' } }));
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 2 חדשות'));
    expect(screen.queryByText('הגיע הזמן למשימה')).not.toBeInTheDocument();

    await user.click(bell());
    await user.click(await screen.findByLabelText('הקפצת התראות על פניות והודעות חדשות'));
    await user.keyboard('{Escape}');
    await arrive(note({ data: { leadId, name: 'רון', source: 'website_form' } }));
    await waitFor(() => expect(bell()).toHaveAccessibleName('התראות, 3 חדשות'));
    expect(screen.queryByText('ליד חדש מהאתר')).not.toBeInTheDocument();
  });
});
