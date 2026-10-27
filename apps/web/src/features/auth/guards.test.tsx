import { apiPaths } from '@leadflow/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, me, mockApi, renderApp, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const meKey = `GET ${apiPaths.auth.me}`;

describe('route guards', () => {
  it('sends an anonymous visitor from /app to /login with next', async () => {
    mockApi({ [meKey]: me(null) });
    const { location } = renderApp('/app');
    expect(await screen.findByRole('heading', { name: 'כניסה לחשבון' })).toBeInTheDocument();
    expect(location()).toBe('/login?next=%2Fapp');
  });

  it('shows a full-page spinner while the session is checked', () => {
    mockApi({ [meKey]: () => new Promise(() => {}) });
    renderApp('/app');
    expect(screen.getByRole('status')).toHaveTextContent('בודקים את פרטי ההתחברות');
  });

  it('shows a retryable error (not a redirect) when /me fails for another reason', async () => {
    mockApi({ [meKey]: () => apiError(500, 'INTERNAL_ERROR', 'אירעה שגיאה') });
    const { location } = renderApp('/app');
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו לבדוק');
    expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument();
    expect(location()).toBe('/app');
  });

  it.each(['/login', '/register', '/forgot-password'])(
    'sends a signed-in user away from %s to /app',
    async (path) => {
      mockApi({ [meKey]: me(testUser) });
      const { location } = renderApp(path);
      expect(await screen.findByRole('heading', { name: /שלום, דנה כהן/ })).toBeInTheDocument();
      expect(location()).toBe('/app');
    },
  );

  it('honours a same-site next for a signed-in user on /login', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { location } = renderApp('/login?next=%2Fapp%3Ftab%3Dleads');
    await waitFor(() => expect(location()).toBe('/app?tab=leads'));
  });

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example'])(
    'ignores the external next %s',
    async (next) => {
      mockApi({ [meKey]: me(testUser) });
      const { location } = renderApp(`/login?next=${encodeURIComponent(next)}`);
      await waitFor(() => expect(location()).toBe('/app'));
    },
  );

  it('redirects / to /login when anonymous', async () => {
    mockApi({ [meKey]: me(null) });
    const anon = renderApp('/');
    await waitFor(() => expect(anon.location()).toBe('/login'));
  });

  it('redirects / to /app when signed in', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { location } = renderApp('/');
    await waitFor(() => expect(location()).toBe('/app'));
  });
});
