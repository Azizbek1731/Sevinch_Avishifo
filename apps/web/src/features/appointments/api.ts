import { api } from '@/lib/api-client';
import type {
  AppointmentStatus,
  ChangeAppointmentStatusInput,
  CreateAppointmentInput,
  CreateRecurringAppointmentInput,
  UpdateAppointmentInput,
} from '@avishifo/shared';

/** Multilingual name payload `{ uz, ru?, en? }` (uz-Latn mandatory). */
export interface LocalizedName {
  uz: string;
  ru?: string;
  en?: string;
}

export interface AppointmentServiceItem {
  id: string;
  serviceId: string;
  code: string;
  name: LocalizedName;
  durationMin: number;
}

export interface Appointment {
  id: string;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  roomId: string | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  note: string | null;
  recurringGroupId: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string };
  services: AppointmentServiceItem[];
}

export interface FreeSlot {
  startAt: string;
  endAt: string;
}

export interface DoctorOption {
  id: string;
  fullName: string;
}

export interface ServiceOption {
  id: string;
  code: string;
  name: LocalizedName;
  durationMin: number;
  currentPrice: string | null;
}

export interface PatientHit {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

export interface RecurringResult {
  recurringGroupId: string;
  created: Array<{ id: string; startAt: string; endAt: string; status: string }>;
  skipped: Array<{ date: string; startAt: string; reason: string }>;
}

export interface AppointmentListParams {
  from: string;
  to: string;
  branchId?: string;
  doctorUserId?: string;
  status?: AppointmentStatus;
}

export interface SlotsParams {
  doctorUserId: string;
  date: string;
  branchId: string;
  serviceId?: string;
}

export const appointmentsApi = {
  list: async (params: AppointmentListParams): Promise<Appointment[]> =>
    (await api.get<Appointment[]>('/appointments', { ...params, limit: 100 })).data,

  slots: async (params: SlotsParams): Promise<FreeSlot[]> =>
    (await api.get<FreeSlot[]>('/appointments/slots', { ...params })).data,

  create: async (body: CreateAppointmentInput): Promise<Appointment> =>
    (await api.post<Appointment>('/appointments', body)).data,

  update: async (id: string, body: UpdateAppointmentInput): Promise<Appointment> =>
    (await api.patch<Appointment>(`/appointments/${id}`, body)).data,

  changeStatus: async (id: string, body: ChangeAppointmentStatusInput): Promise<Appointment> =>
    (await api.post<Appointment>(`/appointments/${id}/status`, body)).data,

  createRecurring: async (body: CreateRecurringAppointmentInput): Promise<RecurringResult> =>
    (await api.post<RecurringResult>('/appointments/recurring', body)).data,

  doctors: async (): Promise<DoctorOption[]> =>
    (await api.get<DoctorOption[]>('/users', { role: 'DOCTOR', limit: 100 })).data,

  services: async (): Promise<ServiceOption[]> =>
    (await api.get<ServiceOption[]>('/services', { isActive: true, limit: 100 })).data,

  searchPatients: async (search: string): Promise<PatientHit[]> =>
    (await api.get<PatientHit[]>('/patients', { search, limit: 8 })).data,
};

/** Pick the best translation of a localized name for the current locale. */
export function localizedName(name: LocalizedName | null | undefined, locale: string): string {
  if (!name) return '';
  if (locale === 'ru' && name.ru) return name.ru;
  if (locale === 'en' && name.en) return name.en;
  return name.uz;
}
