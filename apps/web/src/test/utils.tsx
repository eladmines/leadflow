import type { AuthUser, ErrorCode } from '@leadflow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, routerFuture } from '../app/App';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const VALID_TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0_-Z'; // 43 chars

export const testUser: AuthUser = {
  id: '6f1c2b8e-2d3a-4c5b-9e7f-0a1b2c3d4e5f',
  email: 'dana@example.com',
  fullName: 'דנה כהן',
  emailVerified: false,
  createdAt: '2026-10-27T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocked fetch
// ---------------------------------------------------------------------------

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const noContent = () => new Response(null, { status: 204 });

export const apiError = (
  status: number,
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
) => json(status, { error: { code, message, fields, requestId: 'req-test' } });

export const me = (user: AuthUser | null) => () =>
  user ? json(200, { user }) : apiError(401, 'UNAUTHENTICATED', 'יש להתחבר כדי להמשיך');

type Handler = (body: unknown) => Response | Promise<Response>;

/**
 * Stubs global fetch with a route table keyed by "METHOD /path".
 * Unknown routes fail the test loudly. Returns the mock for call assertions.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unmocked request: ${key}`);
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return handler(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Calls made to one route, as parsed JSON bodies. */
export function callsTo(fetchMock: ReturnType<typeof mockApi>, method: string, path: string) {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === path && (init?.method ?? 'GET') === method)
    .map(([, init]) => (typeof init?.body === 'string' ? JSON.parse(init.body) : undefined));
}

/** A response the test resolves by hand, to observe pending states. */
export function deferred() {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" hidden>
      {location.pathname + location.search}
    </output>
  );
}

/** Renders the real route map at `path`, in StrictMode like production. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]} future={routerFuture}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  return {
    user,
    queryClient,
    location: () => screen.getByTestId('location').textContent,
  };
}
