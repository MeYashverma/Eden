import { defineConfig } from 'vitest/config';

// GitHub Pages hosts the production build under a repository subpath, so all
// asset URLs must be relative (base: './'). No absolute '/assets/...' links.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the sandbox preview proxy host to reach the dev server.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
