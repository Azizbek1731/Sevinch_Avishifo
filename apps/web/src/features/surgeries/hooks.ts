'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { surgeriesApi, type SurgeryQuery } from './api';

export function useSurgeries(query: SurgeryQuery, enabled = true) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['surgeries', branchId, query],
    queryFn: () => surgeriesApi.list(query),
    enabled: enabled && Boolean(branchId),
    refetchInterval: 10_000,
  });
}
export function useSurgery(id: string, enabled = true) {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['surgeries', branchId, id],
    queryFn: async () => (await surgeriesApi.get(id)).data,
    enabled: enabled && Boolean(branchId),
    refetchInterval: 10_000,
  });
}
export function useInvalidateSurgeries() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      'surgeries',
      'admissions',
      'admission',
      'admission-discharge-check',
      'charges',
      'patients',
      'expenses',
      'shifts',
      'reports',
      'invoices',
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
}
