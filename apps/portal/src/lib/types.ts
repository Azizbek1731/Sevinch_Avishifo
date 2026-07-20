import type { AppointmentStatus, InvoiceStatus, MoneyString, ResultFlag } from '@avishifo/shared';

/** GET /portal/clinics/:clinicId */
export interface PortalClinic {
  id: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
}

export interface PortalBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** Shape is backend-defined (string or per-weekday map) — narrowed at render time. */
  workingHours: unknown;
}

export interface PortalDoctor {
  userId: string;
  fullName: string;
  specialty: string | null;
  photoUrl: string | null;
}

export interface PortalService {
  id: string;
  name: { uz: string; ru?: string; en?: string };
  price: MoneyString;
}

export interface PortalClinicInfo {
  clinic: PortalClinic;
  branches: PortalBranch[];
  doctors: PortalDoctor[];
  services: PortalService[];
}

/** GET /portal/slots */
export interface PortalSlot {
  startAt: string;
  endAt: string;
}

/** POST /portal/book (minimal fields the UI relies on) */
export interface PortalBookedAppointment {
  id: string;
  startAt: string;
  status: AppointmentStatus;
}

/** GET /portal/me */
export interface PortalPatientCard {
  clinicId: string;
  clinicName: string;
  patientId: string;
  mrn: string;
  fullName: string;
}

/** GET /portal/me/appointments */
export interface PortalAppointment {
  id: string;
  clinicName: string;
  doctorName: string;
  startAt: string;
  status: AppointmentStatus;
}

export interface PortalDiagnosis {
  code: string;
  nameUz: string;
  nameRu: string;
  nameEn: string | null;
  isPrimary: boolean;
}

/** GET /portal/me/visits (list) */
export interface PortalVisit {
  id: string;
  clinicId: string;
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string | null;
  startedAt: string;
  completedAt: string | null;
  diagnoses: PortalDiagnosis[];
  prescriptionCount: number;
}

export interface PortalVitals {
  heightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: number | null;
  spo2: number | null;
}

export interface PortalPrescription {
  drugName: string;
  dosage: string | null;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
}

/** GET /portal/me/visits/:id (full medical-history detail) */
export interface PortalVisitDetail {
  id: string;
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string | null;
  startedAt: string;
  completedAt: string | null;
  nextVisitAt: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  vitals: PortalVitals | null;
  diagnoses: Array<PortalDiagnosis & { note: string | null }>;
  prescriptions: PortalPrescription[];
  referrals: Array<{ type: string; targetSpecialty: string | null }>;
}

/** GET /portal/me/lab-results */
export interface PortalLabValue {
  parameter: string;
  value: string;
  unit: string | null;
  flag: ResultFlag | null;
  referenceText: string | null;
}

export interface PortalLabItem {
  testName: string;
  values: PortalLabValue[];
}

export interface PortalLabResult {
  id: string;
  orderNumber: string;
  date: string;
  clinicName: string;
  items: PortalLabItem[];
}

/** GET /portal/me/invoices */
export interface PortalInvoice {
  id: string;
  number: string;
  date: string;
  clinicName: string;
  total: MoneyString;
  paidTotal: MoneyString;
  status: InvoiceStatus;
}

/** Telegram link status (part of the profile). */
export interface PortalTelegramStatus {
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  /** Bot @username for building the t.me deep link (null if not configured). */
  botUsername: string | null;
  enabled: boolean;
}

export interface PortalNotificationPrefs {
  appointments: boolean;
  results: boolean;
  payments: boolean;
  promos: boolean;
}

/** GET /portal/me/profile */
export interface PortalProfile {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  /** "YYYY-MM-DD" or null. */
  dob: string | null;
  gender: string | null;
  preferredLocale: string;
  phoneVerified: boolean;
  memberSince: string;
  telegram: PortalTelegramStatus;
  prefs: PortalNotificationPrefs;
  clinics: PortalPatientCard[];
  stats: {
    upcomingAppointments: number;
    visits: number;
    documents: number;
    labResults: number;
  };
}

/** GET /portal/me/documents */
export interface PortalDocument {
  id: string;
  clinicId: string;
  clinicName: string;
  category: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** POST /portal/me/telegram/link */
export interface PortalTelegramLinkToken {
  token: string;
  deepLink: string | null;
  botUsername: string | null;
  enabled: boolean;
}
