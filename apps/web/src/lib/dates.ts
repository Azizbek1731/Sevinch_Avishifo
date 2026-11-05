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

/** Current Asia/Tashkent clock as `datetime-local` value (`YYYY-MM-DDTHH:mm`). */
export function nowTashkentDateTimeLocal(): string {
  return format(toZonedTime(new Date(), TIMEZONE), "yyyy-MM-dd'T'HH:mm");
}

/** `datetime-local` value in Tashkent → UTC ISO for the API. */
export function tashkentDateTimeLocalToUtcIso(local: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(local.trim());
  if (!match) {
    throw new Error('Invalid datetime-local value');
  }
  return tashkentToUtcIso(match[1]!, match[2]!);
}
