'use client';

import type {
  AmbulatoryCommissionOrder,
  AmbulatoryCommissionReport,
  AmbulatoryCommissionTotals,
  AmbulatoryLabOrderInput,
  AmbulatoryRates,
  AmbulatoryRatesInput,
  AmbulatoryUziOrderInput,
  MoneyString,
  OpenAmbulatoryCaseInput,
  UpdateAmbulatoryCaseInput,
} from '@avishifo/shared';
import { api } from '@/lib/api-client';

export type AmbulatoryStatus = 'OPEN' | 'CLOSED';

export interface AmbulatoryCaseRow {
  id: string;
  branchId: string;
  patientId: string;
  number: string;
  status: AmbulatoryStatus;
  doctorUserId: string;
  doctorName: string;
  complaint: string | null;
  diagnosis: string | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  patient?: {
    id: string;
    mrn: string;
    fullName: string;
    phone: string | null;
    dob: string | null;
    gender: string | null;
  };
  labOrders?: number;
  uziOrders?: number;
  labAmount?: MoneyString;
  paidAmount?: MoneyString;
  commission?: MoneyString;
  pendingCommission?: MoneyString;
}

export interface AmbulatoryLabOrder extends AmbulatoryCommissionOrder {
  status: string;
  cancelled: boolean;
}

export interface AmbulatoryUziOrder {
  id: string;
  status: 'WAITING_PAYMENT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  doctor: { id: string; fullName: string };
  visitId: string | null;
  invoice: { id: string; number: string; status: string; total: MoneyString; paidTotal: MoneyString; due: MoneyString };
  services: { id: string; title: Record<string, string> | string; quantity: number }[];
  note: string | null;
  createdAt: string;
}

export interface AmbulatoryCaseDetail
  extends Omit<AmbulatoryCaseRow, 'labOrders' | 'uziOrders' | 'patient'> {
  patient: NonNullable<AmbulatoryCaseRow['patient']> & { address: string | null };
  currentPercent: number;
  activeStay: { id: string; historyNumber: string } | null;
  totals: AmbulatoryCommissionTotals;
  labOrders: AmbulatoryLabOrder[];
  uziOrders: AmbulatoryUziOrder[];
  consultations: AmbulatoryUziOrder[];
}

export interface AmbulatoryListQuery {
  status?: AmbulatoryStatus;
  search?: string;
  doctorUserId?: string;
  patientId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface CommissionQuery {
  from: string;
  to: string;
  doctorUserId?: string;
}

export const ambulatoryApi = {
  list: (q: AmbulatoryListQuery) => api.get<AmbulatoryCaseRow[]>('/ambulatory', { ...q }),
  get: (id: string) => api.get<AmbulatoryCaseDetail>(`/ambulatory/${id}`),
  open: (body: OpenAmbulatoryCaseInput) => api.post<AmbulatoryCaseRow>('/ambulatory', body),
  update: (id: string, body: UpdateAmbulatoryCaseInput) =>
    api.patch<AmbulatoryCaseDetail>(`/ambulatory/${id}`, body),
  close: (id: string) => api.post<AmbulatoryCaseDetail>(`/ambulatory/${id}/close`),
  reopen: (id: string) => api.post<AmbulatoryCaseDetail>(`/ambulatory/${id}/reopen`),
  remove: (id: string) => api.delete<{ id: string }>(`/ambulatory/${id}`),
  sendLab: (id: string, body: AmbulatoryLabOrderInput) =>
    api.post<AmbulatoryCaseDetail>(`/ambulatory/${id}/lab`, body),
  sendUzi: (id: string, body: AmbulatoryUziOrderInput) =>
    api.post<AmbulatoryCaseDetail>(`/ambulatory/${id}/uzi`, body),
  commissions: (q: CommissionQuery) =>
    api.get<AmbulatoryCommissionReport>('/ambulatory/commissions', { ...q }),
  exportCommissions: async (q: CommissionQuery): Promise<Blob> =>
    (await api.get<Blob>('/ambulatory/commissions', { ...q, export: 'xlsx' })).data,
  rates: () => api.get<AmbulatoryRates>('/ambulatory/rates'),
  saveRates: (body: AmbulatoryRatesInput) => api.put<AmbulatoryRates>('/ambulatory/rates', body),
};
