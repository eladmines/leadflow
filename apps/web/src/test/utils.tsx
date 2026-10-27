import {
  apiPaths,
  businessWebPaths,
  defaultOpeningHours,
  type AuthUser,
  type Business,
  type ErrorCode,
} from '@leadflow/shared';
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

export const testBusiness: Business = {
  id: '3a7d9c1e-5b2f-4e8a-9c6d-1f2e3d4c5b6a',
  name: 'מספרת שירן',
  industry: 'beauty',
  phone: '+972501234567',
  address: 'הרצל 10, חיפה',
  serviceAreas: ['חיפה', 'יקנעם'],
  openingHours: defaultOpeningHours,
  timezone: 'Asia/Jerusalem',
  status: 'ACTIVE',
  onboardingStep: 4,
  role: 'OWNER',
  createdAt: '2026-10-27T10:00:00.000Z',
};

export const testStages = [
  { id: '0a000000-0000-4000-8000-000000000001', name: 'חדש', position: 0, kind: 'OPEN' as const },
  {
    id: '0a000000-0000-4000-8000-000000000002',
    name: 'נוצר קשר',
    position: 1,
    kind: 'OPEN' as const,
  },
  { id: '0a000000-0000-4000-8000-000000000003', name: 'נסגר', position: 2, kind: 'WON' as const },
];

/** Where `/app` lands for a user whose only business is `testBusiness`. */
export const testBusinessHome = businessWebPaths.home(testBusiness.id);

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
  // Signed-in flows end at /app, which loads the user's businesses; default to one active business.
  routes = {
    [`GET ${apiPaths.businesses.list}`]: () => json(200, { businesses: [testBusiness] }),
    [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
      json(200, { business: testBusiness }),
    [`GET ${apiPaths.site.site(testBusiness.id)}`]: () => json(200, { site: null }),
    [`GET ${apiPaths.leads.list(testBusiness.id)}`]: () => json(200, { leads: [] }),
    [`GET ${apiPaths.leads.pipeline(testBusiness.id)}`]: () => json(200, { stages: testStages }),
    [`GET ${apiPaths.media.assets(testBusiness.id)}`]: () =>
      json(200, { assets: [], usedBytes: 0, quotaBytes: 200 * 1024 * 1024 }),
    ...routes,
  };
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
