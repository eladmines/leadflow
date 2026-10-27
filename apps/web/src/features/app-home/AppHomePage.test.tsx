import { apiPaths, defaultErrorMessages } from '@leadflow/shared';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  deferred,
  me,
  mockApi,
  noContent,
  renderApp,
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const resendKey = `POST ${apiPaths.auth.resendVerification}`;
const logoutKey = `POST ${apiPaths.auth.logout}`;

describe('/app placeholder', () => {
  it('greets the user and shows the unverified banner', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp('/app');
    expect(await screen.findByRole('heading', { name: 'שלום, דנה כהן' })).toBeInTheDocument();
    expect(screen.getByText(/מחובר\/ת בתור דנה כהן/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'כדאי לאמת את כתובת האימייל' })).toBeInTheDocument();
    expect(screen.getByText('השלב הבא: הקמת העסק שלך')).toBeInTheDocument();
  });

  it('hides the banner for a verified user', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }) });
    renderApp('/app');
    await screen.findByRole('heading', { name: 'שלום, דנה כהן' });
    expect(screen.queryByRole('region', { name: /לאמת/ })).not.toBeInTheDocument();
  });

  it('logs out, clears the session and goes to /login', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser), [logoutKey]: noContent });
    const { user, location, queryClient } = renderApp('/app');
    await user.click(await screen.findByRole('button', { name: 'התנתקות' }));

    expect(await screen.findByRole('heading', { name: 'כניסה לחשבון' })).toBeInTheDocument();
    expect(location()).toBe('/login');
    expect(queryClient.getQueryData(['auth', 'me'])).toBeNull();
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.logout)).toHaveLength(1);
  });
});

describe('UnverifiedEmailBanner', () => {
  it('resends the verification email and confirms it', async () => {
    const pending = deferred();
    mockApi({ [meKey]: me(testUser), [resendKey]: () => pending.promise });
    const { user } = renderApp('/app');
    await user.click(await screen.findByRole('button', { name: 'שליחה מחדש' }));
    expect(screen.getByRole('button', { name: 'שליחה מחדש' })).toBeDisabled();
    pending.resolve(noContent());

    const done = await screen.findByText(/שלחנו קישור חדש אל/);
    expect(done).toHaveTextContent('dana@example.com');
    expect(done.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the rate-limit error', async () => {
    mockApi({
      [meKey]: me(testUser),
      [resendKey]: () => apiError(429, 'RATE_LIMITED', 'Too many'),
    });
    const { user } = renderApp('/app');
    await user.click(await screen.findByRole('button', { name: 'שליחה מחדש' }));
    expect(await screen.findByText(defaultErrorMessages.RATE_LIMITED)).toBeInTheDocument();
  });
});
