import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type DoctorActivityMoneyCounts,
  type DoctorActivityQueryInput,
  type DoctorActivityReferralLine,
  type DoctorActivityReport,
  type DoctorActivityVisitLine,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { calcAccrual, type AccrualLine, type AccrualRule } from '../staff/payroll.calc';
import { cashflowRangeUtc } from './cashflow.service';

interface VisitAgg {
  total: number;
  completed: number;
  inProgress: number;
  patients: number;
}

interface MoneyAgg {
  patients: number;
  orders: number;
  items: number;
  amount: string;
  paidAmount: string;
  unpaidAmount: string;
}

interface PeriodRow {
  bucket: string;
  visits: number;
  labOrders: number;
  labAmount: string;
  ultrasoundOrders: number;
  ultrasoundAmount: string;
  echoOrders: number;
  echoAmount: string;
}

/** Invoice line is EXO when the service is flagged or its catalogue folder says so. */
const ECHO_LINE = Prisma.sql`(COALESCE(s."isEcho", false) OR sc.name ILIKE '%exo%' OR sc.name ILIKE '%echo%' OR sc.name ILIKE '%эхо%')`;

const money = (): DoctorActivityMoneyCounts => ({
  patients: 0,
  orders: 0,
  items: 0,
  amount: '0.00',
  paidAmount: '0.00',
  unpaidAmount: '0.00',
});

