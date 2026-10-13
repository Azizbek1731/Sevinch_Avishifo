'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  LabOrderStatus,
  type CreateLabOrderInput,
  type CreateLabTestInput,
  type EnterLabResultsInput,
  type ImportLabCatalogInput,
  type Permission,
  type PhysiologicalState,
  type UpdateLabTestInput,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { labApi, type LabCatalogQuery, type LabOrdersQuery } from './api';

/** Worklist chip statuses, in pipeline order. */
export const WORKLIST_STATUSES = [
  LabOrderStatus.ORDERED,
  LabOrderStatus.SPECIMEN_COLLECTED,
  LabOrderStatus.IN_PROGRESS,
  LabOrderStatus.RESULTED,
  LabOrderStatus.APPROVED,
  LabOrderStatus.DELIVERED,
] as const;

export function useHasPermission(permission: Permission): boolean {
  return useAuthStore((s) => s.user?.permissions.includes(permission) ?? false);
}

/** Maps ApiError codes to localized toast messages. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
      toast.error(tErr(code as never));
    },
    [tErr],
  );
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ------------------------------------------------------------ queries

export function useLabOrders(params: Omit<LabOrdersQuery, 'branchId'>) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['lab', 'orders', { ...params, branchId }],
    queryFn: () => labApi.listOrders({ ...params, branchId: branchId ?? undefined }),
    refetchInterval: 30_000,
  });
}

/** Per-status totals for the chips row (meta.total of limit-1 queries). */
export function useLabStatusCounts(includeUnpaid = false): Partial<Record<LabOrderStatus, number>> {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQueries({
    queries: WORKLIST_STATUSES.map((status) => ({
      queryKey: ['lab', 'orders', 'count', status, branchId, includeUnpaid] as const,
      queryFn: () =>
        labApi.listOrders({
          status,
          branchId: branchId ?? undefined,
          page: 1,
          limit: 1,
          includeUnpaid,
        }),
    })),
    combine: (results) => {
      const counts: Partial<Record<LabOrderStatus, number>> = {};
      WORKLIST_STATUSES.forEach((status, i) => {
        const total = results[i]?.data?.meta?.total;
        if (total !== undefined) counts[status] = total;
      });
      return counts;
    },
  });
}

export function useLabOrder(id: string) {
  return useQuery({
    queryKey: ['lab', 'order', id],
    queryFn: async () => (await labApi.getOrder(id)).data,
    refetchInterval: 30_000,
  });
}

export function useLabPrintPayload(id: string) {
  return useQuery({
    queryKey: ['lab', 'order', id, 'print'],
    queryFn: async () => (await labApi.getPrintPayload(id)).data,
  });
}

export function useLabTests(search?: string, enabled = true) {
  return useQuery({
    queryKey: ['lab', 'tests', { search: search ?? '' }],
    queryFn: async () => (await labApi.listTests(search)).data,
    enabled,
  });
}

export function useLabCatalog(params: LabCatalogQuery, enabled = true) {
  return useQuery({
    queryKey: ['lab', 'catalog', params],
    queryFn: () => labApi.listCatalog(params),
    enabled,
    // The catalogue is a shared dictionary that only changes by migration, so it is
    // worth holding rather than refetching each time the dialog reopens.
    staleTime: 5 * 60_000,
  });
}

export function useLabCatalogSummary(enabled = true) {
  return useQuery({
    queryKey: ['lab', 'catalog', 'summary'],
    queryFn: async () => (await labApi.catalogSummary()).data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ------------------------------------------------------------ mutations

function useInvalidateLab() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['patients', 'lab-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    return queryClient.invalidateQueries({ queryKey: ['lab'] });
  }, [queryClient]);
}

export function useCreateLabOrder(onCreated?: (orderId: string) => void) {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: (body: CreateLabOrderInput) => labApi.createOrder(body),
    onSuccess: (res) => {
      toast.success(t('orderCreated'));
      void invalidate();
      onCreated?.(res.data.id);
    },
    onError,
  });
}

export function useUpdateOrderStatus() {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LabOrderStatus }) =>
      labApi.updateStatus(id, status),
    onSuccess: () => {
      toast.success(t('statusUpdated'));
      void invalidate();
    },
    onError,
  });
}

export function useEnterResults() {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: ({ itemId, ...body }: EnterLabResultsInput & { itemId: string }) =>
      labApi.enterResults(itemId, body),
    onSuccess: () => {
      toast.success(t('resultsSaved'));
      void invalidate();
    },
    onError,
  });
}

export function useApproveOrder() {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: (id: string) => labApi.approve(id),
    onSuccess: () => {
      toast.success(t('orderApproved'));
      void invalidate();
    },
    onError,
  });
}

export function useDeliverOrder() {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: (id: string) => labApi.deliver(id),
    onSuccess: () => {
      toast.success(t('orderDelivered'));
      void invalidate();
    },
    onError,
  });
}

export function useSetOrderContext() {
  const onError = useApiErrorToast();
  const invalidate = useInvalidateLab();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: PhysiologicalState | null }) =>
      labApi.setOrderContext(id, state),
    onSuccess: () => {
      void invalidate();
    },
    onError,
  });
}

export function useImportLabCatalog(onDone?: (created: number) => void) {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportLabCatalogInput) => labApi.importCatalog(body),
    onSuccess: (res) => {
      const { created, updated, skipped } = res.data;
      if (created + updated === 0) toast.info(t('importNothingNew', { count: skipped }));
      else toast.success(t('importDone', { created, updated, skipped }));
      void queryClient.invalidateQueries({ queryKey: ['lab'] });
      onDone?.(created);
    },
    onError,
  });
}

export function useCreateLabTest(onDone?: () => void) {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLabTestInput) => labApi.createTest(body),
    onSuccess: () => {
      toast.success(t('testSaved'));
      void queryClient.invalidateQueries({ queryKey: ['lab', 'tests'] });
      onDone?.();
    },
    onError,
  });
}

export function useUpdateLabTest(onDone?: () => void) {
  const t = useTranslations('lab');
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateLabTestInput & { id: string }) =>
      labApi.updateTest(id, body),
    onSuccess: () => {
      toast.success(t('testSaved'));
      void queryClient.invalidateQueries({ queryKey: ['lab', 'tests'] });
      onDone?.();
    },
    onError,
  });
}
