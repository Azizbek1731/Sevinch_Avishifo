import type { CreateClinicalOrderInput, AddClinicalServicesInput } from '@avishifo/shared';
import { api } from '@/lib/api-client';

export type ClinicalKind = 'CONSULTATION' | 'ULTRASOUND';
export type ClinicalStatus =
  'WAITING_PAYMENT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface ClinicalOrder {
  id: string;
  kind: ClinicalKind;
  patient: { id: string; mrn: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string };
  status: ClinicalStatus;
  visitId: string | null;
  invoice: {
    id: string;
    number: string;
    total: string;
    paidTotal: string;
    due: string;
    status: string;
  };
  additionalDue: string;
  services: Array<{ id: string; title: string | Record<string, string>; quantity: number }>;
  createdAt: string;
}
export interface ClinicalOrderQuery {
  kind?: ClinicalKind;
  patientId?: string;
  mine?: boolean;
  page?: number;
  limit?: number;
  status?: ClinicalStatus;
  search?: string;
}
export interface ClinicalDoctorOption {
  id: string;
  fullName: string;
  specialty: string | null;
}
export const clinicalOrdersApi = {
  doctors: () => api.get<ClinicalDoctorOption[]>('/clinical-orders/doctors'),
  list: (query: ClinicalOrderQuery) => api.get<ClinicalOrder[]>('/clinical-orders', { ...query }),
  get: (id: string) => api.get<ClinicalOrder>(`/clinical-orders/${id}`),
  create: (body: CreateClinicalOrderInput) => api.post<ClinicalOrder>('/clinical-orders', body),
  start: (id: string) => api.post<{ visitId: string }>(`/clinical-orders/${id}/start`),
  addServices: (id: string, body: AddClinicalServicesInput) =>
    api.post<{ invoiceId: string; number: string; total: string }>(
      `/clinical-orders/${id}/services`,
      body,
    ),
};
