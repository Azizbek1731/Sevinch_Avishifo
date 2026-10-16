import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type LabReferralCounts,
  type LabReferralReport,
  type LabReferralReportQueryInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { cashflowRangeUtc } from './cashflow.service';
import { XlsxService, type SheetSpec } from './xlsx.service';

interface ReferralRow extends LabReferralCounts {
  dimension: 'total' | 'doctor' | 'test' | 'period';
  doctorUserId: string | null;
  doctorName: string | null;
  labTestId: string | null;
  code: string | null;
  name: Record<string, string> | null;
  bucket: string | null;
}
const counts = (row?: LabReferralCounts): LabReferralCounts => ({
  patients: row?.patients ?? 0,
  orders: row?.orders ?? 0,
  tests: row?.tests ?? 0,
  paidOrders: row?.paidOrders ?? 0,
  pendingPaymentOrders: row?.pendingPaymentOrders ?? 0,
  approvedOrders: row?.approvedOrders ?? 0,
});

@Injectable()
export class LabReferralReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly xlsx: XlsxService,
  ) {}

  async report(
    query: LabReferralReportQueryInput,
    user: AuthUser,
    activeBranchId: string,
  ): Promise<LabReferralReport> {
    if (
      !user.permissions.includes('lab.orders.read') &&
      !user.permissions.includes('reports.read')
    ) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Missing laboratory or report read permission',
        403,
      );
    }
    const branchId = query.branchId ?? activeBranchId;
    if (user.branchIds.length && !user.branchIds.includes(branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    if (user.role === 'DOCTOR' && query.doctorUserId && query.doctorUserId !== user.id)
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Doctors can view their own referral report',
        403,
      );
    const doctorUserId = user.role === 'DOCTOR' ? user.id : (query.doctorUserId ?? null);
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = cashflowRangeUtc(query.from, query.to);
    const doctorFilter = doctorUserId
      ? Prisma.sql`AND o."referringDoctorUserId" = ${doctorUserId}`
      : Prisma.empty;
    // Raw SQL bypasses tenant extension; every source and join is explicitly scoped.
    // Distinct patients/orders are calculated at each scope, never added per test.
    const rows = await this.prisma.db.$queryRaw<ReferralRow[]>(Prisma.sql`
      WITH orders AS (
        SELECT o.id AS "orderId", o."patientId", o."referringDoctorUserId" AS "doctorUserId",
          COALESCE(u."fullName", o."referringDoctorName") AS "doctorName",
          to_char(date_trunc(${query.groupBy}, o."createdAt" AT TIME ZONE ${TIMEZONE}), 'YYYY-MM-DD') AS bucket,
          (o.status::text IN ('APPROVED', 'DELIVERED')) AS approved,
          (o."invoiceId" IS NULL OR (i.status::text = 'PAID' AND i."paidTotal" - COALESCE(r.refunded, 0) >= i.total)) AS paid
        FROM "LabOrder" o
        LEFT JOIN "Invoice" i ON i.id = o."invoiceId" AND i."clinicId" = ${clinicId} AND i."branchId" = ${branchId}
        LEFT JOIN LATERAL (
          SELECT SUM(r.amount) AS refunded FROM "Refund" r WHERE r."invoiceId" = i.id AND r."clinicId" = ${clinicId}
        ) r ON true
        LEFT JOIN "User" u ON u.id = o."referringDoctorUserId" AND u."clinicId" = ${clinicId}
        WHERE o."clinicId" = ${clinicId} AND o."branchId" = ${branchId}
          AND o.status::text <> 'CANCELLED'
          AND (o."invoiceId" IS NULL OR (i.id IS NOT NULL AND i.status::text <> 'CANCELLED'))
          AND o."createdAt" >= ${start} AND o."createdAt" < ${end} ${doctorFilter}
      ), tests AS (
        SELECT o.*, item.id AS "itemId", t.id AS "labTestId", t.code, t.name
        FROM orders o
        JOIN "LabOrderItem" item ON item."orderId" = o."orderId" AND item."clinicId" = ${clinicId}
        JOIN "LabTest" t ON t.id = item."labTestId" AND t."clinicId" = ${clinicId}
      )
      SELECT CASE WHEN GROUPING(bucket) = 0 THEN 'period'
             WHEN GROUPING("labTestId") = 0 THEN 'test'
             WHEN GROUPING("doctorUserId") = 0 THEN 'doctor' ELSE 'total' END AS dimension,
        "doctorUserId", MAX("doctorName") AS "doctorName", "labTestId", MAX(code) AS code,
        MAX(name::text)::jsonb AS name, bucket,
        COUNT(DISTINCT "patientId")::int AS patients,
        COUNT(DISTINCT "orderId")::int AS orders,
        COUNT("itemId")::int AS tests,
        COUNT(DISTINCT "orderId") FILTER (WHERE paid)::int AS "paidOrders",
        COUNT(DISTINCT "orderId") FILTER (WHERE NOT paid)::int AS "pendingPaymentOrders",
        COUNT(DISTINCT "orderId") FILTER (WHERE approved)::int AS "approvedOrders"
      FROM tests
      GROUP BY GROUPING SETS ((), ("doctorUserId"), ("doctorUserId", "labTestId"), (bucket))
    `);
    return {
      from: query.from,
      to: query.to,
      branchId,
      timezone: TIMEZONE,
      groupBy: query.groupBy,
      doctorUserId,
      totals: counts(rows.find((row) => row.dimension === 'total')),
      doctors: rows
        .filter((row) => row.dimension === 'doctor')
        .map((row) => ({
          ...counts(row),
          doctorUserId: row.doctorUserId,
          doctorName: row.doctorName,
          testsBreakdown: rows
            .filter((test) => test.dimension === 'test' && test.doctorUserId === row.doctorUserId)
            .map((test) => ({
              ...counts(test),
              labTestId: test.labTestId!,
              code: test.code!,
              name: test.name!,
            }))
            .sort((a, b) => a.code.localeCompare(b.code)),
        }))
        .sort(
          (a, b) =>
            b.patients - a.patients || (a.doctorName ?? '').localeCompare(b.doctorName ?? ''),
        ),
      periods: rows
        .filter((row) => row.dimension === 'period')
        .map((row) => ({ ...counts(row), bucket: row.bucket! }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    };
  }

  sheets(report: LabReferralReport): SheetSpec[] {
    const columns = [
      { header: 'Bemorlar', key: 'patients' },
      { header: 'Yo‘llanmalar', key: 'orders' },
      { header: 'Tahlillar', key: 'tests' },
      { header: 'To‘langan yo‘llanmalar', key: 'paidOrders', width: 24 },
      { header: 'To‘lov kutilmoqda', key: 'pendingPaymentOrders', width: 22 },
      { header: 'Tasdiqlangan natijalar', key: 'approvedOrders', width: 25 },
    ];
    const direct = 'Qabulxona / to‘g‘ridan-to‘g‘ri';
    return [
      {
        name: 'Davr va hisoblash',
        columns: [
          { header: 'Parametr', key: 'key', width: 28 },
          { header: 'Qiymat', key: 'value', width: 110 },
        ],
        rows: [
          { key: 'Boshlanish', value: report.from },
          { key: 'Tugash (shu kun ham)', value: report.to },
          { key: 'Filial ID', value: report.branchId },
          { key: 'Vaqt mintaqasi', value: report.timezone },
          { key: 'Shifokor ID', value: report.doctorUserId ?? 'Barcha shifokorlar va qabulxona' },
          {
            key: 'Hisoblash',
            value:
              'Bemorlar har bir shifokor va umumiy kesimda takrorlanmasdan sanaladi. Har bir buyurtma va undagi alohida tahlil bir marta sanaladi.',
          },
          {
            key: 'Sana va bekor qilish',
            value:
              'Yo‘llanma yaratilgan mahalliy sana. Bekor qilingan buyurtma yoki hisoblar kiritilmaydi; to‘lov kutilayotgan yo‘llanmalar alohida ko‘rsatiladi.',
          },
          {
            key: 'Shifokor',
            value:
              'Yo‘llanmani yaratgan autentifikatsiyadan o‘tgan shifokor. Shifokorsiz buyurtmalar qabulxona/to‘g‘ridan-to‘g‘ri bo‘limida.',
          },
        ],
      },
      { name: 'Jami', columns, rows: [{ ...report.totals }] },
      {
        name: 'Shifokorlar',
        columns: [{ header: 'Shifokor', key: 'doctorName', width: 35 }, ...columns],
        rows: report.doctors.map((doctor) => ({
          ...doctor,
          doctorName: doctor.doctorName ?? direct,
        })),
      },
      {
        name: 'Tahlillar',
        columns: [
          { header: 'Shifokor', key: 'doctorName', width: 35 },
          { header: 'Kod', key: 'code' },
          { header: 'Tahlil', key: 'name', width: 45 },
          ...columns,
        ],
        rows: report.doctors.flatMap((doctor) =>
          doctor.testsBreakdown.map((test) => ({
            ...test,
            name: test.name.uz ?? test.name.ru ?? test.code,
            doctorName: doctor.doctorName ?? direct,
          })),
        ),
      },
      {
        name: 'Davrlar',
        columns: [{ header: 'Davr boshlanishi', key: 'bucket', width: 22 }, ...columns],
        rows: report.periods.map((row) => ({ ...row })),
      },
    ];
  }

  async export(report: LabReferralReport, user: AuthUser): Promise<Buffer> {
    if (!user.permissions.includes('reports.export'))
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.export', 403);
    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: 'lab-referrals',
      after: {
        from: report.from,
        to: report.to,
        branchId: report.branchId,
        doctorUserId: report.doctorUserId,
      },
    });
    return this.xlsx.buildWorkbook(this.sheets(report));
  }
}
