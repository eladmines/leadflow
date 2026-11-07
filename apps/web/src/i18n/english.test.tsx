import { screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The app in English (D-100). Copy evaluated when modules load follows the language of that load,
 * so this file loads a fresh copy of the app after choosing English.
 */
type Utils = typeof import('../test/utils');
let utils: Utils;

beforeAll(async () => {
  vi.resetModules();
  const i18n = await import('.');
  i18n.setLocaleForTests('en');
  i18n.applyDocumentLocale();
  utils = await import('../test/utils');
});
afterAll(async () => {
  vi.unstubAllGlobals();
  (await import('.')).setLocaleForTests('he');
  document.documentElement.dir = 'rtl';
});

describe('English app', () => {
  it('runs left to right with English navigation and dashboard', async () => {
    const { mockApi, me, renderApp, testUser, testBusiness } = utils;
    const { apiPaths, businessWebPaths } = await import('@leadflow/shared');
    mockApi({ [`GET ${apiPaths.auth.me}`]: me(testUser) });
    const { user } = renderApp(businessWebPaths.home(testBusiness.id));
    expect(
      await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), דנה/ }),
    ).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
    for (const topic of [/Sales & marketing/, /Operations/, /Management/]) {
      await user.click(within(nav).getByRole('button', { name: topic }));
    }
    for (const name of [
      'Dashboard',
      'My website',
      'Customers & leads',
      'Tasks',
      'Settings & billing',
    ]) {
      expect(await within(nav).findByRole('link', { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole('heading', { name: 'Getting your business started' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows validation and server messages in English', async () => {
    const { mockApi, renderApp, json } = utils;
    const { apiPaths } = await import('@leadflow/shared');
    mockApi({
      [`GET ${apiPaths.auth.me}`]: () =>
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'יש להתחבר כדי להמשיך' } }),
      [`POST ${apiPaths.auth.login}`]: () =>
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'האימייל או הסיסמה שגויים' } }),
    });
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter an email address')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Email/), 'dana@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'Sup3r-secret-pass!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The email or password is incorrect')).toBeInTheDocument();
  });
});
