import type {
  CreateSurgeryInput,
  AddSurgeryEntriesInput,
  AddSurgeryStaffFeesInput,
  CreateSurgeryPayoutInput,
  SurgeryStaffRole,
} from "@avishifo/shared";
import { api } from "@/lib/api-client";
import type { Localizable } from "@/lib/localized";

export type SurgeryStatus = "PLANNED" | "COMPLETED" | "CANCELLED";
export type SurgeryBucket = "active" | "archive";
export interface SurgeryAdmission {
  id: string;
  historyNumber: string;
  ward: string | null;
  bed: string | null;
  status: string;
  patientId: string;
  patient: { id: string; mrn: string; fullName: string };
}
export interface SurgeryPayout {
  id: string;
  type: "PERCENT" | "FIXED";
  value: string;
  basisAmount: string;
  amount: string;
  method: "CASH" | "CARD" | "CLICK";
  paidAt: string;
  note: string | null;
  voidedAt: string | null;
  expenseId: string;
  doctorName: string;
}
export interface SurgeryEntry {
  id: string;
  kind: "MATERIAL" | "ANESTHESIA";
  title: Localizable;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  note: string | null;
  chargeItemId: string;
  status: string;
  createdAt: string;
}
export interface Surgery {
  id: string;
  admissionId: string;
  patientId: string;
  patient: SurgeryAdmission["patient"];
  admission: Omit<SurgeryAdmission, "patientId" | "patient">;
  service: { id: string; name: Localizable };
  surgeon: { id: string; fullName: string };
  scheduledDate: string;
  status: SurgeryStatus;
  note: string | null;
  completedAt: string | null;
  feeAmount: string;
  totalAmount: string;
  materialTotal: string;
  anesthesiaTotal: string;
  staffFeeTotal: string;
  serviceCharge: { id: string; status: string };
  entries: SurgeryEntry[];
  staffFees: Array<{
    id: string;
    role: SurgeryStaffRole;
    amount: string;
    note: string | null;
    chargeItemId: string;
    status: string;
    createdAt: string;
  }>;
  payouts: SurgeryPayout[];
  /** True when every live charge is on a PAID invoice. */
  billingSettled?: boolean;
}
export interface SurgeryQuery {
  page?: number;
  limit?: number;
  admissionId?: string;
  patientId?: string;
  status?: SurgeryStatus;
  bucket?: SurgeryBucket;
  search?: string;
  from?: string;
  to?: string;
}
export const surgeriesApi = {
  list: (query: SurgeryQuery) => api.get<Surgery[]>("/surgeries", { ...query }),
  get: (id: string) => api.get<Surgery>(`/surgeries/${id}`),
  admissions: (search?: string) =>
    api.get<SurgeryAdmission[]>("/surgeries/admissions", {
      search: search || undefined,
      limit: 100,
    }),
  doctors: (search?: string) =>
    api.get<Array<{ id: string; fullName: string; specialty: string | null }>>(
      "/surgeries/doctors",
      { search: search || undefined, limit: 100 },
    ),
  create: (body: CreateSurgeryInput) => api.post<Surgery>("/surgeries", body),
  addEntries: (id: string, body: AddSurgeryEntriesInput) =>
    api.post<Surgery>(`/surgeries/${id}/entries`, body),
  removeEntry: (id: string, entryId: string) =>
    api.delete<Surgery>(`/surgeries/${id}/entries/${entryId}`),
  addStaffFees: (id: string, body: AddSurgeryStaffFeesInput) =>
    api.post<Surgery>(`/surgeries/${id}/staff-fees`, body),
  removeStaffFee: (id: string, feeId: string) =>
    api.delete<Surgery>(`/surgeries/${id}/staff-fees/${feeId}`),
  complete: (id: string) => api.post<Surgery>(`/surgeries/${id}/complete`),
  cancel: (id: string) => api.post<Surgery>(`/surgeries/${id}/cancel`),
  payout: (id: string, body: CreateSurgeryPayoutInput) =>
    api.post<SurgeryPayout>(`/surgeries/${id}/payouts`, body),
  voidPayout: (id: string, payoutId: string, reason: string) =>
    api.post<SurgeryPayout>(`/surgeries/${id}/payouts/${payoutId}/void`, {
      reason,
    }),
};
