import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: JSX is compiled by esbuild via tsconfig,
// so the React plugin isn't needed for component tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
