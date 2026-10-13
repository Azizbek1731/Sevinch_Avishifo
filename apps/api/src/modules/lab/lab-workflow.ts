import { Prisma } from '@prisma/client';
import { ErrorCode, LabOrderStatus } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';

export const FINAL_LAB_STATUSES: readonly LabOrderStatus[] = [
  LabOrderStatus.APPROVED,
  LabOrderStatus.DELIVERED,
  LabOrderStatus.CANCELLED,
];

export function isLabResultComplete(item: {
  labTest: { parameters: readonly { id: string }[] };
  result: {
    reportDocumentId?: string | null;
    values: readonly { parameterId: string; value: string }[];
  } | null;
}): boolean {
  if (!item.result) return false;
  if (item.result.reportDocumentId) return true;
  const values = new Map(
    item.result.values.map((value) => [value.parameterId, value.value.trim()]),
  );
  return (
    item.labTest.parameters.length > 0 &&
    item.labTest.parameters.every((parameter) => Boolean(values.get(parameter.id)))
  );
}

type LabInvoicePayment = {
  status: string;
  total: Prisma.Decimal;
  paidTotal: Prisma.Decimal;
  refunds: readonly { amount: Prisma.Decimal }[];
};

export function labInvoiceNetPaid(invoice: LabInvoicePayment): Prisma.Decimal {
  return invoice.refunds.reduce((net, refund) => net.sub(refund.amount), invoice.paidTotal);
}

export function isLabInvoicePaid(invoice: LabInvoicePayment | null): boolean {
  // Old orders predate invoice linkage and retain their existing clinical history.
  return (
    invoice === null || (invoice.status === 'PAID' && labInvoiceNetPaid(invoice).gte(invoice.total))
  );
}

/** Invoice first, then order: the same lock order used by cashier settlement. */
export async function lockLabOrder(
  tx: TenantTransactionClient,
  orderId: string,
  requirePayment = true,
) {
  const initial = await tx.labOrder.findUnique({
    where: { id: orderId },
    select: { invoiceId: true },
  });
  if (!initial) throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order not found', 404);
  const clinicId = TenantContext.requireClinicId();
  if (initial.invoiceId) {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${initial.invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "LabOrder" WHERE "id" = ${orderId} AND "clinicId" = ${clinicId} FOR UPDATE`;
  const order = await tx.labOrder.findUnique({
    where: { id: orderId },
    include: { invoice: { include: { refunds: { select: { amount: true } } } } },
  });
  if (!order) throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order not found', 404);
  if (requirePayment && !isLabInvoicePaid(order.invoice)) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'The invoice must be fully paid before laboratory work',
      409,
      [{ reason: 'LAB_PAYMENT_REQUIRED', invoiceId: order.invoiceId }],
    );
  }
  return order;
}
