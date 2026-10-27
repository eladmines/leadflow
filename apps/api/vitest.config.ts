import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one Postgres test database.
    fileParallelism: false,
  },
});
