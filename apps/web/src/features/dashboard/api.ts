import { api } from '@/lib/api-client';

/** Today's KPI summary (money values are decimal strings). */
export interface DashboardSummary {
  revenue: string;
  visitsCount: number;
  newPatients: number;
  waitingNow: number;
  openShifts: number;
}

export interface RevenuePoint {
  bucket: string;
  amount: string;
}

export interface NewVsReturningBucket {
  bucket: string;
  new: number;
  returning: number;
}

export interface VisitsCountBucket {
  bucket: string;
  count: number;
}

export interface PeakHourCell {
  dow: number;
  hour: number;
  count: number;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface PatientFlowReport {
  newVsReturning: NewVsReturningBucket[];
  visitsCount: VisitsCountBucket[];
  peakHours: PeakHourCell[];
  sources: SourceCount[];
}

interface RangeParams {
  from: string;
  to: string;
  branchId: string | null;
}

export const dashboardApi = {
  summary: async (branchId: string | null): Promise<DashboardSummary> => {
    const res = await api.get<DashboardSummary>('/reports/dashboard', {
      branchId: branchId ?? undefined,
    });
    return res.data;
  },
  revenue: async ({ from, to, branchId }: RangeParams): Promise<RevenuePoint[]> => {
    const res = await api.get<RevenuePoint[]>('/reports/revenue', {
      from,
      to,
      groupBy: 'day',
      branchId: branchId ?? undefined,
    });
    return res.data;
  },
  patientFlow: async ({ from, to, branchId }: RangeParams): Promise<PatientFlowReport> => {
    const res = await api.get<PatientFlowReport>('/reports/patient-flow', {
      from,
      to,
      branchId: branchId ?? undefined,
    });
    return res.data;
  },
};
