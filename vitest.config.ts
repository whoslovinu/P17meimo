// vitest.config.ts
// Minimal alias config so unit tests can use the same `@/...` import paths
// as the rest of the codebase. We keep the config tiny on purpose — the
// project uses Next.js + tsc as its primary build pipeline; vitest is only
// used for fast mock-based unit tests.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    // The default vitest pool forks a worker per file. That is fine here,
    // but the parent project's Playwright suite also runs through vitest
    // in some CI lanes — restricting `include` keeps things predictable.
    pool: 'threads',
  },
});
