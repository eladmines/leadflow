import {
  apiPaths,
  businessWebPaths,
  type Business,
  type Invitation,
  type Member,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  json,
  me,
  mockApi,
  noContent,
  renderApp,
  testBusiness,
  testUser,
  VALID_TOKEN,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const tp = apiPaths.team;
const meKey = `GET ${apiPaths.auth.me}`;
const teamPath = businessWebPaths.section(id, 'team');
const emp: Member = {
  userId: '6e000000-0000-4000-8000-000000000001',
  fullName: 'יוסי מזרחי',
  email: 'yossi@example.com',
  role: 'EMPLOYEE',
  joinedAt: testUser.createdAt,
};
const ownerMember: Member = {
  userId: testUser.id,
  fullName: 'דנה כהן',
  email: testUser.email,
  role: 'OWNER',
  joinedAt: testUser.createdAt,
};
const pendingInvite: Invitation = {
  id: '8a000000-0000-4000-8000-000000000001',
  email: 'noa@example.com',
  role: 'MANAGER',
  invitedBy: 'דנה כהן',
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
};
const teamApi = (invitations: Invitation[] = []) => ({
  [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [ownerMember, emp] }),
  [`GET ${tp.invitations(id)}`]: () => json(200, { invitations }),
});

describe('team page (owner)', () => {
  it('invites by email with a role and confirms', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...teamApi(),
      [`POST ${tp.invitations(id)}`]: () => json(201, { invitation: pendingInvite }),
    });
    const { user } = renderApp(teamPath);
    await user.type(await screen.findByLabelText('אימייל'), 'Noa@Example.com');
    await user.selectOptions(screen.getByLabelText('תפקיד'), 'MANAGER');
    await user.click(screen.getByRole('button', { name: 'שליחת הזמנה' }));
    expect(await screen.findByText(/ההזמנה נשלחה אל/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', tp.invitations(id))).toEqual([
      { email: 'noa@example.com', role: 'MANAGER' },
    ]);
  });

  it('shows the server error for an existing member inline', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...teamApi(),
      [`POST ${tp.invitations(id)}`]: () =>
        apiError(409, 'CONFLICT', 'האדם הזה כבר חבר בצוות', { email: 'האדם הזה כבר חבר בצוות' }),
    });
    const { user } = renderApp(teamPath);
    await user.type(await screen.findByLabelText('אימייל'), 'yossi@example.com');
    await user.click(screen.getByRole('button', { name: 'שליחת הזמנה' }));
    expect(await screen.findByText('האדם הזה כבר חבר בצוות')).toBeInTheDocument();
  });

  it('changes a role and removes a member after confirmation; the owner row is fixed', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...teamApi(),
      [`PATCH ${tp.member(id, emp.userId)}`]: noContent,
      [`DELETE ${tp.member(id, emp.userId)}`]: noContent,
    });
    const { user } = renderApp(teamPath);
    const list = await screen.findByRole('list', { name: 'חברי הצוות' });
    expect(within(list).getByText('בעל/ת העסק')).toBeInTheDocument();
    expect(within(list).queryByLabelText('התפקיד של דנה כהן')).not.toBeInTheDocument();

    await user.selectOptions(within(list).getByLabelText('התפקיד של יוסי מזרחי'), 'MANAGER');
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', tp.member(id, emp.userId))).toEqual([{ role: 'MANAGER' }]),
    );

    await user.click(within(list).getByRole('button', { name: 'הסרת יוסי מזרחי מהצוות' }));
    expect(within(list).getByText(/הגישה לעסק תיחסם מיד/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'הסרה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', tp.member(id, emp.userId))).toHaveLength(1),
    );
  });

  it('lists pending invitations with resend and cancel', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...teamApi([pendingInvite]),
      [`POST ${tp.resend(id, pendingInvite.id)}`]: () => json(200, { invitation: pendingInvite }),
      [`DELETE ${tp.invitation(id, pendingInvite.id)}`]: noContent,
    });
    const { user } = renderApp(teamPath);
    const list = await screen.findByRole('list', { name: 'הזמנות ממתינות' });
    expect(within(list).getByText('noa@example.com')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'שליחה שוב' }));
    await user.click(within(list).getByRole('button', { name: 'ביטול ההזמנה של noa@example.com' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', tp.invitation(id, pendingInvite.id))).toHaveLength(1),
    );
    expect(callsTo(fetchMock, 'POST', tp.resend(id, pendingInvite.id))).toHaveLength(1);
  });

  it('managers see the team read-only (no invite form, no role menus)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'MANAGER' } as Business }),
      ...teamApi(),
    });
    renderApp(teamPath);
    expect(await screen.findByRole('list', { name: 'חברי הצוות' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שליחת הזמנה' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('התפקיד של יוסי מזרחי')).not.toBeInTheDocument();
  });
});

describe('accept invitation page', () => {
  const preview = (over: object = {}) => ({
    [`POST ${tp.preview}`]: () =>
      json(200, {
        invite: {
          status: 'valid',
          businessName: 'מספרת שירן',
          email: 'yossi@example.com',
          role: 'EMPLOYEE',
          invitedBy: 'שירן לוי',
          ...over,
        },
      }),
  });
  const path = `/invite?token=${VALID_TOKEN}`;

  it('signed out: shows the invite and links to register (email pre-filled) or log in, coming back here', async () => {
    mockApi({ [meKey]: me(null), ...preview() });
    renderApp(path);
    expect(
      await screen.findByRole('heading', { name: 'הוזמנת להצטרף למספרת שירן' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/שירן לוי הזמין\/ה אותך/)).toBeInTheDocument();
    const register = screen.getByRole('link', { name: 'יצירת חשבון והצטרפות' });
    const href = decodeURIComponent(register.getAttribute('href') ?? '');
    expect(href).toContain(`next=/invite?token=${VALID_TOKEN}`);
    expect(href).toContain('email=yossi@example.com');
    expect(screen.getByRole('link', { name: /התחברות/ })).toHaveAttribute(
      'href',
      expect.stringContaining('next='),
    );
  });

  it('signed in with the invited email: joins and opens the business', async () => {
    const fetchMock = mockApi({
      [meKey]: me({ ...testUser, email: 'yossi@example.com' }),
      ...preview(),
      [`POST ${tp.accept}`]: () => json(200, { businessId: id }),
    });
    const { user, location } = renderApp(path);
    await user.click(await screen.findByRole('button', { name: 'הצטרפות לצוות' }));
    await waitFor(() => expect(location()).toBe(businessWebPaths.home(id)));
    expect(callsTo(fetchMock, 'POST', tp.accept)).toEqual([{ token: VALID_TOKEN }]);
  });

  it('signed in with another email: explains and offers to switch account', async () => {
    mockApi({ [meKey]: me(testUser), ...preview() });
    renderApp(path);
    expect(await screen.findByText('מחובר/ת עם חשבון אחר')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'התנתקות והתחברות עם החשבון הנכון' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הצטרפות לצוות' })).not.toBeInTheDocument();
  });

  it('explains an expired invitation', async () => {
    mockApi({ [meKey]: me(null), ...preview({ status: 'expired' }) });
    renderApp(path);
    expect(await screen.findByText(/תוקף ההזמנה פג/)).toBeInTheDocument();
  });

  it('no token in the link', async () => {
    mockApi({ [meKey]: me(null) });
    renderApp('/invite');
    expect(await screen.findByRole('heading', { name: 'ההזמנה אינה תקפה' })).toBeInTheDocument();
  });
});
