import { apiPaths, authMessages, defaultErrorMessages } from '@leadflow/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  deferred,
  json,
  me,
  mockApi,
  renderApp,
  testUser,
  testBusinessHome,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const loginKey = `POST ${apiPaths.auth.login}`;

async function fill(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  if (email) await user.type(screen.getByLabelText(/אימייל/), email);
  if (password) await user.type(screen.getByLabelText(/^סיסמה/), password);
}

describe('LoginPage', () => {
  it('shows the shared Hebrew validation messages', async () => {
    mockApi({ [meKey]: me(null) });
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText(authMessages.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(authMessages.passwordRequired)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/אימייל/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText(authMessages.emailInvalid)).toBeInTheDocument();
  });

  it('renders email and password as LTR inputs and toggles password visibility', async () => {
    mockApi({ [meKey]: me(null) });
    const { user } = renderApp('/login');
    const email = await screen.findByLabelText(/אימייל/);
    const password = screen.getByLabelText(/^סיסמה/);
    expect(email).toHaveAttribute('dir', 'ltr');
    expect(password).toHaveAttribute('dir', 'ltr');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'הצגת הסיסמה' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'הסתרת הסיסמה' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows a 401 as a form-level alert, not a field error', async () => {
    mockApi({
      [meKey]: me(null),
      [loginKey]: () => apiError(401, 'UNAUTHENTICATED', authMessages.invalidCredentials),
    });
    const { user, location } = renderApp('/login');
    await screen.findByRole('button', { name: 'כניסה' });
    await fill(user, 'dana@example.com', 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(authMessages.invalidCredentials);
    expect(screen.getByLabelText(/אימייל/)).not.toHaveAttribute('aria-invalid');
    expect(location()).toBe('/login');
  });

  it('shows the shared rate-limit message on 429', async () => {
    mockApi({
      [meKey]: me(null),
      [loginKey]: () => apiError(429, 'RATE_LIMITED', 'Too many'),
    });
    const { user } = renderApp('/login');
    await screen.findByRole('button', { name: 'כניסה' });
    await fill(user, 'dana@example.com', 'whatever');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(defaultErrorMessages.RATE_LIMITED);
  });

  it('signs in, sends the normalised email, and returns to next', async () => {
    const fetchMock = mockApi({
      [meKey]: me(null),
      [loginKey]: () => json(200, { user: testUser }),
    });
    const { user, location } = renderApp('/login?next=%2Fapp');
    await screen.findByRole('button', { name: 'כניסה' });
    await fill(user, '  Dana@Example.com ', 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));

    expect(await screen.findByRole('heading', { name: /שלום, דנה כהן/ })).toBeInTheDocument();
    expect(location()).toBe(testBusinessHome);
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.login)).toEqual([
      { email: 'dana@example.com', password: 'correct-horse' },
    ]);
  });

  it('lands on /app after sign-in even when next is external', async () => {
    mockApi({
      [meKey]: me(null),
      [loginKey]: () => json(200, { user: testUser }),
    });
    const { user, location } = renderApp('/login?next=https%3A%2F%2Fevil.example');
    await screen.findByRole('button', { name: 'כניסה' });
    await fill(user, 'dana@example.com', 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(location()).toBe('/app'));
  });

  it('disables the submit button while signing in (no double submit)', async () => {
    const pending = deferred();
    const fetchMock = mockApi({ [meKey]: me(null), [loginKey]: () => pending.promise });
    const { user } = renderApp('/login');
    await screen.findByRole('button', { name: 'כניסה' });
    await fill(user, 'dana@example.com', 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));

    const busy = await screen.findByRole('button', { name: 'מתחברים…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.login)).toHaveLength(1);
    pending.resolve(json(200, { user: testUser }));
    expect(await screen.findByRole('heading', { name: /שלום/ })).toBeInTheDocument();
  });
});
