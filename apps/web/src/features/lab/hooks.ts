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
  type Permission,
  type UpdateLabTestInput,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { labApi, type LabOrdersQuery } from './api';

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
  });
}

/** Per-status totals for the chips row (meta.total of limit-1 queries). */
export function useLabStatusCounts(): Partial<Record<LabOrderStatus, number>> {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQueries({
    queries: WORKLIST_STATUSES.map((status) => ({
      queryKey: ['lab', 'orders', 'count', status, branchId] as const,
      queryFn: () => labApi.listOrders({ status, branchId: branchId ?? undefined, page: 1, limit: 1 }),
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

// ------------------------------------------------------------ mutations

function useInvalidateLab() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['lab'] }),
    [queryClient],
  );
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
