import { Injectable } from '@nestjs/common';
import type {
  Prisma} from '@prisma/client';
import {
  UserRole,
  ScheduleExceptionType,
  type DoctorSchedule,
  type ScheduleException,
  type StaffProfile,
  type User,
} from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type AddScheduleExceptionInput,
  type AuthUser,
  type KpiQueryInput,
  type SetDoctorScheduleInput,
  type UpsertStaffProfileInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { ScheduleQuery, StaffDirectoryQuery } from './dto';

// ---------------------------------------------------------------- responses

export interface StaffDirectoryItem {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  specialty: string | null;
  licenseNo: string | null;
  hireDate: string | null;
  photoUrl: string | null;
  bio: string | null;
  slotMinutes: number | null;
  branches: Array<{ id: string; name: string }>;
  createdAt: string;
}

export interface StaffProfileResponse {
  userId: string;
  specialty: string | null;
  licenseNo: string | null;
  hireDate: string | null;
  photoUrl: string | null;
  bio: string | null;
  slotMinutes: number | null;
  updatedAt: string;
}

export interface ScheduleRowResponse {
  id: string;
  branchId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isActive: boolean;
}

export interface ScheduleExceptionResponse {
  id: string;
  type: string;
  dateFrom: string;
  dateTo: string;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  createdAt: string;
}

export interface DoctorScheduleResponse {
  doctorUserId: string;
  schedule: ScheduleRowResponse[];
  exceptions: ScheduleExceptionResponse[];
}

export interface DoctorKpiResponse {
  doctorUserId: string;
  from: string;
  to: string;
  patientsSeen: number;
  visits: number;
  /** Sum of performed InvoiceLine totals on paid/partially-paid invoices — decimal string. */
  revenue: string;
  avgVisitMin: number | null;
  /** 0..1 share of NO_SHOW among non-cancelled appointments. */
  noShowRate: number;
  /** 0..1 share of period patients with an earlier visit to this doctor. */
  returningPatientRate: number;
  avgRating: number | null;
}

type UserWithStaff = User & {
  staffProfile: StaffProfile | null;
  branches: Array<{ branchId: string }>;
};

function mapScheduleRow(row: DoctorSchedule): ScheduleRowResponse {
  return {
    id: row.id,
    branchId: row.branchId,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    slotMinutes: row.slotMinutes,
    isActive: row.isActive,
  };
}

function mapException(e: ScheduleException): ScheduleExceptionResponse {
  return {
    id: e.id,
    type: e.type,
    dateFrom: e.dateFrom.toISOString().slice(0, 10),
    dateTo: e.dateTo.toISOString().slice(0, 10),
    startTime: e.startTime,
    endTime: e.endTime,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  };
}

