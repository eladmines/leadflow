import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'he-IL',
    trace: 'retain-on-failure',
    // The product tour (D-093) opens on first entry and would cover the screens under test;
    // e2e/tour.spec.ts turns it back on. The specs read the Hebrew copy (the app defaults to
    // English, D-100); e2e/english.spec.ts covers English.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [
            { name: 'leadflow.tour.off', value: '1' },
            { name: 'leadflow.helper.greeted', value: '1' },
            { name: 'leadflow.locale', value: 'he' },
          ],
        },
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Many e2e registrations share one IP, so raise the auth rate limit for this server only.
      // Rate limiting itself is covered by the API integration tests (security.test.ts).
      command: 'pnpm --filter @leadflow/api dev',
      env: { AUTH_RATE_LIMIT_MAX: '1000' },
      url: 'http://localhost:4000/health',
      // Never reuse a running dev server: it has the normal auth rate limit and would make
      // tests flaky. Stop `pnpm dev` before `pnpm e2e`.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @leadflow/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
