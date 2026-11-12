import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AmbulatoryCase } from '@prisma/client';
import {
  AMBULATORY_DEFAULT_LAB_PERCENT,
  AuditAction,
  ErrorCode,
  type AmbulatoryCaseQueryInput,
  type AmbulatoryCommissionDoctor,
  type AmbulatoryCommissionOrder,
  type AmbulatoryCommissionQueryInput,
  type AmbulatoryCommissionReport,
  type AmbulatoryCommissionTotals,
  type AmbulatoryLabOrderInput,
  type AmbulatoryPaymentState,
  type AmbulatoryRates,
  type AmbulatoryRatesInput,
  type AmbulatoryUziOrderInput,
  type AuthUser,
  type OpenAmbulatoryCaseInput,
  type UpdateAmbulatoryCaseInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { AuditService } from '../../core/audit/audit.service';
import { LabService } from '../lab/lab.service';
import { ClinicalOrdersService } from '../clinical-orders/clinical-orders.service';
import {
  AMBULATORY_PERCENT_SETTING,
  linkLabOrderToCase,
  nextAmbulatoryNumber,
  openVisitForCase,
} from './ambulatory-case';
import { cashflowRangeUtc } from '../reports/cashflow.service';
import { XlsxService, type SheetSpec } from '../reports/xlsx.service';

const SETTINGS_KEY = AMBULATORY_PERCENT_SETTING;
const zero = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

/** Tashkent calendar day bounds (+05:00), inclusive. */
function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000+05:00`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000+05:00`).getTime() + 86_400_000) } : {}),
  };
}

interface LabRow {
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  orderStatus: string;
  caseId: string;
  caseNumber: string;
  doctorUserId: string;
  doctorName: string;
  patientId: string;
  mrn: string;
  fullName: string;
  percent: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceTotal: string | null;
  paidTotal: string | null;
  refunded: string;
  linesTotal: string;
  labLinesTotal: string;
  tests: Array<Record<string, string> | string>;
}

export interface LabShare {
  row: LabRow;
  cancelled: boolean;
  labAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  percent: Prisma.Decimal;
  commission: Prisma.Decimal;
  pendingCommission: Prisma.Decimal;
  paymentState: AmbulatoryPaymentState;
}

/**
 * The doctor's share is computed from the lab part of the bill only, net of
 * invoice discounts and refunds, and only for what the cashier actually took.
 */
export function labShare(row: LabRow, fallbackPercent: number): LabShare {
  const percent = new Prisma.Decimal(row.percent ?? fallbackPercent);
  const cancelled =
    row.orderStatus === 'CANCELLED' ||
    !row.invoiceId ||
    row.invoiceStatus === 'CANCELLED' ||
    row.invoiceStatus === 'REFUNDED';
  const total = new Prisma.Decimal(row.invoiceTotal ?? 0);
  const linesTotal = new Prisma.Decimal(row.linesTotal);
  const labLines = new Prisma.Decimal(row.labLinesTotal);
  const netPaid = Prisma.Decimal.min(
    total,
    Prisma.Decimal.max(0, new Prisma.Decimal(row.paidTotal ?? 0).sub(row.refunded)),
  );
  if (cancelled) {
    return {
      row,
      cancelled,
      labAmount: zero,
      paidAmount: zero,
      percent,
      commission: zero,
      pendingCommission: zero,
      paymentState: 'UNPAID',
    };
  }
  const labAmount = linesTotal.gt(0) ? labLines.mul(total).div(linesTotal) : zero;
  const paidAmount = total.gt(0) ? labAmount.mul(netPaid).div(total) : zero;
  const commission = paidAmount.mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const expected = labAmount.mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    row,
    cancelled,
    labAmount,
    paidAmount,
    percent,
    commission,
    pendingCommission: Prisma.Decimal.max(0, expected.sub(commission)),
    paymentState: netPaid.gte(total) ? 'PAID' : netPaid.gt(0) ? 'PARTIAL' : 'UNPAID',
  };
}

