import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, ErrorCode } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { ImportLabCatalogDto, LabCatalogQueryDto } from './dto';

type CatalogRow = Prisma.LabCatalogTestGetPayload<{ include: { parameters: true } }>;

const toJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * The standard laboratory catalogue: the Uzbek MoH / WHO reference set, shared by every
 * clinic and owned by none.
 *
 * It is a dictionary, like Icd10Code — no clinicId, no patient data — so it is read
 * through `prisma.unscoped`, which the tenant extension would otherwise try to filter by
 * a column these tables do not have. Nothing here is writable through the API: the
 * catalogue changes only by migration, so one clinic can never edit the reference
 * intervals another clinic reads.
 */
@Injectable()
export class LabCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toParameter(p: CatalogRow['parameters'][number]): Record<string, unknown> {
    return {
      id: p.id,
      code: p.code,
      name: { uz: p.nameUz, ru: p.nameRu, en: p.nameEn },
      unit: p.unit,
      valueType: p.valueType,
      note: p.note,
      referenceRanges: p.referenceRanges,
      sortOrder: p.sortOrder,
    };
  }

  private toTest(t: CatalogRow, importedCodes?: Set<string>): Record<string, unknown> {
    return {
      id: t.id,
      code: t.code,
      biomaterial: t.biomaterial,
      category: t.category,
      name: { uz: t.nameUz, ru: t.nameRu, en: t.nameEn },
      specimenNote: t.specimenNote,
      parameterCount: t.parameters.length,
      imported: importedCodes ? importedCodes.has(t.code) : undefined,
      parameters: [...t.parameters]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => this.toParameter(p)),
    };
  }

  /** Which catalogue codes this clinic already carries, so the UI can grey them out. */
  private async importedCodes(): Promise<Set<string>> {
    const rows = await this.prisma.db.labTest.findMany({
      where: { catalogCode: { not: null } },
      select: { catalogCode: true },
    });
    return new Set(rows.map((r) => r.catalogCode).filter((c): c is string => c !== null));
  }

  async list(query: LabCatalogQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.LabCatalogTestWhereInput = {};
    if (query.biomaterial) where.biomaterial = query.biomaterial;
    if (query.category) where.category = query.category;
    if (query.search) {
      const search = query.search;
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { nameUz: { contains: search, mode: 'insensitive' } },
        { nameRu: { contains: search, mode: 'insensitive' } },
        { nameEn: { contains: search, mode: 'insensitive' } },
        // Searching by analyte ("HGB", "гемоглобин") must find the panel that contains it.
        { parameters: { some: { code: { contains: search, mode: 'insensitive' } } } },
        { parameters: { some: { nameUz: { contains: search, mode: 'insensitive' } } } },
        { parameters: { some: { nameRu: { contains: search, mode: 'insensitive' } } } },
        { parameters: { some: { nameEn: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const imported = await this.importedCodes();
    if (query.onlyNew && imported.size > 0) {
      where.code = { notIn: [...imported] };
    }

    // Shared dictionary — justified unscoped read of a table with no clinicId.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.labCatalogTest.findMany({
        where,
        include: { parameters: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.unscoped.labCatalogTest.count({ where }),
    ]);
    return paginated(
      rows.map((t) => this.toTest(t, imported)),
      { page: query.page, limit: query.limit, total },
    );
  }

  /** Counts per biomaterial and per category, for the import dialog's filter chips. */
  async summary(): Promise<Record<string, unknown>> {
    const [byBiomaterial, byCategory, total, imported] = await Promise.all([
      this.prisma.unscoped.labCatalogTest.groupBy({
        by: ['biomaterial'],
        _count: { _all: true },
      }),
      this.prisma.unscoped.labCatalogTest.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
      this.prisma.unscoped.labCatalogTest.count(),
      this.importedCodes(),
    ]);
    return {
      total,
      importedCount: imported.size,
      biomaterials: byBiomaterial.map((r) => ({
        value: r.biomaterial,
        count: r._count._all,
      })),
      categories: byCategory.map((r) => ({ value: r.category, count: r._count._all })),
    };
  }

  async getByCode(code: string): Promise<Record<string, unknown>> {
    const test = await this.prisma.unscoped.labCatalogTest.findUnique({
      where: { code },
      include: { parameters: true },
    });
    if (!test) throw new AppException(ErrorCode.NOT_FOUND, 'Catalogue test not found', 404);
    return this.toTest(test, await this.importedCodes());
  }

  /**
   * Give a LAB-kind service the lab test that makes it real on the worklist.
   *
   * Called from service creation, inside its transaction, so a lab service can
   * never exist half-made — priced but invisible to the laboratory. With a
   * catalogue code the test is copied whole (analytes, reference intervals);
   * without one a minimal test with a single free-text "Natija" analyte is
   * created, because a service the catalogue does not know still needs a place
   * for the technician to type the answer.
   */
  async ensureTestForService(
    db: Prisma.TransactionClient,
    input: {
      serviceId: string;
      serviceCode: string;
      serviceName: Prisma.InputJsonValue;
      labCatalogCode?: string;
    },
  ): Promise<{ labTestId: string }> {
    const clinicId = TenantContext.requireClinicId();

    if (input.labCatalogCode) {
      // Shared dictionary — justified unscoped read of a table with no clinicId.
      const cat = await this.prisma.unscoped.labCatalogTest.findUnique({
        where: { code: input.labCatalogCode },
        include: { parameters: true },
      });
      if (!cat) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Katalogda bunday tekshiruv yo‘q', 404);
      }
      const existing = await db.labTest.findFirst({
        where: { clinicId, OR: [{ catalogCode: cat.code }, { code: cat.code }] },
        select: { id: true, serviceId: true },
      });
      if (existing) {
        if (existing.serviceId && existing.serviceId !== input.serviceId) {
          throw new AppException(
            ErrorCode.CONFLICT,
            'Bu tahlil allaqachon boshqa xizmatga bog‘langan',
            409,
          );
        }
        await db.labTest.update({
          where: { id: existing.id },
          data: { serviceId: input.serviceId, isActive: true },
        });
        return { labTestId: existing.id };
      }
      const created = await db.labTest.create({
        data: {
          clinicId,
          serviceId: input.serviceId,
          code: cat.code,
          name: { uz: cat.nameUz, ru: cat.nameRu, en: cat.nameEn ?? undefined },
          specimenType: cat.biomaterial.toLowerCase(),
          biomaterial: cat.biomaterial,
          category: cat.category,
          catalogCode: cat.code,
          parameters: {
            // Nested creates are not auto-stamped by the tenant extension.
            create: [...cat.parameters]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p, idx) => ({
                clinicId,
                name: p.nameUz,
                code: p.code,
                unit: p.unit,
                valueType: p.valueType,
                referenceRanges: p.referenceRanges as Prisma.InputJsonValue,
                sortOrder: idx,
              })),
          },
        },
        select: { id: true },
      });
      return { labTestId: created.id };
    }

    // Hand-written lab service: a bare test with one free-text answer field.
    //
    // The existing-code lookup runs BEFORE the create, not in a P2002 catch:
    // this executes inside the service-creation transaction, and on Postgres a
    // unique violation aborts the whole transaction — every query after it,
    // including the adoption lookup, would die with 25P02 and surface as a 500.
    const orphan = await db.labTest.findFirst({
      where: { clinicId, code: input.serviceCode },
      select: { id: true, serviceId: true },
    });
    if (orphan) {
      if (orphan.serviceId && orphan.serviceId !== input.serviceId) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Bu kod bilan tahlil allaqachon bor va boshqa xizmatga bog‘langan',
          409,
        );
      }
      await db.labTest.update({
        where: { id: orphan.id },
        data: { serviceId: input.serviceId, isActive: true },
      });
      return { labTestId: orphan.id };
    }
    const created = await db.labTest.create({
      data: {
        clinicId,
        serviceId: input.serviceId,
        code: input.serviceCode,
        name: input.serviceName,
        parameters: {
          create: [{ clinicId, name: 'Natija', valueType: 'TEXT', sortOrder: 0 }],
        },
      },
      select: { id: true },
    });
    return { labTestId: created.id };
  }

  /**
   * Copy catalogue tests into this clinic's own LabTest rows.
   *
   * The copy is deliberate rather than a reference: from here the clinic may retune an
   * interval to its own analyser, and that retuning must never leak into the shared
   * dictionary or into another clinic. Re-importing a code is a no-op unless
   * `overwriteExisting` is set, so the button is safe to press twice.
   */
  async import(dto: ImportLabCatalogDto): Promise<Record<string, unknown>> {
    const codes = [...new Set(dto.codes)];
    const catalogue = await this.prisma.unscoped.labCatalogTest.findMany({
      where: { code: { in: codes } },
      include: { parameters: true },
    });
    if (catalogue.length === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No catalogue tests matched', 404);
    }

    const clinicId = TenantContext.requireClinicId();
    const existing = await this.prisma.db.labTest.findMany({
      where: { OR: [{ catalogCode: { in: codes } }, { code: { in: codes } }] },
      select: { id: true, code: true, catalogCode: true },
    });
    const existingByCode = new Map(
      existing.map((t) => [t.catalogCode ?? t.code, t] as const),
    );

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    for (const t of catalogue) {
      const already = existingByCode.get(t.code);
      if (already && !dto.overwriteExisting) {
        skipped.push(t.code);
        continue;
      }
      const parameters = [...t.parameters].sort((a, b) => a.sortOrder - b.sortOrder);

      if (already) {
        await this.prisma.db.$transaction(async (tx) => {
          await tx.labTest.update({
            where: { id: already.id },
            data: {
              name: toJson({ uz: t.nameUz, ru: t.nameRu, en: t.nameEn ?? undefined }),
              specimenType: t.biomaterial.toLowerCase(),
              biomaterial: t.biomaterial,
              category: t.category,
              catalogCode: t.code,
            },
          });
          for (const [idx, p] of parameters.entries()) {
            // Matched on the analyte code, so a renamed parameter is still recognised
            // and results already filed against it keep their parameter row.
            const prior = await tx.labTestParameter.findFirst({
              where: { labTestId: already.id, OR: [{ code: p.code }, { name: p.nameUz }] },
              select: { id: true },
            });
            const data = {
              name: p.nameUz,
              code: p.code,
              unit: p.unit,
              valueType: p.valueType,
              referenceRanges: toJson(p.referenceRanges),
              sortOrder: idx,
            };
            if (prior) {
              await tx.labTestParameter.update({ where: { id: prior.id }, data });
            } else {
              await tx.labTestParameter.create({
                data: { clinicId, labTestId: already.id, ...data },
              });
            }
          }
        });
        updated.push(t.code);
        continue;
      }

      try {
        await this.prisma.db.labTest.create({
          data: {
            clinicId,
            code: t.code,
            name: toJson({ uz: t.nameUz, ru: t.nameRu, en: t.nameEn ?? undefined }),
            specimenType: t.biomaterial.toLowerCase(),
            biomaterial: t.biomaterial,
            category: t.category,
            catalogCode: t.code,
            parameters: {
              // Nested creates are not auto-stamped by the tenant extension.
              create: parameters.map((p, idx) => ({
                clinicId,
                name: p.nameUz,
                code: p.code,
                unit: p.unit,
                valueType: p.valueType,
                referenceRanges: toJson(p.referenceRanges),
                sortOrder: idx,
              })),
            },
          },
        });
        created.push(t.code);
      } catch (err: unknown) {
        // A clinic that already hand-made a test under this code keeps its own version.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped.push(t.code);
          continue;
        }
        throw err;
      }
    }

    const missing = codes.filter((c) => !catalogue.some((t) => t.code === c));

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'LabTest',
      after: { importedFromCatalogue: { created, updated, skipped, missing } },
    });

    return {
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      createdCodes: created,
      updatedCodes: updated,
      skippedCodes: skipped,
      missingCodes: missing,
    };
  }
}
