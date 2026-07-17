'use client';

import type {
  ClinicSettingsInput,
  CreateBranchInput,
  CreateRoomInput,
  CreateUserInput,
  Locale,
  NotificationChannel,
  NotificationEvent,
  PermissionOverridesInput,
  TemplateUpsertInput,
  UpdateBranchInput,
  UpdateClinicInput,
  UpdateRoomInput,
  UpdateUserInput,
  UserStatus,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ============================================================ types

export interface ClinicPlan {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  maxBranches: number;
  maxUsers: number;
  modules: string[];
}

export interface ClinicSubscription {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  plan: ClinicPlan;
}

export interface ClinicRow {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  defaultLocale: Locale;
  smsSenderName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  subscription: ClinicSubscription | null;
}

export type ClinicSettings = ClinicSettingsInput;

export interface WorkingHoursRow {
  weekday: number;
  open: string;
  close: string;
  closed?: boolean;
}

export interface BranchRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  workingHours: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomRow {
  id: string;
  branchId: string;
  number: string;
  name: string | null;
  type: string;
  specialties: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayTokenResponse {
  token: string;
  wsUrl: string;
}

export interface UserRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  locale: Locale;
  permissionOverrides: { grant: string[]; revoke: string[] };
  branchIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserListQuery {
  page?: number;
  role?: string;
  status?: string;
  search?: string;
}

export interface TemplateRow {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  locale: Locale;
  body: string;
  isActive: boolean;
}

export interface NotificationLogRow {
  id: string;
  patientId: string | null;
  userId: string | null;
  event: NotificationEvent;
  channel: NotificationChannel;
  recipient: string;
  body: string;
  status: string;
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationLogQuery {
  page?: number;
  status?: string;
  channel?: string;
}

// ============================================================ fetchers

export const settingsApi = {
  // clinic
  getClinic: (): Promise<ApiResult<ClinicRow>> => api.get<ClinicRow>('/clinic'),
  updateClinic: (body: UpdateClinicInput) => api.patch<ClinicRow>('/clinic', body),
  getSettings: (): Promise<ApiResult<ClinicSettings>> => api.get<ClinicSettings>('/clinic/settings'),
  updateSettings: (body: ClinicSettingsInput) =>
    api.patch<ClinicSettings>('/clinic/settings', body),

  // branches
  listBranches: (): Promise<ApiResult<BranchRow[]>> => api.get<BranchRow[]>('/branches', { limit: 100 }),
  createBranch: (body: CreateBranchInput) => api.post<BranchRow>('/branches', body),
  updateBranch: (id: string, body: UpdateBranchInput) => api.patch<BranchRow>(`/branches/${id}`, body),
  deleteBranch: (id: string) => api.delete<BranchRow>(`/branches/${id}`),
  createDisplayToken: (branchId: string) =>
    api.post<DisplayTokenResponse>(`/branches/${branchId}/display-token`),

  // rooms
  listRooms: (branchId: string): Promise<ApiResult<RoomRow[]>> =>
    api.get<RoomRow[]>(`/branches/${branchId}/rooms`, { limit: 100 }),
  createRoom: (branchId: string, body: CreateRoomInput) =>
    api.post<RoomRow>(`/branches/${branchId}/rooms`, body),
  updateRoom: (id: string, body: UpdateRoomInput) => api.patch<RoomRow>(`/rooms/${id}`, body),
  deleteRoom: (id: string) => api.delete<RoomRow>(`/rooms/${id}`),

  // users
  listUsers: (q: UserListQuery): Promise<ApiResult<UserRow[]>> => api.get<UserRow[]>('/users', { ...q }),
  createUser: (body: CreateUserInput) => api.post<UserRow>('/users', body),
  updateUser: (id: string, body: UpdateUserInput) => api.patch<UserRow>(`/users/${id}`, body),
  updateUserStatus: (id: string, status: UserStatus) =>
    api.patch<UserRow>(`/users/${id}/status`, { status }),
  updatePermissionOverrides: (id: string, body: PermissionOverridesInput) =>
    api.patch<UserRow>(`/users/${id}/permission-overrides`, body),

  // notification templates + logs
  listTemplates: (): Promise<ApiResult<TemplateRow[]>> =>
    api.get<TemplateRow[]>('/notification-templates', { limit: 100 }),
  upsertTemplate: (body: TemplateUpsertInput) => api.put<TemplateRow>('/notification-templates', body),
  listNotificationLogs: (q: NotificationLogQuery): Promise<ApiResult<NotificationLogRow[]>> =>
    api.get<NotificationLogRow[]>('/notification-logs', { ...q }),
};

/** '' / whitespace → undefined (optional string fields with min(1) validation). */
export function emptyToUndefined(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s === '' ? undefined : s;
}

/** Parse the branch workingHours JSON (unknown over the wire) into editor rows. */
export function parseWorkingHours(value: unknown): WorkingHoursRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): WorkingHoursRow[] => {
    if (typeof row !== 'object' || row === null) return [];
    const r = row as Record<string, unknown>;
    if (typeof r.weekday !== 'number' || typeof r.open !== 'string' || typeof r.close !== 'string') {
      return [];
    }
    return [
      {
        weekday: r.weekday,
        open: r.open,
        close: r.close,
        closed: typeof r.closed === 'boolean' ? r.closed : false,
      },
    ];
  });
}

/** Full week (Mon..Sun) defaults for a new branch. */
export function defaultWorkingHours(): WorkingHoursRow[] {
  return Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    open: '09:00',
    close: '18:00',
    closed: i === 6,
  }));
}
