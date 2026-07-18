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
    // API wraps rows: { dimension, groupBy, rows: [{ bucket, amount }] }
    const res = await api.get<{ rows: RevenuePoint[] }>('/reports/revenue', {
      from,
      to,
      groupBy: 'day',
      branchId: branchId ?? undefined,
    });
    return res.data.rows ?? [];
  },
  patientFlow: async ({ from, to, branchId }: RangeParams): Promise<PatientFlowReport> => {
    // API row fields: newCount/returningCount; peakHours is an object map — adapt here.
    const res = await api.get<{
      newVsReturning: Array<{
        bucket: string;
        newCount: number;
        returningCount: number;
        visitsCount: number;
      }>;
      sources: SourceCount[];
    }>('/reports/patient-flow', {
      from,
      to,
      branchId: branchId ?? undefined,
    });
    const rows = res.data.newVsReturning ?? [];
    return {
      newVsReturning: rows.map((r) => ({
        bucket: r.bucket,
        new: r.newCount,
        returning: r.returningCount,
      })),
      visitsCount: rows.map((r) => ({ bucket: r.bucket, count: r.visitsCount })),
      peakHours: [],
      sources: res.data.sources ?? [],
    };
  },
};
