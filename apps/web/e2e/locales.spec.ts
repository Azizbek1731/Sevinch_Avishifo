import type { Page } from '@playwright/test';
import { test, expect } from './test-base';

/**
 * 4-locale regression: login + key screens render localized (no raw enum
 * values like WAITING/PAID leaking, no crashes) in uz, uz-Cyrl, ru, en.
 */

const LOCALES = [
  { code: 'uz', loginTitle: 'Tizimga kirish', dashboardMarker: 'Markaziy filial' },
  { code: 'uz-Cyrl', loginTitle: 'Тизимга кириш', dashboardMarker: 'Markaziy filial' },
  { code: 'ru', loginTitle: 'Вход в систему', dashboardMarker: 'Markaziy filial' },
  { code: 'en', loginTitle: 'Sign in', dashboardMarker: 'Markaziy filial' },
] as const;

async function login(page: Page, locale: string): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.locator('input#identifier').fill('owner@shifomed.uz');
  await page.locator('input#password').fill('Demo123!');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`**/${locale}/dashboard`, { timeout: 15_000 });
}

for (const { code, loginTitle, dashboardMarker } of LOCALES) {
  test(`${code}: login page localized, dashboard + queue render without crashes`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`/${code}/login`);
    await expect(page.getByText(loginTitle).first()).toBeVisible();

    await login(page, code);
    await expect(page.getByText(dashboardMarker).first()).toBeVisible({ timeout: 15_000 });

    for (const route of ['queue', 'reception', 'patients', 'invoices']) {
      await page.goto(`/${code}/${route}`, { waitUntil: 'networkidle' });
      await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
    }
    // Queue board must not leak raw enum ticket statuses.
    await page.goto(`/${code}/queue`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/\bWAITING\b/)).toHaveCount(0);
    await expect(page.getByText(/\bIN_ROOM\b/)).toHaveCount(0);

    expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
  });
}

test('demo accounts panel fills the form', async ({ page }) => {
  await page.goto('/uz/login');
  await page.getByText(/demo hisoblar/i).click();
  await page.getByRole('button', { name: /kassir/i }).click();
  await expect(page.locator('input#identifier')).toHaveValue('kassir@shifomed.uz');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/uz/dashboard', { timeout: 15_000 });
});