function mapProfile(p: StaffProfile): StaffProfileResponse {
  return {
    userId: p.userId,
    specialty: p.specialty,
    licenseNo: p.licenseNo,
    hireDate: p.hireDate ? p.hireDate.toISOString().slice(0, 10) : null,
    photoUrl: p.photoUrl,
    bio: p.bio,
    slotMinutes: p.slotMinutes,
    updatedAt: p.updatedAt.toISOString(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- directory

  async directory(query: StaffDirectoryQuery): Promise<PaginatedResult<StaffDirectoryItem>> {
    const clinicId = TenantContext.requireClinicId();
    const { skip, take } = skipTake(query);

    const where: Prisma.UserWhereInput = {
      // User is intentionally outside tenant auto-scoping (nullable clinicId,
      // platform users) → unscoped client with a manual clinicId filter.
      clinicId,
      deletedAt: null,
      role: { not: UserRole.PATIENT, ...(query.role ? { equals: query.role } : {}) },
      ...(query.search
        ? { fullName: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.specialty
        ? { staffProfile: { specialty: { contains: query.specialty, mode: 'insensitive' as const } } }
        : {}),
      ...(query.branchId ? { branches: { some: { branchId: query.branchId } } } : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.unscoped.user.findMany({
        where,
        include: { staffProfile: true, branches: { select: { branchId: true } } },
        orderBy: { fullName: 'asc' },
        skip,
        take,
      }),
      this.prisma.unscoped.user.count({ where }),
    ]);

    // Resolve branch names via the tenant-scoped client (UserBranch has no Branch relation).
    const branchIds = [...new Set(users.flatMap((u) => u.branches.map((b) => b.branchId)))];
    const branches =
      branchIds.length > 0
        ? await this.prisma.db.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true },
          })
        : [];
    const branchName = new Map(branches.map((b) => [b.id, b.name]));

    const items = users.map((u: UserWithStaff): StaffDirectoryItem => ({
      id: u.id,
      fullName: u.fullName,
      phone: u.phone,
      email: u.email,
      role: u.role,
      status: u.status,
      avatarUrl: u.avatarUrl,
      specialty: u.staffProfile?.specialty ?? null,
      licenseNo: u.staffProfile?.licenseNo ?? null,
      hireDate: u.staffProfile?.hireDate
        ? u.staffProfile.hireDate.toISOString().slice(0, 10)
        : null,
      photoUrl: u.staffProfile?.photoUrl ?? null,
      bio: u.staffProfile?.bio ?? null,
      slotMinutes: u.staffProfile?.slotMinutes ?? null,
      branches: u.branches.map((b) => ({
        id: b.branchId,
        name: branchName.get(b.branchId) ?? '',
      })),
      createdAt: u.createdAt.toISOString(),
    }));

    return paginated(items, { page: query.page, limit: query.limit, total });
  }

  // ------------------------------------------------------------- profile

  async upsertProfile(userId: string, input: UpsertStaffProfileInput): Promise<StaffProfileResponse> {
    await this.requireStaffUser(userId);
    const before = await this.prisma.db.staffProfile.findFirst({ where: { userId } });

    const fields = {
      specialty: input.specialty,
      licenseNo: input.licenseNo,
      hireDate: input.hireDate ? new Date(`${input.hireDate}T00:00:00.000Z`) : undefined,
      bio: input.bio,
      slotMinutes: input.slotMinutes,
    };

    const profile = await this.prisma.db.staffProfile.upsert({
      where: { userId },
      create: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        userId,
        ...fields,
      },
      update: fields,
    });

    await this.audit.log({
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      entity: 'StaffProfile',
      entityId: profile.id,
      before: before ? mapProfile(before) : undefined,
      after: mapProfile(profile),
    });

    return mapProfile(profile);
  }

  // ------------------------------------------------------------- schedule

  async getSchedule(userId: string, query: ScheduleQuery): Promise<DoctorScheduleResponse> {
    await this.requireStaffUser(userId);

    const today = new Date(new Date().toISOString().slice(0, 10));
    const [rows, exceptions] = await Promise.all([
      this.prisma.db.doctorSchedule.findMany({
        where: { doctorUserId: userId, ...(query.branchId ? { branchId: query.branchId } : {}) },
        orderBy: [{ branchId: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.db.scheduleException.findMany({
        where: { doctorUserId: userId, dateTo: { gte: today } },
        orderBy: { dateFrom: 'asc' },
      }),
    ]);

    return {
      doctorUserId: userId,
      schedule: rows.map(mapScheduleRow),
      exceptions: exceptions.map(mapException),
    };
  }

  /** Replaces the doctor's whole weekly template for one branch (deleteMany + createMany). */
  async setSchedule(userId: string, input: SetDoctorScheduleInput): Promise<DoctorScheduleResponse> {
    await this.requireStaffUser(userId);

    const branch = await this.prisma.db.branch.findFirst({ where: { id: input.branchId } });
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);

    for (const item of input.items) {
      // "HH:mm" zero-padded strings compare lexicographically.
      if (item.endTime <= item.startTime) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          `endTime must be after startTime (weekday ${item.weekday}: ${item.startTime}-${item.endTime})`,
          400,
        );
      }
    }

    const clinicId = TenantContext.requireClinicId();
    const before = await this.prisma.db.doctorSchedule.findMany({
      where: { doctorUserId: userId, branchId: input.branchId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });

    await this.prisma.db.$transaction(async (tx) => {
      await tx.doctorSchedule.deleteMany({
        where: { doctorUserId: userId, branchId: input.branchId },
      });
      if (input.items.length > 0) {
        await tx.doctorSchedule.createMany({
          data: input.items.map((item) => ({
            // Nested/branched writes are not auto-stamped — set clinicId explicitly.
            clinicId,
            branchId: input.branchId,
            doctorUserId: userId,
            weekday: item.weekday,
            startTime: item.startTime,
            endTime: item.endTime,
            slotMinutes: item.slotMinutes,
          })),
        });
      }
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'DoctorSchedule',
      entityId: userId,
      before: { branchId: input.branchId, items: before.map(mapScheduleRow) },
      after: { branchId: input.branchId, items: input.items },
    });

    return this.getSchedule(userId, { branchId: input.branchId });
  }

  // ------------------------------------------------------------- exceptions

  async addException(
    userId: string,
    input: AddScheduleExceptionInput,
  ): Promise<ScheduleExceptionResponse> {
    await this.requireStaffUser(userId);

    if (input.dateTo < input.dateFrom) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'dateTo must not be before dateFrom', 400);
    }
    if (input.type === ScheduleExceptionType.CUSTOM_HOURS) {
      if (!input.startTime || !input.endTime) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'CUSTOM_HOURS exception requires startTime and endTime',
          400,
        );
      }
      if (input.endTime <= input.startTime) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'endTime must be after startTime', 400);
      }
    }

    const exception = await this.prisma.db.scheduleException.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        doctorUserId: userId,
        type: input.type,
        dateFrom: new Date(`${input.dateFrom}T00:00:00.000Z`),
        dateTo: new Date(`${input.dateTo}T00:00:00.000Z`),
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        note: input.note ?? null,
      },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'ScheduleException',
      entityId: exception.id,
      after: mapException(exception),
    });

    return mapException(exception);
  }

  async removeException(id: string): Promise<{ id: string }> {
    const exception = await this.prisma.db.scheduleException.findFirst({ where: { id } });
    if (!exception) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Schedule exception not found', 404);
    }

    await this.prisma.db.scheduleException.delete({ where: { id } });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'ScheduleException',
      entityId: id,
      before: mapException(exception),
    });

    return { id };
  }

  // ------------------------------------------------------------- KPI

  async kpi(userId: string, query: KpiQueryInput, actor: AuthUser): Promise<DoctorKpiResponse> {
    // Doctors may only look at their own KPI (object-level check on top of payroll.read).
    if (actor.role === UserRole.DOCTOR && actor.id !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Doctors may only view their own KPI', 403);
    }
    await this.requireStaffUser(userId);

    const clinicId = TenantContext.requireClinicId();
    const now = new Date();
    const from = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(now.getTime() - 30 * DAY_MS);
    // `to` is an inclusive calendar date → exclusive upper bound is the next day.
    const to = query.to ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) : now;

    // Raw SQL bypasses the tenant extension → clinicId is bound manually in every query.
    const [visitRows, revenueRows, apptRows, returningRows, ratingRows] = await Promise.all([
      this.prisma.db.$queryRaw<Array<{ visits: number; patients: number; avgMin: number | null }>>`
        SELECT COUNT(*)::int AS "visits",
               COUNT(DISTINCT "patientId")::int AS "patients",
               AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) / 60)::float8 AS "avgMin"
        FROM "Visit"
        WHERE "clinicId" = ${clinicId} AND "doctorUserId" = ${userId}
          AND "status"::text <> 'CANCELLED'
          AND "startedAt" >= ${from} AND "startedAt" < ${to}
      `,
      this.prisma.db.$queryRaw<Array<{ revenue: string }>>`
        SELECT COALESCE(SUM(il."lineTotal"), 0)::text AS "revenue"
        FROM "InvoiceLine" il
        JOIN "Invoice" i ON i."id" = il."invoiceId"
        WHERE il."clinicId" = ${clinicId} AND il."performerUserId" = ${userId}
          AND i."status"::text IN ('PAID', 'PARTIALLY_PAID')
          AND i."issuedAt" >= ${from} AND i."issuedAt" < ${to}
      `,
      this.prisma.db.$queryRaw<Array<{ total: number; noShow: number }>>`
        SELECT COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE "status"::text = 'NO_SHOW')::int AS "noShow"
        FROM "Appointment"
        WHERE "clinicId" = ${clinicId} AND "doctorUserId" = ${userId}
          AND "status"::text <> 'CANCELLED'
          AND "startAt" >= ${from} AND "startAt" < ${to}
      `,
      this.prisma.db.$queryRaw<Array<{ patients: number; returning: number }>>`
        WITH "periodPatients" AS (
          SELECT DISTINCT "patientId"
          FROM "Visit"
          WHERE "clinicId" = ${clinicId} AND "doctorUserId" = ${userId}
            AND "status"::text <> 'CANCELLED'
            AND "startedAt" >= ${from} AND "startedAt" < ${to}
        )
        SELECT COUNT(*)::int AS "patients",
               COUNT(*) FILTER (
                 WHERE EXISTS (
                   SELECT 1 FROM "Visit" v2
                   WHERE v2."clinicId" = ${clinicId}
                     AND v2."doctorUserId" = ${userId}
                     AND v2."patientId" = "periodPatients"."patientId"
                     AND v2."startedAt" < ${from}
                 )
               )::int AS "returning"
        FROM "periodPatients"
      `,
      this.prisma.db.$queryRaw<Array<{ avgRating: number | null }>>`
        SELECT AVG("rating")::float8 AS "avgRating"
        FROM "Feedback"
        WHERE "clinicId" = ${clinicId} AND "doctorUserId" = ${userId}
          AND "createdAt" >= ${from} AND "createdAt" < ${to}
      `,
    ]);

    const visits = visitRows[0] ?? { visits: 0, patients: 0, avgMin: null };
    const appts = apptRows[0] ?? { total: 0, noShow: 0 };
    const ret = returningRows[0] ?? { patients: 0, returning: 0 };
    const avgMin = visits.avgMin;
    const avgRating = ratingRows[0]?.avgRating ?? null;

    return {
      doctorUserId: userId,
      from: from.toISOString(),
      to: to.toISOString(),
      patientsSeen: visits.patients,
      visits: visits.visits,
      revenue: revenueRows[0]?.revenue ?? '0',
      avgVisitMin: avgMin === null ? null : Math.round(avgMin * 10) / 10,
      noShowRate: appts.total > 0 ? Math.round((appts.noShow / appts.total) * 1000) / 1000 : 0,
      returningPatientRate:
        ret.patients > 0 ? Math.round((ret.returning / ret.patients) * 1000) / 1000 : 0,
      avgRating: avgRating === null ? null : Math.round(avgRating * 100) / 100,
    };
  }

  // ------------------------------------------------------------- helpers

  /** Ensures the user is a non-patient staff member of the current clinic. */
  async requireStaffUser(userId: string): Promise<User> {
    // User is intentionally outside tenant auto-scoping — clinicId filtered manually.
    const user = await this.prisma.unscoped.user.findFirst({
      where: {
        id: userId,
        clinicId: TenantContext.requireClinicId(),
        deletedAt: null,
        role: { not: UserRole.PATIENT },
      },
    });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'Staff member not found', 404);
    return user;
  }
}
