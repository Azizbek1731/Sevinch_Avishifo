import type { PrismaClient } from '@prisma/client';
import { PRESCRIPTION_DRUGS } from './seed-data/prescription-drugs';

/** Add missing product labels without changing an existing catalogue entry. */
export async function seedPrescriptionDirectory(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // Keep concurrent setup runs from inserting the same global product twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('avishifo:prescription-directory'))`;
    const existing = await tx.drugDirectory.findMany({
      where: { clinicId: null },
      select: { name: true, form: true, strength: true },
    });
    const key = (name: string, form: string | null, strength: string | null) =>
      JSON.stringify([name, form, strength]);
    const known = new Set(existing.map((row) => key(row.name, row.form, row.strength)));
    const data = PRESCRIPTION_DRUGS.filter(
      ([name, form, strength]) => !known.has(key(name, form, strength)),
    ).map(([name, form, strength]) => ({ clinicId: null, name, form, strength }));
    if (!data.length) return 0;
    return (await tx.drugDirectory.createMany({ data })).count;
  });
}