function totalsOf(shares: LabShare[]): AmbulatoryCommissionTotals {
  const sum = (pick: (share: LabShare) => Prisma.Decimal) =>
    money(shares.reduce((acc, share) => acc.add(pick(share)), zero));
  return {
    patients: new Set(shares.map((share) => share.row.patientId)).size,
    orders: shares.length,
    labAmount: sum((share) => share.labAmount),
    paidAmount: sum((share) => share.paidAmount),
    commission: sum((share) => share.commission),
    pendingCommission: sum((share) => share.pendingCommission),
  };
}

function orderOf(share: LabShare): AmbulatoryCommissionOrder {
  const { row } = share;
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    caseId: row.caseId,
    caseNumber: row.caseNumber,
    patient: { id: row.patientId, mrn: row.mrn, fullName: row.fullName },
    doctorUserId: row.doctorUserId,
    doctorName: row.doctorName,
    tests: row.tests ?? [],
    invoiceNumber: row.invoiceNumber,
    labAmount: money(share.labAmount),
    paidAmount: money(share.paidAmount),
    percent: share.percent.toNumber(),
    commission: money(share.commission),
    pendingCommission: money(share.pendingCommission),
    paymentState: share.paymentState,
  };
}

const testName = (name: Record<string, string> | string) =>
  typeof name === 'string' ? name : (name.uz ?? name.ru ?? name.en ?? '');

