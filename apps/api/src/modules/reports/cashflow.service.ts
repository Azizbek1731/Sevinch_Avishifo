import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type CashflowQueryInput,
  type CashflowReport,
  type CashflowTotals,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { XlsxService, type SheetSpec } from './xlsx.service';

export interface CashflowAggregateRow {
  bucket: string;
  method: string;
  kind: 'receipts' | 'deposits' | 'refunds' | 'expenses';
  category: string | null;
  amount: string;
  operations: number;
}

/** The upper boundary is exclusive: midnight after the last selected local day. */
export function cashflowRangeUtc(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000+05:00`),
    end: new Date(new Date(`${to}T00:00:00.000+05:00`).getTime() + 86_400_000),
  };
}

const blankTotals = (): CashflowTotals => ({
  receipts: '0.00',
  deposits: '0.00',
  refunds: '0.00',
  expenses: '0.00',
  inflow: '0.00',
  outflow: '0.00',
  net: '0.00',
  operations: 0,
});

function accumulate(total: CashflowTotals, row: CashflowAggregateRow): void {
  total[row.kind] = new Prisma.Decimal(total[row.kind]).add(row.amount).toFixed(2);
  total.operations += row.operations;
  total.inflow = new Prisma.Decimal(total.receipts).add(total.deposits).toFixed(2);
  total.outflow = new Prisma.Decimal(total.refunds).add(total.expenses).toFixed(2);
  total.net = new Prisma.Decimal(total.inflow).sub(total.outflow).toFixed(2);
}

/** Keep arithmetic decimal-exact; all summaries derive from the same database snapshot. */
export function summarizeCashflow(
  rows: CashflowAggregateRow[],
  method?: string,
): Pick<CashflowReport, 'totals' | 'accounts' | 'periods' | 'expenseCategories'> {
  const totals = blankTotals();
  const accounts = new Map<string, CashflowTotals>(
    (method ? [method] : ['CASH', 'CARD', 'CLICK']).map((key) => [key, blankTotals()]),
  );
  const periods = new Map<string, CashflowTotals>();
  const categories = new Map<string, { amount: string; operations: number }>();
  for (const row of rows) {
    accumulate(totals, row);
    const account = accounts.get(row.method) ?? blankTotals();
    accumulate(account, row);
    accounts.set(row.method, account);
    const period = periods.get(row.bucket) ?? blankTotals();
    accumulate(period, row);
    periods.set(row.bucket, period);
    if (row.kind === 'expenses') {
      const key = row.category ?? '—';
      const category = categories.get(key) ?? { amount: '0.00', operations: 0 };
      category.amount = new Prisma.Decimal(category.amount).add(row.amount).toFixed(2);
      category.operations += row.operations;
      categories.set(key, category);
    }
  }
  return {
    totals,
    accounts: Array.from(accounts, ([key, total]) => ({ method: key, ...total })),
    periods: Array.from(periods, ([bucket, total]) => ({ bucket, ...total })).sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    ),
    expenseCategories: Array.from(categories, ([category, total]) => ({ category, ...total })).sort(
      (a, b) => new Prisma.Decimal(b.amount).comparedTo(a.amount),
    ),
  };
}

@Injectable()
export class CashflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly xlsx: XlsxService,
  ) {}

  async report(
    q: CashflowQueryInput,
    user: AuthUser,
    activeBranchId: string,
  ): Promise<CashflowReport> {
    const branchId = q.branchId ?? activeBranchId;
    if (user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = cashflowRangeUtc(q.from, q.to);
    const method = q.method ? Prisma.sql`WHERE movements.method = ${q.method}` : Prisma.empty;

    // Raw SQL bypasses tenant extension: every arm and every join is clinic-scoped.
    // Refund credits and BALANCE-funded invoices move patient credit, not new money.
    // Expenses use their explicitly entered accounting date; other rows use local event time.
    const rows = await this.prisma.db.$queryRaw<CashflowAggregateRow[]>(Prisma.sql`
      WITH movements AS (
        SELECT (p."paidAt" AT TIME ZONE ${TIMEZONE})::date AS date,
               p.method::text AS method, 'receipts' AS kind, NULL::text AS category, p.amount
        FROM "Payment" p
        WHERE p."clinicId" = ${clinicId} AND p."branchId" = ${branchId}
          AND p.status::text = 'COMPLETED' AND p."voidedAt" IS NULL
          AND p.method::text <> 'BALANCE'
          AND p."paidAt" >= ${start} AND p."paidAt" < ${end}
        UNION ALL
        SELECT (d."createdAt" AT TIME ZONE ${TIMEZONE})::date,
               d.method::text, 'deposits', NULL::text, d.amount
        FROM "PatientBalanceTransaction" d
        JOIN "CashierShift" s ON s.id = d."shiftId" AND s."clinicId" = ${clinicId}
        WHERE d."clinicId" = ${clinicId} AND s."branchId" = ${branchId}
          AND d.type::text = 'DEPOSIT' AND d.method::text <> 'BALANCE'
          AND d."createdAt" >= ${start} AND d."createdAt" < ${end}
        UNION ALL
        SELECT (r."createdAt" AT TIME ZONE ${TIMEZONE})::date,
               r.method::text, 'refunds', NULL::text, r.amount
        FROM "Refund" r
        JOIN "Invoice" i ON i.id = r."invoiceId" AND i."clinicId" = ${clinicId}
        WHERE r."clinicId" = ${clinicId} AND i."branchId" = ${branchId}
          AND r.method::text <> 'BALANCE'
          AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
        UNION ALL
        SELECT e.date, e.method::text, 'expenses', c.name, e.amount
        FROM "Expense" e
        JOIN "ExpenseCategory" c ON c.id = e."categoryId" AND c."clinicId" = ${clinicId}
        WHERE e."clinicId" = ${clinicId} AND e."branchId" = ${branchId}
          AND e."deletedAt" IS NULL AND e.method::text <> 'BALANCE'
          AND e.date >= ${q.from}::date AND e.date <= ${q.to}::date
      )
      SELECT to_char(date_trunc(${q.groupBy}, date::timestamp), 'YYYY-MM-DD') AS bucket,
             method, kind, category, SUM(amount)::text AS amount, COUNT(*)::int AS operations
      FROM movements ${method}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4
    `);
    return {
      from: q.from,
      to: q.to,
      branchId,
      timezone: TIMEZONE,
      groupBy: q.groupBy,
      method: q.method ?? null,
      ...summarizeCashflow(rows, q.method),
    };
  }

  sheets(report: CashflowReport): SheetSpec[] {
    const columns = [
      { header: "To'lovlar", key: 'receipts', money: true },
      { header: 'Avanslar', key: 'deposits', money: true },
      { header: 'Qaytarishlar', key: 'refunds', money: true },
      { header: 'Chiqimlar', key: 'expenses', money: true },
      { header: 'Jami kirim', key: 'inflow', money: true },
      { header: 'Jami chiqish', key: 'outflow', money: true },
      { header: 'Sof harakat', key: 'net', money: true },
      { header: 'Amaliyotlar', key: 'operations' },
    ];
    const methodLabel = (method: string) =>
      (({ CASH: 'Naqd', CARD: 'Karta', CLICK: 'Click' }) as Record<string, string>)[method] ??
      method;
    return [
      {
        name: 'Davr va hisoblash',
        columns: [
          { header: 'Parametr', key: 'key', width: 28 },
          { header: 'Qiymat', key: 'value', width: 85 },
        ],
        rows: [
          { key: 'Boshlanish', value: report.from },
          { key: 'Tugash (shu kun ham)', value: report.to },
          { key: 'Filial ID', value: report.branchId },
          { key: 'Vaqt mintaqasi', value: report.timezone },
          { key: 'Kassa', value: report.method ? methodLabel(report.method) : 'Barcha kassalar' },
          { key: 'Guruhlash', value: report.groupBy },
          { key: 'Qamrov', value: 'Tanlangan filial, barcha kassirlar' },
          {
            key: 'Hisoblash',
            value: "Kirim = to'lovlar + avanslar. Sof harakat = kirim − qaytarishlar − chiqimlar.",
          },
          {
            key: 'Sanalar',
            value: "To'lov, avans va qaytarish: amaliyot vaqti. Chiqim: kiritilgan chiqim sanasi.",
          },
          {
            key: 'Balans',
            value: "Avansdan to'langan xizmat ichki hisob-kitob; qayta kirimga qo'shilmaydi.",
          },
        ],
      },
      { name: 'Jami', columns, rows: [{ ...report.totals }] },
      {
        name: 'Kassalar',
        columns: [{ header: 'Kassa', key: 'method' }, ...columns],
        rows: report.accounts.map((row) => ({ ...row, method: methodLabel(row.method) })),
      },
      {
        name: 'Davrlar',
        columns: [{ header: 'Davr boshlanishi', key: 'bucket', width: 20 }, ...columns],
        rows: report.periods.map((row) => ({ ...row })),
      },
      {
        name: 'Chiqim toifalari',
        columns: [
          { header: 'Toifa', key: 'category', width: 32 },
          { header: 'Summa', key: 'amount', money: true },
          { header: 'Amaliyotlar', key: 'operations' },
        ],
        rows: report.expenseCategories.map((row) => ({ ...row })),
      },
    ];
  }

  async export(report: CashflowReport, user: AuthUser): Promise<Buffer> {
    if (!user.permissions.includes('reports.cash.export')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.cash.export', 403);
    }
    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: 'cashflow',
      after: { from: report.from, to: report.to, branchId: report.branchId, method: report.method },
    });
    return this.xlsx.buildWorkbook(this.sheets(report));
  }
}
