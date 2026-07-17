import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type MoneyString,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { XlsxService } from './xlsx.service';
import { type SheetSpec } from './xlsx.service';
import type { DashboardQuery, ReportRangeQuery, RevenueQuery } from './dto';

// NOTE on tenancy: every aggregate below uses $queryRaw, which BYPASSES the
// Prisma tenant extension. Raw SQL therefore carries the clinicId filter
// manually — every query includes `"clinicId" = TenantContext.requireClinicId()`.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Peak-hours heatmap columns: local hours 8..20 inclusive. */
const PEAK_HOURS: readonly number[] = Array.from({ length: 13 }, (_, i) => 8 + i);

// ------------------------------------------------------------- date helpers

/** Asia/Tashkent is fixed UTC+5 (no DST), so offset arithmetic is safe. */
function tashkentDayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000+05:00`);
}

/** Today's calendar date in Asia/Tashkent as "YYYY-MM-DD". */
function todayTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

/** [start, end) UTC range covering local calendar days `from`..`to` inclusive. */
function rangeUtc(from: string, to: string): { start: Date; end: Date } {
  const start = tashkentDayStartUtc(from);
  const end = new Date(tashkentDayStartUtc(to).getTime() + DAY_MS);
  if (start.getTime() >= end.getTime()) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, '`from` must be <= `to`', 400);
  }
  return { start, end };
}

function round(value: number | null, digits: number): number | null {
  if (value === null || Number.isNaN(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Multilingual Json name ({uz,ru,en} or plain string) → display label. */
function labelOf(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const rec = name as Record<string, unknown>;
    for (const key of ['uz', 'ru', 'en']) {
      const v = rec[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return name == null ? '' : JSON.stringify(name);
}

// ------------------------------------------------------------- response types

export interface DashboardResponse {
  date: string;
  revenue: MoneyString;
  visitsCount: number;
  newPatients: number;
  waitingNow: number;
  openShifts: number;
}

export interface BucketAmountRow {
  bucket: string;
  amount: MoneyString;
}

export interface RevenueResponse {
  dimension: RevenueQuery['dimension'];
  groupBy: RevenueQuery['groupBy'];
  rows: BucketAmountRow[];
}

export interface PatientFlowResponse {
  newVsReturning: Array<{
    bucket: string;
    newCount: number;
    returningCount: number;
    visitsCount: number;
  }>;
  peakHours: {
    hours: number[];
    rows: Array<{ dow: number; counts: number[] }>;
  };
  sources: Array<{ source: string; count: number }>;
}

export interface DoctorReportRow {
  doctorUserId: string;
  fullName: string;
  patientsSeen: number;
  visits: number;
  revenue: MoneyString;
  avgVisitMin: number | null;
  noShowRate: number | null;
  returningRate: number | null;
}

export interface ServiceReportRow {
  serviceId: string;
  code: string;
  name: string;
  count: number;
  revenue: MoneyString;
}

export interface QueueReportResponse {
  perDay: Array<{
    bucket: string;
    tickets: number;
    avgWaitMin: number | null;
    avgServiceMin: number | null;
  }>;
  perDoctor: Array<{
    doctorUserId: string;
    fullName: string;
    tickets: number;
    avgWaitMin: number | null;
    avgServiceMin: number | null;
  }>;
}

export interface LabTurnaroundResponse {
  perTest: Array<{ labTestId: string; name: string; count: number; avgHours: number | null }>;
  perDay: Array<{ bucket: string; count: number; avgHours: number | null }>;
}

export interface CashierShiftRow {
  id: string;
  cashierName: string;
  branchId: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: MoneyString;
  expectedCash: MoneyString | null;
  actualCash: MoneyString | null;
  difference: MoneyString | null;
}

// ============================================================ service

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly xlsx: XlsxService,
  ) {}

  // ------------------------------------------------------------- dashboard

  /** Today's headline numbers (Tashkent day boundaries → UTC range). */
  async dashboard(q: DashboardQuery): Promise<DashboardResponse> {
    const clinicId = TenantContext.requireClinicId();
    const date = todayTashkent();
    const { start, end } = rangeUtc(date, date);
    const branch = q.branchId ? Prisma.sql`AND "branchId" = ${q.branchId}` : Prisma.empty;

    // Raw SQL bypasses the tenant extension → clinicId is applied manually.
    const [revenueRows, visitRows, patientRows, waitingRows, shiftRows] = await Promise.all([
      this.prisma.db.$queryRaw<Array<{ revenue: string }>>(Prisma.sql`
        SELECT COALESCE(SUM("amount"), 0)::numeric(14,2)::text AS "revenue"
        FROM "Payment"
        WHERE "clinicId" = ${clinicId} AND "status"::text = 'COMPLETED'
          AND "paidAt" >= ${start} AND "paidAt" < ${end} ${branch}
      `),
      this.prisma.db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "Visit"
        WHERE "clinicId" = ${clinicId}
          AND "startedAt" >= ${start} AND "startedAt" < ${end} ${branch}
      `),
      // Patient has no branchId column → clinic-wide regardless of branch filter.
      this.prisma.db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "Patient"
        WHERE "clinicId" = ${clinicId} AND "deletedAt" IS NULL
          AND "createdAt" >= ${start} AND "createdAt" < ${end}
      `),
      this.prisma.db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "QueueTicket"
        WHERE "clinicId" = ${clinicId} AND "status"::text = 'WAITING'
          AND "createdAt" >= ${start} AND "createdAt" < ${end} ${branch}
      `),
      this.prisma.db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "CashierShift"
        WHERE "clinicId" = ${clinicId} AND "status"::text = 'OPEN' ${branch}
      `),
    ]);

    return {
      date,
      revenue: revenueRows[0]?.revenue ?? '0.00',
      visitsCount: visitRows[0]?.count ?? 0,
      newPatients: patientRows[0]?.count ?? 0,
      waitingNow: waitingRows[0]?.count ?? 0,
      openShifts: shiftRows[0]?.count ?? 0,
    };
  }

  dashboardSheets(data: DashboardResponse): SheetSpec[] {
    return [
      {
        name: 'Dashboard',
        columns: [
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Revenue', key: 'revenue', width: 18, money: true },
          { header: 'Visits', key: 'visitsCount', width: 12 },
          { header: 'New patients', key: 'newPatients', width: 14 },
          { header: 'Waiting now', key: 'waitingNow', width: 14 },
          { header: 'Open shifts', key: 'openShifts', width: 14 },
        ],
        rows: [{ ...data }],
      },
    ];
  }

  // ------------------------------------------------------------- revenue

  async revenue(q: RevenueQuery): Promise<RevenueResponse> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);

    let rows: BucketAmountRow[];
    switch (q.dimension) {
      case 'time': {
        const branch = q.branchId ? Prisma.sql`AND p."branchId" = ${q.branchId}` : Prisma.empty;
        rows = await this.prisma.db.$queryRaw<BucketAmountRow[]>(Prisma.sql`
          SELECT to_char(date_trunc(${q.groupBy}, p."paidAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS "bucket",
                 COALESCE(SUM(p."amount"), 0)::numeric(14,2)::text AS "amount"
          FROM "Payment" p
          WHERE p."clinicId" = ${clinicId} AND p."status"::text = 'COMPLETED'
            AND p."paidAt" >= ${start} AND p."paidAt" < ${end} ${branch}
          GROUP BY 1
          ORDER BY 1
        `);
        break;
      }
      case 'method': {
        const branch = q.branchId ? Prisma.sql`AND p."branchId" = ${q.branchId}` : Prisma.empty;
        rows = await this.prisma.db.$queryRaw<BucketAmountRow[]>(Prisma.sql`
          SELECT p."method"::text AS "bucket",
                 COALESCE(SUM(p."amount"), 0)::numeric(14,2)::text AS "amount"
          FROM "Payment" p
          WHERE p."clinicId" = ${clinicId} AND p."status"::text = 'COMPLETED'
            AND p."paidAt" >= ${start} AND p."paidAt" < ${end} ${branch}
          GROUP BY 1
          ORDER BY SUM(p."amount") DESC
        `);
        break;
      }
      case 'category': {
        const branch = q.branchId ? Prisma.sql`AND i."branchId" = ${q.branchId}` : Prisma.empty;
        const doctor = q.doctorUserId
          ? Prisma.sql`AND il."performerUserId" = ${q.doctorUserId}`
          : Prisma.empty;
        // Simplified allocation per spec: category revenue = sum of line totals
        // of PAID / PARTIALLY_PAID invoices issued within the range.
        rows = await this.prisma.db.$queryRaw<BucketAmountRow[]>(Prisma.sql`
          SELECT COALESCE(sc."name", 'Uncategorized') AS "bucket",
                 COALESCE(SUM(il."lineTotal"), 0)::numeric(14,2)::text AS "amount"
          FROM "InvoiceLine" il
          JOIN "Invoice" i ON i."id" = il."invoiceId"
          LEFT JOIN "Service" s ON s."id" = il."serviceId"
          LEFT JOIN "ServiceCategory" sc ON sc."id" = s."categoryId"
          WHERE il."clinicId" = ${clinicId}
            AND i."issuedAt" >= ${start} AND i."issuedAt" < ${end}
            AND i."status"::text IN ('PAID', 'PARTIALLY_PAID')
            ${branch} ${doctor}
          GROUP BY 1
          ORDER BY SUM(il."lineTotal") DESC
        `);
        break;
      }
      case 'doctor': {
        const branch = q.branchId ? Prisma.sql`AND i."branchId" = ${q.branchId}` : Prisma.empty;
        const doctor = q.doctorUserId
          ? Prisma.sql`AND il."performerUserId" = ${q.doctorUserId}`
          : Prisma.empty;
        rows = await this.prisma.db.$queryRaw<BucketAmountRow[]>(Prisma.sql`
          SELECT COALESCE(u."fullName", 'Unknown') AS "bucket",
                 COALESCE(SUM(il."lineTotal"), 0)::numeric(14,2)::text AS "amount"
          FROM "InvoiceLine" il
          JOIN "Invoice" i ON i."id" = il."invoiceId"
          LEFT JOIN "User" u ON u."id" = il."performerUserId"
          WHERE il."clinicId" = ${clinicId}
            AND i."issuedAt" >= ${start} AND i."issuedAt" < ${end}
            AND i."status"::text IN ('PAID', 'PARTIALLY_PAID')
            ${branch} ${doctor}
          GROUP BY 1
          ORDER BY SUM(il."lineTotal") DESC
        `);
        break;
      }
    }

    return { dimension: q.dimension, groupBy: q.groupBy, rows };
  }

  revenueSheets(data: RevenueResponse): SheetSpec[] {
    return [
      {
        name: 'Revenue',
        columns: [
          { header: 'Bucket', key: 'bucket', width: 28 },
          { header: 'Amount', key: 'amount', width: 18, money: true },
        ],
        rows: data.rows.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- patient flow

  async patientFlow(q: ReportRangeQuery): Promise<PatientFlowResponse> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branch = q.branchId ? Prisma.sql`AND v."branchId" = ${q.branchId}` : Prisma.empty;
    const doctor = q.doctorUserId
      ? Prisma.sql`AND v."doctorUserId" = ${q.doctorUserId}`
      : Prisma.empty;

    const [flowRows, peakRows, sourceRows] = await Promise.all([
      // "New" = the patient's first visit ever; otherwise returning.
      this.prisma.db.$queryRaw<
        Array<{ bucket: string; visitsCount: number; newCount: number }>
      >(Prisma.sql`
        SELECT to_char(date_trunc(${q.groupBy}, v."startedAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS "bucket",
               COUNT(*)::int AS "visitsCount",
               COUNT(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM "Visit" pv
                 WHERE pv."clinicId" = ${clinicId}
                   AND pv."patientId" = v."patientId"
                   AND pv."startedAt" < v."startedAt"
               ))::int AS "newCount"
        FROM "Visit" v
        WHERE v."clinicId" = ${clinicId}
          AND v."startedAt" >= ${start} AND v."startedAt" < ${end} ${branch} ${doctor}
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.db.$queryRaw<Array<{ dow: number; hour: number; count: number }>>(Prisma.sql`
        SELECT EXTRACT(ISODOW FROM (v."startedAt" AT TIME ZONE ${TIMEZONE}))::int AS "dow",
               EXTRACT(HOUR FROM (v."startedAt" AT TIME ZONE ${TIMEZONE}))::int AS "hour",
               COUNT(*)::int AS "count"
        FROM "Visit" v
        WHERE v."clinicId" = ${clinicId}
          AND v."startedAt" >= ${start} AND v."startedAt" < ${end} ${branch} ${doctor}
          AND EXTRACT(HOUR FROM (v."startedAt" AT TIME ZONE ${TIMEZONE})) BETWEEN 8 AND 20
        GROUP BY 1, 2
      `),
      // Patient has no branchId → sources are clinic-wide for the range.
      this.prisma.db.$queryRaw<Array<{ source: string; count: number }>>(Prisma.sql`
        SELECT COALESCE(p."source", 'unknown') AS "source", COUNT(*)::int AS "count"
        FROM "Patient" p
        WHERE p."clinicId" = ${clinicId} AND p."deletedAt" IS NULL
          AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
        GROUP BY 1
        ORDER BY 2 DESC
      `),
    ]);

    const matrix = new Map<number, number[]>();
    for (let dow = 1; dow <= 7; dow += 1) matrix.set(dow, PEAK_HOURS.map(() => 0));
    for (const cell of peakRows) {
      const row = matrix.get(cell.dow);
      const idx = cell.hour - 8;
      if (row && idx >= 0 && idx < row.length) row[idx] = cell.count;
    }

    return {
      newVsReturning: flowRows.map((r) => ({
        bucket: r.bucket,
        newCount: r.newCount,
        returningCount: r.visitsCount - r.newCount,
        visitsCount: r.visitsCount,
      })),
      peakHours: {
        hours: [...PEAK_HOURS],
        rows: Array.from(matrix.entries()).map(([dow, counts]) => ({ dow, counts })),
      },
      sources: sourceRows,
    };
  }

  patientFlowSheets(data: PatientFlowResponse): SheetSpec[] {
    return [
      {
        name: 'New vs returning',
        columns: [
          { header: 'Bucket', key: 'bucket', width: 14 },
          { header: 'New', key: 'newCount', width: 10 },
          { header: 'Returning', key: 'returningCount', width: 12 },
          { header: 'Visits', key: 'visitsCount', width: 10 },
        ],
        rows: data.newVsReturning.map((r) => ({ ...r })),
      },
      {
        name: 'Peak hours',
        columns: [
          { header: 'Weekday', key: 'dow', width: 10 },
          ...data.peakHours.hours.map((h) => ({
            header: `${h}:00`,
            key: `h${h}`,
            width: 8,
          })),
        ],
        rows: data.peakHours.rows.map((r) => {
          const row: Record<string, unknown> = { dow: r.dow };
          data.peakHours.hours.forEach((h, i) => {
            row[`h${h}`] = r.counts[i] ?? 0;
          });
          return row;
        }),
      },
      {
        name: 'Sources',
        columns: [
          { header: 'Source', key: 'source', width: 24 },
          { header: 'Patients', key: 'count', width: 12 },
        ],
        rows: data.sources.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- doctors

  async doctors(q: ReportRangeQuery): Promise<DoctorReportRow[]> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branchV = q.branchId ? Prisma.sql`AND v."branchId" = ${q.branchId}` : Prisma.empty;
    const doctorV = q.doctorUserId
      ? Prisma.sql`AND v."doctorUserId" = ${q.doctorUserId}`
      : Prisma.empty;
    const branchI = q.branchId ? Prisma.sql`AND i."branchId" = ${q.branchId}` : Prisma.empty;
    const doctorIl = q.doctorUserId
      ? Prisma.sql`AND il."performerUserId" = ${q.doctorUserId}`
      : Prisma.empty;
    const branchA = q.branchId ? Prisma.sql`AND a."branchId" = ${q.branchId}` : Prisma.empty;
    const doctorA = q.doctorUserId
      ? Prisma.sql`AND a."doctorUserId" = ${q.doctorUserId}`
      : Prisma.empty;

    const [visitRows, revenueRows, apptRows] = await Promise.all([
      // "Returning" = the patient already had a visit before the range start.
      this.prisma.db.$queryRaw<
        Array<{
          doctorUserId: string;
          fullName: string;
          visits: number;
          patientsSeen: number;
          avgVisitMin: number | null;
          returningRate: number | null;
        }>
      >(Prisma.sql`
        SELECT v."doctorUserId" AS "doctorUserId",
               u."fullName" AS "fullName",
               COUNT(*)::int AS "visits",
               COUNT(DISTINCT v."patientId")::int AS "patientsSeen",
               AVG(EXTRACT(EPOCH FROM (v."completedAt" - v."startedAt")) / 60.0)::float8 AS "avgVisitMin",
               (COUNT(DISTINCT v."patientId") FILTER (WHERE EXISTS (
                  SELECT 1 FROM "Visit" pv
                  WHERE pv."clinicId" = ${clinicId}
                    AND pv."patientId" = v."patientId"
                    AND pv."startedAt" < ${start}
               )))::float8 / NULLIF(COUNT(DISTINCT v."patientId"), 0) AS "returningRate"
        FROM "Visit" v
        JOIN "User" u ON u."id" = v."doctorUserId"
        WHERE v."clinicId" = ${clinicId}
          AND v."startedAt" >= ${start} AND v."startedAt" < ${end} ${branchV} ${doctorV}
        GROUP BY 1, 2
      `),
      this.prisma.db.$queryRaw<
        Array<{ doctorUserId: string; fullName: string; revenue: string }>
      >(Prisma.sql`
        SELECT il."performerUserId" AS "doctorUserId",
               u."fullName" AS "fullName",
               COALESCE(SUM(il."lineTotal"), 0)::numeric(14,2)::text AS "revenue"
        FROM "InvoiceLine" il
        JOIN "Invoice" i ON i."id" = il."invoiceId"
        JOIN "User" u ON u."id" = il."performerUserId"
        WHERE il."clinicId" = ${clinicId}
          AND il."performerUserId" IS NOT NULL
          AND i."issuedAt" >= ${start} AND i."issuedAt" < ${end}
          AND i."status"::text IN ('PAID', 'PARTIALLY_PAID')
          ${branchI} ${doctorIl}
        GROUP BY 1, 2
      `),
      this.prisma.db.$queryRaw<
        Array<{ doctorUserId: string; fullName: string; total: number; noShow: number }>
      >(Prisma.sql`
        SELECT a."doctorUserId" AS "doctorUserId",
               u."fullName" AS "fullName",
               COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE a."status"::text = 'NO_SHOW')::int AS "noShow"
        FROM "Appointment" a
        JOIN "User" u ON u."id" = a."doctorUserId"
        WHERE a."clinicId" = ${clinicId}
          AND a."startAt" >= ${start} AND a."startAt" < ${end} ${branchA} ${doctorA}
        GROUP BY 1, 2
      `),
    ]);

    const byDoctor = new Map<string, DoctorReportRow>();
    const ensure = (doctorUserId: string, fullName: string): DoctorReportRow => {
      let row = byDoctor.get(doctorUserId);
      if (!row) {
        row = {
          doctorUserId,
          fullName,
          patientsSeen: 0,
          visits: 0,
          revenue: '0.00',
          avgVisitMin: null,
          noShowRate: null,
          returningRate: null,
        };
        byDoctor.set(doctorUserId, row);
      }
      return row;
    };

    for (const r of visitRows) {
      const row = ensure(r.doctorUserId, r.fullName);
      row.visits = r.visits;
      row.patientsSeen = r.patientsSeen;
      row.avgVisitMin = round(r.avgVisitMin, 1);
      row.returningRate = round(r.returningRate, 3);
    }
    for (const r of revenueRows) {
      const row = ensure(r.doctorUserId, r.fullName);
      row.revenue = r.revenue;
    }
    for (const r of apptRows) {
      const row = ensure(r.doctorUserId, r.fullName);
      row.noShowRate = r.total > 0 ? round(r.noShow / r.total, 3) : null;
    }

    return [...byDoctor.values()].sort((a, b) => Number(b.revenue) - Number(a.revenue));
  }

  doctorsSheets(rows: DoctorReportRow[]): SheetSpec[] {
    return [
      {
        name: 'Doctors',
        columns: [
          { header: 'Doctor', key: 'fullName', width: 28 },
          { header: 'Patients seen', key: 'patientsSeen', width: 14 },
          { header: 'Visits', key: 'visits', width: 10 },
          { header: 'Revenue', key: 'revenue', width: 18, money: true },
          { header: 'Avg visit (min)', key: 'avgVisitMin', width: 15 },
          { header: 'No-show rate', key: 'noShowRate', width: 14 },
          { header: 'Returning rate', key: 'returningRate', width: 15 },
        ],
        rows: rows.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- services

  async services(q: ReportRangeQuery): Promise<ServiceReportRow[]> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branch = q.branchId ? Prisma.sql`AND i."branchId" = ${q.branchId}` : Prisma.empty;
    const doctor = q.doctorUserId
      ? Prisma.sql`AND il."performerUserId" = ${q.doctorUserId}`
      : Prisma.empty;

    const rows = await this.prisma.db.$queryRaw<
      Array<{ serviceId: string; code: string; name: unknown; count: number; revenue: string }>
    >(Prisma.sql`
      SELECT il."serviceId" AS "serviceId",
             s."code" AS "code",
             s."name" AS "name",
             COALESCE(SUM(il."quantity"), 0)::int AS "count",
             COALESCE(SUM(il."lineTotal"), 0)::numeric(14,2)::text AS "revenue"
      FROM "InvoiceLine" il
      JOIN "Invoice" i ON i."id" = il."invoiceId"
      JOIN "Service" s ON s."id" = il."serviceId"
      WHERE il."clinicId" = ${clinicId}
        AND i."issuedAt" >= ${start} AND i."issuedAt" < ${end}
        AND i."status"::text IN ('PAID', 'PARTIALLY_PAID')
        ${branch} ${doctor}
      GROUP BY 1, 2, 3
      ORDER BY SUM(il."lineTotal") DESC
    `);

    return rows.map((r) => ({
      serviceId: r.serviceId,
      code: r.code,
      name: labelOf(r.name),
      count: r.count,
      revenue: r.revenue,
    }));
  }

  servicesSheets(rows: ServiceReportRow[]): SheetSpec[] {
    return [
      {
        name: 'Services',
        columns: [
          { header: 'Code', key: 'code', width: 12 },
          { header: 'Service', key: 'name', width: 32 },
          { header: 'Count', key: 'count', width: 10 },
          { header: 'Revenue', key: 'revenue', width: 18, money: true },
        ],
        rows: rows.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- queue

  async queue(q: ReportRangeQuery): Promise<QueueReportResponse> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branch = q.branchId ? Prisma.sql`AND t."branchId" = ${q.branchId}` : Prisma.empty;
    const doctor = q.doctorUserId
      ? Prisma.sql`AND t."doctorUserId" = ${q.doctorUserId}`
      : Prisma.empty;

    const [perDay, perDoctor] = await Promise.all([
      this.prisma.db.$queryRaw<
        Array<{
          bucket: string;
          tickets: number;
          avgWaitMin: number | null;
          avgServiceMin: number | null;
        }>
      >(Prisma.sql`
        SELECT to_char(date_trunc('day', t."createdAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS "bucket",
               COUNT(*)::int AS "tickets",
               AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."createdAt")) / 60.0)::float8 AS "avgWaitMin",
               AVG(EXTRACT(EPOCH FROM (t."finishedAt" - t."startedAt")) / 60.0)::float8 AS "avgServiceMin"
        FROM "QueueTicket" t
        WHERE t."clinicId" = ${clinicId}
          AND t."createdAt" >= ${start} AND t."createdAt" < ${end} ${branch} ${doctor}
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.db.$queryRaw<
        Array<{
          doctorUserId: string;
          fullName: string;
          tickets: number;
          avgWaitMin: number | null;
          avgServiceMin: number | null;
        }>
      >(Prisma.sql`
        SELECT t."doctorUserId" AS "doctorUserId",
               u."fullName" AS "fullName",
               COUNT(*)::int AS "tickets",
               AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."createdAt")) / 60.0)::float8 AS "avgWaitMin",
               AVG(EXTRACT(EPOCH FROM (t."finishedAt" - t."startedAt")) / 60.0)::float8 AS "avgServiceMin"
        FROM "QueueTicket" t
        JOIN "User" u ON u."id" = t."doctorUserId"
        WHERE t."clinicId" = ${clinicId}
          AND t."doctorUserId" IS NOT NULL
          AND t."createdAt" >= ${start} AND t."createdAt" < ${end} ${branch} ${doctor}
        GROUP BY 1, 2
        ORDER BY 3 DESC
      `),
    ]);

    return {
      perDay: perDay.map((r) => ({
        bucket: r.bucket,
        tickets: r.tickets,
        avgWaitMin: round(r.avgWaitMin, 1),
        avgServiceMin: round(r.avgServiceMin, 1),
      })),
      perDoctor: perDoctor.map((r) => ({
        doctorUserId: r.doctorUserId,
        fullName: r.fullName,
        tickets: r.tickets,
        avgWaitMin: round(r.avgWaitMin, 1),
        avgServiceMin: round(r.avgServiceMin, 1),
      })),
    };
  }

  queueSheets(data: QueueReportResponse): SheetSpec[] {
    return [
      {
        name: 'Per day',
        columns: [
          { header: 'Day', key: 'bucket', width: 14 },
          { header: 'Tickets', key: 'tickets', width: 10 },
          { header: 'Avg wait (min)', key: 'avgWaitMin', width: 15 },
          { header: 'Avg service (min)', key: 'avgServiceMin', width: 17 },
        ],
        rows: data.perDay.map((r) => ({ ...r })),
      },
      {
        name: 'Per doctor',
        columns: [
          { header: 'Doctor', key: 'fullName', width: 28 },
          { header: 'Tickets', key: 'tickets', width: 10 },
          { header: 'Avg wait (min)', key: 'avgWaitMin', width: 15 },
          { header: 'Avg service (min)', key: 'avgServiceMin', width: 17 },
        ],
        rows: data.perDoctor.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- lab turnaround

  async labTurnaround(q: ReportRangeQuery): Promise<LabTurnaroundResponse> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branch = q.branchId ? Prisma.sql`AND o."branchId" = ${q.branchId}` : Prisma.empty;

    const [perTest, perDay] = await Promise.all([
      this.prisma.db.$queryRaw<
        Array<{ labTestId: string; name: unknown; count: number; avgHours: number | null }>
      >(Prisma.sql`
        SELECT lt."id" AS "labTestId",
               lt."name" AS "name",
               COUNT(*)::int AS "count",
               AVG(EXTRACT(EPOCH FROM (lr."approvedAt" - o."createdAt")) / 3600.0)::float8 AS "avgHours"
        FROM "LabResult" lr
        JOIN "LabOrderItem" oi ON oi."id" = lr."orderItemId"
        JOIN "LabOrder" o ON o."id" = oi."orderId"
        JOIN "LabTest" lt ON lt."id" = oi."labTestId"
        WHERE o."clinicId" = ${clinicId}
          AND lr."approvedAt" IS NOT NULL
          AND o."createdAt" >= ${start} AND o."createdAt" < ${end} ${branch}
        GROUP BY 1, 2
        ORDER BY 4 DESC
      `),
      this.prisma.db.$queryRaw<
        Array<{ bucket: string; count: number; avgHours: number | null }>
      >(Prisma.sql`
        SELECT to_char(date_trunc('day', o."createdAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS "bucket",
               COUNT(*)::int AS "count",
               AVG(EXTRACT(EPOCH FROM (lr."approvedAt" - o."createdAt")) / 3600.0)::float8 AS "avgHours"
        FROM "LabResult" lr
        JOIN "LabOrderItem" oi ON oi."id" = lr."orderItemId"
        JOIN "LabOrder" o ON o."id" = oi."orderId"
        WHERE o."clinicId" = ${clinicId}
          AND lr."approvedAt" IS NOT NULL
          AND o."createdAt" >= ${start} AND o."createdAt" < ${end} ${branch}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    return {
      perTest: perTest.map((r) => ({
        labTestId: r.labTestId,
        name: labelOf(r.name),
        count: r.count,
        avgHours: round(r.avgHours, 2),
      })),
      perDay: perDay.map((r) => ({
        bucket: r.bucket,
        count: r.count,
        avgHours: round(r.avgHours, 2),
      })),
    };
  }

  labTurnaroundSheets(data: LabTurnaroundResponse): SheetSpec[] {
    return [
      {
        name: 'Per test',
        columns: [
          { header: 'Test', key: 'name', width: 32 },
          { header: 'Results', key: 'count', width: 10 },
          { header: 'Avg hours', key: 'avgHours', width: 12 },
        ],
        rows: data.perTest.map((r) => ({ ...r })),
      },
      {
        name: 'Per day',
        columns: [
          { header: 'Day', key: 'bucket', width: 14 },
          { header: 'Results', key: 'count', width: 10 },
          { header: 'Avg hours', key: 'avgHours', width: 12 },
        ],
        rows: data.perDay.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- cashier shifts

  async cashierShifts(q: ReportRangeQuery): Promise<CashierShiftRow[]> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = rangeUtc(q.from, q.to);
    const branch = q.branchId ? Prisma.sql`AND s."branchId" = ${q.branchId}` : Prisma.empty;

    const rows = await this.prisma.db.$queryRaw<
      Array<{
        id: string;
        cashierName: string;
        branchId: string;
        status: string;
        openedAt: Date;
        closedAt: Date | null;
        openingCash: string;
        expectedCash: string | null;
        actualCash: string | null;
        difference: string | null;
      }>
    >(Prisma.sql`
      SELECT s."id" AS "id",
             u."fullName" AS "cashierName",
             s."branchId" AS "branchId",
             s."status"::text AS "status",
             s."openedAt" AS "openedAt",
             s."closedAt" AS "closedAt",
             s."openingCash"::text AS "openingCash",
             s."expectedCash"::text AS "expectedCash",
             s."actualCash"::text AS "actualCash",
             (s."actualCash" - s."expectedCash")::numeric(14,2)::text AS "difference"
      FROM "CashierShift" s
      JOIN "User" u ON u."id" = s."cashierUserId"
      WHERE s."clinicId" = ${clinicId}
        AND s."openedAt" >= ${start} AND s."openedAt" < ${end} ${branch}
      ORDER BY s."openedAt" DESC
    `);

    return rows.map((r) => ({
      id: r.id,
      cashierName: r.cashierName,
      branchId: r.branchId,
      status: r.status,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      openingCash: r.openingCash,
      expectedCash: r.expectedCash,
      actualCash: r.actualCash,
      difference: r.difference,
    }));
  }

  cashierShiftsSheets(rows: CashierShiftRow[]): SheetSpec[] {
    return [
      {
        name: 'Cashier shifts',
        columns: [
          { header: 'Cashier', key: 'cashierName', width: 28 },
          { header: 'Status', key: 'status', width: 10 },
          { header: 'Opened at', key: 'openedAt', width: 22 },
          { header: 'Closed at', key: 'closedAt', width: 22 },
          { header: 'Opening cash', key: 'openingCash', width: 15, money: true },
          { header: 'Expected', key: 'expectedCash', width: 15, money: true },
          { header: 'Actual', key: 'actualCash', width: 15, money: true },
          { header: 'Difference', key: 'difference', width: 15, money: true },
        ],
        rows: rows.map((r) => ({ ...r })),
      },
    ];
  }

  // ------------------------------------------------------------- export

  /**
   * XLSX export gate shared by every endpoint: requires `reports.export`
   * (JSON access only needs `reports.read`) and audits the EXPORT action.
   */
  async prepareExport(user: AuthUser, reportKey: string, sheets: SheetSpec[]): Promise<Buffer> {
    if (!user.permissions.includes('reports.export')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.export', 403);
    }
    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: reportKey,
    });
    return this.xlsx.buildWorkbook(sheets);
  }
}
