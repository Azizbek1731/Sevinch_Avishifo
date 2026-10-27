'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { clinicalOrdersApi, type ClinicalOrderQuery } from './api';

export function useClinicalOrders(query: ClinicalOrderQuery) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['clinical-orders', branchId, query],
    queryFn: () => clinicalOrdersApi.list(query),
    enabled: Boolean(branchId),
    refetchInterval: 15_000,
  });
}

export function useClinicalStatusCounts(kind: 'CONSULTATION' | 'ULTRASOUND' = 'ULTRASOUND') {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['clinical-orders', 'status-counts', branchId, kind],
    queryFn: async () => (await clinicalOrdersApi.statusCounts(kind)).data,
    enabled: Boolean(branchId),
    refetchInterval: 15_000,
  });
}
export function useClinicalOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: ['clinical-orders', id],
    queryFn: async () => (await clinicalOrdersApi.get(id as string)).data,
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}
export function useInvalidateClinicalOrders() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['clinical-orders', 'visits', 'patients', 'invoices']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}
