import { apiPaths, businessWebPaths, type Appointment, type Service } from '@leadflow/shared';
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
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const ap = apiPaths.appointments;
const meKey = `GET ${apiPaths.auth.me}`;
const page = businessWebPaths.section(id, 'appointments');
const service: Service = {
  id: '9a000000-0000-4000-8000-000000000001',
  name: 'תספורת',
  durationMin: 45,
  price: 120,
  active: true,
};
const today = new Date();
today.setHours(10, 0, 0, 0);
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: '9b000000-0000-4000-8000-000000000001',
  startsAt: today.toISOString(),
  endsAt: new Date(today.getTime() + 45 * 60_000).toISOString(),
  status: 'CONFIRMED',
  notes: null,
  source: 'manual',
  service: { id: service.id, name: service.name },
  staff: { id: testUser.id, name: 'דנה כהן' },
  customer: { id: '9c000000-0000-4000-8000-000000000001', name: 'רון לוי', phone: '+972521112233' },
  lead: null,
  createdAt: today.toISOString(),
  ...over,
});
const members = {
  [`GET ${apiPaths.businesses.members(id)}`]: () =>
    json(200, {
      members: [
        {
          userId: testUser.id,
          fullName: 'דנה כהן',
          email: testUser.email,
          role: 'OWNER',
          joinedAt: testUser.createdAt,
        },
      ],
    }),
};

describe('appointments page', () => {
  it('shows this week with the appointment and today highlighted', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${ap.list(id)}`]: () => json(200, { appointments: [appt()] }),
    });
    renderApp(page);
    expect(await screen.findByRole('button', { name: /רון לוי/ })).toBeInTheDocument();
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(7);
  });

  it('books a new customer with the service duration', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${ap.services(id)}`]: () => json(200, { services: [service] }),
      [`POST ${ap.list(id)}`]: () => json(201, { appointment: appt() }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'תור חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'תור חדש' });
    await user.type(within(dialog).getByLabelText('שם הלקוח'), 'רון לוי');
    await user.type(within(dialog).getByLabelText('טלפון'), '052-1112233');
    await screen.findByRole('option', { name: /תספורת/ });
    await user.selectOptions(within(dialog).getByLabelText('שירות'), service.id);
    expect(within(dialog).getByLabelText('משך (דק׳)')).toHaveValue('45');
    await user.click(within(dialog).getByRole('button', { name: 'קביעת התור' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', ap.list(id))).toHaveLength(1));
    expect(callsTo(fetchMock, 'POST', ap.list(id))[0]).toMatchObject({
      durationMin: 45,
      serviceId: service.id,
      customer: { name: 'רון לוי', phone: '052-1112233' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a clash keeps the dialog open with the server message', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...members,
      [`POST ${ap.list(id)}`]: () =>
        apiError(
          409,
          'CONFLICT',
          'יש כבר תור בזמן הזה לאותו איש צוות. בחרו שעה אחרת או איש צוות אחר.',
        ),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'תור חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'תור חדש' });
    await user.type(within(dialog).getByLabelText('שם הלקוח'), 'רון לוי');
    await user.type(within(dialog).getByLabelText('טלפון'), '052-1112233');
    await user.click(within(dialog).getByRole('button', { name: 'קביעת התור' }));
    expect(await within(dialog).findByText(/יש כבר תור בזמן הזה/)).toBeInTheDocument();
  });

  it('pending website requests are listed and can be confirmed', async () => {
    const request = appt({ status: 'REQUESTED', staff: null, source: 'website' });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${ap.requests(id)}`]: () => json(200, { appointments: [request] }),
      [`PATCH ${ap.appointment(id, request.id)}`]: () => json(200, { appointment: appt() }),
    });
    const { user } = renderApp(page);
    expect(await screen.findByText('בקשות ממתינות לאישור (1)')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /רון לוי/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'רון לוי' });
    expect(within(dialog).getByText(/בקשה מהאתר/)).toBeInTheDocument();
    await screen.findByRole('option', { name: 'דנה כהן' });
    await user.selectOptions(within(dialog).getByLabelText('איש צוות'), testUser.id);
    await user.click(within(dialog).getByRole('button', { name: 'אישור התור' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', ap.appointment(id, request.id))).toEqual([
        { status: 'CONFIRMED', staffId: testUser.id },
      ]),
    );
  });
});
