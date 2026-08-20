'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { patientsApi, type PatientListQuery, type TimelineType } from './api';

/** Toast an ApiError using the shared `errors` message namespace. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
    toast.error(tErr(code as never));
  };
}

export { usePermissions } from '@/hooks/use-permissions';

export function usePatientsList(params: PatientListQuery) {
  return useQuery({
    queryKey: ['patients', 'list', params],
    queryFn: () => patientsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: ['patients', 'detail', id],
    queryFn: () => patientsApi.getById(id),
  });
}

export function usePatientTimeline(id: string, type: TimelineType | undefined) {
  return useInfiniteQuery({
    queryKey: ['patients', 'timeline', id, type ?? 'all'],
    queryFn: ({ pageParam }) => patientsApi.timeline(id, { page: pageParam, limit: 20, type }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (!last.meta) return undefined;
      const { page, limit, total } = last.meta;
      return page * limit < total ? page + 1 : undefined;
    },
  });
}

export function usePatientDocuments(id: string, page: number) {
  return useQuery({
    queryKey: ['patients', 'documents', id, page],
    queryFn: () => patientsApi.documents(id, { page, limit: 20 }),
    placeholderData: keepPreviousData,
  });
}

export function usePatientConsents(id: string) {
  return useQuery({
    queryKey: ['patients', 'consents', id],
    queryFn: () => patientsApi.consents(id, { page: 1, limit: 50 }),
  });
}

export function usePatientBalance(id: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['patients', 'balance', id, page],
    queryFn: () => patientsApi.balance(id, { page, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePatientInvoices(id: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['invoices', 'by-patient', id, page],
    queryFn: () => patientsApi.invoices(id, { page, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePatientVisits(id: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['visits', 'by-patient', id, page],
    queryFn: () => patientsApi.visits(id, { page, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
