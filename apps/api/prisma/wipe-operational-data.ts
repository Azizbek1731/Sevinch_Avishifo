/**
 * Wipe clinical / cashier usage so the clinic looks unused, while keeping
 * permanent setup: clinic, branches, staff, rooms, service catalogue, prices,
 * lab tests, schedules, templates, expense categories, etc.
 *
 * Removes: patients, admissions, visits, appointments, queues, lab/clinical
 * orders, invoices, payments, shifts, expenses, payroll accruals, sessions,
 * portal links, notifications logs, audit trail.
 *
 *   CLEAN_CONFIRM=WIPE-USAGE \
 *   npx tsx prisma/wipe-operational-data.ts
 *
 * Always take a pg_dump first.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env'), override: true });

const prisma = new PrismaClient();
const CONFIRM = 'WIPE-USAGE';

/** Setup that must survive (catalogue, staff, clinic shell). */
const KEEP = new Set([
  '_prisma_migrations',
  'SubscriptionPlan',
  'ClinicSubscription',
  'FeatureFlag',
  'Icd10Code',
  'Clinic',
  'ClinicCounter',
  'Branch',
  'InpatientRoom',
  'Room',
  'User',
  'StaffProfile',
  'UserBranch',
  'DoctorSchedule',
  'ScheduleException',
  'VisitTemplate',
  'DrugDirectory',
  'ServiceCategory',
  'Service',
  'ServicePrice',
  'ServicePackage',
  'PackageItem',
  'DiscountRule',
  'PriceList',
  'PriceListItem',
  'LabCatalogTest',
  'LabCatalogParameter',
  'LabTest',
  'LabTestParameter',
  'ExpenseCategory',
  'Supplier',
  'InventoryItem',
  'CompensationRule',
  'NotificationTemplate',
]);

async function main(): Promise<void> {
  if (process.env.CLEAN_CONFIRM !== CONFIRM) {
    throw new Error(
      `Refusing to run. Set CLEAN_CONFIRM=${CONFIRM} to erase patients, bills and clinical usage only.`,
    );
  }

  const clinic = await prisma.clinic.findFirst({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!clinic) throw new Error('No clinic found');

  const before = {
    patients: await prisma.patient.count(),
    users: await prisma.user.count(),
    services: await prisma.service.count(),
    prices: await prisma.servicePrice.count(),
    rooms: await prisma.inpatientRoom.count(),
    labTests: await prisma.labTest.count(),
    admissions: await prisma.admission.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
  };
  console.log(`Clinic: ${clinic.name}`);
  console.log(
    `KEEP staff=${before.users} services=${before.services} prices=${before.prices} rooms=${before.rooms} labTests=${before.labTests}`,
  );
  console.log(
    `WIPE patients=${before.patients} admissions=${before.admissions} invoices=${before.invoices} payments=${before.payments}`,
  );

  // Staff may point at a patient card / default room — clear before truncating usage.
  await prisma.staffProfile.updateMany({ data: { defaultRoomId: null } });
  await prisma.user.updateMany({ data: { patientId: null } });
  await prisma.authSession.deleteMany({});
  await prisma.otpCode.deleteMany({});

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = tables.map((t) => t.tablename).filter((name) => !KEEP.has(name));
  if (targets.length === 0) throw new Error('No operational tables resolved');

  // User.patientId → Patient would make TRUNCATE CASCADE wipe User. Drop that FK only.
  const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'User'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%Patient%'
  `;
  for (const fk of fks) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP CONSTRAINT "${fk.conname}"`);
    console.log(`dropped FK ${fk.conname}`);
  }

  const quoted = targets.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${targets.length} usage tables`);

  // Recreate User → Patient FK (nullable, no cascade delete of staff).
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User"
    ADD CONSTRAINT "User_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
  `);

  await prisma.clinicCounter.updateMany({
    where: { clinicId: clinic.id },
    data: { value: 0n },
  });

  const after = {
    patients: await prisma.patient.count(),
    users: await prisma.user.count(),
    services: await prisma.service.count(),
    prices: await prisma.servicePrice.count(),
    rooms: await prisma.inpatientRoom.count(),
    labTests: await prisma.labTest.count(),
    admissions: await prisma.admission.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
  };

  if (after.users !== before.users || after.services !== before.services || after.prices !== before.prices) {
    throw new Error(
      `Safety check failed — staff/services/prices changed (users ${before.users}→${after.users}, services ${before.services}→${after.services}, prices ${before.prices}→${after.prices})`,
    );
  }
  if (after.patients !== 0 || after.invoices !== 0 || after.payments !== 0 || after.admissions !== 0) {
    throw new Error('Safety check failed — usage data still present');
  }

  console.log('\n--- usage wipe done ---');
  console.log(
    `kept: users=${after.users} services=${after.services} prices=${after.prices} rooms=${after.rooms} labTests=${after.labTests}`,
  );
  console.log(
    `cleared: patients=${after.patients} admissions=${after.admissions} invoices=${after.invoices} payments=${after.payments}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