@Injectable()
export class AmbulatoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lab: LabService,
    private readonly clinicalOrders: ClinicalOrdersService,
    private readonly xlsx: XlsxService,
  ) {}

  // ------------------------------------------------------------ helpers

  private assertBranch(user: AuthUser, branchId: string): void {
    if (user.branchIds.length && !user.branchIds.includes(branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
  }

  private isDoctor(user: AuthUser): boolean {
    return user.role === 'DOCTOR';
  }

  private map(c: AmbulatoryCase): Record<string, unknown> {
    return {
      id: c.id,
      branchId: c.branchId,
      patientId: c.patientId,
      number: c.number,
      status: c.status,
      doctorUserId: c.doctorUserId,
      doctorName: c.doctorName,
      complaint: c.complaint,
      diagnosis: c.diagnosis,
      note: c.note,
      openedAt: c.openedAt.toISOString(),
      closedAt: c.closedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** User is not tenant-scoped: require own clinic, active doctor and branch membership. */
  private async requireDoctor(
    doctorUserId: string,
    branchId: string,
  ): Promise<{ id: string; fullName: string; specialty: string | null }> {
    const doctor = await this.prisma.unscoped.user.findFirst({
      where: {
        id: doctorUserId,
        clinicId: TenantContext.requireClinicId(),
        role: 'DOCTOR',
        status: 'ACTIVE',
        deletedAt: null,
        branches: { some: { branchId } },
      },
      select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
    });
    if (!doctor)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Shu filialdagi faol shifokorni tanlang',
        400,
      );
    return {
      id: doctor.id,
      fullName: doctor.fullName,
      specialty: doctor.staffProfile?.specialty ?? null,
    };
  }

  private async requireCase(id: string, user: AuthUser, branchId: string): Promise<AmbulatoryCase> {
    this.assertBranch(user, branchId);
    const found = await this.prisma.db.ambulatoryCase.findFirst({ where: { id, branchId } });
    if (!found || (this.isDoctor(user) && found.doctorUserId !== user.id))
      throw new AppException(ErrorCode.NOT_FOUND, 'Ambulator karta topilmadi', 404);
    return found;
  }

  private async lockCase(tx: TenantTransactionClient, id: string): Promise<AmbulatoryCase> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "AmbulatoryCase" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const locked = await tx.ambulatoryCase.findFirst({ where: { id } });
    if (!locked) throw new AppException(ErrorCode.NOT_FOUND, 'Ambulator karta topilmadi', 404);
    return locked;
  }

  async defaultPercent(): Promise<number> {
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { settings: true },
    });
    const value = ((clinic?.settings ?? {}) as Record<string, unknown>)[SETTINGS_KEY];
    return typeof value === 'number' && value >= 0 && value <= 100
      ? value
      : AMBULATORY_DEFAULT_LAB_PERCENT;
  }

  private async percentFor(doctorUserId: string): Promise<number> {
    const override = await this.prisma.db.ambulatoryCommissionRate.findFirst({
      where: { doctorUserId },
      select: { percent: true },
    });
    return override ? override.percent.toNumber() : this.defaultPercent();
  }

  private async labRows(branchId: string, filter: Prisma.Sql): Promise<LabRow[]> {
    const clinicId = TenantContext.requireClinicId();
    // Raw SQL bypasses the tenant extension; every source and join is scoped explicitly.
    return this.prisma.db.$queryRaw<LabRow[]>(Prisma.sql`
      SELECT o.id AS "orderId", o."orderNumber", o."createdAt", o.status::text AS "orderStatus",
        c.id AS "caseId", c.number AS "caseNumber", c."doctorUserId", c."doctorName",
        p.id AS "patientId", p.mrn, p."fullName",
        o."ambulatoryCommissionPercent"::text AS percent,
        i.id AS "invoiceId", i.number AS "invoiceNumber", i.status::text AS "invoiceStatus",
        i.total::text AS "invoiceTotal", i."paidTotal"::text AS "paidTotal",
        COALESCE(r.refunded, 0)::text AS refunded,
        COALESCE(l.all_total, 0)::text AS "linesTotal",
        COALESCE(l.lab_total, 0)::text AS "labLinesTotal",
        COALESCE(t.names, '[]'::jsonb) AS tests
      FROM "LabOrder" o
      JOIN "AmbulatoryCase" c ON c.id = o."ambulatoryCaseId" AND c."clinicId" = ${clinicId}
      JOIN "Patient" p ON p.id = o."patientId" AND p."clinicId" = ${clinicId}
      LEFT JOIN "Invoice" i ON i.id = o."invoiceId" AND i."clinicId" = ${clinicId}
      LEFT JOIN LATERAL (
        SELECT SUM(rf.amount) AS refunded FROM "Refund" rf
        WHERE rf."invoiceId" = i.id AND rf."clinicId" = ${clinicId}
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT SUM(il."lineTotal") AS all_total,
          SUM(il."lineTotal") FILTER (WHERE sc.kind::text = 'LAB') AS lab_total
        FROM "InvoiceLine" il
        LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE il."invoiceId" = i.id AND il."clinicId" = ${clinicId}
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(lt.name ORDER BY lt.code) AS names
        FROM "LabOrderItem" it
        JOIN "LabTest" lt ON lt.id = it."labTestId" AND lt."clinicId" = ${clinicId}
        WHERE it."orderId" = o.id AND it."clinicId" = ${clinicId}
      ) t ON true
      WHERE o."clinicId" = ${clinicId} AND o."branchId" = ${branchId} ${filter}
      ORDER BY o."createdAt" DESC
    `);
  }

  // ------------------------------------------------------------ cards

  async list(
    q: AmbulatoryCaseQueryInput,
    user: AuthUser,
    branchId: string,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    this.assertBranch(user, branchId);
    const search = q.search?.trim();
    const opened = dayRange(q.from, q.to);
    const where: Prisma.AmbulatoryCaseWhereInput = {
      branchId,
      ...(this.isDoctor(user)
        ? { doctorUserId: user.id }
        : q.doctorUserId
          ? { doctorUserId: q.doctorUserId }
          : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(opened.gte || opened.lt ? { openedAt: opened } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { doctorName: { contains: search, mode: 'insensitive' } },
              { patient: { fullName: { contains: search, mode: 'insensitive' } } },
              { patient: { mrn: { contains: search, mode: 'insensitive' } } },
              { patient: { phone: { contains: search.replace(/\D/g, '') || search } } },
            ],
          }
        : {}),
    };
    const [rows, total, fallback] = await Promise.all([
      this.prisma.db.ambulatoryCase.findMany({
        where,
        orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
        ...skipTake(q),
        include: {
          patient: { select: { id: true, mrn: true, fullName: true, phone: true, dob: true, gender: true } },
          _count: {
            select: {
              labOrders: true,
              clinicalOrders: { where: { kind: 'ULTRASOUND' } },
            },
          },
        },
      }),
      this.prisma.db.ambulatoryCase.count({ where }),
      this.defaultPercent(),
    ]);
    const ids = rows.map((row) => row.id);
    const shares = ids.length
      ? (await this.labRows(branchId, Prisma.sql`AND c.id IN (${Prisma.join(ids)})`)).map((row) =>
          labShare(row, fallback),
        )
      : [];
    return paginated(
      rows.map((row) => {
        const own = shares.filter((share) => share.row.caseId === row.id && !share.cancelled);
        const totals = totalsOf(own);
        return {
          ...this.map(row),
          patient: row.patient,
          labOrders: row._count.labOrders,
          uziOrders: row._count.clinicalOrders,
          labAmount: totals.labAmount,
          paidAmount: totals.paidAmount,
          commission: totals.commission,
          pendingCommission: totals.pendingCommission,
        };
      }),
      { page: q.page, limit: q.limit, total },
    );
  }

  async open(
    dto: OpenAmbulatoryCaseInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    this.assertBranch(user, branchId);
    const doctorUserId = this.isDoctor(user) ? user.id : dto.doctorUserId;
    if (!doctorUserId)
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Shifokorni tanlang', 400);
    const doctor = await this.requireDoctor(doctorUserId, branchId);
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Bemor topilmadi', 404);
    const clinicId = TenantContext.requireClinicId();
    const created = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${dto.patientId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const existing = await tx.ambulatoryCase.findFirst({
        where: { patientId: dto.patientId, branchId, doctorUserId, status: 'OPEN' },
        select: { id: true, number: true },
      });
      if (existing)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          `Bemorda bu shifokor bilan ochiq ambulator karta bor (${existing.number})`,
          409,
          [{ caseId: existing.id }],
        );
      return tx.ambulatoryCase.create({
        data: {
          clinicId,
          branchId,
          patientId: dto.patientId,
          number: await nextAmbulatoryNumber(tx, clinicId),
          doctorUserId: doctor.id,
          doctorName: doctor.fullName,
          complaint: dto.complaint ?? null,
          diagnosis: dto.diagnosis ?? null,
          note: dto.note ?? null,
          openedAt: new Date(),
          openedById: user.id,
        },
      });
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'AmbulatoryCase',
      entityId: created.id,
      after: { number: created.number, patientId: created.patientId, doctorUserId: doctor.id },
    });
    return this.map(created);
  }

  async update(
    id: string,
    dto: UpdateAmbulatoryCaseInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const before = await this.requireCase(id, user, branchId);
    const nextDoctor =
      dto.doctorUserId && dto.doctorUserId !== before.doctorUserId && !this.isDoctor(user)
        ? await this.requireDoctor(dto.doctorUserId, branchId)
        : null;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      if (nextDoctor) {
        const [lab, consultations] = await Promise.all([
          tx.labOrder.count({ where: { ambulatoryCaseId: id } }),
          tx.clinicalOrder.count({ where: { ambulatoryCaseId: id, kind: 'CONSULTATION' } }),
        ]);
        if (lab + consultations > 0)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Kartada shifokor qabuli yoki laboratoriya bor — shifokorni almashtirib bo‘lmaydi. Yangi karta oching.',
            409,
          );
        const clash = await tx.ambulatoryCase.findFirst({
          where: {
            id: { not: id },
            patientId: before.patientId,
            branchId,
            doctorUserId: nextDoctor.id,
            status: 'OPEN',
          },
          select: { number: true },
        });
        if (clash && before.status === 'OPEN')
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            `Bemorda bu shifokor bilan ochiq karta bor (${clash.number})`,
            409,
          );
      }
      return tx.ambulatoryCase.update({
        where: { id },
        data: {
          ...(nextDoctor ? { doctorUserId: nextDoctor.id, doctorName: nextDoctor.fullName } : {}),
          ...(dto.complaint !== undefined ? { complaint: dto.complaint } : {}),
          ...(dto.diagnosis !== undefined ? { diagnosis: dto.diagnosis } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'AmbulatoryCase',
      entityId: id,
      before: this.map(before),
      after: this.map(updated),
    });
    return this.getById(id, user, branchId);
  }

  async setStatus(
    id: string,
    status: 'OPEN' | 'CLOSED',
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const before = await this.requireCase(id, user, branchId);
    if (before.status === status) return this.getById(id, user, branchId);
    try {
      await this.prisma.db.ambulatoryCase.update({
        where: { id },
        data:
          status === 'CLOSED'
            ? { status, closedAt: new Date(), closedById: user.id }
            : { status, closedAt: null, closedById: null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Bemorda bu shifokor bilan boshqa ochiq karta bor',
          409,
        );
      throw error;
    }
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'AmbulatoryCase',
      entityId: id,
      before: { status: before.status },
      after: { status },
    });
    return this.getById(id, user, branchId);
  }

  /** A card opened by mistake can go while nothing was sent from it. */
  async remove(id: string, user: AuthUser, branchId: string): Promise<{ id: string }> {
    const found = await this.requireCase(id, user, branchId);
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const [lab, uzi] = await Promise.all([
        tx.labOrder.count({ where: { ambulatoryCaseId: id } }),
        tx.clinicalOrder.count({ where: { ambulatoryCaseId: id } }),
      ]);
      if (lab + uzi > 0)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Kartadan yo‘llanma yuborilgan — o‘chirib bo‘lmaydi, yakunlang.',
          409,
        );
      await tx.ambulatoryCase.delete({ where: { id } });
    });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'AmbulatoryCase',
      entityId: id,
      before: this.map(found),
    });
    return { id };
  }

  async getById(id: string, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const found = await this.requireCase(id, user, branchId);
    const [patient, fallback, clinicalOrders, labOrders, stay] = await Promise.all([
      this.prisma.db.patient.findFirst({
        where: { id: found.patientId },
        select: {
          id: true,
          mrn: true,
          fullName: true,
          phone: true,
          dob: true,
          gender: true,
          address: true,
        },
      }),
      this.defaultPercent(),
      this.clinicalOrders.listForAmbulatoryCase(id, branchId),
      this.prisma.db.labOrder.findMany({
        where: { ambulatoryCaseId: id },
        select: { id: true, status: true },
      }),
      this.prisma.db.admission.findFirst({
        where: { patientId: found.patientId, branchId, status: 'ACTIVE' },
        select: { id: true, historyNumber: true },
      }),
    ]);
    const statusById = new Map(labOrders.map((order) => [order.id, order.status]));
    const shares = (await this.labRows(branchId, Prisma.sql`AND c.id = ${id}`)).map((row) =>
      labShare(row, fallback),
    );
    return {
      ...this.map(found),
      patient,
      currentPercent: await this.percentFor(found.doctorUserId),
      activeStay: stay,
      totals: totalsOf(shares.filter((share) => !share.cancelled)),
      labOrders: shares.map((share) => ({
        ...orderOf(share),
        status: statusById.get(share.row.orderId) ?? share.row.orderStatus,
        cancelled: share.cancelled,
      })),
      uziOrders: clinicalOrders.filter((order) => order.kind === 'ULTRASOUND'),
      consultations: clinicalOrders.filter((order) => order.kind === 'CONSULTATION'),
    };
  }

  // ------------------------------------------------------------ referrals

  private async assertCanSend(found: AmbulatoryCase): Promise<void> {
    if (found.status !== 'OPEN')
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Karta yakunlangan — yo‘llanma yuborish uchun qayta oching',
        409,
      );
    const stay = await this.prisma.db.admission.findFirst({
      where: { patientId: found.patientId, branchId: found.branchId, status: 'ACTIVE' },
      select: { historyNumber: true },
    });
    if (stay)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Bemor hozir statsionarda (${stay.historyNumber}) — tahlil statsionar hisobiga yoziladi, ambulator yo‘llanma berilmaydi`,
        409,
      );
  }

  async sendLab(
    id: string,
    dto: AmbulatoryLabOrderInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const found = await this.requireCase(id, user, branchId);
    await this.assertCanSend(found);
    const serviceIds = [...new Set(dto.serviceIds)];
    const tests = await this.prisma.db.labTest.findMany({
      where: {
        serviceId: { in: serviceIds },
        isActive: true,
        service: { isActive: true, category: { kind: 'LAB' } },
      },
      select: { id: true, serviceId: true },
    });
    if (tests.length !== serviceIds.length)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Tanlangan laboratoriya xizmati lab-katalogga bog‘lanmagan',
        400,
      );
    const percent = await this.percentFor(found.doctorUserId);
    const clinicId = TenantContext.requireClinicId();
    const order = await this.prisma.db.$transaction(
      async (tx) => {
        const locked = await this.lockCase(tx, id);
        if (locked.status !== 'OPEN')
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Karta yakunlangan', 409);
        const visitId = await openVisitForCase(tx, locked);
        const created = await this.lab.createOrderFromReferral(
          {
            patientId: locked.patientId,
            branchId,
            visitId: visitId ?? undefined,
            testIds: tests.map((test) => test.id),
            orderedById: user.id,
          },
          tx,
        );
        await linkLabOrderToCase(tx, clinicId, created.id, locked);
        if (visitId)
          await tx.referral.create({
            data: { clinicId, visitId, type: 'LAB', labOrderId: created.id },
          });
        return created;
      },
      { timeout: 30_000 },
    );
    await this.lab.announceReferralOrder(order.id);
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'AmbulatoryLabReferral',
      entityId: order.id,
      after: { caseId: id, orderNumber: order.orderNumber, serviceIds, percent },
    });
    return this.getById(id, user, branchId);
  }

  async sendUzi(
    id: string,
    dto: AmbulatoryUziOrderInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const found = await this.requireCase(id, user, branchId);
    await this.assertCanSend(found);
    const order = await this.prisma.db.$transaction(
      async (tx) => {
        const locked = await this.lockCase(tx, id);
        if (locked.status !== 'OPEN')
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Karta yakunlangan', 409);
        const created = await this.clinicalOrders.createFromReferral(
          {
            patientId: locked.patientId,
            branchId,
            doctorUserId: dto.doctorUserId,
            serviceIds: [...new Set(dto.serviceIds)],
            kind: 'ULTRASOUND',
            note: dto.note,
            orderedById: user.id,
            requestKey: `uzi-amb:${id}:${randomUUID()}`,
          },
          tx,
        );
        await tx.clinicalOrder.update({
          where: { id: created.id },
          data: { ambulatoryCaseId: id },
        });
        const visitId = await openVisitForCase(tx, locked);
        if (visitId)
          await tx.referral.create({
            data: {
              clinicId: TenantContext.requireClinicId(),
              visitId,
              type: 'ULTRASOUND',
              targetDoctorUserId: dto.doctorUserId,
              clinicalOrderId: created.id,
              note: dto.note,
            },
          });
        return created;
      },
      { timeout: 30_000 },
    );
    await this.clinicalOrders.announceReferralOrder(order.id);
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'AmbulatoryUziReferral',
      entityId: order.id,
      after: { caseId: id, uziDoctorUserId: dto.doctorUserId, serviceIds: dto.serviceIds },
    });
    return this.getById(id, user, branchId);
  }

  // ------------------------------------------------------------ doctor share

  async commissions(
    q: AmbulatoryCommissionQueryInput,
    user: AuthUser,
    branchId: string,
  ): Promise<AmbulatoryCommissionReport> {
    this.assertBranch(user, branchId);
    if (this.isDoctor(user) && q.doctorUserId && q.doctorUserId !== user.id)
      throw new AppException(ErrorCode.FORBIDDEN, 'Shifokor faqat o‘z ulushini ko‘radi', 403);
    const doctorUserId = this.isDoctor(user) ? user.id : (q.doctorUserId ?? null);
    const { start, end } = cashflowRangeUtc(q.from, q.to);
    const fallback = await this.defaultPercent();
    const shares = (
      await this.labRows(
        branchId,
        Prisma.sql`AND o."createdAt" >= ${start} AND o."createdAt" < ${end}
          ${doctorUserId ? Prisma.sql`AND c."doctorUserId" = ${doctorUserId}` : Prisma.empty}`,
      )
    )
      .map((row) => labShare(row, fallback))
      .filter((share) => !share.cancelled);

    const doctorIds = [...new Set(shares.map((share) => share.row.doctorUserId))];
    const [profiles, overrides] = await Promise.all([
      doctorIds.length
        ? this.prisma.unscoped.user.findMany({
            where: { id: { in: doctorIds }, clinicId: TenantContext.requireClinicId() },
            select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
          })
        : [],
      doctorIds.length
        ? this.prisma.db.ambulatoryCommissionRate.findMany({
            where: { doctorUserId: { in: doctorIds } },
          })
        : [],
    ]);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const overrideById = new Map(
      overrides.map((rate) => [rate.doctorUserId, rate.percent.toNumber()]),
    );
    const doctors: AmbulatoryCommissionDoctor[] = doctorIds
      .map((id) => {
        const own = shares.filter((share) => share.row.doctorUserId === id);
        const profile = profileById.get(id);
        return {
          ...totalsOf(own),
          doctorUserId: id,
          doctorName: profile?.fullName ?? own[0]!.row.doctorName,
          specialty: profile?.staffProfile?.specialty ?? null,
          currentPercent: overrideById.get(id) ?? fallback,
        };
      })
      .sort(
        (a, b) =>
          Number(b.commission) - Number(a.commission) || a.doctorName.localeCompare(b.doctorName),
      );
    return {
      from: q.from,
      to: q.to,
      doctorUserId,
      defaultPercent: fallback,
      totals: totalsOf(shares),
      doctors,
      orders: shares.map(orderOf),
    };
  }

  async exportCommissions(report: AmbulatoryCommissionReport, user: AuthUser): Promise<Buffer> {
    if (!user.permissions.includes('reports.export') && !this.isDoctor(user))
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.export', 403);
    const state: Record<AmbulatoryPaymentState, string> = {
      PAID: 'To‘langan',
      PARTIAL: 'Qisman',
      UNPAID: 'To‘lanmagan',
    };
    const sheets: SheetSpec[] = [
      {
        name: 'Shifokorlar',
        columns: [
          { header: 'Shifokor', key: 'doctorName', width: 32 },
          { header: 'Mutaxassislik', key: 'specialty', width: 22 },
          { header: 'Bemorlar', key: 'patients', width: 12 },
          { header: 'Yo‘llanmalar', key: 'orders', width: 14 },
          { header: 'Lab summasi', key: 'labAmount', money: true },
          { header: 'To‘langan', key: 'paidAmount', money: true },
          { header: 'Shifokor ulushi', key: 'commission', money: true, width: 20 },
          { header: 'Kutilmoqda', key: 'pendingCommission', money: true },
          { header: 'Joriy foiz', key: 'currentPercent', width: 12 },
        ],
        rows: report.doctors.map((doctor) => ({
          ...doctor,
          specialty: doctor.specialty ?? '',
        })),
      },
      {
        name: 'Yo‘llanmalar',
        columns: [
          { header: 'Sana', key: 'createdAt', width: 18 },
          { header: 'Karta', key: 'caseNumber', width: 14 },
          { header: 'Lab №', key: 'orderNumber', width: 16 },
          { header: 'Bemor', key: 'patient', width: 30 },
          { header: 'Shifokor', key: 'doctorName', width: 28 },
          { header: 'Tahlillar', key: 'tests', width: 50 },
          { header: 'Lab summasi', key: 'labAmount', money: true },
          { header: 'To‘langan', key: 'paidAmount', money: true },
          { header: 'Foiz', key: 'percent', width: 8 },
          { header: 'Ulush', key: 'commission', money: true },
          { header: 'Holat', key: 'paymentState', width: 14 },
        ],
        rows: report.orders.map((order) => ({
          ...order,
          createdAt: new Date(order.createdAt)
            .toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' })
            .slice(0, 16),
          patient: `${order.patient.fullName} (${order.patient.mrn})`,
          tests: order.tests.map(testName).join(', '),
          paymentState: state[order.paymentState],
        })),
      },
      {
        name: 'Hisoblash',
        columns: [
          { header: 'Parametr', key: 'key', width: 28 },
          { header: 'Qiymat', key: 'value', width: 110 },
        ],
        rows: [
          { key: 'Davr', value: `${report.from} — ${report.to} (Toshkent vaqti, yo‘llanma sanasi)` },
          { key: 'Standart foiz', value: `${report.defaultPercent}%` },
          {
            key: 'Hisoblash',
            value:
              'Faqat ambulator kartadan yuborilgan laboratoriya. Ulush = to‘langan lab summasi × yo‘llanma paytidagi foiz. Chegirma va qaytarishlar ayiriladi; bekor qilinganlar kiritilmaydi.',
          },
        ],
      },
    ];
    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: 'ambulatory-commissions',
      after: { from: report.from, to: report.to, doctorUserId: report.doctorUserId },
    });
    return this.xlsx.buildWorkbook(sheets);
  }

  async rates(user: AuthUser, branchId: string): Promise<AmbulatoryRates> {
    this.assertBranch(user, branchId);
    const [doctors, overrides, fallback] = await Promise.all([
      this.prisma.unscoped.user.findMany({
        where: {
          clinicId: TenantContext.requireClinicId(),
          role: 'DOCTOR',
          status: 'ACTIVE',
          deletedAt: null,
          branches: { some: { branchId } },
        },
        select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.db.ambulatoryCommissionRate.findMany(),
      this.defaultPercent(),
    ]);
    const overrideById = new Map(
      overrides.map((rate) => [rate.doctorUserId, rate.percent.toNumber()]),
    );
    return {
      defaultPercent: fallback,
      doctors: doctors.map((doctor) => ({
        doctorUserId: doctor.id,
        fullName: doctor.fullName,
        specialty: doctor.staffProfile?.specialty ?? null,
        percent: overrideById.get(doctor.id) ?? null,
      })),
    };
  }

  async saveRates(
    dto: AmbulatoryRatesInput,
    user: AuthUser,
    branchId: string,
  ): Promise<AmbulatoryRates> {
    this.assertBranch(user, branchId);
    const clinicId = TenantContext.requireClinicId();
    const before = await this.rates(user, branchId);
    const known = new Set(before.doctors.map((doctor) => doctor.doctorUserId));
    if (dto.doctors.some((doctor) => !known.has(doctor.doctorUserId)))
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Shifokor topilmadi', 400);
    await this.prisma.db.$transaction(async (tx) => {
      const clinic = await tx.$queryRaw<{ settings: Prisma.JsonValue }[]>`
        SELECT "settings" FROM "Clinic" WHERE "id" = ${clinicId} FOR UPDATE`;
      const settings = (clinic[0]?.settings ?? {}) as Record<string, unknown>;
      await tx.$executeRaw`
        UPDATE "Clinic" SET "settings" = ${JSON.stringify({ ...settings, [SETTINGS_KEY]: dto.defaultPercent })}::jsonb
        WHERE "id" = ${clinicId}`;
      for (const row of dto.doctors) {
        if (row.percent === null) {
          await tx.ambulatoryCommissionRate.deleteMany({ where: { doctorUserId: row.doctorUserId } });
          continue;
        }
        await tx.ambulatoryCommissionRate.upsert({
          where: { clinicId_doctorUserId: { clinicId, doctorUserId: row.doctorUserId } },
          create: {
            clinicId,
            doctorUserId: row.doctorUserId,
            percent: new Prisma.Decimal(row.percent),
            updatedById: user.id,
          },
          update: { percent: new Prisma.Decimal(row.percent), updatedById: user.id },
        });
      }
    });
    const after = await this.rates(user, branchId);
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'AmbulatoryCommissionRate',
      entityId: 'rates',
      before,
      after,
    });
    return after;
  }
}
