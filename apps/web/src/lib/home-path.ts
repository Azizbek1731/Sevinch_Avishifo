import type { Permission, UserRole } from '@avishifo/shared';

/**
 * The first screen a signed-in user should see.
 *
 * /dashboard needs reports.read, so it is home for an owner and the wrong place
 * for everyone else: a receptionist sent there gets three 403s and a page of
 * dashes where the numbers belong. Each role lands on the first screen it may
 * actually open instead.
 *
 * Every "go to your home" redirect must come through here. The login page's
 * already-signed-in bounce used to hardcode /dashboard, and since it fires on
 * the same state change that the form's own redirect reacts to — and lands
 * second — it overrode the role-aware destination on every login, not just on a
 * revisit.
 */
export function homePath(user: { role: UserRole; permissions: readonly Permission[] }): string {
  if (user.role === 'SUPER_ADMIN') return '/platform/clinics';
  if (user.role === 'OPERATING_ROOM') return '/surgeries';

  const can = (p: Permission): boolean => user.permissions.includes(p);
  if (can('reports.read')) return '/dashboard';
  if (can('queue.manage')) return '/reception';
  if (can('queue.call')) return '/doctor';
  if (can('payments.create')) return '/cashier';
  if (can('lab.orders.write')) return '/lab';
  return '/patients';
}
