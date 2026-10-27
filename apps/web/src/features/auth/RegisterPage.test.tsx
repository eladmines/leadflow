import { apiPaths, authMessages } from '@leadflow/shared';
import { screen } from '@testing-library/react';
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
const registerKey = `POST ${apiPaths.auth.register}`;
const submitName = 'יצירת חשבון';

async function fillValid(user: ReturnType<typeof renderApp>['user']) {
  await user.type(screen.getByLabelText(/שם מלא/), 'דנה כהן');
  await user.type(screen.getByLabelText(/אימייל/), 'dana@example.com');
  await user.type(screen.getByLabelText(/^סיסמה/), 'a-strong-password');
  await user.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
  it('shows the shared Hebrew validation messages', async () => {
    mockApi({ [meKey]: me(null) });
    const { user } = renderApp('/register');
    await user.click(await screen.findByRole('button', { name: submitName }));

    expect(await screen.findByText(authMessages.fullNameRequired)).toBeInTheDocument();
    expect(screen.getByText(authMessages.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(authMessages.passwordRequired)).toBeInTheDocument();
    expect(screen.getByText(authMessages.acceptTermsRequired)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      authMessages.acceptTermsRequired,
    );

    await user.type(screen.getByLabelText(/שם מלא/), 'ד');
    await user.type(screen.getByLabelText(/^סיסמה/), 'short');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.fullNameTooShort)).toBeInTheDocument();
    expect(screen.getByText(authMessages.passwordTooShort)).toBeInTheDocument();
  });

  it('shows the password policy hint and an unchecked terms box with placeholder links', async () => {
    mockApi({ [meKey]: me(null) });
    renderApp('/register');
    expect(await screen.findByLabelText(/^סיסמה/)).toHaveAccessibleDescription('לפחות 10 תווים');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'תנאי השימוש' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'מדיניות הפרטיות' })).toBeInTheDocument();
  });

  it('maps a 409 onto the email field', async () => {
    mockApi({
      [meKey]: me(null),
      [registerKey]: () =>
        apiError(409, 'CONFLICT', 'הפעולה מתנגשת בנתונים קיימים', {
          email: authMessages.emailTaken,
        }),
    });
    const { user, location } = renderApp('/register');
    await screen.findByRole('button', { name: submitName });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: submitName }));

    const email = screen.getByLabelText(/אימייל/);
    expect(await screen.findByText(authMessages.emailTaken)).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(authMessages.emailTaken);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(location()).toBe('/register');
  });

  it('creates the account and lands on the business home with the unverified banner', async () => {
    const fetchMock = mockApi({
      [meKey]: me(null),
      [registerKey]: () => json(201, { user: testUser }),
    });
    const { user, location } = renderApp('/register');
    await screen.findByRole('button', { name: submitName });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: submitName }));

    expect(await screen.findByRole('heading', { name: /שלום, דנה/ })).toBeInTheDocument();
    expect(location()).toBe(testBusinessHome);
    expect(screen.getByRole('heading', { name: 'כדאי לאמת את כתובת האימייל' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.register)).toEqual([
      {
        fullName: 'דנה כהן',
        email: 'dana@example.com',
        password: 'a-strong-password',
        acceptTerms: true,
      },
    ]);
  });

  it('disables the submit button while the account is created', async () => {
    const pending = deferred();
    const fetchMock = mockApi({ [meKey]: me(null), [registerKey]: () => pending.promise });
    const { user } = renderApp('/register');
    await screen.findByRole('button', { name: submitName });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: submitName }));

    const busy = await screen.findByRole('button', { name: 'יוצרים את החשבון…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.register)).toHaveLength(1);
    pending.resolve(json(201, { user: testUser }));
    expect(await screen.findByRole('heading', { name: /שלום/ })).toBeInTheDocument();
  });
});
