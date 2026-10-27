import { apiPaths, authMessages } from '@leadflow/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  me,
  mockApi,
  noContent,
  renderApp,
  testUser,
  VALID_TOKEN,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const verifyKey = `POST ${apiPaths.auth.verifyEmail}`;
const resendKey = `POST ${apiPaths.auth.resendVerification}`;
const tokenRejected = () =>
  apiError(400, 'VALIDATION_ERROR', 'חלק מהשדות אינם תקינים', {
    token: authMessages.tokenInvalid,
  });

describe('VerifyEmailPage', () => {
  it('posts the token exactly once (StrictMode), strips it from the URL and shows success', async () => {
    const fetchMock = mockApi({ [meKey]: me(null), [verifyKey]: noContent });
    const { location } = renderApp(`/verify-email?token=${VALID_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'האימייל אומת' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'המשך ל-LeadFlow' })).toHaveAttribute('href', '/app');
    expect(location()).toBe('/verify-email');
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.verifyEmail)).toEqual([{ token: VALID_TOKEN }]);
  });

  it('refetches /me after verifying, so the banner can disappear', async () => {
    let verified = false;
    const fetchMock = mockApi({
      [meKey]: () => me({ ...testUser, emailVerified: verified })(),
      [verifyKey]: () => {
        verified = true;
        return noContent();
      },
    });
    renderApp(`/verify-email?token=${VALID_TOKEN}`);
    await screen.findByRole('heading', { name: 'האימייל אומת' });
    await waitFor(() => expect(callsTo(fetchMock, 'GET', apiPaths.auth.me).length).toBe(2));
  });

  it.each(['/verify-email', '/verify-email?token=abc'])(
    'shows the invalid-link state for %s without posting',
    async (path) => {
      const fetchMock = mockApi({ [meKey]: me(null) });
      renderApp(path);
      expect(await screen.findByText(authMessages.tokenInvalid)).toBeInTheDocument();
      expect(callsTo(fetchMock, 'POST', apiPaths.auth.verifyEmail)).toHaveLength(0);
    },
  );

  it('offers anonymous visitors a sign-in path when the server rejects the token', async () => {
    mockApi({ [meKey]: me(null), [verifyKey]: tokenRejected });
    renderApp(`/verify-email?token=${VALID_TOKEN}`);
    expect(await screen.findByText(authMessages.tokenInvalid)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'כניסה לחשבון' })).toHaveAttribute(
      'href',
      '/login?next=%2Fapp',
    );
  });

  it('offers a signed-in, unverified user to resend', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [verifyKey]: tokenRejected,
      [resendKey]: noContent,
    });
    const { user } = renderApp(`/verify-email?token=${VALID_TOKEN}`);
    expect(await screen.findByText(authMessages.tokenInvalid)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'שליחה מחדש' }));
    expect(await screen.findByText(/שלחנו קישור חדש אל/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.resendVerification)).toHaveLength(1);
  });

  it('shows success for a used link when the user is already verified', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }), [verifyKey]: tokenRejected });
    renderApp(`/verify-email?token=${VALID_TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'האימייל אומת' })).toBeInTheDocument();
  });
});
