import { api, type ApiResult } from '@/lib/api-client';

// ------------------------------------------------------------- response types

export interface FeedbackRow {
  id: string;
  branchId: string;
  patientId: string;
  visitId: string | null;
  doctorUserId: string | null;
  rating: number;
  comment: string | null;
  isPublic: boolean;
  createdAt: string;
  patient: { id: string; fullName: string; mrn: string } | null;
  doctor: { id: string; fullName: string } | null;
}

export type RatingKey = '1' | '2' | '3' | '4' | '5';

export interface FeedbackStats {
  count: number;
  avg: number | null;
  distribution: Record<RatingKey, number>;
  perDoctor: Array<{
    doctor: { id: string; fullName: string | null };
    avg: number;
    count: number;
  }>;
}

export interface FeedbackFilters {
  doctorUserId: string | null;
  minRating: number | null;
  from?: string;
  to?: string;
  page: number;
}

/** Ratings at or below this value are flagged as low. */
export const LOW_RATING_THRESHOLD = 2;

// ------------------------------------------------------------------ fetchers

export const feedbackApi = {
  list: (f: FeedbackFilters): Promise<ApiResult<FeedbackRow[]>> =>
    api.get<FeedbackRow[]>('/feedback', {
      doctorUserId: f.doctorUserId ?? undefined,
      minRating: f.minRating ?? undefined,
      from: f.from,
      to: f.to,
      page: f.page,
    }),

  stats: async (): Promise<FeedbackStats> => {
    const res = await api.get<FeedbackStats>('/feedback/stats');
    return res.data;
  },

  setVisibility: async (id: string, isPublic: boolean): Promise<FeedbackRow> => {
    const res = await api.patch<FeedbackRow>(`/feedback/${id}/visibility`, { isPublic });
    return res.data;
  },
};
