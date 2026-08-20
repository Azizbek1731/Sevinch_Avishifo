import type { AuthUser } from '@avishifo/shared';
import { Injectable } from '@nestjs/common';
import { Prisma, type Patient } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  parseSort,
  type AddConsentInput,
  type CreatePatientInput,
  type MergePatientsInput,
  type PatientQueryInput,
  type UpdatePatientInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { SequenceService } from '../../core/sequence/sequence.service';

/** Age in full years computed from a date-only DOB (UTC). */
export function ageFromDob(dob: Date | null, now = new Date()): number | null {
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

export interface PatientResponse {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phone: string | null;
  phoneAlt: string | null;
  address: string | null;
  passportId: string | null;
  bloodGroup: string;
  allergies: unknown;
  chronicConditions: unknown;
  notes: string | null;
  photoUrl: string | null;
  source: string | null;
  tags: string[];
  noShowCount: number;
  visitCount: number;
  balance: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the card was removed; only management ever sees these. */
  deletedAt: string | null;
}

export interface PatientCardResponse extends PatientResponse {
  /** Unpaid remainder across the patient's open invoices ("0.00" when clear). */
  debt: string;
  counts: { visits: number; invoices: number; documents: number };
}

export interface ConsentResponse {
  id: string;
  type: string;
  signedAt: string;
  note: string | null;
  createdAt: string;
}

function mapPatient(p: Patient): PatientResponse {
  return {
    id: p.id,
    mrn: p.mrn,
    firstName: p.firstName,
    lastName: p.lastName,
    middleName: p.middleName,
    fullName: p.fullName,
    dob: p.dob ? p.dob.toISOString().slice(0, 10) : null,
    age: ageFromDob(p.dob),
    gender: p.gender,
    phone: p.phone,
    phoneAlt: p.phoneAlt,
    address: p.address,
    passportId: p.passportId,
    bloodGroup: p.bloodGroup,
    allergies: p.allergies,
    chronicConditions: p.chronicConditions,
    notes: p.notes,
    photoUrl: p.photoUrl,
    source: p.source,
    tags: p.tags,
    noShowCount: p.noShowCount,
    visitCount: p.visitCount,
    balance: p.balance.toFixed(2),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
  };
}

function buildFullName(lastName: string, firstName: string, middleName?: string | null): string {
  return [lastName, firstName, middleName].filter(Boolean).join(' ');
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PatientQueryInput, user?: AuthUser): Promise<PaginatedResult<PatientResponse>> {
    const { skip, take } = skipTake(query);
    // The flag only asks; holding records.viewDeleted is what decides. Without
    // it a removed card stays removed no matter what the client sends.
    const showDeleted =
      query.deleted === true && user?.permissions.includes('records.viewDeleted') === true;

    if (query.search) {
      // Trigram search path (pg_trgm GIN indexes on "fullName"/"phone").
      // $queryRaw bypasses the tenant extension → clinicId is applied manually.
      const clinicId = TenantContext.requireClinicId();
      const q = query.search;
      const digits = q.replace(/\D/g, '');
      const tag = query.tag ?? null;
      const rows = await this.prisma.db.$queryRaw<Array<Patient & { total: number }>>`
        SELECT *, (COUNT(*) OVER())::int AS "total"
        FROM "Patient"
        WHERE "clinicId" = ${clinicId}
          AND (${showDeleted}::boolean OR "deletedAt" IS NULL)
          AND (
            "fullName" ILIKE '%' || ${q} || '%'
            OR (${digits} <> '' AND "phone" LIKE '%' || ${digits} || '%')
            OR "mrn" ILIKE '%' || ${q} || '%'
          )
          AND (${tag}::text IS NULL OR ${tag}::text = ANY("tags"))
        ORDER BY similarity("fullName", ${q}) DESC
        LIMIT ${take} OFFSET ${skip}
      `;
      const total = rows[0]?.total ?? 0;
      return paginated(rows.map(mapPatient), { page: query.page, limit: query.limit, total });
    }

    const where: Prisma.PatientWhereInput = {
      ...(showDeleted ? {} : { deletedAt: null }),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
    };
    const sort = parseSort(query.sort, { field: 'createdAt', dir: 'desc' });
    const [items, total] = await Promise.all([
      this.prisma.db.patient.findMany({
        where,
        orderBy: { [sort.field]: sort.dir } as Prisma.PatientOrderByWithRelationInput,
        skip,
        take,
      }),
      this.prisma.db.patient.count({ where }),
    ]);
    return paginated(items.map(mapPatient), { page: query.page, limit: query.limit, total });
  }

  async create(input: CreatePatientInput, force: boolean): Promise<PatientResponse> {
    const fullName = buildFullName(input.lastName, input.firstName, input.middleName);
    const dob = input.dob ? new Date(input.dob) : null;

    if (!force) {
      const or: Prisma.PatientWhereInput[] = [];
      if (input.phone) or.push({ phone: input.phone });
      if (dob) or.push({ fullName: { equals: fullName, mode: 'insensitive' }, dob });
      if (or.length > 0) {
        const candidates = await this.prisma.db.patient.findMany({
          where: { deletedAt: null, OR: or },
          select: { id: true, mrn: true, fullName: true, phone: true },
          take: 5,
        });
        if (candidates.length > 0) {
          throw new AppException(
            ErrorCode.DUPLICATE_PATIENT,
            'Possible duplicate patient(s) found; retry with ?force=true to create anyway',
            409,
            candidates,
          );
        }
      }
    }

    const mrn = await this.sequence.nextFormatted('mrn', 'P');
    const patient = await this.prisma.db.patient.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        mrn,
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName ?? null,
        fullName,
        dob,
        gender: input.gender ?? null,
        phone: input.phone ?? null,
        phoneAlt: input.phoneAlt ?? null,
        address: input.address ?? null,
        passportId: input.passportId ?? null,
        bloodGroup: input.bloodGroup ?? undefined,
        allergies: input.allergies as Prisma.InputJsonValue,
        chronicConditions: input.chronicConditions as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        source: input.source ?? null,
        tags: input.tags,
      },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Patient',
      entityId: patient.id,
      after: { mrn: patient.mrn, fullName: patient.fullName, phone: patient.phone },
    });

    return mapPatient(patient);
  }

  async getById(id: string): Promise<PatientCardResponse> {
    const patient = await this.prisma.db.patient.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { visits: true, invoices: true, documents: true } } },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    // Debt = unpaid remainder of open invoices (same definition as the debtors
    // report). It is independent of `balance`, which is the advance/deposit ledger.
    const open = await this.prisma.db.invoice.aggregate({
      where: { patientId: id, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      _sum: { total: true, paidTotal: true },
    });
    const zero = new Prisma.Decimal(0);
    const debt = (open._sum.total ?? zero).sub(open._sum.paidTotal ?? zero);

    return {
      ...mapPatient(patient),
      debt: (debt.gt(0) ? debt : zero).toFixed(2),
      counts: {
        visits: patient._count.visits,
        invoices: patient._count.invoices,
        documents: patient._count.documents,
      },
    };
  }

  async update(id: string, input: UpdatePatientInput): Promise<PatientResponse> {
    const before = await this.prisma.db.patient.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    const data: Prisma.PatientUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.middleName !== undefined) data.middleName = input.middleName;
    if (
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.middleName !== undefined
    ) {
      data.fullName = buildFullName(
        input.lastName ?? before.lastName,
        input.firstName ?? before.firstName,
        input.middleName ?? before.middleName,
      );
    }
    if (input.dob !== undefined) data.dob = new Date(input.dob);
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.phoneAlt !== undefined) data.phoneAlt = input.phoneAlt;
    if (input.address !== undefined) data.address = input.address;
    if (input.passportId !== undefined) data.passportId = input.passportId;
    if (input.bloodGroup !== undefined) data.bloodGroup = input.bloodGroup;
    if (input.allergies !== undefined) data.allergies = input.allergies as Prisma.InputJsonValue;
    if (input.chronicConditions !== undefined) {
      data.chronicConditions = input.chronicConditions as Prisma.InputJsonValue;
    }
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.source !== undefined) data.source = input.source;
    if (input.tags !== undefined) data.tags = input.tags;

    const updated = await this.prisma.db.patient.update({ where: { id }, data });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Patient',
      entityId: id,
      before,
      after: updated,
    });

    return mapPatient(updated);
  }

  async softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    const patient = await this.prisma.db.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    const updated = await this.prisma.db.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Patient',
      entityId: id,
      before: { deletedAt: null },
      after: { deletedAt: updated.deletedAt?.toISOString() },
    });

    return { id, deletedAt: (updated.deletedAt ?? new Date()).toISOString() };
  }

  /** Move all clinical/financial records from duplicate → primary, then soft-delete the duplicate. */
  async merge(
    input: MergePatientsInput,
  ): Promise<{ primaryId: string; duplicateId: string; balance: string }> {
    const { primaryId, duplicateId } = input;

    const result = await this.prisma.db.$transaction(async (tx) => {
      const primary = await tx.patient.findFirst({ where: { id: primaryId, deletedAt: null } });
      const duplicate = await tx.patient.findFirst({ where: { id: duplicateId, deletedAt: null } });
      if (!primary || !duplicate) {
        throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
      }

      const move = { where: { patientId: duplicateId }, data: { patientId: primaryId } };
      await tx.appointment.updateMany(move);
      await tx.visit.updateMany(move);
      await tx.invoice.updateMany(move);
      await tx.labOrder.updateMany(move);
      await tx.patientDocument.updateMany(move);
      await tx.patientConsent.updateMany(move);
      await tx.patientBalanceTransaction.updateMany(move);
      await tx.queueTicket.updateMany(move);
      await tx.feedback.updateMany(move);
      await tx.telegramLink.updateMany(move);

      const mergedBalance = primary.balance.add(duplicate.balance);
      await tx.patient.update({
        where: { id: primaryId },
        data: {
          balance: mergedBalance,
          visitCount: primary.visitCount + duplicate.visitCount,
          noShowCount: primary.noShowCount + duplicate.noShowCount,
        },
      });
      await tx.patient.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date(), balance: new Prisma.Decimal(0) },
      });

      return { primaryId, duplicateId, balance: mergedBalance.toFixed(2) };
    });

    await this.audit.log({
      action: AuditAction.MERGE,
      entity: 'Patient',
      entityId: primaryId,
      after: { primaryId, duplicateId },
    });

    return result;
  }

  // ---------------------------------------------------------------- consents

  async addConsent(patientId: string, input: AddConsentInput): Promise<ConsentResponse> {
    await this.requirePatient(patientId);
    const consent = await this.prisma.db.patientConsent.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        patientId,
        type: input.type,
        signedAt: new Date(input.signedAt),
        note: input.note ?? null,
      },
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'PatientConsent',
      entityId: consent.id,
      after: { patientId, type: consent.type, signedAt: consent.signedAt.toISOString() },
    });
    return {
      id: consent.id,
      type: consent.type,
      signedAt: consent.signedAt.toISOString(),
      note: consent.note,
      createdAt: consent.createdAt.toISOString(),
    };
  }

  async listConsents(
    patientId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult<ConsentResponse>> {
    await this.requirePatient(patientId);
    const { skip, take } = skipTake(query);
    const where: Prisma.PatientConsentWhereInput = { patientId };
    const [items, total] = await Promise.all([
      this.prisma.db.patientConsent.findMany({
        where,
        orderBy: { signedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.db.patientConsent.count({ where }),
    ]);
    return paginated(
      items.map((c) => ({
        id: c.id,
        type: c.type,
        signedAt: c.signedAt.toISOString(),
        note: c.note,
        createdAt: c.createdAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  /** Throws PATIENT_NOT_FOUND unless the patient exists (and is not soft-deleted). */
  async requirePatient(id: string): Promise<Patient> {
    const patient = await this.prisma.db.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    return patient;
  }
}
