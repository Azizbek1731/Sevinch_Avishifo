import { createHash } from 'node:crypto';
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
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
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


/**
 * Re-checks, INSIDE the writer's transaction, that the register a money row is
 * about to join is still open — and takes a share lock on it so a concurrent
 * close() waits for this write to commit and therefore counts it.
 *
 * Returns the shiftId to write: unchanged when the register is live, null when
 * it closed mid-request and the method may float free (transfer methods),
 * throwing for CASH, which must never be booked into a counted-out drawer.
 */
async function reverifyShift(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  shiftId: string | null,
  method: string,
): Promise<string | null> {
  if (!shiftId) return null;
  const rows = (await tx.$queryRaw`
    SELECT "id" FROM "CashierShift" WHERE "id" = ${shiftId} AND "status" = 'OPEN' FOR SHARE
  `) as unknown[];
  if (rows.length > 0) return shiftId;
  if (method === 'CASH') {
    throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Kassa hozirgina yopildi — smenani qayta oching', 409);
  }
  return null;
}

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

  async create(dto: CreateInvoiceInput, user: AuthUser): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();

    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    let visit: { id: string; doctorUserId: string; serviceIds: string[]; titles: Map<string, Prisma.JsonValue> } | null =
      null;
    if (dto.visitId) {
      const row = await this.prisma.db.visit.findFirst({
        where: { id: dto.visitId, patientId: dto.patientId },
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
              select: { id: true, name: true },
            })
          : [];
      const serviceById = new Map(services.map((s) => [s.id, s]));
      for (const l of dto.lines) {
        const svc = l.serviceId ? serviceById.get(l.serviceId) : undefined;
        if (l.serviceId && !svc) {
          throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404, [{ serviceId: l.serviceId }]);
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
    const invoice = await this.prisma.db.invoice.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId,
        branchId: dto.branchId,
        number,
        patientId: dto.patientId,
        visitId: dto.visitId ?? null,
        status: 'DRAFT',
        subtotal,
        discountTotal,
        total,
        createdById: user.id,
        lines: {
          create: plans.map((p) => ({
            // Nested creates are NOT auto-stamped by the tenant extension.
            clinicId,
            serviceId: p.serviceId,
            title: p.title,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            discount: p.discount,
            lineTotal: p.lineTotal,
            performerUserId: p.performerUserId,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
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

    return { ...this.mapInvoice(invoice), lines: invoice.lines.map((l) => this.mapLine(l)) };
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
    if (dto.settle === 'PAY_NOW' && !user.permissions.includes('payments.create')) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'payments.create permission is required to settle an invoice immediately',
        403,
      );
    }

    const created = await this.create(
      {
        patientId: dto.patientId,
        branchId: dto.branchId,
        visitId: dto.visitId,
        lines: dto.lines,
      },
      user,
    );
    const invoiceId = created.id as string;
    const issued = await this.issue(invoiceId);

    // Selling a lab service IS the lab referral: any invoice line whose service
    // carries a linked lab test lands on the laboratory worklist as one order.
    // Failure here must not kill the sale — the money is already right, and the
    // desk can still order the test by hand — so it degrades to a logged error.
    let labOrder: { id: string; orderNumber: string } | null = null;
    try {
      const serviceIds = [
        ...new Set(
          (created.lines as Array<{ serviceId: string | null }>)
            .map((l) => l.serviceId)
            .filter((id): id is string => id !== null),
        ),
      ];
      if (serviceIds.length > 0) {
        const labTests = await this.prisma.db.labTest.findMany({
          where: { serviceId: { in: serviceIds }, isActive: true },
          select: { id: true },
        });
        if (labTests.length > 0) {
          labOrder = await this.lab.createOrderFromReferral({
            patientId: dto.patientId,
            branchId: dto.branchId,
            visitId: dto.visitId,
            testIds: labTests.map((t) => t.id),
            orderedById: user.id,
          });
        }
      }
    } catch (err: unknown) {
      this.logger.error(`quick invoice lab order failed: ${String(err)}`);
    }

    if (
      dto.settle === 'DEBT' ||
      dto.payments === undefined ||
      dto.payments.length === 0 ||
      dto.idempotencyKey === undefined
    ) {
      return { invoice: issued, lines: created.lines, paid: false, labOrder };
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
    const invoice = await this.prisma.db.invoice.findFirst({ where: { id: invoiceId } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);

    const due = invoice.total.sub(invoice.paidTotal);
    let sum = new Prisma.Decimal(0);
    for (const part of parts) {
      const amount = new Prisma.Decimal(part.amount);
      if (amount.lte(0)) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Har bir to‘lov qismi noldan katta bo‘lishi kerak',
          400,
        );
      }
      sum = sum.add(amount);
    }

    if (sum.gt(due)) {
      throw new AppException(
        ErrorCode.PAYMENT_EXCEEDS_DUE,
        'To‘lovlar yig‘indisi hisob summasidan ko‘p',
        422,
        [{ due: due.toFixed(2), given: sum.toFixed(2) }],
      );
    }
    if (opts.requireFull && !sum.eq(due)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'To‘lovlar yig‘indisi hisob summasiga teng bo‘lishi kerak',
        400,
        [{ due: due.toFixed(2), given: sum.toFixed(2) }],
      );
    }

    // Cash needs an open drawer, and the check belongs here rather than only
    // inside the per-leg call: a split whose cash leg is last must fail before
    // its card leg has already been taken.
    if (parts.some((p) => p.method === 'CASH')) {
      const shift = await this.prisma.db.cashierShift.findFirst({
        where: { branchId: invoice.branchId, status: 'OPEN' },
      });
      if (!shift) {
        throw new AppException(
          ErrorCode.SHIFT_NOT_OPEN,
          'Open cashier shift required for cash payments',
          409,
        );
      }
    }

    let last: Record<string, unknown> | null = null;
    for (const [i, part] of parts.entries()) {
      last = await this.addPayment(
        invoiceId,
        { amount: part.amount, method: part.method, idempotencyKey: legKey(baseKey, i) },
        user,
      );
    }
    return last as Record<string, unknown>;
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
    const payment = await this.prisma.db.payment.findFirst({ where: { id: paymentId } });
    if (!payment) throw new AppException(ErrorCode.NOT_FOUND, 'To‘lov topilmadi', 404);

    if (payment.status === 'VOIDED') {
      // Already done — most likely a double-click, so report the existing state
      // rather than reversing the invoice a second time.
      return this.paymentResponse(payment.id);
    }
    if (payment.status !== 'COMPLETED') {
      throw new AppException(
        ErrorCode.INVOICE_INVALID_STATE,
        'Faqat bajarilgan to‘lovni bekor qilish mumkin',
        409,
      );
    }

    const invoice = await this.prisma.db.invoice.findFirst({ where: { id: payment.invoiceId } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);

    // A shift that has been counted and signed off is history. Reversing a
    // payment inside it would silently move a closing figure somebody put their
    // name to — the same rule expenses already follow.
    if (payment.shiftId) {
      const shift = await this.prisma.db.cashierShift.findFirst({
        where: { id: payment.shiftId },
        select: { status: true },
      });
      if (shift && shift.status !== 'OPEN') {
        throw new AppException(
          ErrorCode.INVOICE_INVALID_STATE,
          'Bu to‘lov yopilgan smenaga tegishli — uni bekor qilib bo‘lmaydi',
          409,
        );
      }
    }

    // A refunded invoice has already had money move back out; unwinding the
    // original payment underneath that would leave the two records disagreeing.
    const refunded = await this.prisma.db.refund.count({ where: { invoiceId: invoice.id } });
    if (refunded > 0) {
      throw new AppException(
        ErrorCode.INVOICE_INVALID_STATE,
        'Bu hisob bo‘yicha qaytarish qilingan — to‘lovni bekor qilib bo‘lmaydi',
        409,
      );
    }

    const newPaidTotal = invoice.paidTotal.sub(payment.amount);
    // Back to what the invoice looked like before this payment landed.
    const newStatus = newPaidTotal.lte(0) ? 'ISSUED' : 'PARTIALLY_PAID';

    await this.prisma.db.$transaction(async (tx) => {
      if (payment.method === 'BALANCE') {
        // The money came off the patient's account, so it has to go back on.
        await tx.patient.update({
          where: { id: invoice.patientId },
          data: { balance: { increment: payment.amount } },
        });
        await tx.patientBalanceTransaction.create({
          data: {
            clinicId: invoice.clinicId,
            patientId: invoice.patientId,
            type: 'ADJUSTMENT',
            amount: payment.amount,
            invoiceId: invoice.id,
            note: `Voided payment on invoice ${invoice.number}`,
            createdById: user.id,
          },
        });
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason ?? null,
          // Freed so the same idempotency key can be used again by a corrected
          // re-entry, which is exactly what the cashier does next.
          idempotencyKey: null,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidTotal: newPaidTotal.lt(0) ? new Prisma.Decimal(0) : newPaidTotal, status: newStatus },
      });
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Payment',
      entityId: payment.id,
      clinicId: invoice.clinicId,
      before: { status: payment.status, amount: payment.amount.toFixed(2), method: payment.method },
      after: { status: 'VOIDED', reason: reason ?? null, invoice: invoice.number },
    });

    return this.paymentResponse(payment.id);
  }

  async list(q: InvoiceQueryInput): Promise<PaginatedResult<Record<string, unknown>>> {
    const where: Prisma.InvoiceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
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
        include: { patient: { select: { id: true, mrn: true, fullName: true, phone: true } } },
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...this.mapInvoice(r), patient: r.patient })),
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
    const updated = await this.prisma.db.invoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt: new Date() },
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
    const invoice = await this.prisma.db.invoice.findFirst({
      where: { id },
      include: { _count: { select: { payments: true } } },
    });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    if (invoice._count.payments > 0) {
      throw new AppException(
        ErrorCode.INVOICE_INVALID_STATE,
        'Invoice with payments cannot be cancelled — refund instead',
        409,
      );
    }
    if (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED') {
      throw new AppException(ErrorCode.INVOICE_INVALID_STATE, 'Invoice cannot be cancelled in this state', 409);
    }
    const updated = await this.prisma.db.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Invoice',
      entityId: id,
      before: { status: invoice.status },
      after: { status: 'CANCELLED' },
    });
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
  private async afterPaymentApplied(
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
    // Idempotency pre-check on (clinicId, idempotencyKey).
    const existing = await this.prisma.db.payment.findFirst({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return this.paymentResponse(existing.id);

    const invoice = await this.prisma.db.invoice.findFirst({ where: { id: invoiceId } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new AppException(
        ErrorCode.INVOICE_INVALID_STATE,
        'Payments are accepted only for ISSUED or PARTIALLY_PAID invoices',
        409,
      );
    }
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);
    const due = invoice.total.sub(invoice.paidTotal);
    if (amount.gt(due)) {
      throw new AppException(ErrorCode.PAYMENT_EXCEEDS_DUE, 'Payment exceeds the invoice due amount', 422, [
        { due: due.toFixed(2) },
      ]);
    }

    // Cash and card alike are linked to the drawer that took them. Until now
    // only cash carried this link, so the transfer register had to be
    // re-derived on every read from "whoever received money in this branch
    // inside the shift's window" — a guess that could disagree with itself.
    //
    // The requirement still differs by method, and deliberately: cash MUST have
    // an open drawer, because the notes have to physically go somewhere. Card
    // and online money lands in the bank whether or not anyone opened a shift,
    // so it is linked when a drawer exists and left unattached when none does.
    // BALANCE is never linked: no money moves now, it moved on deposit day.
    // A user pinned to specific branches settles only those branches' invoices;
    // an empty list still means every branch of the clinic.
    if (user.branchIds.length > 0 && !user.branchIds.includes(invoice.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }

    let shiftId: string | null = null;
    if (dto.method !== 'BALANCE') {
      const shift = await this.prisma.db.cashierShift.findFirst({
        where: { branchId: invoice.branchId, status: 'OPEN' },
      });
      if (!shift && dto.method === 'CASH') {
        throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Open cashier shift required for cash payments', 409);
      }
      shiftId = shift?.id ?? null;
    }

    const newPaidTotal = invoice.paidTotal.add(amount);
    const newStatus = newPaidTotal.gte(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';

    let payment: Payment;
    try {
      payment = await this.prisma.db.$transaction(async (tx) => {
        if (dto.method === 'BALANCE') {
          const patient = await tx.patient.findFirst({
            where: { id: invoice.patientId },
            select: { balance: true },
          });
          if (!patient || patient.balance.lt(amount)) {
            throw new AppException(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient patient balance', 422);
          }
          await tx.patient.update({
            where: { id: invoice.patientId },
            data: { balance: { decrement: amount } },
          });
          await tx.patientBalanceTransaction.create({
            // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
            data: {
              clinicId: invoice.clinicId,
              patientId: invoice.patientId,
              type: 'INVOICE_APPLY',
              amount: amount.neg(),
              invoiceId: invoice.id,
              note: `Applied to invoice ${invoice.number}`,
              createdById: user.id,
            },
          });
        }
        const liveShiftId = await reverifyShift(tx as never, shiftId, dto.method);
        const created = await tx.payment.create({
          // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
          data: {
            clinicId: invoice.clinicId,
            branchId: invoice.branchId,
            invoiceId: invoice.id,
            amount,
            method: dto.method,
            status: 'COMPLETED',
            shiftId: liveShiftId,
            idempotencyKey: dto.idempotencyKey,
            receivedById: user.id,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidTotal: newPaidTotal, status: newStatus },
        });
        return created;
      });
    } catch (err) {
      // Concurrent duplicate with the same idempotency key — return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.db.payment.findFirst({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (winner) return this.paymentResponse(winner.id);
      }
      throw err;
    }

    await this.afterPaymentApplied(invoice, payment, newPaidTotal);
    return this.paymentResponse(payment.id);
  }

  // ============================================================ refunds

  async addRefund(invoiceId: string, dto: CreateRefundInput, user: AuthUser): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.db.invoice.findFirst({ where: { id: invoiceId } });
    if (!invoice) throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Invoice not found', 404);

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);

    const agg = await this.prisma.db.refund.aggregate({
      where: { invoiceId },
      _sum: { amount: true },
    });
    const refundedSum = agg._sum.amount ?? new Prisma.Decimal(0);
    if (refundedSum.add(amount).gt(invoice.paidTotal)) {
      throw new AppException(ErrorCode.REFUND_EXCEEDS_PAID, 'Refund exceeds the paid total', 422, [
        { paidTotal: invoice.paidTotal.toFixed(2), alreadyRefunded: refundedSum.toFixed(2) },
      ]);
    }

    // Same rule as payments: a card refund nets off the acquirer's own slip, so
    // it has to reduce the same register the card payment increased.
    // A user pinned to specific branches settles only those branches' invoices;
    // an empty list still means every branch of the clinic.
    if (user.branchIds.length > 0 && !user.branchIds.includes(invoice.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }

    let shiftId: string | null = null;
    if (dto.method !== 'BALANCE') {
      const shift = await this.prisma.db.cashierShift.findFirst({
        where: { branchId: invoice.branchId, status: 'OPEN' },
      });
      if (!shift && dto.method === 'CASH') {
        throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Open cashier shift required for cash refunds', 409);
      }
      shiftId = shift?.id ?? null;
    }

    const fullyRefunded = refundedSum.add(amount).gte(invoice.paidTotal) && invoice.paidTotal.gt(0);
    const refund = await this.prisma.db.$transaction(async (tx) => {
      const liveShiftId = await reverifyShift(tx as never, shiftId, dto.method);
      const created = await tx.refund.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: invoice.clinicId,
          invoiceId: invoice.id,
          amount,
          method: dto.method,
          reason: dto.reason,
          shiftId: liveShiftId,
          createdById: user.id,
        },
      });
      if (fullyRefunded) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'REFUNDED' } });
      }
      return created;
    });

    await this.audit.log({
      action: AuditAction.REFUND,
      entity: 'Refund',
      entityId: refund.id,
      after: {
        invoiceId: invoice.id,
        amount: amount.toFixed(2),
        method: dto.method,
        reason: dto.reason,
      },
    });

    const fresh = await this.prisma.db.invoice.findFirst({ where: { id: invoice.id } });
    return {
      refund: this.mapRefund(refund),
      invoice: fresh ? this.mapInvoice(fresh) : this.mapInvoice(invoice),
    };
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
