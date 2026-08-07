/**
 * DESTRUCTIVE: wipes every clinic and all of their data, then provisions a
 * single platform SUPER_ADMIN. Intended for the one-time hand-over from demo
 * data to a live, empty platform.
 *
 *   RESET_CONFIRM=DELETE-EVERYTHING \
 *   SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... [SUPERADMIN_PHONE=+998...] \
 *   npx tsx prisma/reset.ts
 *
 * TAKE A pg_dump FIRST — this cannot be undone.
 *
 * Deliberately PRESERVED (the platform is unusable without them):
 *  - SubscriptionPlan — public sign-up resolves the cheapest active plan and
 *    404s when none exists, so wiping plans breaks registration outright.
 *  - Icd10Code        — the global ICD-10 directory (200 rows).
 *  - DrugDirectory rows with clinicId NULL — the global drug directory.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizePhone } from '@avishifo/shared';

const prisma = new PrismaClient();

const CONFIRM_PHRASE = 'DELETE-EVERYTHING';

/** Tables that survive the wipe. */
const PRESERVED = new Set(['SubscriptionPlan', 'Icd10Code', 'DrugDirectory', '_prisma_migrations']);

const DEFAULT_PLANS = [
  { code: 'starter', name: 'Starter', priceMonthly: '990000.00', maxBranches: 1, maxUsers: 10, modules: ['portal'] },
  { code: 'standard', name: 'Standard', priceMonthly: '1990000.00', maxBranches: 3, maxUsers: 30, modules: ['lab', 'portal', 'telegram'] },
  { code: 'pro', name: 'Pro', priceMonthly: '3990000.00', maxBranches: 10, maxUsers: 100, modules: ['lab', 'portal', 'telegram', 'analytics'] },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

async function main(): Promise<void> {
  if (process.env.RESET_CONFIRM !== CONFIRM_PHRASE) {
    throw new Error(
      `Refusing to run. Set RESET_CONFIRM=${CONFIRM_PHRASE} to confirm you want to erase every clinic.`,
    );
  }

  const email = requireEnv('SUPERADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPERADMIN_PASSWORD');
  if (password.length < 12) throw new Error('SUPERADMIN_PASSWORD must be at least 12 characters');
  // Phone is optional — login accepts email or phone, and the column is nullable.
  // It can be added later from Settings rather than guessed here.
  const rawPhone = process.env.SUPERADMIN_PHONE?.trim();
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    if (!phone) throw new Error('SUPERADMIN_PHONE must be a valid Uzbek number (+998XXXXXXXXX)');
  }
  const fullName = process.env.SUPERADMIN_NAME?.trim() || 'AviShifo Super Admin';

  // ---- what is about to be destroyed -------------------------------------
  const [clinics, patients, visits, invoices] = await Promise.all([
    prisma.clinic.count(),
    prisma.patient.count(),
    prisma.visit.count(),
    prisma.invoice.count(),
  ]);
  console.log(
    `Erasing ${clinics} clinic(s): ${patients} patients, ${visits} visits, ${invoices} invoices.`,
  );

  // ---- wipe ---------------------------------------------------------------
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = tables.map((t) => t.tablename).filter((t) => !PRESERVED.has(t));
  if (targets.length === 0) throw new Error('No tables resolved — refusing to continue');

  // One TRUNCATE ... CASCADE so foreign keys never order the deletes for us.
  const quoted = targets.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${targets.length} tables`);

  // Clinic-added drugs go; the global directory stays.
  const drugs = await prisma.drugDirectory.deleteMany({ where: { clinicId: { not: null } } });
  console.log(`removed ${drugs.count} clinic-specific drug rows`);

  // ---- plans must exist or public sign-up 404s ----------------------------
  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: { isActive: true },
    });
  }
  const activePlans = await prisma.subscriptionPlan.count({ where: { isActive: true } });
  console.log(`active plans: ${activePlans}`);

  // ---- the one account that survives --------------------------------------
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.user.create({
    data: {
      clinicId: null,
      email,
      phone,
      passwordHash,
      fullName,
      role: 'SUPER_ADMIN',
      locale: 'uz',
    },
    select: { id: true, email: true, phone: true },
  });

  const icd10 = await prisma.icd10Code.count();
  console.log('\n--- done ---');
  console.log(`super-admin: ${admin.email}${admin.phone ? ` / ${admin.phone}` : ' (no phone set)'}`);
  console.log(`clinics: ${await prisma.clinic.count()} · patients: ${await prisma.patient.count()}`);
  console.log(`icd10 preserved: ${icd10}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
