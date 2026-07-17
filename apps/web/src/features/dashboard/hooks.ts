'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { useAuthStore } from '@/stores/auth-store';
import { useSocketEvent } from '@/hooks/use-socket';
import { todayTashkent } from '@/lib/dates';
import { dashboardApi } from './api';

/** Inclusive 30-day window ending today (Tashkent calendar dates). */
export function useLast30Days(): { from: string; to: string } {
  return useMemo(() => {
    const to = todayTashkent();
    const from = format(subDays(new Date(`${to}T00:00:00`), 29), 'yyyy-MM-dd');
    return { from, to };
  }, []);
}

export function useDashboardSummary() {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['dashboard', 'summary', branchId],
    queryFn: () => dashboardApi.summary(branchId),
  });
}

export function useRevenueSeries() {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const { from, to } = useLast30Days();
  return useQuery({
    queryKey: ['dashboard', 'revenue', { branchId, from, to }],
    queryFn: () => dashboardApi.revenue({ from, to, branchId }),
  });
}

export function usePatientFlow() {
  const branchId = useAuthStore((s) => s.activeBranchId);
  const { from, to } = useLast30Days();
  return useQuery({
    queryKey: ['dashboard', 'patient-flow', { branchId, from, to }],
    queryFn: () => dashboardApi.patientFlow({ from, to, branchId }),
  });
}

/** Live refresh: queue stats → refetch KPI summary; paid invoice → refetch everything. */
export function useDashboardRealtime(): void {
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.activeBranchId);

  useSocketEvent('queue.stats.updated', (p) => {
    if (branchId && p.branchId !== branchId) return;
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
  });

  useSocketEvent('invoice.paid', (p) => {
    if (branchId && p.branchId !== branchId) return;
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });
}
