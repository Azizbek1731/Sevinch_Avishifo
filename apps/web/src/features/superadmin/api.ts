import { api, type ApiResult } from '@/lib/api-client';
import type {
  AssignPlanInput,
  ClinicStatus,
  CreateClinicWithOwnerInput,
  FeatureFlagSetInput,
  MoneyString,
  PlanUpsertInput,
  UpdateClinicStatusInput,
} from '@avishifo/shared';

// ------------------------------------------------------------- response types

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  priceMonthly: MoneyString;
  maxBranches: number;
  maxUsers: number;
  modules: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionInfo {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  plan: PlanRow;
}

export interface ClinicUsage {
  branches: number;
  users: number;
  patients: number;
  visitsLast30d: number;
}

export interface ClinicBase {
  id: string;
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  status: ClinicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicListItem extends ClinicBase {
  subscription: SubscriptionInfo | null;
  usage: ClinicUsage;
}

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
}

export interface ClinicDetail extends ClinicBase {
  subscription: SubscriptionInfo | null;
  featureFlags: FeatureFlagRow[];
}

export interface PlatformAnalytics {
  activeClinics: number;
  totalUsers: number;
  totalPatients: number;
  visitsLast30dPerDay: Array<{ date: string; count: number }>;
  paymentsLast30dSum: MoneyString;
}

export interface ImpersonationResult {
  accessToken: string;
  user: { id: string; fullName: string };
}

export interface ClinicListFilters {
  search: string;
  status: ClinicStatus | null;
  page: number;
}

/** Feature-flag keys exposed as switches on the clinic detail page. */
export const FEATURE_FLAG_KEYS = ['lab', 'portal', 'telegram', 'analytics'] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** Module keys selectable on a subscription plan. */
export const PLAN_MODULE_KEYS = FEATURE_FLAG_KEYS;

// ------------------------------------------------------------------ fetchers

export const superadminApi = {
  listClinics: (f: ClinicListFilters): Promise<ApiResult<ClinicListItem[]>> =>
    api.get<ClinicListItem[]>('/platform/clinics', {
      search: f.search || undefined,
      status: f.status ?? undefined,
      page: f.page,
    }),

  createClinic: async (input: CreateClinicWithOwnerInput): Promise<ClinicBase> => {
    const res = await api.post<{ clinic: ClinicBase }>('/platform/clinics', input);
    return res.data.clinic;
  },

  getClinic: async (id: string): Promise<ClinicDetail> => {
    const res = await api.get<ClinicDetail>(`/platform/clinics/${id}`);
    return res.data;
  },

  updateClinicStatus: async (id: string, input: UpdateClinicStatusInput): Promise<ClinicBase> => {
    const res = await api.patch<ClinicBase>(`/platform/clinics/${id}/status`, input);
    return res.data;
  },

  assignPlan: async (id: string, input: AssignPlanInput): Promise<SubscriptionInfo> => {
    const res = await api.post<SubscriptionInfo>(`/platform/clinics/${id}/plan`, input);
    return res.data;
  },

  setFeatureFlag: async (id: string, input: FeatureFlagSetInput): Promise<FeatureFlagRow> => {
    const res = await api.put<FeatureFlagRow>(`/platform/clinics/${id}/feature-flags`, input);
    return res.data;
  },

  listPlans: async (): Promise<PlanRow[]> => {
    const res = await api.get<PlanRow[]>('/platform/plans');
    return res.data;
  },

  /** Upsert by plan `code` (POST creates or updates the plan with that code). */
  upsertPlan: async (input: PlanUpsertInput): Promise<PlanRow> => {
    const res = await api.post<PlanRow>('/platform/plans', input);
    return res.data;
  },

  analytics: async (): Promise<PlatformAnalytics> => {
    const res = await api.get<PlatformAnalytics>('/platform/analytics');
    return res.data;
  },

  impersonate: async (clinicId: string): Promise<ImpersonationResult> => {
    const res = await api.post<ImpersonationResult>(`/platform/clinics/${clinicId}/impersonate`);
    return res.data;
  },
};
