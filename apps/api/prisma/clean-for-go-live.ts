/**
 * DESTRUCTIVE: wipe all test/demo operational data for go-live.
 * Keeps the clinic identity (name, logo, settings), its branches, and one
 * CLINIC_OWNER login. Everything else (patients, other staff, services,
 * admissions, lab, invoices, rooms, …) is erased.
 *
 *   CLEAN_CONFIRM=GO-LIVE \
 *   [OWNER_PHONE=+998...] [OWNER_EMAIL=...] [OWNER_PASSWORD=...] \
 *   [CLINIC_ID=...] \
 *   npx tsx prisma/clean-for-go-live.ts
 *
 * TAKE A pg_dump FIRST — this cannot be undone.
 */
import { randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizePhone } from '@avishifo/shared';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env'), override: true });

const prisma = new PrismaClient();
const CONFIRM = 'GO-LIVE';

/** Global platform tables that survive the wipe. */
const PRESERVED = new Set(['SubscriptionPlan', 'Icd10Code', 'DrugDirectory', '_prisma_migrations']);

const DEFAULT_PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    priceMonthly: '990000.00',
    maxBranches: 1,
    maxUsers: 10,
    modules: ['portal'],
  },
  {
    code: 'standard',
    name: 'Standard',
    priceMonthly: '1990000.00',
    maxBranches: 3,
    maxUsers: 30,
    modules: ['lab', 'portal', 'telegram'],
  },
  {
    code: 'pro',
    name: 'Pro',
    priceMonthly: '3990000.00',
    maxBranches: 10,
    maxUsers: 100,
    modules: ['lab', 'portal', 'telegram', 'analytics'],
  },
];

