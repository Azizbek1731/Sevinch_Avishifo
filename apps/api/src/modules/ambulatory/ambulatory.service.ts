import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AmbulatoryCase } from '@prisma/client';
import {
  AMBULATORY_SHARE_GROUPS,
  AuditAction,
  ErrorCode,
  type AmbulatoryCaseQueryInput,
  type AmbulatoryCommissionDoctor,
  type AmbulatoryCommissionQueryInput,
  type AmbulatoryCommissionReport,
  type AmbulatoryLabOrderInput,
  type AmbulatoryPaymentState,
  type AmbulatoryRates,
  type AmbulatoryShareGroup,
  type AmbulatorySharePercents,
  type AmbulatoryRatesInput,
  type AmbulatoryServiceOrderInput,
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
import { InvoicesService } from '../billing/invoices.service';
import { PricingService } from '../services/pricing.service';
import {
  AMBULATORY_PERCENT_SETTINGS,
  ambulatoryPercents,
  defaultPercentsFrom,
  linkLabOrderToCase,
  linkUziOrderToCase,
  nextAmbulatoryNumber,
  openVisitForCase,
  overridePercents,
} from './ambulatory-case';
import {
  earning,
  labShare,
  money,
  orderOf,
  totalsOf,
  uziShares,
  type LabRow,
  type Share,
  type UziRow,
} from './ambulatory-share';
import { cashflowRangeUtc } from '../reports/cashflow.service';
import { XlsxService, type SheetSpec } from '../reports/xlsx.service';

/** Lab, UZI and consultations have their own referral flows; surgery is inpatient-only. */
const CARD_SERVICE_KINDS = ['PROCEDURE', 'DIAGNOSTICS', 'OTHER', 'MATERIAL', 'MEDICINE'] as const;
const GROUP_LABEL: Record<AmbulatoryShareGroup, string> = { LAB: 'Laboratoriya', UZI: 'UZI', EXO: 'EXO' };

/** Tashkent calendar day bounds (+05:00), inclusive. */
function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000+05:00`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000+05:00`).getTime() + 86_400_000) } : {}),
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
    private readonly invoices: InvoicesService,
    private readonly pricing: PricingService,
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

  async defaultPercents(): Promise<AmbulatorySharePercents> {
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { settings: true },
    });
    return defaultPercentsFrom(clinic?.settings);
  }

  private percentsFor(doctorUserId: string): Promise<AmbulatorySharePercents> {
    return ambulatoryPercents(this.prisma.db, TenantContext.requireClinicId(), doctorUserId);
  }

  /** Lab and UZI/EXO shares of the cards matched by `filter` (aliases: c = card, o = order). */
  private async shares(branchId: string, filter: Prisma.Sql): Promise<Share[]> {
    const [labs, uzis, defaults] = await Promise.all([
      this.labRows(branchId, filter),
      this.uziRows(branchId, filter),
      this.defaultPercents(),
    ]);
    return [
      ...labs.map((row) => labShare(row, defaults.LAB)),
      ...uziShares(uzis),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async uziRows(branchId: string, filter: Prisma.Sql): Promise<UziRow[]> {
    const clinicId = TenantContext.requireClinicId();
    // Raw SQL bypasses the tenant extension; every source and join is scoped explicitly.
    return this.prisma.db.$queryRaw<UziRow[]>(Prisma.sql`
      SELECT o.id AS "orderId", o."createdAt",
        c.id AS "caseId", c.number AS "caseNumber", c."doctorUserId", c."doctorName",
        p.id AS "patientId", p.mrn, p."fullName",
        ii.number AS "orderNumber",
        (ii.status::text IN ('CANCELLED', 'REFUNDED') OR v.status::text = 'CANCELLED') AS "orderCancelled",
        o."ambulatoryUziPercent"::text AS "uziPercent",
        o."ambulatoryEchoPercent"::text AS "echoPercent",
        i.id AS "invoiceId", i.number AS "invoiceNumber", i.status::text AS "invoiceStatus",
        i.total::text AS "invoiceTotal", i."paidTotal"::text AS "paidTotal",
        COALESCE(r.refunded, 0)::text AS refunded,
        COALESCE(l.all_total, 0)::text AS "linesTotal",
        COALESCE(l.uzi_total, 0)::text AS "uziLinesTotal",
        COALESCE(l.echo_total, 0)::text AS "echoLinesTotal",
        COALESCE(l.uzi_titles, '[]'::jsonb) AS "uziTitles",
        COALESCE(l.echo_titles, '[]'::jsonb) AS "echoTitles"
      FROM "ClinicalOrder" o
      JOIN "AmbulatoryCase" c ON c.id = o."ambulatoryCaseId" AND c."clinicId" = ${clinicId}
      JOIN "Patient" p ON p.id = o."patientId" AND p."clinicId" = ${clinicId}
      JOIN "Invoice" ii ON ii.id = o."initialInvoiceId" AND ii."clinicId" = ${clinicId}
      LEFT JOIN "Visit" v ON v.id = o."visitId" AND v."clinicId" = ${clinicId}
      JOIN "Invoice" i ON (i."clinicalOrderId" = o.id OR i.id = o."initialInvoiceId") AND i."clinicId" = ${clinicId}
      LEFT JOIN LATERAL (
        SELECT SUM(rf.amount) AS refunded FROM "Refund" rf
        WHERE rf."invoiceId" = i.id AND rf."clinicId" = ${clinicId}
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT SUM(il."lineTotal") AS all_total,
          SUM(il."lineTotal") FILTER (WHERE sc.kind::text = 'ULTRASOUND' AND NOT s."isEcho") AS uzi_total,
          SUM(il."lineTotal") FILTER (WHERE sc.kind::text = 'ULTRASOUND' AND s."isEcho") AS echo_total,
          jsonb_agg(il.title ORDER BY il.id) FILTER (WHERE sc.kind::text = 'ULTRASOUND' AND NOT s."isEcho") AS uzi_titles,
          jsonb_agg(il.title ORDER BY il.id) FILTER (WHERE sc.kind::text = 'ULTRASOUND' AND s."isEcho") AS echo_titles
        FROM "InvoiceLine" il
        LEFT JOIN "Service" s ON s.id = il."serviceId" AND s."clinicId" = ${clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE il."invoiceId" = i.id AND il."clinicId" = ${clinicId}
      ) l ON true
      WHERE o."clinicId" = ${clinicId} AND o."branchId" = ${branchId} AND o.kind = 'ULTRASOUND' ${filter}
      ORDER BY o."createdAt" DESC, i."createdAt" ASC
    `);
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
    const [rows, total] = await Promise.all([
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
    ]);
    const ids = rows.map((row) => row.id);
    const shares = ids.length
      ? (await this.shares(branchId, Prisma.sql`AND c.id IN (${Prisma.join(ids)})`)).filter(earning)
      : [];
    return paginated(
      rows.map((row) => {
        const totals = totalsOf(shares.filter((share) => share.caseId === row.id));
        return {
          ...this.map(row),
          patient: row.patient,
          labOrders: row._count.labOrders,
          uziOrders: row._count.clinicalOrders,
          amount: totals.amount,
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
      const [lab, uzi, services] = await Promise.all([
        tx.labOrder.count({ where: { ambulatoryCaseId: id } }),
        tx.clinicalOrder.count({ where: { ambulatoryCaseId: id } }),
        tx.chargeItem.count({ where: { ambulatoryCaseId: id } }),
      ]);
      if (lab + uzi + services > 0)
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
    const [patient, clinicalOrders, labOrders, stay, services, shares, currentPercents] = await Promise.all([
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
      this.clinicalOrders.listForAmbulatoryCase(id, branchId),
      this.prisma.db.labOrder.findMany({
        where: { ambulatoryCaseId: id },
        select: { id: true, status: true },
      }),
      this.prisma.db.admission.findFirst({
        where: { patientId: found.patientId, branchId, status: 'ACTIVE' },
        select: { id: true, historyNumber: true },
      }),
      this.caseServices(id),
      this.shares(branchId, Prisma.sql`AND c.id = ${id}`),
      this.percentsFor(found.doctorUserId),
    ]);
    const statusById = new Map(labOrders.map((order) => [order.id, order.status]));
    const uziSharesByOrder = new Map<string, Share[]>();
    for (const share of shares)
      if (share.group !== 'LAB')
        uziSharesByOrder.set(share.orderId, [...(uziSharesByOrder.get(share.orderId) ?? []), share]);
    return {
      ...this.map(found),
      patient,
      currentPercents,
      activeStay: stay,
      totals: totalsOf(shares.filter(earning)),
      labOrders: shares
        .filter((share) => share.group === 'LAB')
        .map((share) => ({
          ...orderOf(share),
          status: statusById.get(share.orderId) ?? 'ORDERED',
          cancelled: share.cancelled,
        })),
      uziOrders: clinicalOrders
        .filter((order) => order.kind === 'ULTRASOUND')
        .map((order) => ({
          ...order,
          shares: (uziSharesByOrder.get(order.id) ?? []).map((share) => ({
            group: share.group,
            percent: share.percent.toNumber(),
            amount: money(share.amount),
            commission: money(share.commission),
            pendingCommission: money(share.pendingCommission),
          })),
        })),
      consultations: clinicalOrders.filter((order) => order.kind === 'CONSULTATION'),
      services,
    };
  }

  /** Lines added to the card by hand, with the state of the bill each one went on. */
  private async caseServices(id: string): Promise<Record<string, unknown>[]> {
    const charges = await this.prisma.db.chargeItem.findMany({
      where: { ambulatoryCaseId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const lineIds = charges.flatMap((charge) => (charge.invoiceLineId ? [charge.invoiceLineId] : []));
    const lines = lineIds.length
      ? await this.prisma.db.invoiceLine.findMany({
          where: { id: { in: lineIds } },
          select: {
            id: true,
            invoice: { select: { id: true, number: true, status: true, total: true, paidTotal: true } },
          },
        })
      : [];
    const invoiceByLine = new Map(lines.map((line) => [line.id, line.invoice]));
    return charges.map((charge) => {
      const invoice = charge.invoiceLineId ? invoiceByLine.get(charge.invoiceLineId) : undefined;
      const cancelled =
        charge.status === 'CANCELLED' ||
        !invoice ||
        invoice.status === 'CANCELLED' ||
        invoice.status === 'REFUNDED';
      const paymentState: AmbulatoryPaymentState | null =
        cancelled || !invoice
        ? null
        : invoice.paidTotal.gte(invoice.total)
          ? 'PAID'
          : invoice.paidTotal.gt(0)
            ? 'PARTIAL'
            : 'UNPAID';
      return {
        id: charge.id,
        serviceId: charge.serviceId,
        title: charge.title,
        quantity: charge.quantity,
        unitPrice: charge.unitPrice.toFixed(2),
        lineTotal: charge.unitPrice.mul(charge.quantity).toFixed(2),
        createdAt: charge.createdAt.toISOString(),
        invoiceNumber: invoice?.number ?? null,
        cancelled,
        paymentState,
      };
    });
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
    const percent = (await this.percentsFor(found.doctorUserId)).LAB;
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
        await linkUziOrderToCase(tx, TenantContext.requireClinicId(), created.id, locked);
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

  /** Procedures, diagnostics (EKG…) or free-text lines, issued to the cashier as one bill. */
  async addServices(
    id: string,
    dto: AmbulatoryServiceOrderInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const found = await this.requireCase(id, user, branchId);
    await this.assertCanSend(found);
    const serviceIds = [...new Set(dto.items.flatMap((item) => (item.serviceId ? [item.serviceId] : [])))];
    const services = serviceIds.length
      ? await this.prisma.db.service.findMany({
          where: {
            id: { in: serviceIds },
            isActive: true,
            category: { kind: { in: [...CARD_SERVICE_KINDS] } },
          },
          select: { id: true, name: true },
        })
      : [];
    if (services.length !== serviceIds.length)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Tahlil, UZI, shifokor qabuli va operatsiya o‘z bo‘limidan yuboriladi',
        400,
      );
    const prices = await this.pricing.getCurrentPrices(serviceIds, branchId);
    if (serviceIds.some((serviceId) => !prices.has(serviceId)))
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat narxi belgilanmagan', 400);
    const nameById = new Map(services.map((service) => [service.id, service.name]));
    const clinicId = TenantContext.requireClinicId();
    const date = new Date(`${new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);

    const invoice = await this.prisma.db.$transaction(
      async (tx) => {
        const locked = await this.lockCase(tx, id);
        if (locked.status !== 'OPEN')
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Karta yakunlangan', 409);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':charge:' + dto.idempotencyKey}, 0))`;
        const replay = await tx.chargeItem.findFirst({
          where: { requestKey: `${dto.idempotencyKey}:0` },
          select: { ambulatoryCaseId: true },
        });
        if (replay) {
          if (replay.ambulatoryCaseId !== id)
            throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa karta uchun ishlatilgan', 409);
          return null;
        }
        const visitId = await openVisitForCase(tx, locked);
        const chargeIds: string[] = [];
        for (const [index, item] of dto.items.entries()) {
          const charge = await tx.chargeItem.create({
            data: {
              clinicId,
              branchId,
              patientId: locked.patientId,
              ambulatoryCaseId: id,
              visitId,
              serviceId: item.serviceId ?? null,
              title: item.serviceId
                ? (nameById.get(item.serviceId) as Prisma.InputJsonValue)
                : { uz: item.title! },
              date,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(
                item.serviceId ? prices.get(item.serviceId)! : item.unitPrice!,
              ),
              createdById: user.id,
              requestKey: `${dto.idempotencyKey}:${index}`,
            },
            select: { id: true },
          });
          chargeIds.push(charge.id);
        }
        return this.invoices.issueChargesInTransaction(tx, chargeIds, user, branchId, {
          skipLab: true,
        });
      },
      { timeout: 30_000 },
    );
    if (invoice)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'AmbulatoryServiceReferral',
        entityId: invoice.id,
        after: {
          caseId: id,
          invoiceNumber: invoice.number,
          total: invoice.total.toFixed(2),
          items: dto.items.map((item) => ({
            serviceId: item.serviceId ?? null,
            title: item.serviceId ? null : item.title,
            quantity: item.quantity,
            unitPrice: item.serviceId ? prices.get(item.serviceId) : item.unitPrice,
          })),
        },
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
    const [shares, defaults] = await Promise.all([
      this.shares(
        branchId,
        Prisma.sql`AND o."createdAt" >= ${start} AND o."createdAt" < ${end}
          ${doctorUserId ? Prisma.sql`AND c."doctorUserId" = ${doctorUserId}` : Prisma.empty}`,
      ).then((all) => all.filter(earning)),
      this.defaultPercents(),
    ]);

    const doctorIds = [...new Set(shares.map((share) => share.doctorUserId))];
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
    const overrideById = new Map(overrides.map((rate) => [rate.doctorUserId, overridePercents(rate)]));
    const doctors: AmbulatoryCommissionDoctor[] = doctorIds
      .map((id) => {
        const own = shares.filter((share) => share.doctorUserId === id);
        const profile = profileById.get(id);
        const override = overrideById.get(id);
        return {
          ...totalsOf(own),
          doctorUserId: id,
          doctorName: profile?.fullName ?? own[0]!.doctorName,
          specialty: profile?.staffProfile?.specialty ?? null,
          currentPercents: {
            LAB: override?.LAB ?? defaults.LAB,
            UZI: override?.UZI ?? defaults.UZI,
            EXO: override?.EXO ?? defaults.EXO,
          },
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
      defaultPercents: defaults,
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
          { header: 'Yo‘llanma summasi', key: 'amount', money: true },
          { header: 'To‘langan', key: 'paidAmount', money: true },
          { header: 'Lab ulushi', key: 'labCommission', money: true },
          { header: 'UZI ulushi', key: 'uziCommission', money: true },
          { header: 'EXO ulushi', key: 'echoCommission', money: true },
          { header: 'Jami ulush', key: 'commission', money: true, width: 20 },
          { header: 'Kutilmoqda', key: 'pendingCommission', money: true },
          { header: 'Joriy foizlar', key: 'percents', width: 28 },
        ],
        rows: report.doctors.map((doctor) => ({
          ...doctor,
          specialty: doctor.specialty ?? '',
          labCommission: doctor.byGroup.LAB.commission,
          uziCommission: doctor.byGroup.UZI.commission,
          echoCommission: doctor.byGroup.EXO.commission,
          percents: AMBULATORY_SHARE_GROUPS.map(
            (group) => `${GROUP_LABEL[group]} ${doctor.currentPercents[group]}%`,
          ).join(' · '),
        })),
      },
      {
        name: 'Yo‘llanmalar',
        columns: [
          { header: 'Sana', key: 'createdAt', width: 18 },
          { header: 'Yo‘nalish', key: 'group', width: 14 },
          { header: 'Karta', key: 'caseNumber', width: 14 },
          { header: 'Yo‘llanma №', key: 'orderNumber', width: 18 },
          { header: 'Bemor', key: 'patient', width: 30 },
          { header: 'Shifokor', key: 'doctorName', width: 28 },
          { header: 'Tekshiruvlar', key: 'tests', width: 50 },
          { header: 'Summa', key: 'amount', money: true },
          { header: 'To‘langan', key: 'paidAmount', money: true },
          { header: 'Foiz', key: 'percent', width: 8 },
          { header: 'Ulush', key: 'commission', money: true },
          { header: 'Holat', key: 'paymentState', width: 14 },
        ],
        rows: report.orders.map((order) => ({
          ...order,
          group: GROUP_LABEL[order.group],
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
          {
            key: 'Standart foizlar',
            value: AMBULATORY_SHARE_GROUPS.map(
              (group) => `${GROUP_LABEL[group]} ${report.defaultPercents[group]}%`,
            ).join(' · '),
          },
          {
            key: 'Hisoblash',
            value:
              'Faqat ambulator kartadan yuborilgan laboratoriya, UZI va EXO. Ulush = kassada to‘langan summa × yo‘llanma paytidagi foiz (laboratoriya, UZI va EXO uchun alohida). Chegirma va qaytarishlar ayiriladi; bekor qilinganlar va foizi 0% bo‘lganlar kiritilmaydi.',
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
    const [doctors, overrides, defaults, ultrasound] = await Promise.all([
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
      this.defaultPercents(),
      this.prisma.db.service.findMany({
        where: { category: { kind: 'ULTRASOUND' }, OR: [{ isActive: true }, { isEcho: true }] },
        select: { id: true, code: true, name: true, isEcho: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { code: 'asc' }],
      }),
    ]);
    const overrideById = new Map(overrides.map((rate) => [rate.doctorUserId, overridePercents(rate)]));
    return {
      defaults,
      doctors: doctors.map((doctor) => ({
        doctorUserId: doctor.id,
        fullName: doctor.fullName,
        specialty: doctor.staffProfile?.specialty ?? null,
        percents: overrideById.get(doctor.id) ?? { LAB: null, UZI: null, EXO: null },
      })),
      ultrasoundServices: ultrasound.map((service) => ({
        id: service.id,
        code: service.code,
        name: service.name as Record<string, string> | string,
        category: service.category.name,
        isEcho: service.isEcho,
      })),
    };
  }

  private auditRates(rates: AmbulatoryRates) {
    return {
      defaults: rates.defaults,
      doctors: rates.doctors.filter((doctor) =>
        AMBULATORY_SHARE_GROUPS.some((group) => doctor.percents[group] !== null),
      ),
      echoServices: rates.ultrasoundServices
        .filter((service) => service.isEcho)
        .map((service) => service.code),
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
    const echoIds = [...new Set(dto.echoServiceIds)];
    const ultrasoundIds = new Set(before.ultrasoundServices.map((service) => service.id));
    if (echoIds.some((serviceId) => !ultrasoundIds.has(serviceId)))
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'EXO ro‘yxatida faqat UZI tekshiruvlari bo‘ladi', 400);
    const decimal = (value: number | null) => (value === null ? null : new Prisma.Decimal(value));
    await this.prisma.db.$transaction(async (tx) => {
      const clinic = await tx.$queryRaw<{ settings: Prisma.JsonValue }[]>`
        SELECT "settings" FROM "Clinic" WHERE "id" = ${clinicId} FOR UPDATE`;
      const settings = (clinic[0]?.settings ?? {}) as Record<string, unknown>;
      const next = { ...settings };
      for (const group of AMBULATORY_SHARE_GROUPS)
        next[AMBULATORY_PERCENT_SETTINGS[group]] = dto.defaults[group];
      await tx.$executeRaw`
        UPDATE "Clinic" SET "settings" = ${JSON.stringify(next)}::jsonb
        WHERE "id" = ${clinicId}`;
      for (const row of dto.doctors) {
        const { LAB, UZI, EXO } = row.percents;
        if (LAB === null && UZI === null && EXO === null) {
          await tx.ambulatoryCommissionRate.deleteMany({ where: { doctorUserId: row.doctorUserId } });
          continue;
        }
        const data = { percent: decimal(LAB), uziPercent: decimal(UZI), echoPercent: decimal(EXO), updatedById: user.id };
        await tx.ambulatoryCommissionRate.upsert({
          where: { clinicId_doctorUserId: { clinicId, doctorUserId: row.doctorUserId } },
          create: { clinicId, doctorUserId: row.doctorUserId, ...data },
          update: data,
        });
      }
      await tx.service.updateMany({
        where: { id: { in: [...ultrasoundIds] }, isEcho: true, NOT: { id: { in: echoIds } } },
        data: { isEcho: false },
      });
      if (echoIds.length)
        await tx.service.updateMany({ where: { id: { in: echoIds } }, data: { isEcho: true } });
    });
    const after = await this.rates(user, branchId);
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'AmbulatoryCommissionRate',
      entityId: 'rates',
      before: this.auditRates(before),
      after: this.auditRates(after),
    });
    return after;
  }
}
