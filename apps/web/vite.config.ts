import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development so the session cookie stays first-party.
    proxy: {
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
      '/media': 'http://localhost:4000',
    },
  },
});
