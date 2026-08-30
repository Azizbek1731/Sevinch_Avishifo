'use client';

import type {
  AddChargeInput,
  AdmitPatientInput,
  CreateOrderInput,
  DailyNoteInput,
  DischargeInput,
  MarkAdministrationInput,
  MoneyString,
  UpdateAdmissionInput,
} from '@avishifo/shared';
import { api } from '@/lib/api-client';

export type ChargeStatus = 'PENDING' | 'INVOICED' | 'CANCELLED';

export interface ChargeRow {
  id: string;
  admissionId: string | null;
  visitId: string | null;
  serviceId: string | null;
  /** { uz, ru, en } snapshot taken when the service was delivered. */
  title: Record<string, string> | string;
  date: string;
  quantity: number;
  unitPrice: MoneyString;
  lineTotal: MoneyString;
  status: ChargeStatus;
  createdAt: string;
}

export interface ChargeList {
  items: ChargeRow[];
  /** Total of everything still owed — what the patient would pay to clear it. */
  pendingTotal: MoneyString;
}

export interface AdmissionRow {
  id: string;
  patientId: string;
  historyNumber: string;
  status: 'ACTIVE' | 'DISCHARGED';
  department: string | null;
  ward: string | null;
  bed: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  patient?: { id: string; mrn: string; fullName: string; dob: string | null; gender: string | null };
}

export interface OrderSlot {
  /** Which dose of the day, 1-based. */
  slot: number;
  status: 'GIVEN' | 'SKIPPED' | null;
}

export interface OrderDay {
  date: string;
  slots: OrderSlot[];
}

export interface AdmissionOrder {
  id: string;
  serviceId: string;
  service: { id: string; name: Record<string, string>; code: string } | null;
  schedule: 'DAILY' | 'EVERY_OTHER_DAY' | 'ONCE';
  startDate: string;
  timesPlanned: number;
  timesPerDay: number;
  note: string | null;
  stoppedAt: string | null;
  days: OrderDay[];
}

export interface AdmissionDetail extends AdmissionRow {
  attendingDoctorUserId: string | null;
  referredBy: string | null;
  referralDiagnosis: string | null;
  admissionDiagnosis: string | null;
  clinicalDiagnosis: string | null;
  clinicalDiagnosisAt: string | null;
  finalDiagnosisMain: string | null;
  finalDiagnosisComplication: string | null;
  finalDiagnosisComorbid: string | null;
  firstTimeThisYear: boolean | null;
  outcome: string | null;
  complaints: string | null;
  anamnesisMorbi: string | null;
  anamnesisVitae: string | null;
  objectiveStatus: string | null;
  preliminaryDiagnosis: string | null;
  treatmentPlan: string | null;
  epicrisis: string | null;
  orders: AdmissionOrder[];
  dailyNotes: Array<{
    id: string;
    date: string;
    doctorUserId: string;
    condition: string;
    temperatureC: number | null;
    pulseBpm: number | null;
    bpSystolic: number | null;
    bpDiastolic: number | null;
    note: string | null;
  }>;
}

/** What the API says stands between this stay and its discharge. */
export interface DischargeCheck {
  admissionId: string;
  historyNumber: string;
  status: 'ACTIVE' | 'DISCHARGED';
  patientId: string;
  canDischarge: boolean;
  blockers: Array<'UNBILLED' | 'DEBT'>;
  unbilled: {
    count: number;
    total: MoneyString;
    items: Array<{ id: string; title: ChargeRow['title']; unitPrice: MoneyString; quantity: number }>;
  };
  stayDebt: MoneyString;
  stayInvoices: Array<{
    id: string;
    number: string;
    status: string;
    total: MoneyString;
    paidTotal: MoneyString;
    due: MoneyString;
  }>;
  otherDebt: MoneyString;
  deposit: MoneyString;
}

export const admissionsApi = {
  list: (q: { status?: string; patientId?: string; page?: number; limit?: number }) =>
    api.get<AdmissionRow[]>('/admissions', { ...q }),
  get: (id: string) => api.get<AdmissionDetail>(`/admissions/${id}`),
  admit: (body: AdmitPatientInput) => api.post<AdmissionRow>('/admissions', body),
  update: (id: string, body: UpdateAdmissionInput) => api.patch<AdmissionRow>(`/admissions/${id}`, body),
  discharge: (id: string, body: DischargeInput) => api.post<AdmissionRow>(`/admissions/${id}/discharge`, body),
  dischargeCheck: (id: string) => api.get<DischargeCheck>(`/admissions/${id}/discharge-check`),

  createOrder: (id: string, body: CreateOrderInput) =>
    api.post<{ id: string; days: string[] }>(`/admissions/${id}/orders`, body),
  stopOrder: (orderId: string) => api.delete<{ id: string }>(`/admissions/orders/${orderId}`),
  mark: (id: string, body: MarkAdministrationInput) =>
    api.post<{ id: string; status: string }>(`/admissions/${id}/administrations`, body),
  addNote: (id: string, body: DailyNoteInput) =>
    api.post<{ id: string }>(`/admissions/${id}/notes`, body),
};

export const chargesApi = {
  list: (patientId: string, status?: ChargeStatus) =>
    api.get<ChargeList>('/charges', { patientId, status }),
  add: (body: AddChargeInput) => api.post<ChargeRow>('/charges', body),
  cancel: (id: string) => api.delete<{ id: string }>(`/charges/${id}`),
  invoice: (chargeIds: string[]) =>
    api.post<{ id: string; number: string; total: MoneyString }>('/charges/invoice', { chargeIds }),
};

/** Charge titles are stored as a localized snapshot; fall back sensibly. */
export function chargeTitle(title: ChargeRow['title'], locale: string): string {
  if (typeof title === 'string') return title;
  return title[locale] ?? title.uz ?? title.ru ?? title.en ?? '—';
}
