'use client';

import type {
  AddDiagnosisInput,
  AddPrescriptionInput,
  ReplacePrescriptionsInput,
  AddReferralInput,
  AmendVisitInput,
  Gender,
  QueueKind,
  QueueTicketPayload,
  ReferralType,
  UpdateVisitInput,
  UpsertVitalsInput,
  VisitStatus,
  VisitTemplateUpsertInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ------------------------------------------------------------ types

export interface QueueListItem {
  id: string;
  branchId: string;
  kind: QueueKind;
  doctorUserId: string | null;
  doctorName: string | null;
  prefix: string;
  date: string;
  lastNumber: number;
  isOpen: boolean;
  tickets: QueueTicketPayload[];
}

export interface RoomItem {
  id: string;
  branchId: string;
  number: string;
  name: string | null;
  type: string;
  isActive: boolean;
}

export interface AllergyItem {
  name: string;
  severity?: 'low' | 'medium' | 'high';
  note?: string;
}

export interface PatientCard {
  id: string;
  mrn: string;
  fullName: string;
  dob: string | null;
  age: number | null;
  gender: Gender | null;
  phone: string | null;
  bloodGroup: string | null;
  allergies: unknown;
  chronicConditions: string[];
  notes: string | null;
  tags: string[];
  visitCount: number;
}

export interface Icd10Item {
  id: string;
  code: string;
  nameUz: string;
  nameRu: string | null;
  nameEn: string | null;
  chapter: string | null;
}

export interface DrugItem {
  id: string;
  clinicId: string | null;
  name: string;
  form: string | null;
  strength: string | null;
}

export interface LabTestItem {
  id: string;
  code: string;
  name: Record<string, string>;
  specimenType: string | null;
  isActive: boolean;
}

export interface VisitVitals {
  id: string;
  heightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: number | null;
  spo2: number | null;
  note: string | null;
  recordedById: string | null;
  recordedAt: string | null;
}

export interface VisitDiagnosis {
  id: string;
  icd10Id: string;
  isPrimary: boolean;
  note: string | null;
  createdAt: string | null;
  icd10: {
    id: string;
    code: string;
    nameUz: string;
    nameRu: string | null;
    nameEn: string | null;
  };
}

export interface VisitPrescription {
  id: string;
  drugName: string;
  drugId: string | null;
  strength: string | null;
  form: string | null;
  quantity: string | null;
  route: string | null;
  durationText: string | null;
  dripRate: string | null;
  combineWithPrevious: boolean;
  sortOrder: number;
  dosage: string | null;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
  createdAt: string | null;
  drug: { id: string; name: string; form: string | null; strength: string | null } | null;
}

export interface VisitReferralClinicalOrder {
  id: string;
  kind?: 'CONSULTATION' | 'ULTRASOUND';
  status: 'WAITING_PAYMENT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  visitId: string | null;
  doctorUserId: string;
  services: Array<{ id: string; title: string | Record<string, string> }>;
  invoice: { id: string; number: string; status: string; due: string };
}

export interface VisitReferral {
  id: string;
  type: ReferralType;
  targetSpecialty: string | null;
  targetDoctorUserId: string | null;
  labOrderId: string | null;
  clinicalOrderId: string | null;
  clinicalOrder: VisitReferralClinicalOrder | null;
  appointmentId: string | null;
  note: string | null;
  createdAt: string | null;
}

export interface VisitDetail {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  clinicalOrderId: string | null;
  reportTitle: string | null;
  reportBody: string | null;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  appointmentId: string | null;
  ticketId: string | null;
  status: VisitStatus;
  subjective: string | null;
  objective: string | null;
  assessmentNote: string | null;
  plan: string | null;
  physiotherapy: string | null;
  prescriptionRevision: number;
  startedAt: string | null;
  completedAt: string | null;
  nextVisitAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  vitals: VisitVitals | null;
  diagnoses: VisitDiagnosis[];
  prescriptions: VisitPrescription[];
  referrals: VisitReferral[];
  patient: {
    id: string;
    mrn: string;
    fullName: string;
    dob: string | null;
    gender: Gender | null;
    phone: string | null;
    allergies: unknown;
    chronicConditions: string[];
  };
  doctor: { id: string; fullName: string; specialty: string | null };
}

export interface VisitListItem {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  reportTitle: string | null;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  nextVisitAt: string | null;
  patient: { id: string; mrn: string; fullName: string };
  doctor: { id: string; fullName: string };
}

export interface VisitTemplate {
  id: string;
  name: string;
  specialty: string | null;
  content: { subjective?: string; objective?: string; plan?: string };
  isActive: boolean;
}

export interface VisitPrintPayload {
  clinic: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
  };
  visit: VisitDetail;
  patient: { fullName: string; dob: string | null; mrn: string };
  doctor: { fullName: string; specialty: string | null };
}

