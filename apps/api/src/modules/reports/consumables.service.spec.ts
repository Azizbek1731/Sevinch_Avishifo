import { describe, expect, it, vi } from 'vitest';
import * as ExcelJS from 'exceljs';
import { consumablesQuerySchema, type AuthUser, type ConsumablesReport } from '@avishifo/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { XlsxService } from './xlsx.service';
import { cashflowRangeUtc } from './cashflow.service';
import { ConsumablesService, summarizeConsumables, type ConsumablesAggregateRow } from './consumables.service';

const q = { from: '2026-10-13', to: '2026-10-13', groupBy: 'day' as const };
const user = { id: 'cashier', clinicId: 'clinic', branchIds: ['branch'], permissions: ['reports.cash.read', 'reports.cash.export'] } as AuthUser;
const row = (overrides: Partial<ConsumablesAggregateRow> = {}): ConsumablesAggregateRow => ({
  bucket: q.from, serviceId: 'bandage', code: 'B1', title: { uz: 'Bint' }, kind: 'MATERIAL', unit: 'dona',
  ordered: false, quantity: '1.125', amount: '10.10', entries: 1, ...overrides,
});
function fixture() {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const log = vi.fn().mockResolvedValue(undefined);
  const service = new ConsumablesService({ db: { $queryRaw: queryRaw } } as unknown as PrismaService, { log } as unknown as AuditService, new XlsxService());
  return { service, queryRaw, log };
}
function report(rows: ConsumablesAggregateRow[] = []): ConsumablesReport {
  return { ...q, branchId: 'branch', timezone: 'Asia/Tashkent', kind: null, source: null, ...summarizeConsumables(rows) };
}

describe('consumables date validation and arithmetic', () => {
  it('validates real calendar dates and inclusive 1–366 day ranges', () => {
    expect(consumablesQuerySchema.safeParse(q).success).toBe(true);
    expect(consumablesQuerySchema.safeParse({ ...q, from: '2026-02-30' }).success).toBe(false);
    expect(consumablesQuerySchema.safeParse({ ...q, to: '2026-10-12' }).success).toBe(false);
    expect(consumablesQuerySchema.safeParse({ ...q, from: '2024-01-01', to: '2024-12-31' }).success).toBe(true);
    expect(consumablesQuerySchema.safeParse({ ...q, from: '2024-01-01', to: '2025-01-01' }).success).toBe(false);
    expect(consumablesQuerySchema.safeParse({ ...q, from: '2026-99-99' }).success).toBe(false);
    const range = cashflowRangeUtc('2024-02-29', '2024-02-29');
    expect(range.start.toISOString()).toBe('2024-02-28T19:00:00.000Z');
    expect(range.end.toISOString()).toBe('2024-02-29T19:00:00.000Z');
  });

  it('sums exact fractions, keeps ordered quantities separate and merges historical catalogue titles', () => {
    const result = summarizeConsumables([
      row(), row({ title: { uz: 'Bint yangi nom' }, quantity: '0.001', amount: '0.01' }),
      row({ ordered: true, quantity: '5.000', amount: '50.50', entries: 2 }),
      row({ bucket: '2026-10-14', unit: 'ml', quantity: '0.100', amount: '0.00' }),
    ]);
    expect(result.totals).toEqual({ amount: '10.11', entries: 3, orderedAmount: '50.50', orderedEntries: 2, itemCount: 2 });
    expect(result.items.find((i) => i.unit === 'dona')).toMatchObject({ quantity: '1.126', orderedQuantity: '5.000', amount: '10.11' });
    expect(result.units).toEqual([{ unit: 'dona', quantity: '1.126', orderedQuantity: '5.000' }, { unit: 'ml', quantity: '0.100', orderedQuantity: '0.000' }]);
    expect(result.periods[1]).toMatchObject({ amount: '0.00', entries: 1 });
  });

  it('normalizes manual names but never merges different kinds, units or catalogue identities', () => {
    const result = summarizeConsumables([
      row({ serviceId: null, title: { uz: '  BINT   steril ' } }),
      row({ serviceId: null, title: { uz: 'bint steril' }, unit: ' DONA ' }),
      row({ serviceId: null, title: { uz: 'bint steril' }, kind: 'MEDICINE' }),
      row({ serviceId: null, title: { uz: 'bint steril' }, unit: 'ml' }),
      row({ title: { uz: 'bint steril' } }),
    ]);
    expect(result.items).toHaveLength(4);
    expect(result.items.find((i) => i.serviceId === null && i.kind === 'MATERIAL' && i.unit === 'dona')?.quantity).toBe('2.250');
  });
});

describe('consumables permissions and export', () => {
  it('requires financial read permission and branch access before querying', async () => {
    const { service, queryRaw } = fixture();
    await expect(service.report(q, { ...user, permissions: [] }, 'branch')).rejects.toThrow('reports.cash.read');
    await expect(service.report({ ...q, branchId: 'other' }, user, 'branch')).rejects.toThrow('No access');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('uses the active branch and scoped query with no invoice/payment status filtering', async () => {
    const { service, queryRaw } = fixture();
    await TenantContext.run({ clinicId: 'clinic' }, () => service.report({ ...q, kind: 'MEDICINE', source: 'SURGERY' }, user, 'branch'));
    const sql = queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
    expect(sql.values).toContain('clinic');
    expect(sql.values).toContain('branch');
    expect(sql.values).toContain('MEDICINE');
    expect(sql.values).toContain('SURGERY');
    expect(sql.sql).toContain("op.status::text <> 'CANCELLED'");
    expect(sql.sql).toContain("a.status::text = 'GIVEN'");
    expect(sql.sql).not.toContain('"Invoice"');
    expect(sql.sql).not.toContain('"Payment"');
    expect(sql.sql).not.toContain('"stoppedAt"');
  });

  it('requires export permission and preserves formulas as text, numeric quantities, filters and totals', async () => {
    const { service, log } = fixture();
    const data = { ...report([row({ title: { uz: '=HYPERLINK("https://example.test")' } })]), kind: 'MATERIAL' as const, source: 'SURGERY' as const };
    await expect(service.export(data, { ...user, permissions: ['reports.cash.read'] })).rejects.toThrow('reports.cash.export');
    const buffer = await service.export(data, user);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets).toHaveLength(5);
    const items = wb.getWorksheet('Dorilar va materiallar')!;
    expect(items.getCell('B2').type).toBe(ExcelJS.ValueType.String);
    expect(items.getCell('B2').text).toBe('=HYPERLINK("https://example.test")');
    expect(items.getCell('E2').value).toBe(1.125);
    expect(items.getCell('E2').numFmt).toBe('#,##0.###');
    expect(wb.getWorksheet('Jami')!.getCell('B2').value).toBe(10.10);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'consumables', after: expect.objectContaining({ kind: 'MATERIAL', source: 'SURGERY' }) }));
  });
});
