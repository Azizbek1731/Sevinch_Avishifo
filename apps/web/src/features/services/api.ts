'use client';

import type {
  CreatePackageInput,
  CreateServiceCategoryInput,
  CreateServiceInput,
  DiscountRuleUpsertInput,
  DiscountType,
  MoneyString,
  ServiceKind,
  SetServicePriceInput,
  UpdateServiceInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

// ============================================================ types

export interface LocalizedName {
  uz: string;
  ru?: string;
  en?: string;
}

export interface ServiceCategoryRow {
  id: string;
  name: string;
  kind: ServiceKind;
  sortOrder: number;
  isActive: boolean;
}

export interface ServicePriceRow {
  id: string;
  serviceId: string;
  branchId: string | null;
  price: MoneyString;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface ServiceRow {
  id: string;
  categoryId: string;
  code: string;
  name: LocalizedName;
  durationMin: number;
  vatIncluded: boolean;
  isActive: boolean;
  currentPrice: MoneyString | null;
  category?: ServiceCategoryRow;
  createdAt: string;
  updatedAt: string;
}

export interface PackageItemRow {
  id: string;
  serviceId: string;
  quantity: number;
  service: ServiceRow;
}

export interface PackageRow {
  id: string;
  code: string;
  name: LocalizedName;
  price: MoneyString;
  isActive: boolean;
  items: PackageItemRow[];
  createdAt: string;
}

export interface DiscountRuleRow {
  id: string;
  name: string;
  type: DiscountType;
  value: MoneyString;
  patientTag: string | null;
  promoCode: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ServiceListQuery {
  page?: number;
  limit?: number;
  categoryId?: string;
  search?: string;
  isActive?: boolean;
}

// ============================================================ fetchers

export const servicesApi = {
  // categories
  listCategories: (): Promise<ApiResult<ServiceCategoryRow[]>> =>
    api.get<ServiceCategoryRow[]>('/service-categories', { limit: 100 }),
  createCategory: (body: CreateServiceCategoryInput) =>
    api.post<ServiceCategoryRow>('/service-categories', body),
  updateCategory: (id: string, body: Partial<CreateServiceCategoryInput>) =>
    api.patch<ServiceCategoryRow>(`/service-categories/${id}`, body),
  deleteCategory: (id: string) => api.delete<ServiceCategoryRow>(`/service-categories/${id}`),

  // services
  listServices: (q: ServiceListQuery): Promise<ApiResult<ServiceRow[]>> =>
    api.get<ServiceRow[]>('/services', { ...q }),
  createService: (body: CreateServiceInput) => api.post<ServiceRow>('/services', body),
  updateService: (id: string, body: UpdateServiceInput) =>
    api.patch<ServiceRow>(`/services/${id}`, body),
  /** Soft delete on the backend: the service is deactivated. */
  deleteService: (id: string) => api.delete<ServiceRow>(`/services/${id}`),

  // prices
  listPriceHistory: (serviceId: string): Promise<ApiResult<ServicePriceRow[]>> =>
    api.get<ServicePriceRow[]>(`/services/${serviceId}/prices`, { limit: 50 }),
  setPrice: (serviceId: string, body: SetServicePriceInput) =>
    api.post<ServicePriceRow>(`/services/${serviceId}/prices`, body),

  // packages
  listPackages: (q: { page?: number; limit?: number }): Promise<ApiResult<PackageRow[]>> =>
    api.get<PackageRow[]>('/service-packages', { ...q }),
  createPackage: (body: CreatePackageInput) => api.post<PackageRow>('/service-packages', body),
  updatePackage: (id: string, body: Partial<CreatePackageInput>) =>
    api.patch<PackageRow>(`/service-packages/${id}`, body),
  deletePackage: (id: string) => api.delete<PackageRow>(`/service-packages/${id}`),

  // discount rules
  listDiscountRules: (q: { page?: number; limit?: number }): Promise<ApiResult<DiscountRuleRow[]>> =>
    api.get<DiscountRuleRow[]>('/discount-rules', { ...q }),
  createDiscountRule: (body: DiscountRuleUpsertInput) =>
    api.post<DiscountRuleRow>('/discount-rules', body),
  updateDiscountRule: (id: string, body: DiscountRuleUpsertInput) =>
    api.patch<DiscountRuleRow>(`/discount-rules/${id}`, body),
  deleteDiscountRule: (id: string) => api.delete<DiscountRuleRow>(`/discount-rules/${id}`),
};

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
