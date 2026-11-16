import { Prisma } from '@prisma/client';
import {
  AMBULATORY_SHARE_GROUPS,
  type AmbulatoryCommissionAmounts,
  type AmbulatoryCommissionOrder,
  type AmbulatoryCommissionTotals,
  type AmbulatoryPaymentState,
  type AmbulatoryShareGroup,
} from '@avishifo/shared';

const zero = new Prisma.Decimal(0);
export const money = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

type Title = Record<string, string> | string;

/** Who referred whom, shared by lab and UZI rows. */
interface ReferralRow {
  orderId: string;
  createdAt: Date;
  caseId: string;
  caseNumber: string;
  doctorUserId: string;
  doctorName: string;
  patientId: string;
  mrn: string;
  fullName: string;
}

/** One lab order with its single cashier invoice. */
export interface LabRow extends ReferralRow {
  orderNumber: string;
  orderStatus: string;
  percent: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceTotal: string | null;
  paidTotal: string | null;
  refunded: string;
  linesTotal: string;
  labLinesTotal: string;
  tests: Title[];
}

/** One invoice of a UZI order: the initial bill or one added during the scan. */
export interface UziRow extends ReferralRow {
  orderNumber: string;
  orderCancelled: boolean;
  uziPercent: string | null;
  echoPercent: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceTotal: string;
  paidTotal: string;
  refunded: string;
  linesTotal: string;
  uziLinesTotal: string;
  echoLinesTotal: string;
  uziTitles: Title[];
  echoTitles: Title[];
}

export interface Share {
  group: AmbulatoryShareGroup;
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  caseId: string;
  caseNumber: string;
  doctorUserId: string;
  doctorName: string;
  patientId: string;
  mrn: string;
  fullName: string;
  tests: Title[];
  invoiceNumber: string | null;
  cancelled: boolean;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  percent: Prisma.Decimal;
  commission: Prisma.Decimal;
  pendingCommission: Prisma.Decimal;
  paymentState: AmbulatoryPaymentState;
}

const deadInvoice = (status: string | null) => status === 'CANCELLED' || status === 'REFUNDED';

/**
 * The group's slice of one invoice, net of invoice discounts and refunds:
 * billed = group lines × total / all lines; paid = billed × net paid / total.
 */
function slice(input: {
  total: string | null;
  paidTotal: string | null;
  refunded: string;
  linesTotal: string;
  groupLinesTotal: string;
}): { amount: Prisma.Decimal; paidAmount: Prisma.Decimal; settled: boolean; touched: boolean } {
  const total = new Prisma.Decimal(input.total ?? 0);
  const linesTotal = new Prisma.Decimal(input.linesTotal);
  const groupLines = new Prisma.Decimal(input.groupLinesTotal);
  const netPaid = Prisma.Decimal.min(
    total,
    Prisma.Decimal.max(0, new Prisma.Decimal(input.paidTotal ?? 0).sub(input.refunded)),
  );
  const amount = linesTotal.gt(0) ? groupLines.mul(total).div(linesTotal) : zero;
  const paidAmount = total.gt(0) ? amount.mul(netPaid).div(total) : zero;
  return { amount, paidAmount, settled: netPaid.gte(total), touched: netPaid.gt(0) };
}

function finish(
  base: Omit<Share, 'commission' | 'pendingCommission' | 'paymentState'>,
  state: AmbulatoryPaymentState,
): Share {
  if (base.cancelled)
    return { ...base, amount: zero, paidAmount: zero, commission: zero, pendingCommission: zero, paymentState: 'UNPAID' };
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const commission = round(base.paidAmount.mul(base.percent).div(100));
  const expected = round(base.amount.mul(base.percent).div(100));
  return {
    ...base,
    commission,
    pendingCommission: Prisma.Decimal.max(0, expected.sub(commission)),
    paymentState: state,
  };
}

/** The doctor's lab share: only the lab part of the bill, only what the cashier actually took. */
export function labShare(row: LabRow, fallbackPercent: number): Share {
  const cancelled = row.orderStatus === 'CANCELLED' || !row.invoiceId || deadInvoice(row.invoiceStatus);
  const part = slice({
    total: row.invoiceTotal,
    paidTotal: row.paidTotal,
    refunded: row.refunded,
    linesTotal: row.linesTotal,
    groupLinesTotal: row.labLinesTotal,
  });
  return finish(
    {
      group: 'LAB',
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      createdAt: row.createdAt,
      caseId: row.caseId,
      caseNumber: row.caseNumber,
      doctorUserId: row.doctorUserId,
      doctorName: row.doctorName,
      patientId: row.patientId,
      mrn: row.mrn,
      fullName: row.fullName,
      tests: row.tests ?? [],
      invoiceNumber: row.invoiceNumber,
      cancelled,
      amount: part.amount,
      paidAmount: part.paidAmount,
      percent: new Prisma.Decimal(row.percent ?? fallbackPercent),
    },
    part.settled ? 'PAID' : part.touched ? 'PARTIAL' : 'UNPAID',
  );
}

