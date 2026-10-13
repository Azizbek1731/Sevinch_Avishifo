import { api } from '@/lib/api-client';
import type {
  CashflowReport,
  ConsumablesKind,
  ConsumablesReport,
  ConsumablesSource,
  MoneyString,
} from '@avishifo/shared';

export type ReportGroupBy = 'day' | 'week' | 'month';
export type RevenueDimension = 'time' | 'category' | 'doctor' | 'method';

/** Shared filter state driving every report tab. */
export interface ReportFilters {
  /** Inclusive Tashkent calendar date "YYYY-MM-DD". */
  from: string;
  /** Inclusive Tashkent calendar date "YYYY-MM-DD". */
  to: string;
  branchId: string | null;
  groupBy: ReportGroupBy;
}

// ------------------------------------------------------------- response types

export interface BucketAmountRow {
  bucket: string;
  amount: MoneyString;
}

export interface RevenueReport {
  dimension: RevenueDimension;
  groupBy: ReportGroupBy;
  rows: BucketAmountRow[];
}

export interface FlowBucket {
  bucket: string;
  newCount: number;
  returningCount: number;
  visitsCount: number;
}

export interface PeakHoursMatrix {
  hours: number[];
  rows: Array<{ dow: number; counts: number[] }>;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface PatientFlowReport {
  newVsReturning: FlowBucket[];
  peakHours: PeakHoursMatrix;
  sources: SourceCount[];
}

export interface DoctorReportRow {
  doctorUserId: string;
  fullName: string;
  patientsSeen: number;
  visits: number;
  revenue: MoneyString;
  avgVisitMin: number | null;
  /** Fraction 0..1. */
  noShowRate: number | null;
  /** Fraction 0..1. */
  returningRate: number | null;
}

export interface ServiceReportRow {
  serviceId: string;
  code: string;
  name: string;
  count: number;
  revenue: MoneyString;
}

export interface QueueReport {
  perDay: Array<{
    bucket: string;
    tickets: number;
    avgWaitMin: number | null;
    avgServiceMin: number | null;
  }>;
  perDoctor: Array<{
    doctorUserId: string;
    fullName: string;
    tickets: number;
    avgWaitMin: number | null;
    avgServiceMin: number | null;
  }>;
}

export interface LabTurnaroundReport {
  perTest: Array<{ labTestId: string; name: string; count: number; avgHours: number | null }>;
  perDay: Array<{ bucket: string; count: number; avgHours: number | null }>;
}

export interface CashierShiftRow {
  id: string;
  cashierName: string;
  branchId: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: MoneyString;
  expectedCash: MoneyString | null;
  actualCash: MoneyString | null;
  difference: MoneyString | null;
}

// ------------------------------------------------------------- fetchers

function rangeQuery(f: ReportFilters): Record<string, string | undefined> {
  return {
    from: f.from,
    to: f.to,
    branchId: f.branchId ?? undefined,
    groupBy: f.groupBy,
  };
}

export const reportsApi = {
  consumables: async (
    f: ReportFilters,
    kind?: ConsumablesKind,
    source?: ConsumablesSource,
  ): Promise<ConsumablesReport> => {
    const res = await api.get<ConsumablesReport>('/reports/consumables', {
      ...rangeQuery(f),
      kind,
      source,
    });
    return res.data;
  },
  cashflow: async (
    f: ReportFilters,
    method?: 'CASH' | 'CARD' | 'CLICK',
  ): Promise<CashflowReport> => {
    const res = await api.get<CashflowReport>('/reports/cashflow', { ...rangeQuery(f), method });
    return res.data;
  },
  revenue: async (f: ReportFilters, dimension: RevenueDimension): Promise<RevenueReport> => {
    const res = await api.get<RevenueReport>('/reports/revenue', {
      ...rangeQuery(f),
      dimension,
    });
    return res.data;
  },
  patientFlow: async (f: ReportFilters): Promise<PatientFlowReport> => {
    const res = await api.get<PatientFlowReport>('/reports/patient-flow', rangeQuery(f));
    return res.data;
  },
  doctors: async (f: ReportFilters): Promise<DoctorReportRow[]> => {
    const res = await api.get<DoctorReportRow[]>('/reports/doctors', rangeQuery(f));
    return res.data;
  },
  services: async (f: ReportFilters): Promise<ServiceReportRow[]> => {
    const res = await api.get<ServiceReportRow[]>('/reports/services', rangeQuery(f));
    return res.data;
  },
  queue: async (f: ReportFilters): Promise<QueueReport> => {
    const res = await api.get<QueueReport>('/reports/queue', rangeQuery(f));
    return res.data;
  },
  labTurnaround: async (f: ReportFilters): Promise<LabTurnaroundReport> => {
    const res = await api.get<LabTurnaroundReport>('/reports/lab-turnaround', rangeQuery(f));
    return res.data;
  },
  cashierShifts: async (f: ReportFilters): Promise<CashierShiftRow[]> => {
    const res = await api.get<CashierShiftRow[]>('/reports/cashier-shifts', rangeQuery(f));
    return res.data;
  },
  /** Any report endpoint with `export=xlsx` streams an XLSX file. */
  exportXlsx: async (
    path: string,
    f: ReportFilters,
    extra?: Record<string, string>,
  ): Promise<Blob> => {
    const res = await api.get<Blob>(path, {
      ...rangeQuery(f),
      ...extra,
      export: 'xlsx',
    });
    return res.data;
  },
};
