'use client';

import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import type { Permission } from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { todayTashkent } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import {
  reportsApi,
  type ReportFilters,
  type ReportGroupBy,
  type RevenueDimension,
} from './api';

// ------------------------------------------------------------- shared helpers

/** Toast an ApiError with the localized message for its error code. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) toast.error(tErr(err.code as never));
      else toast.error(tErr('INTERNAL_ERROR'));
    },
    [tErr],
  );
}

/** Permission check against the authenticated user. */
export function usePermission(): (permission: Permission) => boolean {
  const user = useAuthStore((s) => s.user);
  return useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user],
  );
}

// ------------------------------------------------------------- filter state

export type RangePreset = 'today' | 'week' | 'month' | 'custom';

export interface ReportFilterState {
  preset: RangePreset;
  /** Inclusive Tashkent calendar date "YYYY-MM-DD". */
  from: string;
  /** Inclusive Tashkent calendar date "YYYY-MM-DD". */
  to: string;
  groupBy: ReportGroupBy;
}

/** Resolve a non-custom preset into an inclusive Tashkent date range. */
export function presetRange(preset: Exclude<RangePreset, 'custom'>): { from: string; to: string } {
  const to = todayTashkent();
  const base = new Date(`${to}T00:00:00`);
  switch (preset) {
    case 'today':
      return { from: to, to };
    case 'week':
      return { from: format(subDays(base, 6), 'yyyy-MM-dd'), to };
    case 'month':
      return { from: format(subDays(base, 29), 'yyyy-MM-dd'), to };
  }
}

export function useReportFilters(): {
  state: ReportFilterState;
  setState: (next: ReportFilterState) => void;
  filters: ReportFilters;
} {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [state, setState] = useState<ReportFilterState>(() => ({
    preset: 'month',
    groupBy: 'day',
    ...presetRange('month'),
  }));

  const filters = useMemo<ReportFilters>(
    () => ({ from: state.from, to: state.to, groupBy: state.groupBy, branchId }),
    [state.from, state.to, state.groupBy, branchId],
  );

  return { state, setState, filters };
}

// ------------------------------------------------------------- report queries

export function useRevenueReport(filters: ReportFilters, dimension: RevenueDimension) {
  return useQuery({
    queryKey: ['reports', 'revenue', { ...filters, dimension }],
    queryFn: () => reportsApi.revenue(filters, dimension),
    placeholderData: keepPreviousData,
  });
}

export function usePatientFlowReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'patient-flow', filters],
    queryFn: () => reportsApi.patientFlow(filters),
    placeholderData: keepPreviousData,
  });
}

export function useDoctorsReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'doctors', filters],
    queryFn: () => reportsApi.doctors(filters),
    placeholderData: keepPreviousData,
  });
}

export function useServicesReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'services', filters],
    queryFn: () => reportsApi.services(filters),
    placeholderData: keepPreviousData,
  });
}

export function useQueueReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'queue', filters],
    queryFn: () => reportsApi.queue(filters),
    placeholderData: keepPreviousData,
  });
}

export function useLabTurnaroundReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'lab-turnaround', filters],
    queryFn: () => reportsApi.labTurnaround(filters),
    placeholderData: keepPreviousData,
  });
}

export function useCashierShiftsReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['reports', 'cashier-shifts', filters],
    queryFn: () => reportsApi.cashierShifts(filters),
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------- XLSX export

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useExportXlsx(
  path: string,
  filenameBase: string,
  filters: ReportFilters,
  extra?: Record<string, string>,
) {
  const t = useTranslations('reports');
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: () => reportsApi.exportXlsx(path, filters, extra),
    onSuccess: (blob) => {
      downloadBlob(blob, `${filenameBase}_${filters.from}_${filters.to}.xlsx`);
      toast.success(t('export.success'));
    },
    onError,
  });
}
