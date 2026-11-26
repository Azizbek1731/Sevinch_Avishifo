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
   * mistype an amount are the ones who must be able to correct it, so cashiers
   * and clinic management receive this permission.
   */
  'payments.void',
  'refunds.create',
  // Statsionar
  'admissions.read',
  'admissions.write',
  'admissions.export',
  /// Marking the treatment sheet — the ward nurse and the desk, not only doctors.
  'admissions.administer',
  /**
   * Close or remove a stay that still has loose ends — services not yet on a
   * bill, or a bill not yet paid. The ward must never be a room a patient
   * cannot be let out of: the bed is physical, the paperwork can be finished
   * afterwards, and what was outstanding is recorded rather than forgotten.
   */
  'admissions.force',
  // Ambulator: doctors see only their own cards and lab share (object-level check).
  'ambulatory.read',
  'ambulatory.write',
  /** Setting the doctors' lab share percent is a management decision. */
  'ambulatory.rates.write',
  'charges.read',
  'charges.write',
  'surgery.read',
  'surgery.schedule',
  'surgery.record',
  'surgery.payout',
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
  'reports.cash.read',
  'reports.cash.export',
  /** Own consultations and outbound lab/UZI referrals — doctors only see themselves. */
  'reports.own.read',
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
    'surgery.read', 'surgery.schedule', 'surgery.record',
    'patients.read',
    'admissions.read',
    'admissions.write',
    'admissions.export',
    'admissions.administer',
    'admissions.force',
    'ambulatory.read',
    'ambulatory.write',
    'ambulatory.rates.write',
    'charges.read',
    'charges.write',
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
    'reports.cash.read',
    'reports.cash.export',
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
    'surgery.read',
    'patients.read',
    'admissions.read',
    'admissions.write',
    'ambulatory.read',
    'ambulatory.write',
    'charges.read',
    'charges.write',
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
    'reports.own.read',
  ],
  [UserRole.NURSE]: [
    'patients.read',
    'admissions.read',
    'admissions.administer',
    'charges.read',
    'appointments.read',
    'queue.read',
    'visits.read',
    'visits.write', // vitals entry; service restricts to vitals-level edits
    'services.read',
    'schedules.read',
  ],
  // Reception prepares patient care and invoices; the cashier handles money.
  [UserRole.RECEPTIONIST]: [
    'surgery.read', 'surgery.schedule',
    'patients.read',
    // The desk answers "tahlil tayyormi?" / "xulosa tayyormi?" from the patient
    // card, ambulatory card and inpatient reports, and prints the ready PDF.
    'lab.orders.read',
    'lab.orders.write',
    'visits.read',
    'admissions.read',
    'admissions.write',
    'admissions.export',
    'admissions.administer',
    'ambulatory.read',
    'ambulatory.write',
    'charges.read',
    'charges.write',
    'patients.write',
    'patients.export',
    'patients.documents.write',
    'appointments.read',
    'appointments.write',
    'appointments.cancel',
    'queue.read',
    'queue.manage',
    'services.read',
    'invoices.read',
    'invoices.write',
    'debts.read',
    'schedules.read',
  ],
  [UserRole.CASHIER]: [
    'surgery.read', 'surgery.payout',
    'patients.read',
    'admissions.read',
    'charges.read',
    'invoices.read',
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
    'reports.cash.read',
    'reports.cash.export',
  ],
  // Lab desk: own worklist + test catalogue lookup. No clinic-wide patient /
  // inpatient / services admin screens (nav hides those even when a permission
  // is kept for embedded patient search on a new lab order).
  [UserRole.LAB_TECH]: [
    'patients.read',
    'lab.orders.read',
    'lab.orders.write',
    'lab.results.write',
    'lab.results.approve',
    'services.read',
  ],
  [UserRole.OPERATING_ROOM]: [
    'surgery.read',
    'surgery.record',
    'services.read',
  ],
  [UserRole.ACCOUNTANT]: [
    'surgery.read',
    'invoices.read',
    'admissions.read',
    'ambulatory.read',
    'charges.read',
    'debts.read',
    'expenses.read',
    'expenses.write',
    'reports.read',
    'reports.export',
    'reports.cash.read',
    'reports.cash.export',
    'payroll.read',
    'payroll.write',
    'services.read',
    'shifts.manage',
    'shifts.oversee',
  ],
  [UserRole.PATIENT]: [],
};

/**
 * Ultrasound / EXO / UTT specialists are DOCTOR accounts, but their desk is
 * the UZI worklist — not the full ward / surgery / lab roster that a general
 * clinician sees. Permissions that unlock those screens are stripped here;
 * grant overrides can still re-open a permission if a clinic needs it.
 */
export const ULTRASOUND_DOCTOR_PERMISSIONS = [
  'patients.read',
  'queue.read',
  'queue.call',
  'visits.read',
  'visits.write',
  'visits.amend',
  'services.read',
  'schedules.read',
  'payroll.read',
  'reports.own.read',
] as const satisfies readonly Permission[];

/** Specialty strings that mean "this doctor is an ultrasound specialist". */
export function isUltrasoundSpecialty(specialty: string | null | undefined): boolean {
  if (!specialty) return false;
  const value = specialty.toLowerCase();
  return (
    value.includes('uzi') ||
    value.includes('utt') ||
    value.includes('узи') ||
    value.includes('узд') ||
    value.includes('ultrasound') ||
    value.includes('exo') ||
    value.includes('эхо')
  );
}

/**
 * Ultrasound catalogue folders named for echo (EXO) — their services count as EXO,
 * not regular UZI, for referring-doctor shares and performer reports.
 */
export function categoryNameLooksLikeEcho(name: string | null | undefined): boolean {
  if (!name) return false;
  const value = name.toLowerCase();
  return value.includes('exo') || value.includes('echo') || value.includes('эхо');
}

export function permissionsForRole(
  role: UserRole,
  overrides?: { grant?: readonly string[]; revoke?: readonly string[] },
  options?: { specialty?: string | null },
): Permission[] {
  const base = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  if (role === UserRole.DOCTOR && isUltrasoundSpecialty(options?.specialty)) {
    const allowed = new Set<string>(ULTRASOUND_DOCTOR_PERMISSIONS);
    for (const permission of [...base]) {
      if (!allowed.has(permission)) base.delete(permission);
    }
  }
  for (const p of overrides?.grant ?? []) {
    if ((PERMISSIONS as readonly string[]).includes(p)) base.add(p as Permission);
  }
  for (const p of overrides?.revoke ?? []) base.delete(p as Permission);
  return [...base];
}
