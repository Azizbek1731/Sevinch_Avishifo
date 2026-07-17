import { addDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { uz } from 'date-fns/locale';
import { TIMEZONE } from '@avishifo/shared';

function tz(date: string | Date): Date {
  return toZonedTime(typeof date === 'string' ? new Date(date) : date, TIMEZONE);
}

/** "12 sentyabr 2026, 14:30" (Asia/Tashkent). */
export function formatDateTime(date: string | Date): string {
  return format(tz(date), 'd MMMM yyyy, HH:mm', { locale: uz });
}

/** "12 sentyabr 2026" (Asia/Tashkent). */
export function formatDate(date: string | Date): string {
  return format(tz(date), 'd MMMM yyyy', { locale: uz });
}

/** "14:30" (Asia/Tashkent). */
export function formatTime(date: string | Date): string {
  return format(tz(date), 'HH:mm');
}

export interface DayChip {
  /** "YYYY-MM-DD" in Asia/Tashkent. */
  date: string;
  /** Weekday, e.g. "juma". */
  weekday: string;
  /** "12 sen". */
  label: string;
  isToday: boolean;
}

/** Next 14 calendar days (Asia/Tashkent) for the booking date picker. */
export function nextDays(count = 14): DayChip[] {
  const today = tz(new Date());
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, i);
    return {
      date: format(d, 'yyyy-MM-dd'),
      weekday: format(d, 'EEEE', { locale: uz }),
      label: format(d, 'd MMM', { locale: uz }),
      isToday: i === 0,
    };
  });
}

/** Branch working hours may arrive as a string or a weekday→hours map. */
export function formatWorkingHours(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v !== '')
      .map(([day, v]) => `${day}: ${String(v)}`);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
}
