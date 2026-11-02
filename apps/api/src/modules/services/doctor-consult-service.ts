import type { Prisma } from '@prisma/client';

/** Accepts PrismaClient, extended tenant client, or a transaction client. */
type Db = {
  serviceCategory: {
    findFirst: (args: Prisma.ServiceCategoryFindFirstArgs) => Promise<{
      id: string;
      isActive: boolean;
    } | null>;
    update: (args: Prisma.ServiceCategoryUpdateArgs) => Promise<{ id: string }>;
    create: (args: Prisma.ServiceCategoryCreateArgs) => Promise<{ id: string }>;
  };
  service: {
    findMany: (args: Prisma.ServiceFindManyArgs) => Promise<
      Array<{ id: string; name: unknown; code?: string }>
    >;
    create: (args: Prisma.ServiceCreateArgs) => Promise<{ id: string }>;
  };
  servicePrice: {
    findFirst: (args: Prisma.ServicePriceFindFirstArgs) => Promise<{ id: string } | null>;
    create: (args: Prisma.ServicePriceCreateArgs) => Promise<{ id: string }>;
  };
};

const CONSULT_CATEGORY = "Shifokor ko'rigi";

function pickName(name: unknown): string {
  if (name && typeof name === 'object' && !Array.isArray(name)) {
    const n = name as Record<string, unknown>;
    for (const k of ['uz', 'ru', 'en']) {
      if (typeof n[k] === 'string' && n[k]) return n[k] as string;
    }
  }
  return typeof name === 'string' ? name : '';
}

/** UZI / ultrasound specialists use their own catalogue — skip consult fee rows. */
export function isUltrasoundSpecialty(specialty: string | null | undefined): boolean {
  if (!specialty) return false;
  const value = specialty.toLowerCase();
  return (
    value.includes('uzi') ||
    value.includes('utt') ||
    value.includes('узи') ||
    value.includes('узд') ||
    value.includes('ultrasound') ||
    value.includes('exo') ||
    value.includes('эхо')
  );
}

function serviceMatchesDoctor(
  serviceName: unknown,
  fullName: string,
  specialty: string | null,
): boolean {
  const title = pickName(serviceName).toLowerCase();
  const name = fullName.trim().toLowerCase();
  if (!name || !title.includes(name)) return false;
  if (!specialty?.trim()) return true;
  const sp = specialty.trim().toLowerCase();
  return title.includes(sp) || title.includes('shifokor qabuli') || title.includes("shifokor ko'rigi");
}

async function ensureConsultCategory(db: Db, clinicId: string) {
  const existing = await db.serviceCategory.findFirst({
    where: { clinicId, kind: 'CONSULTATION', name: CONSULT_CATEGORY },
  });
  if (existing) {
    if (!existing.isActive) {
      return db.serviceCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return existing;
  }
  return db.serviceCategory.create({
    data: { clinicId, name: CONSULT_CATEGORY, kind: 'CONSULTATION', sortOrder: 10, isActive: true },
  });
}

async function nextDocCode(db: Db, clinicId: string): Promise<string> {
  const rows = await db.service.findMany({
    where: { clinicId, code: { startsWith: 'DOC-' } },
    select: { code: true },
  });
  let max = 0;
  for (const row of rows) {
    const n = Number(String(row.code).replace(/^DOC-/i, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DOC-${String(max + 1).padStart(2, '0')}`;
}

async function ensureZeroPrice(db: Db, clinicId: string, serviceId: string): Promise<boolean> {
  const now = new Date();
  const current = await db.servicePrice.findFirst({
    where: {
      clinicId,
      serviceId,
      branchId: null,
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (current) return false;
  await db.servicePrice.create({
    data: {
      clinicId,
      serviceId,
      branchId: null,
      price: '0.00',
      effectiveFrom: now,
    },
  });
  return true;
}

/**
 * Every non-UZI doctor must have a CONSULTATION catalogue row (matched by full name).
 * Missing rows / missing prices are created at 0 so'm so reception can always bill.
 */
export async function ensureDoctorConsultationService(
  db: Db,
  input: { clinicId: string; fullName: string; specialty?: string | null },
): Promise<{ serviceId: string; created: boolean; priced: boolean } | null> {
  const specialty = input.specialty ?? null;
  if (isUltrasoundSpecialty(specialty)) return null;

  const fullName = input.fullName.trim();
  if (!fullName) return null;

  const category = await ensureConsultCategory(db, input.clinicId);
  const services = await db.service.findMany({
    where: { clinicId: input.clinicId, isActive: true, categoryId: category.id },
    select: { id: true, name: true, code: true },
  });
  const match = services.find((s) => serviceMatchesDoctor(s.name, fullName, specialty));
  if (match) {
    const priced = await ensureZeroPrice(db, input.clinicId, match.id);
    return { serviceId: match.id, created: false, priced };
  }

  // Also try any CONSULTATION category (legacy names).
  const broader = await db.service.findMany({
    where: {
      clinicId: input.clinicId,
      isActive: true,
      category: { kind: 'CONSULTATION' },
    },
    select: { id: true, name: true },
  });
  const broadMatch = broader.find((s) => serviceMatchesDoctor(s.name, fullName, specialty));
  if (broadMatch) {
    const priced = await ensureZeroPrice(db, input.clinicId, broadMatch.id);
    return { serviceId: broadMatch.id, created: false, priced };
  }

  const titleUz = specialty?.trim()
    ? `${specialty.trim()} — ${fullName}`
    : `Shifokor qabuli — ${fullName}`;
  const code = await nextDocCode(db, input.clinicId);
  const service = await db.service.create({
    data: {
      clinicId: input.clinicId,
      categoryId: category.id,
      code,
      name: { uz: titleUz },
      unit: "ko'rik",
      durationMin: 15,
      vatIncluded: true,
      isActive: true,
    },
  });
  await ensureZeroPrice(db, input.clinicId, service.id);
  return { serviceId: service.id, created: true, priced: true };
}
