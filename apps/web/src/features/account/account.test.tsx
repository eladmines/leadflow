import { apiPaths, businessWebPaths } from '@leadflow/shared';
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
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;
const path = businessWebPaths.section(testBusiness.id, 'account');

describe('account page', () => {
  it('is reachable from the name in the sidebar', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user, location } = renderApp(businessWebPaths.home(testBusiness.id));
    const nav = (await screen.findAllByRole('navigation', { name: 'ניווט ראשי' }))[0]!
      .parentElement!;
    await user.click(within(nav).getByRole('link', { name: 'החשבון שלי: דנה כהן' }));
    expect(location()).toBe(path);
    expect(await screen.findByRole('heading', { name: 'החשבון שלי' })).toBeInTheDocument();
  });

  it('updates the name and refreshes the greeting', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`PATCH ${apiPaths.auth.profile}`]: (body) =>
        json(200, { user: { ...testUser, ...(body as object) } }),
    });
    const { user } = renderApp(path);
    const name = await screen.findByLabelText('שם מלא');
    await user.clear(name);
    await user.type(name, 'דנה לוי');
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('השם עודכן')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', apiPaths.auth.profile)).toEqual([{ fullName: 'דנה לוי' }]);
  });

  it('changes the password; mismatch is caught locally and a wrong current password inline', async () => {
    let attempt = 0;
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`POST ${apiPaths.auth.password}`]: () =>
        (attempt += 1) === 1
          ? apiError(400, 'VALIDATION_ERROR', 'הסיסמה הנוכחית שגויה', {
              currentPassword: 'הסיסמה הנוכחית שגויה',
            })
          : noContent(),
    });
    const { user } = renderApp(path);
    await user.type(await screen.findByLabelText('סיסמה נוכחית'), 'old-password-1');
    await user.type(screen.getByLabelText('סיסמה חדשה'), 'Brand-new-pass-1');
    await user.type(screen.getByLabelText('אימות הסיסמה החדשה'), 'Brand-new-pass-2');
    await user.click(screen.getByRole('button', { name: 'שינוי סיסמה' }));
    expect(await screen.findByText('הסיסמאות אינן תואמות')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.password)).toHaveLength(0);

    const confirm = screen.getByLabelText('אימות הסיסמה החדשה');
    await user.clear(confirm);
    await user.type(confirm, 'Brand-new-pass-1');
    await user.click(screen.getByRole('button', { name: 'שינוי סיסמה' }));
    expect(await screen.findByText('הסיסמה הנוכחית שגויה')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'שינוי סיסמה' }));
    expect(await screen.findByText('הסיסמה שונתה. שאר המכשירים נותקו.')).toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', apiPaths.auth.password).at(-1)).toEqual({
        currentPassword: 'old-password-1',
        newPassword: 'Brand-new-pass-1',
      }),
    );
  });
});
