import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type UserRole } from '@avishifo/shared';
import { homePath } from './home-path';

/**
 * Landing a role on a screen it cannot open is not a cosmetic slip: the panel
 * answers with 403s and the staff member's first impression of the day is a
 * page of dashes. /dashboard needs reports.read, so only roles that hold it may
 * be sent there.
 */
function forRole(role: UserRole) {
  return { role, permissions: ROLE_PERMISSIONS[role] };
}

describe('homePath', () => {
  it('sends the platform owner to the clinic list, not a tenant dashboard', () => {
    expect(homePath(forRole('SUPER_ADMIN'))).toBe('/platform/clinics');
  });

  it('sends a reports reader to the dashboard', () => {
    expect(homePath(forRole('CLINIC_OWNER'))).toBe('/dashboard');
  });

  it('sends a receptionist to reception', () => {
    expect(homePath(forRole('RECEPTIONIST'))).toBe('/reception');
  });

  it('sends operating room staff to their surgery worklist', () => {
    expect(homePath(forRole('OPERATING_ROOM'))).toBe('/surgeries');
  });

  it('sends lab staff to the laboratory desk', () => {
    expect(homePath(forRole('LAB_TECH'))).toBe('/lab');
  });

  it('sends ultrasound doctors to the UZI desk', () => {
    expect(
      homePath({
        role: 'DOCTOR',
        permissions: ROLE_PERMISSIONS.DOCTOR,
        specialty: 'UZI mutaxassisi (UTT)',
      }),
    ).toBe('/uzi');
  });

  it('never sends a role without reports.read to the dashboard', () => {
    const roles = Object.keys(ROLE_PERMISSIONS) as UserRole[];
    for (const role of roles) {
      const user = forRole(role);
      if (role !== 'SUPER_ADMIN' && !user.permissions.includes('reports.read')) {
        expect(homePath(user)).not.toBe('/dashboard');
      }
    }
  });

  it('falls back to help when nothing else is open', () => {
    expect(homePath({ role: 'DOCTOR', permissions: [] })).toBe('/help');
  });
});
