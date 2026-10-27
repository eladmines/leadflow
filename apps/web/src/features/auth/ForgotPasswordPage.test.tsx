import { apiPaths, authMessages, defaultErrorMessages } from '@leadflow/shared';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, callsTo, deferred, me, mockApi, noContent, renderApp } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const requestKey = `POST ${apiPaths.auth.passwordResetRequest}`;
const submitName = 'שליחת קישור לאיפוס';

describe('ForgotPasswordPage', () => {
  it('shows the shared Hebrew validation messages', async () => {
    mockApi({ [meKey]: me(null) });
    const { user } = renderApp('/forgot-password');
    await user.click(await screen.findByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.emailRequired)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/אימייל/), 'dana@');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.emailInvalid)).toBeInTheDocument();
  });

  it.each(['known@example.com', 'nobody@example.com'])(
    'always shows the same neutral confirmation (%s)',
    async (email) => {
      const fetchMock = mockApi({ [meKey]: me(null), [requestKey]: noContent });
      const { user } = renderApp('/forgot-password');
      await user.type(await screen.findByLabelText(/אימייל/), email);
      await user.click(screen.getByRole('button', { name: submitName }));

      expect(
        await screen.findByRole('heading', { name: 'בדקו את תיבת הדואר' }),
      ).toBeInTheDocument();
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('אם הכתובת');
      expect(status).toHaveTextContent('רשומה אצלנו, שלחנו אליה קישור לאיפוס הסיסמה');
      expect(callsTo(fetchMock, 'POST', apiPaths.auth.passwordResetRequest)).toEqual([{ email }]);
    },
  );

  it('maps a server field error inline and a 429 to an alert', async () => {
    let calls = 0;
    mockApi({
      [meKey]: me(null),
      [requestKey]: () =>
        ++calls === 1
          ? apiError(400, 'VALIDATION_ERROR', 'חלק מהשדות אינם תקינים', {
              email: authMessages.emailInvalid,
            })
          : apiError(429, 'RATE_LIMITED', 'Too many'),
    });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText(/אימייל/), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByText(authMessages.emailInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText(/אימייל/)).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByRole('alert')).toHaveTextContent(defaultErrorMessages.RATE_LIMITED);
  });

  it('disables the submit button while sending', async () => {
    const pending = deferred();
    mockApi({ [meKey]: me(null), [requestKey]: () => pending.promise });
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText(/אימייל/), 'dana@example.com');
    await user.click(screen.getByRole('button', { name: submitName }));
    expect(await screen.findByRole('button', { name: 'שולחים…' })).toBeDisabled();
    pending.resolve(noContent());
    expect(await screen.findByRole('heading', { name: 'בדקו את תיבת הדואר' })).toBeInTheDocument();
  });
});
