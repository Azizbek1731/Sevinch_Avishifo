import { format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { uz, uzCyrl, ru, enUS } from 'date-fns/locale';
import { TIMEZONE } from '@avishifo/shared';

const localeMap = { uz, 'uz-Cyrl': uzCyrl, ru, en: enUS } as const;

/** Format a UTC ISO string / Date in Asia/Tashkent. */
export function formatTz(
  date: string | Date,
  fmt = 'dd.MM.yyyy HH:mm',
  locale: keyof typeof localeMap = 'uz',
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(toZonedTime(d, TIMEZONE), fmt, { locale: localeMap[locale] });
}

export function formatDate(date: string | Date, locale: keyof typeof localeMap = 'uz'): string {
  return formatTz(date, 'dd.MM.yyyy', locale);
}

export function formatTime(date: string | Date): string {
  return formatTz(date, 'HH:mm');
}

/** "YYYY-MM-DD" of today in Asia/Tashkent. */
export function todayTashkent(): string {
  return format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
}

/** Local Tashkent "YYYY-MM-DD" + "HH:mm" → UTC ISO string. */
export function tashkentToUtcIso(date: string, time: string): string {
  return fromZonedTime(`${date}T${time}:00`, TIMEZONE).toISOString();
}
