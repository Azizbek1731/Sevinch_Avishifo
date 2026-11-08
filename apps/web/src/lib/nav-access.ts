import {
  isUltrasoundSpecialty,
  type AuthUser,
  type Permission,
  type UserRole,
} from '@avishifo/shared';

export type NavKey =
  | 'dashboard'
  | 'ai'
  | 'reception'
  | 'doctor'
  | 'patients'
  | 'admissions'
  | 'surgeries'
  | 'recordAccess'
  | 'cashier'
  | 'invoices'
  | 'expenses'
  | 'lab'
  | 'uzi'
  | 'services'
  | 'staff'
  | 'reports'
  | 'feedback'
  | 'audit'
  | 'settings'
  | 'help'
  | 'clinics'
  | 'plans'
  | 'analytics';

type NavRule = {
  key: NavKey;
  href: string;
  permissions?: Permission[];
  roles?: UserRole[];
  /** Hide even when a permission exists — scoped desks must not browse these. */
  hideForRoles?: UserRole[];
  /** Hide for ultrasound / EXO specialists (still DOCTOR role). */
  hideForUltrasound?: boolean;
};

/**
 * Single source for sidebar visibility and direct-URL guards. Lab and UZI desks
 * keep a few API permissions (patient search, service catalogue) but must not
 * open clinic-wide rosters.
 */
export const NAV_RULES: NavRule[] = [
  { key: 'dashboard', href: '/dashboard', permissions: ['reports.read'] },
  { key: 'ai', href: '/ai', permissions: ['ai.use'] },
  { key: 'reception', href: '/reception', permissions: ['queue.manage'] },
  {
    key: 'doctor',
    href: '/doctor',
    permissions: ['queue.call'],
    roles: ['DOCTOR'],
    hideForUltrasound: true,
  },
  {
    key: 'patients',
    href: '/patients',
    permissions: ['patients.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'admissions',
    href: '/admissions',
    permissions: ['admissions.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'surgeries',
    href: '/surgeries',
    permissions: ['surgery.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'recordAccess',
    href: '/patients/record-access',
    permissions: ['patients.recordAccess.manage'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  { key: 'cashier', href: '/cashier', permissions: ['payments.create'] },
  {
    key: 'invoices',
    href: '/invoices',
    permissions: ['invoices.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'expenses',
    href: '/expenses',
    permissions: ['expenses.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'lab',
    href: '/lab',
    permissions: ['lab.orders.read'],
    hideForUltrasound: true,
  },
  {
    key: 'uzi',
    href: '/uzi',
    permissions: ['visits.write', 'invoices.write'],
    hideForRoles: ['LAB_TECH'],
  },
  {
    key: 'services',
    href: '/services',
    permissions: ['services.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'staff',
    href: '/staff',
    permissions: ['staff.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'reports',
    href: '/reports',
    permissions: ['reports.read', 'reports.cash.read', 'reports.own.read'],
    hideForRoles: ['LAB_TECH'],
  },
  {
    key: 'feedback',
    href: '/feedback',
    permissions: ['feedback.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'audit',
    href: '/audit',
    permissions: ['audit.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  {
    key: 'settings',
    href: '/settings',
    permissions: ['clinic.settings.read'],
    hideForRoles: ['LAB_TECH'],
    hideForUltrasound: true,
  },
  { key: 'help', href: '/help' },
];

export const PLATFORM_NAV_RULES: NavRule[] = [
  { key: 'clinics', href: '/platform/clinics', permissions: ['platform.clinics.read'] },
  { key: 'plans', href: '/platform/plans', permissions: ['platform.plans.write'] },
  { key: 'analytics', href: '/platform/analytics', permissions: ['platform.analytics.read'] },
];

function isUltrasoundUser(user: Pick<AuthUser, 'role' | 'specialty' | 'permissions'>): boolean {
  if (user.role !== 'DOCTOR') return false;
  if (isUltrasoundSpecialty(user.specialty)) return true;
  // Fallback before specialty lands in an older persisted session: ultrasound
  // desks no longer hold admissions/lab permissions that general doctors keep.
  return (
    user.permissions.includes('visits.write') &&
    !user.permissions.includes('admissions.read') &&
    !user.permissions.includes('lab.orders.read')
  );
}

export function isNavVisible(
  rule: NavRule,
  user: Pick<AuthUser, 'role' | 'permissions' | 'specialty'>,
): boolean {
  if (rule.hideForRoles?.includes(user.role)) return false;
  if (rule.hideForUltrasound && isUltrasoundUser(user)) return false; // uses specialty + permission fingerprint
  if (rule.roles && !rule.roles.includes(user.role)) {
    if (!rule.permissions) return false;
  }
  if (!rule.permissions) return true;
  return rule.permissions.some((permission) => user.permissions.includes(permission));
}

export function visibleNavRules(
  user: Pick<AuthUser, 'role' | 'permissions' | 'specialty'>,
): NavRule[] {
  if (user.role === 'SUPER_ADMIN') return [];
  return NAV_RULES.filter((rule) => isNavVisible(rule, user));
}

/** True when this path is allowed for the signed-in desk. */
export function canAccessAppPath(
  pathname: string,
  user: Pick<AuthUser, 'role' | 'permissions' | 'specialty'>,
): boolean {
  const path = pathname.replace(/^\/(uz-Cyrl|uz|ru|en)(?=\/|$)/, '') || '/';
  if (path === '/' || path === '') return true;
  if (path.startsWith('/help') || path.startsWith('/security')) return true;
  if (path.startsWith('/doctor/visits')) {
    // UZI specialists open visits from the UZI worklist.
    return (
      user.permissions.includes('visits.write') || user.permissions.includes('visits.read')
    );
  }
  if (path.startsWith('/queue')) {
    return user.permissions.includes('queue.read') || user.permissions.includes('queue.call');
  }
  if (path.startsWith('/appointments')) {
    return user.permissions.includes('appointments.read');
  }
  if (path.startsWith('/registers')) {
    return user.permissions.includes('shifts.manage') || user.permissions.includes('shifts.oversee');
  }

  const rules = user.role === 'SUPER_ADMIN' ? PLATFORM_NAV_RULES : NAV_RULES;
  const match = [...rules]
    .sort((a, b) => b.href.length - a.href.length)
    .find((rule) => path === rule.href || path.startsWith(`${rule.href}/`));
  if (!match) {
    // Unknown app paths stay open for roles that already passed AuthGate; nav
    // rules cover the roster screens the desks must not browse.
    return true;
  }
  return isNavVisible(match, user);
}
