import { UserRole } from './enums';

/**
 * Granular permission strings (`module.action`). Roles are bundles of these;
 * per-user overrides (grant/revoke) are applied on top (see User.permissionOverrides).
 */
export const PERMISSIONS = [
  // Patients (M3)
  'patients.read',
  'patients.write',
  'patients.delete',
  'patients.merge',
  'patients.export',
  'patients.documents.write',
  // Deciding whether a patient may read their own clinical history in the
  // portal. Kept separate from patients.write: a receptionist edits patient
  // cards all day, but releasing diagnoses is a clinical call.
  'patients.recordAccess.manage',
  // Appointments (M4)
  'appointments.read',
  'appointments.write',
  'appointments.cancel',
  // Queue (M5)
  'queue.read',
  'queue.manage', // add walk-in, reorder, transfer, priority
  'queue.call', // doctor actions: call/start/finish/skip/recall
  // Visits / EHR (M6)
  'visits.read',
  'visits.read.all', // branch-wide, not only own patients
  'visits.write',
  'visits.amend',
  // Services & pricing (M7)
  'services.read',
  'services.write',
  // Billing (M8)
  'invoices.read',
  'invoices.write',
  'invoices.cancel',
  'payments.create',
  /**
   * Reversing a payment entered by mistake. Separate from refunds.create: a
   * refund gives money back, a void says it was never taken. The people who
   * mistype an amount are the ones who must be able to correct it, so this sits
   * with the front desk rather than with the owner.
   */
  'payments.void',
  'refunds.create',
  'shifts.manage',
  /**
   * See every register in the clinic, live, without holding one.
   *
   * Deliberately separate from shifts.manage, which means "I am holding a
   * drawer". An owner who only wants to check the till should not have to open
   * a drawer of their own — doing exactly that is what made two accounts show
   * two different totals.
   */
  'shifts.oversee',
  'debts.read',
  'expenses.read',
  'expenses.write',
  // Lab (M9)
  'lab.orders.read',
  'lab.orders.write',
  'lab.results.write',
  'lab.results.approve',
  // Reports (M12)
  'reports.read',
  'reports.export',
  // Staff & schedules (M11)
  'staff.read',
  'staff.write',
  'schedules.read',
  'schedules.write',
  'payroll.read',
  'payroll.write',
  // Clinic administration (M2)
  'clinic.settings.read',
  'clinic.settings.write',
  'branches.write',
  'users.read',
  'users.write',
  // Notifications (M13)
  'notifications.templates.read',
  'notifications.templates.write',
  'notifications.send',
  // Feedback (M15)
  'feedback.read',
  // Audit (M16)
  'audit.read',
  /**
   * Seeing what the front desk deleted. A voided payment or a removed patient
   * vanishes for whoever removed it and stays visible, marked, for the clinic's
   * own management — otherwise a correction is indistinguishable from a
   * takings shortfall nobody can explain.
   */
  'records.viewDeleted',
  // AviShifo AI — asking questions about this clinic's own data in natural
  // language. Separate from reports.read: the assistant can only ever surface
  // what the caller could already open in the panel, but sending anything to a
  // model provider is a decision a clinic makes deliberately.
  'ai.use',
  // Platform / super-admin (M17)
  'platform.clinics.read',
  'platform.clinics.write',
  'platform.plans.write',
  'platform.analytics.read',
  'platform.impersonate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_CLINIC_PERMISSIONS = PERMISSIONS.filter((p) => !p.startsWith('platform.'));

/** Default permission bundle per role (spec §5). */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.SUPER_ADMIN]: PERMISSIONS,
  [UserRole.CLINIC_OWNER]: ALL_CLINIC_PERMISSIONS,
  [UserRole.CLINIC_ADMIN]: [
    'patients.read',
    'patients.write',
    'patients.merge',
    'patients.export',
    'patients.documents.write',
    'patients.delete',
    'patients.recordAccess.manage',
    'ai.use',
    'payments.void',
    // The clinic's own management is who "deleted" stays visible for.
    'records.viewDeleted',
    'appointments.read',
    'appointments.write',
    'appointments.cancel',
    'queue.read',
    'queue.manage',
    'visits.read',
    'visits.read.all',
    'services.read',
    'services.write',
    'invoices.read',
    'debts.read',
    'expenses.read',
    'expenses.write',
    'lab.orders.read',
    'reports.read',
    'reports.export',
    'shifts.oversee',
    'staff.read',
    'staff.write',
    'schedules.read',
    'schedules.write',
    'clinic.settings.read',
    'users.read',
    'users.write',
    'notifications.templates.read',
    'notifications.templates.write',
    'feedback.read',
  ],
  [UserRole.DOCTOR]: [
    'patients.read',
    'patients.recordAccess.manage',
    'appointments.read',
    'queue.read',
    'queue.call',
    'visits.read',
    'visits.write',
    'visits.amend',
    'services.read',
    'lab.orders.read',
    'lab.orders.write',
    'schedules.read',
    'payroll.read', // own KPI/accruals only (object-level check in service)
  ],
  [UserRole.NURSE]: [
    'patients.read',
    'appointments.read',
    'queue.read',
    'visits.read',
    'visits.write', // vitals entry; service restricts to vitals-level edits
    'services.read',
    'schedules.read',
  ],
  // Small clinics run the cash desk from the front desk: the receptionist books
  // the visit, sells the services and takes the money. Refunds stay with the
  // cashier/owner (they need a second pair of eyes).
  [UserRole.RECEPTIONIST]: [
    'patients.read',
    'patients.write',
    'patients.delete',
    'patients.documents.write',
    'appointments.read',
    'appointments.write',
    'appointments.cancel',
    'queue.read',
    'queue.manage',
    'services.read',
    'invoices.read',
    'invoices.write',
    'payments.create',
    'payments.void',
    'shifts.manage',
    // Reception holds a drawer too — it has shifts.manage and takes payments —
    // so money leaving that drawer has to be recordable by the person holding
    // it. Cash expenses still come out of their OWN open shift, so nothing
    // here lets one desk spend from another's till.
    'expenses.read',
    'expenses.write',
    'debts.read',
    'schedules.read',
  ],
  [UserRole.CASHIER]: [
    'patients.read',
    'patients.delete',
    'invoices.read',
    'invoices.write',
    'invoices.cancel',
    'payments.create',
    'payments.void',
    'refunds.create',
    'shifts.manage',
    'debts.read',
    'services.read',
    // Cash leaves the drawer through this desk, so the person holding the
    // drawer has to be able to record it — otherwise the money is gone and the
    // shift is short with nothing to point at.
    'expenses.read',
    'expenses.write',
  ],
  [UserRole.LAB_TECH]: [
    'patients.read',
    'queue.read',
    'lab.orders.read',
    'lab.orders.write',
    'lab.results.write',
    'lab.results.approve',
    'services.read',
  ],
  [UserRole.ACCOUNTANT]: [
    'invoices.read',
    'debts.read',
    'expenses.read',
    'expenses.write',
    'reports.read',
    'reports.export',
    'payroll.read',
    'payroll.write',
    'services.read',
    'shifts.manage',
    'shifts.oversee',
  ],
  [UserRole.PATIENT]: [],
};

export function permissionsForRole(
  role: UserRole,
  overrides?: { grant?: readonly string[]; revoke?: readonly string[] },
): Permission[] {
  const base = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  for (const p of overrides?.grant ?? []) {
    if ((PERMISSIONS as readonly string[]).includes(p)) base.add(p as Permission);
  }
  for (const p of overrides?.revoke ?? []) base.delete(p as Permission);
  return [...base];
}
