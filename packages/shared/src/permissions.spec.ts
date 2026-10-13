import { describe, expect, it } from 'vitest';
import { UserRole } from './enums';
import { permissionsForRole } from './permissions';

describe('single clinic desk responsibilities', () => {
  it('lets reception prepare care and invoices without handling money', () => {
    const permissions = permissionsForRole(UserRole.RECEPTIONIST);
    for (const permission of [
      'patients.write',
      'admissions.write',
      'charges.write',
      'lab.orders.write',
      'invoices.write',
    ])
      expect(permissions).toContain(permission);
    for (const permission of [
      'payments.create',
      'payments.void',
      'expenses.write',
      'shifts.manage',
      'refunds.create',
    ])
      expect(permissions).not.toContain(permission);
  });
  it('lets the cashier manage the three accounts and financial reports without changing care', () => {
    const permissions = permissionsForRole(UserRole.CASHIER);
    for (const permission of [
      'payments.create',
      'expenses.write',
      'shifts.manage',
      'reports.cash.read',
      'reports.cash.export',
    ])
      expect(permissions).toContain(permission);
    for (const permission of [
      'patients.write',
      'patients.delete',
      'charges.write',
      'invoices.write',
      'invoices.cancel',
      'admissions.write',
      'lab.orders.write',
      'reports.read',
    ])
      expect(permissions).not.toContain(permission);
  });
  it('keeps explicit per-user overrides usable by management', () => {
    expect(
      permissionsForRole(UserRole.RECEPTIONIST, {
        grant: ['payments.create'],
        revoke: ['charges.write'],
      }),
    ).toContain('payments.create');
    expect(permissionsForRole(UserRole.RECEPTIONIST, { revoke: ['charges.write'] })).not.toContain(
      'charges.write',
    );
  });
});