/** Parse the patient's allergies JSON defensively (server types it as unknown). */
export function parseAllergies(raw: unknown): AllergyItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AllergyItem[] => {
    if (typeof item === 'string') return [{ name: item }];
    if (item !== null && typeof item === 'object' && 'name' in item) {
      const o = item as { name: unknown; severity?: unknown; note?: unknown };
      if (typeof o.name === 'string') {
        return [
          {
            name: o.name,
            severity:
              o.severity === 'low' || o.severity === 'medium' || o.severity === 'high'
                ? o.severity
                : undefined,
            note: typeof o.note === 'string' ? o.note : undefined,
          },
        ];
      }
    }
    return [];
  });
}

// ------------------------------------------------------------ queue

export const doctorApi = {
  getQueues: (branchId: string, date: string) =>
    api.get<QueueListItem[]>('/queues', { branchId, date }),
  callNext: (queueId: string, roomId: string | null) =>
    api.post<QueueTicketPayload>(`/queues/${queueId}/call-next`, roomId ? { roomId } : {}),
  ticketAction: (ticketId: string, action: 'start' | 'finish' | 'skip' | 'recall') =>
    api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/${action}`),
  listRooms: (branchId: string) =>
    api.get<RoomItem[]>(`/branches/${branchId}/rooms`, { limit: 100 }),
  getPatient: (patientId: string) => api.get<PatientCard>(`/patients/${patientId}`),

  // ------------------------------------------------------------ visits
  createVisit: (ticketId: string) => api.post<VisitDetail>('/visits', { ticketId }),
  getVisit: (id: string) => api.get<VisitDetail>(`/visits/${id}`),
  listVisits: (params: {
    doctorUserId?: string;
    patientId?: string;
    page?: number;
    limit?: number;
  }) => api.get<VisitListItem[]>('/visits', params),
  updateVisit: (id: string, body: UpdateVisitInput) =>
    api.patch<VisitDetail>(`/visits/${id}`, body),
  amendVisit: (id: string, body: AmendVisitInput) =>
    api.post<{ id: string; visit: VisitDetail }>(`/visits/${id}/amendments`, body),
  completeVisit: (id: string) => api.post<VisitDetail>(`/visits/${id}/complete`),
  upsertVitals: (id: string, body: UpsertVitalsInput) =>
    api.put<VisitVitals | null>(`/visits/${id}/vitals`, body),
  addDiagnosis: (id: string, body: AddDiagnosisInput) =>
    api.post<VisitDiagnosis>(`/visits/${id}/diagnoses`, body),
  removeDiagnosis: (id: string, dxId: string) =>
    api.delete<{ id: string }>(`/visits/${id}/diagnoses/${dxId}`),
  replacePrescriptions: (id: string, body: ReplacePrescriptionsInput) =>
    api.put<{
      prescriptions: VisitPrescription[];
      prescriptionRevision: number;
      physiotherapy: string | null;
    }>(`/visits/${id}/prescriptions`, body),
  addPrescription: (id: string, body: AddPrescriptionInput) =>
    api.post<VisitPrescription>(`/visits/${id}/prescriptions`, body),
  removePrescription: (id: string, rxId: string) =>
    api.delete<{ id: string }>(`/visits/${id}/prescriptions/${rxId}`),
  addReferral: (id: string, body: AddReferralInput) =>
    api.post<VisitReferral>(`/visits/${id}/referrals`, body),
  getPrintPayload: (id: string) => api.get<VisitPrintPayload>(`/visits/${id}/print`),

  // ------------------------------------------------------------ directories
  searchIcd10: (search: string) => api.get<Icd10Item[]>('/icd10', { search, limit: 20 }),
  searchDrugs: (search: string) => api.get<DrugItem[]>('/drugs', { search, limit: 20 }),
  listLabTests: (search?: string) =>
    api.getAll<LabTestItem>('/lab-tests', { search: search || undefined }),
  listTemplates: () => api.get<VisitTemplate[]>('/visit-templates', { limit: 100 }),
  createTemplate: (body: VisitTemplateUpsertInput) =>
    api.post<VisitTemplate>('/visit-templates', body),
} as const;

export type DoctorApiResult<T> = ApiResult<T>;
