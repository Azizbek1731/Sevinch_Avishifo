'use client';

import type { ApiMeta, ApiResponse, ErrorCode } from '@avishifo/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const TOKEN_STORAGE_KEY = 'avishifo_portal_token';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: QueryParams;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
}

export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(`/api/v1${path}`, API_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const token = opts.anonymous ? null : getToken();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Tarmoq xatosi. Internet aloqasini tekshiring.', 0);
  }

  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;

  // Portal JWT is invalid/expired: clear it and send the user to login.
  if (res.status === 401 && token) {
    clearToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}`);
    }
  }

  if (!res.ok || !json || !json.success) {
    const err = json && !json.success ? json.error : undefined;
    throw new ApiError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? `So'rov bajarilmadi (${res.status})`,
      res.status,
    );
  }
  return { data: json.data, meta: json.meta };
}

export const api = {
  get: <T>(path: string, query?: QueryParams) => apiFetch<T>(path, { query }),
  post: <T>(path: string, body?: unknown, opts?: { anonymous?: boolean }) =>
    apiFetch<T>(path, { method: 'POST', body, anonymous: opts?.anonymous }),
};

/** Uzbek messages for known error codes (fallback: server message). */
const CODE_MESSAGES: Partial<Record<ErrorCode | 'NETWORK_ERROR', string>> = {
  NETWORK_ERROR: 'Tarmoq xatosi. Internet aloqasini tekshiring.',
  VALIDATION_ERROR: "Ma'lumotlar noto'g'ri kiritildi.",
  UNAUTHORIZED: 'Davom etish uchun tizimga kiring.',
  FORBIDDEN: 'Bu amal uchun ruxsat yo‘q.',
  NOT_FOUND: 'Ma’lumot topilmadi.',
  RATE_LIMITED: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.',
  INTERNAL_ERROR: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.',
  OTP_INVALID: 'Kod noto‘g‘ri kiritildi.',
  OTP_EXPIRED: 'Kod muddati tugagan. Yangi kod so‘rang.',
  SLOT_TAKEN: 'Bu vaqt hozirgina band qilindi. Boshqa vaqtni tanlang.',
  SLOT_OUTSIDE_SCHEDULE: 'Bu vaqt shifokor jadvaliga to‘g‘ri kelmaydi.',
  APPOINTMENT_NOT_FOUND: 'Qabul topilmadi.',
  APPOINTMENT_CONFLICT: 'Bu vaqtda boshqa qabul mavjud.',
  INVALID_STATUS_TRANSITION: 'Bu qabulni bekor qilib bo‘lmaydi.',
  CLINIC_SUSPENDED: 'Klinika vaqtincha faol emas.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return CODE_MESSAGES[error.code] ?? error.message;
  return 'Xatolik yuz berdi. Qayta urinib ko‘ring.';
}
