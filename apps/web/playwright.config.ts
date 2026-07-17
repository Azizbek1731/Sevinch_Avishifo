import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke flow (spec §12): login → register patient → enqueue → call → visit → invoice → pay.
 * Requires API (3001) + web (3000) running against a seeded database.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
