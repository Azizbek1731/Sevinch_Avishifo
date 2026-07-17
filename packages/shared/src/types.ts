import type { ErrorCode } from './error-codes';
import type { Locale, UserRole } from './enums';
import type { Permission } from './permissions';

/** Standard API response envelope (spec §8). */
export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown[];
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Paginated<T> {
  items: T[];
  meta: ApiMeta;
}

/** JWT access-token payload. */
export interface JwtPayload {
  sub: string; // userId
  clinicId: string | null; // null for SUPER_ADMIN
  role: UserRole;
  /** Session id (for refresh rotation & remote logout). */
  sid: string;
  /** Set when a SUPER_ADMIN is impersonating a clinic user (audited). */
  impersonatedBy?: string;
}

/** Authenticated principal attached to requests after JWT validation. */
export interface AuthUser {
  id: string;
  clinicId: string | null;
  role: UserRole;
  fullName: string;
  locale: Locale;
  branchIds: string[];
  permissions: Permission[];
  sessionId: string;
  impersonatedBy?: string;
}

/** Money travels as string ("150000.00"); never use JS number for money. */
export type MoneyString = string;
