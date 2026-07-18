import type { Page } from '@playwright/test';
import { test, expect } from './test-base';

/**
 * Live-stack sanity sweep: after login, every main screen must render without
 * a client-side crash ("Application error") and without generic server-error
 * toasts. Catches API-contract mismatches that typecheck can't see.
 */

const ROUTES = [
  '/uz/dashboard',
  '/uz/reception',
  '/uz/queue',
  '/uz/patients',
  '/uz/appointments',
  '/uz/doctor',
  '/uz/cashier',
  '/uz/invoices',
  '/uz/lab',
  '/uz/services',
  '/uz/staff',
  '/uz/reports',
  '/uz/feedback',
  '/uz/audit',
  '/uz/settings',
];

async function login(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/uz/login');
  await page.getByLabel(/telefon yoki email/i).fill(identifier);
  await page.getByLabel(/parol/i).fill(password);
  await page.getByRole('button', { name: /^kirish$/i }).click();
  await page.waitForURL(/\/(dashboard|platform)/, { timeout: 15_000 });
}

test('owner: all main screens render without crashes', async ({ page }) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await login(page, 'owner@shifomed.uz', 'Demo123!');

  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
    await expect(page.getByText(/server xatosi/i)).toHaveCount(0);
    // The sidebar must be present (layout mounted, session alive).
    await expect(page.getByText('AviShifo').first()).toBeVisible();
  }

  expect(consoleErrors, `Uncaught page errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
});

test('super-admin: platform screens render', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await login(page, 'admin@avishifo.uz', 'Admin123!');
  for (const route of ['/uz/platform/clinics', '/uz/platform/plans', '/uz/platform/analytics']) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
  }
  expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
});
