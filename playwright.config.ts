import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 2,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // VPN + SSH-tunnel to AWS RDS occasionally incurs a 3-5s reconnect on
    // the first request after idle. Stretch the per-action timeout so the
    // suite tolerates that without spuriously failing.
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
  },
  // Generous per-test budget — handles cold Postgres pool re-establishment.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The dev server should already be running (`npm run dev`).
  // Set CI=1 to let Playwright start its own server via webServer.
  webServer: process.env.CI ? {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
  } : undefined,
});
