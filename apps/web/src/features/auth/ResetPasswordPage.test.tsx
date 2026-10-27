import { apiPaths, authMessages } from '@leadflow/shared';
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
  VALID_TOKEN,
} from '../../test/utils';
import { resetFormMessages } from './ResetPasswordPage';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const confirmKey = `POST ${apiPaths.auth.passwordResetConfirm}`;
const submitName = 'שמירת הסיסמה';

async function fillPasswords(
  user: ReturnType<typeof renderApp>['user'],
  password: string,
  confirm: string,
) {
  await user.type(await screen.findByLabelText(/^סיסמה חדשה/), password);
  await user.type(screen.getByLabelText(/^אימות הסיסמה/), confirm);
}

describe('ResetPasswordPage', () => {
  it.each(['/reset-password', '/reset-password?token=not-a-real-token'])(
    'shows the invalid-link state for %s without calling the API',
    async (path) => {
      const fetchMock = mockApi({ [meKey]: me(null) });
      renderApp(path);
      expect(await screen.findByText(authMessages.tokenInvalid)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'בקשת קישור חדש לאיפוס' })).toHaveAttribute(
        'href',
        '/forgot-password',
      );
      expect(callsTo(fetchMock, 'POST', apiPaths.auth.passwordResetConfirm)).toHaveLength(0);
    },
  );

  it('removes the token from the address bar', async () => {
    mockApi({ [meKey]: me(null) });
    const { location } = renderApp(`/reset-password?token=${VALID_TOKEN}`);
    expect(await screen.findByLabelText(/^סיסמה חדשה/)).toBeInTheDocument();
    expect(location()).toBe('/reset-password');
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
  });

  it('validates with the shared password rule and the confirmation match', async () => {
    mockApi({ [meKey]: me(null) });
    const { user } = renderApp(`/reset-password?token=${VALID_TOKEN}`);
    await user.click(await screen.findByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.passwordRequired)).toBeInTheDocument();
    expect(screen.getByText(resetFormMessages.confirmRequired)).toBeInTheDocument();

    await fillPasswords(user, 'short', 'different');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.passwordTooShort)).toBeInTheDocument();
    expect(screen.getByText(resetFormMessages.confirmMismatch)).toBeInTheDocument();
  });

  it('shows the invalid-link state when the server rejects the token', async () => {
    mockApi({
      [meKey]: me(null),
      [confirmKey]: () =>
        apiError(400, 'VALIDATION_ERROR', 'חלק מהשדות אינם תקינים', {
          token: authMessages.tokenInvalid,
        }),
    });
    const { user } = renderApp(`/reset-password?token=${VALID_TOKEN}`);
    await fillPasswords(user, 'a-new-strong-password', 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.tokenInvalid)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'בקשת קישור חדש לאיפוס' })).toBeInTheDocument();
  });

  it('maps a server newPassword error inline', async () => {
    mockApi({
      [meKey]: me(null),
      [confirmKey]: () =>
        apiError(400, 'VALIDATION_ERROR', 'חלק מהשדות אינם תקינים', {
          newPassword: authMessages.passwordTooLong,
        }),
    });
    const { user } = renderApp(`/reset-password?token=${VALID_TOKEN}`);
    await fillPasswords(user, 'a-new-strong-password', 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.passwordTooLong)).toBeInTheDocument();
    expect(screen.getByLabelText(/^סיסמה חדשה/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves the password, sends only token + newPassword, and goes to /login with a notice', async () => {
    const pending = deferred();
    const fetchMock = mockApi({ [meKey]: me(null), [confirmKey]: () => pending.promise });
    const { user, location } = renderApp(`/reset-password?token=${VALID_TOKEN}`);
    await fillPasswords(user, 'a-new-strong-password', 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: submitName }));

    expect(await screen.findByRole('button', { name: 'שומרים…' })).toBeDisabled();
    pending.resolve(noContent());

    expect(await screen.findByText('הסיסמה עודכנה. אפשר להתחבר')).toBeInTheDocument();
    expect(location()).toBe('/login');
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.passwordResetConfirm)).toEqual([
      { token: VALID_TOKEN, newPassword: 'a-new-strong-password' },
    ]);
  });
});
