'use client';

import type {
  AddScheduleExceptionInput,
  CompensationRuleUpsertInput,
  CompensationType,
  MoneyString,
  ScheduleExceptionType,
  SetDoctorScheduleInput,
  UpsertStaffProfileInput,
  UserRole,
  UserStatus,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ============================================================ types

export interface StaffMember {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  specialty: string | null;
  licenseNo: string | null;
  hireDate: string | null;
  photoUrl: string | null;
  bio: string | null;
  slotMinutes: number | null;
  defaultRoomId: string | null;
  branches: Array<{ id: string; name: string }>;
  createdAt: string;
}

export interface BranchRoom {
  id: string;
  number: string;
  name: string | null;
  isActive: boolean;
}

export interface StaffListQuery {
  page?: number;
  limit?: number;
  role?: UserRole;
  specialty?: string;
  branchId?: string;
  search?: string;
}

export interface StaffProfileResponse {
  userId: string;
  specialty: string | null;
  licenseNo: string | null;
  hireDate: string | null;
  photoUrl: string | null;
  bio: string | null;
  slotMinutes: number | null;
  defaultRoomId: string | null;
  updatedAt: string;
}

export interface ScheduleRow {
  id: string;
  branchId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isActive: boolean;
}

export interface ScheduleExceptionRow {
  id: string;
  type: ScheduleExceptionType;
  dateFrom: string;
  dateTo: string;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  createdAt: string;
}

export interface DoctorScheduleResponse {
  doctorUserId: string;
  schedule: ScheduleRow[];
  exceptions: ScheduleExceptionRow[];
}

export interface DoctorKpiResponse {
  doctorUserId: string;
  from: string;
  to: string;
  patientsSeen: number;
  visits: number;
  revenue: MoneyString;
  avgVisitMin: number | null;
  /** 0..1 share of NO_SHOW among non-cancelled appointments. */
  noShowRate: number;
  /** 0..1 share of period patients with an earlier visit to this doctor. */
  returningPatientRate: number;
  avgRating: number | null;
}

export interface CompensationRuleRow {
  id: string;
  doctorUserId: string;
  doctorName: string;
  type: CompensationType;
  value: MoneyString;
  serviceId: string | null;
  serviceCategoryId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface AccrualBreakdownRow {
  ruleType: CompensationType;
  basis: string;
  amount: MoneyString;
}

export interface PayrollAccrualRow {
  id: string;
  doctorUserId: string;
  doctorName: string;
  period: string;
  baseAmount: MoneyString;
  bonusAmount: MoneyString;
  adjustment: MoneyString;
  total: MoneyString;
  breakdown: unknown;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateAccrualsSummary {
  period: string;
  doctorsProcessed: number;
  totalAccrued: MoneyString;
  accruals: PayrollAccrualRow[];
}

export interface AccrualAdjustBody {
  adjustment: MoneyString;
  note?: string;
}

/** Scope options for compensation rules (service catalog lookups). */
export interface ServiceCategoryOption {
  id: string;
  name: string;
}

export interface ServiceOption {
  id: string;
  code: string;
  name: { uz: string; ru?: string; en?: string };
}

// ============================================================ helpers

/** breakdown arrives as opaque JSON — narrow it to typed rows. */
export function parseBreakdown(value: unknown): AccrualBreakdownRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is AccrualBreakdownRow =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as AccrualBreakdownRow).basis === 'string' &&
      typeof (row as AccrualBreakdownRow).amount === 'string',
  );
}

/** "1 500 000,5" → "1500000.5" (UI convenience before zod money validation). */
export function sanitizeMoney(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
}

/** '' / whitespace → undefined (optional string fields with min(1) validation). */
export function emptyToUndefined(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s === '' ? undefined : s;
}

// ============================================================ fetchers

export const staffApi = {
  // directory + profile
  list: (q: StaffListQuery): Promise<ApiResult<StaffMember[]>> =>
    api.get<StaffMember[]>('/staff', { ...q }),
  upsertProfile: (userId: string, body: UpsertStaffProfileInput) =>
    api.put<StaffProfileResponse>(`/staff/${userId}/profile`, body),
  branchRooms: (branchId: string): Promise<ApiResult<BranchRoom[]>> =>
    api.get<BranchRoom[]>(`/branches/${branchId}/rooms`),

  // schedule
  getSchedule: (userId: string, branchId?: string): Promise<ApiResult<DoctorScheduleResponse>> =>
    api.get<DoctorScheduleResponse>(`/staff/${userId}/schedule`, { branchId }),
  setSchedule: (userId: string, body: SetDoctorScheduleInput) =>
    api.put<DoctorScheduleResponse>(`/staff/${userId}/schedule`, body),
  addException: (userId: string, body: AddScheduleExceptionInput) =>
    api.post<ScheduleExceptionRow>(`/staff/${userId}/schedule-exceptions`, body),
  deleteException: (id: string) => api.delete<{ id: string }>(`/staff/schedule-exceptions/${id}`),

  // KPI
  kpi: (
    userId: string,
    q: { from?: string; to?: string },
  ): Promise<ApiResult<DoctorKpiResponse>> =>
    api.get<DoctorKpiResponse>(`/staff/${userId}/kpi`, { ...q }),

  // compensation rules
  listRules: (doctorUserId?: string): Promise<ApiResult<CompensationRuleRow[]>> =>
    api.get<CompensationRuleRow[]>('/compensation-rules', { doctorUserId, limit: 100 }),
  createRule: (body: CompensationRuleUpsertInput) =>
    api.post<CompensationRuleRow>('/compensation-rules', body),
  deleteRule: (id: string) => api.delete<{ id: string }>(`/compensation-rules/${id}`),

  // payroll accruals
  listAccruals: (period: string): Promise<ApiResult<PayrollAccrualRow[]>> =>
    api.get<PayrollAccrualRow[]>('/payroll/accruals', { period }),
  generateAccruals: (period: string) =>
    api.post<GenerateAccrualsSummary>('/payroll/accruals/generate', undefined, { period }),
  adjustAccrual: (id: string, body: AccrualAdjustBody) =>
    api.patch<PayrollAccrualRow>(`/payroll/accruals/${id}`, body),
  exportAccrualsXlsx: (period: string): Promise<ApiResult<Blob>> =>
    api.get<Blob>('/payroll/accruals', { period, export: 'xlsx' }),

  // service catalog lookups for rule scope selects
  listServiceCategories: (): Promise<ApiResult<ServiceCategoryOption[]>> =>
    api.get<ServiceCategoryOption[]>('/service-categories', { limit: 100 }),
  listServices: (): Promise<ApiResult<ServiceOption[]>> =>
    api.get<ServiceOption[]>('/services', { limit: 100 }),
};
