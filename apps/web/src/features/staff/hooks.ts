'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { staffApi, type StaffListQuery } from './api';

/** Toast an ApiError using the shared `errors` message namespace. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
    toast.error(tErr(code as never));
  };
}

export { usePermissions } from '@/hooks/use-permissions';

export function useStaffList(params: StaffListQuery) {
  return useQuery({
    queryKey: ['staff', 'list', params],
    queryFn: () => staffApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** Single staff member — the API has no GET /staff/:id, so we look them up in the directory. */
export function useStaffMember(userId: string) {
  return useQuery({
    queryKey: ['staff', 'member', userId],
    queryFn: async () => {
      const res = await staffApi.list({ page: 1, limit: 100 });
      return res.data.find((m) => m.id === userId) ?? null;
    },
  });
}

export function useDoctorSchedule(userId: string, branchId: string | undefined) {
  return useQuery({
    queryKey: ['staff', 'schedule', userId, branchId ?? null],
    queryFn: () => staffApi.getSchedule(userId, branchId),
    enabled: Boolean(branchId),
  });
}

export function useDoctorKpi(userId: string, range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['staff', 'kpi', userId, range],
    queryFn: () => staffApi.kpi(userId, range),
    placeholderData: keepPreviousData,
  });
}

export function useCompensationRules(doctorUserId: string) {
  return useQuery({
    queryKey: ['staff', 'compensation-rules', doctorUserId],
    queryFn: () => staffApi.listRules(doctorUserId),
  });
}

export function usePayrollAccruals(period: string) {
  return useQuery({
    queryKey: ['staff', 'accruals', period],
    queryFn: () => staffApi.listAccruals(period),
    enabled: /^\d{4}-\d{2}$/.test(period),
    placeholderData: keepPreviousData,
  });
}

export function useServiceCategoryOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['staff', 'service-categories'],
    queryFn: () => staffApi.listServiceCategories(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useServiceOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['staff', 'service-options'],
    queryFn: () => staffApi.listServices(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
