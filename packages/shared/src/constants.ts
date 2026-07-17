import { Locale } from './enums';

export const TIMEZONE = 'Asia/Tashkent';
export const CURRENCY = 'UZS';

export const LOCALES = [Locale.UZ, Locale.RU, Locale.EN, Locale.UZ_CYRL] as const;
export const DEFAULT_LOCALE = Locale.UZ;

/** Normalized phone: +998 followed by 9 digits. */
export const PHONE_REGEX = /^\+998\d{9}$/;
export const PHONE_MASK = '+998 ## ###-##-##';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Queue ticket display format: `${prefix}-${number padded to 3}` e.g. A-013 */
export const TICKET_NUMBER_PAD = 3;

/** Visit becomes read-only N hours after completion (clinic-configurable). */
export const DEFAULT_VISIT_LOCK_HOURS = 24;

/** "Your turn is near" notification threshold (tickets ahead). */
export const QUEUE_NEAR_THRESHOLD = 2;

export const PATIENT_SOURCES = [
  'friend_referral',
  'doctor_referral',
  'instagram',
  'telegram',
  'facebook',
  'google',
  'street_banner',
  'returning',
  'other',
] as const;
export type PatientSource = (typeof PATIENT_SOURCES)[number];

export const PATIENT_TAGS = ['VIP', 'DEBTOR', 'STAFF_FAMILY', 'INSURANCE', 'BLACKLIST'] as const;

export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE_MB: 20,
  ALLOWED_MIME: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ] as readonly string[],
} as const;

/** Standard vitals captured in visit Objective section. */
export const VITAL_KEYS = [
  'heightCm',
  'weightKg',
  'bpSystolic',
  'bpDiastolic',
  'pulseBpm',
  'temperatureC',
  'spo2',
] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];
