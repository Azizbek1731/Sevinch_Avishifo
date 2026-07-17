'use client';

import type { ApiMeta, ApiResponse, ErrorCode } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
  const url = new URL(`/api/v1${path}`, API_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

let refreshPromise: Promise<string | null> | null = null;

/** Single-flight refresh: many 401s → one refresh call. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(buildUrl('/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
        });
        const json = (await res.json()) as ApiResponse<{ accessToken: string }>;
        if (res.ok && json.success) {
          useAuthStore.getState().setAccessToken(json.data.accessToken);
          return json.data.accessToken;
        }
        return null;
      } catch {
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

export const api = {
  get: <T>(path: string, query?: Query) => apiFetch<T>(path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    apiFetch<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => apiFetch<T>(path, { method: 'POST', body: form }),
};
