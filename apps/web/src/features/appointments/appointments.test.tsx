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
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  describe('free slots (D-101)', () => {
    // A Monday well in the future, so no slot is in the past.
    const monday = new Date();
    monday.setDate(monday.getDate() + 14 + ((8 - monday.getDay()) % 7));
    monday.setHours(0, 0, 0, 0);
    const ymd = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const at = (h: number, m = 0) =>
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), h, m);
    const slot = (time: string) =>
      screen.queryByRole('button', { name: new RegExp(`^פנוי: קביעת תור ב.* ${time}$`) });

    it('marks open, untaken times as free and books one with its time filled in', async () => {
      mockApi({
        [meKey]: me(testUser),
        ...members,
        [`GET ${ap.list(id)}`]: () =>
          json(200, {
            appointments: [
              appt({ startsAt: at(10).toISOString(), endsAt: at(10, 45).toISOString() }),
            ],
          }),
      });
      const { user } = renderApp(`${page}?view=day&date=${ymd}`);
      await screen.findByRole('button', { name: /רון לוי/ });
      // Opening hours (09:00–18:00) are free except where the appointment is.
      expect(slot('09:30')).toBeInTheDocument();
      expect(slot('10:00')).not.toBeInTheDocument();
      expect(slot('10:30')).not.toBeInTheDocument();
      expect(slot('11:00')).toBeInTheDocument();
      expect(slot('18:00')).not.toBeInTheDocument();

      await user.click(slot('11:00')!);
      const dialog = await screen.findByRole('dialog', { name: 'תור חדש' });
      expect(within(dialog).getByLabelText('תאריך')).toHaveValue(ymd);
      expect(within(dialog).getByLabelText('שעה')).toHaveValue('11:00');
    });

    it('a closed day has no free slots', async () => {
      const saturday = new Date(monday);
      saturday.setDate(monday.getDate() + 5);
      const sat = `${saturday.getFullYear()}-${String(saturday.getMonth() + 1).padStart(2, '0')}-${String(saturday.getDate()).padStart(2, '0')}`;
      mockApi({
        [meKey]: me(testUser),
        ...members,
        [`GET ${ap.list(id)}`]: () => json(200, { appointments: [] }),
      });
      renderApp(`${page}?view=day&date=${sat}`);
      expect(await screen.findByRole('columnheader')).toHaveTextContent('סגור');
      expect(screen.queryAllByRole('button', { name: /^פנוי:/ })).toHaveLength(0);
    });
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
