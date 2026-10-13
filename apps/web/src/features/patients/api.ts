'use client';

import type {
  ApiMeta,
  BalanceTransactionType,
  CreatePatientInput,
  DocumentCategory,
  Gender,
  InvoiceStatus,
  MergePatientsInput,
  UpdatePatientInput,
  VisitStatus,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ------------------------------------------------------------------ types

export interface PatientAllergy {
  name: string;
  severity?: 'low' | 'medium' | 'high';
  note?: string;
}

export interface Patient {
  /** Ambulator or statsionar — decides which screens the card shows. */
  careType: 'AMBULATORY' | 'INPATIENT';
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  dob: string | null;
  age: number | null;
  gender: Gender | null;
  phone: string | null;
  phoneAlt: string | null;
  address: string | null;
  passportId: string | null;
  bloodGroup: string;
  allergies: PatientAllergy[];
  chronicConditions: string[];
  notes: string | null;
  photoUrl: string | null;
  source: string | null;
  tags: string[];
  noShowCount: number;
  visitCount: number;
  balance: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PatientCard extends Patient {
  /** Unpaid remainder across open invoices ("0.00" when the patient is clear). */
  debt: string;
  counts: { visits: number; invoices: number; documents: number };
}

export interface DuplicateCandidate {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

export const TIMELINE_TYPES = [
  'visit',
  'diagnosis',
  'prescription',
  'lab',
  'document',
  'payment',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

export interface TimelineItem {
  type: TimelineType;
  at: string;
  title: string;
  data: Record<string, unknown>;
}

export interface PatientDocument {
  id: string;
  patientId: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PatientConsent {
  id: string;
  type: string;
  signedAt: string;
  note: string | null;
  createdAt: string;
}

export interface BalanceTransaction {
  id: string;
  patientId: string;
  type: BalanceTransactionType;
  amount: string;
  invoiceId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface PatientBalance {
  balance: string;
  transactions: { items: BalanceTransaction[]; meta: ApiMeta };
}

export interface PatientInvoice {
  id: string;
  number: string;
  patientId: string;
  status: InvoiceStatus;
  subtotal: string;
  discountTotal: string;
  total: string;
  paidTotal: string;
  due: string;
  note: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface PatientVisit {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  reportTitle: string | null;
  patientId: string;
  doctorUserId: string;
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  nextVisitAt: string | null;
  patient: { id: string; mrn: string; fullName: string };
  doctor: { id: string; fullName: string };
}

export interface PatientListQuery {
  page: number;
  limit: number;
  search?: string;
  tag?: string;
  /** Include cards the front desk removed. Honoured only with records.viewDeleted. */
  deleted?: boolean;
  sort?: string;
}

// --------------------------------------------------------------- fetchers

export const patientsApi = {
  list: (q: PatientListQuery): Promise<ApiResult<Patient[]>> =>
    api.get<Patient[]>('/patients', { ...q }),

  create: (body: CreatePatientInput, force: boolean): Promise<ApiResult<Patient>> =>
    api.post<Patient>('/patients', body, force ? { force: 'true' } : undefined),

  getById: (id: string): Promise<ApiResult<PatientCard>> => api.get<PatientCard>(`/patients/${id}`),

  update: (id: string, body: UpdatePatientInput): Promise<ApiResult<Patient>> =>
    api.patch<Patient>(`/patients/${id}`, body),

  remove: (id: string): Promise<ApiResult<{ id: string }>> =>
    api.delete<{ id: string }>(`/patients/${id}`),

  merge: (body: MergePatientsInput): Promise<ApiResult<{ primaryId: string; duplicateId: string }>> =>
    api.post<{ primaryId: string; duplicateId: string }>('/patients/merge', body),

  timeline: (
    id: string,
    q: { page: number; limit: number; type?: TimelineType },
  ): Promise<ApiResult<TimelineItem[]>> => api.get<TimelineItem[]>(`/patients/${id}/timeline`, { ...q }),

  documents: (id: string, q: { page: number; limit: number }): Promise<ApiResult<PatientDocument[]>> =>
    api.get<PatientDocument[]>(`/patients/${id}/documents`, { ...q }),

  uploadDocument: (id: string, form: FormData): Promise<ApiResult<PatientDocument>> =>
    api.upload<PatientDocument>(`/patients/${id}/documents`, form),

  downloadDocument: (docId: string): Promise<ApiResult<Blob>> =>
    api.get<Blob>(`/patients/documents/${docId}/download`),

  removeDocument: (docId: string): Promise<ApiResult<{ id: string }>> =>
    api.delete<{ id: string }>(`/patients/documents/${docId}`),

  consents: (id: string, q: { page: number; limit: number }): Promise<ApiResult<PatientConsent[]>> =>
    api.get<PatientConsent[]>(`/patients/${id}/consents`, { ...q }),

  addConsent: (
    id: string,
    body: { type: string; signedAt: string; note?: string },
  ): Promise<ApiResult<PatientConsent>> => api.post<PatientConsent>(`/patients/${id}/consents`, body),

  balance: (id: string, q: { page: number; limit: number }): Promise<ApiResult<PatientBalance>> =>
    api.get<PatientBalance>(`/patients/${id}/balance`, { ...q }),

  invoices: (
    patientId: string,
    q: { page: number; limit: number },
  ): Promise<ApiResult<PatientInvoice[]>> => api.get<PatientInvoice[]>('/invoices', { patientId, ...q }),

  visits: (
    patientId: string,
    q: { page: number; limit: number },
  ): Promise<ApiResult<PatientVisit[]>> => api.get<PatientVisit[]>('/visits', { patientId, ...q }),
};
