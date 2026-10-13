import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { assertManualMethod, lockOpenShift, reconcileAccounts, type AccountMovements } from './cash-accounts';

const d = (amount: string) => new Prisma.Decimal(amount);
const movement = (method: string, receipts = '0', deposits = '0', refunds = '0', expenses = '0'): AccountMovements =>
  ({ method, receipts: d(receipts), deposits: d(deposits), refunds: d(refunds), expenses: d(expenses), count: 1 });

describe('three cashier accounts', () => {
  it('reconciles deposits, receipts, refunds and expenses separately with decimal precision', () => {
    const accounts = reconcileAccounts([
      movement('CASH', '100.10', '25.20', '3.10', '12.20'),
      movement('CARD', '300', '60', '25', '15'),
      movement('CLICK', '200', '80', '20', '10'),
      movement('BALANCE', '500'), // Applying deposits creates no second receipt.
    ], { CASH: d('10'), CARD: d('20'), CLICK: d('30') }, { CASH: d('120'), CARD: d('339'), CLICK: d('280') });
    expect(accounts.map(({ method, expected, difference }) => ({ method, expected, difference }))).toEqual([
      { method: 'CASH', expected: '120.00', difference: '0.00' },
      { method: 'CARD', expected: '340.00', difference: '-1.00' },
      { method: 'CLICK', expected: '280.00', difference: '0.00' },
    ]);
  });

  it('keeps uncounted balances null and excludes legacy methods from the new three accounts', () => {
    const accounts = reconcileAccounts([movement('PAYME', '100'), movement('UZUM', '100')], { CASH: d('0'), CARD: d('0'), CLICK: d('0') });
    expect(accounts).toHaveLength(3);
    for (const account of accounts) expect(account).toMatchObject({ expected: '0.00', actual: null, difference: null });
  });

  it('allows only CASH/CARD/CLICK manually in single-clinic mode; BALANCE is an explicit internal exception', () => {
    for (const method of ['CASH', 'CARD', 'CLICK']) expect(() => assertManualMethod(method, true)).not.toThrow();
    for (const method of ['PAYME', 'UZUM', 'BALANCE']) expect(() => assertManualMethod(method, true)).toThrow();
    expect(() => assertManualMethod('BALANCE', true, true)).not.toThrow();
    expect(() => assertManualMethod('PAYME', false)).not.toThrow();
  });

  it('refuses a manual movement when the shift closed while the request was running', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(lockOpenShift(tx, 'closed-shift', true)).rejects.toThrow();
    await expect(lockOpenShift(tx, null, true)).rejects.toThrow();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('locks an open shift and retains historical optional non-cash behavior', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'shift' }]) };
    await expect(lockOpenShift(tx, 'shift', true)).resolves.toBe('shift');
    await expect(lockOpenShift(tx, null, false)).resolves.toBeNull();
  });
});