@Injectable()
export class DoctorActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    query: DoctorActivityQueryInput,
    user: AuthUser,
    activeBranchId: string,
  ): Promise<DoctorActivityReport> {
    if (
      !user.permissions.includes('reports.own.read') &&
      !user.permissions.includes('reports.read')
    ) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing doctor report permission', 403);
    }
    const branchId = query.branchId ?? activeBranchId;
    if (user.branchIds.length && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    if (user.role === 'DOCTOR' && query.doctorUserId && query.doctorUserId !== user.id) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Doctors can view their own report only', 403);
    }
    const doctorUserId =
      user.role === 'DOCTOR' ? user.id : (query.doctorUserId ?? user.id);
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = cashflowRangeUtc(query.from, query.to);

    const doctor = await this.prisma.db.user.findFirst({
      where: { id: doctorUserId, deletedAt: null },
      select: { id: true, fullName: true },
    });
    if (!doctor) throw new AppException(ErrorCode.NOT_FOUND, 'Doctor not found', 404);

    const [visitAgg] = await this.prisma.db.$queryRaw<VisitAgg[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE v.status::text = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE v.status::text = 'IN_PROGRESS')::int AS "inProgress",
        COUNT(DISTINCT v."patientId")::int AS patients
      FROM "Visit" v
      WHERE v."clinicId" = ${clinicId}
        AND v."branchId" = ${branchId}
        AND v."doctorUserId" = ${doctorUserId}
        AND v.status::text <> 'CANCELLED'
        AND v."startedAt" >= ${start}
        AND v."startedAt" < ${end}
    `);

    const visitLines = await this.prisma.db.$queryRaw<DoctorActivityVisitLine[]>(Prisma.sql`
      SELECT v.id,
        to_char(v."startedAt" AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS date,
        p."fullName" AS "patientName",
        p.mrn AS "patientMrn",
        v.status::text AS status,
        v.kind::text AS kind
      FROM "Visit" v
      JOIN "Patient" p ON p.id = v."patientId" AND p."clinicId" = ${clinicId}
      WHERE v."clinicId" = ${clinicId}
        AND v."branchId" = ${branchId}
        AND v."doctorUserId" = ${doctorUserId}
        AND v.status::text <> 'CANCELLED'
        AND v."startedAt" >= ${start}
        AND v."startedAt" < ${end}
      ORDER BY v."startedAt" DESC
      LIMIT 500
    `);

    // Lab: referred by this doctor. Money from linked invoice lines (service prices).
    const labAgg = await this.labOrUziAgg({
      clinicId,
      branchId,
      doctorUserId,
      start,
      end,
      kind: 'LAB',
    });
    const labLines = await this.labOrUziLines({
      clinicId,
      branchId,
      doctorUserId,
      start,
      end,
      kind: 'LAB',
    });

    const [uziAgg, echoAgg, ultrasoundLines, echoLines] = await Promise.all([
      this.referralUziEchoAgg({ clinicId, branchId, doctorUserId, start, end, echo: false }),
      this.referralUziEchoAgg({ clinicId, branchId, doctorUserId, start, end, echo: true }),
      this.referralUziEchoLines({ clinicId, branchId, doctorUserId, start, end, echo: false }),
      this.referralUziEchoLines({ clinicId, branchId, doctorUserId, start, end, echo: true }),
    ]);
    const [performedUltrasound, performedEcho, performedUltrasoundLines, performedEchoLines] =
      await Promise.all([
        this.performedUziEchoAgg({ clinicId, branchId, doctorUserId, start, end, echo: false }),
        this.performedUziEchoAgg({ clinicId, branchId, doctorUserId, start, end, echo: true }),
        this.performedUziEchoLines({ clinicId, branchId, doctorUserId, start, end, echo: false }),
        this.performedUziEchoLines({ clinicId, branchId, doctorUserId, start, end, echo: true }),
      ]);

    const periods = await this.prisma.db.$queryRaw<PeriodRow[]>(Prisma.sql`
      WITH visit_buckets AS (
        SELECT to_char(date_trunc(${query.groupBy}, v."startedAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS bucket,
          COUNT(*)::int AS visits
        FROM "Visit" v
        WHERE v."clinicId" = ${clinicId}
          AND v."branchId" = ${branchId}
          AND v."doctorUserId" = ${doctorUserId}
          AND v.status::text <> 'CANCELLED'
          AND v."startedAt" >= ${start}
          AND v."startedAt" < ${end}
        GROUP BY 1
      ),
      lab_buckets AS (
        SELECT to_char(date_trunc(${query.groupBy}, o."createdAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS bucket,
          COUNT(DISTINCT o.id)::int AS orders,
          COALESCE(SUM(il."lineTotal"), 0)::text AS amount
        FROM "LabOrder" o
        LEFT JOIN "Invoice" i ON i.id = o."invoiceId" AND i."clinicId" = ${clinicId}
        LEFT JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${clinicId}
        WHERE o."clinicId" = ${clinicId}
          AND o."branchId" = ${branchId}
          AND o."referringDoctorUserId" = ${doctorUserId}
          AND o.status::text <> 'CANCELLED'
          AND (o."invoiceId" IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
          AND o."createdAt" >= ${start}
          AND o."createdAt" < ${end}
        GROUP BY 1
      ),
      uzi_buckets AS (
        SELECT to_char(date_trunc(${query.groupBy}, r."createdAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS bucket,
          COUNT(DISTINCT co.id)::int AS orders,
          COALESCE(SUM(il."lineTotal") FILTER (WHERE NOT ${ECHO_LINE}), 0)::text AS amount,
          COUNT(DISTINCT co.id) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM "InvoiceLine" x
              LEFT JOIN "Service" s ON s.id = x."serviceId" AND s."clinicId" = ${clinicId}
              LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
              WHERE x."invoiceId" = i.id AND x."clinicId" = ${clinicId} AND NOT ${ECHO_LINE}
            )
          )::int AS uzi_orders,
          COUNT(DISTINCT co.id) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM "InvoiceLine" x
              LEFT JOIN "Service" s ON s.id = x."serviceId" AND s."clinicId" = ${clinicId}
              LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
              WHERE x."invoiceId" = i.id AND x."clinicId" = ${clinicId} AND ${ECHO_LINE}
            )
          )::int AS echo_orders,
          COALESCE(SUM(il."lineTotal") FILTER (WHERE ${ECHO_LINE}), 0)::text AS echo_amount
        FROM "Referral" r
        JOIN "Visit" v ON v.id = r."visitId" AND v."clinicId" = ${clinicId}
        JOIN "ClinicalOrder" co ON co.id = r."clinicalOrderId" AND co."clinicId" = ${clinicId}
        LEFT JOIN "Invoice" i ON i.id = co."initialInvoiceId" AND i."clinicId" = ${clinicId}
        LEFT JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${clinicId}
        LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE r."clinicId" = ${clinicId}
          AND v."branchId" = ${branchId}
          AND v."doctorUserId" = ${doctorUserId}
          AND r.type::text = 'ULTRASOUND'
          AND (i.id IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
          AND r."createdAt" >= ${start}
          AND r."createdAt" < ${end}
        GROUP BY 1
      ),
      buckets AS (
        SELECT bucket FROM visit_buckets
        UNION SELECT bucket FROM lab_buckets
        UNION SELECT bucket FROM uzi_buckets
      )
      SELECT b.bucket,
        COALESCE(v.visits, 0)::int AS visits,
        COALESCE(l.orders, 0)::int AS "labOrders",
        COALESCE(l.amount, '0')::text AS "labAmount",
        COALESCE(u.uzi_orders, 0)::int AS "ultrasoundOrders",
        COALESCE(u.amount, '0')::text AS "ultrasoundAmount",
        COALESCE(u.echo_orders, 0)::int AS "echoOrders",
        COALESCE(u.echo_amount, '0')::text AS "echoAmount"
      FROM buckets b
      LEFT JOIN visit_buckets v ON v.bucket = b.bucket
      LEFT JOIN lab_buckets l ON l.bucket = b.bucket
      LEFT JOIN uzi_buckets u ON u.bucket = b.bucket
      ORDER BY b.bucket
    `);

    const compensation = await this.compensationForDoctor({
      clinicId,
      branchId,
      doctorUserId,
      start,
      end,
    });

    return {
      from: query.from,
      to: query.to,
      branchId,
      timezone: TIMEZONE,
      groupBy: query.groupBy,
      doctorUserId: doctor.id,
      doctorName: doctor.fullName,
      visits: {
        total: visitAgg?.total ?? 0,
        completed: visitAgg?.completed ?? 0,
        inProgress: visitAgg?.inProgress ?? 0,
        patients: visitAgg?.patients ?? 0,
      },
      lab: labAgg,
      ultrasound: uziAgg,
      echo: echoAgg,
      performedUltrasound,
      performedEcho,
      visitLines,
      labLines,
      ultrasoundLines,
      echoLines,
      performedUltrasoundLines,
      performedEchoLines,
      compensation,
      periods: periods.map((row) => ({
        bucket: row.bucket,
        visits: row.visits,
        labOrders: row.labOrders,
        labAmount: new Prisma.Decimal(row.labAmount || 0).toFixed(2),
        ultrasoundOrders: row.ultrasoundOrders,
        ultrasoundAmount: new Prisma.Decimal(row.ultrasoundAmount || 0).toFixed(2),
        echoOrders: row.echoOrders,
        echoAmount: new Prisma.Decimal(row.echoAmount || 0).toFixed(2),
      })),
    };
  }

  /** Salary share from CompensationRule on work this doctor performed. */
  private async compensationForDoctor(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
  }): Promise<DoctorActivityReport['compensation']> {
    const empty = {
      percent: null as number | null,
      rules: [] as Array<{ percent: number; label: string }>,
      paidBasis: '0.00',
      earnings: '0.00',
      pendingBasis: '0.00',
      pendingEarnings: '0.00',
    };
    const rules = await this.prisma.db.compensationRule.findMany({
      where: {
        doctorUserId: input.doctorUserId,
        type: 'REVENUE_PERCENT',
        effectiveFrom: { lt: input.end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.start } }],
      },
      include: { service: { select: { name: true, code: true } } },
    });
    if (!rules.length) return empty;

    const categories = await this.prisma.db.serviceCategory.findMany({
      where: {
        id: {
          in: rules.map((rule) => rule.serviceCategoryId).filter((id): id is string => Boolean(id)),
        },
      },
      select: { id: true, name: true },
    });
    const categoryName = new Map(categories.map((row) => [row.id, row.name]));

    const accrualRules: AccrualRule[] = rules.map((rule) => ({
      type: rule.type,
      value: rule.value,
      serviceId: rule.serviceId,
      serviceCategoryId: rule.serviceCategoryId,
    }));

    const lines = await this.prisma.db.invoiceLine.findMany({
      where: {
        performerUserId: input.doctorUserId,
        invoice: {
          branchId: input.branchId,
          issuedAt: { gte: input.start, lt: input.end },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      },
      select: {
        serviceId: true,
        quantity: true,
        lineTotal: true,
        invoice: { select: { status: true, total: true, paidTotal: true } },
        service: { select: { categoryId: true } },
      },
    });

    const toAccrual = (rows: typeof lines): AccrualLine[] =>
      rows.map((line) => ({
        serviceId: line.serviceId,
        serviceCategoryId: line.service?.categoryId ?? null,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      }));

    const paidLines = lines.filter((line) =>
      ['PAID', 'PARTIALLY_PAID'].includes(line.invoice.status),
    );
    const unpaidOnly = lines.filter(
      (line) => line.invoice.status === 'ISSUED' || line.invoice.status === 'DRAFT',
    );

    const paid = calcAccrual(accrualRules, toAccrual(paidLines));
    const pending = calcAccrual(accrualRules, toAccrual(unpaidOnly));

    const paidBasis = paidLines
      .filter((line) =>
        accrualRules.some((rule) => {
          if (rule.serviceId) return line.serviceId === rule.serviceId;
          if (rule.serviceCategoryId) return line.service?.categoryId === rule.serviceCategoryId;
          return true;
        }),
      )
      .reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
    const pendingBasis = unpaidOnly
      .filter((line) =>
        accrualRules.some((rule) => {
          if (rule.serviceId) return line.serviceId === rule.serviceId;
          if (rule.serviceCategoryId) return line.service?.categoryId === rule.serviceCategoryId;
          return true;
        }),
      )
      .reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));

    const ruleLabels = rules.map((rule) => {
      const percent = rule.value.toNumber();
      const label = rule.serviceCategoryId
        ? categoryName.get(rule.serviceCategoryId) ?? 'Kategoriya'
        : rule.service
          ? String(
              typeof rule.service.name === 'object' && rule.service.name && 'uz' in (rule.service.name as object)
                ? (rule.service.name as { uz?: string }).uz
                : rule.service.code,
            )
          : 'Barcha xizmatlar';
      return { percent, label };
    });
    const percents = [...new Set(ruleLabels.map((rule) => rule.percent))];

    return {
      percent: percents.length === 1 ? percents[0]! : null,
      rules: ruleLabels,
      paidBasis: paidBasis.toFixed(2),
      earnings: paid.bonus.toFixed(2),
      pendingBasis: pendingBasis.toFixed(2),
      pendingEarnings: pending.bonus.toFixed(2),
    };
  }

  private async labOrUziAgg(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    kind: 'LAB' | 'ULTRASOUND';
  }): Promise<DoctorActivityMoneyCounts> {
    if (input.kind === 'LAB') {
      const [row] = await this.prisma.db.$queryRaw<MoneyAgg[]>(Prisma.sql`
        WITH orders AS (
          SELECT o.id AS "orderId", o."patientId", o."invoiceId",
            (o."invoiceId" IS NOT NULL AND i.status::text = 'PAID'
              AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total) AS paid
          FROM "LabOrder" o
          LEFT JOIN "Invoice" i ON i.id = o."invoiceId" AND i."clinicId" = ${input.clinicId}
          LEFT JOIN LATERAL (
            SELECT SUM(r.amount) AS refunded FROM "Refund" r
            WHERE r."invoiceId" = i.id AND r."clinicId" = ${input.clinicId}
          ) rf ON true
          WHERE o."clinicId" = ${input.clinicId}
            AND o."branchId" = ${input.branchId}
            AND o."referringDoctorUserId" = ${input.doctorUserId}
            AND o.status::text <> 'CANCELLED'
            AND (o."invoiceId" IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
            AND o."createdAt" >= ${input.start}
            AND o."createdAt" < ${input.end}
        ),
        lines AS (
          SELECT o."orderId", o."patientId", o.paid, il."lineTotal"
          FROM orders o
          LEFT JOIN "InvoiceLine" il ON il."invoiceId" = (
            SELECT "invoiceId" FROM "LabOrder" WHERE id = o."orderId"
          ) AND il."clinicId" = ${input.clinicId}
        )
        SELECT
          COUNT(DISTINCT "patientId")::int AS patients,
          COUNT(DISTINCT "orderId")::int AS orders,
          COUNT(*) FILTER (WHERE "lineTotal" IS NOT NULL)::int AS items,
          COALESCE(SUM("lineTotal"), 0)::text AS amount,
          COALESCE(SUM("lineTotal") FILTER (WHERE paid), 0)::text AS "paidAmount",
          COALESCE(SUM("lineTotal") FILTER (WHERE NOT paid OR paid IS NULL), 0)::text AS "unpaidAmount"
        FROM lines
      `);
      return normalizeMoney(row);
    }
    return money();
  }

  private async labOrUziLines(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    kind: 'LAB' | 'ULTRASOUND';
  }): Promise<DoctorActivityReferralLine[]> {
    if (input.kind !== 'LAB') return [];
    return this.prisma.db.$queryRaw<DoctorActivityReferralLine[]>(Prisma.sql`
      SELECT o.id,
        to_char(o."createdAt" AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS date,
        p."fullName" AS "patientName",
        p.mrn AS "patientMrn",
        COALESCE(string_agg(DISTINCT COALESCE(t.name ->> 'uz', t.code), ', '), o."orderNumber") AS title,
        COALESCE(SUM(il."lineTotal"), 0)::text AS amount,
        BOOL_OR(
          o."invoiceId" IS NOT NULL AND i.status::text = 'PAID'
          AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total
        ) AS paid
      FROM "LabOrder" o
      JOIN "Patient" p ON p.id = o."patientId" AND p."clinicId" = ${input.clinicId}
      LEFT JOIN "LabOrderItem" item ON item."orderId" = o.id AND item."clinicId" = ${input.clinicId}
      LEFT JOIN "LabTest" t ON t.id = item."labTestId" AND t."clinicId" = ${input.clinicId}
      LEFT JOIN "Invoice" i ON i.id = o."invoiceId" AND i."clinicId" = ${input.clinicId}
      LEFT JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${input.clinicId}
      LEFT JOIN LATERAL (
        SELECT SUM(r.amount) AS refunded FROM "Refund" r
        WHERE r."invoiceId" = i.id AND r."clinicId" = ${input.clinicId}
      ) rf ON true
      WHERE o."clinicId" = ${input.clinicId}
        AND o."branchId" = ${input.branchId}
        AND o."referringDoctorUserId" = ${input.doctorUserId}
        AND o.status::text <> 'CANCELLED'
        AND (o."invoiceId" IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
        AND o."createdAt" >= ${input.start}
        AND o."createdAt" < ${input.end}
      GROUP BY o.id, o."createdAt", o."orderNumber", p."fullName", p.mrn, i.status, i."paidTotal", i.total, rf.refunded
      ORDER BY o."createdAt" DESC
      LIMIT 500
    `).then((rows) =>
      rows.map((row) => ({
        ...row,
        amount: new Prisma.Decimal(row.amount || 0).toFixed(2),
        paid: Boolean(row.paid),
      })),
    );
  }

  /** Outbound UZI / EXO referrals this doctor sent from their own visits. */
  private async referralUziEchoAgg(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    echo: boolean;
  }): Promise<DoctorActivityMoneyCounts> {
    const lineFilter = input.echo ? ECHO_LINE : Prisma.sql`NOT ${ECHO_LINE}`;
    const [row] = await this.prisma.db.$queryRaw<MoneyAgg[]>(Prisma.sql`
      WITH lines AS (
        SELECT co.id AS "orderId", co."patientId",
          (i.id IS NOT NULL AND i.status::text = 'PAID'
            AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total) AS paid,
          il."lineTotal"
        FROM "Referral" r
        JOIN "Visit" v ON v.id = r."visitId" AND v."clinicId" = ${input.clinicId}
        JOIN "ClinicalOrder" co ON co.id = r."clinicalOrderId" AND co."clinicId" = ${input.clinicId}
        LEFT JOIN "Invoice" i ON i.id = co."initialInvoiceId" AND i."clinicId" = ${input.clinicId}
        LEFT JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${input.clinicId}
        LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${input.clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${input.clinicId}
        LEFT JOIN LATERAL (
          SELECT SUM(x.amount) AS refunded FROM "Refund" x
          WHERE x."invoiceId" = i.id AND x."clinicId" = ${input.clinicId}
        ) rf ON true
        WHERE r."clinicId" = ${input.clinicId}
          AND v."branchId" = ${input.branchId}
          AND v."doctorUserId" = ${input.doctorUserId}
          AND r.type::text = 'ULTRASOUND'
          AND (i.id IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
          AND r."createdAt" >= ${input.start}
          AND r."createdAt" < ${input.end}
          AND il.id IS NOT NULL
          AND ${lineFilter}
      )
      SELECT
        COUNT(DISTINCT "patientId")::int AS patients,
        COUNT(DISTINCT "orderId")::int AS orders,
        COUNT(*)::int AS items,
        COALESCE(SUM("lineTotal"), 0)::text AS amount,
        COALESCE(SUM("lineTotal") FILTER (WHERE paid), 0)::text AS "paidAmount",
        COALESCE(SUM("lineTotal") FILTER (WHERE NOT paid OR paid IS NULL), 0)::text AS "unpaidAmount"
      FROM lines
    `);
    return normalizeMoney(row);
  }

  private async referralUziEchoLines(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    echo: boolean;
  }): Promise<DoctorActivityReferralLine[]> {
    const lineFilter = input.echo ? ECHO_LINE : Prisma.sql`NOT ${ECHO_LINE}`;
    const fallback = input.echo ? 'EXO' : 'UZI';
    return this.prisma.db.$queryRaw<DoctorActivityReferralLine[]>(Prisma.sql`
      SELECT co.id,
        to_char(r."createdAt" AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS date,
        p."fullName" AS "patientName",
        p.mrn AS "patientMrn",
        COALESCE(
          string_agg(DISTINCT COALESCE(il.title ->> 'uz', il.title ->> 'ru', ${fallback}), ', '),
          ${fallback}
        ) AS title,
        COALESCE(SUM(il."lineTotal"), 0)::text AS amount,
        BOOL_OR(
          i.id IS NOT NULL AND i.status::text = 'PAID'
          AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total
        ) AS paid
      FROM "Referral" r
      JOIN "Visit" v ON v.id = r."visitId" AND v."clinicId" = ${input.clinicId}
      JOIN "ClinicalOrder" co ON co.id = r."clinicalOrderId" AND co."clinicId" = ${input.clinicId}
      JOIN "Patient" p ON p.id = co."patientId" AND p."clinicId" = ${input.clinicId}
      LEFT JOIN "Invoice" i ON i.id = co."initialInvoiceId" AND i."clinicId" = ${input.clinicId}
      LEFT JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${input.clinicId}
      LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${input.clinicId}
      LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${input.clinicId}
      LEFT JOIN LATERAL (
        SELECT SUM(x.amount) AS refunded FROM "Refund" x
        WHERE x."invoiceId" = i.id AND x."clinicId" = ${input.clinicId}
      ) rf ON true
      WHERE r."clinicId" = ${input.clinicId}
        AND v."branchId" = ${input.branchId}
        AND v."doctorUserId" = ${input.doctorUserId}
        AND r.type::text = 'ULTRASOUND'
        AND (i.id IS NULL OR i.status::text NOT IN ('CANCELLED', 'REFUNDED'))
        AND r."createdAt" >= ${input.start}
        AND r."createdAt" < ${input.end}
        AND il.id IS NOT NULL
        AND ${lineFilter}
      GROUP BY co.id, r."createdAt", p."fullName", p.mrn, i.status, i."paidTotal", i.total, rf.refunded
      ORDER BY r."createdAt" DESC
      LIMIT 500
    `).then((rows) =>
      rows.map((row) => ({
        ...row,
        amount: new Prisma.Decimal(row.amount || 0).toFixed(2),
        paid: Boolean(row.paid),
      })),
    );
  }

  /** Exams this doctor performed (Mohira UZI / Sherzod EXO desks). */
  private async performedUziEchoAgg(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    echo: boolean;
  }): Promise<DoctorActivityMoneyCounts> {
    const lineFilter = input.echo ? ECHO_LINE : Prisma.sql`NOT ${ECHO_LINE}`;
    const [row] = await this.prisma.db.$queryRaw<MoneyAgg[]>(Prisma.sql`
      WITH lines AS (
        SELECT o.id AS "orderId", o."patientId",
          (i.id IS NOT NULL AND i.status::text = 'PAID'
            AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total) AS paid,
          il."lineTotal"
        FROM "ClinicalOrder" o
        JOIN "Invoice" i ON (i.id = o."initialInvoiceId" OR i."clinicalOrderId" = o.id)
          AND i."clinicId" = ${input.clinicId}
        JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${input.clinicId}
        LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${input.clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${input.clinicId}
        LEFT JOIN LATERAL (
          SELECT SUM(x.amount) AS refunded FROM "Refund" x
          WHERE x."invoiceId" = i.id AND x."clinicId" = ${input.clinicId}
        ) rf ON true
        WHERE o."clinicId" = ${input.clinicId}
          AND o."branchId" = ${input.branchId}
          AND o."doctorUserId" = ${input.doctorUserId}
          AND o.kind = 'ULTRASOUND'
          AND i.status::text NOT IN ('CANCELLED', 'REFUNDED')
          AND o."createdAt" >= ${input.start}
          AND o."createdAt" < ${input.end}
          AND ${lineFilter}
      )
      SELECT
        COUNT(DISTINCT "patientId")::int AS patients,
        COUNT(DISTINCT "orderId")::int AS orders,
        COUNT(*)::int AS items,
        COALESCE(SUM("lineTotal"), 0)::text AS amount,
        COALESCE(SUM("lineTotal") FILTER (WHERE paid), 0)::text AS "paidAmount",
        COALESCE(SUM("lineTotal") FILTER (WHERE NOT paid OR paid IS NULL), 0)::text AS "unpaidAmount"
      FROM lines
    `);
    return normalizeMoney(row);
  }

  private async performedUziEchoLines(input: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    start: Date;
    end: Date;
    echo: boolean;
  }): Promise<DoctorActivityReferralLine[]> {
    const lineFilter = input.echo ? ECHO_LINE : Prisma.sql`NOT ${ECHO_LINE}`;
    const fallback = input.echo ? 'EXO' : 'UZI';
    return this.prisma.db.$queryRaw<DoctorActivityReferralLine[]>(Prisma.sql`
      SELECT o.id,
        to_char(o."createdAt" AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS date,
        p."fullName" AS "patientName",
        p.mrn AS "patientMrn",
        COALESCE(
          string_agg(DISTINCT COALESCE(il.title ->> 'uz', il.title ->> 'ru', ${fallback}), ', '),
          ${fallback}
        ) AS title,
        COALESCE(SUM(il."lineTotal"), 0)::text AS amount,
        BOOL_OR(
          i.status::text = 'PAID'
          AND i."paidTotal" - COALESCE(rf.refunded, 0) >= i.total
        ) AS paid
      FROM "ClinicalOrder" o
      JOIN "Patient" p ON p.id = o."patientId" AND p."clinicId" = ${input.clinicId}
      JOIN "Invoice" i ON (i.id = o."initialInvoiceId" OR i."clinicalOrderId" = o.id)
        AND i."clinicId" = ${input.clinicId}
      JOIN "InvoiceLine" il ON il."invoiceId" = i.id AND il."clinicId" = ${input.clinicId}
      LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${input.clinicId}
      LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${input.clinicId}
      LEFT JOIN LATERAL (
        SELECT SUM(x.amount) AS refunded FROM "Refund" x
        WHERE x."invoiceId" = i.id AND x."clinicId" = ${input.clinicId}
      ) rf ON true
      WHERE o."clinicId" = ${input.clinicId}
        AND o."branchId" = ${input.branchId}
        AND o."doctorUserId" = ${input.doctorUserId}
        AND o.kind = 'ULTRASOUND'
        AND i.status::text NOT IN ('CANCELLED', 'REFUNDED')
        AND o."createdAt" >= ${input.start}
        AND o."createdAt" < ${input.end}
        AND ${lineFilter}
      GROUP BY o.id, o."createdAt", p."fullName", p.mrn, i.status, i."paidTotal", i.total, rf.refunded
      ORDER BY o."createdAt" DESC
      LIMIT 500
    `).then((rows) =>
      rows.map((row) => ({
        ...row,
        amount: new Prisma.Decimal(row.amount || 0).toFixed(2),
        paid: Boolean(row.paid),
      })),
    );
  }
}

function normalizeMoney(row?: MoneyAgg): DoctorActivityMoneyCounts {
  if (!row) return money();
  return {
    patients: row.patients ?? 0,
    orders: row.orders ?? 0,
    items: row.items ?? 0,
    amount: new Prisma.Decimal(row.amount || 0).toFixed(2),
    paidAmount: new Prisma.Decimal(row.paidAmount || 0).toFixed(2),
    unpaidAmount: new Prisma.Decimal(row.unpaidAmount || 0).toFixed(2),
  };
}
