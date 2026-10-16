import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Invoice,
  InvoiceLine,
  Payment,
  Refund,
  PaymentStatus as DbPaymentStatus,
} from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  NotificationEvent,
  type AddPaymentInput,
  type AuthUser,
  type CreateInvoiceInput,
  type CreateRefundInput,
  type InvoiceQueryInput,
  type PaymentPart,
  type QuickInvoiceInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { canSeeDeleted } from '../../common/visibility';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { assertManualMethod, lockOpenShift } from './cash-accounts';
import { SequenceService } from '../../core/sequence/sequence.service';
import { PricingService } from '../services/pricing.service';
import { LabService } from '../lab/lab.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FISCALIZATION_SERVICE, type FiscalizationService } from './fiscalization.service';

const DEFAULT_INVOICE_FORMAT = 'INV-{YYYY}-{NNNNNN}';

interface LinePlan {
  serviceId: string | null;
  title: Prisma.InputJsonValue;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  performerUserId: string | null;
  /**
   * The ward charge this line was raised from, when there is one. Written back
   * onto ChargeItem.invoiceLineId so a stay can be traced to the invoices that
   * billed it — the column existed from the first migration but nothing ever
   * filled it, so "what does this admission still owe" had no answer at all.
   */
  chargeItemId: string | null;
}

/** Payment view returned to provider webhook handlers (Payme state codes). */
export interface ProviderPaymentView {
  id: string;
  invoiceId: string;
  amount: string;
  /** Payme-style state: 1 pending, 2 completed, -1 cancelled, -2 cancelled after perform. */
  state: number;
  createTime: number;
  performTime: number;
}

export type ProviderTxError =
  | 'invoice_not_found'
  | 'invalid_state'
  | 'wrong_amount'
  | 'tx_not_found'
  | 'cannot_perform';

export type ProviderTxResult =
  | { ok: true; payment: ProviderPaymentView }
  | { ok: false; error: ProviderTxError };

function providerState(status: DbPaymentStatus): number {
  switch (status) {
    case 'PENDING':
      return 1;
    case 'COMPLETED':
      return 2;
    case 'REFUNDED':
      return -2;
    case 'FAILED':
    default:
      return -1;
  }
}


/**
 * A stable idempotency key for one leg of a split, derived from the sale's
 * single key plus the leg index.
 *
 * The client sends one key for the whole sale; deriving the rest here means a
 * retried submission reproduces exactly the same keys, so each leg is still
 * written at most once. Formatted as a v4-shaped UUID because that is what the
 * payment schema and the unique index expect.
 */
