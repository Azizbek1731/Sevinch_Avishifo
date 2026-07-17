/**
 * Spec §12 smoke flow: login → register patient → enqueue → call → visit →
 * invoice → pay. Requires the full stack running against the demo seed
 * (API :3001, web :3000, seeded DB) — set E2E_FULL=1 to enable:
 *
 *   E2E_FULL=1 pnpm --filter @avishifo/web test:e2e
 */
import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_FULL, 'requires running stack (set E2E_FULL=1)');

/** Demo seed receptionist / doctor logins (prisma/seed.ts, clinic "Shifo Med Servis"). */
const RECEPTIONIST = { email: 'qabul1@shifomed.uz', password: 'Demo123!' };
const DOCTOR = { email: 'kardiolog@shifomed.uz', password: 'Demo123!' };
const CASHIER = { email: 'kassir@shifomed.uz', password: 'Demo123!' };

const patientName = {
  lastName: 'Smoketest',
  firstName: `Bemor${Date.now() % 100_000}`,
};
const fullName = `${patientName.lastName} ${patientName.firstName}`;

async function login(page: import('@playwright/test').Page, creds: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel(/email|telefon|phone|identifier/i).fill(creds.email);
  await page.getByLabel(/parol|password/i).fill(creds.password);
  await page.getByRole('button', { name: /kirish|login|sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('clinic smoke flow', () => {
  test('login → register patient → enqueue → call → visit → invoice → pay', async ({ page }) => {
    // ---- 1. login as receptionist -------------------------------------
    await login(page, RECEPTIONIST);

    // ---- 2. register a new patient ------------------------------------
    await page.getByRole('link', { name: /bemorlar|patients/i }).click();
    await page.getByRole('button', { name: /yangi bemor|new patient|add patient/i }).click();
    await page.getByLabel(/familiya|last name/i).fill(patientName.lastName);
    await page.getByLabel(/^ism|first name/i).fill(patientName.firstName);
    await page
      .getByLabel(/telefon|phone/i)
      .first()
      .fill(`+9987${String(Date.now()).slice(-8)}`);
    await page.getByRole('button', { name: /saqlash|save|create/i }).click();
    await expect(page.getByText(fullName)).toBeVisible();

    // ---- 3. enqueue the patient (walk-in) -----------------------------
    await page.getByRole('link', { name: /navbat|queue/i }).click();
    await page.getByRole('button', { name: /navbatga|walk-in|enqueue|add to queue/i }).click();
    await page.getByLabel(/bemor|patient/i).fill(patientName.firstName);
    await page.getByRole('option', { name: new RegExp(patientName.firstName, 'i') }).click();
    await page.getByLabel(/shifokor|doctor/i).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: /qo'shish|saqlash|add|save/i }).click();
    await expect(page.getByText(new RegExp(`${patientName.firstName}|A-\\d{3}`))).toBeVisible();

    // ---- 4. doctor calls the ticket and opens the visit ---------------
    const doctorPage = await page.context().browser()!.newPage();
    await login(doctorPage, DOCTOR);
    await doctorPage.getByRole('link', { name: /navbat|queue/i }).click();
    await doctorPage.getByRole('button', { name: /keyingi|call next|chaqirish/i }).click();
    await doctorPage.getByRole('button', { name: /qabulni boshlash|start visit|start/i }).click();

    // ---- 5. fill the SOAP visit and complete it -----------------------
    await doctorPage.getByLabel(/shikoyat|subjective/i).fill('Smoke test shikoyati');
    await doctorPage.getByLabel(/xulosa|assessment|plan/i).first().fill('Smoke test xulosasi');
    await doctorPage.getByRole('button', { name: /yakunlash|complete|finish/i }).click();
    await expect(doctorPage.getByText(/yakunlandi|completed/i)).toBeVisible();

    // ---- 6. cashier invoices the visit and takes payment --------------
    const cashierPage = await page.context().browser()!.newPage();
    await login(cashierPage, CASHIER);
    await cashierPage.getByRole('link', { name: /kassa|billing|invoices/i }).click();
    await cashierPage.getByRole('button', { name: /yangi hisob|new invoice/i }).click();
    await cashierPage.getByLabel(/bemor|patient/i).fill(patientName.firstName);
    await cashierPage.getByRole('option', { name: new RegExp(patientName.firstName, 'i') }).click();
    await cashierPage.getByRole('button', { name: /saqlash|save|create/i }).click();
    await cashierPage.getByRole('button', { name: /taqdim|issue/i }).click();

    // ---- 7. pay in cash ------------------------------------------------
    await cashierPage.getByRole('button', { name: /to'lov|payment|pay/i }).click();
    await cashierPage.getByRole('button', { name: /naqd|cash/i }).click();
    await cashierPage.getByRole('button', { name: /tasdiqlash|confirm|to'lash/i }).click();
    await expect(cashierPage.getByText(/to'landi|paid/i)).toBeVisible();
  });
});
