import { Prisma } from '@prisma/client';
import { CASH_ACCOUNT_METHODS, ErrorCode, type CashAccountMethod } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';

export interface AccountMovements {
  method: string;
  receipts: Prisma.Decimal;
  deposits: Prisma.Decimal;
  refunds: Prisma.Decimal;
  expenses: Prisma.Decimal;
  count: number;
}

export interface CashAccount {
  method: CashAccountMethod;
  opening: string;
  receipts: string;
  deposits: string;
  refunds: string;
  expenses: string;
  expected: string;
  actual: string | null;
  difference: string | null;
}

/** Single source for shift reconciliation; BALANCE has no external money flow. */
export function reconcileAccounts(
  movements: AccountMovements[],
  opening: Record<CashAccountMethod, Prisma.Decimal>,
  actual?: Partial<Record<CashAccountMethod, Prisma.Decimal | null>>,
): CashAccount[] {
  return CASH_ACCOUNT_METHODS.map((method) => {
    const rows = movements.filter((row) => row.method === method);
    const sum = (key: 'receipts' | 'deposits' | 'refunds' | 'expenses'): Prisma.Decimal =>
      rows.reduce((total, row) => total.add(row[key]), new Prisma.Decimal(0));
    const receipts = sum('receipts');
    const deposits = sum('deposits');
    const refunds = sum('refunds');
    const expenses = sum('expenses');
    const expected = opening[method].add(receipts).add(deposits).sub(refunds).sub(expenses);
    const counted = actual?.[method] ?? null;
    return {
      method, opening: opening[method].toFixed(2), receipts: receipts.toFixed(2),
      deposits: deposits.toFixed(2), refunds: refunds.toFixed(2), expenses: expenses.toFixed(2),
      expected: expected.toFixed(2), actual: counted?.toFixed(2) ?? null,
      difference: counted?.sub(expected).toFixed(2) ?? null,
    };
  });
}

export function assertManualMethod(method: string, singleClinic: boolean, allowBalance = false): void {
  if (singleClinic && !CASH_ACCOUNT_METHODS.some((allowed) => allowed === method) && !(allowBalance && method === 'BALANCE')) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, 'Faqat naqd, karta yoki Click orqali to‘lov qabul qilinadi', 400);
  }
}

/** Lock the open shift before any money mutation, including edits and voids. */
export async function lockOpenShift(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  shiftId: string | null,
  required: boolean,
): Promise<string | null> {
  if (shiftId) {
    const rows = await tx.$queryRaw`
      SELECT "id" FROM "CashierShift"
      WHERE "id" = ${shiftId} AND "status" = 'OPEN' FOR SHARE
    ` as unknown[];
    if (rows.length > 0) return shiftId;
  }
  if (required) throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'To‘lov yoki chiqim uchun ochiq kassa smenasi kerak', 409);
  return null;
}
