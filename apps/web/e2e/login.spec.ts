import { test, expect } from '@playwright/test';

/**
 * Regression for the "Server error. Try again later" login bug:
 * POST /auth/login returns { user, accessToken } only — the form must fetch
 * clinic/branches from /auth/me instead of assuming they are in the login body.
 * Runs against a live stack (API :3001 + web :3000 + seeded DB).
 */
test('owner logs in and lands on the dashboard', async ({ page }) => {
  await page.goto('/uz/login');
  await page.getByLabel(/telefon yoki email/i).fill('owner@shifomed.uz');
  await page.getByLabel(/parol/i).fill('Demo123!');
  await page.getByRole('button', { name: /^kirish$/i }).click();

  await page.waitForURL('**/uz/dashboard', { timeout: 15_000 });
  // Branch switcher proves /auth/me data (clinic + branches) reached the store.
  await expect(page.getByText('Markaziy filial').first()).toBeVisible({ timeout: 15_000 });
});

test('wrong password shows a friendly error, not "Server error"', async ({ page }) => {
  await page.goto('/uz/login');
  await page.getByLabel(/telefon yoki email/i).fill('owner@shifomed.uz');
  await page.getByLabel(/parol/i).fill('NotThePassword1!');
  await page.getByRole('button', { name: /^kirish$/i }).click();

  await expect(page.getByText(/login yoki parol noto'g'ri/i)).toBeVisible({ timeout: 10_000 });
});
