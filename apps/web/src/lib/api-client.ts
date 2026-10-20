'use client';

import { PAGINATION, type ApiMeta, type ApiResponse, type ErrorCode } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';

/**
 * API origin. Priority:
 *   1. NEXT_PUBLIC_API_URL (explicit — separate-domain deployments)
 *   2. same origin as the page (behind nginx: /api → backend) — works on any
 *      domain/IP with a single build, no rebuild per environment
 *   3. localhost:3001 (SSR / dev fallback)
 */
function resolveApiOrigin(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.length > 0) return env;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3001';
}

export const API_URL = resolveApiOrigin();

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly status: number,
    readonly details?: unknown[],
  ) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  /** Skip Authorization header (login, public endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`/api/v1${path}`, resolveApiOrigin());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Single-flight refresh: many 401s → one refresh call. Resolves null only when
 * the server rejects the refresh cookie. A dropped Wi-Fi or a restarting server
 * throws instead: it says nothing about the session, so nobody is signed out.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        let res: Response;
        try {
          res = await fetch(buildUrl('/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
        } catch {
          throw new ApiError('NETWORK_ERROR', 'Network error', 0);
        }
        if (res.status >= 500) {
          throw new ApiError('INTERNAL_ERROR' as ErrorCode, `Request failed (${res.status})`, res.status);
        }
        const json = (await res.json().catch(() => null)) as ApiResponse<{ accessToken: string }> | null;
        if (res.ok && json?.success) {
          useAuthStore.getState().setAccessToken(json.data.accessToken);
          return json.data.accessToken;
        }
        return null;
      } finally {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

async function doFetch<T>(path: string, opts: FetchOptions, retried: boolean): Promise<ApiResult<T>> {
  const { accessToken, activeBranchId } = useAuthStore.getState();
  const headers: Record<string, string> = { ...opts.headers };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (!opts.anonymous && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (activeBranchId) headers['x-branch-id'] = activeBranchId;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Network error', 0);
  }

  // Binary responses (xlsx exports, file downloads)
  const contentType = res.headers.get('content-type') ?? '';
  if (res.ok && !contentType.includes('application/json')) {
    return { data: (await res.blob()) as unknown as T };
  }

  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;

  if (res.status === 401 && !retried && !opts.anonymous) {
    const token = await refreshAccessToken();
    if (token) return doFetch<T>(path, opts, true);
    useAuthStore.getState().clear();
  }

  if (!res.ok || !json || !json.success) {
    const err = json && !json.success ? json.error : undefined;
    // The trial lapsed mid-session: flip the app into read-only right away so
    // the banner appears without waiting for the next /auth/me.
    if (err?.code === 'SUBSCRIPTION_EXPIRED') useAuthStore.getState().markExpired();
    throw new ApiError(
      err?.code ?? ('INTERNAL_ERROR' as ErrorCode),
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }
  return { data: json.data, meta: json.meta };
}

export function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<ApiResult<T>> {
  return doFetch<T>(path, opts, false);
}

/**
 * Every row of a paginated list. The server caps a page at PAGINATION.MAX_LIMIT,
 * so a picker that must offer the whole catalogue walks the pages.
 */
async function getAll<T>(path: string, query?: Query): Promise<ApiResult<T[]>> {
  const limit = PAGINATION.MAX_LIMIT;
  const data: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const res = await apiFetch<T[]>(path, { query: { ...query, page, limit } });
    data.push(...res.data);
    if (res.data.length < limit || data.length >= (res.meta?.total ?? 0)) break;
  }
  return { data, meta: { page: 1, limit: data.length, total: data.length } };
}

export const api = {
  get: <T>(path: string, query?: Query) => apiFetch<T>(path, { query }),
  getAll,
  post: <T>(path: string, body?: unknown, query?: Query) =>
    apiFetch<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => apiFetch<T>(path, { method: 'POST', body: form }),
};