/**
 * UZI and EXO shares of each UZI order, one per group that has examinations.
 * Orders sent before shares existed have no snapshot and earn nothing.
 */
export function uziShares(rows: UziRow[]): Share[] {
  const byOrder = new Map<string, UziRow[]>();
  for (const row of rows) byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row]);
  const shares: Share[] = [];
  for (const invoices of byOrder.values()) {
    const first = invoices[0]!;
    for (const group of ['UZI', 'EXO'] as const) {
      const live = invoices.filter((row) => !deadInvoice(row.invoiceStatus));
      const titlesOf = (row: UziRow) => (group === 'UZI' ? row.uziTitles : row.echoTitles) ?? [];
      const linesOf = (row: UziRow) => (group === 'UZI' ? row.uziLinesTotal : row.echoLinesTotal);
      const withGroup = invoices.filter((row) => new Prisma.Decimal(linesOf(row)).gt(0));
      if (withGroup.length === 0) continue;
      const parts = live
        .filter((row) => new Prisma.Decimal(linesOf(row)).gt(0))
        .map((row) =>
          slice({
            total: row.invoiceTotal,
            paidTotal: row.paidTotal,
            refunded: row.refunded,
            linesTotal: row.linesTotal,
            groupLinesTotal: linesOf(row),
          }),
        );
      const percent = group === 'UZI' ? first.uziPercent : first.echoPercent;
      shares.push(
        finish(
          {
            group,
            orderId: first.orderId,
            orderNumber: first.orderNumber,
            createdAt: first.createdAt,
            caseId: first.caseId,
            caseNumber: first.caseNumber,
            doctorUserId: first.doctorUserId,
            doctorName: first.doctorName,
            patientId: first.patientId,
            mrn: first.mrn,
            fullName: first.fullName,
            tests: (live.length ? live : withGroup).flatMap(titlesOf),
            invoiceNumber: first.orderNumber,
            cancelled: first.orderCancelled || parts.length === 0,
            amount: parts.reduce((sum, part) => sum.add(part.amount), zero),
            paidAmount: parts.reduce((sum, part) => sum.add(part.paidAmount), zero),
            percent: new Prisma.Decimal(percent ?? 0),
          },
          parts.every((part) => part.settled)
            ? 'PAID'
            : parts.some((part) => part.touched)
              ? 'PARTIAL'
              : 'UNPAID',
        ),
      );
    }
  }
  return shares;
}

/** A share counts when the work stands and the doctor has a rate for it. */
export const earning = (share: Share) => !share.cancelled && share.percent.gt(0);

function amountsOf(shares: Share[]): AmbulatoryCommissionAmounts {
  const sum = (pick: (share: Share) => Prisma.Decimal) =>
    money(shares.reduce((acc, share) => acc.add(pick(share)), zero));
  return {
    orders: new Set(shares.map((share) => share.orderId)).size,
    amount: sum((share) => share.amount),
    paidAmount: sum((share) => share.paidAmount),
    commission: sum((share) => share.commission),
    pendingCommission: sum((share) => share.pendingCommission),
  };
}

export function totalsOf(shares: Share[]): AmbulatoryCommissionTotals {
  return {
    ...amountsOf(shares),
    patients: new Set(shares.map((share) => share.patientId)).size,
    byGroup: Object.fromEntries(
      AMBULATORY_SHARE_GROUPS.map((group) => [
        group,
        amountsOf(shares.filter((share) => share.group === group)),
      ]),
    ) as AmbulatoryCommissionTotals['byGroup'],
  };
}

export function orderOf(share: Share): AmbulatoryCommissionOrder {
  return {
    group: share.group,
    orderId: share.orderId,
    orderNumber: share.orderNumber,
    createdAt: share.createdAt.toISOString(),
    caseId: share.caseId,
    caseNumber: share.caseNumber,
    patient: { id: share.patientId, mrn: share.mrn, fullName: share.fullName },
    doctorUserId: share.doctorUserId,
    doctorName: share.doctorName,
    tests: share.tests,
    invoiceNumber: share.invoiceNumber,
    amount: money(share.amount),
    paidAmount: money(share.paidAmount),
    percent: share.percent.toNumber(),
    commission: money(share.commission),
    pendingCommission: money(share.pendingCommission),
    paymentState: share.paymentState,
  };
}
