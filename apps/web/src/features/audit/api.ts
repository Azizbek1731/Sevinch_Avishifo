'use client';

import { api, type ApiResult } from '@/lib/api-client';

export interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  user: { id: string; fullName: string } | null;
  diff: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  page?: number;
  entity?: string;
  action?: string;
  userId?: string;
  /** "YYYY-MM-DD" inclusive lower bound. */
  from?: string;
  /** "YYYY-MM-DD" inclusive upper bound. */
  to?: string;
}

export const auditApi = {
  listLogs: (q: AuditLogQuery): Promise<ApiResult<AuditLogRow[]>> =>
    api.get<AuditLogRow[]>('/audit-logs', { ...q }),
  listEntities: (): Promise<ApiResult<string[]>> => api.get<string[]>('/audit-logs/entities'),
};

/** Split an audit diff into before/after halves when it has that shape. */
export function splitDiff(diff: unknown): { before: unknown; after: unknown } | null {
  if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) return null;
  const d = diff as Record<string, unknown>;
  if (!('before' in d) && !('after' in d)) return null;
  return { before: d.before ?? null, after: d.after ?? null };
}
