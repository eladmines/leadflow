import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // Bundle the workspace contract package; keep real npm deps external.
  noExternal: ['@leadflow/shared'],
  clean: true,
});
