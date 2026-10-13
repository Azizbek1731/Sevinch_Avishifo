import { describe, expect, it, vi } from 'vitest';
import { cashflowQuerySchema, type AuthUser } from '@avishifo/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { AuditService } from '../../core/audit/audit.service';
import type { XlsxService } from './xlsx.service';
import { CashflowService, cashflowRangeUtc, summarizeCashflow } from './cashflow.service';

const user = {
  id: 'cashier-1',
  clinicId: 'clinic-1',
  branchIds: ['branch-1'],
  permissions: ['reports.cash.read', 'reports.cash.export'],
} as AuthUser;

function fixture() {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const log = vi.fn().mockResolvedValue(undefined);
  const buildWorkbook = vi.fn().mockResolvedValue(Buffer.from('xlsx'));
  const service = new CashflowService(
    { db: { $queryRaw: queryRaw } } as unknown as PrismaService,
    { log } as unknown as AuditService,
    { buildWorkbook } as unknown as XlsxService,
  );
  return { service, queryRaw, log, buildWorkbook };
}

const q = { from: '2026-10-11', to: '2026-10-11', groupBy: 'day' as const };

describe('cashflow report date validation', () => {
  it('covers the entire selected Tashkent day and stops before the next day', () => {
    const { start, end } = cashflowRangeUtc(q.from, q.to);
    expect(start.toISOString()).toBe('2026-10-10T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-11T19:00:00.000Z');
  });

  it('handles leap days and year transitions', () => {
    expect(cashflowRangeUtc('2024-02-29', '2024-02-29').end.toISOString()).toBe(
      '2024-02-29T19:00:00.000Z',
    );
    expect(cashflowRangeUtc('2026-12-31', '2027-01-01').end.toISOString()).toBe(
      '2027-01-01T19:00:00.000Z',
    );
    expect(cashflowQuerySchema.safeParse({ ...q, from: '2026-02-30' }).success).toBe(false);
    expect(cashflowQuerySchema.safeParse({ ...q, from: '2026-10-12' }).success).toBe(false);
    expect(cashflowQuerySchema.safeParse({ ...q, from: '2025-01-01' }).success).toBe(false);
    expect(cashflowQuerySchema.safeParse({ ...q, from: '2026-99-99' }).success).toBe(false);
    expect(cashflowQuerySchema.safeParse(q).success).toBe(true);
  });
});

describe('cashflow reconciliation', () => {
  it('keeps payments/deposits separate and subtracts refunds and expenses exactly', () => {
    const report = summarizeCashflow([
      {
        bucket: q.from,
        method: 'CASH',
        kind: 'receipts',
        category: null,
        amount: '100.10',
        operations: 1,
      },
      {
        bucket: q.from,
        method: 'CASH',
        kind: 'deposits',
        category: null,
        amount: '20.20',
        operations: 1,
      },
      {
        bucket: q.from,
        method: 'CASH',
        kind: 'refunds',
        category: null,
        amount: '10.05',
        operations: 1,
      },
      {
        bucket: q.from,
        method: 'CASH',
        kind: 'expenses',
        category: 'Supplies',
        amount: '15.10',
        operations: 1,
      },
      {
        bucket: '2026-10-12',
        method: 'CARD',
        kind: 'receipts',
        category: null,
        amount: '200.00',
        operations: 2,
      },
      {
        bucket: '2026-10-12',
        method: 'CLICK',
        kind: 'expenses',
        category: 'Supplies',
        amount: '5.05',
        operations: 1,
      },
    ]);
    expect(report.totals).toEqual({
      receipts: '300.10',
      deposits: '20.20',
      refunds: '10.05',
      expenses: '20.15',
      inflow: '320.30',
      outflow: '30.20',
      net: '290.10',
      operations: 7,
    });
    expect(report.accounts.map((a) => [a.method, a.net])).toEqual([
      ['CASH', '95.15'],
      ['CARD', '200.00'],
      ['CLICK', '-5.05'],
    ]);
    expect(report.periods.map((r) => r.net)).toEqual(['95.15', '194.95']);
    expect(report.expenseCategories).toEqual([
      { category: 'Supplies', amount: '20.15', operations: 2 },
    ]);
  });

  it('shows zero-valued accounts and preserves historical methods in unfiltered totals', () => {
    expect(summarizeCashflow([]).accounts.map((a) => a.method)).toEqual(['CASH', 'CARD', 'CLICK']);
    expect(summarizeCashflow([], 'CLICK').accounts).toHaveLength(1);
    const result = summarizeCashflow([
      {
        bucket: q.from,
        method: 'PAYME',
        kind: 'receipts',
        category: null,
        amount: '50.00',
        operations: 1,
      },
    ]);
    expect(result.accounts.find((a) => a.method === 'PAYME')?.net).toBe('50.00');
    expect(result.totals.net).toBe('50.00');
  });

  it('refuses unauthorized query branches before running SQL', async () => {
    const { service, queryRaw } = fixture();
    await expect(
      service.report({ ...q, branchId: 'other-branch' }, user, 'branch-1'),
    ).rejects.toThrow('No access to this branch');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('scopes every financial source by clinic and branch and excludes internal/voided money', async () => {
    const { service, queryRaw } = fixture();
    await TenantContext.run({ clinicId: 'clinic-1' }, () =>
      service.report({ ...q, method: 'CLICK' }, user, 'branch-1'),
    );
    const sql = queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain("p.status::text = 'COMPLETED'");
    expect(sql.sql).toContain('p."voidedAt" IS NULL');
    expect(sql.sql).toContain('e."deletedAt" IS NULL');
    expect(sql.sql).toContain("d.type::text = 'DEPOSIT'");
    expect(sql.sql.match(/<> 'BALANCE'/g)).toHaveLength(4);
    expect(sql.values.filter((v) => v === 'clinic-1')).toHaveLength(7);
    expect(sql.values.filter((v) => v === 'branch-1')).toHaveLength(4);
    expect(sql.values).toContain('CLICK');
    expect(sql.sql).toContain('e.date >=');
    // All operators in the branch contribute, including handovers during the day.
    expect(sql.sql).not.toContain('receivedById');
  });

  it('requires the financial export permission and includes all active filters in the workbook', async () => {
    const { service, log, buildWorkbook } = fixture();
    const report = {
      ...q,
      timezone: 'Asia/Tashkent',
      branchId: 'branch-1',
      method: 'CARD' as const,
      ...summarizeCashflow([], 'CARD'),
    };
    await expect(
      service.export(report, { ...user, permissions: ['reports.cash.read'] }),
    ).rejects.toThrow('reports.cash.export');
    expect(buildWorkbook).not.toHaveBeenCalled();
    await service.export(report, user);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { from: q.from, to: q.to, branchId: 'branch-1', method: 'CARD' },
      }),
    );
    const sheets = buildWorkbook.mock.calls[0]?.[0] as ReturnType<typeof service.sheets>;
    expect(sheets).toHaveLength(5);
    expect(sheets[0]?.rows).toContainEqual({ key: 'Kassa', value: 'Karta' });
    expect(sheets[2]?.rows).toHaveLength(1);
  });
});