function legKey(base: string, index: number): string {
  const h = createHash('sha256').update(`${base}:${index}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const paymentNote = (note: string | null | undefined): string | null => note?.trim() || null;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
    @Inject(FISCALIZATION_SERVICE) private readonly fiscalization: FiscalizationService,
    private readonly lab: LabService,
    private readonly config: AppConfigService,
  ) {}

  // ============================================================ mapping

  private mapInvoice(inv: Invoice): Record<string, unknown> {
    return {
      id: inv.id,
      number: inv.number,
      branchId: inv.branchId,
      patientId: inv.patientId,
      visitId: inv.visitId,
      status: inv.status,
      subtotal: inv.subtotal.toFixed(2),
      discountTotal: inv.discountTotal.toFixed(2),
      total: inv.total.toFixed(2),
      paidTotal: inv.paidTotal.toFixed(2),
      due: inv.total.sub(inv.paidTotal).toFixed(2),
      note: inv.note,
      issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
      createdById: inv.createdById,
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
    };
  }

  private mapLine(line: InvoiceLine): Record<string, unknown> {
    return {
      id: line.id,
      serviceId: line.serviceId,
      title: line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      discount: line.discount.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      performerUserId: line.performerUserId,
    };
  }

  private mapPayment(p: Payment): Record<string, unknown> {
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      branchId: p.branchId,
      amount: p.amount.toFixed(2),
      method: p.method,
      note: p.note,
      status: p.status,
      shiftId: p.shiftId,
      providerTxId: p.providerTxId,
      receivedById: p.receivedById,
      paidAt: p.paidAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private mapRefund(r: Refund): Record<string, unknown> {
    return {
      id: r.id,
      invoiceId: r.invoiceId,
      amount: r.amount.toFixed(2),
      method: r.method,
      reason: r.reason,
      shiftId: r.shiftId,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ============================================================ numbering

  /**
   * Sequence-based invoice number from clinic.settings.invoiceNumberFormat.
   * Supported placeholders: {YYYY} (current year) and {N..N} (zero-padded sequence).
   */
  private async nextInvoiceNumber(): Promise<string> {
    const clinicId = TenantContext.requireClinicId();
    // prisma.unscoped justified: Clinic is not tenant-auto-scoped; we read only
    // the current tenant's own row by the context clinicId.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { settings: true },
    });
    const settings =
      clinic && typeof clinic.settings === 'object' && clinic.settings !== null
        ? (clinic.settings as Record<string, unknown>)
        : {};
    const format =
      typeof settings.invoiceNumberFormat === 'string' && settings.invoiceNumberFormat.length > 0
        ? settings.invoiceNumberFormat
        : DEFAULT_INVOICE_FORMAT;
    const seq = await this.sequence.next('invoice');
    return format
      .replace('{YYYY}', String(new Date().getUTCFullYear()))
      .replace(/\{(N+)\}/, (_m, ns: string) => String(seq).padStart(ns.length, '0'));
  }

  // ============================================================ invoices

  /**
   * Hand newly recorded ward/surgery costs to the cashier in the caller's
   * transaction. The clinical write and the issued invoice either both commit
   * or both roll back. Callers own submission idempotency and pass fresh ids;
   * this method never sweeps pending charges released by a cancelled invoice.
   */
  async issueChargesInTransaction(
    tx: TenantTransactionClient,
    chargeIds: string[],
    user: Pick<AuthUser, 'id' | 'branchIds'>,
    branchId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    const clinicId = TenantContext.requireClinicId();
    if (user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    if (!chargeIds.length || new Set(chargeIds).size !== chargeIds.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xarajatlar ro‘yxati noto‘g‘ri', 400);
    }
    const charges = await tx.chargeItem.findMany({
      where: { id: { in: chargeIds }, branchId, status: 'PENDING', invoiceLineId: null },
      orderBy: { id: 'asc' },
    });
    if (charges.length !== chargeIds.length) {
      throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Xarajat allaqachon hisobga kiritilgan yoki boshqa filialga tegishli', 409);
    }
    const patientId = charges[0]!.patientId;
    if (charges.some((charge) => charge.patientId !== patientId)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmatlar turli bemorlarga tegishli', 400);
    }
    const [branch, patient] = await Promise.all([
      tx.branch.findFirst({ where: { id: branchId }, select: { id: true } }),
      tx.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    // Keep the same lock order as invoice cancellation and admission discharge.
    for (const admissionId of [...new Set(charges.flatMap((charge) => charge.admissionId ? [charge.admissionId] : []))].sort()) {
      await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${admissionId} AND "clinicId" = ${clinicId} AND "branchId" = ${branchId} FOR UPDATE`;
    }
    const surgeries = await tx.surgeryCase.findMany({
      where: { id: { in: [...new Set(charges.flatMap((charge) => charge.surgeryId ? [charge.surgeryId] : []))] }, branchId, patientId },
      select: { id: true, serviceChargeId: true, surgeonUserId: true },
    });
    const surgeryById = new Map(surgeries.map((surgery) => [surgery.id, surgery]));
    const plans = charges.map((charge) => {
      const surgery = charge.surgeryId ? surgeryById.get(charge.surgeryId) : undefined;
      if (charge.surgeryId && !surgery) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiya xarajati bemorga mos emas', 409);
      }
      return {
        id: randomUUID(),
        charge,
        lineTotal: charge.unitPrice.mul(charge.quantity),
        // Surgical remuneration is handled by dedicated surgery payouts.
        performerUserId: surgery?.serviceChargeId === charge.id ? surgery.surgeonUserId : null,
      };
    });
    const total = plans.reduce((sum, plan) => sum.add(plan.lineTotal), new Prisma.Decimal(0));
    if (total.lt(0) || total.gt('999999999999.99')) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Hisob summasi noto‘g‘ri yoki juda katta', 400);
    }
    for (const plan of plans) {
      const claimed = await tx.chargeItem.updateMany({
        where: {
          id: plan.charge.id, branchId, patientId, status: 'PENDING', invoiceLineId: null,
          quantity: plan.charge.quantity, unitPrice: plan.charge.unitPrice,
          serviceId: plan.charge.serviceId,
        },
        data: { status: 'INVOICED', invoiceLineId: plan.id },
      });
      if (claimed.count !== 1) {
        throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Xarajat holati o‘zgardi, sahifani yangilang', 409);
      }
    }
    // Number allocation belongs to this transaction as well: no separate
    // connection or partially committed billing work is needed.
    const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } });
    const settings = clinic?.settings && typeof clinic.settings === 'object' && !Array.isArray(clinic.settings)
      ? clinic.settings as Record<string, unknown> : {};
    const format = typeof settings.invoiceNumberFormat === 'string' && settings.invoiceNumberFormat.length
      ? settings.invoiceNumberFormat : DEFAULT_INVOICE_FORMAT;
    const counters = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO "ClinicCounter" ("id", "clinicId", "key", "value")
      VALUES (gen_random_uuid(), ${clinicId}, 'invoice', 1)
      ON CONFLICT ("clinicId", "key")
      DO UPDATE SET "value" = "ClinicCounter"."value" + 1
      RETURNING "value"
    `;
    const number = format.replace('{YYYY}', String(new Date().getUTCFullYear()))
      .replace(/\{(N+)\}/, (_match, digits: string) => String(counters[0]!.value).padStart(digits.length, '0'));
    const visitIds = [...new Set(charges.map((charge) => charge.visitId))];
    const invoice = await tx.invoice.create({
      data: {
        clinicId, branchId, patientId, number,
        visitId: visitIds.length === 1 ? visitIds[0] : null,
        status: total.eq(0) ? 'PAID' : 'ISSUED', issuedAt: new Date(),
        subtotal: total, discountTotal: 0, total, createdById: user.id,
        lines: { create: plans.map((plan) => ({
          id: plan.id, clinicId, serviceId: plan.charge.serviceId,
          title: plan.charge.title as Prisma.InputJsonValue,
          quantity: plan.charge.quantity, unitPrice: plan.charge.unitPrice,
          discount: 0, lineTotal: plan.lineTotal, performerUserId: plan.performerUserId,
        })) },
      },
      include: { lines: true },
    });
    await this.lab.prepareOrderForInvoice(tx, invoice, invoice.lines);
    const context = TenantContext.get();
    // AuditLog is intentionally unscoped, so stamp tenant and actor explicitly.
    await tx.auditLog.create({ data: {
      clinicId, userId: user.id, action: AuditAction.CREATE,
      entity: 'Invoice', entityId: invoice.id,
      diff: {
        number: { before: null, after: number },
        patientId: { before: null, after: patientId },
        total: { before: null, after: total.toFixed(2) },
        status: { before: null, after: invoice.status },
        chargeIds: { before: null, after: chargeIds },
        source: { before: null, after: 'AUTOMATIC_CHARGE_BILLING' },
      },
      ip: context?.ip, userAgent: context?.userAgent,
    } });
    return invoice;
  }

  async create(dto: CreateInvoiceInput, user: AuthUser, opts: { issueImmediately?: boolean; requestKey?: string; requestFingerprint?: string } = {}): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();

    if (user.branchIds.length > 0 && !user.branchIds.includes(dto.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const branch = await this.prisma.db.branch.findFirst({ where: { id: dto.branchId } });
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    let visit: { id: string; doctorUserId: string; serviceIds: string[]; titles: Map<string, Prisma.JsonValue> } | null =
      null;
    if (dto.visitId) {
      const row = await this.prisma.db.visit.findFirst({
        where: { id: dto.visitId, patientId: dto.patientId, branchId: dto.branchId },
        include: {
          appointment: { include: { services: { include: { service: { select: { id: true, name: true } } } } } },
        },
      });
      if (!row) throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
      const titles = new Map<string, Prisma.JsonValue>();
      const serviceIds: string[] = [];
      for (const s of row.appointment?.services ?? []) {
        serviceIds.push(s.serviceId);
        titles.set(s.serviceId, s.service.name);
      }
      visit = { id: row.id, doctorUserId: row.doctorUserId, serviceIds, titles };
    }

    const plans: LinePlan[] = [];
    if (dto.lines && dto.lines.length > 0) {
      // Explicit lines (unit prices supplied by the caller, validated by zod).
      const serviceIds = dto.lines.map((l) => l.serviceId).filter((x): x is string => x !== undefined);
      const services =
        serviceIds.length > 0
          ? await this.prisma.db.service.findMany({
              where: { id: { in: serviceIds } },
              select: { id: true, name: true, category: { select: { kind: true } } },
            })
          : [];
      if (this.config.env.SINGLE_CLINIC_MODE && !dto.visitId && !dto.lines.some((line) => line.chargeItemId)) {
        const assignedCare = await this.prisma.db.service.count({ where: { id: { in: serviceIds }, category: { kind: { in: ['CONSULTATION', 'ULTRASOUND'] } } } });
        if (assignedCare) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Use the consultation or ultrasound order form to select the treating doctor', 400);
      }
      const serviceById = new Map(services.map((s) => [s.id, s]));
      for (const l of dto.lines) {
        const svc = l.serviceId ? serviceById.get(l.serviceId) : undefined;
        if (l.serviceId && !svc) {
          throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404, [{ serviceId: l.serviceId }]);
        }
        if (svc?.category.kind === 'SURGERY' && !l.chargeItemId) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiya uchun statsionar kartasidagi xarajatni tanlang', 400);
        }
        const unitPrice = new Prisma.Decimal(l.unitPrice);
        const discount = new Prisma.Decimal(l.discount ?? '0');
        const lineTotal = unitPrice.mul(l.quantity).sub(discount);
        if (lineTotal.lt(0)) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Line discount exceeds line amount', 400);
        }
        plans.push({
          serviceId: l.serviceId ?? null,
          title: (l.title ?? (svc?.name as Prisma.InputJsonValue) ?? '') as Prisma.InputJsonValue,
          quantity: l.quantity,
          unitPrice,
          discount,
          lineTotal,
          performerUserId: l.performerUserId ?? visit?.doctorUserId ?? null,
          chargeItemId: l.chargeItemId ?? null,
        });
      }
    } else if (visit) {
      // Lines absent — price the visit's appointment services via PricingService.
      if (visit.serviceIds.length === 0) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Visit has no services to invoice', 400);
      }
      for (const serviceId of visit.serviceIds) {
        const price = await this.pricing.getCurrentPrice(serviceId, dto.branchId);
        if (price === null) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Service has no current price', 400, [{ serviceId }]);
        }
        const unitPrice = new Prisma.Decimal(price);
        plans.push({
          serviceId,
          title: (visit.titles.get(serviceId) ?? '') as Prisma.InputJsonValue,
          quantity: 1,
          unitPrice,
          discount: new Prisma.Decimal(0),
          lineTotal: unitPrice,
          performerUserId: visit.doctorUserId,
          chargeItemId: null,
        });
      }
    }
    if (plans.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invoice requires at least one line', 400);
    }

    const zero = new Prisma.Decimal(0);
    const subtotal = plans.reduce((acc, p) => acc.add(p.unitPrice.mul(p.quantity)), zero);
    const discountTotal = plans.reduce((acc, p) => acc.add(p.discount), zero);
    const total = subtotal.sub(discountTotal);

    const number = await this.nextInvoiceNumber();
    const lineIds = plans.map(() => randomUUID());
    const chargeIds = plans.flatMap((p) => p.chargeItemId ? [p.chargeItemId] : []);
    if (new Set(chargeIds).size !== chargeIds.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bir xarajatni ikki marta kiritib bo‘lmaydi', 400);
    }
    let replayed = false;
    const invoice = await this.prisma.db.$transaction(async (tx) => {
      if (opts.requestKey) {
        // Serialize the same clinical submission before claiming any ward charges.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':' + opts.requestKey}, 0))`;
        const existing = await tx.invoice.findFirst({ where: { requestKey: opts.requestKey }, include: { lines: true } });
        if (existing) {
          if (existing.requestFingerprint !== opts.requestFingerprint) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa hisob uchun ishlatilgan', 409);
          replayed = true;
          return existing;
        }
      }
      // Claim every selected ward charge under the same transaction as its
      // invoice. A competing cashier cannot bill it twice or leave it orphaned.
      if (chargeIds.length) {
        const stays = await tx.chargeItem.findMany({ where: { id: { in: chargeIds }, branchId: dto.branchId }, select: { admissionId: true } });
        for (const admissionId of [...new Set(stays.flatMap((charge) => charge.admissionId ? [charge.admissionId] : []))].sort()) {
          await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${admissionId} AND "clinicId" = ${clinicId} FOR UPDATE`;
        }
      }
      for (const [index, plan] of [...plans.entries()].sort((a, b) => (a[1].chargeItemId ?? '').localeCompare(b[1].chargeItemId ?? ''))) {
        if (!plan.chargeItemId) continue;
        const snapshot = await tx.chargeItem.findFirst({ where: { id: plan.chargeItemId, patientId: dto.patientId, branchId: dto.branchId } });
        if (snapshot?.surgeryId) {
          // Surgery remuneration is paid once through its dedicated expense,
          // never accrued a second time by the monthly invoice-line payroll.
          const surgery = await tx.surgeryCase.findFirstOrThrow({ where: { id: snapshot.surgeryId }, select: { surgeonUserId: true, serviceChargeId: true } });
          plan.performerUserId = surgery.serviceChargeId === snapshot.id ? surgery.surgeonUserId : null;
          plan.title = snapshot.title as Prisma.InputJsonValue;
          if (!plan.discount.eq(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiya xarajatiga bu yerda chegirma qo‘llanmaydi', 400);
        }
        const claimed = await tx.chargeItem.updateMany({
          where: {
            id: plan.chargeItemId, patientId: dto.patientId, branchId: dto.branchId,
            status: 'PENDING', invoiceLineId: null,
            quantity: plan.quantity, unitPrice: plan.unitPrice,
            serviceId: plan.serviceId,
          },
          data: { status: 'INVOICED', invoiceLineId: lineIds[index] },
        });
        if (claimed.count !== 1) {
          throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Xarajat allaqachon hisobga kiritilgan yoki bemor/filial/summa mos emas', 409);
        }
      }
      const created = await tx.invoice.create({
        data: {
          clinicId, branchId: dto.branchId, number, patientId: dto.patientId,
          requestKey: opts.requestKey, requestFingerprint: opts.requestFingerprint,
          visitId: dto.visitId ?? null,
          status: opts.issueImmediately ? (total.eq(0) ? 'PAID' : 'ISSUED') : 'DRAFT',
          issuedAt: opts.issueImmediately ? new Date() : null,
          subtotal, discountTotal, total, createdById: user.id,
          lines: { create: plans.map((p, index) => ({
            id: lineIds[index], clinicId, serviceId: p.serviceId, title: p.title,
            quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount,
            lineTotal: p.lineTotal, performerUserId: p.performerUserId,
          })) },
        },
        include: { lines: true },
      });
      if (opts.issueImmediately) await this.lab.prepareOrderForInvoice(tx, created, created.lines);
      return created;
    }).catch(async (error: unknown) => {
      if (opts.requestKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.db.invoice.findFirst({ where: { requestKey: opts.requestKey }, include: { lines: true } });
        if (existing) {
          if (existing.requestFingerprint !== opts.requestFingerprint) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa hisob uchun ishlatilgan', 409);
          replayed = true;
          return existing;
        }
      }
      throw error;
    });

    if (!replayed) await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Invoice',
      entityId: invoice.id,
      after: {
        number: invoice.number,
        patientId: invoice.patientId,
        visitId: invoice.visitId,
        total: invoice.total.toFixed(2),
        status: invoice.status,
      },
    });

    return { ...this.mapInvoice(invoice), lines: invoice.lines.map((l) => this.mapLine(l)), ...(opts.requestKey ? { replayed } : {}) };
  }

  /**
   * Front-desk one-shot sale (spec §M8): create → issue → settle in a single
   * call. `PAY_NOW` pays the whole invoice with the given method (an open
   * cashier shift is required for CASH — enforced by `addPayment`); `DEBT`
   * leaves it ISSUED so it shows up under the patient's debt and in the
   * debtors list. If the payment leg fails the invoice stays ISSUED, i.e. it
   * degrades into exactly the DEBT outcome rather than a stuck DRAFT.
   */
  async quick(dto: QuickInvoiceInput, user: AuthUser): Promise<Record<string, unknown>> {
    if (user.branchIds.length > 0 && !user.branchIds.includes(dto.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    if (dto.settle === 'PAY_NOW' && !user.permissions.includes('payments.create')) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'payments.create permission is required to settle an invoice immediately',
        403,
      );
    }

    const fingerprint = createHash('sha256').update(JSON.stringify({
      patientId: dto.patientId, branchId: dto.branchId, visitId: dto.visitId ?? null,
      settle: dto.settle,
      lines: dto.lines.map((line) => ({
        serviceId: line.serviceId ?? null, title: line.title ?? null, quantity: line.quantity,
        unitPrice: new Prisma.Decimal(line.unitPrice).toFixed(2), discount: new Prisma.Decimal(line.discount ?? '0').toFixed(2),
        performerUserId: line.performerUserId ?? null, chargeItemId: line.chargeItemId ?? null,
      })),
      payments: (dto.payments ?? []).map((part) => ({
        method: part.method, amount: new Prisma.Decimal(part.amount).toFixed(2),
        // Omit empty notes to retain request identities made before notes existed.
        ...(paymentNote(part.note) ? { note: paymentNote(part.note) } : {}),
      })),
    })).digest('hex');
    const existing = dto.idempotencyKey ? await this.prisma.db.invoice.findFirst({
      where: { requestKey: dto.idempotencyKey }, include: { lines: true },
    }) : null;
    if (existing && existing.requestFingerprint !== fingerprint) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa hisob uchun ishlatilgan', 409);
    }
    const created = existing
      ? { ...this.mapInvoice(existing), lines: existing.lines.map((line) => this.mapLine(line)), replayed: true }
      : await this.create({ patientId: dto.patientId, branchId: dto.branchId, visitId: dto.visitId, lines: dto.lines }, user, {
        issueImmediately: true, requestKey: dto.idempotencyKey, requestFingerprint: dto.idempotencyKey ? fingerprint : undefined,
      });
    const invoiceId = created.id as string;
    const issued = created;

    // Clinical lab orders and their invoice are prepared in one transaction.
    // The laboratory worklist admits the order only after full settlement.
    const labOrder = await this.prisma.db.labOrder.findFirst({
      where: { invoiceId }, select: { id: true, orderNumber: true },
    });

    if (
      dto.settle === 'DEBT' ||
      dto.payments === undefined ||
      dto.payments.length === 0 ||
      dto.idempotencyKey === undefined
    ) {
      return { invoice: issued, lines: created.lines, paid: issued.status === 'PAID', labOrder };
    }

    const settled = await this.addPayments(
      invoiceId,
      dto.payments,
      dto.idempotencyKey,
      user,
      // A sale settled at the front desk is paid in full or it is not "pay now";
      // anything less belongs on the patient's account as debt instead.
      { requireFull: true },
    );
    return { ...settled, lines: created.lines, paid: true, labOrder };
  }

  /**
   * Settles an invoice with one or more payment legs — 100 000 by Click plus
   * 30 000 in cash against the same bill.
   *
   * Every leg is validated against the invoice BEFORE any of them is written.
   * Applying them one at a time and discovering on the third that the cash
   * drawer is closed would leave the invoice half-paid and the cashier holding
   * money the system has not recorded, so the whole split is checked first and
   * only then applied.
   */
  async addPayments(
    invoiceId: string,
    parts: PaymentPart[],
    baseKey: string,
    user: AuthUser,
    opts: { requireFull?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    return this.applyManualPayments(invoiceId, parts.map((part, index) => ({ ...part, idempotencyKey: legKey(baseKey, index) })), user, opts.requireFull ?? false);
  }

  /**
   * Reverses a payment that should never have been recorded — a mistyped amount,
   * the wrong method, the wrong patient.
   *
   * Not a refund. A refund means money went back to the patient and both legs
   * belong in the books; a void says the money was never taken in the first
   * place, so the invoice must look exactly as it did beforehand. The row is
   * kept rather than deleted: whoever made the mistake stops seeing it, and the
   * clinic's own management still does, because a takings figure that quietly
   * changed with nothing to show for it is worse than the mistake.
   */
  async voidPayment(
    paymentId: string,
    reason: string | undefined,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const initial = await this.prisma.db.payment.findFirst({ where: { id: paymentId } });
    if (!initial) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found', 404);
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${initial.invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const payment = await tx.payment.findFirst({ where: { id: paymentId } });
      const invoice = await tx.invoice.findFirst({ where: { id: initial.invoiceId } });
      if (!payment || !invoice) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found', 404);
      if (user.branchIds.length > 0 && !user.branchIds.includes(invoice.branchId)) throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
      if (payment.status === 'VOIDED') return { payment, invoice, replay: true };
      if (payment.status !== 'COMPLETED') throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Only completed payments can be voided', 409);
      if (payment.shiftId) await lockOpenShift(tx, payment.shiftId, true);
      const refunded = await tx.refund.count({ where: { invoiceId: invoice.id } });
      if (refunded > 0) throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Refunded invoice payments cannot be voided', 409);
      if (payment.method === 'BALANCE') {
        await tx.patient.update({ where: { id: invoice.patientId }, data: { balance: { increment: payment.amount } } });
        await tx.patientBalanceTransaction.create({ data: {
          clinicId, patientId: invoice.patientId, type: 'ADJUSTMENT', amount: payment.amount,
          invoiceId: invoice.id, note: `Voided payment on invoice ${invoice.number}`, createdById: user.id,
        } });
      }
      await tx.payment.update({ where: { id: payment.id }, data: {
        status: 'VOIDED', voidedAt: new Date(), voidedById: user.id,
        voidReason: reason ?? null,
        // Keep the key consumed. Replaying an old request must never recreate
        // money that the cashier explicitly reversed.
      } });
      const paidTotal = invoice.paidTotal.sub(payment.amount);
      await tx.invoice.update({ where: { id: invoice.id }, data: { paidTotal, status: paidTotal.lte(0) ? 'ISSUED' : 'PARTIALLY_PAID' } });
      return { payment, invoice, replay: false };
    });
    if (!result.replay) await this.audit.log({
      action: AuditAction.UPDATE, entity: 'Payment', entityId: paymentId,
      before: { status: result.payment.status, amount: result.payment.amount.toFixed(2), method: result.payment.method },
      after: { status: 'VOIDED', reason: reason ?? null, invoice: result.invoice.number },
    });
    return this.paymentResponse(paymentId);
  }

  async list(q: InvoiceQueryInput): Promise<PaginatedResult<Record<string, unknown>>> {
    const where: Prisma.InvoiceWhereInput = {
      ...(q.pending ? { status: { in: ['ISSUED', 'PARTIALLY_PAID'] as Array<'ISSUED' | 'PARTIALLY_PAID'> }, total: { gt: this.prisma.db.invoice.fields.paidTotal } } : q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [
        { number: { contains: q.search, mode: 'insensitive' as const } },
        { patient: { fullName: { contains: q.search, mode: 'insensitive' as const } } },
        { patient: { mrn: { contains: q.search, mode: 'insensitive' as const } } },
        { patient: { phone: { contains: q.search } } },
      ] } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
        include: { patient: { select: { id: true, mrn: true, fullName: true, phone: true } }, lines: { select: { id: true, title: true, quantity: true, lineTotal: true } } },
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...this.mapInvoice(r), patient: r.patient, lines: r.lines.map((line) => ({ ...line, lineTotal: line.lineTotal.toFixed(2) })) })),
      { page: q.page, limit: q.limit, total },
    );
  }

  async getById(id: string, user?: AuthUser): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.db.invoice.findFirst({
      where: { id },
      include: {
        lines: true,
        payments: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' } },
        patient: { select: { id: true, mrn: true, fullName: true, phone: true } },
      },
    });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    return {
      ...this.mapInvoice(invoice),
      patient: invoice.patient,
      lines: invoice.lines.map((l) => this.mapLine(l)),
      // A voided payment stays on the record for the clinic's own management and
      // disappears for the desk that entered it — the correction has to be
      // traceable by someone, or an unexplained change in the day's takings is
      // all that is left of it.
      payments: invoice.payments
        .filter((p) => p.status !== 'VOIDED' || canSeeDeleted(user))
        .map((p) => this.mapPayment(p)),
      refunds: invoice.refunds.map((r) => this.mapRefund(r)),
    };
  }

  async issue(id: string): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.db.invoice.findFirst({ where: { id } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    if (invoice.status !== 'DRAFT') {
      throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Only DRAFT invoices can be issued', 409);
    }
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const changed = await tx.invoice.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: invoice.total.eq(0) ? 'PAID' : 'ISSUED', issuedAt: new Date() },
      });
      if (changed.count !== 1) throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Invoice state changed', 409);
      const fresh = await tx.invoice.findFirstOrThrow({ where: { id }, include: { lines: true } });
      await this.lab.prepareOrderForInvoice(tx, fresh, fresh.lines);
      return fresh;
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Invoice',
      entityId: id,
      before: { status: invoice.status },
      after: { status: updated.status },
    });
    return this.mapInvoice(updated);
  }

  async cancel(id: string): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    const { before, updated } = await this.prisma.db.$transaction(async (tx) => {
      const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id }, select: { id: true } });
      const lineIds = lines.map((line) => line.id);
      const charges = lineIds.length ? await tx.chargeItem.findMany({ where: { invoiceLineId: { in: lineIds } }, select: { id: true, admissionId: true } }) : [];
      // Same order as discharge and billing: Admission -> ChargeItem -> Invoice.
      for (const admissionId of [...new Set(charges.flatMap((charge) => charge.admissionId ? [charge.admissionId] : []))].sort()) {
        await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${admissionId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      }
      for (const chargeId of charges.map((charge) => charge.id).sort()) {
        await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${chargeId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id } });
      if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
      const payments = await tx.payment.count({ where: { invoiceId: id, status: { not: 'VOIDED' } } });
      if (payments > 0 || (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED')) {
        throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Invoice cannot be cancelled in this state', 409);
      }
      const updated = await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      // Settlement and laboratory mutations share Invoice -> LabOrder lock order.
      await tx.labOrder.updateMany({ where: { invoiceId: id, status: { in: ['ORDERED', 'SPECIMEN_COLLECTED'] } }, data: { status: 'CANCELLED' } });
      if (lines.length) await tx.chargeItem.updateMany({ where: { invoiceLineId: { in: lines.map((l) => l.id) } }, data: { status: 'PENDING', invoiceLineId: null } });
      return { before: invoice.status, updated };
    });
    await this.audit.log({ action: AuditAction.UPDATE, entity: 'Invoice', entityId: id, before: { status: before }, after: { status: 'CANCELLED' } });
    return this.mapInvoice(updated);
  }

  // ============================================================ payments

  private async paymentResponse(paymentId: string): Promise<Record<string, unknown>> {
    const payment = await this.prisma.db.payment.findFirst({ where: { id: paymentId } });
    if (!payment) throw new AppException(ErrorCode.PAYMENT_FAILED, 'Payment not found after write', 500);
    const invoice = await this.prisma.db.invoice.findFirst({ where: { id: payment.invoiceId } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    return { payment: this.mapPayment(payment), invoice: this.mapInvoice(invoice) };
  }

  /** Emit realtime + notification + audit side effects after money is applied. */
  async afterPaymentApplied(
    invoice: Invoice,
    payment: Payment,
    newPaidTotal: Prisma.Decimal,
  ): Promise<void> {
    const clinicId = invoice.clinicId;
    this.events.toClinic(clinicId, 'invoice.paid', {
      invoiceId: invoice.id,
      amount: payment.amount.toFixed(2),
      branchId: invoice.branchId,
    });
    // prisma.unscoped justified: Clinic is not tenant-auto-scoped; own row only.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    try {
      await this.notifications.enqueueEvent({
        event: NotificationEvent.PAYMENT_RECEIPT,
        clinicId,
        patientId: invoice.patientId,
        vars: {
          amount: payment.amount.toFixed(2),
          invoice_number: invoice.number,
          clinic_name: clinic?.name ?? '',
        },
      });
    } catch (err) {
      this.logger.error(`payment receipt notification failed: ${(err as Error).message}`);
    }
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Payment',
      entityId: payment.id,
      after: {
        invoiceId: invoice.id,
        amount: payment.amount.toFixed(2),
        method: payment.method,
        note: payment.note,
        status: payment.status,
      },
    });
    if (newPaidTotal.gte(invoice.total)) {
      // Fire-and-forget stub; a real OFD provider may retry via its own queue.
      this.fiscalization.registerReceipt(invoice.id).catch((err: unknown) => {
        this.logger.error(`fiscalization failed for invoice ${invoice.id}: ${(err as Error).message}`);
      });
    }
  }

  async addPayment(invoiceId: string, dto: AddPaymentInput, user: AuthUser): Promise<Record<string, unknown>> {
    return this.applyManualPayments(invoiceId, [dto], user, false);
  }

  /** The full split, balance debit and invoice total commit together. */
  private async applyManualPayments(
    invoiceId: string,
    parts: AddPaymentInput[],
    user: AuthUser,
    requireFull: boolean,
  ): Promise<Record<string, unknown>> {
    if (!user.permissions.includes('payments.create')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Payment permission required', 403);
    }
    if (!parts.length) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Payment required', 400);
    for (const part of parts) {
      assertManualMethod(part.method, this.config.env.SINGLE_CLINIC_MODE, true);
      if (new Prisma.Decimal(part.amount).lte(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);
    }
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      // Raw SQL must scope explicitly; every competing settlement/refund/void
      // takes this invoice lock before checking its financial state.
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId } });
      if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
      if (user.branchIds.length > 0 && !user.branchIds.includes(invoice.branchId)) {
        throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
      }
      const existing = await tx.payment.findMany({ where: { idempotencyKey: { in: parts.map((part) => part.idempotencyKey) } } });
      if (existing.length > 0) {
        if (existing.length !== parts.length || parts.some((part) => !existing.some((payment) =>
          payment.idempotencyKey === part.idempotencyKey && payment.invoiceId === invoiceId &&
          payment.method === part.method && payment.amount.eq(part.amount) &&
          paymentNote(payment.note) === paymentNote(part.note) && payment.status === 'COMPLETED'))) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Idempotency key already belongs to a different payment', 409);
        }
        return { invoice, payments: existing, replay: true };
      }
      if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
        throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Payments require an issued invoice', 409);
      }
      const sum = parts.reduce((total, part) => total.add(part.amount), new Prisma.Decimal(0));
      const due = invoice.total.sub(invoice.paidTotal);
      if (sum.gt(due)) throw new AppException(ErrorCode.PAYMENT_EXCEEDS_DUE, 'Payment exceeds invoice due', 422, [{ due: due.toFixed(2) }]);
      if (requireFull && !sum.eq(due)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Payment must settle the full invoice', 400);
      const external = parts.filter((part) => part.method !== 'BALANCE');
      const shift = external.length ? await tx.cashierShift.findFirst({ where: { branchId: invoice.branchId, status: 'OPEN' } }) : null;
      const shiftId = external.length ? await lockOpenShift(tx, shift?.id ?? null, this.config.env.SINGLE_CLINIC_MODE || external.some((part) => part.method === 'CASH')) : null;
      const balanceAmount = parts.filter((part) => part.method === 'BALANCE').reduce((total, part) => total.add(part.amount), new Prisma.Decimal(0));
      if (balanceAmount.gt(0)) {
        const changed = await tx.patient.updateMany({ where: { id: invoice.patientId, balance: { gte: balanceAmount } }, data: { balance: { decrement: balanceAmount } } });
        if (changed.count !== 1) throw new AppException(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient patient balance', 422);
        await tx.patientBalanceTransaction.create({ data: {
          clinicId, patientId: invoice.patientId, type: 'INVOICE_APPLY', amount: balanceAmount.neg(),
          invoiceId, note: `Applied to invoice ${invoice.number}`, createdById: user.id,
        } });
      }
      const payments: Payment[] = [];
      for (const part of parts) {
        payments.push(await tx.payment.create({ data: {
          clinicId, branchId: invoice.branchId, invoiceId, amount: new Prisma.Decimal(part.amount),
          method: part.method, status: 'COMPLETED', shiftId: part.method === 'BALANCE' ? null : shiftId,
          note: paymentNote(part.note),
          idempotencyKey: part.idempotencyKey, receivedById: user.id,
        } }));
      }
      const paidTotal = invoice.paidTotal.add(sum);
      await tx.invoice.update({ where: { id: invoiceId }, data: { paidTotal, status: paidTotal.gte(invoice.total) ? 'PAID' : 'PARTIALLY_PAID' } });
      return { invoice, payments, replay: false };
    });
    if (!result.replay) {
      let paidTotal = result.invoice.paidTotal;
      for (const payment of result.payments) {
        paidTotal = paidTotal.add(payment.amount);
        await this.afterPaymentApplied(result.invoice, payment, paidTotal);
      }
    }
    return this.paymentResponse(result.payments[result.payments.length - 1]!.id);
  }

  // ============================================================ refunds

  async addRefund(invoiceId: string, dto: CreateRefundInput, user: AuthUser): Promise<Record<string, unknown>> {
    assertManualMethod(dto.method, this.config.env.SINGLE_CLINIC_MODE, true);
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);
    const clinicId = TenantContext.requireClinicId();
    const { invoice, refund } = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId } });
      if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
      if (user.branchIds.length > 0 && !user.branchIds.includes(invoice.branchId)) throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
      const aggregate = await tx.refund.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      const refunded = aggregate._sum.amount ?? new Prisma.Decimal(0);
      if (refunded.add(amount).gt(invoice.paidTotal)) throw new AppException(ErrorCode.REFUND_EXCEEDS_PAID, 'Refund exceeds paid total', 422);
      const shift = dto.method === 'BALANCE' ? null : await tx.cashierShift.findFirst({ where: { branchId: invoice.branchId, status: 'OPEN' } });
      const shiftId = dto.method === 'BALANCE' ? null : await lockOpenShift(tx, shift?.id ?? null, this.config.env.SINGLE_CLINIC_MODE || dto.method === 'CASH');
      const refund = await tx.refund.create({ data: { clinicId, invoiceId, amount, method: dto.method, reason: dto.reason, shiftId, createdById: user.id } });
      if (dto.method === 'BALANCE') {
        await tx.patient.update({ where: { id: invoice.patientId }, data: { balance: { increment: amount } } });
        await tx.patientBalanceTransaction.create({ data: { clinicId, patientId: invoice.patientId, type: 'REFUND_CREDIT', amount, invoiceId, note: `Refund to balance on invoice ${invoice.number}`, createdById: user.id } });
      }
      if (refunded.add(amount).eq(invoice.paidTotal)) await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'REFUNDED' } });
      return { invoice, refund };
    });
    await this.audit.log({ action: AuditAction.REFUND, entity: 'Refund', entityId: refund.id, after: { invoiceId, amount: amount.toFixed(2), method: dto.method, reason: dto.reason, shiftId: refund.shiftId } });
    const fresh = await this.prisma.db.invoice.findFirst({ where: { id: invoiceId } });
    return { refund: this.mapRefund(refund), invoice: this.mapInvoice(fresh ?? invoice) };
  }

  // ============================================================ receipt

  /** JSON payload for the 80mm thermal receipt template (frontend renders/prints). */
  async receipt(id: string): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    const invoice = await this.prisma.db.invoice.findFirst({
      where: { id },
      include: {
        lines: true,
        payments: { where: { status: 'COMPLETED' }, orderBy: { paidAt: 'asc' } },
        patient: { select: { id: true, mrn: true, fullName: true } },
      },
    });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    // prisma.unscoped justified: clinic letterhead — Clinic is not tenant-auto-scoped,
    // we read only the current tenant's own row via the context clinicId.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: {
        name: true,
        legalName: true,
        taxId: true,
        logoUrl: true,
        phone: true,
        address: true,
        settings: true,
      },
    });
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: invoice.branchId },
      select: { name: true, address: true, phone: true },
    });
    // Receipt template customization lives under Clinic.settings.receipt.
    const settings =
      clinic && typeof clinic.settings === 'object' && clinic.settings !== null
        ? (clinic.settings as Record<string, unknown>)
        : {};
    const receiptSettings =
      typeof settings.receipt === 'object' && settings.receipt !== null ? settings.receipt : {};
    const clinicLetterhead = clinic
      ? {
          name: clinic.name,
          legalName: clinic.legalName,
          taxId: clinic.taxId,
          logoUrl: clinic.logoUrl,
          phone: clinic.phone,
          address: clinic.address,
        }
      : null;
    return {
      clinic: clinicLetterhead,
      branch: branch ?? null,
      receipt: receiptSettings,
      invoice: this.mapInvoice(invoice),
      patient: invoice.patient,
      lines: invoice.lines.map((l) => this.mapLine(l)),
      payments: invoice.payments.map((p) => this.mapPayment(p)),
      totals: {
        subtotal: invoice.subtotal.toFixed(2),
        discountTotal: invoice.discountTotal.toFixed(2),
        total: invoice.total.toFixed(2),
        paidTotal: invoice.paidTotal.toFixed(2),
        due: invoice.total.sub(invoice.paidTotal).toFixed(2),
      },
      printedAt: new Date().toISOString(),
    };
  }

  // ============================================================ provider webhooks
  // Webhooks arrive pre-tenant (no auth context): invoices/payments are located
  // via prisma.unscoped by their provider-facing keys, then all writes run inside
  // TenantContext.run({ clinicId }) of the located row (spec §M8) — justified.

  private providerView(p: Payment): ProviderPaymentView {
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      amount: p.amount.toFixed(2),
      state: providerState(p.status),
      createTime: p.createdAt.getTime(),
      performTime: p.status === 'COMPLETED' || p.status === 'REFUNDED' ? p.paidAt.getTime() : 0,
    };
  }

  /** CheckPerformTransaction / pre-create validation. */
  async providerCheckInvoice(
    invoiceNumber: string,
    amount: string,
  ): Promise<{ ok: true } | { ok: false; error: ProviderTxError }> {
    // prisma.unscoped justified: pre-tenant webhook lookup by invoice number.
    const invoice = await this.prisma.unscoped.invoice.findFirst({ where: { number: invoiceNumber } });
    if (!invoice) return { ok: false, error: 'invoice_not_found' };
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      return { ok: false, error: 'invalid_state' };
    }
    let dec: Prisma.Decimal;
    try {
      dec = new Prisma.Decimal(amount);
    } catch {
      return { ok: false, error: 'wrong_amount' };
    }
    if (dec.lte(0) || dec.gt(invoice.total.sub(invoice.paidTotal))) {
      return { ok: false, error: 'wrong_amount' };
    }
    return { ok: true };
  }

  /** Payme CreateTransaction / Click prepare — idempotent on providerTxId. */
  async providerCreateTransaction(i: {
    method: 'PAYME' | 'CLICK' | 'UZUM';
    providerTxId: string;
    invoiceNumber: string;
    amount: string;
  }): Promise<ProviderTxResult> {
    if (i.providerTxId === '') return { ok: false, error: 'tx_not_found' };
    // prisma.unscoped justified: pre-tenant webhook idempotency lookup by providerTxId.
    const existing = await this.prisma.unscoped.payment.findFirst({
      where: { providerTxId: i.providerTxId, method: i.method },
    });
    if (existing) return { ok: true, payment: this.providerView(existing) };

    // prisma.unscoped justified: pre-tenant webhook lookup by invoice number.
    const invoice = await this.prisma.unscoped.invoice.findFirst({ where: { number: i.invoiceNumber } });
    if (!invoice) return { ok: false, error: 'invoice_not_found' };
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      return { ok: false, error: 'invalid_state' };
    }
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(i.amount);
    } catch {
      return { ok: false, error: 'wrong_amount' };
    }
    if (amount.lte(0) || amount.gt(invoice.total.sub(invoice.paidTotal))) {
      return { ok: false, error: 'wrong_amount' };
    }

    const payment = await TenantContext.run({ clinicId: invoice.clinicId }, () =>
      this.prisma.db.payment.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: invoice.clinicId,
          branchId: invoice.branchId,
          invoiceId: invoice.id,
          amount,
          method: i.method,
          status: 'PENDING',
          providerTxId: i.providerTxId,
        },
      }),
    );
    return { ok: true, payment: this.providerView(payment) };
  }

  /** Payme PerformTransaction / Click complete — idempotent on providerTxId. */
  async providerPerformTransaction(i: {
    method: 'PAYME' | 'CLICK' | 'UZUM';
    providerTxId: string;
  }): Promise<ProviderTxResult> {
    // prisma.unscoped justified: pre-tenant webhook lookup by providerTxId.
    const payment = await this.prisma.unscoped.payment.findFirst({
      where: { providerTxId: i.providerTxId, method: i.method },
    });
    if (!payment) return { ok: false, error: 'tx_not_found' };
    if (payment.status === 'COMPLETED') return { ok: true, payment: this.providerView(payment) };
    if (payment.status !== 'PENDING') return { ok: false, error: 'cannot_perform' };

    return TenantContext.run({ clinicId: payment.clinicId }, async () => {
      const invoice = await this.prisma.db.invoice.findFirst({ where: { id: payment.invoiceId } });
      if (!invoice || (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID')) {
        return { ok: false as const, error: 'cannot_perform' as const };
      }
      if (payment.amount.gt(invoice.total.sub(invoice.paidTotal))) {
        return { ok: false as const, error: 'cannot_perform' as const };
      }
      const newPaidTotal = invoice.paidTotal.add(payment.amount);
      const newStatus = newPaidTotal.gte(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';
      const updated = await this.prisma.db.$transaction(async (tx) => {
        const perf = await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED', paidAt: new Date() },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidTotal: newPaidTotal, status: newStatus },
        });
        return perf;
      });
      await this.afterPaymentApplied(invoice, updated, newPaidTotal);
      return { ok: true as const, payment: this.providerView(updated) };
    });
  }

  /** Payme CancelTransaction / Click error rollback. */
  async providerCancelTransaction(i: {
    method: 'PAYME' | 'CLICK' | 'UZUM';
    providerTxId: string;
    reason?: string;
  }): Promise<ProviderTxResult> {
    // prisma.unscoped justified: pre-tenant webhook lookup by providerTxId.
    const payment = await this.prisma.unscoped.payment.findFirst({
      where: { providerTxId: i.providerTxId, method: i.method },
    });
    if (!payment) return { ok: false, error: 'tx_not_found' };
    if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
      return { ok: true, payment: this.providerView(payment) };
    }

    return TenantContext.run({ clinicId: payment.clinicId }, async () => {
      if (payment.status === 'PENDING') {
        const cancelled = await this.prisma.db.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
        return { ok: true as const, payment: this.providerView(cancelled) };
      }
      // COMPLETED → roll the money back off the invoice.
      const invoice = await this.prisma.db.invoice.findFirst({ where: { id: payment.invoiceId } });
      if (!invoice) return { ok: false as const, error: 'cannot_perform' as const };
      const newPaidTotal = invoice.paidTotal.sub(payment.amount);
      const newStatus = newPaidTotal.lte(0) ? 'ISSUED' : 'PARTIALLY_PAID';
      const cancelled = await this.prisma.db.$transaction(async (tx) => {
        const upd = await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED' },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidTotal: newPaidTotal.lt(0) ? new Prisma.Decimal(0) : newPaidTotal, status: newStatus },
        });
        return upd;
      });
      await this.audit.log({
        action: AuditAction.REFUND,
        entity: 'Payment',
        entityId: payment.id,
        after: {
          invoiceId: invoice.id,
          amount: payment.amount.toFixed(2),
          method: payment.method,
          reason: i.reason ?? 'provider cancellation',
        },
        clinicId: payment.clinicId,
      });
      return { ok: true as const, payment: this.providerView(cancelled) };
    });
  }

  /** Payme CheckTransaction. */
  async providerGetTransaction(i: {
    method: 'PAYME' | 'CLICK' | 'UZUM';
    providerTxId: string;
  }): Promise<ProviderTxResult> {
    // prisma.unscoped justified: pre-tenant webhook lookup by providerTxId.
    const payment = await this.prisma.unscoped.payment.findFirst({
      where: { providerTxId: i.providerTxId, method: i.method },
    });
    if (!payment) return { ok: false, error: 'tx_not_found' };
    return { ok: true, payment: this.providerView(payment) };
  }
}
