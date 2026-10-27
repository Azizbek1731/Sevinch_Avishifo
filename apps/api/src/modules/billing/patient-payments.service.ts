import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  type AuthUser,
  type PatientCheckoutInput,
  type PatientPendingQueryInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AppConfigService } from '../../core/config/app-config.service';
import { assertManualMethod, lockOpenShift } from './cash-accounts';
import { InvoicesService } from './invoices.service';
import { RoomBillingService } from './room-billing.service';

const zero = () => new Prisma.Decimal(0);
const note = (value?: string | null) => value?.trim() || null;
interface PendingPatient {
  id: string;
  fullName: string;
  mrn: string;
  phone: string | null;
  invoiceCount: number;
  due: string;
  oldestAt: Date;
}
interface InvoiceSnapshot {
  id: string;
  number: string;
  total: string;
  paidBefore: string;
  amount: string;
  subtotal: string;
  discountTotal: string;
  lines: Array<{
    id: string;
    serviceId: string | null;
    title: Prisma.JsonValue;
    quantity: number;
    unitPrice: string;
    discount: string;
    lineTotal: string;
    performerUserId: string | null;
  }>;
}

@Injectable()
export class PatientPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly rooms: RoomBillingService,
    private readonly config: AppConfigService,
  ) {}

  private assertBranch(branchId: string, user: AuthUser) {
    if (user.branchIds.length && !user.branchIds.includes(branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
  }

  async pending(branchId: string, query: PatientPendingQueryInput, user: AuthUser) {
    this.assertBranch(branchId, user);
    await this.rooms.reconcileBranch(branchId);
    const clinicId = TenantContext.requireClinicId();
    const search = query.search?.trim();
    const pattern = `%${(search ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    const searchFilter = search
      ? Prisma.sql`AND (p."fullName" ILIKE ${pattern} OR p.mrn ILIKE ${pattern} OR p.phone ILIKE ${pattern} OR EXISTS (SELECT 1 FROM "Invoice" searched WHERE searched."clinicId" = ${clinicId} AND searched."branchId" = ${branchId} AND searched."patientId" = p.id AND searched.number ILIKE ${pattern}))`
      : Prisma.empty;
    const source = Prisma.sql`FROM "Invoice" i JOIN "Patient" p ON p.id = i."patientId" AND p."clinicId" = ${clinicId}
      WHERE i."clinicId" = ${clinicId} AND i."branchId" = ${branchId}
      AND i.status IN ('ISSUED', 'PARTIALLY_PAID') AND i.total > i."paidTotal" ${searchFilter}`;
    const [rows, count] = await Promise.all([
      this.prisma.db.$queryRaw<PendingPatient[]>(Prisma.sql`
        SELECT p.id, p."fullName", p.mrn, p.phone, COUNT(*)::int AS "invoiceCount",
          SUM(i.total - i."paidTotal")::text AS due, MIN(i."createdAt") AS "oldestAt"
        ${source} GROUP BY p.id ORDER BY MIN(i."createdAt"), p.id
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      this.prisma.db.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`SELECT COUNT(DISTINCT p.id)::int AS total ${source}`,
      ),
    ]);
    return paginated(
      rows.map((row) => ({
        ...row,
        due: new Prisma.Decimal(row.due).toFixed(2),
        oldestAt: row.oldestAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total: count[0]?.total ?? 0 },
    );
  }

  async outstanding(patientId: string, branchId: string, user: AuthUser) {
    this.assertBranch(branchId, user);
    await this.rooms.reconcilePatient(patientId, branchId);
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: patientId },
      select: { id: true, fullName: true, mrn: true, phone: true, balance: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    const rows = await this.prisma.db.invoice.findMany({
      where: {
        patientId,
        branchId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        total: { gt: this.prisma.db.invoice.fields.paidTotal },
      },
      include: { lines: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      patient: { ...patient, balance: patient.balance.toFixed(2) },
      invoices: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        total: row.total.toFixed(2),
        paidTotal: row.paidTotal.toFixed(2),
        due: row.total.sub(row.paidTotal).toFixed(2),
        createdAt: row.createdAt.toISOString(),
        lines: row.lines.map((line) => ({
          id: line.id,
          title: line.title,
          quantity: line.quantity,
          lineTotal: line.lineTotal.toFixed(2),
        })),
      })),
    };
  }

  async checkout(branchId: string, input: PatientCheckoutInput, user: AuthUser) {
    this.assertBranch(branchId, user);
    if (!user.permissions.includes('payments.create'))
      throw new AppException(ErrorCode.FORBIDDEN, 'Payment permission required', 403);
    const invoiceIds = [...input.invoiceIds].sort();
    if (
      !invoiceIds.length ||
      invoiceIds.length > 100 ||
      new Set(invoiceIds).size !== invoiceIds.length
    )
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Select distinct invoices', 400);
    for (const part of input.payments) {
      assertManualMethod(part.method, this.config.env.SINGLE_CLINIC_MODE, true);
      if (new Prisma.Decimal(part.amount).lte(0))
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);
    }
    const sum = input.payments.reduce((value, part) => value.add(part.amount), zero());
    if (sum.lte(0))
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);
    if (sum.gt('999999999999.99'))
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Selected total is too large; select fewer invoices',
        400,
      );
    if (!input.payments.length || !sum.eq(input.expectedTotal))
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Payment must match selected amount', 400);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          branchId,
          patientId: input.patientId,
          invoiceIds,
          total: new Prisma.Decimal(input.expectedTotal).toFixed(2),
          payments: input.payments.map((part) => ({
            method: part.method,
            amount: new Prisma.Decimal(part.amount).toFixed(2),
            note: note(part.note),
          })),
        }),
      )
      .digest('hex');
    await this.rooms.reconcilePatient(input.patientId, branchId);
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(
      async (tx) => {
        // Serialize retries before locking invoices. A reused key cannot pay a different selection.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${clinicId}:checkout:${input.idempotencyKey}`}, 0))`;
        const prior = await tx.paymentCheckout.findFirst({
          where: { requestKey: input.idempotencyKey },
        });
        if (prior) {
          if (prior.requestFingerprint !== fingerprint)
            throw new AppException(
              ErrorCode.VALIDATION_ERROR,
              'Payment request changed; refresh and try again',
              409,
            );
          return { checkoutId: prior.id, applied: [] };
        }
        // Same order for every multi-invoice settlement prevents deadlocks. Raw SQL is tenant-scoped.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE "clinicId" = ${clinicId} AND id IN (${Prisma.join(invoiceIds)}) ORDER BY id FOR UPDATE`,
        );
        const invoices = await tx.invoice.findMany({
          where: { id: { in: invoiceIds }, patientId: input.patientId, branchId },
          include: { lines: true },
          orderBy: { id: 'asc' },
        });
        if (invoices.length !== invoiceIds.length)
          throw new AppException(
            ErrorCode.INVOICE_NOT_FOUND,
            'Invoice does not belong to this patient and branch',
            404,
          );
        if (
          invoices.some(
            (invoice) =>
              !['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status) ||
              invoice.total.lte(invoice.paidTotal),
          )
        )
          throw new AppException(
            ErrorCode.INVOICE_INVALID_STATE,
            'Selected bills changed; refresh the patient balance',
            409,
          );
        const due = invoices.reduce(
          (value, invoice) => value.add(invoice.total.sub(invoice.paidTotal)),
          zero(),
        );
        // Qisman to‘lov: to‘lanayotgan summa qarzdan oshmasin; to‘liq bo‘lishi shart emas.
        if (sum.gt(due))
          throw new AppException(
            ErrorCode.PAYMENT_EXCEEDS_DUE,
            'To‘lov summasi tanlangan qarzdan oshib ketdi; sahifani yangilang',
            409,
            [{ due: due.toFixed(2) }],
          );
        const external = input.payments.filter((part) => part.method !== 'BALANCE');
        const shift = external.length
          ? await tx.cashierShift.findFirst({ where: { branchId, status: 'OPEN' } })
          : null;
        const shiftId = external.length
          ? await lockOpenShift(
              tx,
              shift?.id ?? null,
              this.config.env.SINGLE_CLINIC_MODE || external.some((part) => part.method === 'CASH'),
            )
          : null;
        const balanceAmount = input.payments
          .filter((part) => part.method === 'BALANCE')
          .reduce((value, part) => value.add(part.amount), zero());
        if (balanceAmount.gt(0)) {
          const changed = await tx.patient.updateMany({
            where: { id: input.patientId, balance: { gte: balanceAmount } },
            data: { balance: { decrement: balanceAmount } },
          });
          if (changed.count !== 1)
            throw new AppException(
              ErrorCode.INSUFFICIENT_BALANCE,
              'Insufficient patient balance',
              422,
            );
        }
        const snapshots: InvoiceSnapshot[] = invoices.map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          total: invoice.total.toFixed(2),
          paidBefore: invoice.paidTotal.toFixed(2),
          amount: invoice.total.sub(invoice.paidTotal).toFixed(2),
          subtotal: invoice.subtotal.toFixed(2),
          discountTotal: invoice.discountTotal.toFixed(2),
          lines: invoice.lines.map((line) => ({
            id: line.id,
            serviceId: line.serviceId,
            title: line.title,
            quantity: line.quantity,
            unitPrice: line.unitPrice.toFixed(2),
            discount: line.discount.toFixed(2),
            lineTotal: line.lineTotal.toFixed(2),
            performerUserId: line.performerUserId,
          })),
        }));
        const checkout = await tx.paymentCheckout.create({
          data: {
            clinicId,
            branchId,
            patientId: input.patientId,
            requestKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            total: sum,
            createdById: user.id,
            invoiceSnapshots: snapshots as unknown as Prisma.InputJsonValue,
          },
        });
        const remaining = input.payments.map((part) => new Prisma.Decimal(part.amount));
        const applied = [];
        const paidPerInvoice = new Map<string, Prisma.Decimal>();
        for (const invoice of invoices) {
          let invoiceDue = invoice.total.sub(invoice.paidTotal);
          let paidTotal = invoice.paidTotal;
          let received = zero();
          for (let index = 0; index < input.payments.length && invoiceDue.gt(0); index++) {
            const part = input.payments[index]!;
            const amount = Prisma.Decimal.min(invoiceDue, remaining[index]!);
            if (amount.lte(0)) continue;
            const payment = await tx.payment.create({
              data: {
                clinicId,
                branchId,
                invoiceId: invoice.id,
                checkoutId: checkout.id,
                amount,
                method: part.method,
                status: 'COMPLETED',
                shiftId: part.method === 'BALANCE' ? null : shiftId,
                note: note(part.note),
                receivedById: user.id,
              },
            });
            if (part.method === 'BALANCE')
              await tx.patientBalanceTransaction.create({
                data: {
                  clinicId,
                  patientId: input.patientId,
                  invoiceId: invoice.id,
                  type: 'INVOICE_APPLY',
                  amount: amount.neg(),
                  note: `Applied to invoice ${invoice.number}`,
                  createdById: user.id,
                },
              });
            paidTotal = paidTotal.add(amount);
            received = received.add(amount);
            applied.push({ invoice, payment, paidTotal });
            invoiceDue = invoiceDue.sub(amount);
            remaining[index] = remaining[index]!.sub(amount);
          }
          if (received.lte(0)) continue;
          paidPerInvoice.set(invoice.id, received);
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              paidTotal,
              status: paidTotal.gte(invoice.total) ? 'PAID' : 'PARTIALLY_PAID',
            },
          });
        }
        // Snapshotdagi amount — shu to‘lovda hisobga tushgan summa (qisman bo‘lishi mumkin).
        const paidSnapshots: InvoiceSnapshot[] = snapshots.map((row) => ({
          ...row,
          amount: (paidPerInvoice.get(row.id) ?? zero()).toFixed(2),
        }));
        await tx.paymentCheckout.update({
          where: { id: checkout.id },
          data: { invoiceSnapshots: paidSnapshots as unknown as Prisma.InputJsonValue },
        });
        return { checkoutId: checkout.id, applied };
      },
      { timeout: 20000 },
    );
    for (const entry of result.applied)
      await this.invoices.afterPaymentApplied(entry.invoice, entry.payment, entry.paidTotal);
    return { checkoutId: result.checkoutId, total: sum.toFixed(2) };
  }

  async receipt(
    checkoutId: string,
    branchId: string,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    this.assertBranch(branchId, user);
    const checkout = await this.prisma.db.paymentCheckout.findFirst({
      where: { id: checkoutId, branchId },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!checkout)
      throw new AppException(ErrorCode.INVOICE_NOT_FOUND, 'Payment receipt not found', 404);
    const snapshots = checkout.invoiceSnapshots as unknown as InvoiceSnapshot[];
    const base = await this.invoices.receipt(snapshots[0]!.id);
    const total = snapshots.reduce((value, row) => value.add(row.total), zero());
    const priorPaid = snapshots.reduce((value, row) => value.add(row.paidBefore), zero());
    const completed = checkout.payments
      .filter((payment) => payment.status === 'COMPLETED')
      .reduce((value, payment) => value.add(payment.amount), zero());
    return {
      ...base,
      invoice: {
        ...(base.invoice as Record<string, unknown>),
        id: checkout.id,
        number: `PAY-${checkout.id.slice(-12).toUpperCase()}`,
      },
      checkout: {
        id: checkout.id,
        amount: completed.toFixed(2),
        paidBefore: priorPaid.toFixed(2),
        invoices: snapshots.map(({ id, number, amount }) => ({ id, number, amount })),
      },
      lines: snapshots.flatMap((row) => row.lines),
      payments: checkout.payments.map((payment) => ({
        ...payment,
        amount: payment.amount.toFixed(2),
        paidAt: payment.paidAt.toISOString(),
        createdAt: payment.createdAt.toISOString(),
      })),
      totals: {
        subtotal: snapshots.reduce((value, row) => value.add(row.subtotal), zero()).toFixed(2),
        discountTotal: snapshots
          .reduce((value, row) => value.add(row.discountTotal), zero())
          .toFixed(2),
        total: total.toFixed(2),
        paidTotal: priorPaid.add(completed).toFixed(2),
        // Tanlangan hisoblar bo‘yicha shu to‘lovdan keyin qolgan qarz.
        due: snapshots
          .reduce((value, row) => {
            const before = new Prisma.Decimal(row.paidBefore);
            const now = new Prisma.Decimal(row.amount);
            return value.add(new Prisma.Decimal(row.total).sub(before).sub(now));
          }, zero())
          .toFixed(2),
      },
      printedAt: checkout.createdAt.toISOString(),
    };
  }
}
