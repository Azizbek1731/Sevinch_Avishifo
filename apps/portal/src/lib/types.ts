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

/** GET /portal/me/visits */
export interface PortalVisit {
  id: string;
  date: string;
  clinicName: string;
  doctorName: string;
  diagnoses: string[];
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
