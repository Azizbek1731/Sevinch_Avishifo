import { describe, expect, it, vi } from 'vitest';
import { Prisma, type CashierShift } from '@prisma/client';
import type { AuthUser } from '@avishifo/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { ShiftsService } from './shifts.service';

const d = (value: string) => new Prisma.Decimal(value);
const legacy: CashierShift = {
  id: 'shift', clinicId: 'clinic', branchId: 'branch', cashierUserId: 'cashier', status: 'OPEN',
  openedAt: new Date(), closedAt: null, openingCash: d('10'), openingTransfer: d('100'),
  openingCard: d('0'), openingClick: d('0'), expectedCash: null, actualCash: null,
  expectedCard: null, expectedClick: null, actualCard: null, actualClick: null,
  expectedTransfer: null, actualTransfer: null, transferUnverifiedReason: null, closedById: null, note: null,
};
const user = { id: 'cashier' } as AuthUser;
function fixture(initial = legacy) {
  let shift = { ...initial };
  const update = vi.fn(({ data }: { data: Partial<CashierShift> }) => { shift = { ...shift, ...data }; return Promise.resolve(shift); });
  const tx = {
    cashierShift: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update },
    payment: { groupBy: vi.fn().mockResolvedValue([]) }, refund: { groupBy: vi.fn().mockResolvedValue([]) },
    expense: { groupBy: vi.fn().mockResolvedValue([]) }, patientBalanceTransaction: { groupBy: vi.fn().mockResolvedValue([]) },
  };
  const prisma = { db: {
    cashierShift: { findFirst: vi.fn().mockResolvedValue(shift) },
    $transaction: (work: (connection: typeof tx) => Promise<unknown>) => work(tx),
  } } as unknown as PrismaService;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const config = { env: { SINGLE_CLINIC_MODE: true } } as AppConfigService;
  return { service: new ShiftsService(prisma, audit, config), update, audit };
}

describe('legacy shift opening reconciliation', () => {
  it('requires explicit allocation of a pre-upgrade transfer float before closure', async () => {
    const { service } = fixture();
    await expect(service.close({ actualCash: '10', actualCard: '60', actualClick: '40' }, user, 'branch')).rejects.toThrow(/boshlang‘ich/);
  });
  it('rejects an allocation that loses or invents opening money', async () => {
    const { service } = fixture();
    await expect(service.close({ openingCard: '60', openingClick: '50', actualCash: '10', actualCard: '60', actualClick: '50' }, user, 'branch')).rejects.toThrow(/boshlang‘ich/);
  });
  it('preserves the legacy float and reconciles each explicitly allocated account', async () => {
    const { service, update, audit } = fixture();
    const result = await service.close({ openingCard: '60', openingClick: '40', actualCash: '10', actualCard: '60', actualClick: '40' }, user, 'branch');
    expect(result.report).toMatchObject({ expectedTransfer: '100.00', accounts: [
      expect.objectContaining({ method: 'CASH', expected: '10.00', difference: '0.00' }),
      expect.objectContaining({ method: 'CARD', opening: '60.00', expected: '60.00', difference: '0.00' }),
      expect.objectContaining({ method: 'CLICK', opening: '40.00', expected: '40.00', difference: '0.00' }),
    ] });
    expect(update).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledOnce();
  });
  it('prevents changing an already assigned opening float at close', async () => {
    const { service } = fixture({ ...legacy, openingCard: d('60'), openingClick: d('40') });
    await expect(service.close({ openingCard: '50', openingClick: '50', actualCash: '10', actualCard: '50', actualClick: '50' }, user, 'branch')).rejects.toThrow(/o‘zgartirib/);
  });
});