async function main(): Promise<void> {
  if (process.env.CLEAN_CONFIRM !== CONFIRM) {
    throw new Error(
      `Refusing to run. Set CLEAN_CONFIRM=${CONFIRM} to erase test patients, staff, services and stay data.`,
    );
  }

  const clinics = await prisma.clinic.findMany({
    include: {
      branches: { orderBy: { createdAt: 'asc' } },
      subscriptions: { orderBy: { startsAt: 'desc' }, take: 1 },
      featureFlags: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (clinics.length === 0) throw new Error('No clinic found — nothing to clean');

  const clinicIdEnv = process.env.CLINIC_ID?.trim();
  const clinic = clinicIdEnv
    ? clinics.find((c) => c.id === clinicIdEnv)
    : clinics.length === 1
      ? clinics[0]
      : null;
  if (!clinic) {
    throw new Error(
      clinics.length === 1
        ? 'Clinic not found'
        : `Multiple clinics (${clinics.map((c) => `${c.name}:${c.id}`).join(', ')}). Set CLINIC_ID=...`,
    );
  }

  const ownerPhoneRaw = process.env.OWNER_PHONE?.trim();
  const ownerEmail = process.env.OWNER_EMAIL?.trim()?.toLowerCase();
  const ownerPhone = ownerPhoneRaw ? normalizePhone(ownerPhoneRaw) : null;
  if (ownerPhoneRaw && !ownerPhone) {
    throw new Error('OWNER_PHONE must be a valid Uzbek number (+998XXXXXXXXX)');
  }

  const owners = await prisma.user.findMany({
    where: {
      clinicId: clinic.id,
      deletedAt: null,
      role: { in: ['CLINIC_OWNER', 'CLINIC_ADMIN'] },
      status: 'ACTIVE',
    },
    include: { staffProfile: true, branches: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  const owner =
    (ownerPhone ? owners.find((u) => u.phone === ownerPhone) : undefined) ??
    (ownerEmail ? owners.find((u) => u.email === ownerEmail) : undefined) ??
    owners.find((u) => u.role === 'CLINIC_OWNER') ??
    owners[0];

  let ownerPassword = process.env.OWNER_PASSWORD?.trim() || '';
  let generatedPassword: string | null = null;
  if (!owner && !ownerPhone && !ownerEmail) {
    throw new Error(
      'No owner left to keep. Pass OWNER_PHONE=+998... (and optionally OWNER_PASSWORD=...) to create a fresh CLINIC_OWNER.',
    );
  }
  if (!ownerPassword) {
    if (!owner?.passwordHash) {
      generatedPassword = randomBytes(9).toString('base64url');
      ownerPassword = generatedPassword;
    }
  } else if (ownerPassword.length < 8) {
    throw new Error('OWNER_PASSWORD must be at least 8 characters');
  }

  const [patients, users, services, admissions, invoices] = await Promise.all([
    prisma.patient.count({ where: { clinicId: clinic.id } }),
    prisma.user.count({ where: { clinicId: clinic.id } }),
    prisma.service.count({ where: { clinicId: clinic.id } }),
    prisma.admission.count({ where: { clinicId: clinic.id } }),
    prisma.invoice.count({ where: { clinicId: clinic.id } }),
  ]);
  console.log(`Clinic: ${clinic.name} (${clinic.id})`);
  console.log(
    `About to erase: ${patients} patients, ${Math.max(0, users - (owner ? 1 : 0))} other users, ${services} services, ${admissions} admissions, ${invoices} invoices.`,
  );

  // Snapshot what we restore after the full wipe.
  const clinicSnap = {
    id: clinic.id,
    name: clinic.name,
    legalName: clinic.legalName,
    taxId: clinic.taxId,
    logoUrl: clinic.logoUrl,
    phone: clinic.phone,
    email: clinic.email,
    address: clinic.address,
    defaultLocale: clinic.defaultLocale,
    smsSenderName: clinic.smsSenderName,
    status: clinic.status,
    settings: clinic.settings as Prisma.InputJsonValue,
  };
  const branchSnaps = clinic.branches.map((b) => ({
    id: b.id,
    clinicId: clinic.id,
    name: b.name,
    address: b.address,
    phone: b.phone,
    latitude: b.latitude,
    longitude: b.longitude,
    workingHours: b.workingHours as Prisma.InputJsonValue,
    isActive: b.isActive,
  }));
  const subscriptionSnap = clinic.subscriptions[0]
    ? {
        id: clinic.subscriptions[0].id,
        clinicId: clinic.id,
        planId: clinic.subscriptions[0].planId,
        status: clinic.subscriptions[0].status,
        startsAt: clinic.subscriptions[0].startsAt,
        endsAt: clinic.subscriptions[0].endsAt,
      }
    : null;
  const flagSnaps = clinic.featureFlags.map((f) => ({
    id: f.id,
    clinicId: clinic.id,
    key: f.key,
    enabled: f.enabled,
  }));

  const passwordHash = ownerPassword
    ? await argon2.hash(ownerPassword, { type: argon2.argon2id })
    : owner!.passwordHash!;
  if (ownerPassword && !generatedPassword) console.log('owner password will be set from OWNER_PASSWORD');

  const ownerSnap = {
    ...(owner?.id ? { id: owner.id } : {}),
    clinicId: clinic.id,
    phone: ownerPhone ?? owner?.phone ?? null,
    email: ownerEmail ?? owner?.email ?? null,
    passwordHash,
    fullName: process.env.OWNER_NAME?.trim() || owner?.fullName || 'Klinika egasi',
    avatarUrl: owner?.avatarUrl ?? null,
    role: 'CLINIC_OWNER' as const,
    status: 'ACTIVE' as const,
    locale: owner?.locale ?? ('uz' as const),
    permissionOverrides: (owner?.permissionOverrides ?? {}) as Prisma.InputJsonValue,
    twoFactorEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    deletedAt: null,
    telegramChatId: owner?.telegramChatId ?? null,
    telegramUsername: owner?.telegramUsername ?? null,
    telegramLinkedAt: owner?.telegramLinkedAt ?? null,
  };
  console.log(
    `Restoring owner: ${ownerSnap.fullName} ${ownerSnap.phone ?? ownerSnap.email ?? '(no login id yet)'}`,
  );
  const profileSnap = owner?.staffProfile
    ? {
        id: owner.staffProfile.id,
        clinicId: clinic.id,
        specialty: owner.staffProfile.specialty,
        licenseNo: owner.staffProfile.licenseNo,
        hireDate: owner.staffProfile.hireDate,
        photoUrl: owner.staffProfile.photoUrl,
        bio: owner.staffProfile.bio,
        slotMinutes: owner.staffProfile.slotMinutes,
        defaultRoomId: null,
      }
    : null;

  // ---- wipe everything except global dictionaries -------------------------
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = tables.map((t) => t.tablename).filter((name) => !PRESERVED.has(name));
  if (targets.length === 0) throw new Error('No tables resolved — refusing to continue');
  const quoted = targets.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${targets.length} tables`);

  const drugs = await prisma.drugDirectory.deleteMany({ where: { clinicId: { not: null } } });
  console.log(`removed ${drugs.count} clinic-specific drug rows`);

  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: { isActive: true },
    });
  }

  // ---- restore clinic shell + owner --------------------------------------
  await prisma.clinic.create({ data: clinicSnap });
  for (const branch of branchSnaps) {
    await prisma.branch.create({ data: branch });
  }
  if (subscriptionSnap) {
    const planExists = await prisma.subscriptionPlan.findFirst({
      where: { id: subscriptionSnap.planId },
      select: { id: true },
    });
    if (planExists) {
      await prisma.clinicSubscription.create({ data: subscriptionSnap });
    } else {
      const standard = await prisma.subscriptionPlan.findFirst({ where: { code: 'standard' } });
      if (standard) {
        await prisma.clinicSubscription.create({
          data: {
            clinicId: clinic.id,
            planId: standard.id,
            status: 'ACTIVE',
            startsAt: new Date(),
          },
        });
      }
    }
  }
  for (const flag of flagSnaps) {
    await prisma.featureFlag.create({ data: flag });
  }

  const createdOwner = await prisma.user.create({ data: ownerSnap });
  if (profileSnap) {
    await prisma.staffProfile.create({
      data: { ...profileSnap, userId: createdOwner.id },
    });
  }
  for (const branch of branchSnaps) {
    await prisma.userBranch.create({
      data: { clinicId: clinic.id, userId: createdOwner.id, branchId: branch.id },
    });
  }

  const after = await Promise.all([
    prisma.patient.count({ where: { clinicId: clinic.id } }),
    prisma.user.count({ where: { clinicId: clinic.id } }),
    prisma.service.count({ where: { clinicId: clinic.id } }),
    prisma.admission.count({ where: { clinicId: clinic.id } }),
    prisma.invoice.count({ where: { clinicId: clinic.id } }),
    prisma.branch.count({ where: { clinicId: clinic.id } }),
  ]);

  console.log('\n--- go-live clean done ---');
  console.log(`clinic: ${clinicSnap.name}`);
  console.log(`branches: ${after[5]} · staff: ${after[1]} · patients: ${after[0]}`);
  console.log(`services: ${after[2]} · admissions: ${after[3]} · invoices: ${after[4]}`);
  console.log(`login as: ${createdOwner.phone ?? createdOwner.email ?? createdOwner.id}`);
  if (generatedPassword) {
    console.log(`TEMPORARY OWNER PASSWORD (change after login): ${generatedPassword}`);
  }
  console.log(
    'Next: set NEXT_PUBLIC_DEMO_LOGINS=false, rebuild web, add real staff and import the real service catalogue.',
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
